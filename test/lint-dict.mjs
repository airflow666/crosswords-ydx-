/**
 * Линтер словарных паков. Запуск: `npm run lint:dict`.
 *
 * Проверяет то, что глазами не вычитывается: длину слов (всё длиннее шести букв
 * в сетку не попадёт и только утяжеляет сборку), латиницу в определениях,
 * повторяющиеся определения у разных слов, ответ внутри собственного
 * определения, пустые определения. Плюс печатает распределение по длинам —
 * по нему видно, хватит ли пулу коротких слов, чтобы заполнить плотную сетку.
 */

import { POOL_FILES, loadLines } from './dict-sources.mjs';
import { THEME_IDS, loadPool } from '../src/game/dict/index.js';

/**
 * Прежний словарь игры (`easy`) уже прошёл модерацию и живёт в продакшене.
 * Мы его линтуем, но замечания по нему не валят проверку: точные дубликаты
 * строк и двухбуквенные слова из него всё равно отсеивает `buildEntries`, а
 * переписывать выпущенное содержимое ради красоты отчёта незачем. Новые паки —
 * строго.
 */
const LEGACY = new Set(['easy']);

let problems = 0;
const warned = new Map();
function bad(pool, msg) {
  if (LEGACY.has(pool)) {
    warned.set(pool, (warned.get(pool) || 0) + 1);
    return;
  }
  problems++;
  if (problems <= 200) console.error(`  ✗ [${pool}] ${msg}`);
}

// Кириллица, пробелы и обычная пунктуация определений. Латиница здесь —
// почти всегда случайно набранная в русской раскладке буква (a, c, e, o, p, x),
// которую в тексте не отличить на глаз, а поиск и озвучка на ней спотыкаются.
const CLUE_OK = /^[А-Яа-яЁё0-9 ,.:;!?()«»„“”\-–—'’]+$/;

for (const { id, file, maxLen } of POOL_FILES) {
  let lines;
  try {
    lines = await loadLines(file);
  } catch {
    console.log(`${id.padEnd(18)} — файла ещё нет, пропускаем`);
    continue;
  }
  // Прежний словарь игры прошёл модерацию и правится только по делу: длинные
  // слова в нём — вопрос лишнего веса сборки, а не ошибки, поэтому для него
  // это замечание, а не провал.
  const lengthIsFatal = id !== 'easy';
  let tooLong = 0;
  const byClue = new Map();
  const byAnswer = new Map();
  const lens = new Map();

  for (const line of lines) {
    const i = line.indexOf('|');
    if (i < 0) { bad(id, `нет разделителя: «${line}»`); continue; }
    const answer = line.slice(0, i).trim().toUpperCase().replace(/Ё/g, 'Е');
    const clue = line.slice(i + 1).trim();

    if (!/^[А-Я]+$/.test(answer)) { bad(id, `в ответе не только кириллица: «${answer}»`); continue; }
    if (answer.length < 3) { bad(id, `слишком короткое слово: «${answer}»`); continue; }
    // Слово длиннее самого длинного слота режима в сетку не попадёт никогда —
    // это чистый вес сборки. В прежнем словаре такие есть, и это его право:
    // он выпущен и проверен. В новых паках — ошибка.
    if (answer.length > maxLen) {
      tooLong++;
      if (lengthIsFatal) bad(id, `слово длиннее ${maxLen} букв, в сетку этого режима не попадёт: «${answer}» (${answer.length})`);
      continue;
    }
    if (!clue) { bad(id, `пустое определение у «${answer}»`); continue; }
    if (!CLUE_OK.test(clue)) { bad(id, `посторонние символы в определении «${answer}»: «${clue}»`); }

    // Ответ не должен просвечивать в собственном определении — ни целиком, ни
    // корнем: «Ель — хвойное дерево» решается без единой мысли.
    const stem = answer.slice(0, Math.max(4, answer.length - 2));
    if (clue.toUpperCase().replace(/Ё/g, 'Е').includes(stem)) {
      bad(id, `ответ виден в своём определении: «${answer}» — «${clue}»`);
    }

    const prevAnswer = byClue.get(clue.toLowerCase());
    if (prevAnswer && prevAnswer !== answer) {
      bad(id, `одно определение у двух слов: «${prevAnswer}» и «${answer}» — «${clue}»`);
    }
    byClue.set(clue.toLowerCase(), answer);

    const clues = byAnswer.get(answer) || [];
    if (clues.includes(clue)) bad(id, `дубликат строки: «${answer}|${clue}»`);
    clues.push(clue);
    byAnswer.set(answer, clues);

    lens.set(answer.length, (lens.get(answer.length) || 0) + 1);
  }

  const hist = [...lens.entries()].sort((a, b) => a[0] - b[0])
    .map(([l, n]) => `${l}:${n}`).join('  ');
  const notes = [];
  if (tooLong && !lengthIsFatal) notes.push(`длиннее ${maxLen} букв: ${tooLong}`);
  if (warned.get(id)) notes.push(`замечаний: ${warned.get(id)}`);
  const note = notes.length ? `   (${notes.join(', ')})` : '';
  console.log(`${id.padEnd(18)} слов: ${String(byAnswer.size).padStart(4)}   ${hist}${note}`);
}

/**
 * Второй проход — по СОБРАННЫМ пулам, а не по отдельным пакам.
 *
 * Сложный режим склеивает `standard` и `hard`, поэтому в `pool.hard.js` нет ни
 * одного трёхбуквенного слова и не должно быть: короткие слова приходят из
 * стандартного пула. Проверять на достаточность коротких слов надо ровно то,
 * с чем в итоге работает генератор. Здесь же ловятся и определения, которые
 * совпали у двух слов из РАЗНЫХ паков одного пула.
 */
console.log('\nСобранные пулы:');
for (const poolId of ['easy', 'hard', ...THEME_IDS.map((t) => `theme:${t}`)]) {
  let bank;
  try {
    bank = await loadPool(poolId);
  } catch {
    console.log(`${poolId.padEnd(18)} — пак ещё не написан, пропускаем`);
    continue;
  }
  const lens = new Map();
  const seenClue = new Map();
  for (const { answer, clues } of bank.entries) {
    lens.set(answer.length, (lens.get(answer.length) || 0) + 1);
    for (const clue of clues) {
      const key = clue.toLowerCase();
      const prev = seenClue.get(key);
      if (prev && prev !== answer) bad(poolId, `одно определение у «${prev}» и «${answer}»: «${clue}»`);
      seenClue.set(key, answer);
    }
  }
  const hist = [...lens.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l}:${n}`).join('  ');
  console.log(`${poolId.padEnd(18)} слов: ${String(bank.size).padStart(4)}   ${hist}`);

  // Плотную сетку нечем заполнять, если коротких слов почти нет: короткие слова
  // затыкают промежутки между длинными, и без них backtracking упирается в тупик.
  const short = (lens.get(3) || 0) + (lens.get(4) || 0);
  if (short < 40) bad(poolId, `мало коротких слов (3–4 буквы): ${short}, нужно хотя бы 40`);
  if (bank.size < 150) bad(poolId, `в пуле всего ${bank.size} слов — плотную сетку не собрать`);
}

if (problems) {
  console.error(`\nПроблем: ${problems}`);
  process.exit(1);
}
console.log('\nСловари в порядке.');
