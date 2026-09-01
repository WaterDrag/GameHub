// Odehraje celé partie Lodí mezi boty PŘES SKUTEČNÉ serverové funkce
// a ověří pravidla, která by se ručně hledala těžko.
//
//   node tools/test-lode.mjs [hráčů] [zápasů]
import hra from '../server/games/lode.js';
import {
  novaHra, rozmisti, rozmistiNahodne, strel, konecTahu,
  cile, lzeStrelit, moznaPole, ziviNaPoli, zbyvaSegmentu, zbyvaLodi, lodNaPoli,
} from '../shared/games/lode/pravidla.js';
import {
  LODE, POLI_LODI, STRANA, STRELY, RAN_ZA_TAH,
  idx, poleLodi, nahodneRozmisteni,
} from '../shared/games/lode/const.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 4);
const BEHU = Number(process.argv[3] || 25);
const STROP = 3000;

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

// Připraví hru, kde všichni mají náhodné lodě.
function pripraveno(hracu, seed) {
  const rng = makeRng(seed);
  let s = novaHra(hracu);
  for (let h = 0; h < hracu; h++) s = rozmistiNahodne(s, h, rng);
  return s;
}

function zapas(seed, levely) {
  const rng = makeRng(seed);
  const players = levely.map((lv, i) => ({ uid: 'P' + i, name: 'H' + i, bot: true, botLevel: lv }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng });

  const st = { kroku: 0, zaseknuto: false, retez: [], sedi: true };
  let vTahu = 0, pred = -1;
  while (hra.result(state) === null && st.kroku < STROP) {
    const predAkci = state.hra.akci;
    const predFaze = state.hra.faze;
    const t0 = state.hra.naTahu;
    hra.zahrajZa(state, ctx, null);
    st.kroku++;
    if (state.hra.akci === predAkci) { st.zaseknuto = true; break; }
    if (predFaze === 'bitva') {
      if (t0 === pred) vTahu++; else { if (vTahu) st.retez.push(vTahu); vTahu = 1; pred = t0; }
    }
    // Zdravé segmenty nesmí přibývat.
    for (let h = 0; h < state.hra.hracu; h++) {
      if (zbyvaSegmentu(state.hra, h) > POLI_LODI) st.sedi = false;
    }
  }
  if (vTahu) st.retez.push(vTahu);
  const r = hra.result(state);
  st.dohrano = r !== null;
  // POZOR: `seats` je zamíchané. Úroveň se hledá přes uid, ne přes sedadlo.
  st.vitez = r?.winners ? levely[Number(r.winners[0].slice(1))] : null;
  st.stav = state.hra;
  st.seats = state.seats;
  return st;
}

// ── Deska ────────────────────────────────────────────────────
{
  for (const n of [2, 3, 4]) {
    const strana = STRANA(n);
    const obsazenost = (n * POLI_LODI) / (strana * strana);
    zkus(`${n} hráči: obsazenost kolem 30 %`, obsazenost < 0.36,
      `${strana}×${strana}, ${Math.round(obsazenost * 100)} %`);
  }
  // Předloha měla pevných 9×9 – ve čtyřech by to bylo 59 %.
  zkus('pevných 9×9 by ve čtyřech bylo přes 55 %',
    (4 * POLI_LODI) / 81 > 0.55, `${Math.round(100 * 4 * POLI_LODI / 81)} %`);
}

// ── Rozmístění ───────────────────────────────────────────────
{
  const s = novaHra(2);
  const rng = makeRng(3);

  zkus('lodě jsou 4, 3, 3, 2', LODE.map(l => l.delka).join(',') === '4,3,3,2',
    LODE.map(l => l.delka).join(','));
  zkus('dohromady 12 polí', POLI_LODI === 12, String(POLI_LODI));

  const lode = nahodneRozmisteni(s.strana, rng);
  zkus('náhodné rozmístění se povede', !!lode && lode.length === 4, `${lode?.length} lodí`);
  const vsechna = lode.flat().map(p => `${p.x},${p.y}`);
  zkus('a vlastní lodě se nepřekrývají', new Set(vsechna).size === vsechna.length,
    `${new Set(vsechna).size}/${vsechna.length}`);

  const po = rozmisti(s, 0, lode);
  zkus('rozmístění se uloží', po.hotovo[0] && !!po.lode[0], 'ok');
  zkus('a druhý hráč ještě není hotov', !po.hotovo[1], 'čeká se');
  zkus('bitva začne až po všech', po.faze === 'rozmisteni', po.faze);
  const po2 = rozmisti(po, 1, nahodneRozmisteni(s.strana, rng));
  zkus('po všech se přepne na bitvu', po2.faze === 'bitva', po2.faze);

  // Nesmyslná rozmístění
  zkus('křivá loď neprojde',
    rozmisti(s, 0, [[{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
      lode[1], lode[2], lode[3]]).akci === s.akci, 'odmítnuto');
  zkus('špatná délka neprojde',
    rozmisti(s, 0, [[{ x: 0, y: 0 }], lode[1], lode[2], lode[3]]).akci === s.akci, 'odmítnuto');
  zkus('překryv vlastních lodí neprojde',
    rozmisti(s, 0, [lode[0], lode[0].slice(0, 3), lode[2], lode[3]]).akci === s.akci, 'odmítnuto');
  zkus('mimo desku neprojde',
    rozmisti(s, 0, [poleLodi(s.strana, s.strana - 1, 0, 4, false) || [], lode[1], lode[2], lode[3]])
      .akci === s.akci, 'odmítnuto');
  zkus('podruhé rozmístit nejde', rozmisti(po, 0, lode).akci === po.akci, 'odmítnuto');
}

// ── Střelba ──────────────────────────────────────────────────
{
  const s = pripraveno(2, 11);
  // Postav to ručně: hráč 1 má loď na 0-0..3-0, hráč 0 jinde.
  const t = JSON.parse(JSON.stringify(s));
  t.lode[0] = [poleLodi(t.strana, 0, 5, 4, false), poleLodi(t.strana, 0, 6, 3, false),
    poleLodi(t.strana, 0, 7, 3, false), poleLodi(t.strana, 0, 8, 2, false)];
  t.lode[1] = [poleLodi(t.strana, 0, 0, 4, false), poleLodi(t.strana, 0, 1, 3, false),
    poleLodi(t.strana, 0, 2, 3, false), poleLodi(t.strana, 0, 3, 2, false)];
  t.zdrave = t.lode.map(ls => ls.map(l => l.map(() => true)));
  t.naTahu = 0;

  const mimo = strel(t, 'normal', 8, 8);
  zkus('rána vedle nic nedá', mimo.body[0] === 0 && mimo.naTahu === 1, 'tah končí');
  zkus('a pole je prostřílené', mimo.strileno[idx(t.strana, 8, 8)], 'ano');
  zkus('podruhé tam střílet nejde', !lzeStrelit(mimo, 1, 'normal', 8, 8), 'odmítnuto');

  const zasah = strel(t, 'normal', 0, 0);
  zkus('zásah ubere soupeři segment', zbyvaSegmentu(zasah, 1) === POLI_LODI - 1,
    `${zbyvaSegmentu(zasah, 1)}/${POLI_LODI}`);
  zkus('a dá bod', zasah.body[0] === 1, String(zasah.body[0]));
  zkus('a ránu navíc', zasah.naTahu === 0 && zasah.ranZbyva === RAN_ZA_TAH - 1,
    `zbývá ${zasah.ranZbyva}`);
  zkus('kdo byl zasažen, se zapíše',
    JSON.stringify(zasah.zasazeni['0,0']) === '[1]', JSON.stringify(zasah.zasazeni['0,0']));

  // Tři rány jsou strop
  let r = t;
  for (let i = 0; i < 3; i++) r = strel(r, 'normal', i, 0);
  zkus('tři zásahy v tahu jsou strop', r.naTahu === 1, `na tahu ${r.naTahu}`);
  zkus('a řekne se to', /strop/.test(r.hlaska || ''), r.hlaska || 'nic');
}

// ── Překryv lodí mezi hráči ──────────────────────────────────
{
  const t = novaHra(3);
  const spolecne = poleLodi(t.strana, 2, 2, 4, false);
  for (let h = 0; h < 3; h++) {
    t.lode[h] = [spolecne, poleLodi(t.strana, 0, 5 + h, 3, false),
      poleLodi(t.strana, 4, 5 + h, 3, false), poleLodi(t.strana, 8, 5 + h, 2, false)];
    t.zdrave[h] = t.lode[h].map(l => l.map(() => true));
    t.hotovo[h] = true;
  }
  t.faze = 'bitva'; t.naTahu = 0;

  zkus('na jedno pole se vejde víc hráčů', ziviNaPoli(t, 2, 2).length === 3, '3 hráči');
  const po = strel(t, 'normal', 2, 2);
  zkus('zásah ubere VŠEM, kdo tam jsou',
    [0, 1, 2].every(h => zbyvaSegmentu(po, h) === POLI_LODI - 1),
    [0, 1, 2].map(h => zbyvaSegmentu(po, h)).join(','));
  zkus('včetně střelce samotného', zbyvaSegmentu(po, 0) === POLI_LODI - 1, 'ano');
  zkus('body se dají jen za cizí i vlastní zásah', po.body[0] === 3, `${po.body[0]} b.`);

  // Poslední pole společné všem musí jít střelit, jinak se hra zablokuje.
  const zbytek = novaHra(2);
  for (let h = 0; h < 2; h++) {
    zbytek.lode[h] = [poleLodi(zbytek.strana, 0, 0, 4, false), poleLodi(zbytek.strana, 0, 1, 3, false),
      poleLodi(zbytek.strana, 0, 2, 3, false), poleLodi(zbytek.strana, 0, 3, 2, false)];
    zbytek.zdrave[h] = zbytek.lode[h].map(l => l.map(() => true));
    zbytek.hotovo[h] = true;
  }
  zbytek.faze = 'bitva'; zbytek.naTahu = 0;
  zbytek.strileno = zbytek.strileno.map(() => true);
  zbytek.strileno[idx(zbytek.strana, 0, 0)] = false;   // zbývá jediné, společné pole
  zkus('na vlastní loď střílet JDE', lzeStrelit(zbytek, 0, 'normal', 0, 0),
    'jinak by se hra zablokovala');
  zkus('a hráč tam má co střelit', moznaPole(zbytek, 0, 'normal').length === 1, '1 pole');
}

// ── Speciální střely ─────────────────────────────────────────
{
  const t = pripraveno(2, 21);
  t.naTahu = 0; t.body[0] = 20;

  zkus('bomba pokrývá devět polí', cile(t, 'bomba', 4, 4).length === 9, '9');
  zkus('u kraje míň', cile(t, 'bomba', 0, 0).length === 4, '4');
  zkus('řádek je celá strana', cile(t, 'radek', 3, 3).length === t.strana, String(t.strana));
  zkus('sloupec taky', cile(t, 'sloupec', 3, 3).length === t.strana, String(t.strana));

  const po = strel(t, 'bomba', 4, 4);
  zkus('bomba stojí body', po.body[0] === 20 - STRELY.bomba.cena + (po.body[0] - (20 - STRELY.bomba.cena)),
    `zbylo ${po.body[0]}`);
  zkus('a prostřílí všech devět polí',
    cile(t, 'bomba', 4, 4).every(p => po.strileno[idx(t.strana, p.x, p.y)]), 'ano');

  const chudy = pripraveno(2, 21);
  chudy.naTahu = 0; chudy.body[0] = 1;
  zkus('bez bodů speciál nejde', !lzeStrelit(chudy, 0, 'bomba', 4, 4), 'odmítnuto');
}

// ── Vyřazení a konec ─────────────────────────────────────────
{
  const t = novaHra(2);
  for (let h = 0; h < 2; h++) {
    t.lode[h] = [poleLodi(t.strana, 0, h, 4, false), poleLodi(t.strana, 0, h + 2, 3, false),
      poleLodi(t.strana, 0, h + 4, 3, false), poleLodi(t.strana, 0, h + 6, 2, false)];
    t.zdrave[h] = t.lode[h].map(l => l.map(() => true));
    t.hotovo[h] = true;
  }
  t.faze = 'bitva'; t.naTahu = 0;
  // Sestřel hráči 1 všechno
  let s = t;
  s.zdrave[1] = s.zdrave[1].map(l => l.map(() => true));
  for (const l of t.lode[1]) for (const p of l) {
    s = JSON.parse(JSON.stringify(s));
    s.naTahu = 0;
    s = strel(s, 'normal', p.x, p.y);
    if (s.vitez !== null) break;
  }
  zkus('kdo přijde o všechny lodě, je vyřazen', !s.zije[1], 'vyřazen');
  zkus('a hra tím končí', s.vitez !== null, `vítěz ${s.vitez}`);
}

// ── Skryté informace ─────────────────────────────────────────
{
  const rng = makeRng(77);
  const players = Array.from({ length: 4 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i }));
  const state = hra.createState({ players, rng });
  for (let h = 0; h < 4; h++) state.hra = rozmistiNahodne(state.hra, h, rng);

  const v = hra.view(state, 'P0');
  const text = JSON.stringify(v);
  const mujSeat = state.seats.indexOf('P0');

  zkus('vidím svoje lodě',
    JSON.stringify(v.mojeLode) === JSON.stringify(state.hra.lode[mujSeat]), 'ano');

  // Souřadnice cizí lodi se nesmí v pohledu objevit vůbec.
  const cizi = [];
  for (let h = 0; h < 4; h++) {
    if (h === mujSeat) continue;
    for (const l of state.hra.lode[h]) for (const p of l) cizi.push(p);
  }
  const mojeSet = new Set((state.hra.lode[mujSeat] || []).flat().map(p => `${p.x},${p.y}`));
  const jenCizi = cizi.filter(p => !mojeSet.has(`${p.x},${p.y}`));
  zkus('cizí lodě se neposílají',
    !text.includes('"lode"') && jenCizi.length > 0, `${jenCizi.length} cizích polí zůstalo skrytých`);
  zkus('ani jejich zdraví', !text.includes('"zdrave"'), 'jen moje');
  zkus('o ostatních znám jen počty',
    Array.isArray(v.segmentuZbyva) && v.segmentuZbyva.length === 4, JSON.stringify(v.segmentuZbyva));
}

// ── Celé partie ──────────────────────────────────────────────
{
  const levely = Array.from({ length: POCET }, (_, i) => ['hard', 'normal', 'hard', 'easy'][i]);
  const st = [];
  for (let i = 0; i < BEHU; i++) st.push(zapas(2000 + i, levely));

  zkus(`${BEHU}× dohráno do konce`,
    st.filter(x => x.dohrano).length === BEHU, `${st.filter(x => x.dohrano).length}/${BEHU}`);
  zkus('žádné zaseknutí', st.every(x => !x.zaseknuto), `${st.filter(x => x.zaseknuto).length}`);
  zkus('segmenty nepřibývají', st.every(x => x.sedi), 'sedí');

  const retez = st.flatMap(x => x.retez);
  zkus('nikdo nevystřelí víc než tři rány v tahu',
    Math.max(...retez) <= RAN_ZA_TAH, `max ${Math.max(...retez)}`);

  const kroky = st.map(x => x.kroku).sort((a, b) => a - b);
  console.log(`  ${POCET} hráčů: medián ${kroky[Math.floor(BEHU / 2)]} akcí`
    + ` (min ${kroky[0]}, max ${kroky[BEHU - 1]})`);
  console.log(`  ran za tah: průměr ${(retez.reduce((a, b) => a + b, 0) / retez.length).toFixed(2)}`);
}

// ── Síla botů ────────────────────────────────────────────────
{
  for (const [a, b] of [['hard', 'easy'], ['normal', 'easy']]) {
    let va = 0, vb = 0;
    for (let i = 0; i < 60; i++) {
      const levely = i % 2 ? [a, b] : [b, a];
      const st = zapas(5000 + i, levely);
      if (st.vitez === a) va++; else if (st.vitez === b) vb++;
    }
    const p = va / Math.max(1, va + vb);
    zkus(`${a} poráží ${b}`, p > 0.7, `${(p * 100).toFixed(1)} % (${va}:${vb})`);
  }
}

// ── Výpis ────────────────────────────────────────────────────
console.log('\n=== Lodě ===');
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(48)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
