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
  const gridWrap = el('div.grid-wrap', {}, gridEl);

  const screen = el('div.screen', {}, [
    el('div.gtop', {}, [
      el('button.icon-btn', { onclick: exitToMenu, 'aria-label': t('menu') }, '‹'),
      el('span.spacer'),
      el('button.icon-btn', { onclick: showAllClues, 'aria-label': t('allClues') }, '☰'),
      soundBtn,
      hintBtn,
    ]),
    cluebar,
    gridWrap,
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
  screen._cleanup = () => window.removeEventListener('resize', layout);

  refreshAll();

  // --- размер клеток под доступное место ---
  function layout() {
    const wrapW = gridWrap.clientWidth;
    const padB = parseFloat(gridWrap.style.paddingBottom) || 0;
    const wrapH = gridWrap.clientHeight - padB;
    if (!wrapW || wrapH <= 0) return;
    const gap = 3;
    const size = Math.floor(
      Math.min((wrapW - gap * (cw.cols - 1)) / cw.cols, (wrapH - gap * (cw.rows - 1)) / cw.rows)
    );
    const cs = Math.max(20, Math.min(size, 56));
    gridEl.style.setProperty('--cs', cs + 'px');
    gridEl.style.setProperty('font-size', cs + 'px');
  }

  // --- обновление отображения ---
  function refreshAll() {
    for (let r = 0; r < cw.rows; r++) {
      for (let c = 0; c < cw.cols; c++) refreshCell(r, c);
    }
    highlight();
    updateCluebar();
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

  // --- взаимодействие ---
  function onCellTap(r, c) {
    cw.selectCell(r, c);
    highlight();
    updateCluebar();
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
