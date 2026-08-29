// ─────────────────────────────────────────────────────────────
//  Člověče, nezlob se – deska.
//
//  Deska NENÍ konstanta, ale parametr: počet ramen se odvodí od mapy.
//  Stejný trik jako u závodů, kde je trať jen středová čára – z jednoho
//  popisu se spočítá kresba, dráha i domečky, takže osmičlenná deska
//  není druhá hra, jen jiná čísla.
//
//  Rozměry (sektor 10 polí, vstupy na 0/10/20/30, domeček za polem
//  těsně před startem) i kresba kříže jsou převzaté z předlohy.
// ─────────────────────────────────────────────────────────────

export const CIL = 4;          // políček v domečku
export const FIGUREK_MAX = 4;  // víc se do domečku ani do cíle nevejde
export const FIGUREK_MIN = 1;

// Počet polí mezi starty je vlastnost mapy. Počet figurek je naopak
// VOLBA před hrou (`figurekDef` je jen to, co se předvyplní) – hostitel
// si tím řídí, jak dlouho se bude hrát.

export const MAPY = [
  {
    id: 'mala',
    nazev: 'Klasická deska',
    popis: '4 ramena, 40 polí. Kříž, jak ho každý zná.',
    emoji: '✚',
    ramen: 4,
    sektor: 10,
    figurekDef: 4,
    tvar: 'kriz',
  },
  {
    id: 'velka',
    nazev: 'Velká deska',
    popis: '8 ramen, 80 polí, dvě figurky. Pro víc než čtyři hráče jediná možná.',
    emoji: '🎡',
    ramen: 8,
    sektor: 10,
    // Dvě figurky, ne čtyři – a je to měřené, ne odhadnuté. Se čtyřmi
    // trvá partie osmi hráčů 3465 hodů (skoro dvě hodiny), se třemi
    // 1682. Dvě dají 887 hodů a hráč má na výběr ve 33 % hodů, což je
    // prakticky stejně jako klasika (35 %). Se třemi figurkami klesne
    // výběr na 27 % a hodů naprázdno přibude – delší A nudnější.
    figurekDef: 2,
    tvar: 'kruh',
  },
];

export const MAPA_PODLE = Object.fromEntries(MAPY.map(m => [m.id, m]));
export const VYCHOZI_MAPA = 'mala';
export const mapaNebo = (id) => MAPA_PODLE[id] || MAPA_PODLE[VYCHOZI_MAPA];

// Kolik hráčů se na mapu vejde. Nad tohle číslo se musí na větší desku.
export const kapacita = (m) => m.ramen;

export const okruh = (m) => m.ramen * m.sektor;
export const posledniKrok = (m) => okruh(m) + CIL - 1;


// Krok figurky: -1 = domeček, 0..okruh-1 = dráha, okruh..okruh+3 = cíl.
export const V_DOMECKU = -1;
export const vDomecku = (k) => k < 0;
export const vCili = (m, k) => k >= okruh(m);
export const naDraze = (m, k) => k >= 0 && k < okruh(m);
export const cilovySlot = (m, k) => k - okruh(m);

// Startovní pole ramene na okruhu.
export const startRamene = (m, rameno) => rameno * m.sektor;
// Absolutní pole na okruhu z hráčova kroku.
export const naOkruhu = (m, rameno, krok) => (startRamene(m, rameno) + krok) % okruh(m);

// ── Rozsazení ────────────────────────────────────────────────
// Hráči se rozprostřou po ramenech co nejrovnoměrněji, ať dva hráči
// sedí naproti sobě a ne vedle sebe – předloha to dělala stejně
// (dva hráči = červená a žlutá, tedy protilehlá ramena).
export function ramenaProHrace(m, pocet) {
  const A = m.ramen;
  const n = Math.min(pocet, A);
  const out = [];
  for (let i = 0; i < n; i++) {
    let r = Math.round((i * A) / n) % A;
    while (out.includes(r)) r = (r + 1) % A;
    out.push(r);
  }
  return out;
}

// ── Barvy ────────────────────────────────────────────────────
// První čtyři jsou barvy z předlohy, aby klasická deska vypadala
// pořád stejně. Další čtyři jsou navíc pro velkou desku.
export const BARVY = [
  { id: 'red',    nazev: 'Červená',   barva: '#e05555', tmava: '#8a2222', svetla: '#f07070' },
  { id: 'blue',   nazev: 'Modrá',     barva: '#5588e0', tmava: '#223e8a', svetla: '#80aaee' },
  { id: 'yellow', nazev: 'Žlutá',     barva: '#e0b840', tmava: '#8a6810', svetla: '#f0d060' },
  { id: 'green',  nazev: 'Zelená',    barva: '#45b87a', tmava: '#1a6640', svetla: '#70d090' },
  { id: 'purple', nazev: 'Fialová',   barva: '#a855f7', tmava: '#5b21a6', svetla: '#c78bfa' },
  { id: 'orange', nazev: 'Oranžová',  barva: '#f97316', tmava: '#9a3d06', svetla: '#fb9c56' },
  { id: 'cyan',   nazev: 'Tyrkysová', barva: '#06b6d4', tmava: '#075e75', svetla: '#4fd4e8' },
  { id: 'pink',   nazev: 'Růžová',    barva: '#ec4899', tmava: '#8e1d55', svetla: '#f47cb8' },
];
export const barvaRamene = (rameno) => BARVY[rameno % BARVY.length];

// ── Geometrie ────────────────────────────────────────────────
//  Vrací souřadnice ve čtvercovém plátně (SVG viewBox), takže se deska
//  sama přizpůsobí displeji. Dvě podoby: klasika je kříž 11×11 jako
//  v předloze, velká deska kruh – kříž se na osm ramen nedá natáhnout.

// Klasický kříž: dráha po obvodu mřížky 11×11, převzato z předlohy.
const KRIZ_DRAHA = [
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0],
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [10, 5],
  [10, 6], [9, 6], [8, 6], [7, 6], [6, 6], [6, 7], [6, 8], [6, 9], [6, 10], [5, 10],
  [4, 10], [4, 9], [4, 8], [4, 7], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 5],
];
const KRIZ_CIL = [
  [[1, 5], [2, 5], [3, 5], [4, 5]],
  [[5, 1], [5, 2], [5, 3], [5, 4]],
  [[9, 5], [8, 5], [7, 5], [6, 5]],
  [[5, 9], [5, 8], [5, 7], [5, 6]],
];
const KRIZ_DOMECEK = [
  [[1, 1], [2, 1], [1, 2], [2, 2]],
  [[8, 1], [9, 1], [8, 2], [9, 2]],
  [[8, 8], [9, 8], [8, 9], [9, 9]],
  [[1, 8], [2, 8], [1, 9], [2, 9]],
];

const KRIZ_ROZTEC = 62;
const KRIZ_OKRAJ = 34;

function geometrieKriz(figurek) {
  const p = ([gx, gy]) => ({
    x: KRIZ_OKRAJ + gx * KRIZ_ROZTEC + KRIZ_ROZTEC / 2,
    y: KRIZ_OKRAJ + gy * KRIZ_ROZTEC + KRIZ_ROZTEC / 2,
  });
  return {
    tvar: 'kriz',
    rPole: KRIZ_ROZTEC * 0.40,
    roztec: KRIZ_ROZTEC,
    draha: KRIZ_DRAHA.map(p),
    cile: KRIZ_CIL.map(c => c.map(p)),
    domecky: KRIZ_DOMECEK.map(d => d.slice(0, figurek).map(p)),
    velikost: 11 * KRIZ_ROZTEC + KRIZ_OKRAJ * 2,
  };
}

const KRUH_ROZTEC = 52;

function geometrieKruh(m, figurek) {
  const N = okruh(m);
  const R = (N * KRUH_ROZTEC) / (2 * Math.PI);
  const uhel = (i) => -Math.PI / 2 + (i / N) * Math.PI * 2;
  const bod = (a, r) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });

  const draha = [];
  for (let i = 0; i < N; i++) draha.push(bod(uhel(i), R));

  const cile = [];
  const domecky = [];
  for (let rameno = 0; rameno < m.ramen; rameno++) {
    const s = startRamene(m, rameno);

    // Domeček ústí do středu z pole těsně PŘED startem – tam figurka
    // po celém kole odbočuje. Stejně jako v kříži.
    const aCil = uhel((s - 1 + N) % N);
    const c = [];
    for (let i = 0; i < CIL; i++) c.push(bod(aCil, R - KRUH_ROZTEC * (i + 1)));
    cile.push(c);

    // Startovní domeček (2×2) je venku vedle startovního pole.
    const aDom = uhel(s + 1);
    const stred = bod(aDom, R + KRUH_ROZTEC * 1.75);
    const kolmo = { x: Math.cos(aDom + Math.PI / 2), y: Math.sin(aDom + Math.PI / 2) };
    const ven = { x: Math.cos(aDom), y: Math.sin(aDom) };
    const d = [];
    for (let i = 0; i < figurek; i++) {
      const dx = (i % 2 - 0.5) * KRUH_ROZTEC;
      const dy = (Math.floor(i / 2) - 0.5) * KRUH_ROZTEC;
      d.push({ x: stred.x + kolmo.x * dx + ven.x * dy, y: stred.y + kolmo.y * dx + ven.y * dy });
    }
    domecky.push(d);
  }

  let max = 0;
  for (const q of [...draha, ...cile.flat(), ...domecky.flat()]) max = Math.max(max, Math.hypot(q.x, q.y));
  const polomer = max + KRUH_ROZTEC * 0.40 + 16;
  const posun = (q) => ({ x: q.x + polomer, y: q.y + polomer });

  return {
    tvar: 'kruh',
    rPole: KRUH_ROZTEC * 0.40,
    roztec: KRUH_ROZTEC,
    draha: draha.map(posun),
    cile: cile.map(c => c.map(posun)),
    domecky: domecky.map(d => d.map(posun)),
    velikost: polomer * 2,
  };
}

export function geometrie(m, figurek = m.figurekDef) {
  const f = Math.max(FIGUREK_MIN, Math.min(FIGUREK_MAX, figurek | 0));
  return m.tvar === 'kriz' ? geometrieKriz(f) : geometrieKruh(m, f);
}

// ── Odhad délky partie ───────────────────────────────────────
//  Medián hodů na partii, NAMĚŘENÝ simulací (40 partií botů na buňku,
//  `tools/test-clovece.mjs` a sweep v shodné konfiguraci). Není to
//  odhad od oka – rozdíly jsou velké a nešly by uhodnout: osm hráčů
//  se čtyřmi figurkami je 3196 hodů, se dvěma 898.
//
//  Řádek = počet hráčů, sloupec = počet figurek (1 až 4).
const ODHAD = {
  mala: {
    2: [34, 68, 110, 142],
    3: [47, 106, 186, 266],
    4: [68, 158, 301, 440],
  },
  velka: {
    2: [53, 111, 184, 246],
    3: [77, 180, 298, 481],
    4: [110, 242, 451, 779],
    5: [139, 375, 596, 1187],
    6: [165, 502, 1043, 1850],
    7: [199, 657, 1549, 2485],
    8: [227, 898, 2038, 3196],
  },
};

// Kolik vteřin zabere jeden hod i s kliknutím a animací. Dvě třetiny
// hodů se přehrají samy (jedna možnost = vteřina čekání), zbytek si
// hráč vybírá – proto o něco víc než ta vteřina.
export const SEKUND_NA_HOD = 2.2;

export function odhadHodu(mapaId, hracu, figurek) {
  const t = ODHAD[mapaId] || ODHAD.mala;
  const klice = Object.keys(t).map(Number);
  const h = Math.max(klice[0], Math.min(klice[klice.length - 1], hracu | 0));
  const f = Math.max(FIGUREK_MIN, Math.min(FIGUREK_MAX, figurek | 0));
  return t[h][f - 1];
}

export function odhadMinut(mapaId, hracu, figurek) {
  return Math.round((odhadHodu(mapaId, hracu, figurek) * SEKUND_NA_HOD) / 60);
}

// Text pro hráče. Schválně jako rozsah – je to odhad z mediánu, ne slib.
export function odhadText(mapaId, hracu, figurek) {
  const m = odhadMinut(mapaId, hracu, figurek);
  if (m < 8) return 'pár minut';
  const dol = Math.round(m * 0.75 / 5) * 5;
  const hor = Math.round(m * 1.3 / 5) * 5;
  return `${dol}–${hor} min`;
}
