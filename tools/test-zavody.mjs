// Odjede celé závody mezi boty přes SKUTEČNÉ serverové funkce
// a změří, jestli trať jde projet, kolik se jezdí mimo asfalt
// a jestli těžší bot opravdu vyhrává.
//
//   node tools/test-zavody.mjs [botů] [závodů] [obtížnost]
import hra from '../server/games/racing.js';
import { R, LINE } from '../shared/games/racing/const.js';
import { progress } from '../shared/games/racing/sim.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 4);
const BEHU = Number(process.argv[3] || 5);
const LEVEL = process.argv[4] || 'normal';
const MIX = LEVEL === 'mix';

const LIMIT_S = 240;                       // strop, ať se to nezacyklí

// Hra měří čas přes Date.now(), ale harness odjede tisíce ticků v jediné
// milisekundě – bez virtuálních hodin by všechna kola měla čas 0,0 s
// a pořadí v cíli by rozhodoval shodný timestamp.
let VIRT = Date.now();
Date.now = () => VIRT;
const posunCas = () => { VIRT += 1000 / R.TICK; };
const TICKU = LIMIT_S * R.TICK;

const souhrn = {
  dojeto: 0, aut: 0, casy: [], nejlepsiKolo: [], mimo: [], zaseknuti: 0,
  dokonceno: 0, vitezove: {},
};

for (let beh = 0; beh < BEHU; beh++) {
  const rng = makeRng(1000 + beh * 7919);
  const players = Array.from({ length: POCET }, (_, i) => ({
    uid: 'P' + (i + 1), name: 'Bot ' + (i + 1), bot: true,
    botLevel: MIX ? ['easy', 'normal', 'hard'][i % 3] : LEVEL,
  }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng, options: { stavba: false } });

  // Odpočet v testu nečekáme reálný čas – posuneme start do minulosti.
  state.startAt = Date.now() - 1;

  let mimoTicku = 0, celkemTicku = 0, stuck = 0;
  const posledni = {};

  for (let t = 0; t < TICKU; t++) {
    for (const p of players) {
      const mv = hra.botThink(state, p, ctx);
      if (mv) hra.onInput(state, p, { seq: t, ...mv });
    }
    posunCas();
    hra.tick(state, R.DT, ctx);
    hra.afterSnap(state);

    for (const p of players) {
      const c = state.cars[p.uid];
      if (!c || c.finished) continue;
      celkemTicku++;
      if (c.offTrack) mimoTicku++;
      // zaseknutí = skoro nulová rychlost mimo odpočet
      const v = Math.hypot(c.vx, c.vy);
      posledni[p.uid] = (v < 25) ? (posledni[p.uid] || 0) + 1 : 0;
      if (posledni[p.uid] === R.TICK * 3) stuck++;   // 3 s bez pohybu
    }

    if (hra.result(state)) break;
  }

  const konec = hra.result(state);
  if (konec) souhrn.dokonceno++;
  souhrn.zaseknuti += stuck;
  souhrn.mimo.push(celkemTicku ? mimoTicku / celkemTicku * 100 : 0);

  for (const p of players) {
    const c = state.cars[p.uid];
    if (!c) continue;
    souhrn.aut++;
    if (c.finished) {
      souhrn.dojeto++;
      souhrn.casy.push((c.finished - state.startAt) / 1000);
    }
    if (c.best) souhrn.nejlepsiKolo.push(c.best / 1000);
  }
  if (konec) {
    const v = players.find(p => p.uid === konec.winners[0]);
    if (v) souhrn.vitezove[v.botLevel] = (souhrn.vitezove[v.botLevel] || 0) + 1;
  }

  if (beh === 0) {
    console.log('=== ukázka prvního závodu ===');
    for (const c of hra.poradi(state)) {
      const kola = c.best ? (c.best / 1000).toFixed(1) + ' s' : '–';
      console.log(`  ${String(c.place || '-').padStart(2)}. ${c.name.padEnd(7)} ${c.botLevel.padEnd(6)}`
        + ` kol ${c.lap}/${R.LAPS}  nejlepší: ${kola}`);
    }
    console.log('  konec:', konec ? konec.reason : 'nedojeto (strop)', '\n');
  }
}

const pr = (a) => (a.length ? (a.reduce((s, x) => s + x, 0) / a.length) : 0);
console.log(`=== ${BEHU} závodů, ${POCET} botů (${LEVEL}) ===`);
console.log(`  dokončeno:      ${souhrn.dokonceno}/${BEHU} ${souhrn.dokonceno === BEHU ? '✓' : '✗ někdo se nedojel'}`);
console.log(`  aut v cíli:     ${souhrn.dojeto}/${souhrn.aut}`);
console.log(`  čas na závod:   ${pr(souhrn.casy).toFixed(1)} s (${R.LAPS} kola)`);
console.log(`  nejlepší kolo:  ${pr(souhrn.nejlepsiKolo).toFixed(1)} s`);
console.log(`  mimo asfalt:    ${pr(souhrn.mimo).toFixed(1)} % času`);
console.log(`  zaseknutí:      ${souhrn.zaseknuti} (3 s bez pohybu)`);
if (MIX) console.log(`  vítězové:       ${JSON.stringify(souhrn.vitezove)}`);
