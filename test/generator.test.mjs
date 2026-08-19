/**
 * Юнит-тесты генератора и прикладной логики. Запуск: `npm test` (node, без зависимостей).
 *
 * Проверяем корректность сеток во ВСЕХ режимах, детерминизм (один seed → одна
 * сетка), уникальность (разные seed → разные), палитру букв, память недавних
 * слов, а также серию дней, календарь и достижения.
 *
 * Качество самих словарей проверяет отдельный линтер: `npm run lint:dict`.
 */

import { generatePuzzle } from '../src/game/generator.js';
import { Crossword } from '../src/game/crossword.js';
import { validateCrossword } from '../src/game/validator.js';
import { buildWordPalette } from '../src/game/letterPalette.js';
import { RNG } from '../src/game/rng.js';
import { loadPool, THEME_IDS } from '../src/game/dict/index.js';
import { resolveMode, MODES, themeOfDay, dailySeed } from '../src/game/modes.js';
import { streakLength, bestStreak, restorableDays, monthGrid, dayNumber } from '../src/systems/daily.js';
import { earnedIds, ALL, GROUPS, progressOf } from '../src/systems/achievements.js';

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('  ✗ ' + msg); }
}
const serialize = (cw) => cw.grid.map((row) => row.map((c) => c || '.').join('')).join('\n');

// ---------------------------------------------------------------- 1. Режимы

console.log('Сетки во всех режимах…');
const SPECS = [
  { mode: 'easy' },
  { mode: 'hard' },
  { mode: 'daily', dateKey: '2026-08-17' },
  ...THEME_IDS.map((t) => ({ mode: 'theme', theme: t })),
];

for (const spec of SPECS) {
  const plan = resolveMode(spec);
  const bank = await loadPool(plan.poolId);
  const label = plan.mode + (plan.theme ? ':' + plan.theme : '');

  let built = 0, minWords = Infinity, maxWords = 0, sumFill = 0, invalid = 0;
  const N = 25;
  for (let s = 1; s <= N; s++) {
    let cw;
    try {
      cw = new Crossword({ seed: s * 104729, bank, plan });
    } catch (e) {
      // Ни при каком seed игрок не должен увидеть ошибку вместо кроссворда.
      check(false, `${label}: сетка не собралась (seed ${s * 104729}): ${e.message}`);
      continue;
    }
    built++;
    const { ok, errors } = validateCrossword(cw.puzzle, 5);
    if (!ok) { invalid++; if (invalid <= 2) console.error(`  ✗ ${label} seed ${s}: ${errors[0]}`); }
    minWords = Math.min(minWords, cw.slots.length);
    maxWords = Math.max(maxWords, cw.slots.length);
    sumFill += cw.puzzle.fillRatio;
  }
  const avgFill = sumFill / built;
  console.log(`  ${label.padEnd(18)} слов ${minWords}–${maxWords}, плотность ${avgFill.toFixed(2)}, словарь ${bank.size}`);
  check(built === N, `${label}: собралось только ${built} из ${N}`);
  check(invalid === 0, `${label}: ${invalid} невалидных сеток`);
  check(avgFill >= 0.5, `${label}: сетки недостаточно плотные (${avgFill.toFixed(2)})`);
  // Кроссворд из пяти слов — уже не кроссворд, а недоразумение.
  check(minWords >= 6, `${label}: встречаются сетки всего из ${minWords} слов`);
}

// -------------------------------------------------- 2. Детерминизм и уникальность

console.log('Детерминизм…');
{
  const plan = resolveMode({ mode: 'easy' });
  const bank = await loadPool(plan.poolId);
  for (const seed of [7, 42, 12345]) {
    const a = new Crossword({ seed, bank, plan });
    const b = new Crossword({ seed, bank, plan });
    check(serialize(a) === serialize(b), `seed ${seed} должен давать идентичную сетку`);
  }

  console.log('Уникальность…');
  const seen = new Set();
  for (let seed = 1; seed <= 120; seed++) seen.add(serialize(new Crossword({ seed, bank, plan })));
  console.log(`  уникальных сеток: ${seen.size}/120`);
  check(seen.size >= 116, `слишком много совпадающих сеток: ${seen.size}/120`);
}

console.log('Кроссворд дня…');
{
  // Один и тот же день обязан давать один и тот же кроссворд у всех игроков,
  // разные дни — разные темы и сетки.
  check(dailySeed('2026-08-17') === dailySeed('2026-08-17'), 'seed дня должен быть устойчив');
  check(dailySeed('2026-08-17') !== dailySeed('2026-08-18'), 'разные дни — разные seed');
  const themes = new Set();
  for (let d = 1; d <= 28; d++) themes.add(themeOfDay(`2026-03-${String(d).padStart(2, '0')}`));
  check(themes.size >= 5, `тема дня почти не меняется за месяц: ${themes.size} разных`);
}

// ------------------------------------------------------------- 3. Палитра букв

console.log('Палитра букв…');
{
  const rng = new RNG(99);
  for (const word of ['КОТ', 'ДОРОГА', 'МАМА', 'ПАРОВОЗ']) {
    const extra = 3;
    const p = buildWordPalette(word, rng, extra);
    check(p.length === word.length + extra,
      `размер палитры для «${word}» должен быть ${word.length + extra}, получили ${p.length}`);
    const countLetters = (arr) => arr.reduce((m, l) => (m[l] = (m[l] || 0) + 1, m), {});
    const wc = countLetters([...word]);
    const pc = countLetters(p);
    check(Object.entries(wc).every(([l, n]) => (pc[l] || 0) >= n),
      `палитра для «${word}» должна содержать все буквы слова: ${p.join('')}`);
  }
}

// -------------------------------------------------- 4. Память недавних слов

console.log('Память недавних слов…');
{
  const CAP = 120;
  const plan = resolveMode({ mode: 'easy' });
  const bank = await loadPool(plan.poolId);
  const runSeries = (useMemory) => {
    let recent = [], total = 0;
    const games = [];
    for (let i = 0; i < 12; i++) {
      const seed = (i * 2654435761) >>> 0;                       // детерминированно, без Math.random
      const g = plan.grids[i % plan.grids.length];
      const cw = generatePuzzle(seed, {
        bank, ...g, attempts: 120,
        avoid: useMemory && recent.length ? new Set(recent) : null,
      });
      const words = cw.slots.map((s) => s.answer);
      games.push(words);
      const seen = new Set(words);
      recent = [...words, ...recent.filter((w) => !seen.has(w))].slice(0, CAP);
    }
    for (let i = 1; i < games.length; i++) {
      const prev = new Set(games[i - 1]);
      total += games[i].filter((w) => prev.has(w)).length;
    }
    return total / (games.length - 1);
  };
  const withoutMem = runSeries(false);
  const withMem = runSeries(true);
  console.log(`  повторов с предыдущей партией: без памяти ${withoutMem.toFixed(2)}, с памятью ${withMem.toFixed(2)}`);
  check(withMem < withoutMem, `память слов должна уменьшать повторы (${withMem.toFixed(2)} против ${withoutMem.toFixed(2)})`);
  // Порог подтянут к фактическому результату (около 0.2 повтора на партию).
  // Прежние 2.0 пропускали почти любую регрессию: с памятью получалось 0.55, и
  // поломка механизма свежести теста бы не уронила.
  check(withMem <= 0.6, `слишком много повторов даже с памятью: ${withMem.toFixed(2)}`);
}

// ------------------------------------------------------- 5. Серия и календарь

console.log('Серия дней…');
{
  const T = 20000;   // условное «сегодня» в номерах дней
  check(streakLength(new Set(), T) === 0, 'пустая история — серии нет');
  check(streakLength(new Set([T]), T) === 1, 'решён сегодня — серия 1');
  // Серия не считается прерванной, пока сегодняшний день ещё не кончился.
  check(streakLength(new Set([T - 1, T - 2, T - 3]), T) === 3, 'вчера и раньше — серия жива');
  check(streakLength(new Set([T - 2, T - 3]), T) === 0, 'пропущен вчерашний — серия оборвалась');
  check(streakLength(new Set([T, T - 1, T - 3]), T) === 2, 'считается только непрерывный хвост');

  check(bestStreak(new Set([1, 2, 3, 10, 11])) === 3, 'лучшая серия — самый длинный отрезок');
  check(bestStreak(new Set()) === 0, 'без истории лучшей серии нет');

  // Восстанавливать имеет смысл только пропуск, примыкающий к решённым дням.
  const days = new Set([T - 1, T - 3, T - 4]);
  const restorable = restorableDays(days, T);
  check(restorable.includes(T - 2), 'пропуск между решёнными днями восстановим');
  check(!restorable.includes(T), 'сегодняшний день не предлагается к восстановлению');
  check(!restorable.some((d) => days.has(d)), 'решённые дни не предлагаются к восстановлению');

  // Закрытие дыры действительно склеивает серию — ради этого всё и затевалось.
  const before = streakLength(days, T);
  days.add(T - 2);
  check(streakLength(days, T) > before, `восстановление должно удлинять серию (${before} → ${streakLength(days, T)})`);

  const grid = monthGrid(2026, 7);   // август 2026
  check(grid.length % 7 === 0, 'календарь должен быть кратен неделе');
  const firstDay = grid.find((d) => d !== null);
  check(firstDay === dayNumber(new Date(2026, 7, 1)), 'первая клетка месяца — первое число');
}

// ---------------------------------------------------------- 6. Достижения

console.log('Достижения…');
{
  const empty = {
    solved: 0, words: 0, noHints: 0, byMode: {}, byTheme: {}, themesTried: 0, streak: 0, streakBest: 0,
    uniqueWords: 0,
  };
  check(earnedIds(empty).length === 0, 'у нового игрока достижений нет');

  const some = { ...empty, solved: 10, streakBest: 7, byMode: { easy: 10 }, themesTried: 3 };
  const ids = earnedIds(some);
  check(ids.includes('total.0') && ids.includes('total.1'), 'десять кроссвордов закрывают первые две ступени');
  check(ids.includes('streak.1'), 'недельная серия закрывает ступень «Неделя»');
  check(!ids.includes('streak.2'), 'двухнедельная ступень при семи днях не выдаётся');
  check(ids.includes('themes.0'), 'три темы закрывают первую тематическую ступень');

  // Словарный запас считает РАЗНЫЕ слова, а не сумму по кроссвордам: у игрока
  // с сотней отгаданных слов вторая ступень (200) закрыться не должна.
  const vocab = { ...empty, words: 900, uniqueWords: 100 };
  const vids = earnedIds(vocab);
  check(vids.includes('vocab.0'), 'полсотни разных слов закрывают первую ступень словаря');
  check(!vids.includes('vocab.1'), 'ступень на 200 слов не выдаётся при сотне разных');

  // Прогресс не должен уходить за цель — иначе полоска вылезет за рамку.
  for (const a of ALL) {
    const p = progressOf(a, some);
    check(p.value <= p.goal, `прогресс «${a.title}» больше цели`);
  }

  // Пороги внутри группы обязаны расти: иначе высшая ступень выдаётся раньше низшей.
  for (const g of GROUPS) {
    for (let i = 1; i < g.levels.length; i++) {
      check(g.levels[i].goal > g.levels[i - 1].goal,
        `в группе «${g.title}» пороги идут не по возрастанию`);
    }
  }

  const idSet = new Set(ALL.map((a) => a.id));
  check(idSet.size === ALL.length, 'идентификаторы достижений должны быть уникальны');
  const titles = new Set(ALL.map((a) => a.title));
  check(titles.size === ALL.length, 'названия достижений должны быть уникальны');
}

// ------------------------------------------------------------ 7. Режимы: конфигурация

console.log('Конфигурация режимов…');
{
  for (const [id, m] of Object.entries(MODES)) {
    check(m.grids.length > 0, `у режима «${id}» нет ни одной сетки`);
    const plan = resolveMode({ mode: id, dateKey: '2026-08-17' });
    check(!!plan.poolId, `у режима «${id}» не определился словарь`);
    for (const g of plan.grids) {
      // Слово во всю строку превращает доску в словарный квадрат, который
      // почти никогда не собирается (проверено на 7×7).
      check(g.maxRun < g.size, `${id}: maxRun ${g.maxRun} не меньше размера ${g.size}`);
    }
  }
}


// ------------------------------------------------- 8. Курсор и закрытые клетки

console.log('Курсор не встаёт на закрытую клетку…');
{
  const plan = resolveMode({ mode: 'easy' });
  const bank = await loadPool(plan.poolId);

  // Ищем сетку, где у какого-нибудь слова первая буква принадлежит другому,
  // уже отгаданному слову, — ровно та ситуация, на которую жаловались: курсор
  // садился на готовую букву, и первое нажатие игрока уходило впустую.
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked < 5; seed++) {
    const cw = new Crossword({ seed: seed * 7919, bank, plan });

    // Открываем первое слово целиком — его буквы становятся закрытыми.
    cw.selectSlot(cw.slots[0]);
    cw.revealWord();

    for (const slot of cw.slots) {
      if (cw.isSlotComplete(slot)) continue;
      const head = { r: slot.row, c: slot.col };
      if (cw.isCellEditable(head.r, head.c)) continue;   // не тот случай

      checked++;
      cw.selectSlot(slot);
      const cur = cw.activeCell;
      check(cw.isCellEditable(cur.r, cur.c),
        `seed ${seed}: после выбора слова курсор стоит на закрытой клетке`);
      check(cw.slotCells(slot).some((p) => p.r === cur.r && p.c === cur.c),
        `seed ${seed}: курсор ушёл за пределы выбранного слова`);

      // Ввод в эту позицию обязан записаться, а не пропасть.
      const letter = cw.grid[cur.r][cur.c];
      const before = cw.entries[cur.r][cur.c];
      check(cw.inputAt(cur.r, cur.c, letter) === true,
        `seed ${seed}: буква не записалась в клетку, на которую встал курсор`);
      check(cw.entries[cur.r][cur.c] === letter && before !== letter,
        `seed ${seed}: буква записалась не туда`);
      break;
    }
  }
  check(checked > 0, 'не нашлось ни одной сетки с закрытой первой буквой — проверка не выполнена');
  console.log(`  проверено случаев: ${checked}`);

  // advanceCursorEditable должен перепрыгивать закрытые клетки, а не вставать на них.
  const cw = new Crossword({ seed: 4242, bank, plan });
  cw.selectSlot(cw.slots[0]);
  cw.revealWord();
  const cross = cw.slots.find((s) => !cw.isSlotComplete(s) &&
    cw.slotCells(s).some((p) => !cw.isCellEditable(p.r, p.c)));
  if (cross) {
    cw.selectSlot(cross);
    const seen = [];
    for (let i = 0; i < cross.len; i++) {
      seen.push({ ...cw.activeCell });
      cw.advanceCursorEditable(1);
    }
    check(seen.every((p) => cw.isCellEditable(p.r, p.c)),
      'при движении по слову курсор останавливался на закрытой клетке');
  }
}

if (failures === 0) { console.log('\n✓ Все тесты пройдены'); process.exit(0); }
else { console.error(`\n✗ Провалено проверок: ${failures}`); process.exit(1); }
