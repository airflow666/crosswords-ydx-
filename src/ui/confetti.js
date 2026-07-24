/**
 * Короткий «салют» при победе.
 *
 * Намеренно сдержанный: несколько десятков мелких плиток в цветах самой игры,
 * один раз, меньше двух секунд, поверх экрана и без перехвата нажатий. Смысл —
 * отметить момент, а не устроить фейерверк, который надоест к третьей партии.
 * При системной настройке «уменьшить движение» не запускается вовсе.
 */

const COLORS = ['var(--accent)', 'var(--good)', 'var(--active-strong)', 'var(--warn)'];

/**
 * @param {HTMLElement} host — контейнер (должен быть position: relative/absolute)
 * @param {{count?: number}} [opts]
 * @returns {() => void} функция досрочной остановки
 */
export function celebrate(host, { count = 30 } = {}) {
  const noop = () => {};
  if (!host) return noop;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return noop;

  const layer = document.createElement('div');
  layer.className = 'confetti';
  let maxMs = 0;

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('i');
    // старт — по всей ширине, чуть выше верхней кромки
    const startX = Math.random() * 100;
    // разлёт в стороны тем сильнее, чем дальше от центра
    const drift = (startX - 50) * 0.6 + (Math.random() - 0.5) * 40;
    const durMs = 1300 + Math.random() * 700;
    const delayMs = Math.random() * 350;
    maxMs = Math.max(maxMs, durMs + delayMs);

    piece.style.setProperty('--x', startX + '%');
    piece.style.setProperty('--dx', drift.toFixed(1) + 'px');
    piece.style.setProperty('--rot', Math.round((Math.random() - 0.5) * 720) + 'deg');
    piece.style.setProperty('--w', (5 + Math.random() * 5).toFixed(1) + 'px');
    piece.style.setProperty('--h', (8 + Math.random() * 7).toFixed(1) + 'px');
    piece.style.setProperty('--c', COLORS[i % COLORS.length]);
    piece.style.setProperty('--d', Math.round(durMs) + 'ms');
    piece.style.setProperty('--delay', Math.round(delayMs) + 'ms');
    layer.appendChild(piece);
  }

  host.appendChild(layer);
  const timer = setTimeout(() => layer.remove(), maxMs + 300);
  return () => { clearTimeout(timer); layer.remove(); };
}
