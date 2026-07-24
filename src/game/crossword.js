/**
 * Рантайм-модель партии поверх сгенерированной сетки.
 *
 * Хранит введённые игроком буквы, текущий выбор (слот/клетка), считает
 * прогресс, детектит победу и раздаёт подсказки. Сериализуется в компактный
 * вид { seed, level, filled, hintsUsed } для облачного сохранения и
 * возобновления после перезагрузки (требование модерации 1.9).
 */

import { generatePuzzle } from './generator.js';
import { RNG } from './rng.js';

export const MAX_HINTS = 3;
// Потолок букв, раскрываемых одной подсказкой (реальное число зависит от того,
// сколько букв в слове ещё не отгадано — см. useHint).
const HINT_LETTERS_MAX = 3;

const ACROSS = 'across';
const DOWN = 'down';

export class Crossword {
  /**
   * @param {number} seed
   * @param {'easy'|'medium'|'hard'} level
   * @param {object} [restore] — сохранённое состояние { filled, hintsUsed }
   */
  constructor(seed, level = 'medium', restore = null) {
    this.puzzle = generatePuzzle(seed, level);
    // Генератор в норме всегда что-то возвращает (внутри много попыток и
    // запасной путь), но если сетку собрать не удалось — падать белым экраном
    // нельзя: пробуем соседний seed, а затем самый простой уровень.
    if (!this.puzzle) this.puzzle = generatePuzzle((seed ^ 0x9e3779b9) >>> 0, level);
    if (!this.puzzle) this.puzzle = generatePuzzle((seed ^ 0x9e3779b9) >>> 0, 'easy');
    if (!this.puzzle) throw new Error('generatePuzzle failed');
    this.seed = seed;
    this.level = level;
    const { rows, cols } = this.puzzle;

    // введённые буквы: та же геометрия, что и grid; null там, где клетки нет
    this.entries = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => (this.puzzle.grid[r][c] === null ? null : ''))
    );
    this.hintsUsed = 0;
    // клетки, раскрытые подсказкой — их нельзя стирать
    this.locked = new Set();

    if (restore) this._restore(restore);

    // индекс слотов по клеткам для быстрого выбора
    this._buildCellIndex();

    // текущий выбор
    this.activeDir = ACROSS;
    this.activeSlot = this.slots.find((s) => s.dir === ACROSS) || this.slots[0];
    this.activeCell = this.activeSlot ? { r: this.activeSlot.row, c: this.activeSlot.col } : null;
  }

  get grid() { return this.puzzle.grid; }
  get numbers() { return this.puzzle.numbers; }
  get slots() { return this.puzzle.slots; }
  get rows() { return this.puzzle.rows; }
  get cols() { return this.puzzle.cols; }
  get hintsLeft() { return MAX_HINTS - this.hintsUsed; }

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

  /** Выбрать слот по объекту (из списка определений). */
  selectSlot(slot) {
    this.activeSlot = slot;
    this.activeDir = slot.dir;
    this.activeCell = { r: slot.row, c: slot.col };
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
   * Можно ли редактировать букву в клетке: клетка не раскрыта подсказкой
   * (`locked`) и не входит в АКТИВНОЕ слово, которое уже полностью и верно
   * отгадано — уже решённое слово трогать нельзя, чтобы случайно не сломать.
   * (Если та же клетка входит ещё и в другое, ещё не решённое слово —
   * редактирование остаётся доступным, когда именно ТО слово активно.)
   */
  isCellEditable(r, c) {
    if (this.locked.has(`${r},${c}`)) return false;
    if (this.activeSlot && this.isSlotComplete(this.activeSlot)) return false;
    return true;
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

  /** Стереть букву в конкретной клетке (раскрытые подсказкой и клетки решённого слова не трогаем). */
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
   * Клавиша Backspace: если в активной клетке есть буква — стереть её (курсор
   * остаётся на месте); если клетка уже пуста — сдвинуть курсор на клетку
   * назад и стереть там (классический для текстовых полей ввод). Раскрытые
   * подсказкой и клетки решённого слова не трогает.
   */
  backspace() {
    if (!this.activeCell) return;
    const { r, c } = this.activeCell;
    if (this.entries[r][c]) {
      this.eraseAt(r, c);
      return;
    }
    this.advanceCursor(-1);
    const p = this.activeCell;
    this.eraseAt(p.r, p.c);
  }

  // --- подсказки ---

  /**
   * Раскрыть буквы В ТЕКУЩЕМ слове — так подсказка помогает именно там, где
   * игрок сейчас застрял (приём из больших кроссвордных приложений: «открыть
   * букву» всегда относится к выбранному слову, а не к случайному месту доски).
   * Если текущее слово уже отгадано — берём следующее неразгаданное.
   *
   * Раскрывается примерно половина оставшихся букв слова (минимум одна, не
   * больше HINT_LETTERS_MAX). Раскрытые клетки попадают в `locked`: они сразу
   * засчитываются как верные и больше не редактируются (в том числе стиранием).
   *
   * Возвращает массив раскрытых клеток {r,c}.
   */
  useHint() {
    if (this.hintsLeft <= 0) return [];
    const rng = new RNG((this.seed ^ (this.hintsUsed + 1) * 0x1000193) >>> 0);

    const slot = this.activeSlot && !this.isSlotComplete(this.activeSlot)
      ? this.activeSlot
      : this.nextUnsolvedSlot();

    // клетки выбранного слова, где ещё нет правильной буквы
    let candidates = this.slotCells(slot).filter(({ r, c }) => this.entries[r][c] !== this.puzzle.grid[r][c]);
    // на всякий случай (слот не нашёлся / уже верен) — любые неверные клетки доски
    if (!candidates.length) candidates = this.wrongCells();
    if (!candidates.length) return [];

    rng.shuffle(candidates);
    // Примерно треть оставшихся букв, но не меньше одной: подсказка должна
    // сдвигать с мёртвой точки, а не решать слово за игрока (их всего 3 за партию).
    const count = Math.max(1, Math.min(HINT_LETTERS_MAX, Math.floor(candidates.length / 3)));
    const revealed = candidates.slice(0, count);
    for (const { r, c } of revealed) {
      this.entries[r][c] = this.puzzle.grid[r][c];
      this.locked.add(`${r},${c}`);
    }
    this.hintsUsed++;
    // курсор — на первую ещё редактируемую пустую клетку слова, чтобы после
    // подсказки палитра сразу писала в осмысленное место, а не в закрытую клетку
    this.focusFirstEditable(slot);
    return revealed;
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
    const free = cells.filter(({ r, c }) => !this.locked.has(`${r},${c}`));
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

  /** Следующее неразгаданное слово после `from` (по кругу) — для автоперехода. */
  nextUnsolvedSlot(from = this.activeSlot) {
    const list = this.slots;
    if (!list.length) return null;
    const start = Math.max(0, list.indexOf(from));
    for (let i = 1; i <= list.length; i++) {
      const s = list[(start + i) % list.length];
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
    return { seed: this.seed, level: this.level, filled, locked, hintsUsed: this.hintsUsed };
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
    this.hintsUsed = state.hintsUsed || 0;
  }
}
