/**
 * Индекс словаря для быстрого подбора слов по шаблону (для backtracking-заполнения
 * плотной сетки). Для каждой длины храним список слов и позиционный индекс
 * «буква на позиции → номера слов», чтобы мгновенно находить кандидатов под
 * частично заполненный слот вида  _О_О_.
 */

import { DICTIONARY } from './dictionary.ru.js';

const perLen = new Map(); // len -> { words:string[], posIndex: Array(len) of Map<char,int[]> }
const clueOf = new Map(); // answer -> clue

for (const { answer, clue } of DICTIONARY) {
  if (!clueOf.has(answer)) clueOf.set(answer, clue);
  const L = answer.length;
  let bucket = perLen.get(L);
  if (!bucket) {
    bucket = { words: [], posIndex: Array.from({ length: L }, () => new Map()) };
    perLen.set(L, bucket);
  }
  const idx = bucket.words.length;
  bucket.words.push(answer);
  for (let p = 0; p < L; p++) {
    const ch = answer[p];
    let arr = bucket.posIndex[p].get(ch);
    if (!arr) { arr = []; bucket.posIndex[p].set(ch, arr); }
    arr.push(idx);
  }
}

export function clueFor(answer) {
  return clueOf.get(answer) || '';
}

export function lengthsAvailable() {
  return [...perLen.keys()].sort((a, b) => a - b);
}

export function countOfLength(len) {
  return perLen.get(len)?.words.length || 0;
}

/** Общая часть: позиция-ограничение с наименьшим списком (или спец. значения). */
function pickAnchor(bucket, len, constraints) {
  let anyFixed = false, bestArr = null, bestPos = -1;
  for (let p = 0; p < len; p++) {
    if (constraints[p] == null) continue;
    anyFixed = true;
    const arr = bucket.posIndex[p].get(constraints[p]);
    if (!arr) return { empty: true };            // буквы нет на позиции → 0 кандидатов
    if (!bestArr || arr.length < bestArr.length) { bestArr = arr; bestPos = p; }
  }
  return { anyFixed, bestArr, bestPos };
}

/**
 * Кандидаты для слота длины len с ограничениями constraints (массив длины len:
 * буква или null). Возвращает НОВЫЙ массив слов (можно перемешивать).
 */
export function candidates(len, constraints) {
  const bucket = perLen.get(len);
  if (!bucket) return [];
  const a = pickAnchor(bucket, len, constraints);
  if (a.empty) return [];
  if (!a.anyFixed) return bucket.words.slice();
  const out = [];
  outer: for (const idx of a.bestArr) {
    const w = bucket.words[idx];
    for (let p = 0; p < len; p++) {
      if (p === a.bestPos || constraints[p] == null) continue;
      if (w[p] !== constraints[p]) continue outer;
    }
    out.push(w);
  }
  return out;
}

/**
 * Быстрый ПОДСЧЁТ кандидатов, не входящих в used, без выделения массива — для
 * MRV-эвристики в генераторе (вызывается для каждого слота на каждом шаге).
 * Останавливается, как только счётчик достигнет `cap` (нам важен только минимум).
 */
export function countCandidates(len, constraints, used, cap) {
  const bucket = perLen.get(len);
  if (!bucket) return 0;
  const a = pickAnchor(bucket, len, constraints);
  if (a.empty) return 0;
  let n = 0;
  if (!a.anyFixed) {
    for (const w of bucket.words) { if (!used.has(w)) { if (++n >= cap) return n; } }
    return n;
  }
  outer: for (const idx of a.bestArr) {
    const w = bucket.words[idx];
    for (let p = 0; p < len; p++) {
      if (p === a.bestPos || constraints[p] == null) continue;
      if (w[p] !== constraints[p]) continue outer;
    }
    if (!used.has(w)) { if (++n >= cap) return n; }
  }
  return n;
}
