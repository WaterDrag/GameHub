// Perft – spočítá všechny možné průběhy partie do dané hloubky a porovná
// se známými čísly. Když sedí, generátor tahů umí i rošádu, braní
// mimochodem, proměnu a vazby na krále. Když nesedí, je někde chyba
// a tohle je jediný způsob, jak ji najít dřív, než na ni narazí hráč.
//
//   node tools/test-sachy.mjs [hloubka]
import {
  novaHra, vsechnyTahy, proved, zPole, idx, stavHry, zapis, BILY, CERNY,
} from '../shared/games/chess/pravidla.js';

const HLOUBKA = Number(process.argv[2] || 4);

function perft(s, h) {
  if (h === 0) return 1;
  const tahy = vsechnyTahy(s);
  if (h === 1) return tahy.length;
  let n = 0;
  for (const t of tahy) n += perft(proved(s, t, true), h - 1);
  return n;
}

// Deska z FEN – kvůli pozicím, které prověří rošádu a mimochodem.
function zFen(fen) {
  const [desk, naTahu, roch, ep] = fen.split(' ');
  const pole = new Array(64).fill(null);
  let i = 0;
  for (const z of desk) {
    if (z === '/') continue;
    if (z >= '1' && z <= '8') { i += Number(z); continue; }
    const typ = { p: 'p', n: 'j', b: 's', r: 'v', q: 'd', k: 'k' }[z.toLowerCase()];
    pole[i++] = { t: typ, b: z === z.toUpperCase() ? BILY : CERNY };
  }
  return {
    pole,
    naTahu: naTahu === 'w' ? BILY : CERNY,
    roch: {
      bK: roch.includes('K'), bD: roch.includes('Q'),
      cK: roch.includes('k'), cD: roch.includes('q'),
    },
    ep: ep && ep !== '-' ? zPole(ep) : null,
    pulTahy: 0, tah: 1, pozice: {},
  };
}

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

// ── Perft ze základního postavení ────────────────────────────
const ZNAME = [1, 20, 400, 8902, 197281, 4865609];
{
  const s = novaHra();
  for (let h = 1; h <= Math.min(HLOUBKA, 5); h++) {
    const t0 = Date.now();
    const n = perft(s, h);
    const cekano = ZNAME[h];
    zkus(`perft(${h}) ze základní pozice`, n === cekano,
      `${n.toLocaleString('cs')} (čekáno ${cekano.toLocaleString('cs')}, ${Date.now() - t0} ms)`);
  }
}

// ── Kiwipete: pozice nabitá rošádami a braním mimochodem ─────
{
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -';
  const cekano = [1, 48, 2039, 97862, 4085603];
  const s = zFen(fen);
  for (let h = 1; h <= Math.min(HLOUBKA, 4); h++) {
    const n = perft(s, h);
    zkus(`perft(${h}) Kiwipete`, n === cekano[h], `${n.toLocaleString('cs')} (čekáno ${cekano[h].toLocaleString('cs')})`);
  }
}

// ── Pozice se zákeřným braním mimochodem ─────────────────────
{
  const s = zFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -');
  const cekano = [1, 14, 191, 2812, 43238];
  for (let h = 1; h <= Math.min(HLOUBKA, 4); h++) {
    const n = perft(s, h);
    zkus(`perft(${h}) mimochodem`, n === cekano[h], `${n.toLocaleString('cs')} (čekáno ${cekano[h].toLocaleString('cs')})`);
  }
}

// ── Konce partie ─────────────────────────────────────────────
{
  // Školácký mat: 1.e4 e5 2.Sc4 Sc5 3.Dh5 Jf6?? 4.Dxf7#
  let s = novaHra();
  const tahy = [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['f8', 'c5'],
    ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']];
  let zapisy = [];
  for (const [a, b] of tahy) {
    const t = vsechnyTahy(s).find(x => x.od === zPole(a) && x.na === zPole(b));
    if (!t) { zapisy.push(`CHYBÍ ${a}${b}`); break; }
    zapisy.push(zapis(s, t));
    s = proved(s, t);
  }
  zkus('školácký mat končí matem', stavHry(s) === 'mat', `${stavHry(s)} · ${zapisy.join(' ')}`);
  zkus('poslední tah je zapsán s křížkem', zapisy[zapisy.length - 1] === 'Dxf7#', zapisy[zapisy.length - 1]);
}

{
  // Patová pozice: černý je na tahu a nemá kam.
  const s = zFen('7k/5Q2/6K1/8/8/8/8/8 b - -');
  zkus('pat se pozná jako pat', stavHry(s) === 'pat', stavHry(s));
}

{
  const s = zFen('8/8/4k3/8/8/4K3/8/8 w - -');
  zkus('král proti králi = remíza', stavHry(s) === 'material', stavHry(s));
}

// ── Rošáda ───────────────────────────────────────────────────
{
  const s = zFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
  const t = vsechnyTahy(s).filter(x => x.roch);
  zkus('nabízí obě rošády', t.length === 2, t.map(x => x.roch).join(', '));

  // Přes napadené pole se rošovat nesmí (věž na f8 hlídá f1).
  const s2 = zFen('5r2/8/8/8/8/8/8/R3K2R w KQ -');
  const t2 = vsechnyTahy(s2).filter(x => x.roch);
  zkus('krátkou rošádu přes napadené pole nenabídne',
    !t2.some(x => x.roch === 'K'), t2.map(x => x.roch).join(', ') || 'žádná');
}

// ── Výpis ────────────────────────────────────────────────────
console.log('=== šachová pravidla ===');
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(34)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
