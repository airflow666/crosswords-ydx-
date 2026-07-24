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
 * Диалог «да/нет». Возвращает Promise<boolean>. Закрытие по фону или ESC —
 * это «нет»: у отказа не должно быть последствий.
 *
 * @param {{title?:string, text:string, confirm:string, cancel:string, danger?:boolean}} opts
 */
export function confirm({ title, text, confirm: yes, cancel: no, danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    const box = el('div.modal', {}, [
      title ? el('h2', {}, title) : null,
      el('p', {}, text),
      el('div.actions', {}, [
        el('button.btn' + (danger ? '.danger' : '.primary'), { onclick: () => { done(true); ov.close(); } }, yes),
        el('button.btn.ghost', { onclick: () => { done(false); ov.close(); } }, no),
      ]),
    ]);
    const ov = modal(box, { closable: true, onClose: () => done(false) });
  });
}

/** Есть ли открытая модалка — чтобы игровой экран не ловил клавиши «сквозь» неё. */
export function hasOpenModal() {
  return modalStack.length > 0;
}

/**
 * Закрыть все модалки (смена экрана). Именно close(), а не remove(): иначе
 * onClose не сработает и промис ожидания (например, у диалога рекламы)
 * останется висеть навсегда, а стек — с мусором, из-за которого следующий
 * ESC «закрывал» бы уже несуществующее окно вместо выхода в меню.
 */
export function closeAllModals() {
  while (modalStack.length) modalStack[modalStack.length - 1].close();
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
