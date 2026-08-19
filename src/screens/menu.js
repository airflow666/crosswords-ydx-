/**
 * Главный экран: кроссворд дня, серия, режимы, магазин и достижения.
 *
 * Порядок блоков сверху вниз — это порядок по важности для возвращаемости.
 * Первым идёт кроссворд дня: он единственный привязан к календарю и даёт повод
 * зайти завтра. Сразу под ним — серия, чтобы игрок видел, что именно он теряет,
 * если пропустит. Дальше режимы, и только в самом низу — магазин и достижения:
 * это разделы «на потом», и отнимать у них верх экрана незачем.
 *
 * Здесь намеренно НЕ импортируется ни генератор, ни словарь. Главное меню —
 * первое, что видит игрок, и площадка засекает время именно до его появления;
 * всё тяжёлое подгружается при переходе в партию.
 */

import { el, applyTheme, nextTheme, confirm } from '../ui.js';
import { t, pluralWord } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { audio } from '../systems/audio.js';
import { newSeed } from '../game/rng.js';
import { MODES, themeOfDay } from '../game/modes.js';
import { themeById } from '../game/dict/index.js';
import { dateKey, today } from '../systems/daily.js';
import { openCalendar } from './calendar.js';

// Небольшая эмблема-мини-кроссворд, нарисованная кодом (без внешних картинок).
const EMBLEM = [1, 0, 1, 1, 1, 1, 1, 0, 1];

const MONTH_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export function renderMenu(ctx) {
  const current = saves.getCurrent();
  const streak = saves.streakDays;
  const dayTheme = themeById(themeOfDay(dateKey()));
  const dailyDone = saves.solvedToday;

  const themeBtn = el('button.icon-btn', { onclick: onTheme, 'aria-label': t('theme') }, themeIcon());
  const soundBtn = el('button.icon-btn', { onclick: onSound, 'aria-label': t('sound') }, saves.soundOn ? '🔊' : '🔈');

  const screen = el('div.screen.menu', {}, [
    el('div.topbar', {}, [themeBtn, soundBtn]),

    el('div.menu-head', {}, [
      el('div.menu-emblem.small', {}, EMBLEM.map((on) => el('i' + (on ? '.on' : '')))),
      el('h1.logo', {}, t('title')),
    ]),

    // Кроссворд дня и серия — один блок: это про одну и ту же привычку
    // заходить каждый день, и врозь они читались как два случайных виджета.
    el('div.daily-block', {}, [dailyCard(), streakChip()]),
    ...(current ? [continueCard(current)] : []),

    el('div.mode-list', {}, [
      modeButton(MODES.easy, () => startMode('easy')),
      modeButton(MODES.hard, () => startMode('hard')),
      modeButton(MODES.theme, () => ctx.go('themes'), true, true),
    ]),

    // Три плитки, а не две. Экран статистики был написан и подключён к
    // роутеру, но попасть на него было неоткуда: `go('stats')` не вызывался
    // ни из одного места игры.
    el('div.menu-bottom', {}, [
      el('button.btn.tile-btn', { onclick: () => ctx.go('shop') }, [
        el('span.tile-ico', {}, '🛒'), el('span', {}, t('shop')),
      ]),
      el('button.btn.tile-btn', { onclick: () => ctx.go('achievements') }, [
        el('span.tile-ico', {}, '🏆'), el('span', {}, t('achievements')),
      ]),
      el('button.btn.tile-btn', { onclick: () => ctx.go('stats') }, [
        el('span.tile-ico', {}, '📊'), el('span', {}, t('stats')),
      ]),
    ]),
  ]);

  ctx.mount(screen);

  // Обязательный для модерации сигнал платформе: игра загрузилась. Ровно один раз.
  ctx.sdk.loadingReady();

  /**
   * Плашка серии. Она же — вход в календарь: игрок, у которого серия прервалась,
   * первым делом тычет именно в неё, а не ищет отдельную кнопку.
   */
  function streakChip() {
    const has = streak > 0;
    return el('button.streak-chip' + (has ? '.on' : ''), { onclick: showCalendar }, [
      el('span.streak-flame', {}, '🔥'),
      el('span.streak-num', {}, String(streak)),
      el('span.streak-text', {}, has
        ? `${pluralWord(streak, 'dayForms')} подряд`
        : t('streakNone')),
      el('span.streak-go', {}, '›'),
    ]);
  }

  /**
   * Карточка кроссворда дня. Пока он не решён — это кнопка «играть», после
   * решения — вход в календарь: второй раз тот же кроссворд не выдаётся, а вот
   * закрыть пропуск в серии игроку как раз может понадобиться.
   */
  function dailyCard() {
    const d = new Date();
    const dateLine = `${d.getDate()} ${MONTH_GENITIVE[d.getMonth()]} · ${dayTheme.title}`;
    return el('button.daily-card' + (dailyDone ? '.done' : ''), {
      onclick: dailyDone ? showCalendar : () => startMode('daily'),
    }, [
      el('div.daily-ico', {}, dailyDone ? '✓' : '📅'),
      el('div.daily-text', {}, [
        el('div.daily-title', {}, t('dailyTitle')),
        el('div.daily-sub', {}, dateLine),
      ]),
      el('div.daily-action', {}, dailyDone ? '›' : '▶'),
    ]);
  }

  function continueCard(cur) {
    const mode = MODES[cur.mode] || MODES.easy;
    const th = cur.theme ? themeById(cur.theme) : null;
    return el('button.continue-card', { onclick: () => continueGame(cur) }, [
      el('span.continue-ico', {}, th ? th.icon : mode.icon),
      el('span.continue-text', {}, [
        el('b', {}, t('continueGame')),
        el('span', {}, th ? th.title : mode.title),
      ]),
      el('span.continue-go', {}, '›'),
    ]);
  }

  function modeButton(mode, onclick, chevron = false, wide = false) {
    return el('button.mode-btn' + (wide ? '.wide' : ''), { onclick }, [
      el('span.mode-ico', {}, mode.icon),
      el('span.mode-text', {}, [
        el('b', {}, mode.title),
        el('span', {}, mode.hint),
      ]),
      chevron ? el('span.mode-go', {}, '›') : null,
    ]);
  }

  function showCalendar() {
    openCalendar(ctx, { onChanged: () => ctx.go('menu') });
  }

  /**
   * Старт режима. Незаконченная партия своя у каждого режима не хранится (в
   * сохранении она одна), поэтому переход в другой режим — это отказ от начатой
   * партии, и спросить об этом надо явно.
   */
  async function startMode(mode) {
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
    // Кроссворд дня один и тот же у всех и не меняется в течение суток,
    // поэтому seed у него от даты, а не случайный.
    const seed = mode === 'daily' ? undefined : newSeed();
    ctx.go('game', { mode, seed, day: mode === 'daily' ? today() : undefined });
  }

  function continueGame(cur) {
    ctx.go('game', {
      mode: cur.mode,
      theme: cur.theme,
      seed: cur.seed,
      day: cur.mode === 'daily' ? today() : undefined,
      restore: cur,
    });
  }

  function onSound() {
    const on = saves.toggleSound();
    audio.setEnabled(on);
    soundBtn.textContent = on ? '🔊' : '🔈';
  }

  function themeIcon() {
    return saves.theme === 'light' ? '☀️' : saves.theme === 'dark' ? '🌙' : '🌗';
  }

  function onTheme() {
    const next = nextTheme(saves.theme);
    saves.setTheme(next);
    applyTheme(next);
    themeBtn.textContent = themeIcon();
  }
}
