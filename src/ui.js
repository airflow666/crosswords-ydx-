/** Небольшие DOM-помощники: создание элементов, тосты, тема. */

/** Создать элемент: el('button.btn.primary', { onclick }, 'Текст'|[дети]). */
export function el(spec, props = {}, children = null) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (k === 'onclick') node.addEventListener('click', v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  if (children != null) {
    for (const c of Array.isArray(children) ? children : [children]) {
      if (c == null) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

let toastTimer = null;
export function toast(text) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div.toast', {}, text);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2400);
}

// Стек открытых модалок — нужен, чтобы ESC закрывал именно верхнюю (см. closeTopModal).
const modalStack = [];

/** Модальное окно. onClose вызывается при клике по фону или explicit close(), если closable. */
export function modal(contentNode, { closable = false, onClose } = {}) {
  const overlay = el('div.overlay');
  overlay.appendChild(contentNode);
  const close = () => {
    overlay.remove();
    const i = modalStack.indexOf(overlay);
    if (i >= 0) modalStack.splice(i, 1);
    onClose?.();
  };
  overlay.close = close;
  if (closable) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }
  document.body.appendChild(overlay);
  modalStack.push(overlay);
  return overlay;
}

/** Закрыть верхнюю открытую модалку (для ESC). Возвращает true, если что-то закрыла. */
export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/**
 * Применить тему. 'auto' — снять data-theme (сработает prefers-color-scheme).
 * 'light'/'dark' — жёстко зафиксировать через data-theme на :root.
 */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}

/** Циклический переход темы auto → light → dark → auto. */
export function nextTheme(theme) {
  return theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
}
