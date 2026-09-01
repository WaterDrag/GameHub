// Ověří všechny tři režimy piškvorek PŘES SKUTEČNÉ serverové funkce.
//
//   node tools/test-piskvorky.mjs [zápasů]
import hra from '../server/games/gomoku.js';
import {
  REZIMY, rezimNebo, REMIZA, novaHra, tah, tahy, lzeTah,
  idx, vyherniRada, stavMaleDesky,
} from '../shared/games/gomoku/pravidla.js';
import { makeRng } from '../shared/rng.js';

const BEHU = Number(process.argv[2] || 20);
const STROP = 400;

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

function zapas(seed, rezim, levely) {
  const rng = makeRng(seed);
  const players = levely.map((lv, i) => ({ uid: 'P' + i, name: 'H' + i, bot: true, botLevel: lv }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng, options: { rezim } });

  const st = { kroku: 0, zaseknuto: false, legalni: true };
  while (hra.result(state) === null && st.kroku < STROP) {
    const pred = state.hra.akci;
    hra.zahrajZa(state, ctx, null);
    st.kroku++;
    if (state.hra.akci === pred) { st.zaseknuto = true; break; }
  }
  const r = hra.result(state);
  st.dohrano = r !== null;
  st.remiza = !!r?.draw;
  st.vitez = r?.winners ? levely[Number(r.winners[0].slice(1))] : null;
  st.stav = state.hra;
  return st;
}

// ── Režimy ───────────────────────────────────────────────────
{
  zkus('jsou tři režimy', REZIMY.length === 3, REZIMY.map(r => r.id).join(', '));
  const m = rezimNebo('male'), k = rezimNebo('klasika'), u = rezimNebo('ultimate');
  zkus('malé je 3×3 na tři', m.strana === 3 && m.vyhra === 3, `${m.strana}×${m.strana}, ${m.vyhra} v řadě`);
  zkus('klasika je 15×15 na pět', k.strana === 15 && k.vyhra === 5, `${k.strana}×${k.strana}, ${k.vyhra} v řadě`);
  zkus('ultimátní je ultimate', u.ultimate === true && !m.ultimate && !k.ultimate, 'jen ultimate');
  zkus('neznámý režim spadne na klasiku', rezimNebo('nesmysl').id === 'klasika', 'klasika');
}

// ── Malé 3×3 ─────────────────────────────────────────────────
{
  let s = novaHra('male');
  zkus('malá deska má 9 polí', s.board.length === 9, String(s.board.length));
  zkus('a 9 možných tahů', tahy(s).length === 9, String(tahy(s).length));

  // X: horní řada
  s = tah(s, { x: 0, y: 0 });   // X
  s = tah(s, { x: 0, y: 1 });   // O
  s = tah(s, { x: 1, y: 0 });   // X
  s = tah(s, { x: 1, y: 1 });   // O
  zkus('zatím nikdo nevyhrál', s.winner === null, 'null');
  s = tah(s, { x: 2, y: 0 });   // X → tři v řadě
  zkus('tři v řadě stačí', s.winner === 1, `vítěz ${s.winner}`);
  zkus('a zná se výherní řada', s.winLine?.length === 3, `${s.winLine?.length} pole`);
  zkus('po výhře už se nehraje', tah(s, { x: 2, y: 2 }).akci === s.akci, 'odmítnuto');

  // Obsazené pole
  const t = novaHra('male');
  const po = tah(t, { x: 1, y: 1 });
  zkus('na obsazené se nedá', tah(po, { x: 1, y: 1 }).akci === po.akci, 'odmítnuto');
  zkus('mimo desku taky ne', tah(po, { x: 5, y: 0 }).akci === po.akci, 'odmítnuto');
}

// ── Klasika 15×15 ────────────────────────────────────────────
{
  let s = novaHra('klasika');
  zkus('velká deska má 225 polí', s.board.length === 225, String(s.board.length));

  // X čtyři v řadě – ještě ne výhra
  for (let i = 0; i < 4; i++) {
    s = tah(s, { x: i, y: 0 });         // X
    if (i < 3) s = tah(s, { x: i, y: 5 });  // O
  }
  zkus('čtyři v řadě nestačí', s.winner === null, 'null');
  s = tah(s, { x: 3, y: 5 });           // O dorovná tahy
  s = tah(s, { x: 4, y: 0 });           // X pátý
  zkus('pátý v řadě vyhraje', s.winner === 1, `vítěz ${s.winner}`);
  zkus('výherní řada má 5 polí', s.winLine?.length === 5, `${s.winLine?.length}`);
}

// ── Ultimátní ────────────────────────────────────────────────
{
  const s0 = novaHra('ultimate');
  zkus('ultimátní má 9 desek po 9 polích',
    s0.desky.length === 9 && s0.desky.every(d => d.length === 9), '9×9');
  zkus('na začátku se smí kamkoliv', s0.aktivni === null && tahy(s0).length === 81,
    `${tahy(s0).length} tahů`);

  // Kam zahraju v malé desce, tam soupeř hraje tu velkou.
  const s1 = tah(s0, { velka: 4, mala: 2 });
  zkus('tah pošle soupeře do desky podle malého pole', s1.aktivni === 2, `deska ${s1.aktivni}`);
  zkus('a jinam se nesmí', tahy(s1).every(t => t.velka === 2), 'jen deska 2');
  zkus('tah mimo aktivní desku neprojde',
    tah(s1, { velka: 5, mala: 0 }).akci === s1.akci, 'odmítnuto');
  zkus('v aktivní desce ano', tah(s1, { velka: 2, mala: 0 }).akci > s1.akci, 'projde');

  // Vyhrát malou desku. Ručně psaná sekvence tahů je tu k ničemu –
  // u ultimátní pošle každý tah soupeře jinam a člověk se v tom ztratí.
  // Staví se proto přímo.
  const sm = novaHra('ultimate');
  sm.desky[4] = [1, 1, 0, 2, 2, 0, 0, 0, 0];
  sm.aktivni = 4;
  const smPo = tah(sm, { velka: 4, mala: 2 });      // X dobere řadu 0,1,2
  zkus('řada v malé desce ji připíše', smPo.velke[4] === 1,
    `velké[4] = ${smPo.velke[4]}`);
  zkus('a ostatní desky zůstanou prázdné',
    smPo.velke.filter(x => x !== 0).length === 1, smPo.velke.join(','));
  zkus('na dohranou desku už se nesmí', !lzeTah(smPo, { velka: 4, mala: 5 }),
    'odmítnuto');

  // Přímý test vyhodnocení malé desky
  zkus('řada v malé desce ji vyhraje', stavMaleDesky([1, 1, 1, 0, 0, 0, 0, 0, 0]) === 1, 'X');
  zkus('plná bez řady je remíza',
    stavMaleDesky([1, 2, 1, 1, 2, 2, 2, 1, 1]) === REMIZA, 'remíza');
  zkus('rozehraná není nic', stavMaleDesky([1, 2, 0, 0, 0, 0, 0, 0, 0]) === 0, '0');

  // Poslání na dohranou desku = volná ruka
  const sv = novaHra('ultimate');
  sv.velke[7] = 1;                       // deska 7 už je dohraná
  sv.aktivni = 0;
  const po = tah(sv, { velka: 0, mala: 7 });
  zkus('poslání na dohranou desku dá volnou ruku', po.aktivni === null, 'null');
  zkus('a na dohranou desku se stejně nesmí',
    tahy(po).every(t => t.velka !== 7), 'deska 7 vynechána');

  // Remízová deska se do velké řady nepočítá
  const sr = novaHra('ultimate');
  sr.velke = [1, REMIZA, 1, 0, 0, 0, 0, 0, 0];
  sr.aktivni = 3;
  sr.desky[3] = [1, 1, 0, 0, 0, 0, 0, 0, 0];
  const konec = tah(sr, { velka: 3, mala: 2 });   // X vezme desku 3
  zkus('remízová deska nedělá řadu', konec.winner === null,
    `velké: ${konec.velke.join(',')}`);
}

// ── Výhra na velké desce ─────────────────────────────────────
{
  const s = novaHra('ultimate');
  s.velke = [1, 0, 0, 1, 0, 0, 0, 0, 0];   // X má desky 0 a 3, chybí 6
  s.aktivni = 6;
  s.desky[6] = [1, 1, 0, 0, 0, 0, 0, 0, 0];
  const po = tah(s, { velka: 6, mala: 2 });  // X dobere desku 6 → sloupec 0,3,6
  zkus('tři desky v řadě vyhrají hru', po.winner === 1, `vítěz ${po.winner}`);
  zkus('a zná se řada velkých desek', po.winLine?.length === 3, `${po.winLine?.length}`);
}

// ── Celé partie ──────────────────────────────────────────────
for (const rezim of ['male', 'klasika', 'ultimate']) {
  const st = [];
  for (let i = 0; i < BEHU; i++) st.push(zapas(3000 + i, rezim, ['hard', 'normal']));
  const dohrano = st.filter(x => x.dohrano).length;
  zkus(`${rezim}: ${BEHU}× dohráno`, dohrano === BEHU, `${dohrano}/${BEHU}`);
  zkus(`${rezim}: žádné zaseknutí`, st.every(x => !x.zaseknuto),
    `${st.filter(x => x.zaseknuto).length} zaseknutých`);
  const kroky = st.map(x => x.kroku).sort((a, b) => a - b);
  console.log(`  ${rezim.padEnd(9)} medián ${kroky[Math.floor(BEHU / 2)]} tahů,`
    + ` remíz ${st.filter(x => x.remiza).length}/${BEHU}`);
}

// ── Síla botů ────────────────────────────────────────────────
for (const rezim of ['klasika', 'ultimate']) {
  let hard = 0, easy = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const levely = i % 2 ? ['hard', 'easy'] : ['easy', 'hard'];
    const st = zapas(8000 + i, rezim, levely);
    if (st.vitez === 'hard') hard++; else if (st.vitez === 'easy') easy++;
  }
  const cel = hard + easy;
  const p = cel ? hard / cel : 0;
  zkus(`${rezim}: hard poráží easy`, p > 0.65,
    `hard ${(p * 100).toFixed(1)} % výher (${hard}:${easy}, ${N - cel} remíz)`);
}

// ── Výpis ────────────────────────────────────────────────────
console.log('\n=== Piškvorky ===');
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(46)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
