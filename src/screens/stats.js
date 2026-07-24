/** Личная статистика — несоревновательная замена лидербордам. */

import { el } from '../ui.js';
import { t, pluralWord } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';

/**
 * Личная статистика без времени: сложность партий случайная, поэтому «лучшее»
 * и «среднее» время сравнивали бы несравнимое. Показываем то, что от размера
 * сетки не зависит и честно накапливается.
 */
export function renderStats(ctx) {
  const s = saves.stats;

  const body = s.solved === 0
    ? el('p.tagline', { style: { textAlign: 'center', marginTop: '24px' } }, t('noStats'))
    : el('div.stats-list', {}, [
        row(t('solvedCount'), `${s.solved}`),
        row(t('wordsSolved'), `${s.words}`),
        row(t('noHintsSolved'), `${s.noHints}`),
        row(t('dayStreak'), `${saves.streakDays} ${pluralWord(saves.streakDays, 'dayForms')}`),
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
