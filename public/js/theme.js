// ─────────────────────────────────────────────────────────────
//  Motivy vzhledu.
//
//  Palety jsou definované v CSS jako proměnné, tenhle modul je
//  jen přepíná a umí je přečíst zpátky jako čísla pro Pixi —
//  díky tomu se přebarví i herní plocha, ne jen okolní menu.
// ─────────────────────────────────────────────────────────────
const KEY = 'gh_theme';

export const THEMES = [
  { id: 'midnight', name: 'Půlnoc',   emoji: '🌌', note: 'výchozí' },
  { id: 'neon',     name: 'Neon',     emoji: '⚡', note: 'ostrý kontrast' },
  { id: 'sakura',   name: 'Sakura',   emoji: '🌸', note: 'jemný' },
  { id: 'crt',      name: 'Terminál', emoji: '🖥️', note: 'zelený fosfor' },
  { id: 'ember',    name: 'Uhlík',    emoji: '🔥', note: 'teplý' },
  { id: 'arctic',   name: 'Arktida',  emoji: '❄️', note: 'světlý' },
];

const bus = new EventTarget();

export function getTheme() {
  const saved = localStorage.getItem(KEY);
  return THEMES.some(t => t.id === saved) ? saved : 'midnight';
}

export function applyTheme(id, persist = true) {
  const t = THEMES.some(x => x.id === id) ? id : 'midnight';
  document.documentElement.dataset.theme = t;
  if (persist) localStorage.setItem(KEY, t);
  bus.dispatchEvent(new CustomEvent('change', { detail: { theme: t, colors: colors() } }));
  return t;
}

export function onThemeChange(fn) {
  const h = (e) => fn(e.detail);
  bus.addEventListener('change', h);
  return () => bus.removeEventListener('change', h);
}

// ── Čtení palety pro Pixi ────────────────────────────────────
// Pixi chce barvy jako čísla (0x7c6ff7), CSS je má jako text.
function hexToNum(v, fallback) {
  const s = String(v || '').trim().replace('#', '');
  if (s.length === 3) return parseInt(s[0] + s[0] + s[1] + s[1] + s[2] + s[2], 16);
  if (s.length === 6) return parseInt(s, 16);
  return fallback;
}

export function colors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (name, fb) => hexToNum(cs.getPropertyValue(name), fb);
  return {
    bg:      g('--bg', 0x07070d),
    surface: g('--surface', 0x13131f),
    board:   g('--board', 0x14141f),
    line:    g('--board-line', 0xffffff),
    acc:     g('--acc', 0x7c6ff7),
    acc2:    g('--acc2', 0xa78bfa),
    ok:      g('--ok', 0x06d6a0),
    warn:    g('--warn', 0xffd166),
    bad:     g('--bad', 0xff5757),
    tx:      g('--tx', 0xe8e8f0),
  };
}

// Aplikuj co nejdřív, ať stránka neproblikne výchozí paletou.
applyTheme(getTheme(), false);
