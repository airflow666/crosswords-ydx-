/**
 * Точка входа. Инициализирует SDK и сохранения, применяет тему,
 * запускает роутер экранов. Реагирует на сворачивание вкладки (пауза/звук).
 */

import './styles.css';
import { initSDK } from './yandex/sdk.js';
import { saves } from './systems/saves.js';
import { ads } from './systems/ads.js';
import { audio } from './systems/audio.js';
import { el, applyTheme } from './ui.js';
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
    document.querySelectorAll('.palette, .palette-backdrop, .overlay, .toast').forEach((n) => n.remove());
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

async function boot() {
  showLoader();
  const sdk = await initSDK();
  ctx.sdk = sdk;

  // Игра только на русском — язык из SDK не используем.
  await saves.load(sdk);
  applyTheme(saves.theme);
  audio.setEnabled(saves.soundOn);
  ads.init(sdk);

  // Пауза/звук при сворачивании вкладки (требование модерации).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      sdk.gameplayStop();
      audio.muteForAd();
    } else {
      audio.unmuteAfterAd();
    }
  });

  ctx.go('menu');
}

boot();
