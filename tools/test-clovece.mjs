// Odehraje celé partie Člověče, nezlob se mezi boty PŘES SKUTEČNÉ
// serverové funkce (`zahrajZa` → `hodit`/`tahnout`), takže se testuje
// to, co doopravdy poběží, ne jeho kopie.
//
//   node tools/test-clovece.mjs [hráčů] [zápasů] [mapa]
import hra from '../server/games/clovece.js';
import { tahy, maxPokusu, hotovych } from '../shared/games/clovece/pravidla.js';
import { MAPA_PODLE, okruh } from '../shared/games/clovece/const.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 4);
const BEHU = Number(process.argv[3] || 40);
const MAPA = process.argv[4] || (POCET > 4 ? 'velka' : 'mala');
const STROP = 40000;

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

// ── Odehraj jeden zápas ──────────────────────────────────────
function zapas(seed, levely) {
  const rng = makeRng(seed);
  const players = levely.map((lv, i) => ({
    uid: 'P' + (i + 1), name: 'Hráč ' + (i + 1), bot: true, botLevel: lv,
  }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng, options: { mapa: MAPA } });

  const st = { kroku: 0, hodu: 0, vyhozeni: 0, doma: 0, zaseknuto: false };

  while (hra.result(state) === null && st.kroku < STROP) {
    const s = state.hra;
    const hodilSe = !s.hozeno;

    // Postup se měří na čítačích, které jdou jen nahoru. Otisk pozic by
    // nestačil: „hodil jsem a nemám tah“ pozicemi nehne, a přesto se
    // partie posunula (ubyl pokus). Na tohle můj test napoprvé naletěl
    // a hlásil zaseknutí u všech čtyřiceti zápasů.
    const pred = s.hodu + s.tahu;

    hra.zahrajZa(state, ctx, null);
    st.kroku++;
    if (hodilSe) st.hodu++;
    if (state.hra.posledni && state.hra.posledni !== s.posledni && state.hra.posledni.vyhodil) st.vyhozeni++;

    if (state.hra.hodu + state.hra.tahu === pred) { st.zaseknuto = true; break; }
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

// ── Výpis ────────────────────────────────────────────────────
console.log('\n=== Člověče, nezlob se ===');
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(38)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
