// Odsimuluje zápas botů bez prohlížeče a změří, jestli lezou do budov.
import arena from '../server/games/arena.js';
import { A } from '../shared/games/arena/const.js';
import { deckLevelAt } from '../shared/games/arena/sim.js';
import { makeRng } from '../shared/rng.js';

const rng = makeRng(12345);
const LEVEL = process.argv[2] || 'normal';
const SEKUND = Number(process.argv[3] || 90);

const POCET = Number(process.argv[4] || 4);
const players = Array.from({length: POCET}, (_,i) => 'Bot'+(i+1)).map(uid => ({
  uid, name: uid, bot: true, botLevel: LEVEL,
}));

const state = arena.createState({ players, rng });

let now = Date.now();
const ctx = {
  rng, players, now, room: null,
  emit: () => {}, emitTo: () => {}, reject: () => {},
};

const stats = {};
for (const p of players) stats[p.uid] = { ticksNaPatre: {}, maxPatro: 0, frags: 0 };
let vystrelu = 0, zasekle = 0;
const posledni = {};

const TICKS = SEKUND * A.TICK;
for (let t = 0; t < TICKS; t++) {
  now += 1000 / A.TICK;
  ctx.now = now;

  for (const p of players) {
    const inp = arena.botThink(state, p, ctx);
    if (inp) arena.onInput(state, p, inp, ctx);
  }
  arena.tick(state, A.DT, ctx);

  for (const p of players) {
    const sp = state.players[p.uid];
    if (!sp || !sp.alive) continue;
    const lvl = sp.level || 0;
    stats[p.uid].ticksNaPatre[lvl] = (stats[p.uid].ticksNaPatre[lvl] || 0) + 1;
    stats[p.uid].maxPatro = Math.max(stats[p.uid].maxPatro, lvl);
    // zaseknutí = skoro nulový posun několik vteřin v kuse
    const key = p.uid;
    const prev = posledni[key];
    if (prev && Math.hypot(sp.x - prev.x, sp.y - prev.y) < 0.5) {
      prev.n++;
      if (prev.n === 90) zasekle++;          // 3 s bez pohybu
    } else posledni[key] = { x: sp.x, y: sp.y, n: 0 };
  }
  vystrelu += state.fx.filter(f => f.k === 'shot').length;
  arena.afterSnap(state);
}

console.log(`=== ${SEKUND} s zápasu, 4 boti (${LEVEL}) ===\n`);
let celkemNahore = 0, celkemTicku = 0;
for (const p of players) {
  const s = stats[p.uid];
  const sp = state.players[p.uid];
  const total = Object.values(s.ticksNaPatre).reduce((a, b) => a + b, 0) || 1;
  const nahore = total - (s.ticksNaPatre[0] || 0);
  celkemNahore += nahore; celkemTicku += total;
  const rozpis = Object.entries(s.ticksNaPatre)
    .map(([l, n]) => `p${l}: ${(n / total * 100).toFixed(0)}%`).join('  ');
  console.log(`${p.uid}  ${rozpis.padEnd(30)} nejvýš p${s.maxPatro}   ${sp.frags} zásahů / ${sp.deaths} smrtí`);
}
console.log(`\nčas strávený v budovách: ${(celkemNahore / celkemTicku * 100).toFixed(1)} %`);
console.log(`výstřelů celkem: ${vystrelu}`);
console.log(`epizod zaseknutí (3 s bez pohybu): ${zasekle}`);
const skore = players.map(p => state.players[p.uid].frags);
console.log(`limit zásahů: ${state.fragLimit} | konec: ${state.over ? state.over.by : "nedohráno"}`);
console.log(`skóre: ${skore.join(' / ')}  (součet ${skore.reduce((a, b) => a + b, 0)})`);
