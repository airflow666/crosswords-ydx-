/**
 * Разбор словарного «пака» — общий формат для всех пулов слов.
 *
 * Запись — одна строка `'СЛОВО|определение'`. Формат выбран ради размера
 * бандла: на нескольких тысячах записей объектный синтаксис
 * `{ a: '…', c: '…' }` добавляет к сборке десятки килобайт чистой пунктуации,
 * а разбирается строка ровно один раз — при первой загрузке пула.
 *
 * Нормализация ответа: верхний регистр, Ё→Е (иначе буквы на пересечениях не
 * совпадут), только кириллица, минимум три буквы. Одно слово может иметь
 * несколько определений — они собираются в `clues`, а генератор выбирает
 * вариант детерминированно по seed.
 *
 * `rank` — «кроссвордная» сложность слова, наследуется от пака целиком:
 *   1 — простое (бытовая лексика, определение «в лоб»);
 *   2 — обычное для классического кроссворда;
 *   3 — выше среднего: слово знакомое, но вспоминается не сразу.
 * Генератор использует ранг только для ПРЕДПОЧТЕНИЯ порядка кандидатов,
 * никогда — как жёсткий фильтр: иначе сетка перестала бы собираться.
 */

export const RANK_EASY = 1;
export const RANK_STANDARD = 2;
export const RANK_HARD = 3;

function normalizeAnswer(a) {
  return String(a).trim().toUpperCase().replace(/Ё/g, 'Е');
}

/**
 * Собрать записи словаря из одного или нескольких паков.
 *
 * @param {Array<{lines: string[], rank: number}>} parts
 * @returns {Array<{answer: string, clues: string[], rank: number}>}
 *
 * При совпадении слова в нескольких паках берётся НАИМЕНЬШИЙ ранг: если слово
 * встречается и в простом, и в сложном наборе, оно объективно простое, и
 * выдавать его за сложное нечестно по отношению к игроку.
 */
export function buildEntries(parts) {
  const byAnswer = new Map();
  for (const { lines, rank } of parts) {
    for (const line of lines) {
      const i = line.indexOf('|');
      if (i < 0) continue;
      const answer = normalizeAnswer(line.slice(0, i));
      const clue = line.slice(i + 1).trim();
      if (!clue) continue;
      if (!/^[А-Я]{3,}$/.test(answer)) continue;
      let rec = byAnswer.get(answer);
      if (!rec) { rec = { answer, clues: [], rank }; byAnswer.set(answer, rec); }
      if (rank < rec.rank) rec.rank = rank;
      if (!rec.clues.includes(clue)) rec.clues.push(clue);
    }
  }
  return [...byAnswer.values()];
}
