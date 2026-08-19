/**
 * Всплывающее уведомление о достижении — то самое, «как на Xbox»: плашка
 * выезжает сверху, коротко светится и уходит.
 *
 * Уведомления идут ОЧЕРЕДЬЮ. За одну победу можно закрыть сразу несколько
 * достижений (например, десятый кроссворд и третий день серии), и показать их
 * одновременно нельзя: две плашки на одном месте — это не праздник, а мусор.
 * Поэтому следующая ждёт, пока уйдёт предыдущая.
 *
 * Свечение и движение живут в CSS (`.ach-toast`), здесь только очередь и тайминги.
 * При системной настройке «уменьшить движение» анимацию гасит медиазапрос в
 * стилях — плашка всё равно появится, просто без выезда.
 */

import { el } from '../ui.js';
import { audio } from '../systems/audio.js';
import { TIERS } from '../systems/achievements.js';

const SHOW_MS = 3600;      // сколько плашка висит
const GAP_MS = 260;        // пауза между соседними плашками

const queue = [];
let running = false;
let host = null;

function ensureHost() {
  if (host && host.isConnected) return host;
  host = el('div.ach-toast-host');
  document.body.appendChild(host);
  return host;
}

/** Поставить достижения в очередь показа. */
export function showAchievements(list) {
  if (!list || !list.length) return;
  queue.push(...list);
  if (!running) pump();
}

async function pump() {
  running = true;
  while (queue.length) {
    await showOne(queue.shift());
    await wait(GAP_MS);
  }
  running = false;
  // Пустой контейнер в разметке не держим: он перехватывал бы клики в углу
  // экрана, если бы когда-нибудь получил размеры.
  host?.remove();
  host = null;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function showOne(ach) {
  return new Promise((resolve) => {
    const node = el(`div.ach-toast.tier-${ach.tierId}${ach.style === 'streak' ? '.streak' : ''}`, {}, [
      el('div.ach-toast-badge', {}, [
        el('span.ach-toast-icon', {}, ach.icon),
        el('i.ach-toast-shine'),
      ]),
      el('div.ach-toast-text', {}, [
        el('div.ach-toast-kicker', {}, `Достижение · ${TIERS[ach.tier].title}`),
        el('div.ach-toast-title', {}, ach.title),
      ]),
    ]);
    ensureHost().appendChild(node);
    audio.achievement?.();

    // Класс появления вешаем следующим кадром: иначе браузер применит начальное
    // и конечное состояние в одной перерисовке и анимации не будет вовсе.
    requestAnimationFrame(() => node.classList.add('in'));

    setTimeout(() => {
      node.classList.remove('in');
      node.classList.add('out');
      setTimeout(() => { node.remove(); resolve(); }, 300);
    }, SHOW_MS);
  });
}
