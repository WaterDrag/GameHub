// ─────────────────────────────────────────────────────────────
//  Lodě pro čtyři – pravidla. Čisté funkce, náhoda leze zvenčí.
//
//  Dvě fáze: `rozmisteni` (všichni naráz) a `bitva` (po tazích).
//
//  Vědomé odchylky od předlohy, všechny doložené měřením
//  v `tools/test-lode.mjs`:
//
//    • Deska roste s počtem hráčů. Při pevných 9×9 měli čtyři hráči
//      obsazeno 59 % polí – slepá rána trefovala častěji než míjela.
//    • Zásah dává ránu navíc, ale nejvýš tři rány za tah. Bez stropu
//      první hráč řetězil rány přes půl moře.
//    • Na vlastní loď střílet JDE. Zkusil jsem to zakázat a nemělo to
//      dvě vady: (1) hra se zablokovala, když zbylo poslední pole,
//      na kterém měli loď všichni čtyři – nikdo na ně nesměl a tah se
//      přehazoval donekonečna (naměřeno, 7 partijí z 20); (2) prozrazovalo
//      by to informaci: kdyby šlo střílet na moje pole, znamenalo by to,
//      že tam má loď i někdo jiný. Vlastní lodě hráč vidí, takže klik
//      do ní je jeho rozhodnutí.
//    • Speciální střely podražily (bomba 3→4, řádek 5→7): na husté
//      desce sebraly víc, než stály.
// ─────────────────────────────────────────────────────────────
import {
  LODE, POLI_LODI, STRANA, STRELY, RAN_ZA_TAH,
  idx, naDesce, poleLodi, nahodneRozmisteni,
} from './const.js';

const kopie = (s) => {
  const n = JSON.parse(JSON.stringify(s));
  n.hlaska = null;
  return n;
};

const rekni = (n, text) => {
  n.hlaska = text;
  n.log.push(text);
  if (n.log.length > 60) n.log.shift();
};

const jmeno = (h) => `Hráč ${h + 1}`;

// ── Nová hra ─────────────────────────────────────────────────
export function novaHra(hracu) {
  const strana = STRANA(hracu);
  return {
    hracu,
    strana,
    // Lodě každého hráče: pole lodí, každá pole polí {x,y}.
    lode: Array.from({ length: hracu }, () => null),
    // Které segmenty ještě stojí.
    zdrave: Array.from({ length: hracu }, () => null),
    hotovo: Array.from({ length: hracu }, () => false),   // rozmístil?
    zije: Array.from({ length: hracu }, () => true),
    body: Array.from({ length: hracu }, () => 0),
    zasahu: Array.from({ length: hracu }, () => 0),       // kolik segmentů sestřelil
    poradiVyrazeni: Array.from({ length: hracu }, () => null),
    vyrazeno: 0,

    strileno: new Array(strana * strana).fill(false),
    // Kdo v tom poli schytal zásah – až po výstřelu, jinak je to tajné.
    zasazeni: {},         // "x,y" -> [hrac, ...]

    faze: 'rozmisteni',
    naTahu: 0,
    ranZbyva: RAN_ZA_TAH,
    kolo: 1,
    vitez: null,
    log: [],
    hlaska: null,
    akci: 0,
  };
}

// ── Dotazy ───────────────────────────────────────────────────
export const lodNaPoli = (s, h, x, y) =>
  !!s.lode[h] && s.lode[h].some(l => l.some(p => p.x === x && p.y === y));

export function ziviNaPoli(s, x, y) {
  const out = [];
  for (let h = 0; h < s.hracu; h++) {
    if (!s.zije[h] || !s.lode[h]) continue;
    if (lodNaPoli(s, h, x, y)) out.push(h);
  }
  return out;
}

export function zbyvaSegmentu(s, h) {
  if (!s.zdrave[h]) return 0;
  return s.zdrave[h].reduce((a, l) => a + l.filter(Boolean).length, 0);
}

// Kolik celých lodí ještě plave.
export function zbyvaLodi(s, h) {
  if (!s.zdrave[h]) return 0;
  return s.zdrave[h].filter(l => l.some(Boolean)).length;
}

// Která pole střela zasáhne.
export function cile(s, typ, x, y) {
  const out = [];
  const push = (cx, cy) => { if (naDesce(s.strana, cx, cy)) out.push({ x: cx, y: cy }); };
  if (typ === 'bomba') {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) push(x + dx, y + dy);
  } else if (typ === 'radek') {
    for (let i = 0; i < s.strana; i++) push(i, y);
  } else if (typ === 'sloupec') {
    for (let i = 0; i < s.strana; i++) push(x, i);
  } else {
    push(x, y);
  }
  return out;
}

// Smí hráč `h` teď vystřelit typem `typ` na (x,y)?
export function lzeStrelit(s, h, typ, x, y) {
  if (s.vitez !== null || s.faze !== 'bitva') return false;
  if (s.naTahu !== h || !s.zije[h]) return false;
  if (!STRELY[typ]) return false;
  if (s.body[h] < STRELY[typ].cena) return false;
  if (!naDesce(s.strana, x, y)) return false;

  const c = cile(s, typ, x, y).filter(p => !s.strileno[idx(s.strana, p.x, p.y)]);
  return c.length > 0;                               // všechno už prostřílené = nic
}

export function moznaPole(s, h, typ = 'normal') {
  const out = [];
  if (s.faze !== 'bitva' || s.naTahu !== h) return out;
  for (let y = 0; y < s.strana; y++) {
    for (let x = 0; x < s.strana; x++) if (lzeStrelit(s, h, typ, x, y)) out.push({ x, y });
  }
  return out;
}

// ── Rozmístění ───────────────────────────────────────────────
//  `lode` = pole lodí ve stejném pořadí jako `LODE`.
export function rozmisti(s, h, lode) {
  const n = kopie(s);
  if (n.faze !== 'rozmisteni' || n.hotovo[h]) return n;
  if (!Array.isArray(lode) || lode.length !== LODE.length) return n;

  const obsazeno = new Set();
  for (let i = 0; i < LODE.length; i++) {
    const l = lode[i];
    if (!Array.isArray(l) || l.length !== LODE[i].delka) return n;
    // Musí to být souvislá rovná čára a nesmí se křížit s vlastními.
    const svisle = l.length === 1 || l[0].x === l[1].x;
    const ocekavane = poleLodi(n.strana, l[0].x, l[0].y, LODE[i].delka, svisle);
    if (!ocekavane) return n;
    for (let j = 0; j < l.length; j++) {
      if (l[j].x !== ocekavane[j].x || l[j].y !== ocekavane[j].y) return n;
      const k = `${l[j].x},${l[j].y}`;
      if (obsazeno.has(k)) return n;
      obsazeno.add(k);
    }
  }

  n.lode[h] = lode.map(l => l.map(p => ({ x: p.x, y: p.y })));
  n.zdrave[h] = lode.map(l => l.map(() => true));
  n.hotovo[h] = true;
  n.akci++;
  rekni(n, `${jmeno(h)} rozmístil lodě.`);

  if (n.hotovo.every(Boolean)) {
    n.faze = 'bitva';
    n.naTahu = 0;
    n.ranZbyva = RAN_ZA_TAH;
    rekni(n, 'Všichni jsou připraveni. Pal!');
  }
  return n;
}

// ── Konec tahu ───────────────────────────────────────────────
function dalsi(n) {
  n.ranZbyva = RAN_ZA_TAH;
  for (let i = 0; i < n.hracu + 1; i++) {
    const pred = n.naTahu;
    n.naTahu = (n.naTahu + 1) % n.hracu;
    if (n.naTahu <= pred) n.kolo++;
    if (n.zije[n.naTahu]) break;
  }
}

function vyrad(n, h) {
  if (!n.zije[h]) return;
  n.zije[h] = false;
  n.poradiVyrazeni[h] = n.vyrazeno++;
  rekni(n, `${jmeno(h)} přišel o poslední loď a končí.`);
}

function dohrano(n) {
  const zivi = [];
  for (let h = 0; h < n.hracu; h++) if (n.zije[h]) zivi.push(h);
  if (zivi.length <= 1) {
    n.vitez = zivi.length === 1 ? zivi[0] : -1;
    if (zivi.length === 1) n.poradiVyrazeni[zivi[0]] = n.vyrazeno++;
    n.faze = 'konec';
    rekni(n, zivi.length === 1 ? `${jmeno(zivi[0])} zůstal na moři sám a vyhrává!` : 'Moře je prázdné – remíza.');
    return true;
  }
  return false;
}

// ── Výstřel ──────────────────────────────────────────────────
export function strel(s, typ, x, y) {
  const n = kopie(s);
  const h = n.naTahu;
  if (!lzeStrelit(n, h, typ, x, y)) return n;

  n.body[h] -= STRELY[typ].cena;
  n.akci++;

  const zasazenoPoli = [];
  let segmentu = 0;
  for (const p of cile(n, typ, x, y)) {
    const i = idx(n.strana, p.x, p.y);
    if (n.strileno[i]) continue;
    n.strileno[i] = true;

    const trefeni = ziviNaPoli(n, p.x, p.y);
    if (!trefeni.length) continue;
    n.zasazeni[`${p.x},${p.y}`] = trefeni;
    zasazenoPoli.push(p);

    for (const cil of trefeni) {
      n.lode[cil].forEach((l, li) => l.forEach((c, ci) => {
        if (c.x === p.x && c.y === p.y && n.zdrave[cil][li][ci]) {
          n.zdrave[cil][li][ci] = false;
          segmentu++;
        }
      }));
    }
  }

  n.body[h] += segmentu;
  n.zasahu[h] += segmentu;

  if (segmentu) {
    rekni(n, `${jmeno(h)} zasáhl ${segmentu}× (${STRELY[typ].nazev.toLowerCase()}).`);
  } else {
    rekni(n, `${jmeno(h)} minul.`);
  }

  // Kdo přišel o všechno, končí.
  for (let c = 0; c < n.hracu; c++) if (n.zije[c] && n.lode[c] && zbyvaSegmentu(n, c) === 0) vyrad(n, c);
  if (dohrano(n)) return n;

  // Zásah dává ránu navíc – ale jen do stropu.
  if (segmentu > 0) {
    n.ranZbyva--;
    if (n.ranZbyva > 0) {
      rekni(n, `Zásah! ${jmeno(h)} střílí znovu (zbývá ${n.ranZbyva}).`);
      return n;
    }
    rekni(n, 'Tři rány v tahu jsou strop, tah končí.');
  }
  dalsi(n);
  return n;
}

// Vzdát zbytek tahu (třeba když už není kam střílet).
export function konecTahu(s) {
  const n = kopie(s);
  if (n.vitez !== null || n.faze !== 'bitva') return n;
  n.akci++;
  dalsi(n);
  return n;
}

// Náhodné rozmístění pro toho, kdo si nechce hrát s mřížkou.
export function rozmistiNahodne(s, h, rng) {
  const lode = nahodneRozmisteni(s.strana, rng);
  return lode ? rozmisti(s, h, lode) : s;
}
