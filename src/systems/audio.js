/**
 * Мягкие звуковые эффекты на WebAudio — без внешних файлов (требование
 * модерации: никаких запросов к внешним доменам, весь звук синтезируется).
 * Тон приглушённый, чтобы не раздражать спокойную аудиторию.
 */

class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.mutedForAd = false;
  }

  /** AudioContext создаётся лениво после первого пользовательского жеста. */
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on) { this.enabled = on; }
  muteForAd() { this.mutedForAd = true; }
  unmuteAfterAd() { this.mutedForAd = false; }

  /**
   * Полная остановка звука при потере фокуса (§1.3) и на время рекламы.
   * Одного флага мало: он глушит только НОВЫЕ звуки, а уже запущенный
   * осциллятор продолжал бы звучать. Поэтому ещё и усыпляем AudioContext —
   * так гарантированно замолкает всё разом.
   */
  suspend() {
    this.mutedForAd = true;
    try { this.ctx?.suspend(); } catch { /* контекст мог быть ещё не создан */ }
  }

  /** Вернуть звук после возврата фокуса или окончания ролика. */
  resume() {
    this.mutedForAd = false;
    try { if (this.ctx?.state === 'suspended') this.ctx.resume(); } catch { /* не критично */ }
  }

  _blip(freq, dur, type = 'sine', gain = 0.06) {
    if (!this.enabled || this.mutedForAd) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** Тап по букве — короткий мягкий клик. */
  tap() { this._blip(420, 0.07, 'sine', 0.05); }

  /** Стереть букву. */
  erase() { this._blip(240, 0.06, 'triangle', 0.04); }

  /** Слово собрано верно — приятный аккорд из двух нот. */
  word() {
    this._blip(523.25, 0.16, 'sine', 0.05);
    setTimeout(() => this._blip(659.25, 0.18, 'sine', 0.05), 90);
  }

  /**
   * Достижение получено. Звук намеренно НЕ похож на победный: он звучит поверх
   * победного аккорда и должен читаться как отдельное событие, а не как его
   * продолжение. Отсюда чистая квинта вверх и короткий блеск сверху.
   */
  achievement() {
    this._blip(880, 0.14, 'sine', 0.05);
    setTimeout(() => this._blip(1318.5, 0.26, 'sine', 0.045), 100);
  }

  /** Кроссворд разгадан — короткая восходящая арпеджио. */
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      setTimeout(() => this._blip(f, 0.22, 'sine', 0.06), i * 110);
    });
  }
}

export const audio = new Audio();
