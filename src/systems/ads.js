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

class Ads {
  constructor() {
    this.sdk = null;
  }

  init(sdk) {
    this.sdk = sdk;
  }

  /** Показать rewarded. Возвращает Promise<boolean> — досмотрел ли пользователь ролик. */
  async showRewarded() {
    if (!this.sdk) return false;
    this.sdk.gameplayStop();
    audio.muteForAd();
    let rewarded = false;
    try {
      ({ rewarded } = await this.sdk.showRewarded());
    } finally {
      audio.unmuteAfterAd();
      this.sdk.gameplayStart();
    }
    return rewarded;
  }
}

export const ads = new Ads();
