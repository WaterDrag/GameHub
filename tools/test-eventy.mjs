// Odsimuluje zápas se zapnutými eventy a změří, jestli fungují
// tak, jak mají – včetně toho, jestli se před nimi boti umí zachránit.
import arena from '../server/games/arena.js';
import { A, EVENT_BY_KEY } from '../shared/games/arena/const.js';
import { isDrowning, isCovered, onRaft } from '../shared/games/arena/sim.js';
import { makeRng } from '../shared/rng.js';

const which = process.argv[2] || 'flood';
const SEK = Number(process.argv[3] || 120);
const POCET = Number(process.argv[4] || 6);

const rng = makeRng(777);
const players = Array.from({ length: POCET }, (_, i) => ({
  uid: 'B' + (i + 1), name: 'B' + (i + 1), bot: true, botLevel: 'normal',
}));

const options = { flood: false, meteors: false, storm: false, zombies: false };
if (which === 'vse') { options.flood = options.meteors = options.storm = options.zombies = true; }
else options[which] = true;

const state = arena.createState({ players, rng, options });
let now = Date.now();
const ctx = { rng, players, now, room: null, emit: () => {}, emitTo: () => {}, reject: () => {} };

const m = {
  stupne: [], utopeni: 0, meteoritu: 0, minVzdal: [], meteoritZabil: 0, blesku: 0, bleskTrefil: 0,
  bleskTreflKrytého: 0, tickuVeVode: 0, tickuCelkem: 0, zachranenoNaVor: 0, zachranenoNahoru: 0,
};
let hpPred = {};

for (let t = 0; t < SEK * A.TICK; t++) {
  now += 1000 / A.TICK;
  ctx.now = now;
  const stagePred = state.flood.stage;
  const zivyPred = Object.fromEntries(Object.values(state.players).map(p => [p.uid, p.alive]));
  for (const p of Object.values(state.players)) hpPred[p.uid] = p.hp;

  for (const p of players) {
    const inp = arena.botThink(state, p, ctx);
    if (inp) arena.onInput(state, p, inp, ctx);
  }
  arena.tick(state, A.DT, ctx);

  if (state.flood.stage !== stagePred) {
    m.stupne.push({ stupen: state.flood.stage, vterina: Math.round(t / A.TICK) });
  }

  for (const f of state.fx) {
    if (f.k === 'meteor') { m.meteoritu++; let md=1e9; for (const p of Object.values(state.players)) if (p.alive) md=Math.min(md, Math.hypot(p.x-f.x,p.y-f.y)); m.minVzdal.push(Math.round(md)); }
    if (f.k === 'bolt') {
      m.blesku++;
      for (const p of Object.values(state.players)) {
        const d2 = (p.x - f.x) ** 2 + (p.y - f.y) ** 2;
        if (d2 <= EVENT_BY_KEY.storm.hitR ** 2 && hpPred[p.uid] > p.hp) {
          m.bleskTrefil++;
          if (isCovered(p.x, p.y)) m.bleskTreflKrytého++;
        }
      }
    }
    if (f.k === 'drown') m.utopeni++;
  }
  // smrt bez střelce v tick s meteoritem = zabil meteorit
  if (state.fx.some(f => f.k === 'meteor')) {
    for (const p of Object.values(state.players)) if (zivyPred[p.uid] && !p.alive) m.meteoritZabil++;
  }

  for (const p of Object.values(state.players)) {
    if (!p.alive) continue;
    m.tickuCelkem++;
    if (isDrowning(p, state.flood.stage)) m.tickuVeVode++;
    else if (state.flood.stage > 0) {
      if (onRaft(p.x, p.y)) m.zachranenoNaVor++;
      else if ((p.level || 0) >= state.flood.stage) m.zachranenoNahoru++;
    }
  }
  arena.afterSnap(state);
}

const pct = (a, b) => b ? (a / b * 100).toFixed(1) + ' %' : '–';
console.log(`=== ${which}, ${SEK} s, ${POCET} botů ===`);
if (options.flood) {
  console.log(`potopa: stupně ${JSON.stringify(m.stupne)}`);
  console.log(`  utopení: ${m.utopeni}`);
  console.log(`  čas hráčů pod vodou: ${pct(m.tickuVeVode, m.tickuCelkem)}`);
  console.log(`  v bezpečí – na voru: ${pct(m.zachranenoNaVor, m.tickuCelkem)} | nad hladinou: ${pct(m.zachranenoNahoru, m.tickuCelkem)}`);
}
if (options.meteors) {
  const md = m.minVzdal.slice().sort((a, b) => a - b);
  console.log(`meteority: dopadů ${m.meteoritu}, zabito ${m.meteoritZabil}`);
  console.log(`  vzdálenost nejbližšího hráče při dopadu: min ${md[0]}, medián ${md[Math.floor(md.length / 2)]}, max ${md[md.length - 1]} (poloměr zóny ${EVENT_BY_KEY.meteors.r})`);
  console.log(`  dopadů, kde byl někdo do 250 px: ${md.filter(v => v < 250).length} z ${md.length}`);
}
if (options.storm) {
  console.log(`bouře: blesků ${m.blesku}, zásahů ${m.bleskTrefil} (${pct(m.bleskTrefil, m.blesku)} úspěšnost)`);
  console.log(`  z toho trefilo krytého hráče: ${m.bleskTreflKrytého}  ${m.bleskTreflKrytého === 0 ? '✓ krytí funguje' : '✗ CHYBA'}`);
}
const sk = Object.values(state.players).map(p => `${p.frags}/${p.deaths}`);
console.log(`skóre (zásahy/smrti): ${sk.join('  ')}`);
