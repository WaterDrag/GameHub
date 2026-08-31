// Odehraje celé partie Člověče, nezlob se mezi boty PŘES SKUTEČNÉ
// serverové funkce (`zahrajZa` → `hodit`/`tahnout`), takže se testuje
// to, co doopravdy poběží, ne jeho kopie.
//
//   node tools/test-clovece.mjs [hráčů] [zápasů] [mapa]
import hra from '../server/games/clovece.js';
import {
  tahy, maxPokusu, hotovych, novaHra, hod, tah, snipe, sniperCile,
  obetuj, lzeObetovat, cesta, zabaOmezuje,
} from '../shared/games/clovece/pravidla.js';
import { MODY, NERVY_SANCE } from '../shared/games/clovece/mody.js';
import { MAPA_PODLE, okruh } from '../shared/games/clovece/const.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 4);
const BEHU = Number(process.argv[3] || 40);
const MAPA = process.argv[4] || (POCET > 4 ? 'velka' : 'mala');
const STROP = 40000;

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

// ── Odehraj jeden zápas ──────────────────────────────────────
function zapas(seed, levely, mody = {}) {
  const rng = makeRng(seed);
  const players = levely.map((lv, i) => ({
    uid: 'P' + (i + 1), name: 'Hráč ' + (i + 1), bot: true, botLevel: lv,
  }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng, options: { mapa: MAPA, ...mody } });

  const st = { kroku: 0, hodu: 0, vyhozeni: 0, doma: 0, zaseknuto: false };

  while (hra.result(state) === null && st.kroku < STROP) {
    const s = state.hra;
    const hodilSe = !s.hozeno;

    // Postup se měří na čítači akcí. Pozice nestačí („hodil jsem a nemám
    // tah“ jimi nehne) a hody+tahy taky ne – sniper a nepovedený zásah
    // mění stav, aniž by jimi hnuly. Na obojí můj test naletěl.
    const pred = s.akci;

    hra.zahrajZa(state, ctx, null);
    st.kroku++;
    if (hodilSe) st.hodu++;
    if (state.hra.posledni && state.hra.posledni !== s.posledni && state.hra.posledni.vyhodil) st.vyhozeni++;

    if (state.hra.akci === pred) { st.zaseknuto = true; break; }
  }

  const konec = hra.result(state);
  st.dokonceno = !!konec;
  st.vitez = state.hra.vitez;
  // Sedadla jsou ZAMÍCHANÁ – vítěz je index sedadla, ne pořadí hráčů.
  // Než jsem si toho všiml, vycházely všechny obtížnosti na 50 %,
  // protože jsem si tím výsledky sám randomizoval.
  st.vitezLevel = state.hra.vitez === null ? null
    : players.find(x => x.uid === state.seats[state.hra.vitez]).botLevel;
  st.doma = state.hra.vitez === null ? 0 : state.hra.figurek;
  st.stav = state;
  return st;
}

// ── 1. Dohrají se partie vůbec? ──────────────────────────────
{
  const levely = Array.from({ length: POCET }, () => 'normal');
  const kroky = [], hody = [], vyhoz = [];
  let hotovo = 0, zaseknuto = 0;
  for (let i = 0; i < BEHU; i++) {
    const r = zapas(1000 + i * 7919, levely);
    if (r.dokonceno) hotovo++;
    if (r.zaseknuto) zaseknuto++;
    kroky.push(r.kroku); hody.push(r.hodu); vyhoz.push(r.vyhozeni);
  }
  const prum = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

  zkus(`${BEHU}× dohráno do konce`, hotovo === BEHU, `${hotovo}/${BEHU}`);
  zkus('žádné zacyklení', zaseknuto === 0, `${zaseknuto} zaseknutých`);
  console.log(`\n  ${POCET} hráčů, deska "${MAPA}" (${okruh(MAPA_PODLE[MAPA])} polí):`);
  console.log(`    hodů na partii  medián ${med(hody)}  (min ${Math.min(...hody)}, max ${Math.max(...hody)})`);
  console.log(`    hodů na hráče   ${(prum(hody) / POCET).toFixed(1)}`);
  console.log(`    vyhození        ${prum(vyhoz).toFixed(1)} na partii`);
}

// ── 2. Rozlišují se obtížnosti? ──────────────────────────────
// U závodů se ukázalo, že tři obtížnosti hrály stejně. Tady to musí
// jít vidět: hard proti easy má vyhrávat výrazně častěji.
{
  const N = Math.max(2, Math.min(POCET, 4));
  const levely = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 'hard' : 'easy'));
  const vyhry = {};
  const BEHU2 = 200;
  for (let i = 0; i < BEHU2; i++) {
    const r = zapas(70000 + i * 104729, levely);
    if (r.vitezLevel === null) continue;
    vyhry[r.vitezLevel] = (vyhry[r.vitezLevel] || 0) + 1;
  }
  const hardu = levely.filter(l => l === 'hard').length;
  const cekano = (hardu / N) * 100;
  const skutecne = ((vyhry.hard || 0) / BEHU2) * 100;
  zkus('hard poráží easy', skutecne > cekano + 4,
    `hard ${skutecne.toFixed(1)} % výher (náhoda by dala ${cekano.toFixed(0)} %)`);
}

// ── 3. Jediná možnost se zahraje sama ────────────────────────
// Kvůli tomu, aby hráč nemusel klikat, když stejně nemá na výběr.
{
  const rng = makeRng(4242);
  const players = Array.from({ length: 2 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng, options: { mapa: 'mala' } });

  // Dohrajeme se do situace, kdy je po hodu právě jedna možnost.
  let nasel = false, autoOk = false;
  for (let i = 0; i < 4000 && !nasel; i++) {
    if (!state.hra.hozeno) { hra.hodit(state, ctx); continue; }
    if (tahy(state.hra).length === 1) {
      nasel = true;
      const pred = state.hra.poz.map(p => [...p]);
      const autoBylo = state.autoAt > 0;
      state.autoAt = Date.now() - 1;              // posuneme čas, jako by vteřina uplynula
      hra.tick(state, 0, ctx);
      const po = state.hra.poz;
      autoOk = autoBylo && JSON.stringify(pred) !== JSON.stringify(po);
      break;
    }
    hra.zahrajZa(state, ctx, 'normal');
  }
  zkus('jediná možnost se zahraje sama', nasel && autoOk,
    nasel ? (autoOk ? 'figurka se posunula bez kliknutí' : 'NEPOSUNULA se') : 'situace nenastala');
}

// ── 4. Víc možností se sama nezahraje ────────────────────────
{
  const rng = makeRng(9182);
  const players = Array.from({ length: 4 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng, options: { mapa: 'mala' } });

  let nasel = false, ceka = false;
  for (let i = 0; i < 8000 && !nasel; i++) {
    if (!state.hra.hozeno) { hra.hodit(state, ctx); continue; }
    if (tahy(state.hra).length > 1) {
      nasel = true;
      ceka = state.autoAt === 0;     // nesmí být naplánovaný automat
      break;
    }
    hra.zahrajZa(state, ctx, 'normal');
  }
  zkus('při víc možnostech se čeká na hráče', nasel && ceka,
    nasel ? (ceka ? 'automat naplánovaný není' : 'CHYBA: hrálo by se samo') : 'situace nenastala');
}

// ── 4b. Tick sám rozhýbe hru s boty ──────────────────────────
// Po rozdání karet se `prepocti` volá bez `ctx`, takže o botech neví.
// Když to tick nedorovná, hra stojí až do vypršení limitu na tah.
{
  const rng = makeRng(20250829);
  const players = Array.from({ length: 3 }, (_, i) => ({
    uid: 'B' + i, name: 'Bot ' + i, bot: true, botLevel: 'normal',
  }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng, options: { mapa: 'mala' } });

  const predHodu = state.hra.hodu;
  const planPred = state.botAt;
  hra.tick(state, 0, ctx);                 // první tick jen naplánuje
  const naplanoval = state.botAt > 0 || state.autoAt > 0;
  state.botAt = Date.now() - 1;            // a teď ať je čas
  hra.tick(state, 0, ctx);

  zkus('tick rozhýbe botskou hru', planPred === 0 && naplanoval && state.hra.hodu > predHodu,
    `plán po rozdání ${planPred}, po ticku naplánováno ${naplanoval}, hodů ${predHodu} → ${state.hra.hodu}`);
}

// ── 5. Zamykání desky podle počtu hráčů ──────────────────────
{
  const a = hra.normalizeOptions({ mapa: 'mala' }, 4);
  zkus('4 hráči smí na klasickou desku', a.options.mapa === 'mala' && !a.zamky.mapa, a.options.mapa);

  const b = hra.normalizeOptions({ mapa: 'mala' }, 5);
  zkus('5 hráčů deska přepne na velkou', b.options.mapa === 'velka' && !!b.zamky.mapa, `${b.options.mapa} · ${b.zamky.mapa || '–'}`);

  const c = hra.normalizeOptions({ mapa: 'velka' }, 2);
  zkus('velkou desku smí zvolit i dva', c.options.mapa === 'velka' && !c.zamky.mapa, c.options.mapa);

  const d = hra.normalizeOptions({ mapa: 'nesmysl' }, 3);
  zkus('nesmyslná deska spadne na výchozí', d.options.mapa === 'mala', d.options.mapa);

  // I kdyby se volba na server dostala jinudy, createState ji srovná.
  const rng = makeRng(5);
  const players = Array.from({ length: 6 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i }));
  const st = hra.createState({ players, rng, options: { mapa: 'mala' } });
  zkus('6 hráčů nikdy nezačne na malé desce', st.hra.mapa === 'velka', st.hra.mapa);
}

// ── 5b. Počet figurek a odhad délky ──────────────────────────
{
  const a = hra.normalizeOptions({ mapa: 'mala', figurek: 4 }, 4);
  zkus('figurky se dají nastavit', a.options.figurek === 4, `${a.options.figurek} · ${a.info.odhad}`);

  const b = hra.normalizeOptions({ mapa: 'mala', figurek: 9 }, 4);
  zkus('nesmyslný počet figurek se ořízne', b.options.figurek === 4, String(b.options.figurek));

  const c = hra.normalizeOptions({ mapa: 'velka', figurek: 2 }, 8);
  const d = hra.normalizeOptions({ mapa: 'velka', figurek: 4 }, 8);
  zkus('víc figurek = delší odhad', d.info.odhadHodu > c.info.odhadHodu * 2,
    `2 fig ${c.info.odhadHodu} hodů (${c.info.odhad}) vs 4 fig ${d.info.odhadHodu} hodů (${d.info.odhad})`);

  // Odhad musí souhlasit s tím, co doopravdy vyjde ze simulace.
  const rng = makeRng(31337);
  const players = Array.from({ length: 4 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i, bot: true, botLevel: 'normal' }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const namereno = [];
  for (let i = 0; i < 15; i++) {
    const r2 = makeRng(880 + i * 7919);
    const c2 = { rng: r2, players, reject: () => {}, emit: () => {} };
    const st2 = hra.createState({ players, rng: r2, options: { mapa: 'mala', figurek: 4 } });
    let k = 0;
    while (hra.result(st2) === null && k < 200000) { hra.zahrajZa(st2, c2, null); k++; }
    if (hra.result(st2)) namereno.push(st2.hra.hodu);
  }
  namereno.sort((x, y) => x - y);
  const med = namereno[Math.floor(namereno.length / 2)];
  const slib = hra.normalizeOptions({ mapa: 'mala', figurek: 4 }, 4).info.odhadHodu;
  const pomer = med / slib;
  zkus('odhad sedí s realitou (±40 %)', pomer > 0.6 && pomer < 1.4,
    `slíbeno ${slib}, naměřeno ${med} (${(pomer * 100).toFixed(0)} %)`);
}

// ── 6. Pravidla, která musí sedět s předlohou ────────────────
{
  const rng = makeRng(77);
  const players = Array.from({ length: 4 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng, options: { mapa: 'mala' } });
  const s = state.hra;

  // Na začátku jsou všichni v domečku → jen šestka něco udělá.
  const bezSestky = [1, 2, 3, 4, 5].every(k => tahy(s, 0, k).length === 0);
  zkus('bez šestky se z domečku nedá', bezSestky, 'hody 1–5 nedávají tah');
  zkus('šestka vytáhne figurku', tahy(s, 0, 6).length === s.figurek, `${tahy(s, 0, 6).length} z ${s.figurek} figurek`);
  zkus('na začátku jsou tři pokusy', maxPokusu(s, 0) === 3, String(maxPokusu(s, 0)));

  // Přešlap přes cíl je neplatný.
  const O = okruh(MAPA_PODLE.mala);
  const t = { ...s, poz: s.poz.map(p => [...p]) };
  t.poz[0][0] = O + 3;                       // poslední políčko cíle
  zkus('z posledního pole cíle už nikam', tahy(t, 0, 1).length === 0, 'přešlap odmítnut');

  // Na vlastní figurku se nesmí.
  const u = { ...s, poz: s.poz.map(p => [...p]) };
  u.poz[0][0] = 5; u.poz[0][1] = 8;
  const naSve = tahy(u, 0, 3).some(x => x.fig === 0 && x.na === 8);
  zkus('na vlastní figurku se nesmí', !naSve, 'tah 5→8 odmítnut');

  // Cizí se vyhodí.
  const v = { ...s, poz: s.poz.map(p => [...p]) };
  v.poz[0][0] = 2;
  v.poz[1][0] = 2;   // hráč 1 má rameno 1 → jiné absolutní pole, tak ho spočítáme
  const cil = tahy(v, 0, 3).find(x => x.fig === 0);
  zkus('tah na volné pole nikoho nevyhazuje', cil && !cil.vyhodi, 'ok');
}

// ── 7. Módy: dohraje se s každým z nich? ───────────────────
// Hrubý test: žádný mód nesmí partii zaseknout.
{
  const kombinace = [
    ...MODY.map(m => ({ nazev: m.nazev, mody: { [m.id]: true } })),
    { nazev: 'všechny naráz', mody: Object.fromEntries(MODY.map(m => [m.id, true])) },
  ];
  for (const k of kombinace) {
    let hotovo = 0, zaseknuto = 0;
    const hody = [];
    for (let i = 0; i < 12; i++) {
      const r = zapas(4000 + i * 6091, ['normal', 'normal', 'normal'], k.mody);
      if (r.dokonceno) hotovo++;
      if (r.zaseknuto) zaseknuto++;
      hody.push(r.hodu);
    }
    const med = [...hody].sort((a, b) => a - b)[6];
    zkus(`dohraje se: ${k.nazev}`, hotovo === 12 && zaseknuto === 0,
      `${hotovo}/12 dohráno, ${zaseknuto} zaseknutých, medián ${med} hodů`);
  }
}

// ── 8. Žába ─────────────────────────────────────────
{
  const t = novaHra('mala', 2, 4, { zaba: true });
  t.poz[0][0] = 9;                 // ť nepřekáží
  t.poz[0][1] = 0;                 // táhne z kroku 0
  t.poz[1][0] = 31;                // rameno 1 začíná na poli 10, krok 31 = pole 1

  const cst = cesta(t, 0, 0, 3);
  zkus('cesta z 0 na 3 vede přes pole 1 a 2', cst.length === 2 && cst[0] === 1 && cst[1] === 2, cst.join(','));

  const sZabou = tahy(t, 0, 3);
  const bezZaby = tahy({ ...t, mody: { ...t.mody, zaba: false } }, 0, 3);
  zkus('žába omezí výběr jen na přeskoky',
    sZabou.length < bezZaby.length && sZabou.every(x => x.preskoci > 0),
    `${bezZaby.length} → ${sZabou.length} tahů`);
  zkus('žába o omezení řekne', zabaOmezuje(t, 0, 3) === true, 'hlásí omezení');

  const po = hod(t, 3);
  zkus('hláška se dostane do stavu', po.hlaska?.mod === 'zaba', po.hlaska?.text || 'žádná');

  // Bez soupeře v cestě žába nic neomezuje.
  const u = novaHra('mala', 2, 4, { zaba: true });
  u.poz[0][0] = 5;
  zkus('bez koho přeskakovat žába neomezuje', zabaOmezuje(u, 0, 3) === false, 'nic nevnucuje');
}

// ── 8b. Žába + Boomerang se nepletou ────────────────────
// Nezávislost je ve spouštěči: couvnutí žábu nespustí. Když se ale
// spustí přeskokem dopředu, je to donucení a couvat už nejde.
{
  const t = novaHra('mala', 2, 4, { zaba: true, boomerang: true });
  t.poz[0][0] = 9;
  t.poz[0][1] = 0;
  t.poz[1][0] = 31;                 // rameno 2 (start 20) → krok 31 = pole 11? ne, dopočítáme níže

  // Soupeře postavíme přesně na moje pole 1 a 2, ať je koho přeskakovat.
  const O = okruh(MAPA_PODLE.mala);
  t.poz[1][0] = (1 - 20 + O) % O;   // moje pole 1
  const tahyS = tahy(t, 0, 3);

  zkus('žába nutí jen dopředu',
    tahyS.some(x => !x.couv && x.preskoci > 0), 'přeskok dopředu je mezi možnostmi');
  zkus('vnucený přeskok zablokuje i couvání',
    !tahyS.some(x => x.couv), `couvacích tahů: ${tahyS.filter(x => x.couv).length}`);
  zkus('žádný vnucený tah není couvnutí',
    tahyS.filter(x => x.preskoci > 0 && !x.couv).length > 0, 'compulsion míří dopředu');

  // Přeskok pozpátku sám o sobě žábu nespouští.
  const u = novaHra('mala', 2, 4, { zaba: true, boomerang: true });
  u.poz[0][0] = 5;
  u.poz[1][0] = (4 - 20 + O) % O;   // soupeř na mém poli 4, tedy za mnou
  zkus('přeskok pozpátku žábu nespouští', zabaOmezuje(u, 0, 2) === false, 'nic nevnucuje');
}

// ── 9. Double trouble ───────────────────────────────
{
  const rng = makeRng(2468);
  const players = Array.from({ length: 2 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i, bot: true, botLevel: 'normal' }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng, options: { mapa: 'mala', double: true } });

  const videno = new Set();
  let paru = 0, sedi = 0;
  for (let i = 0; i < 900 && !hra.result(state); i++) {
    if (!state.hra.hozeno && !state.hra.sniper) {
      hra.hodit(state, ctx);
      const k = state.hra.kostky, v = state.hra.kostka;
      if (k && v) { paru++; videno.add(v); if (v === k[0] + k[1]) sedi++; }
    } else hra.zahrajZa(state, ctx, 'normal');
  }
  const vs = [...videno];
  zkus('součet vždy sedí s dvojicí kostek', paru > 20 && sedi === paru, `${sedi}/${paru} hodů`);
  zkus('padají jen součty 2–12', vs.length > 0 && Math.min(...vs) >= 2 && Math.max(...vs) <= 12,
    `viděno ${Math.min(...vs)}–${Math.max(...vs)}`);

  // Důsledek, na který uživatel sám upozornil: minimální součet je 2,
  // takže figurka, které do volného políčka chybí právě jedna, se už nehne.
  const O2 = okruh(MAPA_PODLE.mala);
  const s2 = novaHra('mala', 2, 4, { double: true });
  s2.poz[0][0] = O2 + 2;               // předposlední políčko cíle
  const zadny = [2,3,4,5,6,7,8,9,10,11,12].every(k => !tahy(s2, 0, k).some(x => x.fig === 0));
  zkus('předposlední pole cíle je s dvojkostkou koncová', zadny, 'na poslední by byla potřeba jednička');
}

// ── 10. Boomerang ──────────────────────────────────
{
  const s = novaHra('mala', 2, 4, { boomerang: true });
  s.poz[0][0] = 10;
  for (const k of [1, 2, 3]) {
    const couvy = tahy(s, 0, k).filter(x => x.couv);
    zkus(`boomerang couvá za ${k}`, couvy.length === 1 && couvy[0].na === 10 - k, `10 → ${couvy[0] ? couvy[0].na : '–'}`);
  }
  zkus('od čtyřky výš se couvat nesmí',
    [4, 5, 6].every(k => tahy(s, 0, k).every(x => !x.couv)), 'jen dopředu');

  const u = novaHra('mala', 2, 4, { boomerang: true });
  u.poz[0][0] = 2;
  zkus('couvnutí za vlastní start není', tahy(u, 0, 3).every(x => !x.couv), 'krok 2 mínus 3 neplatí');

  const v = novaHra('mala', 2, 4, {});
  v.poz[0][0] = 10;
  zkus('bez boomerangu se necouvá', tahy(v, 0, 2).every(x => !x.couv), 'vypnuto');

  // Regrese: tah se dřív poznával JEN podle čísla figurky, takže když
  // měla figurka obě možnosti, `find` vrátila vždycky tu dopřednou –
  // couvnout šlo jen tam, kde dopředu nešlo vůbec. Boti tím pádem
  // couvli k vyhození jen ve 3 % situací, kdy to šlo.
  const w = novaHra('mala', 2, 4, { boomerang: true });
  w.poz[0][0] = 10;
  w.hozeno = true; w.kostka = 2;
  const obe = tahy(w, 0, 2).filter(x => x.fig === 0);
  zkus('figurka má dopředu i dozadu', obe.length === 2, `${obe.length} možnosti`);

  const dopredu = tah(w, 0, false);
  const dozadu = tah(w, 0, true);
  zkus('tah dopředu jde zahrát', dopredu.poz[0][0] === 12, `10 → ${dopredu.poz[0][0]}`);
  zkus('tah dozadu jde zahrát taky', dozadu.poz[0][0] === 8, `10 → ${dozadu.poz[0][0]}`);
  zkus('směr tah rozliší', dopredu.poz[0][0] !== dozadu.poz[0][0], 'dva různé výsledky')
}

// ── 11. Sniper ────────────────────────────────────
{
  const O = okruh(MAPA_PODLE.mala);
  const s = novaHra('mala', 3, 4, { sniper: true });
  s.poz[0][0] = O - 1;          // krok před domečkem
  s.poz[1][0] = 5;              // soupeř na dráze
  s.poz[2][0] = O + 1;          // soupeř už v cíli
  s.hozeno = true; s.kostka = 2;

  const po = tah(s, 0, false);
  zkus('vstup do domečku spustí sniper', !!po.sniper, po.sniper ? 'čeká na výběr' : 'nespustil');
  const cile = sniperCile(po);
  zkus('sniper míří jen na dráhu', cile.length === 1 && cile[0].hrac === 1 && cile[0].fig === 0,
    `${cile.length} cílů`);

  const po2 = snipe(po, 1, 0);
  zkus('sniper vyhodí vybranou figurku', po2.poz[1][0] === -1 && !po2.sniper, `pozice ${po2.poz[1][0]}`);
  zkus('na figurku v cíli sniper nedosáhne', snipe(po, 2, 0).poz[2][0] === O + 1, 'zůstala v cíli');

  const u = novaHra('mala', 2, 4, { sniper: true });
  u.poz[0][0] = O;              // už v cíli
  u.poz[1][0] = 5;
  u.hozeno = true; u.kostka = 1;
  zkus('posun uvnitř domečku sniper nespustí', !tah(u, 0, false).sniper, 'nespustil');
}

// ── 12. Sacrifice ─────────────────────────────────
{
  const s = novaHra('mala', 2, 4, { sacrifice: true });
  s.poz[0][0] = 3; s.poz[0][1] = 7;
  s.poz[1][0] = 12;

  zkus('obětovat jde', lzeObetovat(s) === true, 'dvě moje na dráze a je koho sundat');
  const po = obetuj(s, 0, 1, 1, 0);
  zkus('obětované jdou domů', po.poz[0][0] === -1 && po.poz[0][1] === -1, `${po.poz[0][0]}, ${po.poz[0][1]}`);
  zkus('soupeřova jde také domů', po.poz[1][0] === -1, String(po.poz[1][0]));
  zkus('tah tím končí', po.naTahu === 1, `na tahu ${po.naTahu}`);
  zkus('o oběti se napíše', po.hlaska?.mod === 'sacrifice', po.hlaska?.text || 'nic');

  const u = novaHra('mala', 2, 4, { sacrifice: true });
  u.poz[0][0] = 3; u.poz[0][1] = 7;
  zkus('na figurky v domečku obětovat nejde', lzeObetovat(u) === false, 'není koho sundat');

  const v = novaHra('mala', 2, 4, { sacrifice: true });
  v.poz[0][0] = 3; v.poz[1][0] = 12;
  zkus('jedna vlastní nestačí', lzeObetovat(v) === false, 'potřeba dvě');

  const w = novaHra('mala', 2, 4, {});
  w.poz[0][0] = 3; w.poz[0][1] = 7; w.poz[1][0] = 12;
  zkus('bez módu obětovat nejde', lzeObetovat(w) === false, 'vypnuto');
}

// ── 13. Lovec odměn ──────────────────────────────
{
  // Soupeř (rameno 1, start pole 10) stojí na mém poli 5 → jeho krok 35.
  const s = novaHra('mala', 2, 4, { lovec: true });
  s.poz[0][0] = 3;
  s.poz[1][0] = 25;   // rameno 2 začíná na poli 20, krok 25 = pole 5
  s.hozeno = true; s.kostka = 2;
  const po = tah(s, 0, false);
  zkus('vyhození proběhlo', po.poz[1][0] === -1, `soupeř na ${po.poz[1][0]}`);
  zkus('lovec nasadí figurku na start', po.poz[0].includes(0), JSON.stringify(po.poz[0]));
  zkus('lovec o tom řekne', po.hlaska?.mod === 'lovec', po.hlaska?.text || 'nic');

  const u = novaHra('mala', 2, 4, { lovec: true });
  u.poz[0][0] = 3; u.poz[0][1] = 0;
  u.poz[1][0] = 25;
  u.hozeno = true; u.kostka = 2;
  const po2 = tah(u, 0, false);
  zkus('lovec posune figurku ze startu', po2.poz[0][1] === 1, `ze startu na ${po2.poz[0][1]}`);

  const v = novaHra('mala', 2, 4, {});
  v.poz[0][0] = 3; v.poz[1][0] = 25;
  v.hozeno = true; v.kostka = 2;
  zkus('bez módu žádná odměna', tah(v, 0, false).poz[0].filter(k => k === 0).length === 0, 'vypnuto');
}

// ── 14. Nervy ─────────────────────────────────────
{
  const s = novaHra('mala', 2, 4, { nervy: true });
  s.poz[0][0] = 3;
  s.poz[1][0] = 25;
  s.hozeno = true; s.kostka = 2;

  const selhalo = tah(s, 0, false, 0.0);
  zkus('nervy zkazí vyhození', selhalo.poz[0][0] === 3 && selhalo.poz[1][0] === 25,
    'figurka stojí, soupeř taky');
  zkus('a tah propadá', selhalo.naTahu === 1, `na tahu ${selhalo.naTahu}`);
  zkus('nervy o tom řeknou', selhalo.hlaska?.mod === 'nervy', selhalo.hlaska?.text || 'nic');

  const povedlo = tah(s, 0, false, 0.99);
  zkus('nad prahem vyhození projde', povedlo.poz[1][0] === -1, `soupeř na ${povedlo.poz[1][0]}`);

  const u = novaHra('mala', 2, 4, { nervy: true });
  u.poz[0][0] = 3;
  u.hozeno = true; u.kostka = 2;
  zkus('bez vyhození nervy nic nezkazí', tah(u, 0, false, 0.0).poz[0][0] === 5, 'tah proběhl');
}

// ── Výpis ────────────────────────────────────────────────────
console.log('\n=== Člověče, nezlob se ===');
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(38)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
