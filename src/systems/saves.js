/**
 * Прогресс игрока: статистика, календарь решённых дней, инвентарь бустеров,
 * выданные достижения, незаконченная партия, настройки. Хранится в облаке
 * Яндекса (player.setData) с fallback на localStorage внутри SDK-обёртки.
 *
 * Требование модерации 1.9: обновление страницы не должно влиять на
 * сохранённые данные — поэтому реальный прогресс (решённый кроссворд,
 * состояние текущей партии, покупка) пишется немедленно (saveNow/flush=true).
 * Дебаунс (save()) оставлен только для некритичных настроек (звук, тема).
 *
 * Серия дней не хранится числом — см. `systems/daily.js`: хранится множество
 * решённых дней, а длина серии считается по нему. Так календарь, серия и
 * восстановление пропущенного дня физически не могут разойтись.
 */

import { today, streakLength, bestStreak, dayNumber } from './daily.js';
import { earnedIds } from './achievements.js';
import { BOOSTER_IDS, STARTER_KIT } from './shop.js';

const DEFAULTS = {
  v: 2,
  stats: {
    solved: 0,
    words: 0,
    noHints: 0,
    byMode: {},      // easy | hard | theme | daily -> сколько решено
    byTheme: {},     // id темы -> сколько решено
  },
  days: [],          // номера дней, в которые решён хотя бы один кроссворд
  restoreUsedOn: 0,  // день последнего восстановления за рекламу (не чаще раза в сутки)
  current: null,     // незаконченная партия
  recent: {},        // poolId -> недавно встреченные слова (см. rememberWords)
  uniq: [],          // все РАЗНЫЕ отгаданные слова (см. _rememberUnique)
  ach: [],           // идентификаторы выданных достижений
  inv: { letter: 0, word: 0, scatter: 0 },
  starterGiven: false,
  reviewAsked: false,
  soundOn: true,
  theme: 'auto',     // auto | light | dark
};

/**
 * Сколько недавних слов помнить ПО КАЖДОМУ пулу.
 *
 * Память раздельная, и это принципиально. Пока список был общим на всю игру,
 * режимы вытесняли друг друга из него: шесть партий в лёгком (по 17 слов)
 * выбивали оттуда всю тематическую историю, и вернувшийся к теме игрок получал
 * кроссворд, собранный будто с чистого листа. Пулы между собой не пересекаются
 * почти нигде, так что общий список к тому же тратил место на слова, которые
 * другому пулу всё равно не подходят.
 *
 * 200 — это примерно 8 партий сложного режима, 12 тематических или 12 лёгких.
 * Больше держать вредно с двух сторон: сохранение растёт, а генератору
 * становится физически не из чего собирать доску, не повторяясь.
 */
const RECENT_CAP = 200;

// Предел копилки разных слов: с запасом выше последней ступени достижения (1500).
const UNIQUE_CAP = 2000;

// Календарь глубже двух лет игроку не нужен, а сохранение он раздувает.
const DAYS_CAP = 800;

class Saves {
  constructor() {
    this.sdk = null;
    this.data = structuredClone(DEFAULTS);
    this._days = new Set();
    this._uniqueWords = new Set();
    this._saveTimer = null;
  }

  async load(sdk) {
    this.sdk = sdk;
    const stored = await sdk.getData();
    const st = stored.stats || {};
    this.data = {
      ...structuredClone(DEFAULTS),
      ...stored,
      stats: {
        solved: st.solved || 0,
        words: st.words || 0,
        noHints: st.noHints || 0,
        byMode: { ...(st.byMode || {}) },
        byTheme: { ...(st.byTheme || {}) },
      },
      inv: { ...DEFAULTS.inv, ...(stored.inv || {}) },
      ach: Array.isArray(stored.ach) ? stored.ach.slice() : [],
      days: Array.isArray(stored.days) ? stored.days.slice() : [],
      recent: this._normalizeRecent(stored.recent),
      uniq: Array.isArray(stored.uniq) ? stored.uniq.slice(0, UNIQUE_CAP) : [],
    };

    this._migrateV1(stored);
    this._days = new Set(this.data.days);
    this._uniqueWords = new Set(this.data.uniq);
    this._grantStarterKit();
    // Достижения пересчитываем при каждом входе: так игроки, у которых прогресс
    // накопился до появления этой системы, получают заслуженное сразу, а не
    // ждут следующей победы.
    this.data.ach = [...new Set([...this.data.ach, ...earnedIds(this.progressSnapshot())])];
  }

  /**
   * Перенос сохранений прежней версии.
   *
   * Раньше серия хранилась парой «дата последней игры + счётчик». Множества
   * дней в старом сохранении нет и взяться ему неоткуда, поэтому мы
   * ДОСТРАИВАЕМ его назад от последней игры: игрок с семидневной серией должен
   * увидеть её же, а не ноль. Это единственный честный способ не отнять у
   * человека то, что он уже заработал.
   */
  _migrateV1(stored) {
    if (!stored || stored.v >= 2 || !stored.streak) return;
    const { lastPlay, days } = stored.streak;
    const n = Number(days) || 0;
    if (!lastPlay || n <= 0) return;
    const parsed = new Date(`${lastPlay}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return;
    const last = dayNumber(parsed);
    const restored = [];
    for (let i = 0; i < Math.min(n, DAYS_CAP); i++) restored.push(last - i);
    this.data.days = [...new Set([...this.data.days, ...restored])];
    this.data.v = 2;
  }

  /** Новичку один раз выдаём набор бустеров, чтобы он увидел, как они работают. */
  _grantStarterKit() {
    if (this.data.starterGiven) return;
    this.data.starterGiven = true;
    for (const [id, n] of Object.entries(STARTER_KIT)) {
      this.data.inv[id] = (this.data.inv[id] || 0) + n;
    }
    this.saveNow();
  }

  // --- Память недавних слов ---

  /**
   * Привести память недавних слов к виду «пул → слова».
   *
   * В прежних сохранениях это был один плоский список на всю игру. Разложить
   * его обратно по пулам нельзя — в нём не осталось следа, где какое слово
   * встретилось. Отдаём его лёгкому режиму: он самый играемый, и там список
   * почти наверняка и набрался. Остальные пулы начнут с чистого листа, и это
   * стоит игроку максимум одного повтора в первой же партии.
   */
  _normalizeRecent(stored) {
    if (Array.isArray(stored)) return stored.length ? { easy: stored.slice(0, RECENT_CAP) } : {};
    if (!stored || typeof stored !== 'object') return {};
    const out = {};
    for (const [poolId, words] of Object.entries(stored)) {
      if (Array.isArray(words) && words.length) out[poolId] = words.slice(0, RECENT_CAP);
    }
    return out;
  }

  /**
   * Слова, которые игроку недавно попадались В ЭТОМ ЖЕ пуле. Генератор
   * отбрасывает их, пока есть из чего выбирать, чтобы соседние кроссворды не
   * состояли из одних и тех же коротких «затычек».
   */
  recentWords(poolId) {
    return this.data.recent?.[poolId] || [];
  }

  /** Запомнить слова только что начатой партии (самые свежие — в начале списка). */
  rememberWords(poolId, words) {
    if (!poolId || !words?.length) return;
    const seen = new Set(words);
    const rest = (this.data.recent?.[poolId] || []).filter((w) => !seen.has(w));
    this.data.recent = { ...this.data.recent, [poolId]: [...words, ...rest].slice(0, RECENT_CAP) };
    this.save();
  }

  /** Дебаунс-запись для некритичных настроек. */
  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.sdk?.setData(this.data);
    }, 500);
  }

  /** Немедленная запись с flush — для критичных моментов (партия, победа, покупка). */
  saveNow() {
    clearTimeout(this._saveTimer);
    this.sdk?.setData(this.data, true);
  }

  // --- Текущая партия (возобновление) ---

  saveCurrent(current) {
    this.data.current = current;
    this.saveNow();
  }

  getCurrent() {
    return this.data.current;
  }

  clearCurrent() {
    this.data.current = null;
    this.saveNow();
  }

  // --- Статистика и победа ---

  /**
   * Зафиксировать решённый кроссворд.
   *
   * @param {{mode:string, theme:string|null, words:number, boostersUsed:number}} info
   * @returns {string[]} идентификаторы достижений, выданных именно сейчас —
   *   экран победы показывает по ним всплывающие уведомления.
   */
  recordSolved({ mode = 'easy', theme = null, words = 0, wordList = null, boostersUsed = 0 } = {}) {
    const s = this.data.stats;
    s.solved += 1;
    s.words += words;
    this._rememberUnique(wordList);
    if (boostersUsed === 0) s.noHints += 1;
    s.byMode[mode] = (s.byMode[mode] || 0) + 1;
    if (theme) s.byTheme[theme] = (s.byTheme[theme] || 0) + 1;

    this._markDaySolved(today());
    this.data.current = null;
    const fresh = this._syncAchievements();
    this.saveNow();
    return fresh;
  }

  /**
   * Пополнить копилку РАЗНЫХ отгаданных слов.
   *
   * Почему хранится сам список, а не одно число. Число нельзя пересчитать и
   * нельзя проверить: чтобы понять, новое слово или уже было, нужен способ
   * спросить «встречалось ли оно». Компактные приблизительные структуры
   * (счётчик по хешам, фильтр Блума) весят меньше, но врут на процент-другой, а
   * достижение, которое иногда не засчитывает честно отгаданное слово, хуже
   * лишних килобайтов в сохранении.
   *
   * Список ограничен сверху: последняя ступень достижения — 1500 слов, и после
   * `UNIQUE_CAP` копилка перестаёт расти. Всё, что можно было заработать, к
   * этому моменту уже заработано, а сохранение не разрастается бесконечно у
   * тех, кто играет годами.
   */
  _rememberUnique(wordList) {
    if (!Array.isArray(wordList) || !wordList.length) return;
    const known = this._uniqueWords;
    if (known.size >= UNIQUE_CAP) return;
    let added = false;
    for (const w of wordList) {
      if (!w || known.has(w)) continue;
      known.add(w);
      added = true;
      if (known.size >= UNIQUE_CAP) break;
    }
    if (added) this.data.uniq = [...known];
  }

  /** Сколько РАЗНЫХ слов игрок отгадал за всё время. */
  get uniqueWordCount() { return this._uniqueWords.size; }

  /** Отметить день решённым и подрезать слишком старую историю. */
  _markDaySolved(day) {
    if (this._days.has(day)) return;
    this._days.add(day);
    const sorted = [...this._days].sort((a, b) => b - a).slice(0, DAYS_CAP);
    this._days = new Set(sorted);
    this.data.days = sorted;
  }

  // --- Календарь и серия ---

  get solvedDays() { return this._days; }

  isDaySolved(day) { return this._days.has(day); }

  get streakDays() { return streakLength(this._days); }

  get bestStreakDays() { return bestStreak(this._days); }

  /** Решён ли сегодняшний день — от этого зависит вид кнопки «Кроссворд дня». */
  get solvedToday() { return this._days.has(today()); }

  /**
   * Можно ли сейчас восстановить пропущенный день за рекламу.
   *
   * Ограничение — одно восстановление в сутки. Иначе серию любой длины можно
   * было бы отстроить за один вечер, и она перестала бы что-либо значить: ни
   * как награда, ни как повод вернуться завтра.
   */
  get canRestoreDay() { return this.data.restoreUsedOn !== today(); }

  /** Восстановить пропущенный день (после успешного просмотра ролика). */
  restoreDay(day) {
    if (!this.canRestoreDay) return false;
    if (this._days.has(day)) return false;
    this._markDaySolved(day);
    this.data.restoreUsedOn = today();
    this.saveNow();
    return true;
  }

  // --- Достижения ---

  get unlockedAchievements() { return this.data.ach; }

  /** Снимок прогресса для проверки достижений. */
  progressSnapshot() {
    const s = this.data.stats;
    return {
      solved: s.solved,
      words: s.words,
      noHints: s.noHints,
      byMode: s.byMode,
      byTheme: s.byTheme,
      themesTried: Object.values(s.byTheme).filter((n) => n > 0).length,
      uniqueWords: this._uniqueWords.size,
      streak: this.streakDays,
      streakBest: this.bestStreakDays,
    };
  }

  /** Досчитать достижения и вернуть только что заслуженные. */
  _syncAchievements() {
    const have = new Set(this.data.ach);
    const fresh = earnedIds(this.progressSnapshot()).filter((id) => !have.has(id));
    if (fresh.length) this.data.ach = [...this.data.ach, ...fresh];
    return fresh;
  }

  /** То же, но снаружи (после восстановления дня серия могла вырасти). */
  syncAchievements() {
    const fresh = this._syncAchievements();
    if (fresh.length) this.saveNow();
    return fresh;
  }

  // --- Инвентарь бустеров ---

  get inventory() { return this.data.inv; }

  countOf(boosterId) { return this.data.inv[boosterId] || 0; }

  /** Списать один бустер. Возвращает false, если его нет. */
  useBooster(boosterId) {
    if (!this.countOf(boosterId)) return false;
    this.data.inv[boosterId] -= 1;
    this.saveNow();
    return true;
  }

  /** Начислить бустеры (покупка или награда за ролик). */
  grantBoosters(grants) {
    for (const [id, n] of Object.entries(grants)) {
      if (!BOOSTER_IDS.includes(id)) continue;
      this.data.inv[id] = (this.data.inv[id] || 0) + n;
    }
    this.saveNow();
  }

  get stats() { return this.data.stats; }

  // --- Оценка игры ---

  /**
   * Предлагали ли уже оценить игру. Площадка сама не даст спросить дважды
   * за сессию, но между сессиями `canReview()` снова ответит «да», если игрок
   * просто закрыл окно, ничего не поставив. Помним это у себя, чтобы не
   * возвращаться к просьбе после каждой победы.
   */
  get reviewAsked() { return !!this.data.reviewAsked; }

  markReviewAsked() {
    this.data.reviewAsked = true;
    this.saveNow();
  }

  // --- Настройки ---

  toggleSound() {
    this.data.soundOn = !this.data.soundOn;
    this.save();
    return this.data.soundOn;
  }

  get soundOn() { return this.data.soundOn; }

  setTheme(theme) {
    this.data.theme = theme;
    this.save();
  }

  get theme() { return this.data.theme; }
}

export const saves = new Saves();
