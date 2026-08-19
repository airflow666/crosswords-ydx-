/**
 * Календарь серии: какие дни закрыты, какие пропущены, и восстановление
 * пропущенного дня за просмотр рекламы.
 *
 * Восстанавливать предлагаем не любой день, а только тот, что реально рвёт
 * серию (см. `restorableDays` в `systems/daily.js`), и не чаще одного в сутки.
 * Иначе серию любой длины можно было бы отстроить за вечер, и она перестала бы
 * что-либо значить — ни как награда, ни как повод вернуться завтра.
 */

import { el, modal, toast, confirm } from '../ui.js';
import { t, pluralWord } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { ads } from '../systems/ads.js';
import { publishScores } from '../systems/leaderboards.js';
import { showAchievements } from '../ui/achievementToast.js';
import { achievementById } from '../systems/achievements.js';
import {
  today, dayToDate, monthGrid, restorableDays,
  MONTH_NAMES, WEEKDAY_SHORT,
} from '../systems/daily.js';

export function openCalendar(ctx, { onChanged } = {}) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let changed = false;

  const body = el('div.cal-body');
  const headText = el('div.cal-month');
  const streakLine = el('div.cal-streak');

  const box = el('div.modal.cal-modal', {}, [
    el('div.cal-head', {}, [
      el('button.icon-btn.sm', { onclick: () => shift(-1), 'aria-label': 'Предыдущий месяц' }, '‹'),
      headText,
      el('button.icon-btn.sm', { onclick: () => shift(1), 'aria-label': 'Следующий месяц' }, '›'),
    ]),
    streakLine,
    el('div.cal-week', {}, WEEKDAY_SHORT.map((d) => el('span', {}, d))),
    body,
    el('div.cal-legend', {}, [
      legend('solved', t('calendarLegendSolved')),
      legend('missed', t('calendarLegendMissed')),
      legend('today', t('calendarLegendToday')),
    ]),
    el('p.cal-rule', {}, t('streakRule')),
    el('div.actions', {}, [
      el('button.btn', { onclick: () => close() }, t('close')),
    ]),
  ]);

  const ov = modal(box, { closable: true, onClose: () => { if (changed) onChanged?.(); } });
  draw();

  function close() {
    ov.close();
  }

  function legend(kind, text) {
    return el('span.cal-legend-item', {}, [el(`i.cal-dot.${kind}`), text]);
  }

  function shift(delta) {
    month += delta;
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
    draw();
  }

  function draw() {
    headText.textContent = `${MONTH_NAMES[month]} ${year}`;

    const streak = saves.streakDays;
    streakLine.textContent = streak > 0
      ? `🔥 ${streak} ${pluralWord(streak, 'dayForms')} подряд`
      : t('streakNone');

    const now2 = today();
    const restorable = new Set(restorableDays(saves.solvedDays, now2));

    body.replaceChildren(
      ...monthGrid(year, month).map((day) => {
        if (day === null) return el('span.cal-cell.empty');
        const date = dayToDate(day);
        const solved = saves.isDaySolved(day);
        const isToday = day === now2;
        const future = day > now2;
        const canRestore = restorable.has(day);

        const cls = [
          'button.cal-cell',
          solved ? 'solved' : '',
          isToday ? 'today' : '',
          future ? 'future' : '',
          canRestore ? 'restorable' : '',
        ].filter(Boolean).join('.');

        return el(cls, canRestore ? { onclick: () => askRestore(day) } : {}, [
          String(date.getDate()),
          canRestore ? el('i.cal-plus', {}, '+') : null,
        ]);
      })
    );
  }

  /** Предложить восстановить пропуск. Награда — только после досмотренного ролика. */
  async function askRestore(day) {
    if (!saves.canRestoreDay) { toast(t('restoreUsedToday')); return; }
    const date = dayToDate(day);
    const proceed = await confirm({
      title: '🔥',
      text: `${date.getDate()} ${MONTH_NAMES[date.getMonth()].toLowerCase()}. ${t('restoreAsk')}`,
      confirm: t('watch'),
      cancel: t('cancel'),
    });
    if (!proceed) return;

    const rewarded = await ads.showRewarded();
    if (!rewarded) { toast(t('adUnavailable')); return; }
    if (!saves.restoreDay(day)) { toast(t('restoreUsedToday')); return; }

    changed = true;
    toast(t('restoreDone'));
    // Серия выросла — могли закрыться достижения этой группы.
    const fresh = saves.syncAchievements();
    if (fresh.length) showAchievements(fresh.map(achievementById).filter(Boolean));
    publishScores(ctx.sdk, saves);
    draw();
  }
}
