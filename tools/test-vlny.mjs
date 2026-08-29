// Ověří náhodné vlny katastrof a rozložení poškození meteoritu.
import arena from '../server/games/arena.js';
import { A, EVENT_BY_KEY } from '../shared/games/arena/const.js';
import { makeRng } from '../shared/rng.js';

const SEK = Number(process.argv[2] || 360);
const BEHU = Number(process.argv[3] || 4);

// ── 1) Rozložení poškození podle vzdálenosti od středu ──
const Em = EVENT_BY_KEY.meteors;
console.log('=== METEORIT: poškození podle vzdálenosti od středu ===');
console.log('(jádro do ' + (Em.core * 100).toFixed(0) + ' % poloměru dostane plnou ránu, okraj ' + (Em.edge * 100).toFixed(0) + ' %)\n');
console.log('podíl poloměru   malý (r150)   střední (r250)   velký (r390)');
for (const t of [0, 0.2, 0.32, 0.5, 0.7, 0.9, 1.0]) {
  const k = t <= Em.core ? 1 : 1 - (1 - Em.edge) * ((t - Em.core) / (1 - Em.core));
  const rada = Em.sizes.map(s => {
    const d = s.dmg * k;
    const smrt = d >= A.HP ? ' ☠' : '  ';
    return (d.toFixed(0) + smrt).padStart(13);
  }).join('');
  console.log(`  ${(t * 100).toFixed(0).padStart(3)} %        ${rada}`);
}
console.log('\n  ☠ = zabije hráče s plným životem (' + A.HP + ' HP)');

// ── 2) Vlny v čase ──
console.log(`\n=== VLNY: ${BEHU} zápasů po ${SEK} s ===`);
const souhrn = { flood: [], meteors: [], storm: [] };
const velikosti = {};

for (let beh = 0; beh < BEHU; beh++) {
  const rng = makeRng(2000 + beh * 3571);
  const players = Array.from({ length: 6 }, (_, i) => ({
    uid: 'B' + (i + 1), name: 'B' + (i + 1), bot: true, botLevel: 'normal',
  }));
  const state = arena.createState({ players, rng, options: { flood: true, meteors: true, storm: true } });
  let now = Date.now();
  const ctx = { rng, players, now, room: null, emit: () => {}, emitTo: () => {}, reject: () => {} };
  const t0 = now;
  const zac = {};

  for (let t = 0; t < SEK * A.TICK; t++) {
    now += 1000 / A.TICK;
    ctx.now = now;
    for (const p of players) {
      const inp = arena.botThink(state, p, ctx);
      if (inp) arena.onInput(state, p, inp, ctx);
    }
    arena.tick(state, A.DT, ctx);
    for (const f of state.fx) {
      if (f.k === 'evstart') zac[f.ev] = now;
      if (f.k === 'evend' && zac[f.ev]) {
        souhrn[f.ev].push({ od: (zac[f.ev] - t0) / 1000, trvani: (now - zac[f.ev]) / 1000 });
        delete zac[f.ev];
      }
    }
    for (const m of state.meteors) if (!m._z) { m._z = 1; velikosti[m.r] = (velikosti[m.r] || 0) + 1; }
    arena.afterSnap(state);
  }
  // nedokončené vlny na konci zápasu
  for (const [k, v] of Object.entries(zac)) souhrn[k].push({ od: (v - t0) / 1000, trvani: (now - v) / 1000, nedokoncena: true });
}

for (const [k, vse] of Object.entries(souhrn)) {
  const list = vse.filter(x => !x.nedokoncena);
  const useknutych = vse.length - list.length;
  if (!list.length) { console.log(`  ${k}: žádná vlna`); continue; }
  const tr = list.map(x => x.trvani);
  const od = list.map(x => x.od);
  console.log(`  ${k.padEnd(8)} dokončených vln ${String(list.length).padStart(2)} (${(list.length / BEHU).toFixed(1)} na zápas) + ${useknutych} useknutých koncem zápasu`);
  console.log(`           start  ${Math.min(...od).toFixed(0)}–${Math.max(...od).toFixed(0)} s   trvání ${Math.min(...tr).toFixed(0)}–${Math.max(...tr).toFixed(0)} s (průměr ${(tr.reduce((a, b) => a + b, 0) / tr.length).toFixed(0)} s)`);
}

console.log('\n=== VELIKOSTI METEORITŮ ===');
const celkem = Object.values(velikosti).reduce((a, b) => a + b, 0);
for (const s of Em.sizes) {
  const n = velikosti[s.r] || 0;
  console.log(`  r=${String(s.r).padStart(3)}  ${String(n).padStart(4)}×  ${(n / celkem * 100).toFixed(0).padStart(3)} %  (váha ${s.w})`);
}
