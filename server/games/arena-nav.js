// ─────────────────────────────────────────────────────────────
//  Navigační mřížka pro boty – s patry.
//
//  Mapa se rozřeže na políčka a každá výšková úroveň dostane
//  vlastní vrstvu. Uvnitř vrstvy se chodí do osmi směrů, mezi
//  vrstvami jen přes rampu. BFS z cílového políčka pak dá spádové
//  pole, po kterém bot sjede k cíli – klidně i o patro výš.
//
//  Bez toho by bot k budově jen tlačil do srázu a zasekl se.
// ─────────────────────────────────────────────────────────────
import { A, WALLS, DECKS } from '../../shared/games/arena/const.js';
import { circleRect, deckLevelAt, rampAt } from '../../shared/games/arena/sim.js';

const CELL = 40;
const COLS = Math.ceil(A.W / CELL);
const ROWS = Math.ceil(A.H / CELL);
const AREA = COLS * ROWS;
const LEVELS = Math.max(1, Math.max(0, ...DECKS.map(d => d.level)) + 1);
const NODES = AREA * LEVELS;

const CACHE_TTL = 1500;
const CACHE_MAX = 48;

const cx0 = (i) => i % COLS;
const cy0 = (i) => ((i % AREA) / COLS) | 0;

// Předpočítáme, kde se dá stát – zvlášť pro každou úroveň.
// `ramp[i]` navíc říká, že políčko spojuje dvě vrstvy.
const { walk, ramps } = (() => {
  const walk = new Uint8Array(NODES);
  const ramps = new Map();          // index v ploše -> {lo, hi}
  const r = A.PLAYER_R + 6;

  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const x = cx * CELL + CELL / 2;
      const y = cy * CELL + CELL / 2;
      const flat = cy * COLS + cx;

      let solid = x < r || y < r || x > A.W - r || y > A.H - r;
      if (!solid) for (const w of WALLS) if (circleRect(x, y, r, w)) { solid = true; break; }
      if (solid) continue;

      const rp = rampAt(x, y);
      if (rp) {
        ramps.set(flat, rp);
        walk[rp.lo * AREA + flat] = 1;
        walk[rp.hi * AREA + flat] = 1;
      } else {
        walk[deckLevelAt(x, y) * AREA + flat] = 1;
      }
    }
  }
  return { walk, ramps };
})();

const nodeOf = (x, y, level) => {
  const cx = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));
  const cy = Math.min(ROWS - 1, Math.max(0, Math.floor(y / CELL)));
  return Math.max(0, Math.min(LEVELS - 1, level)) * AREA + cy * COLS + cx;
};

function nearestWalkable(node) {
  if (walk[node]) return node;
  const lvl = (node / AREA) | 0;
  const bx = cx0(node), by = cy0(node);
  for (let rad = 1; rad < 8; rad++) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
        const cx = bx + dx, cy = by + dy;
        if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) continue;
        const n = lvl * AREA + cy * COLS + cx;
        if (walk[n]) return n;
      }
    }
  }
  return -1;
}

// Sousedi = osm směrů ve své vrstvě + přestup po rampě.
function neighbours(node, out) {
  let n = 0;
  const lvl = (node / AREA) | 0;
  const bx = cx0(node), by = cy0(node);

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const cx = bx + dx, cy = by + dy;
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) continue;
      const flat = cy * COLS + cx;
      const cand = lvl * AREA + flat;
      if (!walk[cand]) continue;
      // přes roh jen když jsou obě sousední políčka volná,
      // jinak bot "prostřihne" hranu zdi a zasekne se
      if (dx && dy) {
        if (!walk[lvl * AREA + by * COLS + cx]) continue;
        if (!walk[lvl * AREA + cy * COLS + bx]) continue;
      }
      out[n++] = cand;
    }
  }

  const rp = ramps.get(node % AREA);
  if (rp) {
    const other = lvl === rp.lo ? rp.hi : lvl === rp.hi ? rp.lo : -1;
    if (other >= 0) {
      const cand = other * AREA + (node % AREA);
      if (walk[cand]) out[n++] = cand;
    }
  }
  return n;
}

const cache = new Map();
const nbuf = new Int32Array(9);

function bfs(goal) {
  const dist = new Int32Array(NODES).fill(-1);
  const q = new Int32Array(NODES);
  let head = 0, tail = 0;
  dist[goal] = 0;
  q[tail++] = goal;

  while (head < tail) {
    const cur = q[head++];
    const d = dist[cur] + 1;
    const n = neighbours(cur, nbuf);
    for (let i = 0; i < n; i++) {
      const nx = nbuf[i];
      if (dist[nx] !== -1) continue;
      dist[nx] = d;
      q[tail++] = nx;
    }
  }
  return dist;
}

function fieldTo(tx, ty, tlevel) {
  const goal = nearestWalkable(nodeOf(tx, ty, tlevel));
  if (goal < 0) return null;

  const hit = cache.get(goal);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL) return hit.dist;

  const dist = bfs(goal);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(goal, { dist, at: now });
  return dist;
}

// Vrátí jednotkový směr z (x,y,level) k cíli, nebo null když cesta není.
export function flowDir(x, y, level, tx, ty, tlevel) {
  const dist = fieldTo(tx, ty, tlevel);
  if (!dist) return null;

  const from = nearestWalkable(nodeOf(x, y, level));
  if (from < 0) return null;

  const n = neighbours(from, nbuf);
  let best = -1, bestD = dist[from] === -1 ? Infinity : dist[from];
  for (let i = 0; i < n; i++) {
    const nx = nbuf[i];
    if (dist[nx] === -1) continue;
    if (dist[nx] < bestD) { bestD = dist[nx]; best = nx; }
  }
  if (best < 0) return null;

  // miř na střed dalšího políčka, ne na jeho roh
  const gx = cx0(best) * CELL + CELL / 2;
  const gy = cy0(best) * CELL + CELL / 2;
  const ddx = gx - x, ddy = gy - y;
  const len = Math.hypot(ddx, ddy);
  // přestup po rampě je na stejném místě – pak jen pokračuj rovně
  if (len < 1) return null;
  return { x: ddx / len, y: ddy / len };
}
