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

const DEFAULTS = {
  stats: { solved: 0, bestTimeSec: null, totalTimeSec: 0 },
  streak: { lastPlay: '', days: 0 },   // серия дней подряд (несоревновательно)
  current: null,                        // { seed, level, filled, hintsUsed } — возобновление партии
  soundOn: true,
  theme: 'auto',                        // auto | light | dark
};

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
    this.data = {
      ...structuredClone(DEFAULTS),
      ...stored,
      stats: { ...DEFAULTS.stats, ...(stored.stats || {}) },
      streak: { ...DEFAULTS.streak, ...(stored.streak || {}) },
    };
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

  /** Зафиксировать решённый кроссворд: статистика, рекорд времени, серия дней. */
  recordSolved(timeSec) {
    const s = this.data.stats;
    s.solved += 1;
    s.totalTimeSec += timeSec;
    const isBest = s.bestTimeSec == null || timeSec < s.bestTimeSec;
    if (isBest) s.bestTimeSec = timeSec;
    this._bumpStreak();
    this.data.current = null;
    this.saveNow();
    return { isBest };
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
