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
// Больше слов при умеренном холсте + скоринг плотности = компактные, «настоящие»
// сетки с крупными клетками на экране.
// targetWords держим умеренным, чтобы сетка была компактной (мало столбцов) и на
// телефоне клетки выходили крупными при заполнении по ширине без горизонтальной
// прокрутки. Плотность обеспечивает скоринг размещения, а не раздувание сетки.
export const LEVELS = {
  easy: { targetWords: 8, minLen: 3, maxLen: 6, canvas: 13 },
  medium: { targetWords: 10, minLen: 3, maxLen: 8, canvas: 15 },
  hard: { targetWords: 16, minLen: 3, maxLen: 11, canvas: 21 },
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
  // Скоринг размещения ради ПЛОТНОСТИ: много пересечений — хорошо; рост габаритов
  // и удаление от центра занятой области — плохо. Так сетка получается компактной,
  // близкой к квадрату и без «растекания», а значит клетки на экране крупнее.
  const cen = placedCenter(placed);
  for (const cand of candidates) {
    const dr = cand.dir === DOWN ? 1 : 0;
    const dc = cand.dir === ACROSS ? 1 : 0;
    const endR = cand.row + dr * (word.length - 1);
    const endC = cand.col + dc * (word.length - 1);
    const midR = (cand.row + endR) / 2;
    const midC = (cand.col + endC) / 2;
    const bboxGrowth = boundingGrowth(placed, cand.row, cand.col, endR, endC);
    const centerDist = Math.abs(midR - cen.r) + Math.abs(midC - cen.c);
    cand.score = cand.crossings * 10 - bboxGrowth * 2 - centerDist * 0.4;
  }
  const maxScore = Math.max(...candidates.map((c) => c.score));
  // Берём широкую полосу лучших (в пределах ~одного тира по пересечениям) и выбираем
  // по seed — это сохраняет плотность, но даёт РАЗНЫЕ сетки для разных seed'ов
  // (уникальность — фишка игры). Узкая полоса приводила к схлопыванию в одну сетку.
  const best = candidates.filter((c) => c.score >= maxScore - 6);
  return rng.pick(best);
}

/** Центр занятой области (по размещённым словам) — для штрафа за удаление. */
function placedCenter(placed) {
  let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
  for (const p of placed) {
    const dr = p.dir === DOWN ? 1 : 0;
    const dc = p.dir === ACROSS ? 1 : 0;
    const endR = p.row + dr * (p.word.length - 1);
    const endC = p.col + dc * (p.word.length - 1);
    minR = Math.min(minR, p.row); minC = Math.min(minC, p.col);
    maxR = Math.max(maxR, endR); maxC = Math.max(maxC, endC);
  }
  return { r: (minR + maxR) / 2, c: (minC + maxC) / 2 };
}

/** Насколько вырастет bounding box занятой области, если добавить слово. */
function boundingGrowth(placed, r0, c0, r1, c1) {
  let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
  for (const p of placed) {
    const dr = p.dir === DOWN ? 1 : 0;
    const dc = p.dir === ACROSS ? 1 : 0;
    const endR = p.row + dr * (p.word.length - 1);
    const endC = p.col + dc * (p.word.length - 1);
    minR = Math.min(minR, p.row); minC = Math.min(minC, p.col);
    maxR = Math.max(maxR, endR); maxC = Math.max(maxC, endC);
  }
  const w0 = (maxC - minC) + (maxR - minR);
  const nMinR = Math.min(minR, r0), nMinC = Math.min(minC, c0);
  const nMaxR = Math.max(maxR, r1), nMaxC = Math.max(maxC, c1);
  const w1 = (nMaxC - nMinC) + (nMaxR - nMinR);
  return w1 - w0;
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

  // первое слово — случайное из длинных (pool уже перемешан по seed), чтобы у
  // разных seed'ов был разный «якорь» и, как следствие, разные сетки
  const longPool = pool.filter((w) => w.answer.length >= cfg.maxLen - 3);
  const first = (longPool.length ? longPool : pool)[0];
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

  // метрики компактности для отбора лучшей сетки
  let occupied = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (grid[r][c] !== null) occupied++;
  const fillRatio = occupied / (rows * cols);
  const aspect = Math.max(rows, cols) / Math.min(rows, cols);

  return { seed, level, rows, cols, grid, numbers, slots, fillRatio, aspect };
}

// Минимально допустимое число слов по уровням (жадная укладка изредка «застревает»).
const MIN_WORDS = { easy: 6, medium: 8, hard: 12 };
// Предел стороны сетки: держим сетку компактной, чтобы на телефоне клетка
// (≈ ширина экрана / число столбцов) оставалась крупной и вся сетка помещалась
// без обрезки. medium ≤ 11 столбцов → на 390px ≈ 30px+ на клетку.
const MAX_DIM = { easy: 10, medium: 11, hard: 15 };
// Пороги компактности: первую же per-seed сетку, что достаточно плотная и
// компактная, принимаем сразу — так результат определяется seed'ом (уникальность),
// а не глобальным поиском «самой плотной» (который схлопывал все seed'ы в одну сетку).
const GOOD_FILL = 0.32;
const GOOD_ASPECT = 1.5;

/**
 * Комбинированная оценка «хорошести» сетки: плотнее, квадратнее, больше слов,
 * но со штрафом за крупный габарит — чтобы клетки на телефоне оставались большими.
 */
function puzzleScore(cw, cap = 14) {
  const maxDim = Math.max(cw.rows, cw.cols);
  return (
    cw.fillRatio * 3 -
    (cw.aspect - 1) * 0.9 + // штраф за вытянутость — держим сетку ближе к квадрату
    cw.slots.length * 0.02 -
    Math.max(0, maxDim - cap) * 0.8 // сильный штраф за превышение предела стороны
  );
}

/**
 * Публичная точка входа для игры: гарантированно валидный, плотный и близкий к
 * квадрату кроссворд. Детерминирована по (seed, level): перебирает несколько
 * предсказуемо ремикшенных seed'ов и берёт лучшую сетку. Тот же входной seed
 * всегда даёт тот же результат (важно для возобновления партии).
 */
export function generatePuzzle(seed, level = 'medium', attempts = 14) {
  const minWords = MIN_WORDS[level] ?? 10;
  // Seed'ы попыток берём из СОБСТВЕННОГО потока данного seed. Это исключает
  // коллизии между разными исходными seed'ами (XOR-ремикс seed^(i+1) их создавал:
  // напр. seed 5/попытка 2 и seed 7/попытка 0 давали одно значение → одинаковые
  // сетки у разных игроков). Теперь у каждого seed — своя воспроизводимая цепочка.
  const cap = MAX_DIM[level] ?? 12;
  const arng = new RNG(seed);
  const attemptSeed = () => (arng.next() * 0xffffffff) >>> 0;

  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < attempts; i++) {
    const cw = generateCrossword(attemptSeed(), level);
    cw.seed = seed; // храним исходный seed для воспроизведения через generatePuzzle
    const { ok } = validateCrossword(cw, minWords);
    if (!ok) continue;
    // плотная, квадратная и в пределах maxDim — принимаем сразу (первую подходящую per-seed)
    if (cw.fillRatio >= GOOD_FILL && cw.aspect <= GOOD_ASPECT && Math.max(cw.rows, cw.cols) <= cap) return cw;
    const sc = puzzleScore(cw, cap);
    if (sc > bestScore) { bestScore = sc; best = cw; }
  }
  if (best) return best;
  // ни одна не прошла пороги — ослабляем требование к числу слов, чтобы всегда
  // вернуть играбельную сетку (детерминированно, из того же потока)
  for (let i = 0; i < attempts; i++) {
    const cw = generateCrossword(attemptSeed(), level);
    cw.seed = seed;
    if (validateCrossword(cw, 6).ok) {
      const sc = puzzleScore(cw);
      if (sc > bestScore) { bestScore = sc; best = cw; }
    }
  }
  return best || generateCrossword(seed, level);
}
