/**
 * Рантайм-модель партии поверх сгенерированной сетки.
 *
 * Хранит введённые игроком буквы, текущий выбор (слот/клетка), считает
 * прогресс, детектит победу и применяет бустеры. Сериализуется в компактный
 * вид для облачного сохранения и возобновления после перезагрузки
 * (требование модерации 1.9).
 *
 * Словарь модель не выбирает — он приходит снаружи готовым (`bank`), потому что
 * зависит от режима и грузится асинхронно.
 */

import { generatePuzzle } from './generator.js';
import { RNG } from './rng.js';

// Сколько букв раскидывает бустер «россыпь».
export const SCATTER_LETTERS = 5;

const ACROSS = 'across';
const DOWN = 'down';

export class Crossword {
  /**
   * @param {object} opts
   * @param {number} opts.seed
   * @param {object} opts.bank — WordBank выбранного режима
   * @param {object} opts.plan — результат resolveMode(): grids, preferHard, mode, theme
   * @param {object} [opts.restore] — сохранённое состояние
   * @param {string[]} [opts.avoidWords] — недавно встречавшиеся игроку слова: генератор
   *   ставит их в конец очереди кандидатов. При возобновлении партии берётся
   *   СНИМОК из сохранения (restore.avoid), иначе сетка по тому же seed могла бы
   *   собраться иначе, чем до перезагрузки.
   */
  constructor({ seed, bank, plan, restore = null, avoidWords = null }) {
    const avoidList = restore?.avoid ?? avoidWords ?? [];
    this.avoid = Array.isArray(avoidList) ? avoidList : [];
    const avoidSet = this.avoid.length ? new Set(this.avoid) : null;

    this.seed = seed;
    this.bank = bank;
    this.mode = plan.mode;
    this.theme = plan.theme;

    // Какая из сеток режима досталась партии. При возобновлении берём
    // сохранённый номер: иначе после перезагрузки размер доски мог бы поменяться.
    const gridIdx = restore?.gridIdx ?? new RNG(seed ^ 0x5bf03635).int(plan.grids.length);
    this.gridIdx = Math.min(gridIdx, plan.grids.length - 1);

    this.puzzle = this._generate(plan, this.gridIdx, avoidSet);
    if (!this.puzzle) throw new Error('generatePuzzle failed');

    const { rows, cols } = this.puzzle;

    // введённые буквы: та же геометрия, что и grid; null там, где клетки нет
    this.entries = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => (this.puzzle.grid[r][c] === null ? null : ''))
    );
    // клетки, раскрытые бустером — их нельзя стирать
    this.locked = new Set();
    // сколько бустеров потрачено на эту партию (для «пройдено без подсказок»)
    this.boostersUsed = 0;

    if (restore) this._restore(restore);

    // индекс слотов по клеткам для быстрого выбора
    this._buildCellIndex();

    // текущий выбор
    this.activeDir = ACROSS;
    this.activeSlot = this.slots.find((s) => s.dir === ACROSS) || this.slots[0];
    this.activeCell = this.activeSlot ? { r: this.activeSlot.row, c: this.activeSlot.col } : null;
  }

  /**
   * Сборка сетки с запасными вариантами. Тематический словарь узкий (одна
   * область — меньше слов), и на крупной сетке кандидатов может не хватить,
   * поэтому при неудаче спускаемся к меньшей геометрии режима, а в самом конце
   * пробуем соседний seed. Белый экран вместо кроссворда недопустим.
   */
  _generate(plan, gridIdx, avoidSet) {
    const order = [gridIdx, ...plan.grids.map((_, i) => i).filter((i) => i !== gridIdx)];
    for (const i of order) {
      const g = plan.grids[i];
      const cw = generatePuzzle(this.seed, {
        bank: this.bank,
        size: g.size,
        maxRun: g.maxRun,
        black: g.black,
        minWords: g.minWords,
        attempts: g.attempts ?? 120,
        avoid: avoidSet,
        preferHard: plan.preferHard,
        // Пока есть куда отступить — требуем полноценную сетку. На последней
        // геометрии режима берём что получится: доска с недобором слов всё же
        // лучше, чем пустой экран.
        strict: i !== order[order.length - 1],
      });
      if (cw) { this.gridIdx = i; return cw; }
    }

    // Последний рубеж. Узкому тематическому словарю не всякий шаблон по силам,
    // и на редких seed'ах не собирается ни одна сетка режима — а игроку в этот
    // момент нужен кроссворд, а не сообщение об ошибке. Поэтому идём на
    // уступки по очереди: сначала другой поток seed'ов на самой мелкой сетке
    // режима, затем совсем маленькая доска. Отступать некуда только после
    // последнего варианта, и до него дело доходить не должно.
    const smallest = plan.grids[plan.grids.length - 1];
    const attemptsPlan = [
      { ...smallest, minWords: 6 },
      { ...smallest, minWords: 5, black: smallest.black + 0.08 },
      { size: 6, maxRun: 5, black: 0.2, minWords: 4 },
    ];
    for (const g of attemptsPlan) {
      for (let k = 1; k <= 4; k++) {
        const cw = generatePuzzle((this.seed ^ (0x9e3779b9 * k)) >>> 0, {
          bank: this.bank,
          size: g.size,
          maxRun: g.maxRun,
          black: g.black,
          minWords: g.minWords,
          attempts: 160,
          avoid: null,
          preferHard: false,
        });
        if (cw) {
          // seed сохраняем исходный: партия должна воспроизводиться из того же
          // числа, которое лежит в сохранении.
          cw.seed = this.seed;
          this.gridIdx = plan.grids.length - 1;
          return cw;
        }
      }
    }
    return null;
  }

  get grid() { return this.puzzle.grid; }
  get numbers() { return this.puzzle.numbers; }
  get slots() { return this.puzzle.slots; }
  get rows() { return this.puzzle.rows; }
  get cols() { return this.puzzle.cols; }

  // --- индекс «клетка → слоты» ---
  _buildCellIndex() {
    this.cellSlots = {}; // "r,c" -> { across, down }
    for (const s of this.slots) {
      const dr = s.dir === DOWN ? 1 : 0;
      const dc = s.dir === ACROSS ? 1 : 0;
      for (let i = 0; i < s.len; i++) {
        const key = `${s.row + dr * i},${s.col + dc * i}`;
        (this.cellSlots[key] ||= {})[s.dir] = s;
      }
    }
  }

  cellHasLetter(r, c) {
    return this.puzzle.grid[r][c] !== null;
  }

  // --- выбор клетки/слота ---

  /** Выбрать клетку. Повторный тап по той же клетке переключает направление. */
  selectCell(r, c) {
    if (!this.cellHasLetter(r, c)) return;
    const key = `${r},${c}`;
    const slots = this.cellSlots[key] || {};
    if (this.activeCell && this.activeCell.r === r && this.activeCell.c === c) {
      // переключить направление, если у клетки есть слот в другом
      const other = this.activeDir === ACROSS ? DOWN : ACROSS;
      if (slots[other]) this.activeDir = other;
    } else if (!slots[this.activeDir]) {
      // в текущем направлении слота нет — берём доступное
      this.activeDir = slots[ACROSS] ? ACROSS : DOWN;
    }
    this.activeCell = { r, c };
    this.activeSlot = slots[this.activeDir] || slots[ACROSS] || slots[DOWN] || null;
  }

  /**
   * Выбрать слот по объекту (из списка определений, стрелок, автоперехода).
   *
   * Курсор ставится на первую клетку, В КОТОРУЮ МОЖНО ПИСАТЬ, а не на первую
   * клетку слова. Разница видна сразу же: у слова, пересечённого уже отгаданным,
   * первая буква часто уже стоит и закрыта от правки — курсор на ней означал,
   * что первое нажатие игрока уходит впустую.
   */
  selectSlot(slot) {
    this.activeSlot = slot;
    this.activeDir = slot.dir;
    this.activeCell = { r: slot.row, c: slot.col };
    this.focusFirstEditable(slot);
  }

  /** Перевести курсор на клетку АКТИВНОГО слова, не меняя сам слот/направление
   *  (тап по «бейджу» строки в палитре — просто переключить фокус, без ввода буквы). */
  focusCell(r, c) {
    this.activeCell = { r, c };
  }

  /** Клетки произвольного слота (массив {r,c}). */
  slotCells(slot) {
    if (!slot) return [];
    const dr = slot.dir === DOWN ? 1 : 0;
    const dc = slot.dir === ACROSS ? 1 : 0;
    const cells = [];
    for (let i = 0; i < slot.len; i++) cells.push({ r: slot.row + dr * i, c: slot.col + dc * i });
    return cells;
  }

  /** Клетки активного слота (массив {r,c}). */
  activeSlotCells() {
    return this.slotCells(this.activeSlot);
  }

  // --- ввод ---

  /**
   * Клетка «закрыта»: её букву нельзя ни изменить, ни стереть.
   *
   * Закрыты буквы, открытые бустером (`locked`), и буквы ЛЮБОГО уже
   * отгаданного слова — неважно, какое слово сейчас активно. Отгаданное слово
   * по определению стоит верно, так что запрет ничего не отнимает у игрока —
   * он лишь защищает от случайной порчи готового.
   */
  isCellLocked(r, c) {
    if (this.locked.has(`${r},${c}`)) return true;
    const slots = this.cellSlots[`${r},${c}`];
    if (slots) {
      if (slots[ACROSS] && this.isSlotComplete(slots[ACROSS])) return true;
      if (slots[DOWN] && this.isSlotComplete(slots[DOWN])) return true;
    }
    return false;
  }

  /** Обратное к isCellLocked — оставлено, потому что читается лучше в местах ввода. */
  isCellEditable(r, c) {
    return !this.isCellLocked(r, c);
  }

  /**
   * Записать букву в КОНКРЕТНУЮ клетку (явный выбор — тап по строке палитры
   * или клавиатура), а не «в следующую свободную». Возвращает true при успехе.
   */
  inputAt(r, c, letter) {
    if (!this.cellHasLetter(r, c) || !this.isCellEditable(r, c)) return false;
    this.entries[r][c] = letter;
    this.activeCell = { r, c };
    return true;
  }

  /** Стереть букву в конкретной клетке (раскрытые бустером и клетки решённого слова не трогаем). */
  eraseAt(r, c) {
    if (!this.cellHasLetter(r, c) || !this.isCellEditable(r, c)) return false;
    this.entries[r][c] = '';
    this.activeCell = { r, c };
    return true;
  }

  /** Сдвинуть курсор на следующую/предыдущую клетку активного слова (клавиатурный ввод). */
  advanceCursor(dir = 1) {
    const cells = this.activeSlotCells();
    const idx = cells.findIndex((p) => p.r === this.activeCell.r && p.c === this.activeCell.c);
    const next = cells[idx + dir];
    if (next) this.activeCell = next;
  }

  /**
   * Сдвинуть курсор к следующей клетке слова, в которую можно писать,
   * перепрыгивая закрытые. Нужен клавиатурному вводу: печатая слово подряд,
   * игрок не должен останавливаться на буквах, доставшихся от пересечений.
   */
  advanceCursorEditable(dir = 1) {
    const cells = this.activeSlotCells();
    const idx = cells.findIndex((p) => p.r === this.activeCell.r && p.c === this.activeCell.c);
    if (idx < 0) return;
    for (let i = idx + dir; i >= 0 && i < cells.length; i += dir) {
      const { r, c } = cells[i];
      if (this.isCellEditable(r, c)) { this.activeCell = { r, c }; return; }
    }
  }

  /** Сдвинуть курсор на ближайшую следующую ПУСТУЮ клетку активного слова
   *  (после ввода буквы через общую палитру на слово — удобно заполнять
   *  подряд). Если дальше пустых клеток нет, курсор остаётся на месте. */
  advanceToNextEmpty() {
    const cells = this.activeSlotCells();
    const idx = cells.findIndex((p) => p.r === this.activeCell.r && p.c === this.activeCell.c);
    for (let i = idx + 1; i < cells.length; i++) {
      const { r, c } = cells[i];
      if (!this.entries[r][c]) { this.activeCell = { r, c }; return; }
    }
  }

  /**
   * Клавиша «Стереть» / Backspace.
   *
   * Если в активной клетке есть стираемая буква — стираем её на месте. Иначе
   * идём назад по слову до ближайшей клетки, которую вообще можно стереть,
   * ПЕРЕПРЫГИВАЯ закрытые и пустые. Без этого «перепрыгивания» повторное
   * нажатие упиралось в закрытую букву и ничего не делало — выглядело как
   * сломанная кнопка.
   *
   * Возвращает true, если что-то стёрли.
   */
  backspace() {
    if (!this.activeCell) return false;
    const cells = this.activeSlotCells();
    const idx = cells.findIndex((p) => p.r === this.activeCell.r && p.c === this.activeCell.c);
    if (idx < 0) return false;

    // текущая клетка, если её есть смысл стирать
    if (this.entries[this.activeCell.r][this.activeCell.c] && this.isCellEditable(this.activeCell.r, this.activeCell.c)) {
      return this.eraseAt(this.activeCell.r, this.activeCell.c);
    }
    // иначе — первая пригодная клетка левее/выше по слову
    for (let i = idx - 1; i >= 0; i--) {
      const { r, c } = cells[i];
      if (this.entries[r][c] && this.isCellEditable(r, c)) {
        this.activeCell = { r, c };
        return this.eraseAt(r, c);
      }
    }
    // стирать в этом слове нечего — просто встаём на первую свободную клетку
    this.focusFirstEditable();
    return false;
  }

  // --- бустеры ---

  /** Раскрыть конкретные клетки и закрыть их от правки. Возвращает список. */
  _reveal(cells) {
    const done = [];
    for (const { r, c } of cells) {
      if (this.entries[r][c] === this.puzzle.grid[r][c] && this.locked.has(`${r},${c}`)) continue;
      this.entries[r][c] = this.puzzle.grid[r][c];
      this.locked.add(`${r},${c}`);
      done.push({ r, c });
    }
    if (done.length) this.boostersUsed++;
    return done;
  }

  /** Слово, к которому относятся бустеры: активное, а если оно решено — следующее нерешённое. */
  targetSlot() {
    return this.activeSlot && !this.isSlotComplete(this.activeSlot)
      ? this.activeSlot
      : this.nextUnsolvedSlot();
  }

  /**
   * Бустер «Буква»: одна буква в текущем слове — там, где игрок застрял.
   * Возвращает массив раскрытых клеток (пустой, если открывать нечего).
   */
  revealLetter() {
    const slot = this.targetSlot();
    let cells = this.slotCells(slot).filter(({ r, c }) => this.entries[r][c] !== this.puzzle.grid[r][c]);
    if (!cells.length) cells = this.wrongCells();
    if (!cells.length) return [];
    const rng = new RNG((this.seed ^ ((this.boostersUsed + 1) * 0x1000193)) >>> 0);
    rng.shuffle(cells);
    const out = this._reveal(cells.slice(0, 1));
    this.focusFirstEditable(this.targetSlot());
    return out;
  }

  /** Бустер «Слово»: раскрывает текущее слово целиком. */
  revealWord() {
    const slot = this.targetSlot();
    if (!slot) return [];
    const cells = this.slotCells(slot).filter(({ r, c }) => this.entries[r][c] !== this.puzzle.grid[r][c]);
    if (!cells.length) return [];
    const out = this._reveal(cells);
    const next = this.nextUnsolvedSlot(slot);
    if (next) { this.selectSlot(next); this.focusFirstEditable(next); }
    return out;
  }

  /**
   * Бустер «Россыпь»: пять случайных букв по всему полю. Слабее «слова» по
   * пользе на клетку (буквы ложатся вразнобой), зато сразу расшевеливает доску
   * в нескольких местах.
   */
  scatter(count = SCATTER_LETTERS) {
    const cells = this.wrongCells();
    if (!cells.length) return [];
    const rng = new RNG((this.seed ^ ((this.boostersUsed + 7) * 0x27220a95)) >>> 0);
    rng.shuffle(cells);
    const out = this._reveal(cells.slice(0, count));
    this.focusFirstEditable(this.targetSlot());
    return out;
  }

  /** Все клетки доски, где стоит не та буква (или пусто). */
  wrongCells() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.puzzle.grid[r][c] === null) continue;
        if (this.entries[r][c] !== this.puzzle.grid[r][c]) out.push({ r, c });
      }
    }
    return out;
  }

  /** Поставить курсор на первую пустую редактируемую клетку слова (иначе — на первую редактируемую). */
  focusFirstEditable(slot = this.activeSlot) {
    const cells = this.slotCells(slot);
    if (!cells.length) return;
    const free = cells.filter(({ r, c }) => this.isCellEditable(r, c));
    const target = free.find(({ r, c }) => !this.entries[r][c]) || free[0] || cells[0];
    this.activeCell = { r: target.r, c: target.c };
  }

  // --- проверка/победа ---

  isCellCorrect(r, c) {
    return this.entries[r][c] === this.puzzle.grid[r][c];
  }

  /** Слот полностью и верно заполнен. */
  isSlotComplete(slot) {
    if (!slot) return false;
    for (const { r, c } of this.slotCells(slot)) {
      if (this.entries[r][c] !== this.puzzle.grid[r][c]) return false;
    }
    return true;
  }

  /** В слоте нет ни одной пустой клетки (буквы могут быть и неверными). */
  isSlotFilled(slot) {
    if (!slot) return false;
    return this.slotCells(slot).every(({ r, c }) => !!this.entries[r][c]);
  }

  /**
   * Слово заполнено целиком, но не сходится. Нужно для честной обратной связи:
   * иначе игрок, вписавший все буквы неправильно, вообще не понимает, почему
   * ничего не происходит. Какая именно буква неверна — не показываем, это
   * оставило бы от головоломки только перебор.
   */
  isSlotWrong(slot) {
    return this.isSlotFilled(slot) && !this.isSlotComplete(slot);
  }

  /**
   * Ближайшее НЕразгаданное слово в направлении `dir` (по кругу).
   * Используется и для автоперехода, и для стрелок «предыдущее/следующее»:
   * листать по уже отгаданным словам смысла нет, игрок ищет, что решать дальше.
   * Возвращает null, если неразгаданных больше нет.
   */
  nextUnsolvedSlot(from = this.activeSlot, dir = 1) {
    const list = this.slots;
    if (!list.length) return null;
    const n = list.length;
    const start = Math.max(0, list.indexOf(from));
    const step = dir < 0 ? -1 : 1;
    for (let i = 1; i <= n; i++) {
      const s = list[(((start + step * i) % n) + n) % n];   // корректный модуль и для отрицательных
      if (!this.isSlotComplete(s)) return s;
    }
    return null;
  }

  /** Сколько слов уже отгадано — для индикатора прогресса. */
  solvedSlotCount() {
    return this.slots.reduce((n, s) => n + (this.isSlotComplete(s) ? 1 : 0), 0);
  }

  /** Все клетки заполнены верно. */
  isSolved() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.puzzle.grid[r][c] === null) continue;
        if (this.entries[r][c] !== this.puzzle.grid[r][c]) return false;
      }
    }
    return true;
  }

  /** Доля заполненных верно клеток (для прогресс-бара). */
  progress() {
    let total = 0, correct = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.puzzle.grid[r][c] === null) continue;
        total++;
        if (this.entries[r][c] === this.puzzle.grid[r][c]) correct++;
      }
    }
    return total ? correct / total : 0;
  }

  // --- сохранение/возобновление ---

  /** Компактное состояние для облака: строки букв + маска раскрытых. */
  serialize() {
    const filled = this.entries.map((row) => row.map((c) => (c === null ? '#' : c || '.')).join('')).join('|');
    const locked = [...this.locked].join(';');
    // avoid обязателен в сохранении: от него зависит, какие слова выберет
    // генератор, поэтому без снимка сетка после перезагрузки могла бы отличаться.
    return {
      seed: this.seed,
      mode: this.mode,
      theme: this.theme,
      gridIdx: this.gridIdx,
      filled,
      locked,
      boostersUsed: this.boostersUsed,
      avoid: this.avoid,
    };
  }

  _restore(state) {
    if (state.filled) {
      const rowsArr = state.filled.split('|');
      for (let r = 0; r < rowsArr.length && r < this.rows; r++) {
        const chars = rowsArr[r].split('');
        for (let c = 0; c < chars.length && c < this.cols; c++) {
          const ch = chars[c];
          if (ch === '#' || ch === '.') continue;
          if (this.entries[r][c] !== null) this.entries[r][c] = ch;
        }
      }
    }
    if (state.locked) for (const k of state.locked.split(';')) if (k) this.locked.add(k);
    this.boostersUsed = state.boostersUsed || 0;
  }
}
