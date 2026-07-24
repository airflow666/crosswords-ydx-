/** Экран результатов: спокойные итоги партии, без рекламы. */

import { el } from '../ui.js';
import { celebrate } from '../ui/confetti.js';
import { t } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { ads } from '../systems/ads.js';
import { newSeed } from '../game/rng.js';
import { randomLevel } from '../game/generator.js';

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Рекорда времени здесь нет намеренно: сложность каждой партии случайная, и
// сравнивать время на сетке 7×7 и 11×11 бессмысленно. Время текущей партии
// показываем просто как факт, ни с чем не соревнуясь.
export function renderResults(ctx, { crossword, timeSec }) {
  const hints = crossword.hintsUsed;

  const box = el('div.modal', {}, [
    el('h2', {}, '🎉 ' + t('solved')),
    el('div', { style: { marginTop: '14px' } }, [
      row(t('yourTime'), fmtTime(timeSec)),
      row(t('wordsInGrid'), String(crossword.slots.length)),
      row(t('hintsUsed'), `${hints} / ${crossword.hintsLeft + hints}`),
      row(t('solvedCount'), String(saves.stats.solved)),
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

  // Салют — один короткий залп на появление экрана.
  const stopConfetti = celebrate(screen);
  screen._cleanup = stopConfetti;

  function row(k, v) {
    return el('div.stat-row', {}, [el('span.k', {}, k), el('span.v', {}, v)]);
  }

  // Реклама после победы — в естественной паузе, с кулдауном (не ломает игру при отказе).
  // Сложность следующего кроссворда — снова случайная (а не «та же, что была»):
  // игрок её нигде не выбирает, и залипать на одном размере сетки не должен.
  async function playNext() {
    await ads.maybeShowInterstitial();
    ctx.go('game', { seed: newSeed(), level: randomLevel() });
  }
}
