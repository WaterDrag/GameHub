// ─────────────────────────────────────────────────────────────
//  Kvak! – rybník 8×8, žabí královny a jejich poddaní.
//
//  Deska je 64 kartiček lícem dolů. Kdo přijde o královnu nebo se
//  nemůže hnout, končí; vyhrává poslední živá královna.
//
//  Kartičky a jejich efekty zadal uživatel 1. 9. 2026 – tahle sada
//  platí, ne dřívější textová pravidla (podle nich královna štiku
//  přežila a leknín se přeskakoval na jiný leknín).
// ─────────────────────────────────────────────────────────────

export const STRANA = 8;
export const POLI = STRANA * STRANA;

// Kolik tahů smí běžet bez pokroku, než rybník vyschne.
// Dvě královny na 8×8 se umí navždy uhýbat – naměřeno: bez tohohle
// stropu se partie přehazovaly mezi dvěma poli donekonečna.
// Pokrok = otočená nová kartička, vyhozená žába nebo rozmnožení.
export const BEZ_POKROKU = 40;

// Samečci jsou ČTYŘI DRUHY a každý dá každé královně jednu žabku.
// Tím je zásoba každého hráče přesně 4 – žádné zvláštní počítadlo.
export const SAMCI = ['samec1', 'samec2', 'samec3', 'samec4'];

// Dva druhy vody. Je to RUB kartičky, takže to vidí každý už před
// otočením: ve špinavé může číhat štika, v čisté nikdy.
// Všech osm štik se rozdá do špinavé, takže je tam riziko ~31 %,
// zatímco čistá voda je pro královnu úplně bezpečná.
export const PODIL_SPINAVE = 0.4;
export const CISTA = 'cista';
export const SPINAVA = 'spinava';

export const KARTY = {
  rakos: { nazev: 'Rákos', emoji: '🌿', popis: 'Obyčejné pole, nic se neděje.' },
  leknin: { nazev: 'Leknín', emoji: '🌸', popis: 'Tah navíc, ale JINOU žábou.' },
  komar: { nazev: 'Komár', emoji: '🦟', popis: 'Tah navíc – touž žábou, co na něj šlápla.' },
  stika: { nazev: 'Štika', emoji: '🦈', popis: 'Sežere žábu i královnu.' },
  klada: { nazev: 'Kláda', emoji: '🪵', popis: 'Vejdou se dvě vlastní žáby. Ve dvou je nikdo nesebere.' },
  samec1: { nazev: 'Modrý sameček', emoji: '💙', popis: 'Královně přidá žabku. Každý sameček jednou.' },
  samec2: { nazev: 'Zelený sameček', emoji: '💚', popis: 'Královně přidá žabku. Každý sameček jednou.' },
  samec3: { nazev: 'Žlutý sameček', emoji: '💛', popis: 'Královně přidá žabku. Každý sameček jednou.' },
  samec4: { nazev: 'Fialový sameček', emoji: '💜', popis: 'Královně přidá žabku. Každý sameček jednou.' },
};

// Do legendy stačí jeden sameček za všechny čtyři.
export const LEGENDA = ['rakos', 'leknin', 'komar', 'stika', 'klada', 'samec1'];

export const DRUHY = Object.keys(KARTY);

// 64 kartiček. Rákosu je nejvíc – je to obyčejné pole, na kterém
// se nic neděje, a deska nesmí být samý efekt.
export const SLOZENI = {
  rakos: 20,
  leknin: 12,
  komar: 10,
  klada: 10,
  stika: 8,
  samec1: 1,
  samec2: 1,
  samec3: 1,
  samec4: 1,
};

// Kolik vlastních žab se na kartičku vejde. Na kládě a u samečka dvě,
// jinde jedna. (U samečka proto, že nová žabka vzniká POD královnou.)
export const KAPACITA = (druh) => (druh === 'klada' || jeSamec(druh) ? 2 : 1);

export const jeSamec = (druh) => !!druh && druh.startsWith('samec');

// Startovní pole: roh + dvě sousední kartičky na kraji.
// Dva hráči si sednou naproti sobě, tři a čtyři doplní zbylé rohy.
export const STARTY = [
  [[0, 0], [0, 1], [1, 0]],
  [[7, 7], [7, 6], [6, 7]],
  [[0, 7], [0, 6], [1, 7]],
  [[7, 0], [7, 1], [6, 0]],
];

export const BARVY = ['#ff2d55', '#38bdf8', '#ffffff', '#c084fc'];

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
// Kdyby na rohu ležela štika, stála by na ní žába hned od začátku.
//  Vrací { pole, voda }. Štiky smějí ležet JEN ve špinavé vodě – to je
//  celý smysl dvou rubů. Startovní pole jsou čistá a bezpečná.
export function novaDeska(rng, hracu) {
  const balicek = [];
  for (const [druh, kolik] of Object.entries(SLOZENI)) {
    for (let i = 0; i < kolik; i++) balicek.push(druh);
  }

  const startovni = new Set();
  for (let h = 0; h < hracu; h++) {
    for (const [r, c] of STARTY[h]) startovni.add(index(r, c));
  }

  // Která pole jsou špinavá. Startovní nikdy.
  const volna = [];
  for (let i = 0; i < POLI; i++) if (!startovni.has(i)) volna.push(i);
  const kolikSpinave = Math.round(POLI * PODIL_SPINAVE);
  const spinava = new Set(rng.shuffle(volna).slice(0, kolikSpinave));

  const voda = Array.from({ length: POLI }, (_, i) => (spinava.has(i) ? SPINAVA : CISTA));

  // Míchá se JEDNOU a pak se dělí – kdyby se startovní pole brala
  // z jedné kopie a zbytek z druhé, změnil by se poměr kartiček.
  const stiky = balicek.filter(d => d === 'stika');
  const bezStik = rng.shuffle(balicek.filter(d => d !== 'stika'));
  const cisteRakosy = bezStik.filter(d => d === 'rakos');
  const naStart = cisteRakosy.slice(0, startovni.size);

  // Zbylé kartičky kromě štik; štiky se pak dosadí jen do špinavých.
  const naStartPocet = {};
  for (const d of naStart) naStartPocet[d] = (naStartPocet[d] || 0) + 1;
  const zbytek = [];
  for (const d of bezStik) {
    if (naStartPocet[d]) { naStartPocet[d]--; continue; }
    zbytek.push(d);
  }
  const smichany = rng.shuffle(zbytek);

  const pole = new Array(POLI).fill(null);
  let iS = 0;
  // Nejdřív štiky do náhodných špinavých polí.
  for (const i of rng.shuffle([...spinava]).slice(0, stiky.length)) pole[i] = 'stika';
  // Pak starty, pak všechno ostatní.
  for (const i of startovni) pole[i] = naStart[iS++];
  let iZ = 0;
  for (let i = 0; i < POLI; i++) if (pole[i] === null) pole[i] = smichany[iZ++];

  return { pole, voda };
}
