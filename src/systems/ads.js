/**
 * Реклама поверх SDK-обёртки. В игре ровно один формат — rewarded-ролик за
 * подсказку (максимум 3 за партию). Никаких interstitial и баннеров, чтобы
 * не отпугивать аудиторию 30+.
 *
 * Награда (раскрытие букв) начисляется только после события onRewarded —
 * если пользователь закрыл ролик раньше, награды нет (требование модерации).
 * На время ролика останавливаем геймплей и глушим звук.
 */

import { audio } from './audio.js';

// Яндекс требует показывать interstitial не чаще ~1 раза в 60 секунд.
const INTERSTITIAL_COOLDOWN_MS = 62_000;

class Ads {
  constructor() {
    this.sdk = null;
    this.lastInterstitialAt = 0;
  }

  init(sdk) {
    this.sdk = sdk;
  }

  /**
   * Показать interstitial в «естественной паузе», если прошёл кулдаун.
   * Вызывать после победы и при отказе от партии ради новой — НЕ на старте игры.
   * Возвращает Promise<boolean> — был ли показ.
   */
  async maybeShowInterstitial() {
    if (!this.sdk) return false;
    const now = Date.now();
    if (now - this.lastInterstitialAt < INTERSTITIAL_COOLDOWN_MS) return false;
    this.lastInterstitialAt = now;
    this.sdk.gameplayStop();
    audio.suspend();
    let wasShown = false;
    try {
      ({ wasShown } = await this.sdk.showInterstitial());
    } finally {
      audio.resume();
    }
    return wasShown;
  }

  /** Показать rewarded. Возвращает Promise<boolean> — досмотрел ли пользователь ролик. */
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
    return rewarded;
  }
}

export const ads = new Ads();
