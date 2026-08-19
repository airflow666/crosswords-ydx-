/**
 * Реестр словарных пулов и их ленивая загрузка.
 *
 * Пул — это готовый `WordBank` под конкретный режим. Пулов много, а нужен в
 * каждый момент ровно один, поэтому все они подключаются через `import()`:
 * Vite раскладывает их по отдельным чанкам, и стартовый бандл больше не тащит
 * ни одного слова. До этой развязки главное меню импортировало генератор,
 * генератор — словарь, и площадка честно засчитывала в «время загрузки» и
 * скачивание 400 КБ, и построение индекса.
 *
 * Идентификаторы пулов:
 *   'easy'          — лёгкий режим (прежний словарь игры);
 *   'hard'          — сложный: обычные кроссвордные слова + слова выше среднего;
 *   'theme:<id>'    — тематический (см. THEMES).
 */

import { WordBank } from '../wordbank.js';
import { buildEntries, RANK_EASY, RANK_STANDARD, RANK_HARD } from './pack.js';

/**
 * Тематические категории. Порядок здесь — порядок на экране выбора темы.
 * `hue` задаёт оттенок плитки: темы должны отличаться на глаз, но оставаться в
 * приглушённой палитре игры, поэтому меняется только тон, а не насыщенность.
 *
 * Почему темы ШИРОКИЕ («Наука и техника», а не отдельно наука и отдельно
 * техника). Тематический кроссворд собирается только из слов своей темы, и
 * замеры дали жёсткий порог: сетка 7×7 требует от пула минимум ~250 слов,
 * 8×8 — около 400. Узкая тема столько приличных слов просто не даёт, и
 * генератор либо не собирает доску вовсе, либо скатывается к натянутым
 * определениям. Широкая тема набирает нужный словарь и при этом остаётся
 * цельной для игрока.
 */
export const THEMES = [
  { id: 'nature',    title: 'Природа',           icon: '🌿', hue: 140 },
  { id: 'geography', title: 'География',         icon: '🗺️', hue: 205 },
  { id: 'animals',   title: 'Животный мир',      icon: '🦉', hue: 30 },
  { id: 'space',     title: 'Космос и небо',     icon: '🪐', hue: 260 },
  { id: 'history',   title: 'История',           icon: '🏛️', hue: 40 },
  { id: 'science',   title: 'Наука и техника',   icon: '🔬', hue: 190 },
  { id: 'art',       title: 'Искусство и музыка', icon: '🎨', hue: 320 },
  { id: 'sport',     title: 'Спорт и игры',      icon: '⚽', hue: 105 },
  { id: 'food',      title: 'Кухня и застолье',  icon: '🍲', hue: 55 },
];

export const THEME_IDS = THEMES.map((t) => t.id);

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || null;
}

// Загрузчики паков. Пути записаны литералами: только так сборщик видит их
// статически и раскладывает по отдельным чанкам.
const THEME_LOADERS = {
  nature:    () => import('./theme.nature.js'),
  geography: () => import('./theme.geography.js'),
  animals:   () => import('./theme.animals.js'),
  space:     () => import('./theme.space.js'),
  history:   () => import('./theme.history.js'),
  science:   () => import('./theme.science.js'),
  art:       () => import('./theme.art.js'),
  sport:     () => import('./theme.sport.js'),
  food:      () => import('./theme.food.js'),
};

const cache = new Map();   // poolId -> Promise<WordBank>

/**
 * Получить пул по идентификатору. Повторные вызовы отдают тот же промис —
 * индекс строится один раз за сессию.
 */
export function loadPool(poolId) {
  let p = cache.get(poolId);
  if (!p) { p = build(poolId); cache.set(poolId, p); }
  return p;
}

/** Загружен ли пул уже сейчас (для решения, показывать ли загрузчик). */
export function isPoolReady(poolId) {
  return cache.has(poolId);
}

async function build(poolId) {
  if (poolId === 'easy') {
    const { LINES } = await import('./pool.easy.js');
    return new WordBank(buildEntries([{ lines: LINES, rank: RANK_EASY }]), poolId);
  }
  if (poolId === 'hard') {
    const [std, hard] = await Promise.all([
      import('./pool.standard.js'),
      import('./pool.hard.js'),
    ]);
    return new WordBank(
      buildEntries([
        { lines: std.LINES, rank: RANK_STANDARD },
        { lines: hard.LINES, rank: RANK_HARD },
      ]),
      poolId
    );
  }
  if (poolId.startsWith('theme:')) {
    const id = poolId.slice(6);
    const load = THEME_LOADERS[id];
    if (!load) throw new Error(`Неизвестная тема: ${id}`);
    const { LINES } = await load();
    return new WordBank(buildEntries([{ lines: LINES, rank: RANK_STANDARD }]), poolId);
  }
  throw new Error(`Неизвестный пул слов: ${poolId}`);
}
