// Odehraje celé partie UNO No Mercy mezi boty PŘES SKUTEČNÉ serverové
// funkce (`zahrajZa`), takže se testuje to, co doopravdy poběží.
//
//   node tools/test-uno.mjs [hráčů] [zápasů]
import hra from '../server/games/uno.js';
import {
  novaHra, lzeHrat, moznosti, zahraj, lizni, rekniUno, nachytej, vrch,
  vymen, cileVymeny, zivi,
} from '../shared/games/uno/pravidla.js';
import { novyBalicek, VELIKOST_BALICKU, MILOST, trestZa } from '../shared/games/uno/karty.js';
import { makeRng } from '../shared/rng.js';

const POCET = Number(process.argv[2] || 4);
const BEHU = Number(process.argv[3] || 30);
const STROP = 40000;

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

// Kolik karet je celkem ve hře. Musí to být pořád 136.
const karetCelkem = (s) =>
  s.balicek.length + s.odhoz.length + s.ruce.reduce((a, r) => a + r.length, 0);

// ── Odehraj zápas ────────────────────────────────────────────
function zapas(seed, levely) {
  const rng = makeRng(seed);
  const players = levely.map((lv, i) => ({
    uid: 'P' + i, name: 'Hráč ' + i, bot: true, botLevel: lv,
  }));
  const ctx = { rng, players, reject: () => {}, emit: () => {} };
  const state = hra.createState({ players, rng });

  const st = { kroku: 0, zaseknuto: false, karetVzdy: true, vyrazenych: 0 };
  while (hra.result(state) === null && st.kroku < STROP) {
    const pred = state.hra.akci;
    hra.zahrajZa(state, ctx, null);
    st.kroku++;
    if (karetCelkem(state.hra) !== VELIKOST_BALICKU) st.karetVzdy = false;
    if (state.hra.akci === pred) { st.zaseknuto = true; break; }
  }
  const konec = hra.result(state);
  st.dokonceno = !!konec;
  st.vyrazenych = state.hra.vyrazeni.length;
  st.vitezLevel = state.hra.vitez === null ? null
    : players.find(p => p.uid === state.seats[state.hra.vitez]).botLevel;
  st.stav = state;
  return st;
}

// ── 1. Dohrají se partie? ────────────────────────────────────
{
  const levely = Array.from({ length: POCET }, () => 'normal');
  let hotovo = 0, zaseknuto = 0, karty = 0, vyrazeni = 0;
  const kroky = [];
  for (let i = 0; i < BEHU; i++) {
    const r = zapas(9000 + i * 7919, levely);
    if (r.dokonceno) hotovo++;
    if (r.zaseknuto) zaseknuto++;
    if (r.karetVzdy) karty++;
    vyrazeni += r.vyrazenych;
    kroky.push(r.kroku);
  }
  const med = [...kroky].sort((a, b) => a - b)[Math.floor(kroky.length / 2)];
  zkus(`${BEHU}× dohráno do konce`, hotovo === BEHU, `${hotovo}/${BEHU}`);
  zkus('žádné zacyklení', zaseknuto === 0, `${zaseknuto} zaseknutých`);
  zkus('karet je pořád 136', karty === BEHU, `${karty}/${BEHU} zápasů bez ztráty karty`);
  console.log(`\n  ${POCET} hráčů: medián ${med} akcí na partii, vyřazeno ${(vyrazeni / BEHU).toFixed(1)} hráčů na partii`);
}

// ── 2. Rozlišují se obtížnosti? ──────────────────────────────
{
  const N = Math.max(2, Math.min(POCET, 4));
  const levely = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 'hard' : 'easy'));
  const vyhry = {};
  const BEHU2 = 300;
  for (let i = 0; i < BEHU2; i++) {
    const r = zapas(150000 + i * 104729, levely);
    if (r.vitezLevel) vyhry[r.vitezLevel] = (vyhry[r.vitezLevel] || 0) + 1;
  }
  const cekano = (levely.filter(l => l === 'hard').length / N) * 100;
  const skutecne = ((vyhry.hard || 0) / BEHU2) * 100;
  zkus('hard poráží easy', skutecne > cekano + 3,
    `hard ${skutecne.toFixed(1)} % výher (náhoda by dala ${cekano.toFixed(0)} %)`);
}

// ── 3. Stohování trestů ──────────────────────────────────────
{
  const p2 = { b: 'cervena', z: 'plus2' };
  const p2j = { b: 'modra', z: 'plus2' };
  const p4 = { b: 'divoka', z: 'plus4' };
  const p6 = { b: 'divoka', z: 'plus6' };
  const cislo = { b: 'cervena', z: '5' };

  zkus('+2 se smí přihodit na +2', lzeHrat(p2, p2, 'cervena', 2) === true, 'stejná hodnota');
  zkus('+4 se smí přihodit na +2', lzeHrat(p4, p2, 'cervena', 2) === true, 'vyšší hodnota');
  zkus('+2 se nesmí přihodit na +4', lzeHrat(p2, p4, 'cervena', 4) === false, 'nižší hodnota');
  zkus('+6 se smí přihodit na +4', lzeHrat(p6, p4, 'cervena', 4) === true, 'vyšší hodnota');
  zkus('číslo se na trest hrát nedá', lzeHrat(cislo, p2, 'cervena', 2) === false, 'nemá lízání');
  // Oficiální pravidla mluví jen o hodnotě, barvu u stohování neřeší.
  // Předloha vyžadovala i shodu barvy – tohle je proti ní změna.
  zkus('barvu stohování neřeší', lzeHrat(p2j, p2, 'cervena', 2) === true, 'modrá +2 na červenou +2');
  zkus('divoký trest smí vždycky', lzeHrat(p4, p2, 'zelena', 2) === true, 'barva se neřeší');

  // Bez trestu platí normální pravidla.
  zkus('bez trestu platí barva', lzeHrat({ b: 'cervena', z: '3' }, { b: 'cervena', z: '7' }, 'cervena', 0) === true, 'shoda barvy');
  zkus('bez trestu platí znak', lzeHrat({ b: 'modra', z: '7' }, { b: 'cervena', z: '7' }, 'cervena', 0) === true, 'shoda znaku');
  zkus('jinak se hrát nedá', lzeHrat({ b: 'modra', z: '3' }, { b: 'cervena', z: '7' }, 'cervena', 0) === false, 'ani barva, ani znak');
}

// ── 4. Stop všem vrátí tah témuž hráči ───────────────────────
// V předloze se tady posouvalo o jednoho, takže karta nedělala nic.
{
  const s = novaHra(4, novyBalicek());
  s.ruce[0] = [{ b: s.barva, z: 'stopVsem' }, { b: s.barva, z: '3' }, { b: s.barva, z: '5' }];
  s.naTahu = 0;
  const po = zahraj(s, 0);
  zkus('stop všem vrátí tah témuž hráči', po.naTahu === 0, `na tahu ${po.naTahu}`);

  const t = novaHra(4, novyBalicek());
  t.ruce[0] = [{ b: t.barva, z: 'stop' }, { b: t.barva, z: '3' }];
  t.naTahu = 0;
  zkus('stop přeskočí jednoho', zahraj(t, 0).naTahu === 2, `na tahu ${zahraj(t, 0).naTahu}`);
}

// ── 5. Výhoz barvy ───────────────────────────────────────────
{
  const s = novaHra(3, novyBalicek());
  s.naTahu = 0;
  s.barva = 'cervena';
  s.odhoz = [{ b: 'cervena', z: '4' }];
  s.ruce[0] = [
    { b: 'cervena', z: 'vyhod' },
    { b: 'cervena', z: '1' }, { b: 'cervena', z: '9' },
    { b: 'modra', z: '2' }, { b: 'zelena', z: '3' },
  ];
  const po = zahraj(s, 0);
  zkus('výhoz smete celou barvu z ruky', po.ruce[0].length === 2, `${po.ruce[0].length} karet zbylo`);
  zkus('a nechá ostatní barvy', po.ruce[0].every(k => k.b !== 'cervena'), 'žádná červená');
}

// ── 6. Milost: 25 karet a končíš ─────────────────────────────
{
  const s = novaHra(3, novyBalicek(), 25);
  s.naTahu = 0;
  s.trest = 20;
  s.ruce[0] = new Array(6).fill(null).map(() => ({ b: 'modra', z: '5' }));
  const predOdhoz = s.odhoz.length;
  const po = lizni(s);
  zkus('nad 25 karet je hráč venku', po.vyrazeni.includes(0), JSON.stringify(po.vyrazeni));
  zkus('a nezůstane na tahu', po.naTahu !== 0 || po.vitez !== null, `na tahu ${po.naTahu}`);
  // Ruka vyřazeného se vrací do hry, jinak karty ze hry zmizí a
  // balíček se při šesti a osmi hráčích vysype.
  zkus('vyřazenému zůstane prázdná ruka', po.ruce[0].length === 0, `${po.ruce[0].length} karet`);
  zkus('a jeho karty se vrátí na hromádku', po.odhoz.length === predOdhoz + 26,
    `odhoz ${predOdhoz} → ${po.odhoz.length}`);
  zkus('vrchní karta se tím nezmění', JSON.stringify(po.odhoz[po.odhoz.length - 1]) === JSON.stringify(s.odhoz[s.odhoz.length - 1]),
    'vrch beze změny');
}

// ── 7. UNO a nachytání ───────────────────────────────────────
{
  const s = novaHra(3, novyBalicek());
  s.naTahu = 0;
  s.barva = 'cervena';
  s.odhoz = [{ b: 'cervena', z: '4' }];
  s.ruce[0] = [{ b: 'cervena', z: '1' }, { b: 'cervena', z: '2' }];

  const bezUno = zahraj(s, 0);
  zkus('kdo neřekne UNO, je k nachytání', bezUno.unoOhrozeny === 0, String(bezUno.unoOhrozeny));

  const sUno = zahraj(rekniUno(s, 0), 0);
  zkus('kdo řekne UNO, nachytat nejde', sUno.unoOhrozeny === null, String(sUno.unoOhrozeny));

  const chycen = nachytej(bezUno, 1);
  zkus('nachytání přidá dvě karty', chycen.ruce[0].length === 3, `${chycen.ruce[0].length} karet`);
  zkus('a ohrožení tím končí', chycen.unoOhrozeny === null, String(chycen.unoOhrozeny));
  zkus('sám sebe nikdo nenachytá', nachytej(bezUno, 0).ruce[0].length === 1, 'beze změny');
}

// ── 8. Karty soupeřů jsou TAJNÉ ──────────────────────────────
// V předloze ležely všechny ruce v databázi, takže si je kdokoliv mohl
// přečíst v konzoli. Tohle je hlavní důvod, proč hra běží na serveru.
{
  const rng = makeRng(4242);
  const players = Array.from({ length: 4 }, (_, i) => ({ uid: 'P' + i, name: 'H' + i }));
  const state = hra.createState({ players, rng });
  const v = hra.view(state, 'P0');
  const seat = state.seats.indexOf('P0');

  zkus('vidím svoje karty', v.ruka.length === 7, `${v.ruka.length} karet`);
  zkus('a jsou to opravdu moje', JSON.stringify(v.ruka) === JSON.stringify(state.hra.ruce[seat]), 'sedí se stavem');
  zkus('o ostatních znám jen počty', v.pocty.length === 4 && v.pocty.every(n => n === 7), JSON.stringify(v.pocty));

  // V celém pohledu se nesmí objevit karta, kterou v ruce nemám.
  const text = JSON.stringify(v);
  const cizi = state.hra.ruce
    .filter((_, i) => i !== seat)
    .flat()
    .filter(k => !state.hra.ruce[seat].some(m => m.b === k.b && m.z === k.z));
  const unik = cizi.some(k => text.includes(`{"b":"${k.b}","z":"${k.z}"}`)
    && !state.hra.ruce[seat].some(m => m.b === k.b && m.z === k.z)
    && !(v.vrch.b === k.b && v.vrch.z === k.z));
  zkus('v pohledu nejsou cizí karty', !unik || cizi.length === 0, unik ? 'ÚNIK!' : 'nic neuniklo');
  zkus('balíček se neposílá', v.balicek === undefined && typeof v.balicku === 'number',
    `posílá se jen počet: ${v.balicku}`);
}

// ── 9. Došlé karty hru nezastaví ─────────────────────────────
{
  const s = novaHra(2, novyBalicek());
  s.naTahu = 0;
  s.barva = 'cervena';
  s.odhoz = [{ b: 'cervena', z: '4' }];
  s.balicek = [];
  s.ruce[0] = [{ b: 'modra', z: '9' }];      // nemá co hrát
  const po = lizni(s);
  zkus('bez karet se tah předá dál', po.naTahu === 1, `na tahu ${po.naTahu}`);
  zkus('a nezasekne se to', po.musiLizat === false, 'nečeká na líznutí');
}

// ── 10. Nula: všichni posílají ruku dál ──────────────────────
{
  const s = novaHra(3, novyBalicek());
  s.naTahu = 0; s.smer = 1;
  s.barva = 'cervena';
  s.odhoz = [{ b: 'cervena', z: '4' }];
  s.ruce[0] = [{ b: 'cervena', z: '0' }, { b: 'modra', z: '1' }];
  s.ruce[1] = [{ b: 'zelena', z: '2' }, { b: 'zelena', z: '3' }, { b: 'zelena', z: '5' }];
  s.ruce[2] = [{ b: 'zluta', z: '8' }];

  const po = zahraj(s, 0);
  zkus('nula pošle moji ruku dalšímu', po.ruce[1].length === 1 && po.ruce[1][0].z === '1',
    `hráč 1 má ${po.ruce[1].length}`);
  zkus('a ruka posledního doputuje ke mně', po.ruce[0].length === 1 && po.ruce[0][0].z === '8',
    `hráč 0 má ${po.ruce[0].length}`);
  zkus('prostřední dostane od svého předchůdce', po.ruce[2].length === 3, `hráč 2 má ${po.ruce[2].length}`);
  zkus('karet je pořád stejně', po.ruce.reduce((a, r) => a + r.length, 0) === 5, 'nic se neztratilo');
}

// ── 11. Sedmička: výměna ruky s vybraným hráčem ──────────────
{
  const s = novaHra(3, novyBalicek());
  s.naTahu = 0;
  s.barva = 'cervena';
  s.odhoz = [{ b: 'cervena', z: '4' }];
  s.ruce[0] = [{ b: 'cervena', z: '7' }, { b: 'modra', z: '1' }, { b: 'modra', z: '2' }];
  s.ruce[1] = [{ b: 'zelena', z: '5' }];
  s.ruce[2] = [{ b: 'zluta', z: '8' }, { b: 'zluta', z: '9' }];

  const po = zahraj(s, 0);
  zkus('sedmička čeká na výběr', po.vymena !== null && po.vymena.hrac === 0,
    po.vymena ? 'čeká' : 'nečeká');
  zkus('vybírat jde jen mezi ostatními', JSON.stringify(cileVymeny(po)) === '[1,2]', JSON.stringify(cileVymeny(po)));
  zkus('dokud se nevybere, nedá se hrát', moznosti(po).length === 0, 'žádné možnosti');

  const vym = vymen(po, 1);
  zkus('výměna prohodí ruce', vym.ruce[0].length === 1 && vym.ruce[1].length === 2,
    `${vym.ruce[0].length} vs ${vym.ruce[1].length}`);
  zkus('a tah jde dál', vym.vymena === null && vym.naTahu === 1, `na tahu ${vym.naTahu}`);
  zkus('cizí hráč výměnu nezvládne', vymen(po, 0).vymena !== null, 'sám se sebou to nejde');
}

// ── 12. Barevná ruleta ───────────────────────────────────────
{
  const s = novaHra(2, novyBalicek());
  s.naTahu = 0;
  s.barva = 'cervena';
  s.odhoz = [{ b: 'cervena', z: '4' }];
  s.ruce[0] = [{ b: 'divoka', z: 'ruleta' }, { b: 'modra', z: '1' }];
  s.ruce[1] = [{ b: 'zelena', z: '5' }];
  // Balíček: tři nemodré a pak modrá.
  s.balicek = [{ b: 'modra', z: '9' }, { b: 'zluta', z: '3' }, { b: 'zelena', z: '2' }, { b: 'cervena', z: '7' }];

  const po = zahraj(s, 0, 'modra');
  // Oběť měla 1 kartu a líže 4 (tři nemodré a pak modrou) → 5.
  zkus('ruleta nechá lízat až po zvolenou barvu', po.ruce[1].length === 5, `${po.ruce[1].length} karet`);
  zkus('poslední líznutá je ta barva', po.ruce[1][po.ruce[1].length - 1].b === 'modra',
    po.ruce[1][po.ruce[1].length - 1].b);
  zkus('a oběť ztrácí tah', po.naTahu === 0, `na tahu ${po.naTahu}`);

  // Přebít se nedá – ruleta nemá lízací hodnotu.
  zkus('na ruletu se trest nepřihodí',
    lzeHrat({ b: 'divoka', z: 'plus4' }, { b: 'divoka', z: 'ruleta' }, 'modra', 0) === true
    && lzeHrat({ b: 'divoka', z: 'ruleta' }, { b: 'cervena', z: 'plus2' }, 'cervena', 2) === false,
    'ruleta netrestá a na trest ji hrát nejde');
}

// ── 13. Líznutou hratelnou kartu musíš zahrát ────────────────
// Předloha nabízela „vzdát tah“, oficiální pravidla ne.
{
  const s = novaHra(2, novyBalicek());
  s.naTahu = 0;
  s.barva = 'cervena';
  s.odhoz = [{ b: 'cervena', z: '4' }];
  s.ruce[0] = [{ b: 'modra', z: '9' }];              // nemá co hrát
  s.balicek = [{ b: 'cervena', z: '2' }];            // a lízne hratelnou

  const po = lizni(s);
  zkus('po líznutí hratelné se musí hrát', po.musiZahrat === 1, String(po.musiZahrat));
  zkus('a to právě ta jedna karta', JSON.stringify(moznosti(po)) === '[1]', JSON.stringify(moznosti(po)));
  zkus('tah zůstává mně', po.naTahu === 0, `na tahu ${po.naTahu}`);

  const zahrano = zahraj(po, 1);
  zkus('a jde zahrát', zahrano.ruce[0].length === 1 && zahrano.naTahu === 1, 'zahráno, tah předán');

  // Nehratelná líznutá = líže se dál.
  const t = novaHra(2, novyBalicek());
  t.naTahu = 0;
  t.barva = 'cervena';
  t.odhoz = [{ b: 'cervena', z: '4' }];
  t.ruce[0] = [{ b: 'modra', z: '9' }];
  t.balicek = [{ b: 'zelena', z: '2' }];
  const tp = lizni(t);
  zkus('nehratelná líznutá = líže se dál', tp.musiLizat === true && tp.naTahu === 0, 'pořád na tahu');
}

// ── Výpis ────────────────────────────────────────────────────
console.log('\n=== UNO No Mercy ===');
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(38)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
