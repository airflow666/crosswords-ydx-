/** Личная статистика — несоревновательная замена лидербордам. */

import { el } from '../ui.js';
import { t, pluralWord } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';

function fmtTime(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function renderStats(ctx) {
  const s = saves.stats;
  const avg = s.solved > 0 ? Math.round(s.totalTimeSec / s.solved) : null;

  const body = s.solved === 0
    ? el('p.tagline', { style: { textAlign: 'center', marginTop: '24px' } }, t('noStats'))
    : el('div.stats-list', {}, [
        row(t('solvedCount'), `${s.solved}`),
        row(t('dayStreak'), `${saves.streakDays} ${pluralWord(saves.streakDays, 'dayForms')}`),
        row(t('bestTime'), fmtTime(s.bestTimeSec)),
        row(t('avgTime'), fmtTime(avg)),
      ]);

  const screen = el('div.screen', {}, [
    el('div.screen-head', {}, [
      el('button.icon-btn', { onclick: () => ctx.go('menu'), 'aria-label': t('back') }, '‹'),
      el('h2', {}, t('stats')),
    ]),
    body,
  ]);
  ctx.mount(screen);

  function row(k, v) {
    return el('div.stat-row', {}, [el('span.k', {}, k), el('span.v', {}, v)]);
  }
}
