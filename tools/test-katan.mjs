// Odehraje celé partie Katanu mezi boty PŘES SKUTEČNÉ serverové funkce
// a ověří pravidla, která by se ručně hledala těžko.
//
//   node tools/test-katan.mjs [hráčů] [zápasů]
import hra from '../server/games/katan.js';
import {
  novaHra, body, bodyVerejne, kolikKaret, pocetStaveb, lzeOsada, lzeSilnice,
  lzeMesto, maNa, kurz, delkaCesty, postavOsadu, postavSilnici, postavMesto,
  hod, zahod, presunZlodeje, okradni, koupKartu, zahrajKartu, lzeZahratKartu,
  obchodBanka, nabidni, prijmiNabidku, zrusNabidku, konecTahu, BANKA_NA_SUROVINU,
} from '../shared/games/katan/pravidla.js';
import {
  SUROVINY, POUST, novaDeska, POLE_SUROVIN, ZETONY, DEV_BALICEK, BODU_NA_VYHRU,
} from '../shared/games/katan/deska.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 4);
const BEHU = Number(process.argv[3] || 30);
const STROP = 60000;

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

// Suroviny se nesmí ztrácet ani množit: v rukou + v bance = 19 od každé.
function surovinySedi(s) {
  return SUROVINY.every(r =>
    s.suroviny.reduce((a, x) => a + x[r], 0) + s.banka[r] === BANKA_NA_SUROVINU);
}

// ── Odehraj zápas ────────────────────────────────────────────
function zapas(seed, levely) {
  const rng = makeRng(seed);
  const players = levely.map((lv, i) => ({
    uid: 'P' + i, name: 'Hráč ' + i, bot: true, botLevel: lv,
  }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng });

  const st = { kroku: 0, zaseknuto: false, surovinySedi: true };
  while (hra.result(state) === null && st.kroku < STROP) {
    const pred = state.hra.akci;
    hra.zahrajZa(state, ctx, null);
    st.kroku++;
    if (!surovinySedi(state.hra)) st.surovinySedi = false;
    if (state.hra.akci === pred) { st.zaseknuto = true; break; }
  }
  st.dokonceno = !!hra.result(state);
  st.tahu = state.hra.tahu;
  st.vitezLevel = state.hra.vitez === null ? null
    : players.find(p => p.uid === state.seats[state.hra.vitez]).botLevel;
  st.stav = state;
  return st;
}

// ── 1. Deska ─────────────────────────────────────────────────
{
  const d = novaDeska(makeRng(99));
  zkus('19 polí', d.pole.length === 19, String(d.pole.length));
  zkus('54 vrcholů', d.vrcholy.length === 54, String(d.vrcholy.length));
  zkus('72 hran', d.hrany.length === 72, String(d.hrany.length));
  zkus('9 přístavů', d.pristavy.length === 9, String(d.pristavy.length));
  const vse = d.pristavy.filter(p => p.typ === 'vse').length;
  zkus('4× přístav 3:1 a 5× surovinový', vse === 4 && d.pristavy.length - vse === 5,
    `${vse} univerzálních, ${d.pristavy.length - vse} surovinových`);
  const bezCisla = d.pole.filter(p => p.cislo === null);
  zkus('jen poušť je bez čísla', bezCisla.length === 1 && bezCisla[0].surovina === POUST,
    `${bezCisla.length} polí`);
  zkus('zloděj začíná na poušti', d.pole[d.zlodej].surovina === POUST, d.pole[d.zlodej].surovina);
  const spatne = d.vrcholy.filter(v => v.sousedi.length < 2 || v.sousedi.length > 3).length;
  zkus('každý vrchol má 2 nebo 3 sousedy', spatne === 0, `${spatne} špatných`);
  zkus('balíček karet má 25', DEV_BALICEK.length === 25, String(DEV_BALICEK.length));
}

// ── 2. Dohrají se partie? ────────────────────────────────────
{
  const levely = Array.from({ length: POCET }, () => 'normal');
  let hotovo = 0, zaseknuto = 0, sedi = 0;
  const tahy = [];
  for (let i = 0; i < BEHU; i++) {
    const r = zapas(3000 + i * 7919, levely);
    if (r.dokonceno) hotovo++;
    if (r.zaseknuto) zaseknuto++;
    if (r.surovinySedi) sedi++;
    tahy.push(r.tahu);
  }
  const med = [...tahy].sort((a, b) => a - b)[Math.floor(tahy.length / 2)];
  zkus(`${BEHU}× dohráno do konce`, hotovo === BEHU, `${hotovo}/${BEHU}`);
  zkus('žádné zaseknutí', zaseknuto === 0, `${zaseknuto} zaseknutých`);
  zkus('suroviny se neztrácejí ani nemnoží', sedi === BEHU, `${sedi}/${BEHU} zápasů v pořádku`);
  console.log(`\n  ${POCET} hráčů: medián ${med} tahů na partii (min ${Math.min(...tahy)}, max ${Math.max(...tahy)})`);
}

// ── 3. Rozlišují se obtížnosti? ──────────────────────────────
{
  const N = Math.max(2, Math.min(POCET, 4));
  const levely = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 'hard' : 'easy'));
  const vyhry = {};
  const BEHU2 = 120;
  for (let i = 0; i < BEHU2; i++) {
    const r = zapas(220000 + i * 104729, levely);
    if (r.vitezLevel) vyhry[r.vitezLevel] = (vyhry[r.vitezLevel] || 0) + 1;
  }
  const cekano = (levely.filter(l => l === 'hard').length / N) * 100;
  const skutecne = ((vyhry.hard || 0) / BEHU2) * 100;
  zkus('hard poráží easy', skutecne > cekano + 5,
    `hard ${skutecne.toFixed(1)} % výher (náhoda by dala ${cekano.toFixed(0)} %)`);
}

// ── 4. Rozmístění ────────────────────────────────────────────
{
  let s = novaHra(4, makeRng(11));
  const poradi = [];
  for (let k = 0; k < 8; k++) {
    poradi.push(s.naTahu);
    const v = s.deska.vrcholy.find(x => lzeOsada(s, s.naTahu, x.id));
    s = postavOsadu(s, v.id);
    const e = s.deska.hrany.find(x => lzeSilnice(s, s.naTahu, x.id));
    s = postavSilnici(s, e.id);
  }
  zkus('rozmístění jde hadem', poradi.join(',') === '0,1,2,3,3,2,1,0', poradi.join(','));
  zkus('po rozmístění se hází', s.faze === 'hod', s.faze);
  zkus('každý má 2 osady a 2 silnice',
    [0, 1, 2, 3].every(h => pocetStaveb(s, h, 'osada') === 2 && pocetStaveb(s, h, 'silnice') === 2),
    'sedí');
  zkus('a 2 body', [0, 1, 2, 3].every(h => body(s, h) === 2), [0, 1, 2, 3].map(h => body(s, h)).join(','));
  const maSuroviny = [0, 1, 2, 3].every(h => kolikKaret(s.suroviny[h]) > 0);
  zkus('druhá osada nese suroviny', maSuroviny, [0, 1, 2, 3].map(h => kolikKaret(s.suroviny[h])).join(','));
}

// ── 5. Odstup osad ───────────────────────────────────────────
{
  let s = novaHra(2, makeRng(22));
  const v = s.deska.vrcholy.find(x => x.sousedi.length === 3);
  s = postavOsadu(s, v.id);
  const soused = v.sousedi[0];
  zkus('na sousední vrchol se stavět nesmí', lzeOsada(s, 1, soused) === false, `vrchol ${soused}`);
  const dal = s.deska.vrcholy.find(x => x.id !== v.id && !v.sousedi.includes(x.id) && x.majitel === null);
  zkus('o dva dál už ano', lzeOsada(s, 1, dal.id) === true, `vrchol ${dal.id}`);
}

// ── 6. Nejdelší cesta se láme cizí osadou ────────────────────
// Předloha tohle pravidlo neměla.
{
  const s = novaHra(2, makeRng(33));
  // Najdeme řetěz pěti hran za sebou.
  const retez = [];
  let vrchol = s.deska.hrany[0].v1;
  let hrana = s.deska.hrany[0];
  const pouzite = new Set();
  while (retez.length < 5) {
    retez.push(hrana.id);
    pouzite.add(hrana.id);
    vrchol = hrana.v1 === vrchol ? hrana.v2 : hrana.v1;
    const dalsi = s.deska.hrany.find(e => !pouzite.has(e.id) && (e.v1 === vrchol || e.v2 === vrchol));
    if (!dalsi) break;
    hrana = dalsi;
  }
  for (const id of retez) s.deska.hrany[id].majitel = 0;
  const bezPrekazky = delkaCesty(s, 0);
  zkus('pět silnic za sebou = cesta 5', bezPrekazky === 5, String(bezPrekazky));

  // Doprostřed dáme cizí osadu.
  const stred = s.deska.hrany[retez[2]].v1;
  s.deska.vrcholy[stred].majitel = 1;
  s.deska.vrcholy[stred].typ = 'osada';
  const sPrekazkou = delkaCesty(s, 0);
  zkus('cizí osada cestu zlomí', sPrekazkou < bezPrekazky, `${bezPrekazky} → ${sPrekazkou}`);
}

// ── 7. Banka je konečná ──────────────────────────────────────
{
  let s = novaHra(2, makeRng(44));
  s.faze = 'akce';
  s.banka.drevo = 1;
  s.suroviny[0].drevo = 0;
  // Pole s dřevem a číslem – oba hráči na něm mají osadu.
  const p = s.deska.pole.find(x => x.surovina === 'drevo' && x.cislo !== null);
  const vrcholy = s.deska.poleVrcholy[p.id];
  s.deska.vrcholy[vrcholy[0]].majitel = 0; s.deska.vrcholy[vrcholy[0]].typ = 'osada';
  s.deska.vrcholy[vrcholy[3]].majitel = 1; s.deska.vrcholy[vrcholy[3]].typ = 'osada';
  s.faze = 'hod';
  s.kostky = null;
  const d1 = Math.min(6, p.cislo - 1), d2 = p.cislo - d1;
  const po = hod(s, d1, d2);
  const dostali = po.suroviny[0].drevo + po.suroviny[1].drevo;
  zkus('když banka nestačí na všechny, nedostane nikdo', dostali === 0,
    `banka měla 1, chtěli 2, rozdáno ${dostali}`);
}

// ── 8. Koupenou kartu nejde hned zahrát ──────────────────────
// Předloha to nehlídala.
{
  let s = novaHra(2, makeRng(55));
  s.faze = 'akce';
  s.suroviny[0] = { drevo: 0, cihla: 0, vlna: 1, obili: 1, ruda: 1 };
  s.balicek = ['rytir'];
  s = koupKartu(s);
  zkus('karta se koupila', s.karty[0].length === 1, JSON.stringify(s.karty[0]));
  zkus('a hned se hrát nedá', lzeZahratKartu(s, 0, 'rytir') === false, 'zablokováno');
  s.faze = 'akce';
  s = konecTahu(s);
  s.naTahu = 0; s.faze = 'akce';
  zkus('další tah už ano', lzeZahratKartu(s, 0, 'rytir') === true, 'povoleno');
}

// ── 9. Sedmička: zahazování a zloděj ─────────────────────────
{
  let s = novaHra(3, makeRng(66));
  s.faze = 'hod';
  s.suroviny[0] = { drevo: 4, cihla: 4, vlna: 0, obili: 0, ruda: 0 };  // 8 karet
  s.suroviny[1] = { drevo: 2, cihla: 0, vlna: 0, obili: 0, ruda: 0 };  // 2 karty
  const po = hod(s, 3, 4);
  zkus('sedmička spustí zahazování', po.faze === 'zahazuje', po.faze);
  zkus('zahazuje jen ten, kdo má víc než 7', Object.keys(po.zahazuji).join(',') === '0',
    JSON.stringify(po.zahazuji));
  zkus('a zahazuje polovinu', po.zahazuji[0] === 4, String(po.zahazuji[0]));

  const spatne = zahod(po, 0, { drevo: 1, cihla: 0, vlna: 0, obili: 0, ruda: 0 });
  zkus('míň karet zahodit nejde', spatne.faze === 'zahazuje' && spatne.zahazuji[0] === 4, 'odmítnuto');

  const dobre = zahod(po, 0, { drevo: 2, cihla: 2, vlna: 0, obili: 0, ruda: 0 });
  zkus('po zahození jde zloděj', dobre.faze === 'zlodej', dobre.faze);
  zkus('a karty ubyly', kolikKaret(dobre.suroviny[0]) === 4, String(kolikKaret(dobre.suroviny[0])));
}

// ── 10. Kurzy přístavů ───────────────────────────────────────
{
  const s = novaHra(2, makeRng(77));
  zkus('bez přístavu je kurz 4:1', kurz(s, 0, 'drevo') === 4, String(kurz(s, 0, 'drevo')));

  const univ = s.deska.vrcholy.find(v => v.pristav === 'vse');
  if (univ) { univ.majitel = 0; univ.typ = 'osada'; }
  zkus('univerzální přístav dá 3:1', kurz(s, 0, 'drevo') === 3, String(kurz(s, 0, 'drevo')));

  const drevny = s.deska.vrcholy.find(v => v.pristav === 'drevo');
  if (drevny) { drevny.majitel = 0; drevny.typ = 'osada'; }
  zkus('surovinový přístav dá 2:1', kurz(s, 0, 'drevo') === 2, String(kurz(s, 0, 'drevo')));
  zkus('ale jen na svou surovinu', kurz(s, 0, 'ruda') === 3, String(kurz(s, 0, 'ruda')));
}

// ── 11. Suroviny soupeřů jsou tajné ──────────────────────────
{
  const rng = makeRng(88);
  const players = Array.from({ length: 3 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i }));
  const state = hra.createState({ players, rng });
  state.hra.suroviny[0] = { drevo: 3, cihla: 0, vlna: 0, obili: 0, ruda: 0 };
  state.hra.suroviny[1] = { drevo: 0, cihla: 5, vlna: 0, obili: 0, ruda: 0 };
  state.hra.karty[1] = ['rytir', 'monopol'];

  const seat = state.seats.indexOf('P0');
  const v = hra.view(state, 'P0');
  zkus('vidím svoje suroviny', JSON.stringify(v.suroviny) === JSON.stringify(state.hra.suroviny[seat]),
    JSON.stringify(v.suroviny));
  const text = JSON.stringify(v);
  // Od 31. 8. 2026 na přání uživatele: suroviny vidí každý.
  zkus('suroviny ostatních vidím', JSON.stringify(v.surovinyVsech) === JSON.stringify(state.hra.suroviny),
    JSON.stringify(v.surovinyVsech.map(x => x.cihla)));
  zkus('počty karet sedí se surovinami',
    v.pocetKaret.every((n, i) => n === kolikKaret(state.hra.suroviny[i])),
    JSON.stringify(v.pocetKaret));
  zkus('vlastní dev karty dostanu', v.karty.length === state.hra.karty[seat].length,
    `${v.karty.length} karet`);
  zkus('cizí dev karty se neposílají',
    !JSON.stringify(v.pocetDevKaret).includes('rytir') && !text.includes('monopol'),
    'jen počty');
  zkus('balíček se neposílá', v.balicek === undefined && typeof v.balicku === 'number',
    `jen počet: ${v.balicku}`);
}

// ── Obchod mezi hráči ─────────────────────────────
{
  const prazdno = () => ({ drevo: 0, cihla: 0, vlna: 0, obili: 0, ruda: 0 });
  const rng = makeRng(404);
  const players = Array.from({ length: 3 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i }));
  const state = hra.createState({ players, rng });
  const s0 = state.hra;
  s0.faze = 'akce';
  s0.naTahu = 0;
  s0.suroviny[0] = { ...prazdno(), drevo: 3 };
  s0.suroviny[1] = { ...prazdno(), ruda: 2 };
  s0.suroviny[2] = prazdno();

  const n1 = nabidni(s0, { ...prazdno(), drevo: 2 }, { ...prazdno(), ruda: 1 });
  zkus('nabídka se založila', !!n1.nabidka, JSON.stringify(n1.nabidka?.dava));

  const nemam = nabidni(s0, { ...prazdno(), ruda: 9 }, { ...prazdno(), drevo: 1 });
  zkus('nabídnout, co nemám, nejde', !nemam.nabidka, 'odmítnuto');

  const prazdna = nabidni(s0, prazdno(), { ...prazdno(), ruda: 1 });
  zkus('nabídka za nic nejde', !prazdna.nabidka, 'odmítnuto');

  const sam = prijmiNabidku(n1, 0);
  zkus('nabídku si nepřijmu sám', !!sam.nabidka, 'zůstala visít');

  const chudy = prijmiNabidku(n1, 2);
  zkus('bez surovin přijmout nejde', !!chudy.nabidka && chudy.suroviny[2].drevo === 0, 'odmítnuto');

  const hotovo = prijmiNabidku(n1, 1);
  zkus('obchod proběhl', !hotovo.nabidka
    && hotovo.suroviny[0].drevo === 1 && hotovo.suroviny[0].ruda === 1
    && hotovo.suroviny[1].drevo === 2 && hotovo.suroviny[1].ruda === 1,
    JSON.stringify([hotovo.suroviny[0], hotovo.suroviny[1]]));
  const predVymenou = kolikKaret(n1.suroviny[0]) + kolikKaret(n1.suroviny[1]);
  const poVymene = kolikKaret(hotovo.suroviny[0]) + kolikKaret(hotovo.suroviny[1]);
  zkus('výměna karty jen přesune', predVymenou === poVymene, `${predVymenou} → ${poVymene}`);

  const zrus = zrusNabidku(n1);
  zkus('nabídka jde zrušit', !zrus.nabidka, 'zrušena');

  const konec = konecTahu(n1);
  zkus('konec tahu nabídku smaže', !konec.nabidka, 'smaženo');

  // Druhá nabídka přes běžící se neprotlačí.
  const druha = nabidni(n1, { ...prazdno(), drevo: 1 }, { ...prazdno(), ruda: 2 });
  zkus('běží jen jedna nabídka', druha.nabidka.chce.ruda === 1, 'původní zůstala');
}

// ── Boti a nabídky ────────────────────────────────
{
  const prazdno = () => ({ drevo: 0, cihla: 0, vlna: 0, obili: 0, ruda: 0 });
  const rng = makeRng(77);
  const players = [
    { uid: 'P0', name: 'Člověk' },
    { uid: 'P1', name: 'Bot', bot: true, botLevel: 'normal' },
    { uid: 'P2', name: 'Bot2', bot: true, botLevel: 'normal' },
  ];
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng });
  const s = state.hra;
  const ja = state.seats.indexOf('P0');
  const bot = state.seats.indexOf('P1');
  s.faze = 'akce';
  s.naTahu = ja;
  for (let i = 0; i < 3; i++) s.suroviny[i] = prazdno();
  // Botovi chybí na silnici už jen cihla, a dřevo má navíc.
  s.suroviny[bot] = { ...prazdno(), drevo: 2 };
  s.suroviny[ja] = { ...prazdno(), cihla: 2 };

  hra.uprav(state, nabidni(s, { ...prazdno(), cihla: 1 }, { ...prazdno(), drevo: 1 }), ctx);
  zkus('nabídka nastartuje botům budek', state.nabidkaAt > 0, String(state.nabidkaAt > 0));

  hra.botNabidka(state, ctx);
  zkus('bot vezme, co ho posune ke stavbě', state.hra.nabidka === null
    && state.hra.suroviny[bot].cihla === 1, JSON.stringify(state.hra.suroviny[bot]));

  // Nesmyslná nabídka: bot by dal to, co potřebuje, a dostal, co nechce.
  const s2 = state.hra;
  s2.faze = 'akce';
  s2.naTahu = ja;
  s2.suroviny[bot] = { ...prazdno(), cihla: 1, drevo: 1 };
  s2.suroviny[ja] = { ...prazdno(), vlna: 3 };
  hra.uprav(state, nabidni(s2, { ...prazdno(), vlna: 1 }, { ...prazdno(), cihla: 1 }), ctx);
  hra.botNabidka(state, ctx);
  zkus('nevýhodnou nabídku bot odmítne', state.hra.suroviny[bot].cihla === 1,
    JSON.stringify(state.hra.suroviny[bot]));
  zkus('nechtěná nabídka se sama zruší', state.hra.nabidka === null,
    'nezasekne se do konce tahu');
}

// ── Sedmička bere karty losem ────────────────────────
{
  const prazdno = () => ({ drevo: 0, cihla: 0, vlna: 0, obili: 0, ruda: 0 });
  const rng = makeRng(909);
  const players = Array.from({ length: 3 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng });
  const s = state.hra;
  s.faze = 'hod';
  s.naTahu = 0;
  s.suroviny[0] = { ...prazdno(), drevo: 6, cihla: 6 };   // 12 karet → zahodí 6
  s.suroviny[1] = { ...prazdno(), vlna: 3 };              // pod limitem
  s.suroviny[2] = { ...prazdno(), obili: 9 };             // 9 karet → zahodí 4

  const bankaPred = SUROVINY.reduce((a, r) => a + s.banka[r], 0);
  hra.uprav(state, hod(s, 3, 4), ctx);
  const po = state.hra;
  zkus('fáze zahazování se nezastaví', po.faze === 'zlodej', po.faze);
  zkus('nikdo už nemá co zahazovat', Object.keys(po.zahazuji).length === 0, 'prázdné');
  zkus('kdo měl 12, přišel o 6', kolikKaret(po.suroviny[0]) === 6, `${kolikKaret(po.suroviny[0])} karet`);
  zkus('kdo měl 9, přišel o 4', kolikKaret(po.suroviny[2]) === 5, `${kolikKaret(po.suroviny[2])} karet`);
  zkus('kdo měl 3, nepřišel o nic', kolikKaret(po.suroviny[1]) === 3, `${kolikKaret(po.suroviny[1])} karet`);
  const bankaPo = SUROVINY.reduce((a, r) => a + po.banka[r], 0);
  zkus('zahozené karty přibyly v bance', bankaPo - bankaPred === 10,
    `banka +${bankaPo - bankaPred}, zahozeno 6+4`);

  // Los, ne „nejdřív čeho mám nejvíc“: při 6 dřeva a 6 cihel by výběr
  // podle počtu vzal 3 a 3 pokaždé. Na víc seedech to má kolísat.
  const rozlozeni = new Set();
  for (let i = 0; i < 12; i++) {
    const rng2 = makeRng(3000 + i);
    const ctx2 = { rng: rng2, players, reject: () => {}, emit: () => {} };
    const st2 = hra.createState({ players, rng: rng2 });
    st2.hra.faze = 'hod'; st2.hra.naTahu = 0;
    st2.hra.suroviny[0] = { ...prazdno(), drevo: 6, cihla: 6 };
    st2.hra.suroviny[1] = prazdno(); st2.hra.suroviny[2] = prazdno();
    hra.uprav(st2, hod(st2.hra, 3, 4), ctx2);
    rozlozeni.add(st2.hra.suroviny[0].drevo);
  }
  zkus('losuje se, nebere se vždy totéž', rozlozeni.size > 1,
    `zbylo dřeva: ${[...rozlozeni].sort((a, b) => a - b).join(', ')}`);
}

// ── Boti nabízejí obchod sami ───────────────────────
{
  const prazdno = () => ({ drevo: 0, cihla: 0, vlna: 0, obili: 0, ruda: 0 });
  const rng = makeRng(1212);
  const players = Array.from({ length: 3 }, (_, i) => ({
    uid: 'P' + i, name: 'H' + i, bot: true, botLevel: 'normal',
  }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng });
  const s = state.hra;
  s.faze = 'akce';
  s.naTahu = 0;
  state.nabidlSeat = null;
  // Na silnici chybí cihla, vlny je plná ruka.
  s.suroviny[0] = { ...prazdno(), drevo: 1, vlna: 5 };
  s.suroviny[1] = { ...prazdno(), cihla: 2 };
  s.suroviny[2] = prazdno();

  const nabidl = hra.botNabidni(state, ctx, 'normal');
  zkus('bot obchod nabídne sám', nabidl && !!state.hra.nabidka,
    JSON.stringify(state.hra.nabidka && { dava: state.hra.nabidka.dava, chce: state.hra.nabidka.chce }));
  zkus('dává to, čeho má nejvíc', state.hra.nabidka?.dava.vlna > 0, 'vlnu');
  zkus('chce, co mu chybí', state.hra.nabidka?.chce.cihla === 1, 'cihlu');
  zkus('podruhé v tomže tahu už nenabízí',
    hra.botNabidni(state, ctx, 'normal') === false, 'jednou za tah');
  zkus('easy bot nenabízí vůbec', (() => {
    const st = hra.createState({ players, rng: makeRng(7) });
    st.hra.faze = 'akce'; st.hra.naTahu = 0;
    st.hra.suroviny[0] = { ...prazdno(), drevo: 1, vlna: 5 };
    return hra.botNabidni(st, ctx, 'easy') === false;
  })(), 'není na to dost chytrý');

  // Druhý bot má cihlu a chybí mu vlna → měl by vzít.
  hra.botNabidka(state, ctx);
  zkus('nabídku bota vyřeší jiný bot', state.hra.nabidka === null, 'vyřešeno');
}

// ── Výpis ────────────────────────────────────────────────────
console.log('\n=== Osadníci z Katanu ===');
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(44)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
