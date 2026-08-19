/** Экран игры: сетка, строка определения, ввод через палитру букв, бустеры. */

import { el, clear, toast, modal, closeTopModal, hasOpenModal, confirm } from '../ui.js';
import { t } from '../systems/i18n.js';
import { audio } from '../systems/audio.js';
import { saves } from '../systems/saves.js';
import { ads } from '../systems/ads.js';
import { BOOSTERS, BOOSTER_IDS } from '../systems/shop.js';
import { dateKey } from '../systems/daily.js';
import { Crossword } from '../game/crossword.js';
import { resolveMode, dailySeed } from '../game/modes.js';
import { loadPool } from '../game/dict/index.js';
import { buildWordPalette } from '../game/letterPalette.js';
import { RNG } from '../game/rng.js';

const ACROSS = 'across';
const DOWN = 'down';

// Абсолютный минимум размера клетки. Ниже читать уже тяжело, но доска обязана
// поместиться целиком: прокрутки в игре нет.
const MIN_CELL = 14;

/**
 * Дождаться, пока браузер отрисует показанный загрузчик.
 *
 * Два кадра подряд — потому что первый кадр гарантирует только то, что стили
 * посчитаны, а нам нужно, чтобы заставка успела появиться на экране до того,
 * как поток займёт генерация.
 *
 * Гонка с таймером обязательна: в СКРЫТОЙ вкладке браузер не рисует кадры и
 * `requestAnimationFrame` не вызывается вовсе. Без страховки игрок, свернувший
 * игру сразу после нажатия «Играть», возвращался бы к вечному «Загрузка…».
 */
function nextFrames() {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    // Макрозадача обязательна: rAF в неактивной вкладке не вызывается вовсе, и
    // без неё игрок, свернувший игру сразу после нажатия, возвращался бы к
    // вечному «Загрузка…». Она же гарантирует браузеру возможность отрисовать
    // заставку до того, как поток займёт сборка сетки.
    const timer = setTimeout(resolve, 60);
    requestAnimationFrame(() => requestAnimationFrame(done));
  });
}

export async function renderGame(ctx, { mode = 'easy', theme = null, seed, day, restore = null }) {
  // Сборка сетки синхронная и на сложном режиме занимает до секунды, а словарь
  // режима ещё и подгружается отдельным чанком. Без экрана-заставки игрок всё
  // это время смотрел бы на замерший экран меню (площадка считает такое
  // заметным фризом, §1.15). Показываем загрузчик и отдаём браузеру два кадра,
  // чтобы он успел его отрисовать, и только потом занимаем поток.
  ctx.showLoader?.();

  const key = dateKey(day);
  const plan = resolveMode({ mode, theme, dateKey: key });
  // Кроссворд дня одинаков у всех игроков и не меняется в течение суток,
  // поэтому seed у него считается от даты, а не выдаётся случайным.
  const puzzleSeed = plan.mode === 'daily' ? dailySeed(key) : seed;

  const bank = await loadPool(plan.poolId);
  await nextFrames();

  // Недавние слова передаём только для НОВОЙ партии; при возобновлении Crossword
  // возьмёт снимок из сохранения, чтобы сетка совпала с той, что была до выхода.
  const cw = new Crossword({
    seed: puzzleSeed,
    bank,
    plan,
    restore,
    avoidWords: restore ? null : saves.recentWords(plan.poolId),
  });
  const startedAt = Date.now() - (restore?.elapsedMs || 0);
  // Запоминаем слова начатой партии, чтобы следующие кроссворды не повторялись.
  // Память своя у каждого пула: слова лёгкого режима тематической сетке всё
  // равно не подходят и только вытесняли бы из списка нужное.
  if (!restore) saves.rememberWords(plan.poolId, cw.slots.map((s) => s.answer));

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

  // Панель бустеров. Раньше подсказка была одна и жила внутри партии; теперь их
  // три вида, они лежат в общем инвентаре и переносятся между кроссвордами.
  // Кнопка с нулём не гаснет намеренно: по нажатию она предлагает пополнить
  // запас за ролик, и это единственный способ узнать о такой возможности.
  const boosterBadges = {};
  const boosterBtns = {};
  const boosterBar = el('div.booster-bar', {}, BOOSTER_IDS.map((id) => {
    const b = BOOSTERS[id];
    const badge = el('span.booster-badge', {}, String(saves.countOf(id)));
    const btn = el('button.booster-btn', { onclick: () => onBooster(id), title: b.desc }, [
      el('span.booster-btn-ico', {}, b.icon),
      badge,
    ]);
    boosterBadges[id] = badge;
    boosterBtns[id] = btn;
    return btn;
  }));

  function updateBoosters() {
    for (const id of BOOSTER_IDS) {
      const n = saves.countOf(id);
      boosterBadges[id].textContent = String(n);
      boosterBtns[id].classList.toggle('empty', n === 0);
    }
  }
  const soundBtn = el('button.icon-btn', { onclick: toggleSound }, saves.soundOn ? '🔊' : '🔈');

  // Индикатор прогресса: сколько слов уже отгадано. Живёт в одной строке с
  // меткой слова внутри cluebar — там он всегда на виду и не отнимает у сетки
  // ни пикселя высоты (в шапке для него на телефоне просто нет места).
  const progressFill = el('i');
  const progressText = el('span.progress-text');
  const progressEl = el('div.progress', { 'aria-label': t('progress') }, [
    el('div.progress-bar', {}, progressFill),
    progressText,
  ]);

  const gridEl = el('div.grid');
  const gridBoard = el('div.grid-board', {}, gridEl);
  // Доска не прокручивается: размер клетки подбирается так, чтобы сетка влезала
  // целиком и по ширине, и по высоте. Прежние подсказки прокрутки вместе с
  // самой прокруткой убраны — площадка требует обходиться без неё.
  const gridWrap = el('div.grid-wrap', {}, gridBoard);
  const gridArea = el('div.grid-area', {}, gridWrap);

  // Постоянная панель ввода снизу (не всплывает и не двигает доску) — буквы
  // активного слова + «стереть». Высота у неё стабильная (см. styles.css),
  // поэтому при переключении слов доска не дёргается.
  const paletteBar = el('div.palette-bar');

  // Определение и палитра — единый нижний блок: читать вопрос и искать буквы
  // удобнее рядом, а не на разных концах экрана.
  const bottomPanel = el('div.bottom-panel', {}, [cluebar, paletteBar]);

  // Боковая панель со списком определений — видна на широких экранах (десктоп/планшет).
  const cluePanel = el('aside.clue-panel');

  const screen = el('div.screen.game-screen', {}, [
    el('div.gtop', {}, [
      el('button.icon-btn', { onclick: exitToMenu, 'aria-label': t('menu') }, '‹'),
      // Метка режима: в тематическом и в кроссворде дня игроку важно видеть, во
      // что он играет, — иначе непонятно, почему все слова про одно и то же.
      el('span.mode-tag', {}, [plan.icon, ' ', plan.title]),
      el('span.spacer'),
      el('button.icon-btn.clue-toggle', { onclick: showAllClues, 'aria-label': t('allClues') }, '☰'),
      soundBtn,
      boosterBar,
    ]),
    el('div.game-body', {}, [
      el('div.board-area', {}, [gridArea, bottomPanel]),
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
  // Для отладки и автотестов: модель, узлы клеток, тап по клетке и полная
  // перерисовка (нужна, когда тест меняет модель напрямую, минуя ввод).
  window.__game = { cw, cellNodes, tap: onCellTap, refresh: () => { refreshAll(); renderPalette(); } };
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('keydown', onKey);
  // ResizeObserver пересчитывает размер клеток, когда flex-раскладка устаканилась
  // (первый синхронный layout() может увидеть ещё не финальную ширину контейнера).
  //
  // Следим и за нижней панелью: её высота меняется вместе с длиной определения и
  // числом клавиш в палитре, и без этого доска считалась по старому, большему
  // месту — а потом обрезалась снизу, когда панель вырастала.
  // Наблюдателей два, и оба могут сработать в одном кадре. Без склейки
  // раскладка считалась бы дважды подряд, а она не бесплатная.
  let layoutQueued = false;
  const queueLayout = () => {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; layout(); });
  };
  const ro = new ResizeObserver(queueLayout);
  ro.observe(gridWrap);
  ro.observe(bottomPanel);
  screen._cleanup = () => {
    window.removeEventListener('resize', layout);
    window.removeEventListener('keydown', onKey);
    ro.disconnect();
    clearTimeout(advanceTimer);
  };
  requestAnimationFrame(layout);

  buildCluePanel();
  updateBoosters();
  refreshAll();
  renderPalette();

  // --- размер клеток под доступное место ---
  // Философия масштаба: на телефоне заполняем ШИРИНУ (клетки крупные и читаемые),
  // а если сетка высокая — поле прокручивается по вертикали, активная клетка сама
  // въезжает в видимую область. На широких экранах вмещаем доску целиком.
  function layout() {
    // Поля берём ИЗ DOM, а не константой: padding доски задан через clamp() и
    // на десктопе вдвое больше, чем на телефоне. С заниженной константой расчёт
    // давал клетку на пиксель крупнее, и доска переставала влезать по высоте.
    const bs = getComputedStyle(gridBoard);
    const padX = parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight) + 4;   // +4 — поля .grid-wrap
    const padY = parseFloat(bs.paddingTop) + parseFloat(bs.paddingBottom) + 4;
    const availW = gridWrap.clientWidth - padX;
    const availH = gridWrap.clientHeight - padY;
    if (availW <= 0 || availH <= 0) return;
    const gap = 4;
    const isWide = window.matchMedia('(min-width: 900px)').matches;
    const MIN = MIN_CELL;
    const MAX = isWide ? 64 : 52;
    const fitW = (availW - gap * (cw.cols - 1)) / cw.cols;
    const fitH = (availH - gap * (cw.rows - 1)) / cw.rows;
    // Доска показывается ЦЕЛИКОМ всегда: берём меньшее из двух ограничений.
    // Прежде здесь стоял «комфортный минимум» размера клетки, а не влезающая
    // при нём доска прокручивалась, — прокрутки в игре быть не должно, поэтому
    // на низком экране клетки просто мельче.
    const target = Math.min(fitW, fitH);
    // floor, а не round: округление вверх добавляло доске лишние пиксели, и
    // она переставала помещаться.
    let cs = Math.floor(Math.max(MIN, Math.min(target, MAX)));
    apply(cs);

    // Подстраховка. Высота нижней панели зависит от длины определения и числа
    // клавиш, и она успевает измениться уже ПОСЛЕ расчёта — тогда доска
    // оказывалась выше отведённого места и обрезалась снизу. Проверяем по факту
    // и ужимаем клетку, пока сетка не поместится: прокрутки и обрезки быть не
    // должно ни на каком экране.
    //
    // Шаг считается сразу от величины переполнения, а не по пикселю за раз:
    // каждое чтение offsetHeight — принудительный пересчёт геометрии, и на
    // сетке 11×11 два десятка таких шагов складывались в заметную задержку.
    let guard = 0;
    let over = gridBoard.offsetHeight - gridWrap.clientHeight;
    while (over > 0 && cs > MIN && guard++ < 6) {
      cs = Math.max(MIN, cs - Math.max(1, Math.ceil(over / cw.rows)));
      apply(cs);
      over = gridBoard.offsetHeight - gridWrap.clientHeight;
    }

    function apply(size) {
      gridEl.style.setProperty('--cs', size + 'px');
      gridEl.style.setProperty('font-size', size + 'px');
    }
  }

  // --- обновление отображения ---
  function refreshAll() {
    for (let r = 0; r < cw.rows; r++) {
      for (let c = 0; c < cw.cols; c++) refreshCell(r, c);
    }
    highlight();
    updateCluebar();
    updateCluePanel();
    updateProgress();
  }

  function refreshCell(r, c) {
    const node = cellNodes[r][c];
    if (!node) return;
    node._ch.textContent = cw.entries[r][c] || '';
    // .locked — буква, которую больше нельзя менять: открытая за рекламу либо
    // входящая в уже отгаданное слово. Оформление у них общее: закрытая буква
    // выглядит одинаково независимо от того, как она туда попала.
    node.classList.toggle('locked', cw.isCellLocked(r, c));
  }

  function updateProgress() {
    const done = cw.solvedSlotCount();
    const total = cw.slots.length;
    progressText.textContent = `${done}/${total}`;
    progressFill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
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
    // Слово вписано целиком, но не сходится — говорим об этом прямо. Без этого
    // игрок, заполнивший все клетки неверно, просто не понимает, что не так.
    // Какая именно буква лишняя — не выдаём, иначе головоломки не остаётся.
    const wrong = cw.isSlotWrong(s);
    const dir = s.dir === ACROSS ? t('across') : t('down');
    cluebarText.appendChild(
      el('div', {}, [
        // «Не сходится» — отдельным флажком СПРАВА, а не припиской к метке:
        // строка «✗ 29 По горизонтали · не сходится» на телефоне не помещалась
        // и обрезалась многоточием. Флажок занимает место счётчика прогресса —
        // ширина строки не меняется, а в момент ошибки он и нужнее счётчика.
        el('div.clue-head', {}, [
          el('span.tag' + (wrong ? '.warn' : ''), {}, [
            `${done ? '✓ ' : wrong ? '✗ ' : ''}${s.number} `,
            // На узких экранах слово «По горизонтали» рядом с флажком не
            // помещается, поэтому там показывается стрелка — привычное для
            // кроссвордов обозначение направления. Переключение чисто на CSS,
            // чтобы не пересобирать разметку на каждый поворот экрана.
            el('span.dir-full', {}, dir),
            el('span.dir-short', {}, s.dir === ACROSS ? '→' : '↓'),
          ]),
          wrong ? el('span.clue-flag', {}, t('notMatching')) : progressEl,
        ]),
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
      node.classList.toggle('wrong', cw.isSlotWrong(s));
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
    renderPalette();
  }

  /**
   * Стрелки «предыдущее/следующее слово» ведут к ближайшему ещё НЕ отгаданному
   * слову: листать по уже решённым бессмысленно — игрок ищет, чем заняться
   * дальше. Если неотгаданных не осталось, ничего не двигаем.
   */
  function step(dir) {
    const next = cw.nextUnsolvedSlot(cw.activeSlot, dir);
    if (!next) return;
    cw.selectSlot(next);
    afterSelect();
  }

  /**
   * Автопереход к следующему неразгаданному слову после того, как текущее
   * сошлось (приём из крупных кроссвордных приложений — не заставлять игрока
   * каждый раз вручную искать, куда идти дальше). С паузой, чтобы игрок успел
   * увидеть зелёную вспышку отгаданного слова.
   */
  let advanceTimer = null;
  function scheduleAutoAdvance(fromSlot) {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      const next = cw.nextUnsolvedSlot(fromSlot);
      if (!next) return;
      cw.selectSlot(next);
      afterSelect();
    }, 560);
  }

  // --- постоянная панель букв: палитра на ВСЁ активное слово ---
  // Сверху — «бейджи» по клетке слова (уже введённая буква либо точка-плейсхолдер,
  // тап переводит фокус на эту клетку без ввода). Снизу — ОДИН общий набор кнопок
  // на всё слово: буквы самого слова вперемешку с несколькими лишними, не из
  // слова (детерминировано по слоту). Тап по букве пишет её в клетку, на которой
  // сейчас фокус, — явно, без «перескакивания» мимо выбранной клетки. Если слово
  // уже полностью и верно отгадано — панель скрыта, редактирование запрещено.
  function renderPalette() {
    clear(paletteBar);
    const slot = cw.activeSlot;
    if (!slot) return;
    // Для отгаданного слова панель НЕ схлопывается в короткую надпись: раньше
    // из-за этого при каждом отгаданном слове доска подпрыгивала. Разметка та
    // же, клавиши гасятся, а сообщение ложится поверх них накладкой — высота
    // блока остаётся прежней.
    const solved = cw.isSlotComplete(slot);
    paletteBar.classList.toggle('solved', solved);

    const badges = el('div.pal-badges');
    cw.activeSlotCells().forEach(({ r, c }) => {
      const filled = cw.entries[r][c];
      const isActive = !!(cw.activeCell && cw.activeCell.r === r && cw.activeCell.c === c);
      const locked = cw.isCellLocked(r, c);
      // Пустая клетка — нейтральная точка-плейсхолдер, а не номер: цифры здесь
      // легко спутать с номерами подсказок на самой сетке (у них разная нумерация).
      const badge = el(
        'button.pal-badge' + (isActive ? '.active' : '') + (locked ? '.locked' : ''),
        locked ? {} : { onclick: () => onFocusCell(r, c) },
        filled || '·'
      );
      badges.appendChild(badge);
    });

    const keys = el('div.pal-keys');
    const rng = new RNG((cw.seed ^ ((slot.row + 1) * 73856093) ^ ((slot.col + 1) * 19349663) ^ (slot.dir === DOWN ? 0x9e3779b9 : 0)) >>> 0);
    for (const L of buildWordPalette(slot.answer, rng)) {
      keys.appendChild(
        el('button.pal-key', solved ? { disabled: true } : { onclick: () => onPaletteLetter(L) }, L)
      );
    }
    const keysWrap = el('div.pal-keys-wrap', {}, keys);
    if (solved) keysWrap.appendChild(el('div.pal-solved', {}, '✓ ' + t('wordSolved')));

    paletteBar.append(
      badges,
      keysWrap,
      el('button.erase-key', solved ? { disabled: true } : { onclick: onErase }, '⌫ ' + t('erase'))
    );
  }

  /** Записать букву; общая логика для тап- и клавиатурного ввода.
   *  Возвращает true, если кроссворд только что решён (экран уже сменился). */
  function writeLetter(r, c, L) {
    if (!cw.inputAt(r, c, L)) return false;
    const prevSlot = cw.activeSlot;
    audio.tap();
    refreshAll();
    persist();
    if (cw.isSolved()) { onSolved(); return true; }
    if (prevSlot && cw.isSlotComplete(prevSlot)) {
      flashSlot(prevSlot);
      scheduleAutoAdvance(prevSlot);
    }
    return false;
  }

  /** Тап по букве в общей палитре слова — пишет в клетку, на которой сейчас
   *  фокус (cw.activeCell), и переводит фокус на следующую пустую клетку слова. */
  function onPaletteLetter(L) {
    // Курсор мог стоять на закрытой клетке — например, первая буква слова уже
    // пришла из пересекающего отгаданного. Раньше такое нажатие только
    // передвигало курсор, а буква пропадала, и игроку приходилось жать дважды.
    // Теперь переносим курсор и сразу пишем.
    if (!cw.isCellEditable(cw.activeCell.r, cw.activeCell.c)) cw.focusFirstEditable();
    const { r, c } = cw.activeCell;
    if (!cw.isCellEditable(r, c)) { toast(t('cellRevealed')); return; }
    if (writeLetter(r, c, L)) return;
    cw.advanceToNextEmpty();
    afterSelect();
  }

  /** Тап по «бейджу» строки — просто перевести курсор на эту клетку (без ввода буквы). */
  function onFocusCell(r, c) {
    cw.focusCell(r, c);
    highlight();
    renderPalette();
  }

  function onErase() {
    cw.backspace();
    audio.erase();
    refreshAll();
    persist();
    renderPalette();
  }

  /** Ввод с физической клавиатуры (десктоп): буквы двигают курсор дальше по слову, Backspace, стрелки. */
  function onKey(e) {
    const key = e.key;
    if (key === 'Escape') { e.preventDefault(); if (closeTopModal()) return; exitToMenu(); return; }
    // Пока открыта модалка (диалог рекламы, список определений) — клавиши
    // не должны «проваливаться» в сетку под ней.
    if (hasOpenModal()) return;
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
    // Как и при тапе по палитре: закрытую клетку не перезаписываем, но и букву
    // не теряем — переносим курсор на ближайшую пригодную и пишем туда.
    if (!cw.isCellEditable(cw.activeCell.r, cw.activeCell.c)) cw.focusFirstEditable();
    const { r, c } = cw.activeCell;
    if (!cw.isCellEditable(r, c)) return;
    if (writeLetter(r, c, L)) return;
    // Дальше идём к следующей клетке, в которую можно писать: останавливаться
    // на буквах из пересечений при наборе слова подряд незачем.
    cw.advanceCursorEditable(1);
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

  // --- бустеры (инвентарь; кончился — можно пополнить за ролик) ---

  /** Применить бустер к доске. Возвращает список раскрытых клеток. */
  function applyBooster(id) {
    if (id === 'letter') return cw.revealLetter();
    if (id === 'word') return cw.revealWord();
    return cw.scatter();
  }

  async function onBooster(id) {
    // Сначала проверяем, есть ли вообще что открывать: списывать подсказку за
    // «ничего не произошло» — верный способ поссориться с игроком.
    if (!cw.wrongCells().length) { toast(t('boosterNothing')); return; }

    if (!saves.countOf(id)) {
      const got = await offerAdRefill(id);
      if (!got) return;
    }
    if (!saves.useBooster(id)) return;

    const slotBefore = cw.activeSlot;
    const revealed = applyBooster(id);
    updateBoosters();
    if (!revealed.length) {
      // Бустер списан, но открывать оказалось нечего — возвращаем его обратно.
      saves.grantBoosters({ [id]: 1 });
      updateBoosters();
      toast(t('nothingToReveal'));
      return;
    }
    refreshAll();
    persist();
    for (const { r, c } of revealed) {
      const node = cellNodes[r][c];
      node.classList.remove('solved-flash'); void node.offsetWidth; node.classList.add('solved-flash');
    }
    if (cw.isSolved()) { onSolved(); return; }
    // Бустер мог сдвинуть курсор и даже сменить активное слово —
    // перерисовываем палитру под новое состояние.
    renderPalette();
    if (cw.isSlotComplete(cw.activeSlot)) scheduleAutoAdvance(slotBefore);
  }

  /** Предложить пополнить кончившийся бустер за просмотр ролика. */
  async function offerAdRefill(id) {
    const b = BOOSTERS[id];
    const proceed = await confirm({
      title: b.icon,
      text: `${t('boosterEmpty')}. ${t('boosterWatchAd')}`,
      confirm: t('watch'),
      cancel: t('cancel'),
    });
    if (!proceed) return false;
    const rewarded = await ads.showRewarded();
    if (!rewarded) { toast(t('adUnavailable')); return false; }
    saves.grantBoosters({ [id]: b.adReward });
    updateBoosters();
    toast(t('boosterGot'));
    return true;
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
    const fresh = saves.recordSolved({
      mode: plan.mode,
      theme: plan.theme,
      words: cw.slots.length,
      // Сами слова — для копилки РАЗНЫХ отгаданных: она считает словарный
      // охват игрока, а не число решённых кроссвордов.
      wordList: cw.slots.map((s) => s.answer),
      boostersUsed: cw.boostersUsed,
    });
    ctx.go('results', { crossword: cw, plan, timeSec, freshAchievements: fresh });
  }
}
