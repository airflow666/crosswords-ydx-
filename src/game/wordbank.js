/**
 * Индекс словаря для быстрого подбора слов по шаблону (для backtracking-заполнения
 * плотной сетки). Для каждой длины храним список слов и позиционный индекс
 * «буква на позиции → номера слов», чтобы мгновенно находить кандидатов под
 * частично заполненный слот вида  _О_О_.
 *
 * Раньше индекс был один на всю игру и строился на уровне модуля. Теперь
 * словарей несколько (лёгкий, стандартный, сложный, двенадцать тематических),
 * и каждый пул получает СВОЙ экземпляр `WordBank`, который создаётся только
 * тогда, когда игрок действительно выбрал соответствующий режим. Это и даёт
 * тематические кроссворды, и убирает словарь из критического пути загрузки.
 */

export class WordBank {
  /**
   * @param {Array<{answer:string, clues:string[], rank:number}>} entries
   * @param {string} [id] — для отладки и кеша
   */
  constructor(entries, id = '') {
    this.id = id;
    this.entries = entries;
    this._perLen = new Map();  // len -> { words:string[], posIndex: Array(len) of Map<char,int[]> }
    this._clueOf = new Map();  // answer -> string[]
    this._rankOf = new Map();  // answer -> 1|2|3

    for (const { answer, clues, rank } of entries) {
      if (this._clueOf.has(answer)) continue;
      this._clueOf.set(answer, clues);
      this._rankOf.set(answer, rank);
      const L = answer.length;
      let bucket = this._perLen.get(L);
      if (!bucket) {
        bucket = { words: [], posIndex: Array.from({ length: L }, () => new Map()) };
        this._perLen.set(L, bucket);
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
  }

  get size() { return this._clueOf.size; }

  /**
   * Определение к слову. Если у слова несколько значений, вариант выбирается по
   * `salt` — детерминированно, чтобы при возобновлении партии из seed игрок
   * увидел ровно то же определение, что и до перезагрузки.
   */
  clueFor(answer, salt = 0) {
    const list = this._clueOf.get(answer);
    if (!list || !list.length) return '';
    if (list.length === 1) return list[0];
    return list[Math.abs(salt) % list.length];
  }

  /** Кроссвордная сложность слова (см. pack.js). Неизвестное слово считаем обычным. */
  rankOf(answer) {
    return this._rankOf.get(answer) ?? 2;
  }

  lengthsAvailable() {
    return [...this._perLen.keys()].sort((a, b) => a - b);
  }

  countOfLength(len) {
    return this._perLen.get(len)?.words.length || 0;
  }

  /** Общая часть: позиция-ограничение с наименьшим списком (или спец. значения). */
  _pickAnchor(bucket, len, constraints) {
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
  candidates(len, constraints) {
    const bucket = this._perLen.get(len);
    if (!bucket) return [];
    const a = this._pickAnchor(bucket, len, constraints);
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
  countCandidates(len, constraints, used, cap) {
    const bucket = this._perLen.get(len);
    if (!bucket) return 0;
    const a = this._pickAnchor(bucket, len, constraints);
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
}
