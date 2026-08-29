// Odehraje celou stavěnou hru mezi boty: kolo stavby → závod → body,
// a to KOL-krát. Ověří, že se trať poskládá, dá projet a hra skončí.
//
//   node tools/test-stavba.mjs [botů] [her]
import hra from '../server/games/racing.js';
import { R, START, ZAKLAD } from '../shared/games/racing/const.js';
import { DILY } from '../shared/games/racing/dily.js';
import { nearestSeg, useku, progress } from '../shared/games/racing/sim.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 4);
const HER = Number(process.argv[3] || 4);

// Hra měří čas přes Date.now(), ale test odjede tisíce ticků v jediné
// milisekundě – bez virtuálních hodin by lhůty nikdy nevypršely.
let VIRT = Date.now();
Date.now = () => VIRT;

const souhrn = {
  dokonceno: 0, dilu: [], pasti: [], zavodu: 0, dojelo: 0, aut: 0,
  mimo: [], zaseknuti: 0, vitezove: {}, delkaTrati: [], odmitnuto: 0,
};

for (let beh = 0; beh < HER; beh++) {
  const rng = makeRng(2000 + beh * 4093);
  const players = Array.from({ length: POCET }, (_, i) => ({
    uid: 'P' + (i + 1), name: 'Bot ' + (i + 1), bot: true,
    botLevel: ['easy', 'normal', 'hard'][i % 3],
  }));
  const ctx = { rng, players, reject: () => { souhrn.odmitnuto++; }, emit: () => {} };
  const state = hra.createState({ players, rng, options: { stavba: true } });

  let mimoTicku = 0, celkem = 0, stuck = 0;
  const klid = {};
  let posledniFaze = state.faze, zavodu = 0;

  for (let t = 0; t < 300 * R.TICK; t++) {
    VIRT += 1000 / R.TICK;

    for (const p of players) {
      const mv = hra.botThink(state, p, ctx);
      if (mv) hra.onInput(state, p, { seq: t, ...mv });
    }
    hra.tick(state, R.DT, ctx);
    hra.afterSnap(state);

    if (state.faze === 'zavod' && posledniFaze === 'stavba') zavodu++;
    posledniFaze = state.faze;

    if (state.faze === 'zavod') {
      for (const p of players) {
        const c = state.cars[p.uid];
        if (!c || c.finished) continue;
        celkem++;
        if (c.offTrack) mimoTicku++;
        const v = Math.hypot(c.vx, c.vy);
        klid[p.uid] = v < 25 ? (klid[p.uid] || 0) + 1 : 0;
        if (klid[p.uid] === R.TICK * 4) stuck++;
      }
    }

    if (hra.result(state)) break;
  }

  const konec = hra.result(state);
  if (konec) souhrn.dokonceno++;
  souhrn.zavodu += zavodu;
  souhrn.zaseknuti += stuck;
  souhrn.mimo.push(celkem ? (mimoTicku / celkem) * 100 : 0);
  souhrn.dilu.push(state.retez.length - ZAKLAD.length);
  souhrn.pasti.push(state.pasti.length);
  souhrn.delkaTrati.push(useku(state.trat));
  for (const p of players) {
    souhrn.aut++;
    if (state.cars[p.uid]?.finished) souhrn.dojelo++;
  }
  if (konec && konec.winners) {
    const v = players.find(p => p.uid === konec.winners[0]);
    if (v) souhrn.vitezove[v.botLevel] = (souhrn.vitezove[v.botLevel] || 0) + 1;
  }

  if (beh === 0) {
    console.log('=== ukázka první hry ===');
    console.log('  postavená trať:', state.retez.map(d => DILY[d]?.emoji || d).join(' '));
    console.log('  pastí na trati:', state.pasti.map(p => p.typ).join(', ') || '–');
    console.log('  body:', state.seats.map(u => `${state.cars[u]?.name || u}: ${state.body[u]}`).join('  '));
    console.log('  konec:', konec ? (konec.reason || JSON.stringify(konec)) : 'NEDOHRÁNO', '\n');
  }
}

const pr = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
console.log(`=== ${HER} her, ${POCET} botů (stavěná trať) ===`);
console.log(`  dokončeno:      ${souhrn.dokonceno}/${HER} ${souhrn.dokonceno === HER ? '✓' : '✗ někde to viselo'}`);
console.log(`  závodů na hru:  ${(souhrn.zavodu / HER).toFixed(1)} (čekáno ${R.KOL})`);
console.log(`  položeno dílů:  ${pr(souhrn.dilu).toFixed(1)} na hru`);
console.log(`  pastí na trati: ${pr(souhrn.pasti).toFixed(1)}`);
console.log(`  délka trati:    ${pr(souhrn.delkaTrati).toFixed(0)} úseků`);
console.log(`  dojelo do cíle: ${souhrn.dojelo}/${souhrn.aut} aut v posledním závodě`);
console.log(`  mimo asfalt:    ${pr(souhrn.mimo).toFixed(1)} % času`);
console.log(`  zaseknutí:      ${souhrn.zaseknuti} (4 s bez pohybu)`);
console.log(`  odmítnutých tahů: ${souhrn.odmitnuto}`);
console.log(`  vítězové:       ${JSON.stringify(souhrn.vitezove)}`);
