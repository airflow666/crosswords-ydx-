/**
 * Генератор скриншотов для карточки Яндекс Игр.
 *
 * Пропорции строго 9:16 для мобильных и 16:9 для десктопа — прежний набор был
 * снят «как есть» с вьюпортов 390×844 и 1440×900, то есть ни то ни другое.
 * Размеры подобраны так, чтобы одновременно:
 *   - давать ТОЧНОЕ соотношение сторон (без округлений);
 *   - укладываться в лимит площадки 250×140 … 1920×1080;
 *   - рендерить вёрстку при реалистичной ширине (CSS-пиксели телефона),
 *     а увеличение получать масштабом устройства, а не растягиванием макета.
 *
 * Каждый экран снимается и в светлой, и в тёмной теме.
 *
 * Запуск (нужен собранный dist/ и статический сервер на нём):
 *   npm run build
 *   python3 -m http.server 5200 --directory dist &
 *   npm i -D playwright-core --no-save && node store/make-screenshots.mjs
 */

import { chromium } from 'playwright-core';
import { readdirSync, unlinkSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5200';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = new URL('./screenshots/', import.meta.url).pathname;

// CSS-вьюпорт × масштаб = итоговый размер файла.
const DEVICES = {
  //  432×768 — ширина крупного телефона; ×1.25 → 540×960, ровно 9:16
  mobile:    { viewport: { width: 432, height: 768 }, scale: 1.25 },
  //  768×432 — телефон в альбоме (меньше 900, значит компактная раскладка);
  //  ×1.5 → 1152×648, ровно 16:9
  landscape: { viewport: { width: 768, height: 432 }, scale: 1.5 },
  //  1920×1080 без масштабирования: ровно 16:9, максимум по лимиту площадки и
  //  настоящее десктопное разрешение — при 1280×720 доске не хватало высоты и
  //  она выглядела мелкой посреди пустого экрана
  desktop:   { viewport: { width: 1920, height: 1080 }, scale: 1 },
};

/** Доска для витрины: часть слов отгадана, одна буква открыта подсказкой. */
const PREP_BOARD = () => {
  const cw = window.__game.cw;
  for (const s of cw.slots.slice(0, Math.ceil(cw.slots.length * 0.55))) {
    for (const { r, c } of cw.slotCells(s)) cw.entries[r][c] = cw.puzzle.grid[r][c];
  }
  const open = cw.slots.find((s) => !cw.isSlotComplete(s));
  const cell = open && cw.slotCells(open).find((p) => !cw.entries[p.r][p.c]);
  if (cell) { cw.entries[cell.r][cell.c] = cw.puzzle.grid[cell.r][cell.c]; cw.locked.add(`${cell.r},${cell.c}`); }
  const target = cw.slots.find((s) => !cw.isSlotComplete(s));
  if (target) { cw.selectSlot(target); cw.focusFirstEditable(target); window.__game.tap(cw.activeCell.r, cw.activeCell.c); }
  window.__game.refresh();
};

/** Правдоподобная накопленная статистика — пустой экран для витрины бесполезен. */
const SEED_STATS = () => {
  const today = new Date().toISOString().slice(0, 10);
  const raw = JSON.parse(localStorage.getItem('crosswords.save') || '{}');
  raw.stats = { solved: 37, words: 812, noHints: 11 };
  raw.streak = { lastPlay: today, days: 9 };
  raw.current = null;
  localStorage.setItem('crosswords.save', JSON.stringify(raw));   // тему не трогаем
};

const browser = await chromium.launch({ executablePath: CHROME });

async function shot(file, device, theme, prepare) {
  const { viewport, scale } = DEVICES[device];
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.goto(BASE);
  // Тему кладём В СОХРАНЕНИЕ, а не атрибутом на <html>: сценарии подготовки
  // перезагружают страницу, и выставленный вручную атрибут при этом пропадал —
  // «тёмные» скриншоты выходили светлыми. Через сохранение игра применяет тему
  // сама при загрузке, ровно как у игрока.
  await page.evaluate((t) => {
    const raw = JSON.parse(localStorage.getItem('crosswords.save') || '{}');
    raw.theme = t;
    localStorage.setItem('crosswords.save', JSON.stringify(raw));
  }, theme);
  await page.reload();
  await page.waitForTimeout(700);
  await prepare(page);
  // страховка: тема действительно применилась
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (applied !== theme) throw new Error(`${file}: ожидалась тема ${theme}, применена ${applied}`);
  await page.screenshot({ path: OUT + file });
  await ctx.close();
  console.log('  ' + file);
}

// --- сценарии подготовки экранов ---------------------------------------
const menu = async () => {};

/**
 * Запустить партию ЗАДАННОГО размера и с фиксированным seed.
 *
 * Обычная «Новая игра» берёт случайный уровень, и на витрину то и дело
 * попадала мелкая сетка 7×7, тонущая в пустом месте на широком экране.
 * Подкладываем незаконченную партию в сохранение и жмём «Продолжить» —
 * сетка восстанавливается из seed, пустое поле игру не смущает.
 */
const startGame = (level, seed) => async (page) => {
  await page.evaluate(({ level, seed }) => {
    const raw = JSON.parse(localStorage.getItem('crosswords.save') || '{}');
    raw.current = { seed, level, filled: '', locked: '', hintsUsed: 0, avoid: [] };
    localStorage.setItem('crosswords.save', JSON.stringify(raw));
  }, { level, seed });
  await page.reload();
  await page.waitForTimeout(700);
  await page.click('button:has-text("Продолжить")');
  await page.waitForTimeout(900);
};

const game = (level, seed) => async (page) => {
  await startGame(level, seed)(page);
  await page.evaluate(PREP_BOARD);
  await page.waitForTimeout(400);
};

const results = (level, seed) => async (page) => {
  await startGame(level, seed)(page);
  // заполняем всё, кроме одной клетки, и добиваем её через палитру —
  // так срабатывает обычный игровой путь вместе с салютом
  await page.evaluate(() => {
    const cw = window.__game.cw;
    for (let r = 0; r < cw.rows; r++) for (let c = 0; c < cw.cols; c++)
      if (cw.puzzle.grid[r][c] !== null) cw.entries[r][c] = cw.puzzle.grid[r][c];
    const p0 = cw.slotCells(cw.slots[0])[0];
    cw.entries[p0.r][p0.c] = '';
    cw.selectSlot(cw.slots[0]); cw.focusCell(p0.r, p0.c);
    window.__game.tap(p0.r, p0.c); window.__game.refresh();
  });
  await page.waitForTimeout(250);
  const need = await page.evaluate(() =>
    window.__game.cw.puzzle.grid[window.__game.cw.activeCell.r][window.__game.cw.activeCell.c]);
  for (const k of await page.$$('.pal-key')) if ((await k.textContent()) === need) { await k.click(); break; }
  await page.waitForTimeout(600);   // ловим салют в разгаре
};

const stats = async (page) => {
  await page.evaluate(SEED_STATS);
  await page.reload();
  await page.waitForTimeout(700);
  await page.click('button:has-text("Статистика")');
  await page.waitForTimeout(500);
};

// --- набор -------------------------------------------------------------
// Уровень подобран под устройство: на широком экране мелкая сетка выглядит
// потерянной, на телефоне крупная — слишком дробной. Seed фиксирован, чтобы
// повторный запуск давал те же картинки.
const SCREENS = [
  ['menu',    'mobile',    menu],
  ['game',    'mobile',    game('medium', 20240711)],
  ['results', 'mobile',    results('medium', 20240711)],
  ['stats',   'mobile',    stats],
  ['game',    'landscape', game('medium', 20240711)],
  ['menu',    'desktop',   menu],
  ['game',    'desktop',   game('hard', 20240925)],
  ['results', 'desktop',   results('hard', 20240925)],
  ['stats',   'desktop',   stats],
];

// старые файлы удаляем: имена изменились, иначе останется мусор от прошлого набора
for (const f of readdirSync(OUT)) if (f.endsWith('.png')) unlinkSync(OUT + f);

console.log('Скриншоты:');
let n = 0;
for (const [screen, device, prepare] of SCREENS) {
  for (const theme of ['light', 'dark']) {
    n += 1;
    const name = `${String(n).padStart(2, '0')}-${screen}-${device}-${theme}.png`;
    await shot(name, device, theme, prepare);
  }
}

await browser.close();
console.log('готово, файлов: ' + n);
