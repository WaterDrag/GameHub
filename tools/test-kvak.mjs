// Odehraje celé partie Kvaku mezi boty PŘES SKUTEČNÉ serverové funkce
// a ověří pravidla, která by se ručně hledala těžko.
//
//   node tools/test-kvak.mjs [hráčů] [zápasů]
import hra from '../server/games/kvak.js';
import {
  novaHra, tah, preskoc, tahy, kamMuze, lzeHrat, lzeVstoupit,
  vsechnyZaby, zabyNa, mojeZabyNa, maKralovnu, druhNa,
} from '../shared/games/kvak/pravidla.js';
import {
  POLI, SLOZENI, STARTY, SAMCI, KARTY, KAPACITA, PODIL_SPINAVE,
  CISTA, SPINAVA, jeSamec, index, klic, novaDeska,
} from '../shared/games/kvak/const.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 2);
const BEHU = Number(process.argv[3] || 30);
const STROP = 4000;

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

// Žab nesmí přibývat odjinud než od samečků.
function zabySedi(s) {
  for (let h = 0; h < s.hracu; h++) {
    const na = vsechnyZaby(s, h);
    if (!s.hraci[h].zije) { if (na.length) return false; continue; }
    const vyplozeno = SAMCI.filter(x => s.hraci[h].plodil[x]).length;
    if (na.filter(z => !z.kralovna).length > 2 + vyplozeno) return false;
    if (na.filter(z => z.kralovna).length > 1) return false;
  }
  // Kapacita kartičky: dvě vlastní na kládě a u samečka, jinak jedna.
  for (const [k, seznam] of Object.entries(s.zaby)) {
    const [r, c] = k.split('-').map(Number);
    const strop = KAPACITA(druhNa(s, r, c));
    const podle = {};
    for (const z of seznam) {
      podle[z.hrac] = (podle[z.hrac] || 0) + 1;
      if (podle[z.hrac] > strop) return false;
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

  const mistaZab = (s, h) => new Set(vsechnyZaby(s, h).map(z => `${z.r}-${z.c}`));
  const st = {
    kroku: 0, zaseknuto: false, zabySedi: true, stik: 0, plozeni: 0, navic: 0,
    tahu: 0, naKomarovi: 0, kroku0: 0, delkyTahu: [],
  };
  while (hra.result(state) === null && st.kroku < STROP) {
    const pred = state.hra.akci;
    const predLog = state.hra.log.length;
    const predHrac = state.hra.naTahu;
    const predMista = mistaZab(state.hra, predHrac);
    const predPouzito = [...state.hra.pouzito];
    hra.zahrajZa(state, ctx, null);
    st.kroku++;
    st.kroku0++;

    // Skončil tah tím, že žába dosedla na komára, který ještě nedal bonus?
    // To by znamenalo, že tam bot přišel pro nic – přesně to hráč hlásil.
    if (state.hra.naTahu !== predHrac && state.hra.akci !== pred) {
      st.tahu++;
      st.delkyTahu.push(st.kroku0);
      st.kroku0 = 0;
      for (const m of mistaZab(state.hra, predHrac)) {
        if (predMista.has(m) || predPouzito.includes(m)) continue;
        const [r, c] = m.split('-').map(Number);
        if (druhNa(state.hra, r, c) === 'komar') st.naKomarovi++;
      }
    }
    if (!zabySedi(state.hra)) st.zabySedi = false;
    for (const r of state.hra.log.slice(predLog)) {
      if (/Štika/.test(r)) st.stik++;
      if (/novou žabku/.test(r)) st.plozeni++;
      if (/Tah navíc|Táhneš ještě/.test(r)) st.navic++;
    }
    if (state.hra.akci === pred) { st.zaseknuto = true; break; }
  }
  const r = hra.result(state);
  st.dohrano = r !== null;
  st.vitez = r?.winners ? levely[Number(r.winners[0].slice(1))] : null;
  return st;
}

// ── Deska ────────────────────────────────────────────────────
{
  const { pole, voda } = novaDeska(makeRng(1), 4);
  zkus('64 kartiček', pole.length === POLI, String(pole.length));

  const pocty = {};
  for (const d of pole) pocty[d] = (pocty[d] || 0) + 1;
  zkus('složení balíčku sedí',
    Object.entries(SLOZENI).every(([d, n]) => pocty[d] === n), JSON.stringify(pocty));
  zkus('od každého samečka je právě jeden',
    SAMCI.every(x => pocty[x] === 1), SAMCI.map(x => `${x}:${pocty[x]}`).join(' '));

  let bezpecnych = 0, startu = 0;
  for (let h = 0; h < 4; h++) {
    for (const [r, c] of STARTY[h]) { startu++; if (pole[index(r, c)] === 'rakos') bezpecnych++; }
  }
  zkus('na startovních polích není past', bezpecnych === startu, `${bezpecnych}/${startu}`);
  zkus('jiný seed dá jinou desku',
    pole.join() !== novaDeska(makeRng(2), 4).pole.join(), 'liší se');

  // Dva druhy vody: ve špinavé může být štika, v čisté nikdy.
  const spinavych = voda.filter(x => x === SPINAVA).length;
  zkus('špinavé vody je asi 40 %',
    Math.abs(spinavych / POLI - PODIL_SPINAVE) < 0.05, `${Math.round(100 * spinavych / POLI)} %`);
  zkus('v čisté vodě není ani jedna štika',
    pole.every((d, i) => d !== 'stika' || voda[i] === SPINAVA), 'všech 8 ve špinavé');
  zkus('a startovní pole jsou čistá', (() => {
    for (let h = 0; h < 4; h++) for (const [r, c] of STARTY[h]) {
      if (voda[index(r, c)] !== CISTA) return false;
    }
    return true;
  })(), 'ano');

  // Na víc seedech, ať to není náhoda jednoho rozdání.
  let spatne = 0;
  for (let i = 0; i < 40; i++) {
    const d = novaDeska(makeRng(500 + i), 4);
    if (!d.pole.every((x, j) => x !== 'stika' || d.voda[j] === SPINAVA)) spatne++;
  }
  zkus('a platí to na 40 deskách', spatne === 0, `${spatne} chybných`);
}

// ── Start hry ────────────────────────────────────────────────
{
  for (const hracu of [2, 3, 4]) {
    const s = novaHra(hracu, makeRng(10 + hracu));
    const zab = Object.values(s.zaby).flat();
    zkus(`${hracu} hráči: každý má 3 žáby`, zab.length === hracu * 3, String(zab.length));
    zkus(`${hracu} hráči: každý má 1 královnu`,
      zab.filter(z => z.kralovna).length === hracu, String(zab.filter(z => z.kralovna).length));
    zkus(`${hracu} hráči: startovní pole jsou otočená`,
      s.odhaleno.filter(Boolean).length === hracu * 3, String(s.odhaleno.filter(Boolean).length));
    zkus(`${hracu} hráči: každý má čím táhnout`,
      Array.from({ length: hracu }, (_, h) => tahy(s, h).length).every(n => n > 0), 'ano');
  }
}

// ── Pohyb ────────────────────────────────────────────────────
{
  const s = novaHra(2, makeRng(42));
  s.pole[index(1, 1)] = 'rakos';
  const kam = kamMuze(s, 0, 0, 0);
  zkus('z rohu zbývá jediné pole', kam.length === 1, JSON.stringify(kam));

  zkus('skok přes půl desky neprojde', tah(s, 0, 0, true, 3, 3).akci === s.akci, 'odmítnuto');
  zkus('cizí žábou se táhnout nedá', tah(s, 7, 7, true, 6, 6).akci === s.akci, 'odmítnuto');

  const po = tah(s, 0, 0, true, 1, 1);
  zkus('normální tah projde', po.akci > s.akci, 'ok');
  zkus('kartička se otočila', po.odhaleno[index(1, 1)], 'ano');
  zkus('žába je na novém poli', zabyNa(po, 1, 1).length === 1, 'ano');
  zkus('a na starém už není', zabyNa(po, 0, 0).length === 0, 'ano');
}

// ── Efekty kartiček ──────────────────────────────────────────
{
  // Táhne královna z 0-0 na 1-1.
  const priprav = (druh) => {
    const s = novaHra(2, makeRng(77));
    s.pole[index(1, 1)] = druh;
    return s;
  };

  // Rákos – nic zvláštního
  zkus('rákos nic nedělá', tah(priprav('rakos'), 0, 0, true, 1, 1).naTahu === 1, 'tah končí');

  // Komár – tah navíc
  const poK = tah(priprav('komar'), 0, 0, true, 1, 1);
  zkus('komár dá tah navíc', poK.naTahu === 0, 'hraje dál');
  zkus('a musí se toutéž žábou',
    tahy(poK, 0).every(t => t.z.r === 1 && t.z.c === 1), 'jen z 1-1');
  zkus('jinou žábou po komárovi ne',
    !tahy(poK, 0).some(t => t.z.r === 0 && t.z.c === 1), 'ostatní zablokované');

  // Komár platí pořád, ne jen poprvé – ale v jednom tahu jen jednou.
  const sK2 = priprav('komar');
  sK2.odhaleno[index(1, 1)] = true;
  zkus('komár platí i na už otočené kartičce',
    tah(sK2, 0, 0, true, 1, 1).naTahu === 0, 'zase tah navíc');
  const dvaKomari = priprav('komar');
  dvaKomari.pole[index(1, 2)] = 'komar';
  const kk = tah(tah(dvaKomari, 0, 0, true, 1, 1), 1, 1, true, 1, 2);
  const zpet = tah(kk, 1, 2, true, 1, 1);
  zkus('ale v jednom tahu z jednoho komára jen jednou',
    zpet.naTahu === 1, 'návrat na první komára tah ukončí');
  zkus('a řekne se proč', /už v tomhle tahu byl snědený/.test(zpet.hlaska || ''),
    zpet.hlaska || 'nic – vypadalo by to jako chyba');

  // Štika – sežere i královnu
  const poS = tah(priprav('stika'), 0, 0, true, 1, 1);
  zkus('štika sežere i královnu', !maKralovnu(poS, 0), 'královna pryč');
  zkus('a hráč tím končí', !poS.hraci[0].zije && poS.vitez === 1, `vítěz ${poS.vitez}`);

  const sZ = priprav('stika');
  const poZ = tah(sZ, 0, 1, false, 1, 1);   // žabka z 0-1
  zkus('štika sežere i žabku', zabyNa(poZ, 1, 1).length === 0, 'pole prázdné');
  zkus('ale hráč hraje dál', poZ.hraci[0].zije, 'žije');

  // Leknín – tah navíc jinou žábou
  const poL = tah(priprav('leknin'), 0, 0, true, 1, 1);
  zkus('leknín dá tah navíc', poL.naTahu === 0, 'hraje dál');
  zkus('ale ne toutéž žábou',
    !tahy(poL, 0).some(t => t.z.r === 1 && t.z.c === 1), 'královna zablokovaná');
  zkus('jinou žábou ano', tahy(poL, 0).length > 0, `${tahy(poL, 0).length} možností`);

  // Leknín bez jiné žáby tah ukončí.
  const sam = priprav('leknin');
  delete sam.zaby[klic(0, 1)];
  delete sam.zaby[klic(1, 0)];
  zkus('leknín bez jiné žáby tah ukončí',
    tah(sam, 0, 0, true, 1, 1).naTahu === 1, 'tah končí');
}

// ── Sameček ──────────────────────────────────────────────────
{
  const s = novaHra(2, makeRng(88));
  s.pole[index(1, 1)] = 'samec1';
  const po = tah(s, 0, 0, true, 1, 1);
  zkus('sameček přidá královně žabku', zabyNa(po, 1, 1).length === 2, `${zabyNa(po, 1, 1).length} žáby`);
  zkus('a vznikne na TÉMŽE poli',
    mojeZabyNa(po, 0, 1, 1).filter(z => !z.kralovna).length === 1, 'pod královnou');
  zkus('sameček se odškrtne', po.hraci[0].plodil.samec1 === true, 'samec1 využitý');
  zkus('a příští tah musí táhnout ona', po.nucena[0] === '1-1', po.nucena[0]);
  zkus('nucení opravdu omezuje výběr',
    tahy(po, 0).every(t => t.z.r === 1 && t.z.c === 1), 'jen z 1-1');
  zkus('tah tím končí', po.naTahu === 1, 'na tahu je druhý');

  // Podruhé týž sameček nedá nic.
  const znovu = { ...po, naTahu: 0, nucena: [null, null] };
  const po2 = tah(znovu, 1, 1, true, 1, 2);
  const zpatky = tah({ ...po2, naTahu: 0 }, 1, 2, true, 1, 1);
  zkus('týž sameček podruhé neplodí',
    zabyNa(zpatky, 1, 1).filter(z => z.hrac === 0 && !z.kralovna).length <= 1, 'nic navíc');

  // Jiný sameček plodí zvlášť.
  const t2 = novaHra(2, makeRng(88));
  t2.pole[index(1, 1)] = 'samec2';
  t2.hraci[0].plodil.samec1 = true;
  zkus('jiný sameček plodí i tak',
    tah(t2, 0, 0, true, 1, 1).hraci[0].plodil.samec2 === true, 'samec2 využitý');

  // Žabce sameček nepomůže.
  const t3 = novaHra(2, makeRng(88));
  t3.pole[index(1, 1)] = 'samec3';
  const poZ = tah(t3, 0, 1, false, 1, 1);
  zkus('žabce sameček nepomůže', poZ.hraci[0].plodil.samec3 === false, 'nic se nestalo');

  // Čtyři samečci = strop čtyř žabek navíc.
  zkus('samečci jsou čtyři', SAMCI.length === 4, SAMCI.join(', '));
}

// ── Kláda ────────────────────────────────────────────────────
{
  const s = novaHra(2, makeRng(55));
  s.pole[index(1, 1)] = 'klada';
  s.odhaleno[index(1, 1)] = true;

  zkus('na kládu se vejdou dvě vlastní', KAPACITA('klada') === 2, '2');
  const jedna = tah(s, 0, 0, true, 1, 1);
  const dve = tah({ ...jedna, naTahu: 0 }, 0, 1, false, 1, 1);
  zkus('a opravdu tam obě stojí', mojeZabyNa(dve, 0, 1, 1).length === 2, '2 žáby');

  // Dvě soupeřovy na kládě = nedotknutelné.
  const u = novaHra(2, makeRng(55));
  u.pole[index(3, 3)] = 'klada';
  u.odhaleno[index(3, 3)] = true;
  u.zaby[klic(3, 3)] = [{ hrac: 1, kralovna: false }, { hrac: 1, kralovna: true }];
  u.zaby[klic(3, 4)] = [{ hrac: 0, kralovna: false }];
  zkus('na kládu se dvěma soupeři se nevstoupí',
    !lzeVstoupit(u, 0, 3, 3), 'zakázáno');

  // Jedna soupeřova se bere normálně.
  const v = novaHra(2, makeRng(55));
  v.pole[index(3, 3)] = 'klada';
  v.odhaleno[index(3, 3)] = true;
  v.zaby[klic(3, 3)] = [{ hrac: 1, kralovna: false }];
  v.zaby[klic(3, 4)] = [{ hrac: 0, kralovna: false }];
  const po = tah(v, 3, 4, false, 3, 3);
  zkus('jedna soupeřova na kládě se sežere',
    zabyNa(po, 3, 3).length === 1 && zabyNa(po, 3, 3)[0].hrac === 0, 'sežrána');
}

// ── Vyhazování ───────────────────────────────────────────────
{
  const s = novaHra(2, makeRng(123));
  s.pole[index(1, 1)] = 'rakos';
  s.odhaleno[index(1, 1)] = true;
  s.zaby[klic(1, 1)] = [{ hrac: 1, kralovna: false }];
  const po = tah(s, 0, 0, true, 1, 1);
  zkus('cizí žabka se sežere',
    zabyNa(po, 1, 1).length === 1 && zabyNa(po, 1, 1)[0].hrac === 0, 'ano');

  const sK = novaHra(2, makeRng(123));
  sK.pole[index(1, 1)] = 'rakos';
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

  const odhalenych = state.hra.odhaleno.filter(Boolean).length;
  zkus('vidím jen otočené kartičky',
    v.pole.filter(x => x !== null).length === odhalenych, `${odhalenych} z 64`);
  const skryteStiky = state.hra.odhaleno
    .map((o, i) => (o ? null : state.hra.pole[i])).filter(d => d === 'stika').length;
  zkus('skryté štiky se neposílají',
    skryteStiky > 0 && v.pole.filter(x => x === 'stika').length === 0,
    `${skryteStiky} štik zůstalo skrytých`);
}

// ── Celé partie ──────────────────────────────────────────────
{
  const levely = Array.from({ length: POCET }, (_, i) => (i % 2 ? 'normal' : 'hard'));
  const st = [];
  for (let i = 0; i < BEHU; i++) st.push(zapas(2000 + i, levely));

  zkus(`${BEHU}× dohráno do konce`,
    st.filter(x => x.dohrano).length === BEHU, `${st.filter(x => x.dohrano).length}/${BEHU}`);
  zkus('žádné zaseknutí', st.every(x => !x.zaseknuto), `${st.filter(x => x.zaseknuto).length} zaseknutých`);
  zkus('žáby se nemnoží samy', st.every(x => x.zabySedi), `${st.filter(x => !x.zabySedi).length} chybných`);

  // Regrese: bot lezl i na komára, který už v tom tahu bonus dal – nedostal
  // nic a tah mu skončil právě tam. Vypadalo to, že jen poskáče mezi komáry.
  const naKom = st.reduce((a, x) => a + x.naKomarovi, 0);
  const vsechTahu = st.reduce((a, x) => a + x.tahu, 0);
  zkus('tah nikdy neskončí na čerstvém komárovi', naKom === 0, `${naKom} z ${vsechTahu} tahů`);

  const delky = st.flatMap(x => x.delkyTahu).sort((a, b) => a - b);
  const prumer = delky.reduce((a, b) => a + b, 0) / delky.length;
  zkus('tahy se nezvrhnou v řetěz bonusů', prumer < 3,
    `průměrně ${prumer.toFixed(2)} kroku na tah (před opravou 2,45)`);
  console.log(`  délka tahu: medián ${delky[Math.floor(delky.length / 2)]},`
    + ` průměr ${(delky.reduce((a, b) => a + b, 0) / delky.length).toFixed(2)},`
    + ` max ${delky[delky.length - 1]}`);

  const kroky = st.map(x => x.kroku).sort((a, b) => a - b);
  console.log(`  ${POCET} hráčů: medián ${kroky[Math.floor(kroky.length / 2)]} tahů`
    + ` (min ${kroky[0]}, max ${kroky[kroky.length - 1]})`);
  console.log(`  na partii: ${(st.reduce((a, x) => a + x.stik, 0) / BEHU).toFixed(1)} štik,`
    + ` ${(st.reduce((a, x) => a + x.plozeni, 0) / BEHU).toFixed(1)} rozmnožení,`
    + ` ${(st.reduce((a, x) => a + x.navic, 0) / BEHU).toFixed(1)} tahů navíc`);
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
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(46)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
