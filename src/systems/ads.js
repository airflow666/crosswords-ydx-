/**
 * Реклама поверх SDK-обёртки.
 *
 * Два формата:
 *   - rewarded — по явному желанию игрока: пополнить кончившийся бустер,
 *     восстановить пропущенный день серии;
 *   - interstitial — только в естественных паузах МЕЖДУ кроссвордами.
 *
 * Правило площадки — не чаще одного полноэкранного показа в 60 секунд. Мы
 * держим 65 с запасом на расхождение часов и, главное, отсчитываем кулдаун от
 * момента ФАКТИЧЕСКОГО показа, а не от попытки: иначе неудачная попытка
 * (нет сети, нет заполнения) съедала бы окно и следующий честный показ
 * пропускался бы.
 *
 * Чего мы не делаем никогда: не показываем interstitial на старте игры, во
 * время решения и сразу после rewarded — подряд идущие ролики раздражают
 * сильнее, чем приносят.
 */

import { audio } from './audio.js';

const INTERSTITIAL_COOLDOWN_MS = 65_000;

// Первую пару кроссвордов игрок проходит без единого полноэкранного ролика:
// первое впечатление важнее пары показов, а уходят чаще всего именно в начале.
const FREE_LEVELS = 2;

class Ads {
  constructor() {
    this.sdk = null;
    this.lastShownAt = 0;
    this.levelsFinished = 0;
  }

  init(sdk) {
    this.sdk = sdk;
    // Отсчёт кулдауна начинаем от запуска: реклама сразу после загрузки —
    // худшее, что можно сделать с удержанием.
    this.lastShownAt = Date.now();
    // И счётчик партий — тоже с нуля: льготные партии полагаются каждой новой
    // сессии, а не один раз за всю жизнь объекта.
    this.levelsFinished = 0;
  }

  /** Сколько секунд осталось до следующего разрешённого показа. */
  get cooldownLeftMs() {
    return Math.max(0, INTERSTITIAL_COOLDOWN_MS - (Date.now() - this.lastShownAt));
  }

  /**
   * Показать interstitial между уровнями, если правила площадки это сейчас
   * позволяют. Возвращает Promise<boolean> — был ли показ.
   */
  async betweenLevels() {
    if (!this.sdk) return false;
    this.levelsFinished += 1;
    if (this.levelsFinished <= FREE_LEVELS) return false;
    if (this.cooldownLeftMs > 0) return false;

    this.sdk.gameplayStop();
    audio.suspend();
    let wasShown = false;
    try {
      ({ wasShown } = await this.sdk.showInterstitial());
    } finally {
      audio.resume();
    }
    // Кулдаун — от реального показа: сорвавшаяся попытка окно не тратит.
    if (wasShown) this.lastShownAt = Date.now();
    return wasShown;
  }

  /** Показать rewarded. Возвращает Promise<boolean> — досмотрел ли игрок ролик. */
  async showRewarded() {
    if (!this.sdk) return false;
    this.sdk.gameplayStop();
    audio.suspend();
    let rewarded = false;
    try {
      ({ rewarded } = await this.sdk.showRewarded());
    } finally {
      audio.resume();
      this.sdk.gameplayStart();
    }
    // Полноэкранный ролик игрок только что видел — не ставим следующий встык.
    if (rewarded) this.lastShownAt = Date.now();
    return rewarded;
  }
}

export const ads = new Ads();
