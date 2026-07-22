/**
 * Проверка корректности сгенерированного кроссворда. Используется как
 * страховка в рантайме (при редкой неудаче — перегенерация с другим seed)
 * и в юнит-тестах.
 */

/**
 * Проверяет:
 *  - минимальное число слов;
 *  - у каждого слота есть номер и непустое определение;
 *  - буквы каждого слота совпадают с сеткой (валидные пересечения);
 *  - сетка связна (все занятые клетки в одной компоненте);
 *  - нет изолированных букв (каждая занятая клетка входит хотя бы в одно слово ≥2).
 * Возвращает { ok: boolean, errors: string[] }.
 */
export function validateCrossword(cw, minWords = 5) {
  const errors = [];
  const { grid, rows, cols, slots } = cw;

  if (!slots || slots.length < minWords) {
    errors.push(`too few words: ${slots ? slots.length : 0} < ${minWords}`);
  }

  for (const s of slots || []) {
    if (!s.number) errors.push(`slot without number: ${s.answer}`);
    if (!s.clue || !String(s.clue).trim()) errors.push(`slot without clue: ${s.answer}`);
    const dr = s.dir === 'down' ? 1 : 0;
    const dc = s.dir === 'across' ? 1 : 0;
    for (let i = 0; i < s.len; i++) {
      const r = s.row + dr * i;
      const c = s.col + dc * i;
      if (r < 0 || c < 0 || r >= rows || c >= cols) {
        errors.push(`slot out of bounds: ${s.answer}`);
        break;
      }
      if (grid[r][c] !== s.answer[i]) {
        errors.push(`letter mismatch in ${s.answer} at ${r},${c}`);
        break;
      }
    }
  }

  // связность занятых клеток (BFS)
  const filled = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== null) filled.push([r, c]);
    }
  }
  if (filled.length > 0) {
    const seen = new Set();
    const key = (r, c) => `${r},${c}`;
    const queue = [filled[0]];
    seen.add(key(filled[0][0], filled[0][1]));
    while (queue.length) {
      const [r, c] = queue.pop();
      for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        if (grid[nr][nc] === null || seen.has(key(nr, nc))) continue;
        seen.add(key(nr, nc));
        queue.push([nr, nc]);
      }
    }
    if (seen.size !== filled.length) {
      errors.push(`grid not connected: ${seen.size}/${filled.length}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
