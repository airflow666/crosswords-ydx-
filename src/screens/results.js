/** Экран результатов: спокойные итоги партии, без рекламы. */

import { el } from '../ui.js';
import { t } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { ads } from '../systems/ads.js';
import { newSeed } from '../game/rng.js';

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function renderResults(ctx, { crossword, timeSec, isBest, level = 'medium' }) {
  const hints = crossword.hintsUsed;
  const best = saves.stats.bestTimeSec;

  const box = el('div.modal', {}, [
    el('h2', {}, '🎉 ' + t('solved')),
    isBest ? el('div.badge-best', {}, t('newBest')) : null,
    el('div', { style: { marginTop: '14px' } }, [
      row(t('yourTime'), fmtTime(timeSec)),
      row(t('hintsUsed'), `${hints} / ${crossword.hintsLeft + hints}`),
      row(t('bestTime'), best != null ? fmtTime(best) : '—'),
    ]),
    el('div.actions', {}, [
      el('button.btn.primary.big', { onclick: playNext }, t('newCrossword')),
      el('button.btn.ghost', { onclick: () => ctx.go('menu') }, t('menu')),
    ]),
  ]);

  // Не оборачиваем в .overlay: это отдельный полноценный экран (mount() уже
  // убрал игровую сетку из DOM), а не всплывающая модалка поверх неё — иначе
  // затемняющий фон .overlay рисуется поверх пустоты и выглядит грязным пятном.
  const screen = el('div.screen.results-screen', {}, box);
  ctx.mount(screen);

  function row(k, v) {
    return el('div.stat-row', {}, [el('span.k', {}, k), el('span.v', {}, v)]);
  }

  // Реклама после победы — в естественной паузе, с кулдауном (не ломает игру при отказе).
  async function playNext() {
    await ads.maybeShowInterstitial();
    ctx.go('game', { seed: newSeed(), level });
  }
}
