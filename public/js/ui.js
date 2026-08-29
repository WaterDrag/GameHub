// Drobné UI helpery sdílené hubem i hrami.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const ICONS = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' };

export function toast(msg, type = 'info', ms = 3500) {
  const box = $('#toasts') || document.body.appendChild(el('div', { id: 'toasts' }));
  const t = el('div', { class: `toast ${type}` }, el('span', { text: ICONS[type] || '' }), el('span', { text: msg }));
  box.append(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, ms);
}

export function openModal(id) { $(`#${id}`)?.classList.add('open'); }
export function closeModal(id) { $(`#${id}`)?.classList.remove('open'); }

export function bindModals() {
  $$('.modal').forEach(m => {
    m.addEventListener('mousedown', e => { if (e.target === m) m.classList.remove('open'); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') $$('.modal.open').forEach(m => m.classList.remove('open'));
  });
}

export function fmtMs(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Barva odvozená z uid – stejný hráč má všude stejnou barvu.
export function uidColor(uid) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 62%)`;
}
