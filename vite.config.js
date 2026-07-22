import { defineConfig } from 'vite';

/**
 * Vite по умолчанию ставит crossorigin на модульный скрипт входной точки.
 * Яндекс Игры (и другие игровые площадки) раздают загруженную игру с
 * CDN-поддомена без заголовка Access-Control-Allow-Origin — с crossorigin
 * браузер молча блокирует выполнение модуля, и игра не запускается вообще
 * (при этом на localhost всё same-origin, поэтому баг не проявляется).
 */
function stripCrossorigin() {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(="[^"]*")?/g, '');
    },
  };
}

// base: './' — Яндекс Игры раздают игру из подкаталога, все пути должны быть относительными
export default defineConfig({
  base: './',
  plugins: [stripCrossorigin()],
  build: {
    target: 'es2018',
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 1600,
    modulePreload: false,
    // Файлы из подпапки dist/assets/ стабильно 404-ились на реальном
    // хостинге Яндекс Игр (S3), хотя index.html из корня загружался
    // нормально. Кладём бандл прямо в корень dist/, без подпапки —
    // единственное оставшееся структурное отличие между тем, что
    // работает, и тем, что не работает.
    assetsDir: '',
  },
  server: {
    host: true,
    port: 5173,
  },
});
