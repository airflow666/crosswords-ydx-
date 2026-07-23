/** Экран игры: сетка, строка определения, ввод через палитру букв, подсказки. */

import { el, clear, toast, modal } from '../ui.js';
import { t } from '../systems/i18n.js';
import { audio } from '../systems/audio.js';
import { saves } from '../systems/saves.js';
import { ads } from '../systems/ads.js';
import { Crossword, MAX_HINTS } from '../game/crossword.js';
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
  let paletteOpen = false;

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
      el('div.board-area', {}, [cluebar, gridWrap]),
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
  // ResizeObserver пересчитывает размер клеток, когда flex-раскладка устаканилась
  // (первый синхронный layout() может увидеть ещё не финальную ширину контейнера).
  const ro = new ResizeObserver(() => layout());
  ro.observe(gridWrap);
  screen._cleanup = () => { window.removeEventListener('resize', layout); ro.disconnect(); };
  requestAnimationFrame(layout);

  buildCluePanel();
  refreshAll();

  // --- размер клеток под доступное место ---
  // Философия масштаба: на телефоне заполняем ШИРИНУ (клетки крупные и читаемые),
  // а если сетка высокая — поле прокручивается по вертикали, активная клетка сама
  // въезжает в видимую область. На широких экранах вмещаем доску целиком.
  function layout() {
    const padB = parseFloat(gridWrap.style.paddingBottom) || 0;
    const boardPad = 32; // приблизительные поля карточки-доски (clamp 8–16px × 2)
    const availW = gridWrap.clientWidth - boardPad;
    const availH = gridWrap.clientHeight - padB - boardPad;
    if (availW <= 0 || availH <= 0) return;
    const gap = 4;
    const isWide = window.matchMedia('(min-width: 900px)').matches;
    // Комфортный размер клетки: если вся доска влезает крупнее MIN — показываем
    // целиком; если нет — держим клетки КРУПНЫМИ (MIN) и разрешаем прокрутку поля,
    // а активная клетка сама въезжает в вид (как в мобильных кроссворд-приложениях).
    const MIN = isWide ? 40 : 34;
    const MAX = isWide ? 64 : 52;
    const fitW = (availW - gap * (cw.cols - 1)) / cw.cols;
    const fitH = (availH - gap * (cw.rows - 1)) / cw.rows;
    const fitBoth = Math.min(fitW, fitH);
    const cs = Math.round(Math.max(MIN, Math.min(fitBoth, MAX)));
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
    cluebarText.appendChild(
      el('div', {}, [
        el('span.tag', {}, `${s.number} ${s.dir === ACROSS ? t('across') : t('down')}`),
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
    highlight();
    updateCluebar();
    updateCluePanel();
    openPalette();
  }

  // --- взаимодействие ---
  function onCellTap(r, c) {
    cw.selectCell(r, c);
    highlight();
    updateCluebar();
    updateCluePanel();
    scrollActiveIntoView();
    openPalette();
  }

  /** Перейти к предыдущему/следующему слоту в списке. */
  function step(dir) {
    const list = cw.slots;
    const idx = list.indexOf(cw.activeSlot);
    const next = list[(idx + dir + list.length) % list.length];
    cw.selectSlot(next);
    highlight();
    updateCluebar();
    updateCluePanel();
    openPalette();
  }

  // --- палитра букв ---
  function openPalette() {
    closePalette();
    if (!cw.activeCell) return;
    const { r, c } = cw.activeCell;
    const correct = cw.grid[r][c];
    // палитра детерминирована для клетки: одинаковый набор при повторных открытиях
    const rng = new RNG((cw.seed ^ ((r + 1) * 73856093) ^ ((c + 1) * 19349663)) >>> 0);
    const letters = buildPalette(correct, rng, 8);

    const backdrop = el('div.palette-backdrop', { onclick: closePalette });
    const pal = el('div.palette');
    for (const L of letters) {
      pal.appendChild(el('button', { onclick: () => onLetter(L) }, L));
    }
    pal.appendChild(el('button.erase-key', { onclick: onErase }, '⌫ ' + t('erase')));
    document.body.append(backdrop, pal);
    screen._palette = [backdrop, pal];
    paletteOpen = true;
    // Освобождаем место под палитрой, чтобы она не перекрывала нижние клетки —
    // ужимаем область сетки на высоту палитры и пересчитываем размер клеток.
    requestAnimationFrame(() => {
      gridWrap.style.paddingBottom = pal.offsetHeight + 24 + 'px';
      layout();
    });
  }

  function closePalette() {
    if (screen._palette) { screen._palette.forEach((n) => n.remove()); screen._palette = null; }
    paletteOpen = false;
    gridWrap.style.paddingBottom = '';
    layout();
  }

  function onLetter(L) {
    const prevSlot = cw.activeSlot;
    cw.input(L);
    audio.tap();
    refreshAll();
    persist();
    if (prevSlot && cw.isSlotComplete(prevSlot)) flashSlot(prevSlot);
    if (cw.isSolved()) { onSolved(); return; }
    // перепривязать палитру к новой активной клетке
    openPalette();
  }

  function onErase() {
    cw.erase();
    audio.erase();
    refreshAll();
    persist();
    openPalette();
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
          el('button.btn.primary', { onclick: () => { ov.remove(); resolve(true); } }, t('watch')),
          el('button.btn.ghost', { onclick: () => { ov.remove(); resolve(false); } }, t('cancel')),
        ]),
      ]);
      const ov = modal(box, { closable: true, onClose: () => resolve(false) });
    });
  }

  // --- все определения ---
  function showAllClues() {
    const across = cw.slots.filter((s) => s.dir === ACROSS);
    const down = cw.slots.filter((s) => s.dir === DOWN);
    const col = (title, list) =>
      el('div.clue-col', {}, [
        el('h3', {}, title),
        ...list.map((s) =>
          el(
            'div.clue-item' + (cw.isSlotComplete(s) ? '.done' : ''),
            { onclick: () => { ov.remove(); cw.selectSlot(s); highlight(); updateCluebar(); openPalette(); } },
            [el('b', {}, String(s.number)), s.clue]
          )
        ),
      ]);
    const box = el('div.modal', {}, [
      el('div.clue-list-cols', {}, [col(t('across'), across), col(t('down'), down)]),
      el('div.actions', {}, el('button.btn', { onclick: () => ov.remove() }, t('back'))),
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
    closePalette();
    persist();
    ctx.sdk.gameplayStop();
    ctx.go('menu');
  }

  function onSolved() {
    closePalette();
    audio.win();
    ctx.sdk.gameplayStop();
    const timeSec = Math.round((Date.now() - startedAt) / 1000);
    const { isBest } = saves.recordSolved(timeSec);
    ctx.go('results', { crossword: cw, timeSec, isBest, level });
  }
}
