/**
 * Что из прежнего словаря игры ещё не разобрано по темам.
 *
 * Запуск: `node test/mine-dict.mjs [> остаток.txt]`
 *
 * Зачем. Первые два прохода по темам шли по памяти: берём подобласть из
 * `src/game/dict/AREAS.md` и вспоминаем, что в неё попадает. Способ работает,
 * пока область не вычерпана, а дальше упирается в потолок припоминания —
 * предлагается почти исключительно то, что уже написано.
 *
 * Третий проход идёт от источника, и лучший источник лежит в самом
 * репозитории: `dictionary.ru.js` — 4600 слов с определениями, уже прошедших
 * модерацию площадки. Скрипт вычитает из него всё, что уже разложено по
 * тематическим пакам и общим пулам, и печатает остаток. По остатку видно не
 * «что я могу вспомнить про кухню», а «что в словаре есть и лежит без темы» —
 * это принципиально другой вопрос, и отдача у него выше.
 *
 * Остаток печатается вместе с прежними определениями: они пригодятся как
 * подсказка о значении, но переносить их в тематический пак дословно не надо.
 * Определение в теме должно звучать по-своему: одно и то же слово в «Природе»
 * и в «Кухне» определяется с разных сторон.
 *
 * Границы 3–7 букв — предел тематических сеток (`MAX_THEME_WORD_LEN`), слова
 * длиннее в них не попадут ни при каком раскладе.
 */

import { MAX_THEME_WORD_LEN } from './dict-sources.mjs';
import { THEME_IDS } from '../src/game/dict/index.js';
import { RAW_LINES } from '../src/game/dictionary.ru.js';
import { readFileSync } from 'node:fs';

const DICT = new URL('../src/game/dict/', import.meta.url);
const norm = (w) => w.trim().toUpperCase().replace(/Ё/g, 'Е');

/**
 * Ответы пака читаются из ИСХОДНИКА, а не через импорт: так скрипт видит и те
 * паки, которые сейчас редактируются и временно не собираются.
 */
function answersOf(name) {
  const src = readFileSync(new URL(`${name}.js`, DICT), 'utf8');
  const open = src.indexOf('[', src.indexOf('export const LINES = ['));
  const close = src.lastIndexOf('];');
  return [...src.slice(open + 1, close).matchAll(/'([^']*)'/g)]
    .map((m) => m[1])
    .filter((l) => l.includes('|'))
    .map((l) => norm(l.slice(0, l.indexOf('|'))));
}

const taken = new Set();
for (const name of [...THEME_IDS.map((t) => `theme.${t}`), 'pool.standard', 'pool.hard']) {
  for (const a of answersOf(name)) taken.add(a);
}

const rest = new Map();
for (const line of RAW_LINES) {
  const i = line.indexOf('|');
  if (i < 0) continue;
  const answer = norm(line.slice(0, i));
  if (!/^[А-Я]+$/.test(answer)) continue;
  if (answer.length < 3 || answer.length > MAX_THEME_WORD_LEN) continue;
  if (taken.has(answer) || rest.has(answer)) continue;
  rest.set(answer, line.slice(i + 1).trim());
}

const out = [...rest.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
console.error(`Разобрано по темам: ${taken.size}. Осталось в источнике: ${out.length}`);
for (const [answer, clue] of out) console.log(`${answer}|${clue}`);
