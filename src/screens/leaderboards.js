/**
 * Лидерборды: достижения и серия дней.
 *
 * Обе таблицы — про регулярность, а не про скорость: кроссворд у каждого свой,
 * и сравнивать время решения было бы нечестно (см. `systems/leaderboards.js`).
 *
 * Экран не прокручивается, поэтому число строк не выбирается наугад: сначала
 * меряем, сколько их помещается в отведённую высоту, и ровно столько и просим у
 * площадки. Запросить два десятка и обрезать лишнее прокруткой нельзя.
 *
 * Гостю площадка результатов не отдаёт. Это не ошибка и не повод для пустого
 * экрана: так и пишем — «видны только авторизованным», — иначе человек решит,
 * что таблица сломана.
 */

import { el } from '../ui.js';
import { t } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { BOARDS } from '../systems/leaderboards.js';

// Ниже этой высоты строка таблицы уже нечитаема.
const ROW_MIN_PX = 34;
// Разумные границы запроса: одна строка — не таблица, три десятка — не влезет.
const ROWS_MIN = 5;
const ROWS_MAX = 30;

export function renderLeaderboards(ctx) {
  let alive = true;
  let active = BOARDS[0].name;

  const tabs = el('div.lb-tabs');
  const body = el('div.lb-body');

  const screen = el('div.screen', {}, [
    el('div.screen-head', {}, [
      el('button.icon-btn', { onclick: () => ctx.go('achievements'), 'aria-label': t('back') }, '‹'),
      el('h2', {}, t('leaderboards')),
    ]),
    tabs,
    body,
  ]);

  ctx.mount(screen);
  screen._cleanup = () => { alive = false; };

  drawTabs();
  load();

  function drawTabs() {
    tabs.replaceChildren(...BOARDS.map((b) =>
      el('button.lb-tab' + (b.name === active ? '.on' : ''), {
        onclick: () => { active = b.name; drawTabs(); load(); },
      }, [el('span', {}, b.icon), b.title])
    ));
  }

  /** Сколько строк поместится в оставшуюся высоту экрана. */
  function fittingRows() {
    const h = body.clientHeight;
    if (!h) return 10;   // до первой раскладки берём разумное значение
    // Из высоты вычитаем плашку своего результата и поля списка.
    const usable = h - 56;
    return Math.max(ROWS_MIN, Math.min(ROWS_MAX, Math.floor(usable / ROW_MIN_PX)));
  }

  async function load() {
    const board = BOARDS.find((b) => b.name === active);
    body.replaceChildren(el('div.lb-loading', {}, t('loading')));

    const quantity = fittingRows();
    const { entries } = await ctx.sdk.leaderboardEntries(active, quantity);
    if (!alive) return;

    // Свой результат показываем всегда — даже когда таблица недоступна: игрок
    // должен видеть, с чем он в ней окажется, когда авторизуется.
    const mine = el('div.lb-mine', {}, [
      el('span.lb-mine-label', {}, 'Ваш результат'),
      el('span.lb-mine-value', {}, String(board.value(saves))),
    ]);

    if (!entries.length) {
      body.replaceChildren(mine, el('p.tagline.center', {}, t('leaderboardGuest')));
      return;
    }

    const rows = entries.slice(0, quantity);
    const list = el('div.lb-list', {}, rows.map((e) =>
      el('div.lb-row' + (e.isUser ? '.me' : ''), {}, [
        el('span.lb-rank', {}, String(e.rank)),
        el('span.lb-name', {}, e.name || 'Игрок'),
        el('span.lb-score', {}, String(e.score)),
      ])
    ));
    // Строки делят высоту списка поровну — так он всегда занимает ровно
    // отведённое место, без пустого хвоста и без обрезанной последней строки.
    list.style.gridTemplateRows = `repeat(${rows.length}, 1fr)`;
    body.replaceChildren(mine, list);
  }
}
