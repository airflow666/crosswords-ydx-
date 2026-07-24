/** Главное меню: новая игра (случайная сложность), продолжение, статистика, тема, звук. */

import { el, applyTheme, nextTheme } from '../ui.js';
import { t } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { audio } from '../systems/audio.js';
import { ads } from '../systems/ads.js';
import { newSeed } from '../game/rng.js';
import { LEVELS } from '../game/generator.js';

// Небольшая эмблема-мини-кроссворд, нарисованная кодом (без внешних картинок).
const EMBLEM = [1, 0, 1, 1, 1, 1, 1, 0, 1];
const LEVEL_IDS = Object.keys(LEVELS);

/** Случайный уровень сложности — игрок его не выбирает (подсказки компенсируют трудность). */
function randomLevel() {
  return LEVEL_IDS[Math.floor(Math.random() * LEVEL_IDS.length)];
}

export function renderMenu(ctx) {
  const current = saves.getCurrent();

  const themeBtn = el('button.icon-btn', { onclick: onTheme, 'aria-label': t('theme') }, themeIcon());
  const soundBtn = el('button.icon-btn', { onclick: onSound, 'aria-label': t('sound') }, saves.soundOn ? '🔊' : '🔈');

  const actions = [el('button.btn.primary.big', { onclick: startNew }, current ? t('newGame') : t('play'))];
  if (current) {
    actions.push(el('button.btn.big', { onclick: continueGame }, t('continueGame')));
  }
  actions.push(el('button.btn', { onclick: () => ctx.go('stats') }, t('stats')));

  const screen = el('div.screen.menu', {}, [
    el('div.topbar', {}, [themeBtn, soundBtn]),
    el('div.menu-emblem', {}, EMBLEM.map((on) => el('i' + (on ? '.on' : '')))),
    el('h1.logo', {}, t('title')),
    el('p.tagline', {}, t('subtitle')),
    el('div.actions', {}, actions),
  ]);

  ctx.mount(screen);

  // Обязательный для модерации сигнал платформе: игра загрузилась. Ровно один раз.
  ctx.sdk.loadingReady();

  // Новая игра случайной сложности. Если бросаем незаконченную партию — показываем
  // рекламу (естественная пауза). При чистом старте (нет партии) рекламы нет.
  async function startNew() {
    const abandoning = !!saves.getCurrent();
    saves.clearCurrent();
    if (abandoning) await ads.maybeShowInterstitial();
    ctx.go('game', { seed: newSeed(), level: randomLevel() });
  }

  function continueGame() {
    ctx.go('game', { seed: current.seed, level: current.level, restore: current });
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
    const theme = nextTheme(saves.theme);
    saves.setTheme(theme);
    applyTheme(theme);
    themeBtn.textContent = themeIcon();
  }
}
