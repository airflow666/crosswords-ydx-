/** Экран игры: сетка, строка определения, ввод через палитру букв, подсказки. */

import { el, clear, toast, modal, closeTopModal } from '../ui.js';
import { t } from '../systems/i18n.js';
import { audio } from '../systems/audio.js';
import { saves } from '../systems/saves.js';
import { ads } from '../systems/ads.js';
import { Crossword } from '../game/crossword.js';
import { buildPalette } from '../game/letterPalette.js';
import { RNG } from '../game/rng.js';

const ACROSS = 'across';
const DOWN = 'down';

export function renderGame(ctx, { seed, level = 'medium', restore = null }) {
  const cw = new Crossword(seed, level, restore);
  const startedAt = Date.now() - (restore?.elapsedMs || 0);

  ctx.sdk.gameplayStart();

  const cellNodes = []; // [r][c] -> node | null
  const clueItemNodes = new Map(); // slot -> node (боковая панель определений)

  // --- разметка экрана ---
  const cluebarText = el('div.text');
  const cluebar = el('div.cluebar', {}, [
    el('button.nav', { onclick: () => step(-1), 'aria-label': t('prevClue') }, '‹'),
    cluebarText,
    el('button.nav', { onclick: () => step(1), 'aria-label': t('nextClue') }, '›'),
  ]);

  const hintBadge = el('span.hint-badge', {}, String(cw.hintsLeft));
  const hintBtn = el('button.btn.hint-btn', { onclick: onHint }, [t('hint') + ' ', hintBadge]);
  const soundBtn = el('button.icon-btn', { onclick: toggleSound }, saves.soundOn ? '🔊' : '🔈');

  const gridEl = el('div.grid');
  const gridBoard = el('div.grid-board', {}, gridEl);
  const gridWrap = el('div.grid-wrap', {}, gridBoard);

  // Постоянная панель ввода снизу (не всплывает и не двигает доску) — 8 клавиш-букв
  // для активной клетки + «стереть». Всегда в потоке раскладки: доска сама
  // помещается над ней, ничего не прыгает при выборе клетки.
  const paletteBar = el('div.palette-bar');

  // Боковая панель со списком определений — видна на широких экранах (десктоп/планшет).
  const cluePanel = el('aside.clue-panel');

  const screen = el('div.screen.game-screen', {}, [
    el('div.gtop', {}, [
      el('button.icon-btn', { onclick: exitToMenu, 'aria-label': t('menu') }, '‹'),
      el('span.spacer'),
      el('button.icon-btn.clue-toggle', { onclick: showAllClues, 'aria-label': t('allClues') }, '☰'),
      soundBtn,
      hintBtn,
    ]),
    el('div.game-body', {}, [
      el('div.board-area', {}, [cluebar, gridWrap, paletteBar]),
      cluePanel,
    ]),
  ]);

  // --- построение сетки ---
  for (let r = 0; r < cw.rows; r++) {
    cellNodes[r] = [];
    for (let c = 0; c < cw.cols; c++) {
      if (!cw.cellHasLetter(r, c)) {
        cellNodes[r][c] = null;
        gridEl.appendChild(el('div.cell.block'));
        continue;
      }
      const node = el('div.cell', { onclick: () => onCellTap(r, c) });
      const num = cw.numbers[r][c];
      if (num) node.appendChild(el('span.num', {}, String(num)));
      const ch = el('span.ch');
      node.appendChild(ch);
      node._ch = ch;
      cellNodes[r][c] = node;
      gridEl.appendChild(node);
    }
  }
  gridEl.style.gridTemplateColumns = `repeat(${cw.cols}, var(--cs))`;
  gridEl.style.gridTemplateRows = `repeat(${cw.rows}, var(--cs))`;

  ctx.mount(screen);
  window.__game = { cw, cellNodes, tap: onCellTap }; // для отладки и автотестов
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('keydown', onKey);
  // ResizeObserver пересчитывает размер клеток, когда flex-раскладка устаканилась
  // (первый синхронный layout() может увидеть ещё не финальную ширину контейнера).
  const ro = new ResizeObserver(() => layout());
  ro.observe(gridWrap);
  screen._cleanup = () => {
    window.removeEventListener('resize', layout);
    window.removeEventListener('keydown', onKey);
    ro.disconnect();
  };
  requestAnimationFrame(layout);

  buildCluePanel();
  refreshAll();
  renderPalette();

  // --- размер клеток под доступное место ---
  // Философия масштаба: на телефоне заполняем ШИРИНУ (клетки крупные и читаемые),
  // а если сетка высокая — поле прокручивается по вертикали, активная клетка сама
  // въезжает в видимую область. На широких экранах вмещаем доску целиком.
  function layout() {
    const boardPad = 24; // приблизительные поля карточки-доски (clamp 6–14px × 2 + отступ wrap)
    const availW = gridWrap.clientWidth - boardPad;
    const availH = gridWrap.clientHeight - boardPad;
    if (availW <= 0 || availH <= 0) return;
    const gap = 4;
    const isWide = window.matchMedia('(min-width: 900px)').matches;
    const MIN = 16;
    const MAX = isWide ? 64 : 52;
    const fitW = (availW - gap * (cw.cols - 1)) / cw.cols;
    const fitH = (availH - gap * (cw.rows - 1)) / cw.rows;
    // Телефон: масштабируем строго по ШИРИНЕ — все столбцы и слова «по горизонтали»
    // видны целиком, ничего не обрезается; по высоте, если не влезло, поле
    // прокручивается (активная клетка сама въезжает в вид). Десктоп: доска целиком.
    const target = isWide ? Math.min(fitW, fitH) : fitW;
    const cs = Math.round(Math.max(MIN, Math.min(target, MAX)));
    gridEl.style.setProperty('--cs', cs + 'px');
    gridEl.style.setProperty('font-size', cs + 'px');
    scrollActiveIntoView();
  }

  /** Подкрутить поле так, чтобы активная клетка была видна (при вводе и прокрутке). */
  function scrollActiveIntoView() {
    if (!cw.activeCell) return;
    const node = cellNodes[cw.activeCell.r]?.[cw.activeCell.c];
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // --- обновление отображения ---
  function refreshAll() {
    for (let r = 0; r < cw.rows; r++) {
      for (let c = 0; c < cw.cols; c++) refreshCell(r, c);
    }
    highlight();
    updateCluebar();
    updateCluePanel();
  }

  function refreshCell(r, c) {
    const node = cellNodes[r][c];
    if (!node) return;
    node._ch.textContent = cw.entries[r][c] || '';
    node.classList.toggle('locked', cw.locked.has(`${r},${c}`));
  }

  function highlight() {
    const active = new Set(cw.activeSlotCells().map((p) => `${p.r},${p.c}`));
    for (let r = 0; r < cw.rows; r++) {
      for (let c = 0; c < cw.cols; c++) {
        const node = cellNodes[r][c];
        if (!node) continue;
        node.classList.toggle('active-word', active.has(`${r},${c}`));
        node.classList.toggle(
          'active',
          cw.activeCell && cw.activeCell.r === r && cw.activeCell.c === c
        );
      }
    }
  }

  function updateCluebar() {
    const s = cw.activeSlot;
    clear(cluebarText);
    if (!s) return;
    const done = cw.isSlotComplete(s);
    cluebarText.appendChild(
      el('div', {}, [
        el('span.tag', {}, `${done ? '✓ ' : ''}${s.number} ${s.dir === ACROSS ? t('across') : t('down')}`),
        el('div.body', {}, s.clue),
      ])
    );
  }

  // --- боковая панель определений (широкие экраны) ---
  function buildCluePanel() {
    clear(cluePanel);
    clueItemNodes.clear();
    const across = cw.slots.filter((s) => s.dir === ACROSS);
    const down = cw.slots.filter((s) => s.dir === DOWN);
    const section = (title, list) => {
      const items = list.map((s) => {
        const node = el('div.clue-item', { onclick: () => selectFromList(s) }, [
          el('b', {}, String(s.number)),
          s.clue,
        ]);
        clueItemNodes.set(s, node);
        return node;
      });
      return el('div.clue-col', {}, [el('h3', {}, title), ...items]);
    };
    cluePanel.append(section(t('across'), across), section(t('down'), down));
  }

  function updateCluePanel() {
    for (const [s, node] of clueItemNodes) {
      node.classList.toggle('done', cw.isSlotComplete(s));
      node.classList.toggle('sel', s === cw.activeSlot);
    }
  }

  function selectFromList(slot) {
    cw.selectSlot(slot);
    afterSelect();
  }

  // --- взаимодействие ---
  function onCellTap(r, c) {
    cw.selectCell(r, c);
    afterSelect();
  }

  /** Общие действия после смены выбранной клетки/слота. */
  function afterSelect() {
    highlight();
    updateCluebar();
    updateCluePanel();
    scrollActiveIntoView();
    renderPalette();
  }

  /** Перейти к предыдущему/следующему слоту в списке. */
  function step(dir) {
    const list = cw.slots;
    const idx = list.indexOf(cw.activeSlot);
    const next = list[(idx + dir + list.length) % list.length];
    cw.selectSlot(next);
    afterSelect();
  }

  // --- постоянная панель букв: палитра на ВСЁ активное слово ---
  // Одна строка на каждую клетку слова — каждая со своим набором из 8 букв
  // (детерминирован по координатам клетки). Тап по букве пишет ИМЕННО в эту
  // клетку — без «перескакивания» на следующую свободную. Если слово уже
  // полностью и верно отгадано — строки скрыты, редактирование запрещено.
  function renderPalette() {
    clear(paletteBar);
    const slot = cw.activeSlot;
    if (!slot) return;

    if (cw.isSlotComplete(slot)) {
      paletteBar.appendChild(el('div.pal-solved', {}, '✓ ' + t('wordSolved')));
      return;
    }

    const rows = el('div.pal-word-rows');
    let activeRowNode = null;
    cw.activeSlotCells().forEach(({ r, c }, i) => {
      const filled = cw.entries[r][c];
      const isActive = !!(cw.activeCell && cw.activeCell.r === r && cw.activeCell.c === c);
      const locked = cw.locked.has(`${r},${c}`);
      // Пустая клетка — нейтральная точка-плейсхолдер, а не номер: цифры здесь
      // легко спутать с номерами подсказок на самой сетке (у них разная нумерация).
      const badge = el(
        'button.pal-row-badge',
        { onclick: () => onFocusCell(r, c) },
        filled || '·'
      );
      const row = el('div.pal-row' + (isActive ? '.active' : '') + (locked ? '.locked' : ''), {}, [badge]);
      if (!locked) {
        const keys = el('div.pal-row-keys');
        const rng = new RNG((cw.seed ^ ((r + 1) * 73856093) ^ ((c + 1) * 19349663)) >>> 0);
        for (const L of buildPalette(cw.grid[r][c], rng, 8)) {
          keys.appendChild(el('button.pal-key', { onclick: () => onLetterAt(r, c, L) }, L));
        }
        row.appendChild(keys);
      }
      rows.appendChild(row);
      if (isActive) activeRowNode = row;
    });
    paletteBar.append(rows, el('button.erase-key', { onclick: onErase }, '⌫ ' + t('erase')));
    activeRowNode?.scrollIntoView({ block: 'nearest' });
  }

  /** Записать букву; общая логика для тап- и клавиатурного ввода.
   *  Возвращает true, если кроссворд только что решён (экран уже сменился). */
  function writeLetter(r, c, L) {
    if (!cw.inputAt(r, c, L)) return false;
    const prevSlot = cw.activeSlot;
    audio.tap();
    refreshAll();
    persist();
    if (prevSlot && cw.isSlotComplete(prevSlot)) flashSlot(prevSlot);
    if (cw.isSolved()) { onSolved(); return true; }
    return false;
  }

  /** Тап по букве в конкретной строке палитры — просто перерисовать палитру на месте. */
  function onLetterAt(r, c, L) {
    if (writeLetter(r, c, L)) return;
    renderPalette();
    scrollActiveIntoView();
  }

  /** Тап по «бейджу» строки — просто перевести курсор на эту клетку (без ввода буквы). */
  function onFocusCell(r, c) {
    cw.focusCell(r, c);
    highlight();
    renderPalette();
    scrollActiveIntoView();
  }

  function onErase() {
    cw.backspace();
    audio.erase();
    refreshAll();
    persist();
    renderPalette();
    scrollActiveIntoView();
  }

  /** Ввод с физической клавиатуры (десктоп): буквы двигают курсор дальше по слову, Backspace, стрелки. */
  function onKey(e) {
    const key = e.key;
    if (key === 'Escape') { e.preventDefault(); if (closeTopModal()) return; exitToMenu(); return; }
    if (!cw.activeCell) return;
    if (key === 'Backspace') { e.preventDefault(); onErase(); return; }
    if (key === 'ArrowLeft') { e.preventDefault(); moveCell(0, -1); return; }
    if (key === 'ArrowRight') { e.preventDefault(); moveCell(0, 1); return; }
    if (key === 'ArrowUp') { e.preventDefault(); moveCell(-1, 0); return; }
    if (key === 'ArrowDown') { e.preventDefault(); moveCell(1, 0); return; }
    const up = key.toUpperCase().replace('Ё', 'Е');
    if (up.length === 1 && /[А-Я]/.test(up)) { e.preventDefault(); onKeyboardLetter(up); }
  }

  /** Буква с клавиатуры пишется в активную клетку и двигает курсор к следующей клетке слова. */
  function onKeyboardLetter(L) {
    const { r, c } = cw.activeCell;
    if (writeLetter(r, c, L)) return;
    cw.advanceCursor(1);
    afterSelect();
  }

  function moveCell(dr, dc) {
    let { r, c } = cw.activeCell;
    for (let step = 0; step < Math.max(cw.rows, cw.cols); step++) {
      r += dr; c += dc;
      if (r < 0 || c < 0 || r >= cw.rows || c >= cw.cols) return;
      if (cw.cellHasLetter(r, c)) { onCellTap(r, c); return; }
    }
  }

  function flashSlot(slot) {
    audio.word();
    const dr = slot.dir === DOWN ? 1 : 0;
    const dc = slot.dir === ACROSS ? 1 : 0;
    for (let i = 0; i < slot.len; i++) {
      const node = cellNodes[slot.row + dr * i][slot.col + dc * i];
      if (!node) continue;
      node.classList.remove('solved-flash');
      void node.offsetWidth; // рестарт анимации
      node.classList.add('solved-flash');
    }
  }

  // --- подсказка (rewarded) ---
  async function onHint() {
    if (cw.hintsLeft <= 0) { toast(t('noHintsLeft')); return; }
    const proceed = await confirmAd();
    if (!proceed) return;
    const rewarded = await ads.showRewarded();
    if (!rewarded) { toast(t('adUnavailable')); return; }
    const revealed = cw.useHint();
    hintBadge.textContent = String(cw.hintsLeft);
    refreshAll();
    persist();
    for (const { r, c } of revealed) {
      const node = cellNodes[r][c];
      node.classList.remove('solved-flash'); void node.offsetWidth; node.classList.add('solved-flash');
    }
    if (cw.isSolved()) onSolved();
  }

  function confirmAd() {
    return new Promise((resolve) => {
      const box = el('div.modal', {}, [
        el('h2', {}, '💡'),
        el('p', {}, t('hintWatchAd')),
        el('div.actions', {}, [
          el('button.btn.primary', { onclick: () => { resolve(true); ov.close(); } }, t('watch')),
          el('button.btn.ghost', { onclick: () => { resolve(false); ov.close(); } }, t('cancel')),
        ]),
      ]);
      const ov = modal(box, { closable: true, onClose: () => resolve(false) });
    });
  }

  // --- все определения + выход в меню ---
  function showAllClues() {
    const across = cw.slots.filter((s) => s.dir === ACROSS);
    const down = cw.slots.filter((s) => s.dir === DOWN);
    const col = (title, list) =>
      el('div.clue-col', {}, [
        el('h3', {}, title),
        ...list.map((s) =>
          el(
            'div.clue-item' + (cw.isSlotComplete(s) ? '.done' : ''),
            { onclick: () => { ov.close(); cw.selectSlot(s); afterSelect(); } },
            [el('b', {}, String(s.number)), s.clue]
          )
        ),
      ]);
    const box = el('div.modal', {}, [
      el('div.clue-list-cols', {}, [col(t('across'), across), col(t('down'), down)]),
      el('div.actions', {}, [
        el('button.btn', { onclick: () => ov.close() }, t('back')),
        // Явный выход в меню (без рекламы) — доступен и по ESC, и здесь.
        el('button.btn.ghost', { onclick: () => { ov.close(); exitToMenu(); } }, t('exitToMenu')),
      ]),
    ]);
    const ov = modal(box, { closable: true });
  }

  // --- звук ---
  function toggleSound() {
    const on = saves.toggleSound();
    audio.setEnabled(on);
    soundBtn.textContent = on ? '🔊' : '🔈';
  }

  // --- сохранение прогресса (возобновление после перезагрузки) ---
  function persist() {
    const state = cw.serialize();
    state.elapsedMs = Date.now() - startedAt;
    saves.saveCurrent(state);
  }

  function exitToMenu() {
    persist();
    ctx.sdk.gameplayStop();
    ctx.go('menu');
  }

  function onSolved() {
    audio.win();
    ctx.sdk.gameplayStop();
    const timeSec = Math.round((Date.now() - startedAt) / 1000);
    const { isBest } = saves.recordSolved(timeSec);
    ctx.go('results', { crossword: cw, timeSec, isBest, level });
  }
}
