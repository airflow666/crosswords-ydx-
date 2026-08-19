/**
 * Выбор темы для тематического кроссворда.
 *
 * У каждой плитки свой оттенок (`hue` в `dict/index.js`) и счётчик решённых —
 * он же подсказывает, где у игрока пробел: достижение «решить кроссворд в
 * каждой теме» без такой подсказки превращается в перебор наугад.
 */

import { el, confirm } from '../ui.js';
import { t } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { newSeed } from '../game/rng.js';
import { THEMES } from '../game/dict/index.js';

export function renderThemes(ctx) {
  const byTheme = saves.stats.byTheme || {};

  const screen = el('div.screen', {}, [
    el('div.screen-head', {}, [
      el('button.icon-btn', { onclick: () => ctx.go('menu'), 'aria-label': t('back') }, '‹'),
      el('h2', {}, t('chooseTheme')),
    ]),
    el('div.theme-grid', {}, THEMES.map((th) => {
      const n = byTheme[th.id] || 0;
      return el('button.theme-tile', {
        onclick: () => start(th.id),
        style: { '--tile-hue': String(th.hue) },
      }, [
        el('span.theme-ico', {}, th.icon),
        el('span.theme-name', {}, th.title),
        el('span.theme-count' + (n ? '.on' : ''), {}, n ? `решено: ${n}` : 'ещё не решали'),
      ]);
    })),
  ]);

  ctx.mount(screen);

  async function start(themeId) {
    const cur = saves.getCurrent();
    if (cur) {
      const proceed = await confirm({
        title: '🧩',
        text: t('dropCurrentAsk'),
        confirm: t('dropCurrentYes'),
        cancel: t('dropCurrentNo'),
        danger: true,
      });
      if (!proceed) return;
      saves.clearCurrent();
    }
    ctx.go('game', { mode: 'theme', theme: themeId, seed: newSeed() });
  }
}
