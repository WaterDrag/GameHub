// Odehraje celé partie Kvaku mezi boty PŘES SKUTEČNÉ serverové funkce
// a ověří pravidla, která by se ručně hledala těžko.
//
//   node tools/test-kvak.mjs [hráčů] [zápasů]
import hra from '../server/games/kvak.js';
import {
  novaHra, tah, skok, plozeni, vzdejSe, preskoc,
  tahy, kamMuze, cileLekninu, cilePlozeni, vsechnyZaby, zabyNa, maKralovnu,
} from '../shared/games/kvak/pravidla.js';
import {
  POLI, STRANA, ZASOBA, SLOZENI, STARTY, KARTY, index, klic, sousedi, novaDeska,
} from '../shared/games/kvak/const.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 2);
const BEHU = Number(process.argv[3] || 30);
const STROP = 4000;

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

// Žab nesmí přibývat odjinud než ze zásoby.
function zabySedi(s) {
  for (let h = 0; h < s.hracu; h++) {
    const na = vsechnyZaby(s, h);
    if (!s.hraci[h].zije) { if (na.length) return false; continue; }
    // 1 královna + nejvýš 2 startovní žabky + co se doplodilo
    const zabek = na.filter(z => !z.kralovna).length;
    if (zabek > 2 + (ZASOBA - s.hraci[h].zasoba)) return false;
    if (na.filter(z => z.kralovna).length > 1) return false;
  }
  // Na jednom poli smí od jednoho hráče stát jen jedna žába.
  for (const seznam of Object.values(s.zaby)) {
    const podle = {};
    for (const z of seznam) {
      const k = `${z.hrac}`;
      podle[k] = (podle[k] || 0) + 1;
      if (podle[k] > 1) return false;
    }
  }
  return true;
}

// ── Odehraj zápas ────────────────────────────────────────────
function zapas(seed, levely) {
  const rng = makeRng(seed);
  const players = levely.map((lv, i) => ({
    uid: 'P' + i, name: 'Hráč ' + i, bot: true, botLevel: lv,
  }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng });

  const st = { kroku: 0, zaseknuto: false, zabySedi: true, stik: 0, plozeni: 0, skoku: 0 };
  while (hra.result(state) === null && st.kroku < STROP) {
    const pred = state.hra.akci;
    const predLog = state.hra.log.length;
    hra.zahrajZa(state, ctx, null);
    st.kroku++;
    if (!zabySedi(state.hra)) st.zabySedi = false;
    for (const r of state.hra.log.slice(predLog)) {
      if (/Štika/.test(r)) st.stik++;
      if (/novou žabku/.test(r)) st.plozeni++;
      if (/přeskočil na jiný leknín/.test(r)) st.skoku++;
    }
    if (state.hra.akci === pred) { st.zaseknuto = true; break; }
  }
  const r = hra.result(state);
  st.dohrano = r !== null;
  st.vitez = r?.winners ? levely[Number(r.winners[0].slice(1))] : null;
  st.remiza = !!r?.draw;
  return st;
}

// ── Deska ────────────────────────────────────────────────────
{
  const rng = makeRng(1);
  const pole = novaDeska(rng, 4);
  zkus('64 kartiček', pole.length === POLI, String(pole.length));

  const pocty = {};
  for (const d of pole) pocty[d] = (pocty[d] || 0) + 1;
  const sedi = Object.entries(SLOZENI).every(([d, n]) => pocty[d] === n);
  zkus('složení balíčku sedí', sedi, JSON.stringify(pocty));

  let bezpecnych = 0, startu = 0;
  for (let h = 0; h < 4; h++) {
    for (const [r, c] of STARTY[h]) {
      startu++;
      const d = pole[index(r, c)];
      if (d === 'voda' || d === 'rakos') bezpecnych++;
    }
  }
  zkus('na startovních polích není past', bezpecnych === startu, `${bezpecnych}/${startu}`);

  // Deska se musí lišit podle seedu, jinak by šlo naučit se ji nazpaměť.
  const jina = novaDeska(makeRng(2), 4);
  zkus('jiný seed dá jinou desku', pole.join() !== jina.join(), 'liší se');
}

// ── Start hry ────────────────────────────────────────────────
{
  for (const hracu of [2, 3, 4]) {
    const s = novaHra(hracu, makeRng(10 + hracu));
    const zab = Object.values(s.zaby).flat();
    zkus(`${hracu} hráči: každý má 3 žáby`, zab.length === hracu * 3, String(zab.length));
    const kralovny = zab.filter(z => z.kralovna).length;
    zkus(`${hracu} hráči: každý má 1 královnu`, kralovny === hracu, String(kralovny));
    const odhalenych = s.odhaleno.filter(Boolean).length;
    zkus(`${hracu} hráči: startovní pole jsou otočená`, odhalenych === hracu * 3, String(odhalenych));
    zkus(`${hracu} hráči: každý má čím táhnout`,
      Array.from({ length: hracu }, (_, h) => tahy(s, h).length).every(n => n > 0), 'ano');
  }
}

// ── Pohyb ────────────────────────────────────────────────────
{
  const s = novaHra(2, makeRng(42));
  // Královna hráče 0 stojí na 0-0.
  const kam = kamMuze(s, 0, 0, 0);
  zkus('z rohu zbývá jediné pole', kam.length === 1, JSON.stringify(kam));
  zkus('na vlastní žábu se nesmí',
    !kam.some(([r, c]) => r === 0 && c === 1), 'sousední vlastní vynechána');

  const daleko = tah(s, 0, 0, true, 3, 3);
  zkus('skok přes půl desky neprojde', daleko.akci === s.akci, 'odmítnuto');

  const cizi = tah(s, 7, 7, true, 6, 6);
  zkus('cizí žábou se táhnout nedá', cizi.akci === s.akci, 'odmítnuto');

  const po = tah(s, 0, 0, true, 1, 1);
  zkus('normální tah projde', po.akci > s.akci, 'ok');
  zkus('kartička se otočila', po.odhaleno[index(1, 1)], 'ano');
  zkus('žába je na novém poli', zabyNa(po, 1, 1).length === 1, 'ano');
  zkus('a na starém už není', zabyNa(po, 0, 0).length === 0, 'ano');
}

// ── Efekty kartiček ──────────────────────────────────────────
{
  const priprav = (druh, kralovna = true) => {
    const s = novaHra(2, makeRng(77));
    s.pole[index(1, 1)] = druh;
    s.odhaleno[index(1, 1)] = false;
    if (!kralovna) {
      // Ať táhne žabka z 0-1, ne královna z 0-0.
      return { s, tah: () => tah(s, 0, 1, false, 1, 1) };
    }
    return { s, tah: () => tah(s, 0, 0, true, 1, 1) };
  };

  // Štika
  const { s: sS, tah: tS } = priprav('stika', false);
  const poS = tS();
  zkus('štika sežere žabku', zabyNa(poS, 1, 1).length === 0, 'pole prázdné');
  zkus('a pole je navždy zavřené', poS.zakazano[index(1, 1)], 'ano');
  zkus('nikdo tam už nesmí', !kamMuze(poS, 0, 0, 0).some(([r, c]) => r === 1 && c === 1), 'ano');

  const { tah: tSk } = priprav('stika', true);
  const poSk = tSk();
  zkus('královna štiku přežije', zabyNa(poSk, 1, 1).some(z => z.kralovna), 'stojí tam');
  zkus('ale tah jí končí', poSk.naTahu === 1, 'na tahu je druhý');

  // Komár
  const { tah: tK } = priprav('komar');
  const poK = tK();
  zkus('komár dá tah navíc', poK.naTahu === 0 && poK.faze === 'tah', 'hraje dál');

  // Voda
  const { tah: tV } = priprav('voda');
  zkus('voda nic nedělá', tV().naTahu === 1, 'tah končí');

  // Sameček + královna
  const { s: sM, tah: tM } = priprav('samec');
  const poM = tM();
  zkus('sameček spustí rozmnožování', poM.faze === 'plozeni', poM.faze);
  const cile = cilePlozeni(poM, 0, 1, 1);
  zkus('a nabídne volná sousední pole', cile.length > 0, `${cile.length} polí`);
  const poP = plozeni(poM, cile[0][0], cile[0][1]);
  zkus('nová žabka se položí', zabyNa(poP, cile[0][0], cile[0][1]).length === 1, 'ano');
  zkus('a ubyla ze zásoby', poP.hraci[0].zasoba === ZASOBA - 1, String(poP.hraci[0].zasoba));

  // Sameček + obyčejná žabka nedělá nic
  const { tah: tM2 } = priprav('samec', false);
  zkus('žabce sameček nepomůže', tM2().faze === 'tah' && tM2().naTahu === 1, 'tah končí');

  // Leknín bez druhého leknínu neskáče
  const { s: sL, tah: tL } = priprav('leknin');
  for (let i = 0; i < POLI; i++) if (sL.pole[i] === 'leknin' && i !== index(1, 1)) sL.pole[i] = 'voda';
  zkus('leknín bez druhého leknínu neskáče', tL().naTahu === 1, 'tah končí');
}

// ── Leknín ───────────────────────────────────────────────────
{
  const s = novaHra(2, makeRng(99));
  s.pole[index(1, 1)] = 'leknin';
  s.odhaleno[index(1, 1)] = false;
  s.pole[index(4, 4)] = 'leknin';
  s.odhaleno[index(4, 4)] = true;

  const po = tah(s, 0, 0, true, 1, 1);
  zkus('leknín nabídne přeskok', po.faze === 'leknin', po.faze);
  const cile = cileLekninu(po, 0, 1, 1);
  zkus('cílem je druhý odhalený leknín',
    cile.length === 1 && cile[0][0] === 4 && cile[0][1] === 4, JSON.stringify(cile));

  const skocil = skok(po, 4, 4);
  zkus('přeskok funguje', zabyNa(skocil, 4, 4).some(z => z.kralovna), 'královna je na 4-4');
  zkus('a tah tím končí', skocil.naTahu === 1, 'ano');

  const nechtel = vzdejSe(po);
  zkus('skákat se nemusí', zabyNa(nechtel, 1, 1).some(z => z.kralovna) && nechtel.naTahu === 1,
    'zůstala stát, tah končí');

  const mimo = skok(po, 6, 6);
  zkus('skočit jinam než na leknín nejde', mimo.akci === po.akci, 'odmítnuto');
}

// ── Vyhazování ───────────────────────────────────────────────
{
  const s = novaHra(2, makeRng(123));
  s.pole[index(1, 1)] = 'voda';
  s.odhaleno[index(1, 1)] = true;
  s.zaby[klic(1, 1)] = [{ hrac: 1, kralovna: false }];

  const po = tah(s, 0, 0, true, 1, 1);
  zkus('cizí žabka se sežere', zabyNa(po, 1, 1).length === 1 && zabyNa(po, 1, 1)[0].hrac === 0, 'ano');

  // Na rákosu se nevyhazuje
  const sR = novaHra(2, makeRng(123));
  sR.pole[index(1, 1)] = 'rakos';
  sR.odhaleno[index(1, 1)] = true;
  sR.zaby[klic(1, 1)] = [{ hrac: 1, kralovna: false }];
  const poR = tah(sR, 0, 0, true, 1, 1);
  zkus('na rákosu se nevyhazuje', zabyNa(poR, 1, 1).length === 2, 'obě žáby stojí vedle sebe');

  // Královna → soupeř končí
  const sK = novaHra(2, makeRng(123));
  sK.pole[index(1, 1)] = 'voda';
  sK.odhaleno[index(1, 1)] = true;
  sK.zaby[klic(1, 1)] = [{ hrac: 1, kralovna: true }];
  const poK = tah(sK, 0, 0, true, 1, 1);
  zkus('sežraná královna vyřadí hráče', !poK.hraci[1].zije, 'vyřazen');
  zkus('a smete mu i ostatní žáby', vsechnyZaby(poK, 1).length === 0, 'deska čistá');
  zkus('hra tím končí', poK.vitez === 0, `vítěz ${poK.vitez}`);
}

// ── Skryté informace ─────────────────────────────────────────
{
  const rng = makeRng(555);
  const players = [{ uid: 'P0', name: 'A' }, { uid: 'P1', name: 'B' }];
  const state = hra.createState({ players, rng });
  const v = hra.view(state, 'P0');
  const text = JSON.stringify(v);

  const odhalenych = state.hra.odhaleno.filter(Boolean).length;
  zkus('vidím jen otočené kartičky',
    v.pole.filter(x => x !== null).length === odhalenych, `${odhalenych} z 64`);

  // Pod neotočenou kartičkou musí být ve výhledu null, ať tam leží cokoliv.
  const skryte = state.hra.odhaleno.map((o, i) => (o ? null : state.hra.pole[i])).filter(Boolean);
  const stikySkryte = skryte.filter(d => d === 'stika').length;
  zkus('skryté štiky se neposílají',
    stikySkryte > 0 && v.pole.filter(x => x === 'stika').length === 0,
    `${stikySkryte} štik zůstalo skrytých`);
  zkus('celá deska ve výhledu není', !text.includes('"deska"'), 'jen odhalené');
}

// ── Celé partie ──────────────────────────────────────────────
{
  const levely = Array.from({ length: POCET }, (_, i) => (i % 2 ? 'normal' : 'hard'));
  const st = [];
  for (let i = 0; i < BEHU; i++) st.push(zapas(2000 + i, levely));

  const dohrano = st.filter(x => x.dohrano).length;
  zkus(`${BEHU}× dohráno do konce`, dohrano === BEHU, `${dohrano}/${BEHU}`);
  zkus('žádné zaseknutí', st.every(x => !x.zaseknuto), `${st.filter(x => x.zaseknuto).length} zaseknutých`);
  zkus('žáby se nemnoží samy', st.every(x => x.zabySedi), `${st.filter(x => !x.zabySedi).length} chybných`);

  const kroky = st.map(x => x.kroku).sort((a, b) => a - b);
  console.log(`  ${POCET} hráčů: medián ${kroky[Math.floor(kroky.length / 2)]} tahů`
    + ` (min ${kroky[0]}, max ${kroky[kroky.length - 1]})`);
  console.log(`  na partii: ${(st.reduce((a, x) => a + x.stik, 0) / BEHU).toFixed(1)} štik,`
    + ` ${(st.reduce((a, x) => a + x.plozeni, 0) / BEHU).toFixed(1)} rozmnožení,`
    + ` ${(st.reduce((a, x) => a + x.skoku, 0) / BEHU).toFixed(1)} skoků po leknínu`);
}

// ── Síla botů ────────────────────────────────────────────────
{
  let hard = 0, easy = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    const levely = i % 2 ? ['hard', 'easy'] : ['easy', 'hard'];
    const st = zapas(7000 + i, levely);
    if (st.vitez === 'hard') hard++; else if (st.vitez === 'easy') easy++;
  }
  const cel = hard + easy;
  const p = cel ? hard / cel : 0;
  zkus('hard poráží easy', p > 0.6, `hard ${(p * 100).toFixed(1)} % výher (náhoda by dala 50 %)`);
}

// ── Výpis ────────────────────────────────────────────────────
console.log('\n=== Kvak! ===');
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(44)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
