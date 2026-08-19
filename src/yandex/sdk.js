/**
 * Обёртка над Yandex Games SDK v2.
 *
 * На платформе Яндекс Игр глобальный YaGames загружается из /sdk.js —
 * подключается программно из этого файла (см. loadSdkScript ниже), а не
 * тегом в index.html, чтобы не зависеть от CSP хостинга площадки.
 * Локально (dev-сервер, тесты) его нет — тогда работает mock-режим:
 * реклама «показывается» мгновенно с записью в лог, данные хранятся
 * в localStorage.
 *
 * Баннеров в игре нет. Реклама — rewarded (подсказки, восстановление дня) и
 * interstitial в естественных паузах между кроссвордами. Кроме этого обёртка
 * закрывает обязательные для модерации LoadingAPI/GameplayAPI, облачные
 * сохранения, лидерборды и внутриигровые покупки.
 */

const LS_DATA_KEY = 'crosswords.save';

class MockPlayer {
  getData() {
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem(LS_DATA_KEY)) || {});
    } catch {
      return Promise.resolve({});
    }
  }
  setData(data) {
    localStorage.setItem(LS_DATA_KEY, JSON.stringify(data));
    return Promise.resolve();
  }
  getMode() { return 'lite'; }
}

function mockLog(...args) {
  console.log('[YSDK-mock]', ...args);
  window.__ysdkMockLog = window.__ysdkMockLog || [];
  window.__ysdkMockLog.push(args.join(' '));
}

class SDKWrapper {
  constructor(ysdk) {
    this.ysdk = ysdk;           // null в mock-режиме
    this.isMock = !ysdk;
    this.player = null;
    this.lang = 'ru';
    this._gameplayRunning = false;
    this._loadingReadySent = false;
    this._reviewRequested = false;   // окно оценки — не больше одного раза за сессию
    this._lbPromise = undefined;     // ленивые объекты SDK: берутся один раз за сессию
    this._payPromise = undefined;
  }

  async init() {
    if (this.isMock) {
      this.player = new MockPlayer();
      // сырой код языка ('ru', 'be', 'en'...) — маппинг делает i18n.setLang
      this.lang = (navigator.language || 'ru').toLowerCase().split('-')[0];
      mockLog('init (mock mode)');
      return;
    }
    this.lang = this.ysdk.environment?.i18n?.lang || 'en';
    try {
      // scopes:false — не запрашиваем персональные данные (требование модерации)
      this.player = await this.ysdk.getPlayer({ scopes: false });
    } catch (e) {
      console.warn('getPlayer failed, using localStorage fallback', e);
      this.player = new MockPlayer();
    }
  }

  /** Сообщить платформе, что игра загрузилась (обязательно для модерации; ровно один раз). */
  loadingReady() {
    if (this._loadingReadySent) return;
    this._loadingReadySent = true;
    if (this.isMock) { mockLog('LoadingAPI.ready'); return; }
    try { this.ysdk.features?.LoadingAPI?.ready?.(); } catch (e) { console.warn('LoadingAPI.ready failed', e); }
  }

  /** Геймплей начался/возобновился (обязательно для модерации). */
  gameplayStart() {
    if (this._gameplayRunning) return;
    this._gameplayRunning = true;
    if (this.isMock) { mockLog('GameplayAPI.start'); return; }
    try { this.ysdk.features?.GameplayAPI?.start?.(); } catch (e) { console.warn('GameplayAPI.start failed', e); }
  }

  /** Геймплей остановился (пауза, реклама, меню, победа). */
  gameplayStop() {
    if (!this._gameplayRunning) return;
    this._gameplayRunning = false;
    if (this.isMock) { mockLog('GameplayAPI.stop'); return; }
    try { this.ysdk.features?.GameplayAPI?.stop?.(); } catch (e) { console.warn('GameplayAPI.stop failed', e); }
  }

  /**
   * Полноэкранная (interstitial) реклама. Показывается только в естественных
   * паузах: после победы и при отказе от партии ради новой (не на старте игры).
   * resolve после закрытия ролика (или сразу при ошибке).
   */
  showInterstitial() {
    if (this.isMock) {
      mockLog('showFullscreenAdv');
      return Promise.resolve({ wasShown: true });
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      try {
        this.ysdk.adv.showFullscreenAdv({
          callbacks: {
            onClose: (wasShown) => done({ wasShown }),   // вызывается в любом исходе
            onError: () => done({ wasShown: false }),
            onOffline: () => done({ wasShown: false }),   // нет сети — не показываем
          },
        });
      } catch (e) {
        console.warn('showFullscreenAdv failed', e);
        done({ wasShown: false });
      }
    });
  }

  /**
   * Реклама с вознаграждением (за подсказку).
   * resolve({ rewarded: true }) только если пользователь досмотрел ролик.
   */
  showRewarded() {
    if (this.isMock) {
      mockLog('showRewardedVideo');
      return Promise.resolve({ rewarded: true });
    }
    return new Promise((resolve) => {
      let rewarded = false, settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      try {
        this.ysdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => { rewarded = true; },   // засчитан показ — только тут выдаём награду
            onClose: () => done({ rewarded }),
            onError: () => done({ rewarded: false }),
          },
        });
      } catch (e) {
        console.warn('showRewardedVideo failed', e);
        done({ rewarded: false });
      }
    });
  }

  /**
   * Можно ли сейчас предложить оценить игру.
   *
   * Площадка требует вызывать `canReview()` ПЕРЕД `requestReview()` — иначе
   * второй отвечает ошибкой «use canReview before requestReview». Причина
   * отказа приходит в `reason`: NO_AUTH (гость), GAME_RATED (уже оценил),
   * REVIEW_ALREADY_REQUESTED / REVIEW_WAS_REQUESTED (уже спрашивали), UNKNOWN.
   *
   * Спросить разрешено один раз за сессию, поэтому после показа окна свой
   * ответ мы даём сразу, не дёргая площадку впустую.
   */
  async canReview() {
    if (this._reviewRequested) return { value: false, reason: 'REVIEW_ALREADY_REQUESTED' };
    if (this.isMock) { mockLog('feedback.canReview'); return { value: true, reason: '' }; }
    try {
      const r = await this.ysdk.feedback?.canReview?.();
      return { value: !!r?.value, reason: r?.reason || 'UNKNOWN' };
    } catch (e) {
      console.warn('feedback.canReview failed', e);
      return { value: false, reason: 'UNKNOWN' };
    }
  }

  /**
   * Показать окно оценки игры. Вызывать только по действию игрока и только
   * после успешного `canReview()` — см. выше.
   *
   * `feedbackSent: true` — оценку поставили, `false` — окно закрыли.
   * В примере из документации поле названо `sentFeedback`, в описании ответа —
   * `feedbackSent`; читаем оба, чтобы не зависеть от того, какое верно.
   */
  async requestReview() {
    if (this._reviewRequested) return { feedbackSent: false };
    this._reviewRequested = true;
    if (this.isMock) { mockLog('feedback.requestReview'); return { feedbackSent: true }; }
    try {
      const r = await this.ysdk.feedback?.requestReview?.();
      return { feedbackSent: !!(r?.feedbackSent ?? r?.sentFeedback) };
    } catch (e) {
      console.warn('feedback.requestReview failed', e);
      return { feedbackSent: false };
    }
  }

  // ---------------------------------------------------------------- лидерборды

  /**
   * Объект лидербордов. Берётся один раз и кешируется: `getLeaderboards()` —
   * сетевой вызов, и дёргать его на каждую отправку результата незачем.
   *
   * Таблицы должны быть заведены в консоли разработчика; их технические имена
   * перечислены в `systems/leaderboards.js`. Если таблицы нет или игрок не
   * авторизован, все методы тихо возвращают пустоту: лидерборд — украшение,
   * из-за него игра ломаться не должна.
   */
  async _leaderboards() {
    if (this.isMock) return null;
    if (this._lbPromise === undefined) {
      this._lbPromise = this.ysdk.getLeaderboards().catch((e) => {
        console.warn('getLeaderboards failed', e);
        return null;
      });
    }
    return this._lbPromise;
  }

  /** Отправить результат. Тихо ничего не делает для гостя (SDK ответит ошибкой). */
  async submitScore(name, score) {
    if (this.isMock) { mockLog('setLeaderboardScore', name, score); return; }
    try {
      const lb = await this._leaderboards();
      await lb?.setLeaderboardScore(name, Math.max(0, Math.round(score)));
    } catch (e) {
      // Гость (NO_AUTH) — обычное дело, а не сбой: просто не публикуем результат.
      console.warn('setLeaderboardScore failed', name, e);
    }
  }

  /**
   * Верхушка таблицы плюс окрестности игрока.
   * @returns {Promise<{entries:Array, userRank:number}>}
   */
  async leaderboardEntries(name, quantityTop = 20) {
    if (this.isMock) {
      mockLog('getLeaderboardEntries', name);
      return { entries: [], userRank: 0 };
    }
    try {
      const lb = await this._leaderboards();
      const res = await lb?.getLeaderboardEntries(name, {
        quantityTop,
        includeUser: true,
        quantityAround: 3,
      });
      const userRank = res?.userRank || 0;
      const entries = (res?.entries || []).map((e) => ({
        rank: e.rank,
        score: e.score,
        name: e.player?.publicName || '',
        avatar: e.player?.getAvatarSrc?.('small') || '',
        // Своя строка определяется по месту: отдельного признака «это ты» в
        // ответе нет, а `userRank` площадка возвращает рядом со списком.
        isUser: userRank > 0 && e.rank === userRank,
      }));
      return { entries, userRank };
    } catch (e) {
      console.warn('getLeaderboardEntries failed', name, e);
      return { entries: [], userRank: 0 };
    }
  }

  // ------------------------------------------------------------------ покупки

  /**
   * Платёжный объект. `signed: false` — подпись покупок нам не нужна: товары
   * потребляемые и начисляются на устройстве, серверной части у игры нет.
   */
  async _payments() {
    if (this.isMock) return null;
    if (this._payPromise === undefined) {
      this._payPromise = this.ysdk.getPayments({ signed: false }).catch((e) => {
        console.warn('getPayments failed', e);
        return null;
      });
    }
    return this._payPromise;
  }

  /** Доступны ли покупки вообще (гость, отключённый модуль, отсутствие сети). */
  async paymentsAvailable() {
    if (this.isMock) return true;
    return !!(await this._payments());
  }

  /** Каталог товаров с ценами из консоли. */
  async getCatalog() {
    if (this.isMock) { mockLog('getCatalog'); return []; }
    try {
      const p = await this._payments();
      return (await p?.getCatalog()) || [];
    } catch (e) {
      console.warn('getCatalog failed', e);
      return [];
    }
  }

  /**
   * Купить товар. Возвращает { ok, token } — токен нужен, чтобы «потребить»
   * покупку: пока она не потреблена, площадка считает её невыданной и вернёт
   * её в `getPurchases()` при следующем запуске.
   */
  async purchase(id) {
    if (this.isMock) { mockLog('purchase', id); return { ok: true, token: 'mock' }; }
    try {
      const p = await this._payments();
      if (!p) return { ok: false, token: null };
      const purchase = await p.purchase({ id });
      return { ok: true, token: purchase?.purchaseToken || null };
    } catch (e) {
      // Отмена игроком приходит сюда же, что и настоящая ошибка. Отличать их
      // незачем: и в том, и в другом случае товар не выдан.
      console.warn('purchase failed', id, e);
      return { ok: false, token: null };
    }
  }

  /** Пометить покупку выданной. */
  async consume(token) {
    if (this.isMock || !token) return;
    try {
      const p = await this._payments();
      await p?.consumePurchase(token);
    } catch (e) {
      console.warn('consumePurchase failed', e);
    }
  }

  /**
   * Оплаченные, но не выданные покупки. Бывают, если игра закрылась между
   * оплатой и начислением: деньги списаны, товара нет. Проверяем на старте.
   */
  async pendingPurchases() {
    if (this.isMock) return [];
    try {
      const p = await this._payments();
      const list = (await p?.getPurchases()) || [];
      return list.map((x) => ({ id: x.productID, token: x.purchaseToken }));
    } catch (e) {
      console.warn('getPurchases failed', e);
      return [];
    }
  }

  async getData() {
    if (!this.player) return {};
    try {
      return (await this.player.getData()) || {};
    } catch {
      return {};
    }
  }

  /** flush=true — немедленная запись на сервер (решённый кроссворд, обновление партии). */
  async setData(data, flush = false) {
    if (!this.player) return;
    try {
      await this.player.setData(data, flush);
    } catch (e) {
      console.warn('setData failed', e);
    }
  }
}

/** Инициализация: пробуем настоящий SDK, при неудаче — mock. */
const INIT_TIMEOUT_MS = 10000;

/** Промис, который резолвится через ms — используется, чтобы не ждать SDK вечно. */
function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Программно создаёт и подключает <script src="/sdk.js">. Обработчики
 * назначены через JS-свойства (.onload/.onerror), а не HTML-атрибуты —
 * в отличие от инлайновых onload="..." в разметке, это не подпадает под
 * ограничения CSP хостинга на инлайн-скрипты, и не имеет гонки состояний
 * (элемент создаётся и слушатели вешаются синхронно, до начала загрузки).
 */
function loadSdkScript() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = '/sdk.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export async function initSDK() {
  let ysdk = null;
  const scriptLoaded = await Promise.race([loadSdkScript(), timeout(INIT_TIMEOUT_MS)]);
  if (scriptLoaded && typeof window.YaGames !== 'undefined') {
    try {
      // На некоторых площадках/встраиваниях init() может зависнуть без reject —
      // ограничиваем ожидание, чтобы игра не застряла на загрузке навсегда.
      ysdk = (await Promise.race([window.YaGames.init(), timeout(INIT_TIMEOUT_MS)])) || null;
    } catch (e) {
      console.warn('YaGames.init failed, falling back to mock', e);
    }
  }
  const wrapper = new SDKWrapper(ysdk);
  try {
    await Promise.race([wrapper.init(), timeout(INIT_TIMEOUT_MS)]);
  } catch (e) {
    console.warn('SDK wrapper init failed', e);
  }
  window.__sdk = wrapper; // для отладки и автотестов
  return wrapper;
}
