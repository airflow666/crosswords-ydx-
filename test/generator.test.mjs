/**
 * Юнит-тесты генератора кроссвордов. Запуск: `npm test` (node, без зависимостей).
 * Проверяем корректность сеток, детерминизм (один seed → одна сетка),
 * уникальность (разные seed → разные сетки) и палитру букв.
 */

import { generateCrossword, generatePuzzle } from '../src/game/generator.js';
import { validateCrossword } from '../src/game/validator.js';
import { buildPalette } from '../src/game/letterPalette.js';
import { RNG } from '../src/game/rng.js';

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + msg);
  }
}

function serialize(cw) {
  return cw.grid.map((row) => row.map((c) => c || '.').join('')).join('\n');
}

// 1. Корректность на 1000 seed'ах (публичная точка входа с гарантией плотности)
console.log('1000 сеток: корректность (связность, пересечения, определения)…');
let minWords = Infinity, maxWords = 0;
for (let seed = 1; seed <= 1000; seed++) {
  const cw = generatePuzzle(seed, 'medium');
  const { ok, errors } = validateCrossword(cw, 8);
  if (!ok) {
    failures++;
    console.error(`  ✗ seed ${seed}: ${errors[0]}`);
    if (failures > 5) break;
  }
  minWords = Math.min(minWords, cw.slots.length);
  maxWords = Math.max(maxWords, cw.slots.length);
}
console.log(`  слов в сетке: от ${minWords} до ${maxWords}`);

// 2. Детерминизм: один seed → идентичная сетка
console.log('Детерминизм…');
for (const seed of [7, 42, 12345]) {
  const a = serialize(generatePuzzle(seed, 'medium'));
  const b = serialize(generatePuzzle(seed, 'medium'));
  check(a === b, `seed ${seed} должен давать идентичную сетку`);
}

// 3. Уникальность: разные seed → в основном разные сетки
console.log('Уникальность…');
const seen = new Set();
let dupes = 0;
for (let seed = 1; seed <= 200; seed++) {
  const s = serialize(generatePuzzle(seed, 'medium'));
  if (seen.has(s)) dupes++;
  seen.add(s);
}
check(dupes < 10, `слишком много совпадающих сеток среди 200: ${dupes}`);
console.log(`  уникальных сеток: ${seen.size}/200 (дублей ${dupes})`);

// 4. Палитра букв: всегда содержит правильную и ровно 8 уникальных
console.log('Палитра букв…');
const rng = new RNG(99);
for (const letter of ['А', 'О', 'К', 'М', 'Ы', 'Ь', 'Ю']) {
  const p = buildPalette(letter, rng, 8);
  check(p.length === 8, `палитра должна быть из 8 букв, а не ${p.length}`);
  check(new Set(p).size === 8, `буквы в палитре должны быть уникальны (${letter})`);
  check(p.includes(letter), `палитра должна содержать правильную букву ${letter}`);
}

// 5. Все три уровня сложности генерируются валидно
console.log('Уровни сложности…');
for (const level of ['easy', 'medium', 'hard']) {
  const cw = generateCrossword(2024, level);
  const { ok, errors } = validateCrossword(cw, 4);
  check(ok, `уровень ${level}: ${errors[0] || ''}`);
}

if (failures === 0) {
  console.log('\n✓ Все тесты пройдены');
  process.exit(0);
} else {
  console.error(`\n✗ Провалено проверок: ${failures}`);
  process.exit(1);
}
