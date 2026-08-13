/**
 * Поиск браузера для playwright-core.
 *
 * playwright-core сам браузеры не скачивает, ему нужен путь к уже
 * установленному Chromium-подобному. Раньше путь был вшит константой от
 * конкретной Linux-машины, и на другом компьютере оба генератора картинок
 * просто не запускались. Теперь путь берётся из переменной CHROME, а если её
 * нет — из списка обычных мест установки для текущей ОС.
 */

import { existsSync } from 'node:fs';

const CANDIDATES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ],
};

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const found = (CANDIDATES[process.platform] || []).find((p) => existsSync(p));
  if (found) return found;
  throw new Error(
    'не найден Chrome/Edge для playwright-core — укажите путь: CHROME=<путь к exe> node ...'
  );
}
