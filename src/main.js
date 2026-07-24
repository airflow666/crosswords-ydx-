/**
 * Точка входа. Инициализирует SDK и сохранения, применяет тему,
 * запускает роутер экранов. Реагирует на сворачивание вкладки (пауза/звук).
 */

import './styles.css';
import { initSDK } from './yandex/sdk.js';
import { saves } from './systems/saves.js';
import { ads } from './systems/ads.js';
import { audio } from './systems/audio.js';
import { el, applyTheme, closeAllModals, closeTopModal } from './ui.js';
import { renderMenu } from './screens/menu.js';
import { renderGame } from './screens/game.js';
import { renderResults } from './screens/results.js';
import { renderStats } from './screens/stats.js';

const app = document.getElementById('app');

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
  /** Навигация между экранами. */
  go(name, params = {}) {
    const routes = { menu: renderMenu, game: renderGame, results: renderResults, stats: renderStats };
    (routes[name] || renderMenu)(ctx, params);
  },
};

function showLoader() {
  app.replaceChildren(
    el('div.screen', {}, el('div.loader', {}, [el('div.spin'), el('div', {}, 'Загрузка…')]))
  );
}
ctx.showLoader = showLoader;

/**
 * Требование площадки §1.6: в игровой области не должно всплывать контекстное
 * меню браузера — ни по правому клику, ни по долгому тапу. Игровое поле состоит
 * из обычных div-ов, и без этого на телефоне долгое нажатие по клетке открывало
 * системное меню поверх доски.
 *
 * Поля ввода не трогаем (их в игре нет, но правило на будущее): в них меню
 * нужно для копирования и вставки.
 */
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  e.preventDefault();
});

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
}

boot();
