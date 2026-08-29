// ─────────────────────────────────────────────────────────────
//  Aréna – sdílená simulace.
//
//  Tohle je srdce "lepší odezvy": úplně stejný kód běží na serveru
//  (autorita) i na klientu (predikce). Klient stiskne W a hne se
//  okamžitě, místo aby čekal 40 ms na odpověď serveru. Když pak
//  snapshot dorazí, přehraje si nepotvrzené vstupy znovu a sedne
//  si na pozici serveru.
//
//  Proto tu nesmí být nic nedeterministického – žádné Math.random(),
//  žádné Date.now(), žádný proměnlivý dt.
// ─────────────────────────────────────────────────────────────
import { A, WALLS, DECKS, RAMPS, RAFTS } from './const.js';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ── Výškové úrovně ───────────────────────────────────────────
const inRect = (x, y, r) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;

export function rampAt(x, y) {
  for (const r of RAMPS) if (inRect(x, y, r)) return r;
  return null;
}

// DECKS jsou seřazené odshora, takže jádro věže přebije ochoz pod ním.
export function deckLevelAt(x, y) {
  for (const d of DECKS) if (inRect(x, y, d)) return d.level;
  return 0;
}

// Smí hráč z úrovně `level` vstoupit na (x,y)?
// Okraj plošiny je sráz – nahoru i dolů jen po rampě.
export function canStand(x, y, level, onRamp) {
  const r = rampAt(x, y);
  if (r) return r.lo === level || r.hi === level;
  const l = deckLevelAt(x, y);
  if (onRamp) return l === onRamp.lo || l === onRamp.hi;
  return l === level;
}

// Úroveň po pohybu. Na rampě si hráč drží tu svoji, mění se
// až ve chvíli, kdy z rampy sejde na plošinu nebo na zem.
export function levelAfter(x, y, level) {
  return rampAt(x, y) ? level : deckLevelAt(x, y);
}

// Vidí pozorovatel na cíl? Kdo je výš, ten je schovaný – dokud
// nevystřelí. Záblesk z hlavně ho na chvíli prozradí a je pak
// i normálně zasažitelný.
export const canSeeLevel = (viewerLevel, targetLevel) => targetLevel <= viewerLevel;
export const isLoud = (p, now) => (p.loud || 0) > now;
export const isVisibleTo = (viewerLevel, target, now) =>
  canSeeLevel(viewerLevel, target.level || 0) || isLoud(target, now);

// Dosah klesá s každou úrovní nahoru – výhoda výšky se platí kratší střelou.
export const rangeMul = (level) => Math.pow(A.HIGH_RANGE, Math.max(0, level));

// ── Eventy ───────────────────────────────────────────────────
export const onRaft = (x, y) => RAFTS.some(r => inRect(x, y, r));

// Pod hladinou je ten, kdo stojí níž než dosažený stupeň potopy.
// Vor drží nad vodou i na zemi.
export const isDrowning = (p, stage) =>
  stage > 0 && (p.level || 0) < stage && !onRaft(p.x, p.y);

// Krytý je ten, kdo se drží u zdi. Na střeše proto krytí není –
// výhoda výšky se za bouřky obrací proti tobě.
export function isCovered(x, y, r = A.STORM_COVER) {
  for (const w of WALLS) {
    const nx = clamp(x, w.x, w.x + w.w);
    const ny = clamp(y, w.y, w.y + w.h);
    if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
  }
  return false;
}

// ── Geometrie ────────────────────────────────────────────────
export function circleRect(cx, cy, r, w) {
  const nx = clamp(cx, w.x, w.x + w.w);
  const ny = clamp(cy, w.y, w.y + w.h);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Úsečka × obdélník (Liang–Barsky). Používá se na střely i na
// zjištění, jestli na sebe dva hráči vidí.
export function segRect(x1, y1, x2, y2, w) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - w.x, w.x + w.w - x1, y1 - w.y, w.y + w.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else          { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

// Nejbližší průsečík úsečky s kružnicí; vrací t v <0,1> nebo -1.
export function segCircle(x1, y1, x2, y2, cx, cy, rad) {
  const dx = x2 - x1, dy = y2 - y1;
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy;
  if (a === 0) return (fx * fx + fy * fy <= rad * rad) ? 0 : -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - rad * rad;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + disc) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}

export function hasLOS(x1, y1, x2, y2, walls = WALLS) {
  for (const w of walls) if (segRect(x1, y1, x2, y2, w)) return false;
  return true;
}

// ── Pohyb ────────────────────────────────────────────────────
// Osy řešíme zvlášť, aby hráč po zdi klouzal místo zaseknutí.
// Kromě zdí blokují i srázy plošin – proto se každá osa navíc
// ptá canStand() na cílovou úroveň.
export function moveAndCollide(e, dt, r, walls = WALLS) {
  const level = e.level || 0;
  const onRamp = rampAt(e.x, e.y);

  const blocked = (x, y) => {
    for (const w of walls) if (circleRect(x, y, r, w)) return true;
    return !canStand(x, y, level, onRamp);
  };

  const nx = clamp(e.x + e.vx * dt, r, A.W - r);
  if (blocked(nx, e.y)) e.vx = 0; else e.x = nx;

  const ny = clamp(e.y + e.vy * dt, r, A.H - r);
  if (blocked(e.x, ny)) e.vy = 0; else e.y = ny;

  e.level = levelAfter(e.x, e.y, level);
}

// Jediné místo, kde se hráč hýbe. Volá to server i predikce klienta.
export function applyInput(p, input, dt, walls = WALLS) {
  let dx = input?.dx || 0;
  let dy = input?.dy || 0;

  // Klientovi se nevěří ani ve směru: delší vektor by znamenal
  // rychlejší běh, tak ho normalizujeme.
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }

  // Násobič rychlosti z power-upu sedí na hráči, ne v parametrech –
  // klient si ho nastaví ze snapshotu a predikce tak zrychlí přesně
  // stejně jako server.
  const mul = p.spd || 1;

  p.vx += dx * A.ACCEL * mul * dt;
  p.vy += dy * A.ACCEL * mul * dt;

  const f = Math.exp(-A.FRICTION * dt);
  p.vx *= f;
  p.vy *= f;

  const max = A.MAX_SPEED * mul;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > max) {
    p.vx = p.vx / sp * max;
    p.vy = p.vy / sp * max;
  }

  moveAndCollide(p, dt, A.PLAYER_R, walls);
  if (typeof input?.aim === 'number' && Number.isFinite(input.aim)) p.aim = input.aim;
}

// Vstup od klienta se ořízne dřív, než se ho kdokoliv dotkne.
export function sanitizeInput(msg) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    seq: Math.max(0, Math.floor(n(msg?.seq))),
    dx: clamp(n(msg?.dx), -1, 1),
    dy: clamp(n(msg?.dy), -1, 1),
    aim: n(msg?.aim),
    // vzdálenost k zaměřovači – kam má doletět raketa
    aimD: clamp(n(msg?.aimD), 0, 4000),
    shoot: !!msg?.shoot,
    reload: !!msg?.reload,
  };
}
