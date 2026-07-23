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
 * В игре нет лидербордов и баннеров: единственная реклама — rewarded за
 * подсказку. Поэтому в обёртке оставлены только init, обязательные для
 * модерации LoadingAPI/GameplayAPI, showRewarded и облачные сохранения.
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
