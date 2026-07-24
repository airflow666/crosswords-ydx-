/**
 * Прогресс игрока: личная статистика, серия дней, незаконченная партия,
 * настройки (звук, тема). Хранится в облаке Яндекса (player.setData) с
 * fallback на localStorage внутри SDK-обёртки.
 *
 * Требование модерации 1.9: обновление страницы не должно влиять на
 * сохранённые данные — поэтому реальный прогресс (решённый кроссворд,
 * состояние текущей партии) пишется немедленно (saveNow/flush=true).
 * Дебаунс (save()) оставлен только для некритичных настроек (звук, тема).
 */

/**
 * Времени в статистике нет намеренно. Сложность кроссворда каждый раз случайная
 * (7×7 … 11×11), поэтому «рекорд времени» сравнивал бы несравнимое: минута на
 * маленькой сетке выглядела бы достижением рядом с честными двадцатью на
 * большой. Вместо этого считаем то, что от размера сетки не зависит.
 */
const DEFAULTS = {
  stats: { solved: 0, words: 0, noHints: 0 },
  streak: { lastPlay: '', days: 0 },   // серия дней подряд (несоревновательно)
  current: null,                        // { seed, level, filled, hintsUsed } — возобновление партии
  recent: [],                           // недавно встреченные слова (см. rememberWords)
  soundOn: true,
  theme: 'auto',                        // auto | light | dark
};

// Сколько недавних слов помнить. ~4 средних кроссворда: этого хватает, чтобы
// подряд идущие партии не повторялись, и мало, чтобы заметно раздуть сохранение.
const RECENT_CAP = 120;

function today() {
  return new Date().toISOString().slice(0, 10);
}

class Saves {
  constructor() {
    this.sdk = null;
    this.data = structuredClone(DEFAULTS);
    this._saveTimer = null;
  }

  async load(sdk) {
    this.sdk = sdk;
    const stored = await sdk.getData();
    const st = stored.stats || {};
    this.data = {
      ...structuredClone(DEFAULTS),
      ...stored,
      // Берём только известные поля: у игроков со старых версий в stats лежат
      // bestTimeSec/totalTimeSec, которые больше не нужны, и тащить их дальше
      // незачем. Число решённых кроссвордов и серия дней при этом сохраняются.
      stats: {
        solved: st.solved || 0,
        words: st.words || 0,
        noHints: st.noHints || 0,
      },
      streak: { ...DEFAULTS.streak, ...(stored.streak || {}) },
      recent: Array.isArray(stored.recent) ? stored.recent.slice(0, RECENT_CAP) : [],
    };
  }

  // --- Память недавних слов ---

  /**
   * Слова, которые игроку недавно попадались. Генератор уводит их в конец
   * очереди кандидатов, чтобы соседние кроссворды не состояли из одних и тех же
   * коротких «затычек».
   */
  get recentWords() {
    return this.data.recent || [];
  }

  /** Запомнить слова только что начатой партии (самые свежие — в начале списка). */
  rememberWords(words) {
    const seen = new Set(words);
    const rest = (this.data.recent || []).filter((w) => !seen.has(w));
    this.data.recent = [...words, ...rest].slice(0, RECENT_CAP);
    this.save();
  }

  /** Дебаунс-запись для некритичных настроек. */
  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.sdk?.setData(this.data);
    }, 500);
  }

  /** Немедленная запись с flush — для критичных моментов (партия, победа). */
  saveNow() {
    clearTimeout(this._saveTimer);
    this.sdk?.setData(this.data, true);
  }

  // --- Текущая партия (возобновление) ---

  /** Сохранить состояние незаконченной партии. */
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

  // --- Статистика ---

  /**
   * Зафиксировать решённый кроссворд: счётчики и серия дней.
   * @param {{words:number, hintsUsed:number}} info — слов в сетке и сколько
   *   подсказок понадобилось (партии, пройденные без подсказок, считаем отдельно).
   */
  recordSolved({ words = 0, hintsUsed = 0 } = {}) {
    const s = this.data.stats;
    s.solved += 1;
    s.words += words;
    if (hintsUsed === 0) s.noHints += 1;
    this._bumpStreak();
    this.data.current = null;
    this.saveNow();
  }

  /** Серия дней подряд: сегодня уже засчитан — не трогаем; вчера — +1; иначе сброс на 1. */
  _bumpStreak() {
    const t = today();
    if (this.data.streak.lastPlay === t) return;
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    this.data.streak.days =
      this.data.streak.lastPlay === yesterday ? this.data.streak.days + 1 : 1;
    this.data.streak.lastPlay = t;
  }

  get stats() { return this.data.stats; }
  get streakDays() { return this.data.streak.days; }

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
