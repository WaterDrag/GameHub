// ─────────────────────────────────────────────────────────────
//  Kvak! – rybník 8×8, žabí královny a jejich poddaní.
//
//  Deska je 64 kartiček lícem dolů. Kdo přijde o královnu nebo se
//  nemůže hnout, končí; vyhrává poslední živá královna.
//
//  Složení balíčku pravidla neurčují, jen vyjmenovávají druhy.
//  Čísla níž jsou naměřená (`tools/test-kvak.mjs`) tak, aby partie
//  netrvala věčnost a štiky nevymazaly půlku žab v prvních tazích.
// ─────────────────────────────────────────────────────────────

export const STRANA = 8;
export const POLI = STRANA * STRANA;

// Kolik malých žabek má hráč mimo desku. Pravidla říkají jen
// „zbytek v zásobě“ – tohle je zároveň strop plození.
export const ZASOBA = 4;

// Kolik tahů smí běžet bez pokroku, než rybník vyschne.
// Dvě královny na 8×8 se umí navždy uhýbat – naměřeno: bez tohohle
// stropu skončilo 5 partijí z 30 a zbytek se přehazoval mezi dvěma poli.
// Pokrok = otočená nová kartička, vyhozená žába nebo rozmnožení.
export const BEZ_POKROKU = 40;

// Kartičky rybníka. `nic` = bezpečné pole, na kterém se nic neděje.
export const KARTY = {
  voda: { nazev: 'Voda', emoji: '💧', popis: 'Bezpečné pole, nic se neděje.' },
  rakos: { nazev: 'Rákos', emoji: '🌿', popis: 'Kdo tu stojí, toho nejde vyhodit.' },
  leknin: { nazev: 'Leknín', emoji: '🌸', popis: 'Smíš přeskočit na jiný odhalený leknín.' },
  komar: { nazev: 'Komár', emoji: '🦟', popis: 'Pochutnáš si – táhneš ještě jednou.' },
  stika: { nazev: 'Štika', emoji: '🦈', popis: 'Sežere žabku. Královna přežije, ale tah končí.' },
  samec: { nazev: 'Sameček', emoji: '💚', popis: 'Královna se rozmnoží – nová žabka vedle.' },
};

export const DRUHY = Object.keys(KARTY);

// 64 kartiček. Vody je nejvíc, aby deska nebyla samý efekt.
export const SLOZENI = {
  voda: 20,
  rakos: 12,
  leknin: 8,
  komar: 8,
  stika: 8,
  samec: 8,
};

// Startovní pole: roh + dvě sousední kartičky na kraji.
// Dva hráči si sednou naproti sobě, tři a čtyři doplní zbylé rohy.
export const STARTY = [
  [[0, 0], [0, 1], [1, 0]],
  [[7, 7], [7, 6], [6, 7]],
  [[0, 7], [0, 6], [1, 7]],
  [[7, 0], [7, 1], [6, 0]],
];

export const BARVY = ['#ff2d55', '#38bdf8', '#ffffff', '#c084fc'];
export const ZABA = ['🐸', '🐸', '🐸', '🐸'];
export const KRALOVNA = ['👑', '👑', '👑', '👑'];

export const klic = (r, c) => `${r}-${c}`;
export const rozklic = (k) => k.split('-').map(Number);
export const index = (r, c) => r * STRANA + c;
export const naDesce = (r, c) => r >= 0 && c >= 0 && r < STRANA && c < STRANA;

// Osm směrů – žába skáče vodorovně, svisle i šikmo.
export const SMERY = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export function sousedi(r, c) {
  const out = [];
  for (const [dr, dc] of SMERY) {
    const nr = r + dr, nc = c + dc;
    if (naDesce(nr, nc)) out.push([nr, nc]);
  }
  return out;
}

// Rozdá 64 kartiček tak, aby startovní pole byla bezpečná.
// Kdyby na rohu ležela štika, stála by na ní žába hned od začátku –
// a na odhalenou štiku už nikdo nesmí stoupnout.
export function novaDeska(rng, hracu) {
  const balicek = [];
  for (const [druh, kolik] of Object.entries(SLOZENI)) {
    for (let i = 0; i < kolik; i++) balicek.push(druh);
  }

  const startovni = new Set();
  for (let h = 0; h < hracu; h++) {
    for (const [r, c] of STARTY[h]) startovni.add(index(r, c));
  }

  // Bezpečné kartičky napřed na starty, zbytek se zamíchá do rybníka.
  // Míchá se JEDNOU a pak se dělí – kdyby se `naStart` bralo z jedné
  // kopie a zbytek z druhé, změnil by se poměr vody a rákosu.
  const bezpecne = rng.shuffle(balicek.filter(d => d === 'voda' || d === 'rakos'));
  const ostatni = balicek.filter(d => d !== 'voda' && d !== 'rakos');
  const naStart = bezpecne.slice(0, startovni.size);
  const zbytek = rng.shuffle([...bezpecne.slice(startovni.size), ...ostatni]);

  const pole = new Array(POLI).fill(null);
  let iS = 0, iZ = 0;
  for (let i = 0; i < POLI; i++) {
    pole[i] = startovni.has(i) ? naStart[iS++] : zbytek[iZ++];
  }
  return pole;
}
