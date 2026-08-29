// ─────────────────────────────────────────────────────────────
//  Dostihy a sázky – herní data.
//
//  Pole, ceny a nájmy jsou převzaté z původní verze beze změny.
//  Importuje to server (pravidla) i prohlížeč (vykreslení desky).
// ─────────────────────────────────────────────────────────────

export const D = {
  START_MONEY: 30000,
  PASS_START: 4000,
  TURN_MS: 120000,     // po vypršení zahraje bot za tebe (stejně jako IDLE_TAKEOVER_MS)
  MAX_LEVEL: 5,        // 5 = stáj
  // Bez stropu hra prakticky nekončí: stavět smí jen majitel celé
  // skupiny, ta se sejde málokdy, a bez žetonů nájmy nepřebijí
  // příjem 4000 za každé kolo. V simulaci nedoběhl ani jeden z pěti
  // zápasů po 5000 tazích. Po limitu vyhrává nejbohatší.
  MAX_ROUNDS: 40,
  // Nabídka na trhu drží celý trh (víc jich naráz být nesmí). Boti
  // neobchodují, takže zapomenutá nabídka by ho zablokovala napořád.
  TRADE_MS: 90000,
  // Výkupní kurz banky. Každé kolo jiný – jednou dostaneš za kartu 80 %
  // ceny, jindy jen 40 %. Prodávat jde kdykoliv, i mimo vlastní tah,
  // takže se vyplácí počkat si na dobré kolo – pokud máš čas.
  SELL_MIN: 40,
  SELL_MAX: 80,
};

export const TILES = [
  { id: 0,  name: 'START',      type: 'start' },
  { id: 1,  name: 'Fantome',    type: 'horse',   group: 'orange', price: 1200, build: 1000, rent: [100, 500, 1500, 4000, 7000, 12000] },
  { id: 2,  name: 'Finance',    type: 'card' },
  { id: 3,  name: 'Gavora',     type: 'horse',   group: 'orange', price: 1200, build: 1000, rent: [100, 500, 1500, 4000, 7000, 12000] },
  { id: 4,  name: 'Veterina',   type: 'tax',     price: 500 },
  { id: 5,  name: 'Trenér I',   type: 'trainer', price: 4000 },
  { id: 6,  name: 'Lady Anne',  type: 'horse',   group: 'brown',  price: 2000, build: 1500, rent: [200, 1000, 3000, 7000, 11000, 18000] },
  { id: 7,  name: 'Náhoda',     type: 'card' },
  { id: 8,  name: 'Pasek',      type: 'horse',   group: 'brown',  price: 2000, build: 1500, rent: [200, 1000, 3000, 7000, 11000, 18000] },
  { id: 9,  name: 'Koran',      type: 'horse',   group: 'brown',  price: 2400, build: 1500, rent: [300, 1200, 3500, 8000, 13000, 20000] },
  { id: 10, name: 'DISTANC',    type: 'corner' },
  { id: 11, name: 'Neklan',     type: 'horse',   group: 'lblue',  price: 2800, build: 2000, rent: [400, 1500, 4500, 9000, 15000, 24000] },
  { id: 12, name: 'Přeprava',   type: 'service', price: 3000 },
  { id: 13, name: 'Portlancl',  type: 'horse',   group: 'lblue',  price: 2800, build: 2000, rent: [400, 1500, 4500, 9000, 15000, 24000] },
  { id: 14, name: 'Japan',      type: 'horse',   group: 'lblue',  price: 2800, build: 2000, rent: [400, 1500, 4500, 9000, 15000, 24000] },
  { id: 15, name: 'Trenér II',  type: 'trainer', price: 4000 },
  { id: 16, name: 'Kostrava',   type: 'horse',   group: 'lgreen', price: 3600, build: 2500, rent: [500, 2000, 5500, 11000, 18000, 28000] },
  { id: 17, name: 'Finance',    type: 'card' },
  { id: 18, name: 'Lukava',     type: 'horse',   group: 'lgreen', price: 3600, build: 2500, rent: [500, 2000, 5500, 11000, 18000, 28000] },
  { id: 19, name: 'Melák',      type: 'horse',   group: 'lgreen', price: 4000, build: 2500, rent: [600, 2500, 6500, 13000, 21000, 32000] },
  { id: 20, name: 'PARKOVIŠTĚ', type: 'corner' },
  { id: 21, name: 'Grifel',     type: 'horse',   group: 'pink',   price: 4400, build: 3000, rent: [700, 3000, 7500, 15000, 24000, 36000] },
  { id: 22, name: 'Náhoda',     type: 'card' },
  { id: 23, name: 'Mohyla',     type: 'horse',   group: 'pink',   price: 4400, build: 3000, rent: [700, 3000, 7500, 15000, 24000, 36000] },
  { id: 24, name: 'Metál',      type: 'horse',   group: 'pink',   price: 4800, build: 3000, rent: [800, 3500, 8500, 17000, 27000, 40000] },
  { id: 25, name: 'Trenér III', type: 'trainer', price: 4000 },
  { id: 26, name: 'Tara',       type: 'horse',   group: 'yellow', price: 5200, build: 3500, rent: [900, 4000, 10000, 19000, 30000, 45000] },
  { id: 27, name: 'Furioso',    type: 'horse',   group: 'yellow', price: 5200, build: 3500, rent: [900, 4000, 10000, 19000, 30000, 45000] },
  { id: 28, name: 'Stáje',      type: 'service', price: 3000 },
  { id: 29, name: 'Genius',     type: 'horse',   group: 'yellow', price: 5600, build: 3500, rent: [1000, 4500, 11000, 21000, 33000, 50000] },
  { id: 30, name: 'DOPING!',    type: 'corner' },
  { id: 31, name: 'Shagga',     type: 'horse',   group: 'dgreen', price: 6000, build: 4000, rent: [1200, 5000, 13000, 24000, 38000, 55000] },
  { id: 32, name: 'Dahoman',    type: 'horse',   group: 'dgreen', price: 6000, build: 4000, rent: [1200, 5000, 13000, 24000, 38000, 55000] },
  { id: 33, name: 'Finance',    type: 'card' },
  { id: 34, name: 'Gira',       type: 'horse',   group: 'dgreen', price: 6400, build: 4000, rent: [1400, 5500, 15000, 27000, 42000, 60000] },
  { id: 35, name: 'Trenér IV',  type: 'trainer', price: 4000 },
  { id: 36, name: 'Náhoda',     type: 'card' },
  { id: 37, name: 'Narcius',    type: 'horse',   group: 'purple', price: 7000, build: 4500, rent: [1600, 6000, 17000, 30000, 47000, 70000] },
  { id: 38, name: 'Veterina',   type: 'tax',     price: 1000 },
  { id: 39, name: 'Napoli',     type: 'horse',   group: 'purple', price: 8000, build: 4500, rent: [2000, 8000, 20000, 35000, 55000, 85000] },
];

export const GROUP_COLORS = {
  orange: '#d4680a', brown: '#6b3a1f', lblue: '#1565c0', lgreen: '#2e7d32',
  pink: '#ad1457', yellow: '#c8920a', dgreen: '#1b5e20', purple: '#6a1b9a',
  trainer: '#37474f', service: '#263238',
};

export const GROUP_NAMES = {
  orange: 'Oranžová', brown: 'Hnědá', lblue: 'Sv. modrá', lgreen: 'Sv. zelená',
  pink: 'Růžová', yellow: 'Žlutá', dgreen: 'Tm. zelená', purple: 'Fialová',
  trainer: 'Trenér', service: 'Přeprava',
};

export const GROUPS = ['orange', 'brown', 'lblue', 'lgreen', 'pink', 'yellow', 'dgreen', 'purple'];

export const RENT_LABELS = ['Základní', '1 žeton', '2 žetony', '3 žetony', '4 žetony', 'Stáj'];

export const CARDS_FINANCE = [
  { text: 'Mimořádná prémie! Získáváš 2000 DK.', val: 2000 },
  { text: 'Dědictví! Získáváš 1000 DK.', val: 1000 },
  { text: 'Pokuta za rychlou jízdu. Zaplať 500 DK.', val: -500 },
  { text: 'Vyhrál jsi sázku! Získáváš 1500 DK.', val: 1500 },
  { text: 'Daně z luxusu. Zaplať 1000 DK.', val: -1000 },
];

export const CARDS_NAHODA = [
  { text: 'Vrať se na Start. (Získáváš 4000 DK)', pos: 0 },
  { text: 'Jdi na Distanc. Zde tě zdrží a musíš hodit 6.', pos: 10, trapped: true },
  { text: 'Jdi na Parkoviště.', pos: 20 },
  { text: 'Ztratil jsi peněženku! Zaplať 500 DK.', val: -500 },
  { text: 'Našel jsi peníze! Získáváš 500 DK.', val: 500 },
];

export const PLAYER_COLORS = ['#d32f2f', '#1976d2', '#388e3c', '#7b1fa2', '#f57c00', '#00796b'];

// Souřadnice v mřížce 11×11 – pole 0 je vpravo dole a jde se proti směru.
export function gridPos(id) {
  if (id <= 10) return { col: 11 - id, row: 11 };
  if (id <= 20) return { col: 1, row: 21 - id };
  if (id <= 30) return { col: id - 19, row: 1 };
  return { col: 11, row: id - 29 };
}
