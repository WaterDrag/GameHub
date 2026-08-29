// ─────────────────────────────────────────────────────────────
//  Závody – trať a parametry vozu.
//
//  Trať je středová čára (polyline) + poloviční šířka. Všechno
//  ostatní se z ní odvozuje: kresba, kontrola „jsem na asfaltu",
//  kontrolní body i stopa pro boty. Díky tomu stačí na změnu
//  okruhu přepsat pár čísel a nic dalšího se rozbít nemůže.
// ─────────────────────────────────────────────────────────────

export const R = {
  // Svět musí být hodně větší než jedna trať: ve stavěném režimu do něj
  // hráči skládají 20 i více dílů a při 3500×2300 vyjela trať ven už po
  // čtvrtém dílu, takže se nedalo pokračovat.
  W: 6400, H: 4200,
  TICK: 30,
  DT: 1 / 30,

  HALF: 132,             // poloviční šířka asfaltu
  // Dosah kontrolního bodu. Musí být větší než poloviční šířka trati (jinak
  // by šel objet po asfaltu) a menší než rozestup bodů (jinak by se body
  // překrývaly a přeskávaly).
  CP_R: 150,
  LAPS: 3,

  CAR_R: 20,             // poloměr pro srážky
  ACCEL: 1150,           // plyn (px/s²)
  BRAKE: 1700,           // brzda
  REVERSE: 420,          // couvání je pomalé schválně
  MAX_SPEED: 880,
  MAX_REVERSE: 210,
  DRAG: 0.55,            // odpor vzduchu (podélný)
  GRIP: 7.2,             // jak rychle mizí boční smyk (vyšší = drží víc)
  DRIFT_GRIP: 2.4,       // s ruční brzdou auto pustí zadek
  TURN: 3.15,            // rad/s při plné rychlosti
  TURN_REF: 260,         // od téhle rychlosti zatáčí naplno
  TURN_SLOW: 0.35,       // zbytkové řízení skoro na místě

  // Mimo asfalt: brutální odpor a horší přilnavost, ale ne úplné zastavení –
  // zkratka přes trávu se nesmí vyplatit, ale nesmí ani hru zaseknout.
  GRASS_DRAG: 3.4,
  GRASS_GRIP: 3.0,
  GRASS_MAX: 300,

  BOUNCE: 0.45,          // odraz od mantinelu světa
  HIT_PUSH: 0.55,        // jak moc se auta odstrčí při kontaktu

  BOOST_MUL: 1.55,       // násobič max. rychlosti v turbu
  BOOST_MS: 1400,
  PUDDLE_GRIP: 2.2,      // kaluž = smyk
  OLEJ_GRIP: 1.1,        // olej = skoro žádná přilnavost

  COUNTDOWN_MS: 3200,    // semáfor před startem

  // ── Stavěný režim ───────────────────────────────────
  KOL: 5,                // kolik kol se hraje (stavba + závod)
  STAVBA_MS: 22000,      // lhůta celé stavební fáze (staví se najednou)
  // Kolik dílů má hráč v nabídce. Staví najednou, takže volnej konec
  // se hejbe pod rukama – malá ruka by kvůli tomu snadno celá znečinněla.
  RUKA: 5,
  BOT_STAVBA_MIN: 1200,  // za jak dlouho položí bot
  BOT_STAVBA_MAX: 6000,
  BODY: [10, 6, 3, 1, 0, 0],   // body za pořadí v cíli
  BOD_DOJEL: 1,          // bonus za doježdění do cíle vůbec
  // Po prvním v cíli mají ostatní tolik na doježtí. Původních 12 s bylo
  // málo – pomalejší auto potřebuje na kolo kolem 18 s a v měření takhle
  // nedojela třetina startovního pole.
  FINISH_MS: 30000,
};

// Středová čára okruhu po směru hodinových ručiček.
// Bod 0 je start/cíl na dolní rovince.
export const LINE = [
  { x:  700, y: 1660 },
  { x: 1200, y: 1700 },
  { x: 1800, y: 1710 },
  { x: 2300, y: 1680 },
  { x: 2680, y: 1560 },
  { x: 2860, y: 1300 },
  { x: 2880, y: 1000 },
  { x: 2760, y:  720 },
  { x: 2480, y:  540 },
  { x: 2150, y:  470 },
  { x: 1900, y:  620 },   // šikana dolů
  { x: 1650, y:  700 },
  { x: 1400, y:  560 },   // a zpátky nahoru
  { x: 1100, y:  460 },
  { x:  760, y:  500 },
  { x:  480, y:  700 },
  { x:  360, y: 1000 },
  { x:  380, y: 1320 },
  { x:  500, y: 1560 },
];

// Turbo pole – index úseku na středové čáře + posun napříč tratí (-1..1).
export const BOOSTS = [
  { seg: 1,  off:  0.0 },
  { seg: 6,  off: -0.4 },
  { seg: 12, off:  0.35 },
  { seg: 16, off: -0.25 },
];
export const BOOST_R = 62;

// Kaluže – stejná adresace, jen větší a zákeřnější.
export const PUDDLES = [
  { seg: 4,  off:  0.45 },
  { seg: 8,  off: -0.5 },
  { seg: 10, off:  0.15 },
  { seg: 14, off:  0.5 },
  { seg: 17, off: -0.35 },
];
export const PUDDLE_R = 96;

// Odkud začíná stavěná trať a čím začíná – na úvodní rovince stojí rošt,
// takže tam auta nesmí chybět asfalt už v prvním kole.
export const START = { x: 900, y: 2100, a: 0 };
export const ZAKLAD = ['dlouha'];

export const CAR_COLORS = ['#e53935', '#1e88e5', '#43a047', '#8e24aa', '#fb8c00', '#00acc1'];

export const OPTIONS = [
  { key: 'stavba', label: 'Stavěná trať', emoji: '🧱', def: true,
    desc: 'Každé kolo si trať postavíte sami z dílků a přidáte do ní turba a pasti. Bez toho se jede pevný okruh.' },
];
