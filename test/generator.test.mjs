/**
 * Юнит-тесты плотного генератора. Запуск: `npm test` (node, без зависимостей).
 * Проверяем корректность сеток, плотность, детерминизм (один seed → одна сетка),
 * уникальность (разные seed → разные) и палитру букв.
 */

import { generatePuzzle } from '../src/game/generator.js';
import { validateCrossword } from '../src/game/validator.js';
import { buildWordPalette } from '../src/game/letterPalette.js';
import { RNG } from '../src/game/rng.js';
import { DICTIONARY } from '../src/game/dictionary.ru.js';

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('  ✗ ' + msg); }
}
const serialize = (cw) => cw.grid.map((row) => row.map((c) => c || '.').join('')).join('\n');

// 1. Корректность + плотность на N seed'ах каждого уровня
const SWEEP = { easy: 200, medium: 150, hard: 80 };
for (const level of ['easy', 'medium', 'hard']) {
  console.log(`Уровень ${level}: корректность и плотность…`);
  let minWords = Infinity, maxWords = 0, sumFill = 0, n = 0, fails = 0;
  for (let seed = 1; seed <= SWEEP[level]; seed++) {
    const cw = generatePuzzle(seed, level);
    if (!cw) { failures++; console.error(`  ✗ seed ${seed}: генерация вернула null`); break; }
    const { ok, errors } = validateCrossword(cw, 5);
    if (!ok) { fails++; if (fails <= 3) console.error(`  ✗ seed ${seed}: ${errors[0]}`); }
    minWords = Math.min(minWords, cw.slots.length);
    maxWords = Math.max(maxWords, cw.slots.length);
    sumFill += cw.fillRatio; n++;
  }
  const avgFill = sumFill / n;
  console.log(`  слов: ${minWords}–${maxWords}, средняя плотность: ${avgFill.toFixed(2)}`);
  check(fails === 0, `${level}: ${fails} невалидных сеток`);
  check(avgFill >= 0.5, `${level}: сетки недостаточно плотные (${avgFill.toFixed(2)})`);
}

// 2. Детерминизм
console.log('Детерминизм…');
for (const seed of [7, 42, 12345]) {
  check(serialize(generatePuzzle(seed, 'medium')) === serialize(generatePuzzle(seed, 'medium')),
    `seed ${seed} должен давать идентичную сетку`);
}

// 3. Уникальность
console.log('Уникальность…');
const seen = new Set();
for (let seed = 1; seed <= 200; seed++) seen.add(serialize(generatePuzzle(seed, 'medium')));
console.log(`  уникальных сеток: ${seen.size}/200`);
check(seen.size >= 195, `слишком много совпадающих сеток: уникальных ${seen.size}/200`);

// 4. Палитра букв (на всё слово: буквы слова + несколько лишних)
console.log('Палитра букв…');
const rng = new RNG(99);
for (const word of ['КОТ', 'ДОРОГА', 'МАМА', 'ПАРОВОЗ']) {
  const extra = 3;
  const p = buildWordPalette(word, rng, extra);
  check(p.length === word.length + extra, `размер палитры для «${word}» должен быть ${word.length + extra}, получили ${p.length}`);
  const sortedWord = [...word].sort().join('');
  const wordLettersInPalette = [...p].filter((l) => word.includes(l));
  // хотя бы все буквы слова (с повторами) должны присутствовать в палитре
  const countLetters = (arr) => arr.reduce((m, l) => (m[l] = (m[l] || 0) + 1, m), {});
  const wc = countLetters([...word]);
  const pc = countLetters(p);
  const hasAll = Object.entries(wc).every(([l, n]) => (pc[l] || 0) >= n);
  check(hasAll, `палитра для «${word}» должна содержать все буквы слова: ${p.join('')}`);
  check(sortedWord.length > 0, 'sanity');
}

// 5. Словарь достаточно велик и покрывает нужные длины
console.log('Словарь…');
const byLen = {};
for (const w of DICTIONARY) byLen[w.answer.length] = (byLen[w.answer.length] || 0) + 1;
check(DICTIONARY.length >= 800, `словарь маловат: ${DICTIONARY.length}`);
for (const L of [3, 4, 5, 6, 7]) check((byLen[L] || 0) >= 20, `мало слов длины ${L}: ${byLen[L] || 0}`);
// генератор берёт только слова длиной ≤ maxRun (6) — их должно быть много
check(DICTIONARY.filter((w) => w.answer.length <= 6).length >= 1000,
  `мало слов, которые реально используются в сетках (≤6 букв)`);

// 6. Качество определений (регрессии сюда возвращались уже дважды)
console.log('Качество определений…');
const norm = (s) => s.toUpperCase().replace(/Ё/g, 'Е');

// 6a. одно и то же определение у РАЗНЫХ слов — игрок не может выбрать ответ
const byClue = new Map();
for (const w of DICTIONARY) {
  for (const c of w.clues) {
    const k = c.toLowerCase().trim();
    if (!byClue.has(k)) byClue.set(k, new Set());
    byClue.get(k).add(w.answer);
  }
}
const ambiguous = [...byClue.entries()].filter(([, v]) => v.size > 1);
check(ambiguous.length === 0,
  `двусмысленные определения: ${ambiguous.slice(0, 3).map(([c, v]) => `"${c}" → ${[...v].join('/')}`).join('; ')}`);

// 6b. ответ не должен быть виден в собственном определении
const spoilers = [];
for (const w of DICTIONARY) for (const c of w.clues) if (norm(c).includes(w.answer)) spoilers.push(`${w.answer}: ${c}`);
check(spoilers.length === 0, `ответ виден в определении: ${spoilers.slice(0, 3).join('; ')}`);

// 6c. только кириллица в определениях (игра RU-only, требование площадки)
const latin = [];
for (const w of DICTIONARY) for (const c of w.clues) if (/[a-zA-Z]/.test(c) || !c.trim()) latin.push(`${w.answer}: ${c}`);
check(latin.length === 0, `латиница/пустое определение: ${latin.slice(0, 3).join('; ')}`);

if (failures === 0) { console.log('\n✓ Все тесты пройдены'); process.exit(0); }
else { console.error(`\n✗ Провалено проверок: ${failures}`); process.exit(1); }
