// ─────────────────────────────────────────────────────────────
//  Člověče, nezlob se – herní módy.
//
//  Každý mód je samostatné zaškrtávátko a dají se kombinovat. Popis
//  si nese sám, takže hub o žádném konkrétním nemusí vědět.
//
//  Pravidlo, které hráči něco VNUTÍ nebo VEZME, musí o sobě dát vědět –
//  jinak to vypadá jako chyba hry. Proto každý mód umí hlášku a ta se
//  posílá všem, ne jen tomu, koho se týká.
// ─────────────────────────────────────────────────────────────

export const MODY = [
  {
    id: 'zaba',
    nazev: 'Žába',
    emoji: '🐸',
    popis: 'Když můžeš přeskočit cizí figurku, musíš. Spouští to jen přeskok dopředu.',
  },
  {
    id: 'double',
    nazev: 'Double trouble',
    emoji: '🎲',
    popis: 'Dvě kostky, platí součet (2–12). O jedno pole se posunout nedá. Na dvou stejných se hází znovu.',
  },
  {
    id: 'sniper',
    nazev: 'Sniper',
    emoji: '🎯',
    popis: 'Kdo vejde do domečku, sundá jednu soupeřovu figurku z dráhy. Posun uvnitř domečku se nepočítá.',
  },
  {
    id: 'sacrifice',
    nazev: 'Sacrifice',
    emoji: '⚔️',
    popis: 'Místo hodu obětuj dvě svoje figurky z dráhy a sundej za ně jednu soupeřovu.',
  },
  {
    id: 'boomerang',
    nazev: 'Boomerang',
    emoji: '↩️',
    popis: 'Za 1 až 3 smíš couvat. Od čtyřky výš se musí dopředu.',
  },
  {
    id: 'lovec',
    nazev: 'Lovec odměn',
    emoji: '🏹',
    popis: 'Za vyhození nasadíš figurku na start. Když tam už stojí tvoje, posune se o pole dál.',
  },
  {
    id: 'nervy',
    nazev: 'Nervy',
    emoji: '😰',
    popis: 'Vyhození se nemusí povést. Když selže, figurka zůstane stát a tah propadá.',
  },
];

export const MOD_PODLE = Object.fromEntries(MODY.map(m => [m.id, m]));

// Jak často Nervy zkazí vyhození. Číslo je vyladěné měřením – viz README.
export const NERVY_SANCE = 0.3;

// Boomerang couvá nejvýš o tři pole.
export const COUV_MAX = 3;

export function cisteMody(mody) {
  const out = {};
  for (const m of MODY) out[m.id] = !!mody?.[m.id];
  return out;
}

export const zapnute = (mody) => MODY.filter(m => mody?.[m.id]);
