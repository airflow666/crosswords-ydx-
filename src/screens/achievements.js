/**
 * Раздел достижений.
 *
 * Главное ограничение экрана — он не прокручивается: двадцать пять значков
 * обязаны поместиться целиком на любом телефоне. Отсюда устройство: семь групп
 * — семь строк, делящих высоту поровну; в строке заголовок с текущим счётом,
 * подсказка «сколько осталось до следующей ступени» и ряд значков по числу
 * ступеней. Подписи под каждым значком не поместились бы никогда, поэтому
 * название, описание и прогресс открываются по тапу.
 *
 * Полученное и неполученное различаются не подписью, а видом: полученное —
 * в цвете своей ступени, неполученное — единым монохромом. Разница читается
 * мгновенно и не зависит от того, какая именно ступень пропущена.
 *
 * Группа «Серия дней» стоит первой, значки у неё круглые, а подложка тёплая:
 * это главный механизм возвращаемости, и он не должен теряться среди прочих
 * медалей.
 */

import { el, modal } from '../ui.js';
import { t, pluralWord } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { GROUPS, ALL, TIERS, TOTAL_COUNT, progressOf } from '../systems/achievements.js';

export function renderAchievements(ctx) {
  const snapshot = saves.progressSnapshot();
  const unlocked = new Set(saves.unlockedAchievements);
  const have = ALL.filter((a) => unlocked.has(a.id)).length;

  const screen = el('div.screen', {}, [
    el('div.screen-head', {}, [
      el('button.icon-btn', { onclick: () => ctx.go('menu'), 'aria-label': t('back') }, '‹'),
      el('h2', {}, t('achievements')),
      el('button.btn.ghost.sm', { onclick: () => ctx.go('leaderboards'), 'aria-label': t('leaderboards') }, '🏆'),
    ]),

    el('div.ach-summary', {}, [
      el('div.ach-summary-num', {}, `${have} / ${TOTAL_COUNT}`),
      el('div.ach-summary-text', {}, `${t('achievementsOf')} ${pluralWord(have, 'achievementForms')}`),
      el('div.progress-bar.wide', {}, el('i', {
        style: { width: `${Math.round((have / TOTAL_COUNT) * 100)}%` },
      })),
    ]),

    el('div.ach-groups', {}, GROUPS.map(groupBlock)),
  ]);

  ctx.mount(screen);

  function groupBlock(g) {
    const items = ALL.filter((a) => a.group === g.id);
    const done = items.filter((a) => unlocked.has(a.id)).length;
    // Подсказка про следующую ступень полезнее описания группы: она отвечает на
    // единственный вопрос, который у игрока в этот момент есть, — что дальше.
    const next = items.find((a) => !unlocked.has(a.id));
    const hint = next
      ? `до «${next.title}»: ${progressOf(next, snapshot).value} из ${next.goal}`
      : 'всё собрано';

    return el('section.ach-group' + (g.style === 'streak' ? '.streak-group' : ''), {}, [
      el('header.ach-group-head', {}, [
        el('span.ach-group-ico', {}, g.icon),
        el('span.ach-group-title', {}, g.title),
        el('span.ach-group-next', {}, hint),
        el('span.ach-group-count', {}, `${done}/${items.length}`),
      ]),
      el('div.ach-row', {}, items.map(badge)),
    ]);
  }

  function badge(a) {
    const got = unlocked.has(a.id);
    return el(
      `button.ach-badge.tier-${a.tierId}${got ? '.got' : '.locked'}`,
      { onclick: () => showDetail(a, got), 'aria-label': a.title },
      el('span.ach-badge-ico', {}, a.icon)
    );
  }

  /** Подробности одного достижения — то, чему не нашлось места в ряду значков. */
  function showDetail(a, got) {
    const p = progressOf(a, snapshot);
    const pct = Math.round((p.value / p.goal) * 100);
    const box = el('div.modal.ach-detail' + (a.style === 'streak' ? '.streak' : ''), {}, [
      el(`div.ach-detail-badge.tier-${a.tierId}${got ? '.got' : '.locked'}`, {}, a.icon),
      el('div.ach-detail-tier', {}, TIERS[a.tier].title),
      el('div.ach-detail-name', {}, a.title),
      el('div.ach-detail-desc', {}, a.desc),
      got
        ? null
        : el('div.ach-detail-progress', {}, [
            el('div.progress-bar.wide', {}, el('i', { style: { width: `${pct}%` } })),
            el('span.ach-detail-num', {}, `${p.value} / ${p.goal}`),
          ]),
      el('div.actions', {}, [
        el('button.btn', { onclick: () => ov.close() }, t('close')),
      ]),
    ]);
    const ov = modal(box, { closable: true });
  }
}
