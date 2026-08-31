// ─────────────────────────────────────────────────────────────
//  UNO No Mercy – balíček.
//
//  Složení je převzaté z předlohy kus po kuse: 132 karet.
//   • 4 barvy × (jedna nula, dvojice 1–9)            = 76
//   • 4 barvy × 2× (stop, obrat, +2, výhoz, stop všem) = 40
//   • 4× (divoká, +4, +6, +10)                        = 16
// ─────────────────────────────────────────────────────────────

export const BARVY = ['cervena', 'modra', 'zelena', 'zluta'];
export const DIVOKA = 'divoka';

// Popis barev pro klienta. Odstíny jsou z předlohy.
export const BARVA_INFO = {
  cervena: { nazev: 'Červená', hex: '#ff2244' },
  modra: { nazev: 'Modrá', hex: '#1a7fff' },
  zelena: { nazev: 'Zelená', hex: '#00e676' },
  zluta: { nazev: 'Žlutá', hex: '#ffd600' },
};

// Akční znaky. `lizni` = kolik karet přidá do trestu.
export const AKCE = {
  stop: { znak: '🚫', nazev: 'Stop', lizni: 0 },
  obrat: { znak: '↺', nazev: 'Obrat', lizni: 0 },
  plus2: { znak: '+2', nazev: 'Lízni dvě', lizni: 2 },
  vyhod: { znak: '🗑', nazev: 'Výhoz barvy', lizni: 0 },
  stopVsem: { znak: '⏭', nazev: 'Stop všem', lizni: 0 },
  divoka: { znak: '✦', nazev: 'Divoká', lizni: 0 },
  plus4: { znak: '+4', nazev: 'Divoká lízni 4', lizni: 4 },
  plus6: { znak: '+6', nazev: 'Divoká lízni 6', lizni: 6 },
  plus10: { znak: '+10', nazev: 'Divoká lízni 10', lizni: 10 },
};

export const BAREVNE_AKCE = ['stop', 'obrat', 'plus2', 'vyhod', 'stopVsem'];
export const DIVOKE_ZNAKY = ['divoka', 'plus4', 'plus6', 'plus10'];

export const jeDivoka = (k) => k.b === DIVOKA;
export const jeCislo = (k) => /^[0-9]$/.test(k.z);
// Kolik karet ten znak přidá do trestu.
export const trestZa = (z) => AKCE[z]?.lizni || 0;
export const znak = (z) => AKCE[z]?.znak || z;
export const nazevZnaku = (z) => AKCE[z]?.nazev || `Číslo ${z}`;

// Balíček se staví vždy stejně; zamíchá ho až server svým RNG.
export function novyBalicek() {
  const out = [];
  for (const b of BARVY) {
    out.push({ b, z: '0' });
    for (let i = 1; i <= 9; i++) { out.push({ b, z: String(i) }); out.push({ b, z: String(i) }); }
    for (let i = 0; i < 2; i++) for (const z of BAREVNE_AKCE) out.push({ b, z });
  }
  for (let i = 0; i < 4; i++) for (const z of DIVOKE_ZNAKY) out.push({ b: DIVOKA, z });
  return out;
}

export const VELIKOST_BALICKU = 132;

// Kolik karet znamená vyřazení. V No Mercy je to 25.
export const MILOST = 25;
export const NA_RUKU = 7;
