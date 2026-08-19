/** Экран результатов: итоги партии, достижения, переход к следующему кроссворду. */

import { el, toast } from '../ui.js';
import { celebrate } from '../ui/confetti.js';
import { showAchievements } from '../ui/achievementToast.js';
import { t, pluralWord } from '../systems/i18n.js';
import { saves } from '../systems/saves.js';
import { ads } from '../systems/ads.js';
import { achievementById } from '../systems/achievements.js';
import { publishScores } from '../systems/leaderboards.js';
import { newSeed } from '../game/rng.js';

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * После скольких решённых кроссвордов уместно предложить оценку. Просить с
 * первой же победы рано: игрок ещё не понял, нравится ли ему игра, а спросить
 * площадка разрешает один раз за сессию — потратить эту попытку впустую жалко.
 */
const REVIEW_AFTER_SOLVED = 3;

export function renderResults(ctx, { crossword, plan, timeSec, freshAchievements = [] }) {
  let alive = true;   // экран ещё на месте (см. асинхронную кнопку оценки ниже)
  const streak = saves.streakDays;

  // Кнопка появляется не сразу: сначала спрашиваем площадку, можно ли вообще
  // предлагать оценку. До ответа её в разметке нет.
  const rateBtn = el('button.btn.ghost.rate-btn', { onclick: onRate, hidden: true }, '⭐ ' + t('rateGame'));

  const box = el('div.modal', {}, [
    el('h2', {}, '🎉 ' + t('solved')),
    el('p.results-mode', {}, `${plan.icon} ${plan.title}`),
    el('div', { style: { marginTop: '14px' } }, [
      row(t('yourTime'), fmtTime(timeSec)),
      row(t('wordsInGrid'), String(crossword.slots.length)),
      row(t('hintsUsed'), String(crossword.boostersUsed)),
      row(t('dayStreak'), `${streak} ${pluralWord(streak, 'dayForms')}`),
      row(t('solvedCount'), String(saves.stats.solved)),
    ]),
    el('div.actions', {}, [
      el('button.btn.primary.big', { onclick: playNext }, t('newCrossword')),
      rateBtn,
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
  screen._cleanup = () => { alive = false; stopConfetti(); };

  // Достижения показываем ПОСЛЕ салюта: две анимации разом читаются как сбой,
  // а не как праздник. Задержка заодно даёт игроку заметить сам факт победы.
  if (freshAchievements.length) {
    setTimeout(() => {
      if (alive) showAchievements(freshAchievements.map(achievementById).filter(Boolean));
    }, 900);
  }

  // Результаты в лидерборды отправляем молча и не дожидаясь ответа: игроку на
  // экране победы важен сам факт победы, а не сетевой запрос.
  publishScores(ctx.sdk, saves);

  maybeOfferReview();

  function row(k, v) {
    return el('div.stat-row', {}, [el('span.k', {}, k), el('span.v', {}, v)]);
  }

  /**
   * Предложить оценить игру — только здесь, на экране победы.
   *
   * Почему именно так, а не «при входе» или «после каждого клика»: окно оценки
   * площадка разрешает открыть один раз за сессию и только после успешного
   * `canReview()`. Значит момент надо выбирать, а не тратить попытку наугад.
   * Победа — единственная точка в игре, где игрок заведомо доволен.
   *
   * Само окно НЕ открывается автоматически: показываем скромную кнопку, и
   * `requestReview()` вызывается по нажатию. Игрок, которому это неинтересно,
   * просто идёт дальше.
   */
  async function maybeOfferReview() {
    if (saves.reviewAsked) return;                       // уже предлагали в прошлой сессии
    if (saves.stats.solved < REVIEW_AFTER_SOLVED) return; // слишком рано
    const { value } = await ctx.sdk.canReview();
    if (!value || !alive) return;
    rateBtn.hidden = false;
  }

  async function onRate() {
    rateBtn.disabled = true;
    saves.markReviewAsked();
    const { feedbackSent } = await ctx.sdk.requestReview();
    if (!alive) return;
    rateBtn.hidden = true;
    if (feedbackSent) toast(t('rateThanks'));
  }

  /**
   * Следующий кроссворд — в том же режиме: игрок выбрал сложность осознанно, и
   * подсовывать ему другую после победы было бы странно. Исключение —
   * кроссворд дня: он один на сутки, поэтому дальше идём в лёгкий режим.
   *
   * Реклама здесь показывается по правилам площадки (не чаще раза в минуту,
   * первые партии — без неё вовсе, см. `systems/ads.js`).
   */
  async function playNext() {
    await ads.betweenLevels();
    if (!alive) return;
    const mode = plan.mode === 'daily' ? 'easy' : plan.mode;
    ctx.go('game', { mode, theme: plan.theme, seed: newSeed() });
  }
}
