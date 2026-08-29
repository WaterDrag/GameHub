// ─────────────────────────────────────────────────────────────
//  Aréna – ladicí čísla, zbraně, power-upy a mapa.
//
//  Importuje to server i prohlížeč. Musí to být přesně stejné
//  hodnoty na obou stranách, jinak se predikce rozejde se
//  serverem a hráči bude postava "cukat".
// ─────────────────────────────────────────────────────────────

export const A = {
  W: 3200, H: 2200,           // větší mapa, aby se do ní vešly budovy

  TICK: 30,                 // Hz serveru i vstupní smyčky klienta
  get DT() { return 1 / this.TICK; },

  PLAYER_R: 18,
  ACCEL: 2800,
  MAX_SPEED: 330,
  FRICTION: 11,

  HP: 100,
  RESPAWN_MS: 2600,
  SPAWN_SAFE: 420,          // nespawnuj blíž než tohle k nepříteli

  VIEW_R: 950,              // co dál, to hráči neposíláme (anti-wallhack)

  PACK_HEAL: 40,
  PICKUP_R: 18,
  PAD_RESPAWN_MS: 11000,    // jak dlouho trvá, než se na podstavci objeví další věc

  FRAG_LIMIT: 20,
  MATCH_MS: 6 * 60 * 1000,

  // ── Výškové úrovně ──
  // Kdo stojí výš, je pro níže postavené neviditelný a nedá se
  // trefit přímou střelou. Zaplatí za to kratším dosahem.
  HIGH_RANGE: 0.72,           // dosah × tohle za každou úroveň nahoru

  STORM_COVER: 95,            // jak blízko ke zdi je člověk krytý před bleskem

  // Výstřel prozradí i toho, kdo stojí výš. Bez toho byla obsazená
  // věž nedobytná – v měření tam za čtyři zápasy nepadla jediná smrt.
  LOUD_MS: 1100,
};

// ── Zbraně ───────────────────────────────────────────────────
//  blaster – výchozí, jediný s přebíjením a nekonečnou zásobou
//  rocket  – bouchne při dopadu, zraňuje i okolí
//  raygun  – okamžitý zásah, projde skrz hráče
//
//  Speciální zbraně mají pevný počet ran, nepřebíjí se a po
//  vystřílení (nebo po smrti) se hráč vrací k blasteru.
export const WEAPONS = {
  blaster: {
    name: 'Blaster', emoji: '🔫', kind: 'bullet',
    fire: 330,              // bylo 165 – poloviční kadence podle zadání
    mag: 5, reload: 1400, refill: true,
    // Při 950 px/s se muselo na 400 px předsazovat o čtyři šířky hráče
    // a přímé míření stačilo jen do 66 px – trefit někoho bylo skoro
    // nemožné. Rychlejší střela a o něco větší zásah to srovnávají.
    // `life` je zkrácená, aby dostřel zůstal kolem 1360 px.
    dmg: 13, speed: 1700, spread: 0.012, r: 8, life: 0.8,
  },
  rocket: {
    name: 'Raketomet', emoji: '🚀', kind: 'rocket',
    fire: 950,
    mag: 4, reload: 0, refill: false,
    // Přímý zásah bolí víc než okolní tlaková vlna – dřív to bylo
    // obráceně a přímá trefa navíc vůbec nefungovala.
    // Se zaměřenou detonací raketa vybuchne tam, kam se kliklo – takže
    // pomalá střela minula všechno, co se hýbe. Při 560 px/s ujel cíl
    // za dobu letu na 400 px celých 236 px, tedy mimo dosah výbuchu.
    dmg: 58, speed: 1000, spread: 0.012, r: 9, life: 1.6,
    splashR: 155, splashDmg: 38,
    // Raketa vybuchne tam, kam se mířilo. Klient posílá vzdálenost
    // k zaměřovači, server ji ořízne do těchhle mezí – blíž než
    // minFuse by si hráč odpálil raketu v ruce.
    aimed: true, minFuse: 90, maxFuse: 1300,
  },
  raygun: {
    name: 'Raygun', emoji: '⚡', kind: 'ray',
    fire: 620,
    mag: 6, reload: 0, refill: false,
    dmg: 30, range: 1500, spread: 0,
  },
};

export const DEFAULT_WEAPON = 'blaster';

// ── Power-upy ────────────────────────────────────────────────
export const POWERS = {
  speed:   { name: 'Rychlost',         emoji: '💨', ms: 9000,  mul: 1.65 },
  invuln:  { name: 'Nesmrtelnost',     emoji: '🛡️', ms: 5000 },
  invis:   { name: 'Neviditelnost',    emoji: '👻', ms: 8000 },
  rapid:   { name: 'Rychlopalba',      emoji: '🔥', ms: 8000,  mul: 0.42 },
  // Nekonečné náboje byly v měření ×2,87 účinnější než ostatní power-upy
  // (3,3 % času, 9,6 % zabití) – ruší totiž přebíjení i limit zásobníku.
  infammo: { name: 'Nekonečné náboje', emoji: '♾️', ms: 5500 },
};

// Co se může objevit na podstavci a jak často.
export const PICKUPS = [
  { kind: 'heal',    w: 24, emoji: '➕', name: 'Lékárna' },
  { kind: 'rocket',  w: 10, emoji: '🚀', name: 'Raketomet' },
  { kind: 'raygun',  w: 10, emoji: '⚡', name: 'Raygun' },
  { kind: 'speed',   w: 11, emoji: '💨', name: 'Rychlost' },
  { kind: 'invuln',  w: 7,  emoji: '🛡️', name: 'Nesmrtelnost' },
  { kind: 'invis',   w: 9,  emoji: '👻', name: 'Neviditelnost' },
  { kind: 'rapid',   w: 11, emoji: '🔥', name: 'Rychlopalba' },
  { kind: 'infammo', w: 6,  emoji: '♾️', name: 'Nekonečné náboje' },
];

export const PICKUP_BY_KIND = Object.fromEntries(PICKUPS.map(p => [p.kind, p]));

// ── Eventy ───────────────────────────────────────────────────
// Zapínají se zaškrtnutím před hrou. Klient si z tohohle seznamu
// vykreslí volby sám, server přijme jen klíče, které tu jsou.
// Každá pohroma přichází ve vlnách: náhodně začne, chvíli řádí a zase
// poleví. Pevné časování dělalo z meteoritů a bouře trvalou kulisu –
// zapnuly se a pršelo do konce zápasu.
export const EVENTS = [
  {
    key: 'flood', name: 'Potopa', emoji: '🌊',
    desc: 'Voda ve vlnách stoupá a zase opadá. Když stoupne, utíkej na budovu nebo na vor.',
    firstMin: 25000, firstMax: 60000,    // kdy přijde první vlna
    durMin: 42000, durMax: 78000,        // jak dlouho drží
    gapMin: 30000, gapMax: 62000,        // klid mezi vlnami
    deepAt: 0.55,       // po jaké části vlny zaplaví i první patro
    warnMs: 9000,       // hlášení, že voda stoupne
    dps: 40,            // poškození za sekundu pod hladinou
  },
  {
    key: 'meteors', name: 'Meteority', emoji: '☄️',
    desc: 'Roj meteoritů. Ve středu dopadu je jistá smrt, na okraji jen popálenina.',
    // Dřív padlo za zápas jen ~22 kusů a jen ve 40 % času – bylo to
    // spíš kulisa než hrozba. Roj je teď hustší a klid kratší.
    firstMin: 10000, firstMax: 30000,
    durMin: 32000, durMax: 62000,
    gapMin: 14000, gapMax: 34000,
    everyMs: 1900, warnMs: 2100,
    announceMs: 8000,
    // Různě velké kusy. Poloměr musí být velký – při 2,1 s varování
    // uběhne hráč přes 600 px, takže z malé zóny vždycky vykročil.
    // `dmg` platí v jádře, k okraji klesá na 22 %.
    sizes: [
      { r: 150, dmg: 130, w: 5 },
      { r: 250, dmg: 190, w: 3 },
      { r: 390, dmg: 270, w: 2 },
    ],
    core: 0.32,         // do téhle části poloměru plná rána
    edge: 0.22,         // podíl poškození na samém okraji
  },
  {
    key: 'storm', name: 'Bouře', emoji: '⛈️',
    desc: 'Bouřkové fronty. Blesky trefují hráče na volném prostranství – kryj se u zdi.',
    firstMin: 12000, firstMax: 34000,
    durMin: 30000, durMax: 58000,
    gapMin: 16000, gapMax: 38000,
    everyMs: 1400, warnMs: 1100,
    announceMs: 8000,
    dmg: 60, coverR: 95, hitR: 92,
  },
  {
    key: 'zombies', name: 'Zombie apokalypsa', emoji: '🧟',
    desc: 'Z okrajů mapy se valí nemrtví. Jdou po nejbližším hráči, lezou i po rampách a je nutné je střílet.',
    firstMin: 18000, firstMax: 45000,
    durMin: 40000, durMax: 75000,
    gapMin: 20000, gapMax: 45000,
    announceMs: 8000,
    everyMs: 1500,      // jak často přibývají
    perWave: 2,         // kolik naráz
    max: 30,            // strop, ať to server neuvaří
    hp: 45, dmg: 15, hitMs: 650,
    speed: 175,         // pomalejší než hráč, ale nikdy se neunaví
    r: 16, reachR: 32,
  },
];

export const EVENT_BY_KEY = Object.fromEntries(EVENTS.map(e => [e.key, e]));

// Vory – během potopy jsou bezpečné i na zemi.
// Mimo potopu na ně nic nenavazuje, jsou to jen plochy na mapě.
export const RAFTS = [
  { x: 760,  y: 640,  w: 150, h: 150 },
  { x: 2290, y: 640,  w: 150, h: 150 },
  { x: 760,  y: 1440, w: 150, h: 150 },
  { x: 2290, y: 1440, w: 150, h: 150 },
  { x: 1520, y: 1560, w: 170, h: 140 },
];

// Zdi jsou obdélníky. Okraje arény řeší ohraničení, ne zeď.
// Zdi blokují pohyb i výhled na všech úrovních.
export const WALLS = [
  { x: 900,  y: 250,  w: 400, h: 45  },   // severní kryty
  { x: 1900, y: 250,  w: 400, h: 45  },
  { x: 900,  y: 1905, w: 400, h: 45  },   // jižní kryty
  { x: 1900, y: 1905, w: 400, h: 45  },

  { x: 150,  y: 1000, w: 45,  h: 200 },   // západní / východní stěny
  { x: 3005, y: 1000, w: 45,  h: 200 },
  { x: 700,  y: 900,  w: 45,  h: 400 },
  { x: 2455, y: 900,  w: 45,  h: 400 },

  { x: 1450, y: 400,  w: 300, h: 45  },   // krátké přepážky u centra
  { x: 1450, y: 1755, w: 300, h: 45  },

  { x: 200,  y: 200,  w: 120, h: 120 },   // rohové bloky
  { x: 2880, y: 200,  w: 120, h: 120 },
  { x: 200,  y: 1880, w: 120, h: 120 },
  { x: 2880, y: 1880, w: 120, h: 120 },
];

// ── Budovy ───────────────────────────────────────────────────
// Plošiny s výškovou úrovní. Z nižší úrovně se na ně nedá vstoupit
// jinak než rampou – okraj plošiny funguje jako sráz.
// Pozor na pořadí: hledá se odshora, aby jádro přebilo plošinu pod ním.
export const DECKS = [
  { x: 1450, y: 950,  w: 300, h: 300, level: 2 },   // jádro centrální věže
  { x: 1250, y: 800,  w: 700, h: 600, level: 1 },   // ochoz kolem věže

  { x: 380,  y: 300,  w: 340, h: 260, level: 1 },   // SZ budova
  { x: 2480, y: 300,  w: 340, h: 260, level: 1 },   // SV budova
  { x: 380,  y: 1640, w: 340, h: 260, level: 1 },   // JZ budova
  { x: 2480, y: 1640, w: 340, h: 260, level: 1 },   // JV budova
];

// Rampy spojují dvě úrovně. Vstoupit se dá z obou konců.
// Koridor je široký 150–160 px: při 80–90 px se v něm horda nemrtvých
// (průměr 32 px) zasekávala, 68 % všech zaseknutí bylo právě na rampách.
export const RAMPS = [
  { x: 720,  y: 355,  w: 90,  h: 150, lo: 0, hi: 1 },   // k SZ budově
  { x: 2390, y: 355,  w: 90,  h: 150, lo: 0, hi: 1 },   // k SV budově
  { x: 720,  y: 1695, w: 90,  h: 150, lo: 0, hi: 1 },   // k JZ budově
  { x: 2390, y: 1695, w: 90,  h: 150, lo: 0, hi: 1 },   // k JV budově

  { x: 1160, y: 1020, w: 90,  h: 160, lo: 0, hi: 1 },   // na ochoz ze západu
  { x: 1950, y: 1020, w: 90,  h: 160, lo: 0, hi: 1 },   // na ochoz z východu

  { x: 1520, y: 860,  w: 160, h: 90,  lo: 1, hi: 2 },   // z ochozu do věže
  { x: 1520, y: 1250, w: 160, h: 90,  lo: 1, hi: 2 },
];

export const SPAWNS = [
  { x: 200,  y: 600  }, { x: 3000, y: 600  },
  { x: 200,  y: 1600 }, { x: 3000, y: 1600 },
  { x: 1600, y: 200  }, { x: 1600, y: 2000 },
  { x: 950,  y: 1100 }, { x: 2250, y: 1100 },
  { x: 500,  y: 1100 }, { x: 2700, y: 1100 },
];

// Podstavce, na kterých se střídavě objevují lékárny, zbraně a power-upy.
// Ty na budovách jsou odměna za výstup, ten na vrcholu věže je nejlepší.
export const PADS = [
  { x: 1600, y: 300  },
  { x: 1600, y: 1900 },
  { x: 300,  y: 1100 },
  { x: 2900, y: 1100 },
  { x: 950,  y: 600  },
  { x: 2250, y: 600  },
  { x: 950,  y: 1600 },
  { x: 2250, y: 1600 },

  { x: 550,  y: 430  },   // na SZ budově
  { x: 2650, y: 430  },   // na SV budově
  { x: 550,  y: 1770 },   // na JZ budově
  { x: 2650, y: 1770 },   // na JV budově

  { x: 1600, y: 1100 },   // vrchol věže
];
