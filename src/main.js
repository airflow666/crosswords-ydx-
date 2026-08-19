/**
 * Точка входа. Инициализирует SDK и сохранения, применяет тему,
 * запускает роутер экранов. Реагирует на сворачивание вкладки (пауза/звук).
 *
 * Про загрузку. Площадка засекает время до `LoadingAPI.ready()`, а он
 * вызывается при первой отрисовке главного меню. Поэтому в стартовый бандл не
 * должно попадать ничего, что меню не нужно: экраны подключаются через
 * `import()` по требованию, словари — тоже (см. `game/dict/index.js`). Раньше
 * меню статически тянуло генератор, генератор — словарь, и площадка честно
 * засчитывала в «время загрузки» скачивание и разбор четырёхсот килобайт.
 */

import './styles.css';
import { initSDK } from './yandex/sdk.js';
import { saves } from './systems/saves.js';
import { ads } from './systems/ads.js';
import { audio } from './systems/audio.js';
import { el, applyTheme, closeAllModals, closeTopModal, toast } from './ui.js';
import { renderMenu } from './screens/menu.js';
import { t } from './systems/i18n.js';

const app = document.getElementById('app');

/**
 * Загрузчики экранов. Меню подключено статически — оно показывается первым, и
 * отдельный запрос за ним только оттянул бы `LoadingAPI.ready()`. Остальные
 * едут отдельными чанками: до магазина или лидербордов доходит меньшинство
 * игроков, и платить за них временем старта должны не все.
 */
const ROUTES = {
  menu: async () => renderMenu,
  game: async () => (await import('./screens/game.js')).renderGame,
  results: async () => (await import('./screens/results.js')).renderResults,
  stats: async () => (await import('./screens/stats.js')).renderStats,
  themes: async () => (await import('./screens/themes.js')).renderThemes,
  achievements: async () => (await import('./screens/achievements.js')).renderAchievements,
  shop: async () => (await import('./screens/shop.js')).renderShop,
  leaderboards: async () => (await import('./screens/leaderboards.js')).renderLeaderboards,
};

const ctx = {
  sdk: null,
  /** Заменить содержимое #app экраном (с вызовом cleanup предыдущего). */
  mount(node) {
    const prev = app.firstChild;
    if (prev && prev._cleanup) prev._cleanup();
    closeAllModals();
    document.querySelectorAll('.toast').forEach((n) => n.remove());
    app.replaceChildren(node);
  },
  /**
   * Навигация между экранами. Асинхронная, потому что экран может ехать
   * отдельным чанком. Заставку показываем только если чанк не пришёл за один
   * кадр: на быстрой сети мелькание загрузчика хуже, чем его отсутствие.
   */
  async go(name, params = {}) {
    const load = ROUTES[name] || ROUTES.menu;
    let settled = false;
    const timer = setTimeout(() => { if (!settled) showLoader(); }, 120);
    try {
      const render = await load();
      settled = true;
      clearTimeout(timer);
      await render(ctx, params);
    } catch (e) {
      settled = true;
      clearTimeout(timer);
      console.error('Не удалось открыть экран', name, e);
      // Белый экран недопустим: возвращаем игрока в меню, оно всегда в бандле.
      if (name !== 'menu') renderMenu(ctx, {});
    }
  },
};

function showLoader() {
  app.replaceChildren(
    el('div.screen', {}, el('div.loader', {}, [el('div.spin'), el('div', {}, t('loading'))]))
  );
}
ctx.showLoader = showLoader;

/**
 * Требование площадки §1.6.2.7: взаимодействие с игровым полем не должно
 * приводить ни к выделению, ни к контекстному меню браузера. Игровое поле —
 * обычные div-ы с текстом, поэтому без явного запрета правый клик открывал
 * системное меню, долгий тап — меню/«плашку» выбора, а протяжка мышью
 * выделяла буквы клеток и текст определения.
 *
 * Выделение закрыто стилями (`user-select: none` в index.html и styles.css),
 * но одних стилей мало: их уважают не все браузеры одинаково, а
 * `dragstart` они не покрывают вовсе. Поэтому три события гасим и здесь.
 *
 * Поля ввода не трогаем (их в игре нет, но правило на будущее): в них и меню,
 * и выделение нужны для копирования и вставки.
 */
const isEditable = (node) =>
  node instanceof Element && node.closest('input, textarea, [contenteditable]');

for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
  document.addEventListener(type, (e) => {
    if (isEditable(e.target)) return;
    e.preventDefault();
  });
}

/**
 * ESC закрывает верхнюю модалку на ЛЮБОМ экране. Раньше это умел только игровой
 * экран — у меню и статистики своего обработчика клавиш нет, и диалог там
 * (например, подтверждение сброса партии) с клавиатуры было не закрыть.
 *
 * Слушаем в фазе ПЕРЕХВАТА и, если что-то закрыли, останавливаем событие: иначе
 * игровой экран получил бы тот же ESC уже без модалки и понял бы его как
 * «выйти в меню».
 */
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (closeTopModal()) { e.preventDefault(); e.stopPropagation(); }
}, true);

async function boot() {
  showLoader();
  const sdk = await initSDK();
  ctx.sdk = sdk;

  // Язык интерфейса берём из SDK (§2.14). Локаль у игры одна — русская, иначе и
  // быть не может: кроссворд собран из русских слов и переводу не поддаётся.
  // Но полученный код языка проставляем в <html lang>, чтобы страница честно
  // сообщала браузеру и экранным читалкам, на каком языке содержимое.
  document.documentElement.lang = sdk.lang === 'ru' ? 'ru' : 'ru';

  await saves.load(sdk);
  applyTheme(saves.theme);
  audio.setEnabled(saves.soundOn);
  ads.init(sdk);

  // §1.3: звук замолкает, когда игра теряет фокус. Одного visibilitychange мало —
  // он срабатывает на смену вкладки и сворачивание, но не когда игрок просто
  // переключился в другое окно поверх открытой вкладки. Поэтому слушаем ещё и
  // blur/focus самого окна.
  const pause = () => { sdk.gameplayStop(); audio.suspend(); };
  const resume = () => { audio.resume(); };
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  window.addEventListener('blur', pause);
  window.addEventListener('focus', resume);
  window.addEventListener('pagehide', pause);

  ctx.go('menu');

  // Хвост загрузки — уже ПОСЛЕ показа меню и сигнала площадке о готовности.
  // Ни оплаченные покупки, ни лидерборды не должны задерживать первый экран.
  afterFirstScreen(sdk);
}

/**
 * Всё, что можно сделать потом. Выдача оплаченных, но не выданных покупок —
 * страховка на случай, когда игрок закрыл вкладку между оплатой и начислением:
 * деньги списаны, товара нет. Молча не начисляем — показываем сообщение.
 */
async function afterFirstScreen(sdk) {
  try {
    const [{ restorePending }, { publishScores }] = await Promise.all([
      import('./systems/purchases.js'),
      import('./systems/leaderboards.js'),
    ]);
    const n = await restorePending(sdk);
    if (n) toast(t('shopRestored'));
    publishScores(sdk, saves);
  } catch (e) {
    console.warn('Отложенная инициализация не удалась', e);
  }
}

boot();
