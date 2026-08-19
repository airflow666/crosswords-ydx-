/**
 * Генератор ПЛОТНЫХ кроссвордов (доска без больших пробелов).
 *
 * Двухэтапный алгоритм:
 *   1) makeTemplate — по seed строим плотный узор из чёрных клеток (симметричный,
 *      без «дыр» и коротких огрызков): рабочая сетка, где почти каждая клетка
 *      входит в слово и по горизонтали, и по вертикали.
 *   2) fill — backtracking-заполнение слотов реальными словами из словаря так,
 *      чтобы все пересечения совпадали.
 *
 * Один seed → одинаковый кроссворд (воспроизводимость для возобновления партии),
 * разные seed → разные (уникальность у каждого игрока). Всё детерминировано:
 * бюджет шагов вместо таймеров, чтобы результат не зависел от скорости машины.
 *
 * Словарь генератору передаётся снаружи (`bank`) — от режима к режиму он свой:
 * лёгкий, сложный, тематический. Сам генератор про режимы ничего не знает.
 */

import { RNG } from './rng.js';

const ACROSS = 'across';
const DOWN = 'down';


// ---------- 1. Шаблон (узор чёрных клеток) ----------

/** Все максимальные «белые» пробеги по строкам и столбцам. */
function runsOf(white) {
  const n = white.length;
  const runs = [];
  for (let r = 0; r < n; r++) {
    let s = -1;
    for (let c = 0; c <= n; c++) {
      const w = c < n && white[r][c];
      if (w && s < 0) s = c;
      else if (!w && s >= 0) { runs.push({ len: c - s, cells: range(s, c).map((cc) => [r, cc]) }); s = -1; }
    }
  }
  for (let c = 0; c < n; c++) {
    let s = -1;
    for (let r = 0; r <= n; r++) {
      const w = r < n && white[r][c];
      if (w && s < 0) s = r;
      else if (!w && s >= 0) { runs.push({ len: r - s, cells: range(s, r).map((rr) => [rr, c]) }); s = -1; }
    }
  }
  return runs;
}

function range(a, b) { const o = []; for (let i = a; i < b; i++) o.push(i); return o; }

/**
 * Структурная валидность узора (без ограничения на максимальную длину слова —
 * оно проверяется отдельно как условие ПРИЁМКИ, иначе на промежуточных шагах
 * длинные пробеги мешали бы добавить первую же чёрную клетку):
 *  - нет пробегов длины ровно 2 (огрызков);
 *  - каждая белая клетка входит хотя бы в один пробег ≥3;
 *  - белая область связна.
 */
function structuralValid(white) {
  const n = white.length;
  const runs = runsOf(white);
  const coveredBy3 = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const run of runs) {
    if (run.len === 2) return false;
    if (run.len >= 3) for (const [r, c] of run.cells) coveredBy3[r][c] = true;
  }
  let whiteCount = 0, first = null;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (white[r][c]) {
    whiteCount++; if (!first) first = [r, c];
    if (!coveredBy3[r][c]) return false;
  }
  if (!first) return false;
  const seen = new Set([first[0] * n + first[1]]);
  const stack = [first];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (nr < 0 || nc < 0 || nr >= n || nc >= n || !white[nr][nc]) continue;
      const k = nr * n + nc;
      if (!seen.has(k)) { seen.add(k); stack.push([nr, nc]); }
    }
  }
  return seen.size === whiteCount;
}

function maxRunLen(white) {
  let m = 0;
  for (const run of runsOf(white)) if (run.len > m) m = run.len;
  return m;
}

/** Поставить одну чёрную клетку (r,c), если это сохраняет структурную валидность. */
function tryBlack(white, r, c) {
  if (!white[r][c]) return false;
  white[r][c] = false;
  if (structuralValid(white)) return true;
  white[r][c] = true;
  return false;
}

/**
 * Построить плотный шаблон: рассыпаем чёрные клетки (в seed-порядке) до целевой
 * доли, оставляя лишь те, что сохраняют структурную валидность, — так пробеги
 * короткие, доска заполненная, а сетка надёжно заполняется словами. Без симметрии
 * (надёжнее и легче заполнять). Возвращает white[r][c] (bool) или null.
 */
function makeTemplate(rng, size, maxRun, blackRatio) {
  const white = Array.from({ length: size }, () => new Array(size).fill(true));
  const target = Math.round(size * size * blackRatio);

  const cells = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) cells.push([r, c]);
  rng.shuffle(cells);

  let blacks = 0;
  for (const [r, c] of cells) {
    if (blacks >= target && maxRunLen(white) <= maxRun) break;
    if (tryBlack(white, r, c)) blacks += 1;
  }
  // если остались слишком длинные пробеги — добиваем их
  let guard = 0;
  while (maxRunLen(white) > maxRun && guard++ < size * size) {
    const long = runsOf(white).filter((run) => run.len > maxRun);
    rng.shuffle(long);
    let broke = false;
    for (const run of long) {
      const mid = run.cells[Math.floor(run.len / 2)];
      if (tryBlack(white, mid[0], mid[1])) { broke = true; break; }
      const opts = run.cells.slice(1, run.len - 1);
      rng.shuffle(opts);
      for (const [r, c] of opts) if (tryBlack(white, r, c)) { broke = true; break; }
      if (broke) break;
    }
    if (!broke) break;
  }

  return structuralValid(white) && maxRunLen(white) <= maxRun ? white : null;
}

// ---------- 2. Слоты и заполнение ----------

/** Слоты (пробеги ≥3) из шаблона. */
function slotsOf(white) {
  return runsOf(white)
    .filter((run) => run.len >= 3)
    .map((run) => {
      const [r0, c0] = run.cells[0];
      const [r1] = run.cells[1] || run.cells[0];
      const dir = r1 === r0 ? ACROSS : DOWN;
      return { dir, row: r0, col: c0, len: run.len, cells: run.cells, answer: null };
    });
}

/**
 * Ограничения слота (буква или null по каждой клетке).
 *
 * Буфер переиспользуется намеренно. MRV опрашивает КАЖДЫЙ незаполненный слот на
 * КАЖДОМ шаге перебора, и на плотной доске это десятки тысяч массивов за одну
 * генерацию — заметная доля времени уходила в сборщик мусора. Единственное
 * условие: результат нельзя придерживать между вызовами, и ни `countCandidates`,
 * ни `candidates` этого не делают — они читают его сразу.
 */
const SCRATCH = new Array(32);
function readConstraints(slot, letters) {
  const cells = slot.cells;
  const n = cells.length;
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    SCRATCH[i] = letters[cell[0]][cell[1]];
  }
  SCRATCH.length = n;
  return SCRATCH;
}

/**
 * Backtracking-заполнение по эвристике MRV (minimum remaining values): на каждом
 * шаге заполняем слот с НАИМЕНЬШИМ числом кандидатов — это резко сокращает перебор
 * и надёжно находит решение. budget — счётчик шагов (детерминизм: результат не
 * зависит от скорости машины).
 */
function fill(bank, slots, letters, rng, used, budget, avoid, strictAvoid = false, preferHard = false) {
  // MRV: находим слот с наименьшим числом кандидатов (быстрый подсчёт без массивов)
  let target = null, min = Infinity;
  for (const s of slots) {
    if (s.answer) continue;
    const cnt = bank.countCandidates(s.len, readConstraints(s, letters), used, min + 1);
    if (cnt < min) { min = cnt; target = s; if (min === 0) break; }
  }
  if (!target) return true;            // все слоты заполнены
  if (min === 0) return false;         // тупик: у какого-то слота нет кандидатов

  let targetCands = bank.candidates(target.len, readConstraints(target, letters)).filter((w) => !used.has(w));
  rng.shuffle(targetCands);
  // Сложный режим: слова выше среднего идут первыми. Именно предпочтение, а не
  // фильтр — джиттер намеренно шире шага между рангами, поэтому обычное слово
  // иногда обгоняет сложное, и сетка не превращается в сплошной список
  // редкостей. Плюс так остаётся запас кандидатов, и заполнение не срывается.
  if (preferHard && targetCands.length > 1) {
    targetCands = targetCands
      .map((w) => ({ w, score: bank.rankOf(w) * 2 + rng.next() * 3 }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.w);
  }
  // Недавно встречавшиеся игроку слова уводим в конец очереди: короткие слова
  // вроде ОСА и ОДА подходят почти в любую щель, и без этого они кочевали из
  // кроссворда в кроссворд. Именно СМЯГЧЁННЫЙ приоритет, а не запрет: если
  // ничего другого не подходит, слово всё равно будет использовано и генерация
  // не сорвётся.
  if (avoid && avoid.size) {
    const fresh = [], stale = [];
    for (const w of targetCands) (avoid.has(w) ? stale : fresh).push(w);
    // Строгий заход отбрасывает недавние слова — но только пока остаётся из
    // чего выбирать. Прежний безусловный запрет был «всё или ничего»: на узком
    // словаре у длинного слота свежих кандидатов почти не бывает, заполнение
    // срывалось целиком, и вся сетка собиралась мягким режимом. Порог в три
    // кандидата оставляет backtracking'у пространство для манёвра, и строгий
    // заход стал доходить до конца там, где раньше не доходил никогда.
    if (strictAvoid && fresh.length >= Math.min(3, targetCands.length)) targetCands = fresh;
    else targetCands = fresh.concat(stale);
    if (!targetCands.length) return false;
  }
  for (const w of targetCands) {
    if (budget.n-- <= 0) return false;
    const filledNow = [];
    for (let i = 0; i < target.len; i++) {
      const [r, c] = target.cells[i];
      if (letters[r][c] == null) { letters[r][c] = w[i]; filledNow.push([r, c]); }
    }
    target.answer = w; used.add(w);
    // strictAvoid обязан дойти до дна рекурсии. Пока здесь стояло жёсткое
    // `false`, запрет на недавние слова действовал ровно на один — первый —
    // слот, а `freshOnly` при этом объявлял сетку свободной от повторов, и
    // `generatePuzzle` принимал её по этому признаку.
    if (fill(bank, slots, letters, rng, used, budget, avoid, strictAvoid, preferHard)) return true;
    for (const [r, c] of filledNow) letters[r][c] = null;
    target.answer = null; used.delete(w);
  }
  return false;
}

// ---------- Нумерация ----------

function numberGrid(bank, grid, slots, seed = 0) {
  const rows = grid.length, cols = grid[0].length;
  const numberAt = {};
  const numbers = Array.from({ length: rows }, () => new Array(cols).fill(0));
  let counter = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === null) continue;
      const startsAcross = (c === 0 || grid[r][c - 1] === null) && c + 1 < cols && grid[r][c + 1] !== null;
      const startsDown = (r === 0 || grid[r - 1][c] === null) && r + 1 < rows && grid[r + 1][c] !== null;
      if (startsAcross || startsDown) { counter++; numbers[r][c] = counter; numberAt[`${r},${c}`] = counter; }
    }
  }
  const outSlots = slots.map((s) => ({
    number: numberAt[`${s.row},${s.col}`],
    dir: s.dir, row: s.row, col: s.col, len: s.len,
    answer: s.answer,
    // У многозначных слов вариант определения выбирается по seed и месту слова
    // в сетке: в разных партиях формулировка разная, но для одного seed —
    // всегда одна и та же (иначе после перезагрузки клюз бы «прыгнул»).
    clue: bank.clueFor(s.answer, (seed >>> 3) + s.row * 31 + s.col * 7 + (s.dir === ACROSS ? 0 : 1)),
  }));
  outSlots.sort((a, b) => a.number - b.number || (a.dir === ACROSS ? -1 : 1));
  return { numbers, slots: outSlots };
}

// ---------- Публичные точки входа ----------

/**
 * Одна попытка генерации: шаблон + заполнение. Возвращает готовый кроссворд или null.
 *
 * @param {number} seed
 * `tryFresh` — сделать дополнительный, более строгий заход: собрать сетку
 * вообще без недавних слов. Он вдвое дороже обычного, поэтому включается не
 * всегда, а только пока `generatePuzzle` придирчив к свежести слов.
 *
 * @param {{bank:object, size:number, maxRun:number, black:number,
 *          avoid?:Set<string>, preferHard?:boolean, tryFresh?:boolean}} cfg
 */
export function generateCrossword(seed, cfg) {
  const { bank, size, maxRun, black, avoid = null, preferHard = false, tryFresh = false } = cfg;
  const rng = new RNG(seed);
  const white = makeTemplate(rng, size, maxRun, black);
  if (!white) return null;

  const slots = slotsOf(white);
  const letters = Array.from({ length: size }, () => new Array(size).fill(null));
  // Небольшой бюджет: удачная сетка заполняется быстро, неудачную бросаем и берём
  // другой seed. Так generatePuzzle успевает много дешёвых попыток.
  let ok = false;
  let freshOnly = false;   // удалось ли обойтись совсем без недавних слов
  // Сначала пробуем собрать сетку ВООБЩЕ БЕЗ недавних слов — это заметно
  // действеннее, чем просто отодвигать их в конец очереди. Если так не
  // получилось, повторяем без ограничения: пустая доска игроку нужнее, чем
  // принципиальность в борьбе с повторами.
  if (tryFresh && avoid && avoid.size) {
    ok = fill(bank, slots, letters, new RNG(seed), new Set(), { n: 4000 }, avoid, true, preferHard);
    freshOnly = ok;
    if (!ok) {
      for (const s of slots) s.answer = null;
      for (const row of letters) row.fill(null);
    }
  }
  if (!ok) ok = fill(bank, slots, letters, new RNG(seed), new Set(), { n: 4000 }, avoid, false, preferHard);
  if (!ok) return null;

  // финальная сетка: буквы в белых клетках, null — в чёрных
  const grid = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => (white[r][c] ? letters[r][c] : null))
  );
  const { numbers, slots: outSlots } = numberGrid(bank, grid, slots, seed);

  let occupied = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c] !== null) occupied++;
  const fillRatio = occupied / (size * size);

  // Сколько слов сетки игрок видел недавно. Это не признак брака, а мера, по
  // которой `generatePuzzle` выбирает лучшую из уже построенных сеток.
  let staleCount = 0;
  if (avoid && avoid.size) for (const s of outSlots) if (avoid.has(s.answer)) staleCount++;

  return { seed, rows: size, cols: size, grid, numbers, slots: outSlots, fillRatio, aspect: 1, freshOnly, staleCount };
}

/**
 * Публичная точка входа для игры: гарантированно валидный плотный кроссворд
 * заданной геометрии. Детерминирована по (seed, cfg): перебирает попытки из
 * собственного потока seed. Тот же seed → тот же кроссворд.
 *
 * `strict` — вернуть null, если ни одна попытка не набрала `minWords`, вместо
 * самой заполненной из неудачных. Нужен, когда есть куда отступить: узкому
 * тематическому словарю сетка 8×8 бывает не по силам, и честнее сразу перейти
 * к 7×7, чем отдать игроку доску из четырёх слов и трёх пустых углов.
 *
 * @param {number} seed
 * @param {{bank:object, size:number, maxRun:number, black:number, minWords:number,
 *          attempts?:number, avoid?:Set<string>, preferHard?:boolean, strict?:boolean}} cfg
 */
export function generatePuzzle(seed, cfg) {
  const { minWords = 8, attempts = 120, avoid = null, strict = false } = cfg;
  const arng = new RNG(seed);
  let best = null;
  // Сколько первых попыток мы согласны потратить в поисках сетки, полностью
  // свободной от недавних слов. Дальше берём любую подходящую: лишние секунды
  // ожидания хуже, чем пара знакомых слов.
  //
  // Квота намеренно небольшая. Одна генерация сложного уровня стоит ~46 мс, и
  // при квоте 24 хвост распределения доходил до полусекунды залипшего
  // интерфейса — площадка такое считает заметным фризом (§1.15). При 8 верхняя
  // граница держится в пределах ~200 мс, а частота повторов почти не растёт.
  const freshQuota = avoid && avoid.size ? Math.min(8, attempts) : 0;
  /**
   * Сколько СОБРАННЫХ досок осмотреть, прежде чем выбрать из них самую свежую.
   *
   * Считать надо именно собранные, а не попытки. Замер: из 60 попыток на 9×9
   * доска получается 8 раз, на 11×11 — раз или два, остальное отсеивается ещё
   * на заполнении. Пока квота считала попытки, к моменту её исчерпания выбирать
   * было чаще всего не из чего — брали единственное, что собралось, и память
   * недавних слов на больших сетках не работала вовсе.
   *
   * Три — компромисс со временем: каждая лишняя доска на сложном режиме стоит
   * десятка пустых попыток. Ноль повторов принимаем сразу и дальше не ищем.
   */
  const freshLookahead = avoid && avoid.size ? 3 : 1;
  let seenValid = 0;
  // Лучшая по свежести сетка из построенных в пределах квоты.
  //
  // Раньше здесь стояло «всё или ничего»: сетка с единственным недавним словом
  // отвергалась наравне с сеткой, набранной из них целиком, а в запас
  // сохранялась ПЕРВАЯ отвергнутая — то есть случайная. Восемь построенных
  // сеток превращались в одну случайную. Теперь из тех же восьми берётся та, где
  // повторов меньше всего. Генераций столько же — просто их результат больше не
  // выбрасывается.
  let freshest = null;
  for (let i = 0; i < attempts; i++) {
    const s = (arng.next() * 0xffffffff) >>> 0;
    // Строгий заход — только пока мы придирчивы к свежести слов. Дальше он
    // стоил бы вдвое дороже, ничего не меняя: результат всё равно принимается.
    const cw = generateCrossword(s, { ...cfg, tryFresh: i < freshQuota });
    if (!cw) continue;
    cw.seed = seed;
    if (cw.slots.length >= minWords) {
      if (!avoid || !avoid.size) return cw;
      if (!cw.staleCount) return cw;                       // идеал — дальше не ищем
      if (!freshest || cw.staleCount < freshest.staleCount) freshest = cw;
      if (++seenValid >= freshLookahead) return freshest;
      continue;
    }
    // Сетка не добрала minWords — запоминаем лучшую из таких. Сначала по числу
    // слов, при равенстве — по свежести. Раньше свежесть здесь не учитывалась
    // вовсе, и это било сильнее всего по тематическим режимам: их сетки 8×8
    // часто не дотягивают до minWords, и запасная ветка была для них не
    // исключением, а обычным путём — то есть память недавних слов там не
    // работала совсем, сколько её ни увеличивай.
    if (!best
      || cw.slots.length > best.slots.length
      || (cw.slots.length === best.slots.length && cw.staleCount < best.staleCount)) best = cw;
  }
  if (freshest) return freshest;
  if (strict) return null;
  // ни одна не набрала minWords — возвращаем самую заполненную
  if (best) { best.seed = seed; return best; }
  // совсем крайний случай (не должно случаться) — ещё серия попыток
  for (let i = 0; i < attempts; i++) {
    const cw = generateCrossword((arng.next() * 0xffffffff) >>> 0, cfg);
    if (cw) { cw.seed = seed; return cw; }
  }
  return null;
}
