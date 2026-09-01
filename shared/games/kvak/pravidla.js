// ─────────────────────────────────────────────────────────────
//  Kvak! – pravidla. Čisté funkce, náhoda leze zvenčí.
//
//  Efekty kartiček zadal uživatel 1. 9. 2026 a platí přesně tyhle:
//    • Rákos    – nic zvláštního
//    • Komár    – tah navíc, kteroukoliv žábou
//    • Leknín   – tah navíc, ale JINOU žábou
//    • Štika    – sežere žábu i královnu
//    • Kláda    – vejdou se dvě vlastní žáby; ve dvou je nikdo nesebere
//    • Sameček  – čtyři druhy, každý dá každé královně jednu žabku.
//                 Vzniká POD královnou a příští tah se s ní musí hrát.
//
//  Efekty platí při KAŽDÉM vstupu, ne jen při prvním otočení
//  (výslovné přání: „platí pořád, ne jen na první“).
//
//  Vlastní rozhodnutí tam, kde zadání mlčí:
//    • na jedno pole se vejde jedna vlastní žába (kláda a sameček dvě)
//    • na kládu, kde stojí dvě soupeřovy žáby, se nedá vstoupit
//    • po 40 tazích bez pokroku rybník vyschne – dvě královny se na
//      8×8 umí uhýbat navždy (naměřeno)
// ─────────────────────────────────────────────────────────────
import {
  POLI, BEZ_POKROKU, SAMCI, STARTY, KAPACITA, jeSamec,
  klic, rozklic, index, naDesce, sousedi, novaDeska,
} from './const.js';

const kopie = (s) => {
  const n = JSON.parse(JSON.stringify(s));
  n.hlaska = null;   // hláška patří k jedné akci, ne k celému stavu
  return n;
};

const rekni = (n, text) => {
  n.hlaska = text;
  n.log.push(text);
  if (n.log.length > 60) n.log.shift();
};

const jmeno = (h) => `Hráč ${h + 1}`;

// ── Nová hra ─────────────────────────────────────────────────
export function novaHra(hracu, rng) {
  const s = {
    hracu,
    pole: novaDeska(rng, hracu),
    odhaleno: new Array(POLI).fill(false),
    zaby: {},
    hraci: Array.from({ length: hracu }, () => ({
      zije: true,
      // Který sameček už pro tuhle královnu plodil.
      plodil: Object.fromEntries(SAMCI.map(x => [x, false])),
    })),
    naTahu: 0,
    // Nová žabka od samečka musí příští tah táhnout.
    nucena: Array.from({ length: hracu }, () => null),
    // Leknín dává tah navíc, ale ne tou žábou, co na něm stojí.
    lekninBlok: null,
    // Kartičky, které už v TOMHLE tahu daly tah navíc. Komár a leknín
    // platí po celou hru, ale dvě sousední by jinak šly milkovat donekonečna:
    // žába by mezi nimi skákala a tah by nikdy neskončil (naměřeno –
    // partie se zastavovaly na stropu 4000 kroků).
    pouzito: [],
    // Odkud kdo naposled skočil – bot se pak nevrací a nezacyklí se.
    minule: Array.from({ length: hracu }, () => null),
    vitez: null,
    log: [],
    hlaska: null,
    bezPokroku: 0,
    pokrok: false,
    akci: 0,
  };

  for (let h = 0; h < hracu; h++) {
    STARTY[h].forEach(([r, c], i) => {
      s.zaby[klic(r, c)] = [{ hrac: h, kralovna: i === 0 }];
      s.odhaleno[index(r, c)] = true;
    });
  }
  rekni(s, 'Rybník je připravený. Kvak!');
  return s;
}

// ── Dotazy na stav ───────────────────────────────────────────
export const zabyNa = (s, r, c) => s.zaby[klic(r, c)] || [];
export const mojeZabyNa = (s, h, r, c) => zabyNa(s, r, c).filter(z => z.hrac === h);
export const druhNa = (s, r, c) => s.pole[index(r, c)];

export function vsechnyZaby(s, h) {
  const out = [];
  for (const [k, seznam] of Object.entries(s.zaby)) {
    const [r, c] = rozklic(k);
    for (const z of seznam) if (z.hrac === h) out.push({ r, c, kralovna: z.kralovna });
  }
  return out;
}

export const maKralovnu = (s, h) => vsechnyZaby(s, h).some(z => z.kralovna);

// Smí žába hráče `h` vstoupit na (r,c)?
export function lzeVstoupit(s, h, r, c) {
  const druh = druhNa(s, r, c);
  const seznam = zabyNa(s, r, c);
  if (seznam.filter(z => z.hrac === h).length >= KAPACITA(druh)) return false;

  // Na kládě se dvěma soupeřovými žábami se nedá nic dělat – drží se
  // navzájem. S jednou se to bere normálně.
  if (druh === 'klada') {
    const podle = {};
    for (const z of seznam) if (z.hrac !== h) podle[z.hrac] = (podle[z.hrac] || 0) + 1;
    if (Object.values(podle).some(n => n >= 2)) return false;
  }
  return true;
}

// Kterou žábou se teď smí hrát. Nucený tah po rozmnožení přebíjí
// všechno; leknín naopak jednu žábu zakazuje.
export function lzeHrat(s, h, r, c) {
  const k = klic(r, c);
  if (s.nucena[h]) return s.nucena[h] === k;
  if (s.lekninBlok === k) return false;
  return true;
}

export function kamMuze(s, h, r, c) {
  if (!lzeHrat(s, h, r, c)) return [];
  return sousedi(r, c).filter(([nr, nc]) => lzeVstoupit(s, h, nr, nc));
}

export function tahy(s, h = s.naTahu) {
  const out = [];
  for (const z of vsechnyZaby(s, h)) {
    for (const na of kamMuze(s, h, z.r, z.c)) out.push({ z, na });
  }
  return out;
}

// ── Pomocné operace nad žábami ───────────────────────────────
function seber(n, r, c, h, kralovna) {
  const k = klic(r, c);
  const seznam = n.zaby[k] || [];
  const i = seznam.findIndex(z => z.hrac === h && z.kralovna === kralovna);
  if (i < 0) return null;
  const [z] = seznam.splice(i, 1);
  if (!seznam.length) delete n.zaby[k];
  return z;
}

function poloz(n, r, c, zaba) {
  const k = klic(r, c);
  if (!n.zaby[k]) n.zaby[k] = [];
  n.zaby[k].push(zaba);
}

function vyrad(n, h, duvod) {
  if (!n.hraci[h].zije) return;
  n.hraci[h].zije = false;
  n.nucena[h] = null;
  for (const k of Object.keys(n.zaby)) {
    n.zaby[k] = n.zaby[k].filter(z => z.hrac !== h);
    if (!n.zaby[k].length) delete n.zaby[k];
  }
  rekni(n, `${jmeno(h)} ${duvod}`);
}

// ── Konec tahu ───────────────────────────────────────────────
function dalsi(n) {
  n.lekninBlok = null;
  n.pouzito = [];
  n.bezPokroku = n.pokrok ? 0 : n.bezPokroku + 1;
  n.pokrok = false;

  for (let i = 0; i < n.hracu + 1; i++) {
    n.naTahu = (n.naTahu + 1) % n.hracu;
    if (!n.hraci[n.naTahu].zije) continue;
    if (tahy(n, n.naTahu).length) break;
    // Nucená žabka se nemá kam hnout – ať kvůli ní hráč nevypadne,
    // nucení se zruší a zkusí se to znovu se všemi.
    if (n.nucena[n.naTahu]) {
      n.nucena[n.naTahu] = null;
      if (tahy(n, n.naTahu).length) break;
    }
    vyrad(n, n.naTahu, 'nemá kam skočit a končí.');
  }
  dohrano(n);
}

// Rybník vyschl. Rozhoduje se ve třech krocích, ať remíza zůstane
// poslední možností: počet žab (královna za dvě), pak kolik se komu
// podařilo vyplodit, pak tlak na cizí královny.
function skore(n, h) {
  const zaby = vsechnyZaby(n, h);
  const vyplozeno = SAMCI.filter(x => n.hraci[h].plodil[x]).length;
  let tlak = 0;
  for (const z of zaby) {
    if (z.kralovna) continue;
    for (const [nr, nc] of sousedi(z.r, z.c)) {
      for (const c of zabyNa(n, nr, nc)) {
        if (c.hrac !== h && c.kralovna && n.hraci[c.hrac].zije) tlak++;
      }
    }
  }
  return [zaby.length + zaby.filter(z => z.kralovna).length, vyplozeno, tlak];
}

function vyschlo(n) {
  let nej = -1, nejS = null, remiza = false;
  for (let h = 0; h < n.hracu; h++) {
    if (!n.hraci[h].zije) continue;
    const sc = skore(n, h);
    const cmp = nejS === null ? 1 : (sc[0] - nejS[0]) || (sc[1] - nejS[1]) || (sc[2] - nejS[2]);
    if (cmp > 0) { nejS = sc; nej = h; remiza = false; }
    else if (cmp === 0) remiza = true;
  }
  n.vitez = remiza || nej < 0 ? -1 : nej;
  rekni(n, remiza || nej < 0
    ? 'Rybník vyschl – remíza.'
    : `Rybník vyschl. Nejvíc žab má ${jmeno(nej)} – vyhrává!`);
}

function dohrano(n) {
  const zivi = [];
  for (let h = 0; h < n.hracu; h++) {
    if (!n.hraci[h].zije) continue;
    if (!maKralovnu(n, h)) { vyrad(n, h, 'přišel o královnu.'); continue; }
    zivi.push(h);
  }
  if (zivi.length <= 1) {
    n.vitez = zivi.length === 1 ? zivi[0] : -1;
    rekni(n, zivi.length === 1 ? `${jmeno(zivi[0])} vyhrál!` : 'Remíza – rybník je prázdný.');
    return;
  }
  if (n.bezPokroku >= BEZ_POKROKU) vyschlo(n);
}

// ── Efekt kartičky ───────────────────────────────────────────
//  Vrací true, když tah pokračuje (komár, leknín).
function efekt(n, h, r, c, kralovna) {
  const druh = druhNa(n, r, c);

  if (druh === 'stika') {
    // Sežere každého – žabku i královnu.
    seber(n, r, c, h, kralovna);
    n.pokrok = true;
    rekni(n, kralovna
      ? `Štika sežrala královnu hráče ${h + 1}!`
      : `Štika sežrala žabku hráče ${h + 1}.`);
    if (kralovna) vyrad(n, h, 'přišel o královnu.');
    return false;
  }

  if (druh === 'komar' || druh === 'leknin') {
    const k = klic(r, c);
    if (n.pouzito.includes(k)) return false;   // v tomhle tahu už dala
    n.pouzito.push(k);

    if (druh === 'komar') {
      if (!tahy(n, h).length) {
        rekni(n, 'Komár, ale žádná žába už nemá kam.');
        return false;
      }
      rekni(n, 'Komár! Táhneš ještě jednou.');
      return true;
    }

    // Leknín: tah navíc, ale jinou žábou. Když jinou nemám, tah končí.
    const drive = n.lekninBlok;
    n.lekninBlok = k;
    if (!tahy(n, h).length) {
      n.lekninBlok = drive;
      rekni(n, 'Leknín, ale jinou žábou se táhnout nedá.');
      return false;
    }
    rekni(n, 'Leknín! Tah navíc, ale jinou žábou.');
    return true;
  }

  if (jeSamec(druh) && kralovna) {
    if (n.hraci[h].plodil[druh]) return false;   // tenhle sameček už pro mě plodil
    // Nová žabka vzniká POD královnou, takže se tam musí vejít. Když už
    // na samečkovi jedna moje stála, byly by tři – a strop je dva.
    if (zabyNa(n, r, c).length >= KAPACITA(druh)) {
      rekni(n, 'Sameček, ale na kartičce už není místo.');
      return false;
    }
    n.hraci[h].plodil[druh] = true;
    poloz(n, r, c, { hrac: h, kralovna: false });
    n.nucena[h] = klic(r, c);
    n.pokrok = true;
    rekni(n, `${jmeno(h)} má novou žabku – příští tah musí táhnout ona.`);
    return false;
  }

  return false;
}

// Vyhodí soupeřovy žáby z pole. Dvě na kládě se sem nedostanou –
// tam se ani nesmí vstoupit.
function vyhod(n, h, r, c) {
  const cizi = (n.zaby[klic(r, c)] || []).filter(z => z.hrac !== h);
  for (const z of cizi) {
    n.pokrok = true;
    seber(n, r, c, z.hrac, z.kralovna);
    rekni(n, z.kralovna
      ? `${jmeno(h)} sežral královnu hráče ${z.hrac + 1}!`
      : `${jmeno(h)} sežral žabku hráče ${z.hrac + 1}.`);
    if (z.kralovna) vyrad(n, z.hrac, 'přišel o královnu.');
  }
}

// ── Tah ──────────────────────────────────────────────────────
export function tah(s, zR, zC, kralovna, naR, naC) {
  const n = kopie(s);
  const h = n.naTahu;
  if (n.vitez !== null) return n;
  if (!naDesce(zR, zC) || !naDesce(naR, naC)) return n;
  if (!mojeZabyNa(n, h, zR, zC).some(z => z.kralovna === kralovna)) return n;
  if (!kamMuze(n, h, zR, zC).some(([r, c]) => r === naR && c === naC)) return n;

  const zaba = seber(n, zR, zC, h, kralovna);
  if (!zaba) return n;

  const i = index(naR, naC);
  n.minule[h] = klic(zR, zC);
  if (!n.odhaleno[i]) n.pokrok = true;
  n.odhaleno[i] = true;

  vyhod(n, h, naR, naC);
  poloz(n, naR, naC, zaba);
  n.akci++;

  // Nucený tah je splněný, jakmile se tou žabkou hnulo.
  if (n.nucena[h] === klic(zR, zC)) n.nucena[h] = null;

  const pokracuje = efekt(n, h, naR, naC, kralovna);
  if (!pokracuje) dalsi(n);
  else dohrano(n);
  return n;
}

// Nouzový ventil: předat tah dál. Nemělo by se stát, ale radši
// to než nekonečná smyčka na serveru.
export function preskoc(s) {
  const n = kopie(s);
  if (n.vitez !== null) return n;
  n.akci++;
  dalsi(n);
  return n;
}
