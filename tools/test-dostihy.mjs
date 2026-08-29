// Odehraje celé partie Dostihů mezi boty a ověří, že pravidla drží.
import hra from '../server/games/dostihy.js';
import { D, TILES, GROUPS } from '../shared/games/dostihy/const.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 4);
const BEHU = Number(process.argv[3] || 5);
const LEVEL = process.argv[4] || 'normal';

const souhrn = { dokonceno: 0, tahu: [], koupi: 0, staveb: 0, najmy: 0, najemCelkem: 0, bankrotu: 0, bank: 0, delka: [],
  prodeju: 0, prodejZa: 0, kurzy: [] };

for (let beh = 0; beh < BEHU; beh++) {
  const rng = makeRng(500 + beh * 991);
  const players = Array.from({ length: POCET }, (_, i) => ({
    uid: 'P' + (i + 1), name: 'Hráč ' + (i + 1), bot: true, botLevel: LEVEL,
  }));
  const ctx = { rng, players, now: Date.now(), reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng });

  let akci = 0, tahu = 0;
  let predTurn = state.turn;
  const t0 = Date.now();

  while (!hra.result(state) && akci < 60000) {
    const uid = hra.cur(state);
    const p = players.find(x => x.uid === uid);
    const mv = hra.botThink(state, p, ctx);
    if (!mv) break;

    // změř dopady
    const penizePred = { ...state.money };
    const majPred = Object.values(state.properties).filter(x => x.owner).length;

    hra.onAction(state, p, mv, ctx);
    akci++;
    if (mv.a === 'buy') souhrn.koupi++;
    if (mv.a === 'build') souhrn.staveb++;
    if (mv.a === 'sell') { souhrn.prodeju++; souhrn.prodejZa += state.money[uid] - penizePred[uid]; }
    if (!souhrn.kurzy.includes(state.rate)) souhrn.kurzy.push(state.rate);
    // nájem = někdo ztratil a jiný přesně tolik získal
    for (const u of state.seats) {
      const rozdil = state.money[u] - penizePred[u];
      if (rozdil < 0 && state.seats.some(o => o !== u && state.money[o] - penizePred[o] === -rozdil)) {
        souhrn.najmy++; souhrn.najemCelkem += -rozdil; break;
      }
    }
    if (state.turn !== predTurn) { tahu++; predTurn = state.turn; }
    // časovač tahu v simulaci neblokuje
    state.deadline = Date.now() + 1e9;
  }

  const konec = hra.result(state);
  if (konec) souhrn.dokonceno++;
  souhrn.tahu.push(tahu);
  souhrn.delka.push(Date.now() - t0);
  souhrn.bankrotu += state.seats.filter(u => state.out[u]).length;
  souhrn.bank += state.parking;

  if (beh === 0) {
    console.log('=== ukázka prvního zápasu ===');
    console.log(state.logs.slice(0, 8).map(l => '  ' + l).join('\n'));
    console.log('  …');
    console.log(state.logs.slice(-6).map(l => '  ' + l).join('\n'));
    console.log('  konec:', konec ? (konec.draw ? 'remíza' : 'vyhrál ' + konec.winners[0]) : 'nedohráno (strop akcí)');
    console.log('  peníze:', state.seats.map(u => `${u}:${state.money[u]}`).join('  '));
    const vlastneno = Object.values(state.properties).filter(x => x.owner).length;
    const zetonu = Object.values(state.properties).reduce((s, x) => s + x.level, 0);
    console.log(`  rozprodáno ${vlastneno}/${Object.keys(state.properties).length} karet, žetonů ${zetonu}\n`);
  }
}

const pr = (a) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(0);
console.log(`=== ${BEHU} zápasů, ${POCET} botů (${LEVEL}) ===`);
console.log(`  dokončeno:      ${souhrn.dokonceno}/${BEHU} ${souhrn.dokonceno === BEHU ? '✓' : '✗ některý se nedohrál'}`);
console.log(`  tahů na zápas:  ${pr(souhrn.tahu)}`);
console.log(`  koupí celkem:   ${souhrn.koupi}`);
console.log(`  staveb celkem:  ${souhrn.staveb}`);
console.log(`  prodejů bance: ${souhrn.prodeju} (za ${souhrn.prodejZa.toLocaleString('cs')} DK)`);
const k = souhrn.kurzy.sort((a, b) => a - b);
console.log(`  výkupní kurzy:  ${k.length ? k[0] + '–' + k[k.length - 1] + ' %' : '–'} (${k.length} různých)`);
console.log(`  nájmů:          ${souhrn.najmy} (celkem ${souhrn.najemCelkem.toLocaleString('cs')} DK)`);
console.log(`  bankrotů:       ${souhrn.bankrotu}`);
console.log(`  zbylý bank:     ${souhrn.bank.toLocaleString('cs')} DK`);
console.log(`  výpočet trval:  ${pr(souhrn.delka)} ms na zápas`);
