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
import { fileURLToPath } from 'node:url';
import { findChrome } from './find-chrome.mjs';

const BASE = process.env.BASE || 'http://localhost:5200';
const CHROME = findChrome();
// fileURLToPath, а не URL.pathname: на Windows pathname даёт «/C:/…»,
// с ведущим слешем, и запись файла по такому пути падает.
const OUT = fileURLToPath(new URL('./screenshots/', import.meta.url));

// CSS-вьюпорт × масштаб = итоговый размер файла.
//
// Требование площадки: соотношение сторон ровно 16:9 (или 9:16 для портрета),
// ДЛИННАЯ СТОРОНА от 1280 до 2560 пикселей. Поэтому вьюпорт задаёт реалистичную
// ширину устройства в CSS-пикселях, а нужное разрешение набирается масштабом —
// растягивать сам макет до 1080 CSS-пикселей нельзя, телефонная вёрстка от
// этого превратилась бы в планшетную.
const DEVICES = {
  //  432×768 — ширина крупного телефона; ×2.5 → 1080×1920, ровно 9:16
  mobile:    { viewport: { width: 432, height: 768 }, scale: 2.5 },
  //  768×432 — телефон в альбоме (меньше 900, значит компактная раскладка);
  //  ×2.5 → 1920×1080, ровно 16:9
  landscape: { viewport: { width: 768, height: 432 }, scale: 2.5 },
  //  1600×900 — ровно 16:9, длинная сторона в разрешённых 1280–2560.
  //  Не 1920: раскладка игрового экрана ограничена 1180 CSS-пикселями (шире
  //  читать список определений неудобно), и на 1920 почти сорок процентов
  //  кадра занимал пустой фон по бокам — ровно та «однотонная заливка», из-за
  //  которой набор завернули. При 1600 та же вёрстка занимает кадр целиком.
  desktop:   { viewport: { width: 1600, height: 900 }, scale: 1 },
};

// Границы длинной стороны из требований площадки — проверяются после съёмки.
const LONG_SIDE = { min: 1280, max: 2560 };

// Минимальная доля кадра, занятая игрой (§5.1.1). Считается по габаритам
// доски, нижней панели и списка определений, поэтому оценка НИЖНЯЯ: шапка с
// кнопками и поля вокруг квадратной доски внутри игровой области в неё не
// попадают. На телефоне доска с панелью ввода занимают экран целиком, на
// широком экране доска квадратная и по бокам от неё остаётся воздух — планка
// своя для каждого устройства.
const MIN_GAMEPLAY = { mobile: 0.7, landscape: 0.7, desktop: 0.5 };

/**
 * Доска для витрины: часть слов отгадана, одна буква открыта подсказкой,
 * выбрано слово у верхнего края.
 *
 * Заполняем ЧЕРЕЗ ОДНО (или через два — см. `every`), а не первую половину
 * подряд: так буквы распределены по всей сетке, а не собраны в одном углу.
 * Активным делаем слово из начала списка (то есть сверху) и сбрасываем
 * прокрутку поля в ноль — иначе на низких экранах доска попадала в кадр
 * серединой, обрезанной и сверху, и снизу, и выглядело это как ошибка
 * отрисовки.
 *
 * `every` управляет заполненностью: 2 — примерно половина слов, 3 — треть,
 * 1 — всё, кроме выбранного слова. Разные значения нужны, чтобы соседние
 * скриншоты в карточке не выглядели одинаковыми.
 */
const PREP_BOARD = (every = 2) => {
  const cw = window.__game.cw;
  cw.slots.forEach((s, i) => {
    if (i % every === 0) for (const { r, c } of cw.slotCells(s)) cw.entries[r][c] = cw.puzzle.grid[r][c];
  });
  const open = cw.slots.find((s) => !cw.isSlotComplete(s));
  const cell = open && cw.slotCells(open).find((p) => !cw.entries[p.r][p.c]);
  if (cell) { cw.entries[cell.r][cell.c] = cw.puzzle.grid[cell.r][cell.c]; cw.locked.add(`${cell.r},${cell.c}`); }
  const target = cw.slots.find((s) => !cw.isSlotComplete(s));
  if (target) { cw.selectSlot(target); cw.focusFirstEditable(target); }
  window.__game.refresh();
  // поле — на самый верх; если доска не влезает, обрез останется только снизу,
  // где его объясняет градиент со стрелкой
  const wrap = document.querySelector('.grid-wrap');
  if (wrap) { wrap.scrollTop = 0; wrap.dispatchEvent(new Event('scroll')); }
};

/**
 * Доля кадра, занятая доской и панелью ввода. §5.1.1: промо-материалы должны
 * показывать саму игру, а не оформление вокруг неё — на прошлой модерации набор
 * завернули как раз за «менее 70% геймплея, однотонная заливка». Считаем долю
 * прямо по вёрстке и не даём выпустить кадр, где игры в кадре мало.
 */
const GAMEPLAY_RATIO = () => {
  const area = (sel) => {
    const n = document.querySelector(sel);
    if (!n) return 0;
    const r = n.getBoundingClientRect();
    // за края вьюпорта заходить может только прокручиваемая доска — считаем
    // видимую часть
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h;
  };
  return (area('.grid-board') + area('.bottom-panel') + area('.clue-panel')) / (innerWidth * innerHeight);
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
  // страховка §5.1.1: в кадре должна быть игра, а не фон вокруг неё
  const ratio = await page.evaluate(GAMEPLAY_RATIO);
  if (ratio < MIN_GAMEPLAY[device]) {
    throw new Error(
      `${file}: игрой занято ${Math.round(ratio * 100)}% кадра, нужно ≥ ${Math.round(MIN_GAMEPLAY[device] * 100)}%`
    );
  }
  await page.screenshot({ path: OUT + file });
  await ctx.close();

  // Проверяем то, что реально попало в файл: соотношение сторон должно быть
  // ровно 16:9 / 9:16, а длинная сторона — в разрешённом диапазоне.
  const w = Math.round(viewport.width * scale);
  const h = Math.round(viewport.height * scale);
  const long = Math.max(w, h), short = Math.min(w, h);
  if (long * 9 !== short * 16) throw new Error(`${file}: ${w}×${h} — не 16:9`);
  if (long < LONG_SIDE.min || long > LONG_SIDE.max) {
    throw new Error(`${file}: длинная сторона ${long} вне диапазона ${LONG_SIDE.min}–${LONG_SIDE.max}`);
  }
  console.log(`  ${file.padEnd(34)} ${w}×${h}  игра ${Math.round(ratio * 100)}%`);
}

// --- сценарии подготовки экранов ---------------------------------------

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

const game = (level, seed, every = 2) => async (page) => {
  await startGame(level, seed)(page);
  await page.evaluate(PREP_BOARD, every);
  await page.waitForTimeout(400);
};

// --- набор -------------------------------------------------------------
// ВСЕ кадры — сама игра: доска, строка определения и палитра букв. Экраны меню,
// статистики и победы из набора убраны намеренно: это почти пустые страницы с
// однотонной заливкой, и на модерации набор завернули именно за них (§5.1.1 —
// «менее 70% геймплея»). Меню и так видно на обложке.
//
// Уровень подобран под устройство: на широком экране мелкая сетка выглядит
// потерянной, на телефоне крупная — слишком дробной. Seed и заполненность
// разные, чтобы соседние кадры в карточке не выглядели одной картинкой.
// Seed фиксирован, чтобы повторный запуск давал те же изображения.
const SCREENS = [
  ['game',  'mobile',    game('medium', 20240711, 2)],
  ['solve', 'mobile',    game('medium', 20250314, 3)],
  ['game',  'landscape', game('medium', 20240711, 2)],
  ['game',  'desktop',   game('hard', 20240925, 2)],
  ['solve', 'desktop',   game('hard', 20250509, 3)],
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
