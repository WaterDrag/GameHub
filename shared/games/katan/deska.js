// ─────────────────────────────────────────────────────────────
//  Osadníci z Katanu – deska.
//
//  Geometrie je převzatá z předlohy: pět řad po 3–4–5–4–3 polích,
//  vrcholy se slučují podle zaokrouhlené souřadnice, hrany vznikají
//  z šestic vrcholů kolem každého pole.
//
//  Deska se generuje ze SEEDU na serveru. V předloze si ji míchal
//  prohlížeč přes Math.random(), takže si každý mohl rozložení
//  přegenerovat, dokud nedostal hezké číslo u své osady.
// ─────────────────────────────────────────────────────────────

export const SUROVINY = ['drevo', 'cihla', 'vlna', 'obili', 'ruda'];
export const POUST = 'poust';

export const SUROVINA_INFO = {
  drevo: { nazev: 'Dřevo', emoji: '🌲', barva: '#5d4037', svetla: '#8d6e63' },
  cihla: { nazev: 'Cihla', emoji: '🧱', barva: '#bf360c', svetla: '#ff7043' },
  vlna: { nazev: 'Vlna', emoji: '🐑', barva: '#2e7d32', svetla: '#66bb6a' },
  obili: { nazev: 'Obilí', emoji: '🌾', barva: '#f57f17', svetla: '#fdd835' },
  ruda: { nazev: 'Ruda', emoji: '⛏', barva: '#37474f', svetla: '#90a4ae' },
  poust: { nazev: 'Poušť', emoji: '🌵', barva: '#8d6e63', svetla: '#d4a843' },
};

// Standardní rozpis Katanu.
export const POLE_SUROVIN = [
  'drevo', 'drevo', 'drevo', 'drevo',
  'cihla', 'cihla', 'cihla',
  'vlna', 'vlna', 'vlna', 'vlna',
  'obili', 'obili', 'obili', 'obili',
  'ruda', 'ruda', 'ruda',
  POUST,
];
export const ZETONY = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

export const CENY = {
  silnice: { drevo: 1, cihla: 1 },
  osada: { drevo: 1, cihla: 1, vlna: 1, obili: 1 },
  mesto: { obili: 2, ruda: 3 },
  karta: { vlna: 1, obili: 1, ruda: 1 },
};

// Kolik čeho smí hráč postavit celkem.
export const LIMIT = { silnice: 15, osada: 5, mesto: 4 };

export const DEV_BALICEK = [
  ...new Array(14).fill('rytir'),
  ...new Array(5).fill('bod'),
  ...new Array(2).fill('silnice'),
  ...new Array(2).fill('hojnost'),
  ...new Array(2).fill('monopol'),
];

export const DEV_INFO = {
  rytir: { nazev: 'Rytíř', emoji: '⚔️', popis: 'Přesuň zloděje a okraď souseda.' },
  bod: { nazev: 'Vítězný bod', emoji: '🏆', popis: 'Rovnou +1 bod, ostatní ho nevidí.' },
  silnice: { nazev: 'Stavba silnic', emoji: '🛣️', popis: 'Dvě silnice zdarma.' },
  hojnost: { nazev: 'Rok hojnosti', emoji: '🌟', popis: 'Vezmi si z banku dvě suroviny.' },
  monopol: { nazev: 'Monopol', emoji: '🎭', popis: 'Všichni ti odevzdají jednu surovinu.' },
};

export const PRISTAVY = [
  { typ: 'vse' }, { typ: 'drevo' }, { typ: 'cihla' }, { typ: 'vlna' },
  { typ: 'obili' }, { typ: 'ruda' }, { typ: 'vse' }, { typ: 'vse' }, { typ: 'vse' },
];

export const BODU_NA_VYHRU = 10;
export const ARMADA_MIN = 3;      // od kolika rytířů se počítá největší armáda
export const CESTA_MIN = 5;       // od kolika silnic se počítá nejdelší cesta
export const RUKA_MAX = 7;        // nad kolik karet se při sedmičce zahazuje

// ── Geometrie ────────────────────────────────────────────────
export const VELIKOST = 52;
const SIRKA = VELIKOST * Math.sqrt(3);
const VYSKA = VELIKOST * 2;
export const STRED_X = 350;
export const STRED_Y = 310;
const RADY = [3, 4, 5, 4, 3];
const POSUN = [1, 0.5, 0, 0.5, 1];

export const stredPole = (rada, sloupec) => ({
  x: STRED_X - ((RADY[2] - 1) / 2) * SIRKA + sloupec * SIRKA + POSUN[rada] * SIRKA,
  y: STRED_Y - 2 * VYSKA * 0.75 + rada * VYSKA * 0.75,
});

export function bodyPole(cx, cy, r = VELIKOST) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

// ── Stavba desky ─────────────────────────────────────────────
//  `rng` je funkce 0–1 od serveru; deska je tím pádem daná seedem
//  a jde ji v testu zopakovat.
export function novaDeska(rng) {
  const zamichej = (a) => {
    const p = [...a];
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  };

  const suroviny = zamichej(POLE_SUROVIN);
  const zetony = zamichej(ZETONY);

  const pole = [];
  let idx = 0, zIdx = 0, zlodej = -1;
  for (let rada = 0; rada < RADY.length; rada++) {
    for (let sl = 0; sl < RADY[rada]; sl++) {
      const s = suroviny[idx];
      const { x, y } = stredPole(rada, sl);
      pole.push({
        id: idx, rada, sloupec: sl, surovina: s,
        cislo: s === POUST ? null : zetony[zIdx++],
        x: +x.toFixed(1), y: +y.toFixed(1),
      });
      if (s === POUST) zlodej = idx;
      idx++;
    }
  }

  // Vrcholy: stejný bod sdílí až tři pole, slučuje se přes zaokrouhlení.
  const vrcholy = [];
  const mapa = new Map();
  const poleVrcholy = [];
  for (const p of pole) {
    const seznam = [];
    for (const [vx, vy] of bodyPole(p.x, p.y)) {
      const klic = `${Math.round(vx * 2)},${Math.round(vy * 2)}`;
      if (!mapa.has(klic)) {
        mapa.set(klic, vrcholy.length);
        vrcholy.push({
          id: vrcholy.length, x: +vx.toFixed(1), y: +vy.toFixed(1),
          majitel: null, typ: null, pole: [], sousedi: [], pristav: null,
        });
      }
      const vi = mapa.get(klic);
      vrcholy[vi].pole.push(p.id);
      seznam.push(vi);
    }
    poleVrcholy.push(seznam);
  }

  const hrany = [];
  const videne = new Set();
  for (const seznam of poleVrcholy) {
    for (let i = 0; i < 6; i++) {
      const a = seznam[i], b = seznam[(i + 1) % 6];
      const klic = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (videne.has(klic)) continue;
      videne.add(klic);
      hrany.push({ id: hrany.length, v1: a, v2: b, majitel: null });
      if (!vrcholy[a].sousedi.includes(b)) vrcholy[a].sousedi.push(b);
      if (!vrcholy[b].sousedi.includes(a)) vrcholy[b].sousedi.push(a);
    }
  }

  const pristavy = rozdejPristavy(vrcholy, hrany, zamichej);
  for (const p of pristavy) for (const v of p.vrcholy) vrcholy[v].pristav = p.typ;

  return { pole, vrcholy, hrany, poleVrcholy, pristavy, zlodej };
}

// Přístavy sedí na pobřežních hranách – tedy těch, které sousedí
// jen s jedním polem. Rozmístí se pravidelně kolem dokola.
function rozdejPristavy(vrcholy, hrany, zamichej) {
  const pobrezi = [];
  for (const h of hrany) {
    const a = vrcholy[h.v1], b = vrcholy[h.v2];
    const spolecna = a.pole.filter(x => b.pole.includes(x));
    if (spolecna.length !== 1) continue;
    const sx = (a.x + b.x) / 2, sy = (a.y + b.y) / 2;
    pobrezi.push({ v1: h.v1, v2: h.v2, uhel: Math.atan2(sy - STRED_Y, sx - STRED_X) });
  }
  pobrezi.sort((a, b) => a.uhel - b.uhel);

  const typy = zamichej(PRISTAVY.map(p => p.typ));
  const krok = Math.floor(pobrezi.length / PRISTAVY.length);
  const out = [];
  for (let i = 0; i < PRISTAVY.length; i++) {
    const h = pobrezi[i * krok];
    if (!h) continue;
    out.push({ typ: typy[i], vrcholy: [h.v1, h.v2] });
  }
  return out;
}

// Kolik teček má číslo (pravděpodobnost hodu) – kvůli hodnocení míst.
export const tecky = (c) => (c === null ? 0 : c <= 6 ? c - 1 : 13 - c);
