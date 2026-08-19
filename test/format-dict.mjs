/**
 * Форматтер словарных паков: раскладывает строки по секциям длины и
 * сортирует внутри секции по алфавиту.
 *
 * Нужен затем, что вручную группу «5 букв» не удержать — слово случайно
 * попадает не в свою секцию, и комментарий начинает врать. Скрипт переписывает
 * массив `LINES` в файле, ничего не трогая ни до, ни после него.
 *
 * Запуск: `node test/format-dict.mjs src/game/dict/pool.standard.js [...]`
 */

import { readFileSync, writeFileSync } from 'node:fs';

// `--max=N` убирает слова длиннее N букв. Нужен для тематических паков: у их
// сеток предел слова ниже, чем у общих, и слово в восемь букв туда физически не
// поместится ни при каком раскладе. Удалённое печатается — молча терять
// написанное нельзя, его лучше перенести в общий пул.
const args = process.argv.slice(2);
const maxArg = args.find((a) => a.startsWith('--max='));
const MAX = maxArg ? Number(maxArg.slice(6)) : Infinity;
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Укажите файлы паков');
  process.exit(1);
}

const FORMS = ['', '', '', 'три', 'четыре', 'пять', 'шесть'];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('export const LINES = [');
  if (start < 0) { console.error(`${file}: не найден LINES`); process.exit(1); }
  const open = src.indexOf('[', start);
  const close = src.lastIndexOf('];');
  const body = src.slice(open + 1, close);

  const lines = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const byLen = new Map();
  const dropped = [];
  for (const line of lines) {
    const i = line.indexOf('|');
    const len = line.slice(0, i).replace(/Ё/g, 'Е').length;
    if (len > MAX) { dropped.push(line); continue; }
    if (!byLen.has(len)) byLen.set(len, []);
    byLen.get(len).push(line);
  }
  if (dropped.length) {
    console.log(`  убрано как слишком длинное (> ${MAX}):`);
    for (const d of dropped) console.log(`    ${d}`);
  }

  const out = [];
  for (const len of [...byLen.keys()].sort((a, b) => a - b)) {
    const group = [...new Set(byLen.get(len))].sort((a, b) => a.localeCompare(b, 'ru'));
    out.push(`  // === ${FORMS[len] || len} ${len === 1 ? 'буква' : len < 5 ? 'буквы' : 'букв'} (${group.length}) ===`);
    for (const l of group) out.push(`  '${l}',`);
    out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();

  writeFileSync(file, `${src.slice(0, open + 1)}\n${out.join('\n')}\n${src.slice(close)}`);
  console.log(`${file}: ${lines.length} строк разложено по ${byLen.size} секциям`);
}
