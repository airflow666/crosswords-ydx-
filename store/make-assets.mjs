/**
 * Генератор иконки и обложки для карточки Яндекс Игр.
 *
 * Обе картинки рисуются из ОДНОГО описания эмблемы и одних и тех же цветов
 * дизайн-системы. Раньше они делались вручную и разъехались: узор совпадал, но
 * на иконке плитки были светлыми на бирюзовом, а на обложке и в самой игре —
 * наоборот, бирюзовыми на светлом. Скрипт убирает возможность такого расхождения.
 *
 * Запуск (playwright-core ставится временно, в зависимостях проекта его нет):
 *   npm i -D playwright-core --no-save && node store/make-assets.mjs
 */

import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { findChrome } from './find-chrome.mjs';
import { t } from '../src/systems/i18n.js';

const CHROME = findChrome();
// fileURLToPath, а не URL.pathname: на Windows pathname даёт «/C:/…»,
// с ведущим слешем, и запись файла по такому пути падает.
const OUT = fileURLToPath(new URL('./assets/', import.meta.url));

// Токены дизайн-системы (светлая тема) — те же значения, что в src/styles.css.
const C = {
  bg: '#f4f1ea',
  surface: '#fffdf8',
  surface2: '#efeadf',
  accent: '#3d7f7a',
  ink: '#2b2a28',
  inkSoft: '#6b6a66',
};

// Тот же узор, что у эмблемы на экране меню (src/screens/menu.js).
const EMBLEM = [1, 0, 1, 1, 1, 1, 1, 0, 1];

// Название и слоган берём НЕ копией, а прямо из словаря игры: площадка требует
// дословного совпадения текста на обложке с тем, что игрок видит на экране
// меню, и импорт делает расхождение невозможным в принципе.
const TITLE = t('title');
const SUBTITLE = t('subtitle');

/** Разметка эмблемы: белая карточка со скруглением, внутри 3×3 плитки. */
function emblem(size) {
  const pad = Math.round(size * 0.125);
  const gap = Math.round(size * 0.031);
  const radius = Math.round(size * 0.25);
  const tileRadius = Math.round(size * 0.042);
  const cells = EMBLEM.map(
    (on) => `<i style="background:${on ? C.accent : C.surface2};border-radius:${tileRadius}px"></i>`
  ).join('');
  return `<div style="
      width:${size}px;height:${size}px;box-sizing:border-box;
      background:${C.surface};border-radius:${radius}px;padding:${pad}px;
      display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:${gap}px;
      box-shadow:0 ${Math.round(size * 0.03)}px ${Math.round(size * 0.09)}px rgba(60,50,30,0.18);
    ">${cells}</div>`;
}

const page404 = (body, w, h, bg) => `<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px;background:${bg};overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
  i{display:block}
</style>${body}`;

const browser = await chromium.launch({ executablePath: CHROME });

// --- Иконка 512×512 -----------------------------------------------------
// Фон бирюзовый (в витрине иконка должна быть заметной), но САМА ЭМБЛЕМА
// нарисована ровно так же, как на обложке и в игре: белая карточка,
// бирюзовые плитки, две кремовые. Углы не скругляем — это делает площадка.
{
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(page404(emblem(340), 512, 512, C.accent));
  await page.screenshot({ path: OUT + 'icon-512.png' });
  await page.close();
  console.log('  icon-512.png       512×512');
}

// --- Обложка 800×470 ----------------------------------------------------
// Слева та же эмблема, справа название и слоган — оба дословно совпадают с
// тем, что игрок видит на экране меню (требование площадки о совпадении).
{
  const page = await browser.newPage({ viewport: { width: 800, height: 470 } });
  await page.setContent(page404(
    `<div style="display:flex;align-items:center;gap:40px;padding:0 46px">
       ${emblem(196)}
       <div id="txt" style="flex:1;min-width:0">
         <div id="name" style="font-weight:800;letter-spacing:0.01em;color:${C.ink};line-height:1.14;text-wrap:balance">${TITLE}</div>
         <div style="font-size:21px;color:${C.inkSoft};margin-top:16px">${SUBTITLE}</div>
       </div>
     </div>`,
    800, 470, C.bg
  ));
  // Кегль названия подбираем под ширину, а не задаём числом: название можно
  // поменять, и обложка не должна из-за этого рассыпаться на четыре строки или
  // обрезаться. Берём самый крупный размер, при котором текст укладывается в
  // две строки.
  await page.evaluate(() => {
    const name = document.getElementById('name');
    for (const size of [52, 48, 44, 40, 36, 32, 28]) {
      name.style.fontSize = size + 'px';
      const lines = Math.round(name.getBoundingClientRect().height / (size * 1.14));
      if (lines <= 2) break;
    }
  });
  // Страховка: текст обязан помещаться целиком — раньше «КРОССВОРДЫ»
  // упиралось в правый край и последняя буква обрезалась. Название теперь
  // длинное и переносится на две строки, поэтому проверяем не только правый
  // край блока, но и то, что ни одна строка не вылезла за его ширину
  // (scrollWidth) и весь блок уместился по высоте.
  const fits = await page.evaluate(() => {
    const t = document.getElementById('txt');
    const r = t.getBoundingClientRect();
    return r.right <= window.innerWidth - 8 && r.bottom <= window.innerHeight - 8
      && [...t.children].every((n) => n.scrollWidth <= n.clientWidth + 1);
  });
  if (!fits) throw new Error('текст обложки не помещается');
  await page.screenshot({ path: OUT + 'cover-800x470.png' });
  await page.close();
  console.log('  cover-800x470.png  800×470');
}

await browser.close();
console.log('готово');
