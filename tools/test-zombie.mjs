// Měří, jak často se nemrtví zaseknou a jak moc se kupí na sobě.
import arena from '../server/games/arena.js';
import { A, EVENT_BY_KEY, RAMPS } from '../shared/games/arena/const.js';
import { makeRng } from '../shared/rng.js';

const SEK = Number(process.argv[2] || 180);
const Ez = EVENT_BY_KEY.zombies;
const rng = makeRng(4242);
const players = Array.from({ length: 6 }, (_, i) => ({
  uid: 'B' + (i + 1), name: 'B' + (i + 1), bot: true, botLevel: 'normal',
}));
const state = arena.createState({ players, rng, options: { zombies: true } });
let now = Date.now();
const ctx = { rng, players, now, room: null, emit: () => {}, emitTo: () => {}, reject: () => {} };

const naRampe = (z) => RAMPS.some(r => z.x >= r.x && z.y >= r.y && z.x <= r.x + r.w && z.y <= r.y + r.h);

const pred = new Map();
let tickuZ = 0, tickuStaty = 0, tickuStatyNaRampe = 0, tickuNaRampe = 0;
let prekryvu = 0, dvojic = 0;

for (let t = 0; t < SEK * A.TICK; t++) {
  now += 1000 / A.TICK;
  ctx.now = now;
  for (const p of players) {
    const inp = arena.botThink(state, p, ctx);
    if (inp) arena.onInput(state, p, inp, ctx);
  }
  arena.tick(state, A.DT, ctx);

  const zs = state.zombies;
  for (const z of zs) {
    tickuZ++;
    const r = naRampe(z);
    if (r) tickuNaRampe++;
    // Posun za celou sekundu, ne za tick. Zaseknutý zombík se pořád
    // šoupe o pár pixelů sem a tam, takže per-tick měření ho neodhalí –
    // rozhodující je, jestli se za sekundu vůbec někam dostal.
    const p = pred.get(z.id);
    if (!p) { pred.set(z.id, { x: z.x, y: z.y, t }); }
    else if (t - p.t >= A.TICK) {
      const posun = Math.hypot(z.x - p.x, z.y - p.y);
      const ocekavano = Ez.speed;             // px za sekundu při volné cestě
      if (posun < ocekavano * 0.25) { tickuStaty++; if (r) tickuStatyNaRampe++; }
      pred.set(z.id, { x: z.x, y: z.y, t });
    }
  }
  // jak často se překrývají těly
  for (let i = 0; i < zs.length; i++) {
    for (let j = i + 1; j < zs.length; j++) {
      if (zs[i].level !== zs[j].level) continue;
      dvojic++;
      if (Math.hypot(zs[i].x - zs[j].x, zs[i].y - zs[j].y) < Ez.r * 1.6) prekryvu++;
    }
  }
  arena.afterSnap(state);
}

const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + ' %' : '–');
console.log(`=== nemrtví, ${SEK} s ===`);
console.log(`  měření po sekundách: ${tickuZ}`);
console.log(`  sekund bez postupu:       ${tickuStaty}`);
console.log(`  čas strávený na rampě:    ${pct(tickuNaRampe, tickuZ)}`);
console.log(`  z toho na rampě:          ${tickuStatyNaRampe}  (${pct(tickuStatyNaRampe, tickuStaty)} všech zaseknutí)`);
console.log(`  dvojice v sobě (překryv): ${pct(prekryvu, dvojic)}`);
console.log(`\n  šířka ramp: ${[...new Set(RAMPS.map(r => Math.min(r.w, r.h)))].join(', ')} px, průměr zombíka ${Ez.r * 2} px`);
