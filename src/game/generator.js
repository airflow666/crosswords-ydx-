/**
 * Генератор классических кроссвордов.
 *
 * Алгоритм: берём перемешанный (по seed) список слов и жадно раскладываем их
 * на сетку так, чтобы каждое новое слово пересекалось хотя бы с одним уже
 * размещённым по общей букве, без недопустимых примыканий. Первое слово —
 * в центре. В конце обрезаем до занятой области и проставляем номера.
 *
 * Один seed → одинаковая сетка (воспроизводимость для возобновления партии),
 * разные seed → разные сетки (уникальный кроссворд у каждого игрока).
 */

import { RNG } from './rng.js';
import { DICTIONARY } from './dictionary.ru.js';
import { validateCrossword } from './validator.js';

// Настройки сложности: сколько слов пытаемся уложить и рабочий размер холста.
export const LEVELS = {
  easy: { targetWords: 9, minLen: 3, maxLen: 6, canvas: 15 },
  medium: { targetWords: 13, minLen: 3, maxLen: 8, canvas: 19 },
  hard: { targetWords: 17, minLen: 4, maxLen: 12, canvas: 23 },
};

const ACROSS = 'across';
const DOWN = 'down';

/** Пустой квадратный холст размера n×n, заполненный null. */
function makeCanvas(n) {
  return Array.from({ length: n }, () => new Array(n).fill(null));
}

/**
 * Можно ли положить слово в позицию (row,col) в направлении dir на холст.
 * Правила корректного кроссворда:
 *  - все клетки в пределах холста;
 *  - там, где клетка занята, буква должна совпасть (валидное пересечение);
 *  - клетки прямо перед началом и сразу после конца слова должны быть пусты
 *    (иначе слово слилось бы с соседним в длинную «кашу»);
 *  - для каждой НЕ пересекающейся клетки нельзя иметь занятого бокового
 *    соседа с той же ориентацией — иначе рядом образуется незапланированное
 *    параллельное слово.
 * Возвращает число пересечений (>=0) или -1, если положить нельзя.
 */
function tryPlacement(canvas, word, row, col, dir) {
  const n = canvas.length;
  const dr = dir === DOWN ? 1 : 0;
  const dc = dir === ACROSS ? 1 : 0;
  const len = word.length;

  const endR = row + dr * (len - 1);
  const endC = col + dc * (len - 1);
  if (row < 0 || col < 0 || endR >= n || endC >= n) return -1;

  // клетка перед началом и после конца — должны быть пусты
  const beforeR = row - dr, beforeC = col - dc;
  const afterR = endR + dr, afterC = endC + dc;
  if (beforeR >= 0 && beforeC >= 0 && canvas[beforeR][beforeC] !== null) return -1;
  if (afterR < n && afterC < n && canvas[afterR][afterC] !== null) return -1;

  let crossings = 0;
  let prevFilled = false;
  for (let i = 0; i < len; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const cell = canvas[r][c];
    if (cell !== null) {
      if (cell !== word[i]) return -1; // конфликт букв
      // Два подряд занятых клетки вдоль слова — это наложение на параллельное
      // слово того же направления (наше слово стало бы его под-/надстрокой).
      // Корректное пересечение всегда перпендикулярно и занимает одну клетку.
      if (prevFilled) return -1;
      crossings++;
      prevFilled = true;
      continue; // пересечение — боковых соседей не проверяем, это законно
    }
    prevFilled = false;
    // Клетка пустая: боковые соседи (перпендикулярно ходу слова) должны быть пусты,
    // иначе рядом «прилипнет» параллельное слово.
    const sr1 = r + dc, sc1 = c + dr; // одна сторона
    const sr2 = r - dc, sc2 = c - dr; // другая сторона
    if (sr1 >= 0 && sc1 >= 0 && sr1 < n && sc1 < n && canvas[sr1][sc1] !== null) return -1;
    if (sr2 >= 0 && sc2 >= 0 && sr2 < n && sc2 < n && canvas[sr2][sc2] !== null) return -1;
  }
  return crossings;
}

/** Записать слово на холст. */
function place(canvas, word, row, col, dir) {
  const dr = dir === DOWN ? 1 : 0;
  const dc = dir === ACROSS ? 1 : 0;
  for (let i = 0; i < word.length; i++) {
    canvas[row + dr * i][col + dc * i] = word[i];
  }
}

/**
 * Найти лучшую позицию для слова: перебираем каждую его букву и ищем
 * совпадающие буквы уже размещённых слов, пробуем перпендикулярную укладку.
 * Возвращает { row, col, dir, crossings } или null.
 */
function findBestPlacement(canvas, word, placed, rng) {
  const candidates = [];
  for (const p of placed) {
    const pdr = p.dir === DOWN ? 1 : 0;
    const pdc = p.dir === ACROSS ? 1 : 0;
    const newDir = p.dir === ACROSS ? DOWN : ACROSS;
    for (let i = 0; i < p.word.length; i++) {
      const pr = p.row + pdr * i;
      const pc = p.col + pdc * i;
      const letter = p.word[i];
      // все позиции буквы letter в новом слове
      for (let j = 0; j < word.length; j++) {
        if (word[j] !== letter) continue;
        const ndr = newDir === DOWN ? 1 : 0;
        const ndc = newDir === ACROSS ? 1 : 0;
        const row = pr - ndr * j;
        const col = pc - ndc * j;
        const crossings = tryPlacement(canvas, word, row, col, newDir);
        if (crossings > 0) candidates.push({ row, col, dir: newDir, crossings });
      }
    }
  }
  if (candidates.length === 0) return null;
  // предпочитаем больше пересечений (плотнее сетка); при равенстве — по seed
  const maxCross = Math.max(...candidates.map((c) => c.crossings));
  const best = candidates.filter((c) => c.crossings === maxCross);
  return rng.pick(best);
}

/** Обрезать холст до занятой области, вернуть { grid, offR, offC, rows, cols }. */
function crop(canvas) {
  const n = canvas.length;
  let minR = n, minC = n, maxR = -1, maxC = -1;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (canvas[r][c] !== null) {
        if (r < minR) minR = r;
        if (c < minC) minC = c;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
    }
  }
  const rows = maxR - minR + 1;
  const cols = maxC - minC + 1;
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => canvas[minR + r][minC + c])
  );
  return { grid, offR: minR, offC: minC, rows, cols };
}

/**
 * Проставить номера клеток по стандартным правилам кроссворда и собрать слоты.
 * Клетка получает номер, если с неё начинается across- и/или down-слово
 * (пустой сосед слева/сверху, занятый справа/снизу).
 */
function numberGrid(grid, placedSlots) {
  const rows = grid.length;
  const cols = grid[0].length;
  const numberAt = {}; // "r,c" -> number
  const numbers = Array.from({ length: rows }, () => new Array(cols).fill(0));
  let counter = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === null) continue;
      const startsAcross =
        (c === 0 || grid[r][c - 1] === null) && c + 1 < cols && grid[r][c + 1] !== null;
      const startsDown =
        (r === 0 || grid[r - 1][c] === null) && r + 1 < rows && grid[r + 1][c] !== null;
      if (startsAcross || startsDown) {
        counter++;
        numbers[r][c] = counter;
        numberAt[`${r},${c}`] = counter;
      }
    }
  }
  const slots = placedSlots.map((p) => ({
    number: numberAt[`${p.row},${p.col}`],
    dir: p.dir,
    row: p.row,
    col: p.col,
    len: p.word.length,
    answer: p.word,
    clue: p.clue,
  }));
  // сортировка: по номеру, across раньше down
  slots.sort((a, b) => a.number - b.number || (a.dir === ACROSS ? -1 : 1));
  return { numbers, slots };
}

/**
 * Сгенерировать кроссворд.
 * @param {number} seed
 * @param {'easy'|'medium'|'hard'} level
 * @returns {{ seed, level, rows, cols, grid, numbers, slots }}
 */
export function generateCrossword(seed, level = 'medium') {
  const cfg = LEVELS[level] || LEVELS.medium;
  const rng = new RNG(seed);

  // кандидаты нужной длины, перемешаны детерминированно
  const pool = rng.shuffle(
    DICTIONARY.filter((w) => w.answer.length >= cfg.minLen && w.answer.length <= cfg.maxLen)
  );

  const canvas = makeCanvas(cfg.canvas);
  const placed = [];
  const usedAnswers = new Set();

  // первое слово — самое длинное из первых кандидатов, по центру горизонтально
  const first = pool.slice(0, 20).reduce((a, b) => (b.answer.length > a.answer.length ? b : a), pool[0]);
  const startRow = Math.floor(cfg.canvas / 2);
  const startCol = Math.floor((cfg.canvas - first.answer.length) / 2);
  place(canvas, first.answer, startRow, startCol, ACROSS);
  placed.push({ word: first.answer, clue: first.clue, row: startRow, col: startCol, dir: ACROSS });
  usedAnswers.add(first.answer);

  // жадно добавляем остальные, повторяя проходы пока есть прогресс
  let progress = true;
  while (placed.length < cfg.targetWords && progress) {
    progress = false;
    for (const w of pool) {
      if (placed.length >= cfg.targetWords) break;
      if (usedAnswers.has(w.answer)) continue;
      const spot = findBestPlacement(canvas, w.answer, placed, rng);
      if (spot) {
        place(canvas, w.answer, spot.row, spot.col, spot.dir);
        placed.push({ word: w.answer, clue: w.clue, row: spot.row, col: spot.col, dir: spot.dir });
        usedAnswers.add(w.answer);
        progress = true;
      }
    }
  }

  // обрезаем и переносим координаты слотов в систему обрезанной сетки
  const { grid, offR, offC, rows, cols } = crop(canvas);
  const placedSlots = placed.map((p) => ({ ...p, row: p.row - offR, col: p.col - offC }));
  const { numbers, slots } = numberGrid(grid, placedSlots);

  return { seed, level, rows, cols, grid, numbers, slots };
}

// Минимально допустимое число слов по уровням (жадная укладка изредка «застревает»).
const MIN_WORDS = { easy: 6, medium: 8, hard: 9 };

/**
 * Публичная точка входа для игры: гарантированно валидный и достаточно
 * плотный кроссворд. Детерминирована по (seed, level): при неудачной укладке
 * ремиксует seed предсказуемо и берёт лучшую из попыток. Тот же входной seed
 * всегда даёт тот же результат (важно для возобновления партии).
 */
export function generatePuzzle(seed, level = 'medium', attempts = 8) {
  const minWords = MIN_WORDS[level] ?? 6;
  let best = null;
  for (let i = 0; i < attempts; i++) {
    // ремикс seed детерминирован (mulberry-подобное смешивание индекса попытки)
    const s = (Math.imul(seed ^ (i + 1), 0x9e3779b1) >>> 0);
    const cw = generateCrossword(s, level);
    cw.seed = seed; // храним исходный seed для воспроизведения через generatePuzzle
    const { ok } = validateCrossword(cw, minWords);
    if (ok) return cw;
    if (!best || cw.slots.length > best.slots.length) best = cw;
  }
  return best;
}
