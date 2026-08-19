/**
 * Личная статистика: что накопилось за всё время.
 *
 * Экран не прокручивается, а показать нужно девятнадцать чисел, поэтому вместо
 * длинного списка «подпись — значение» здесь плитки: крупное число сверху,
 * мелкая подпись снизу. Так те же данные занимают втрое меньше высоты и
 * читаются быстрее — глаз цепляется за цифру, а не ищет её в конце строки.
 *
 * Времени в статистике нет намеренно: кроссворд у каждого свой и разного
 * размера, поэтому «лучшее» и «среднее» время сравнивали бы несравнимое.
 */

import { el } from '../ui.js';
import { t, pluralWord } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { MODES } from '../game/modes.js';
import { THEMES } from '../game/dict/index.js';

export function renderStats(ctx) {
  const s = saves.stats;
  const byTheme = s.byTheme || {};
  const byMode = s.byMode || {};
  const themesTried = Object.values(byTheme).filter((n) => n > 0).length;

  const body = s.solved === 0
    ? el('div.fill.center', { style: { justifyContent: 'center' } },
        el('p.tagline', {}, t('noStats')))
    : el('div.fill', {}, [
        el('div.stat-grid.main', {}, [
          cell(String(s.solved), t('solvedCount')),
          cell(String(s.words), t('wordsSolved')),
          cell(String(saves.uniqueWordCount), t('uniqueWords')),
          cell(String(s.noHints), t('noHintsSolved')),
          cell(String(saves.streakDays), `${t('dayStreak')}, ${pluralWord(saves.streakDays, 'dayForms')}`),
          cell(String(saves.bestStreakDays), `${t('bestStreak')}, ${pluralWord(saves.bestStreakDays, 'dayForms')}`),
          cell(`${themesTried}/${THEMES.length}`, t('themeMode')),
        ]),

        el('h3.stats-sub', {}, t('modes')),
        el('div.stat-grid.modes', {}, ['easy', 'hard', 'theme', 'daily'].map((m) =>
          cell(String(byMode[m] || 0), MODES[m].title, MODES[m].icon))),

        el('h3.stats-sub', {}, t('themeMode')),
        el('div.stat-grid.themes', {}, THEMES.map((th) =>
          cell(String(byTheme[th.id] || 0), th.title, th.icon))),
      ]);

  const screen = el('div.screen', {}, [
    el('div.screen-head', {}, [
      el('button.icon-btn', { onclick: () => ctx.go('menu'), 'aria-label': t('back') }, '‹'),
      el('h2', {}, t('stats')),
    ]),
    body,
  ]);
  ctx.mount(screen);

  function cell(value, label, icon) {
    return el('div.stat-cell' + (Number(value) > 0 || value.includes('/') ? '.on' : ''), {}, [
      icon ? el('span.stat-cell-ico', {}, icon) : null,
      el('span.stat-cell-num', {}, value),
      el('span.stat-cell-label', {}, label),
    ]);
  }
}
