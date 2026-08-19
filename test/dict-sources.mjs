/**
 * Общий для тестов список словарных паков и их загрузка.
 *
 * Отдельным модулем — потому что нужен и линтеру (`lint-dict.mjs`), и тестам
 * генератора: одна и та же таблица не должна расходиться в двух местах.
 */

import { THEME_IDS } from '../src/game/dict/index.js';
import { GRIDS, MODES } from '../src/game/modes.js';

/**
 * Предельная длина слова, которое ВООБЩЕ может попасть в сетку, — считается из
 * самой «длинной» геометрии режима, а не задаётся числом руками: поднимут
 * `maxRun` в `modes.js` — проверка подстроится сама.
 */
function maxRunFor(modeIds) {
  let m = 0;
  for (const id of modeIds) {
    for (const g of MODES[id].grids) m = Math.max(m, GRIDS[g].maxRun);
  }
  return m;
}

export const MAX_WORD_LEN = maxRunFor(['easy', 'hard']);
export const MAX_THEME_WORD_LEN = maxRunFor(['theme', 'daily']);

export const POOL_FILES = [
  { id: 'easy', file: '../src/game/dict/pool.easy.js', maxLen: MAX_WORD_LEN },
  { id: 'standard', file: '../src/game/dict/pool.standard.js', maxLen: MAX_WORD_LEN },
  { id: 'hard', file: '../src/game/dict/pool.hard.js', maxLen: MAX_WORD_LEN },
  ...THEME_IDS.map((id) => ({
    id: `theme:${id}`,
    file: `../src/game/dict/theme.${id}.js`,
    maxLen: MAX_THEME_WORD_LEN,
  })),
];

export async function loadLines(file) {
  const mod = await import(file);
  return mod.LINES;
}
