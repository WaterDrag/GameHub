// ─────────────────────────────────────────────────────────────
//  UNO No Mercy – pravidla.
//
//  Převzatá z předlohy:
//   • na trest se smí odpovědět jen kartou se STEJNÝM nebo VYŠŠÍM
//     lízáním (+2 → +4 → +6 → +10); barevný trest musí sedět barvou
//   • bez trestu platí barva nebo znak, divoká vždy
//   • kdo lízne nehratelnou kartu, líže dál
//   • kdo lízne hratelnou, smí ji zahrát nebo tah vzdát
//   • 25 karet na ruce = konec, hráč je venku
//   • kdo zapomene říct UNO, dá se nachytat na +2
//
//  Funkce jsou čisté – vrací nový stav a nemění vstup. Míchá se
//  zvenku (server svým RNG), aby to šlo testovat.
// ─────────────────────────────────────────────────────────────
import {
  BARVY, DIVOKA, MILOST, NA_RUKU, trestZa, jeDivoka, novyBalicek,
} from './karty.js';

// ── Nová hra ─────────────────────────────────────────────────
// `balicek` přichází zamíchaný zvenku.
export function novaHra(hracu, balicek, milost = MILOST) {
  const b = [...balicek];
  const ruce = [];
  for (let h = 0; h < hracu; h++) ruce.push(b.splice(0, NA_RUKU));

  // První odhozená karta nesmí být divoká ani trestací – jinak by hra
  // začínala uprostřed souboje, ještě než kdokoliv zahraje.
  let i = b.findIndex(k => !jeDivoka(k) && trestZa(k.z) === 0);
  if (i < 0) i = 0;
  const prvni = b.splice(i, 1)[0];

  return {
    hracu,
    milost,
    balicek: b,
    odhoz: [prvni],
    ruce,
    naTahu: 0,
    smer: 1,
    barva: prvni.b,
    trest: 0,
    lizl: false,           // lízl hratelnou a smí ji zahrát nebo vzdát tah
    musiLizat: false,      // lízl nehratelnou, líže dál
    reklUno: new Array(hracu).fill(false),
    unoOhrozeny: null,     // kdo zapomněl říct UNO
    vyrazeni: [],
    vitez: null,
    hlaska: null,
    tahu: 0,
    akci: 0,
  };
}

export function kopie(s) {
  return {
    ...s,
    balicek: [...s.balicek],
    odhoz: [...s.odhoz],
    ruce: s.ruce.map(r => [...r]),
    reklUno: [...s.reklUno],
    vyrazeni: [...s.vyrazeni],
    hlaska: s.hlaska ? { ...s.hlaska } : null,
  };
}

const rekni = (n, kdo, text) => { n.hlaska = { kdo, text }; };
export const vrch = (s) => s.odhoz[s.odhoz.length - 1];
export const zije = (s, h) => !s.vyrazeni.includes(h);
export const vePrhe = (s) => s.ruce.map(r => r.length);

// ── Smí se ta karta zahrát? ──────────────────────────────────
// Doslova podle předlohy včetně toho, že barevný trest musí sedět
// barvou, kdežto divoký trest se smí přihodit vždycky.
export function lzeHrat(karta, vrchni, barva, trest) {
  const muj = trestZa(karta.z);
  const jeho = trestZa(vrchni.z);
  if (trest > 0) {
    if (muj === 0 || muj < jeho) return false;
    if (jeDivoka(karta)) return true;
    return karta.b === barva;
  }
  if (jeDivoka(karta)) return true;
  return karta.b === barva || karta.z === vrchni.z;
}

// Indexy karet, které smí hráč na tahu zahrát.
export function moznosti(s, hrac = s.naTahu) {
  if (s.vitez !== null || !zije(s, hrac)) return [];
  const v = vrch(s);
  const out = [];
  s.ruce[hrac].forEach((k, i) => {
    if (lzeHrat(k, v, s.barva, s.trest)) out.push(i);
  });
  return out;
}

// ── Posun na dalšího ─────────────────────────────────────────
function dalsi(n, preskoc = 0) {
  const kroku = 1 + preskoc;
  for (let i = 0; i < kroku; i++) {
    let bezpecnost = 0;
    do {
      n.naTahu = (n.naTahu + n.smer + n.hracu) % n.hracu;
    } while (!zije(n, n.naTahu) && ++bezpecnost < n.hracu * 2);
  }
  n.reklUno[n.naTahu] = false;
}

// ── Doplnění balíčku z odhazovacího ──────────────────────────
function doplnit(n) {
  if (n.balicek.length) return;
  const v = n.odhoz.pop();
  n.balicek = n.odhoz;
  n.odhoz = [v];
  // Míchá se posunem – pořadí je stejně dané tím, jak karty padaly,
  // a server má vlastní RNG jen na rozdání. Bez míchání by se balíček
  // vracel v obráceném pořadí, což hráči poznají.
  n.balicek.reverse();
}

function tahni(n, hrac, kolik) {
  for (let i = 0; i < kolik; i++) {
    doplnit(n);
    if (!n.balicek.length) break;      // došly úplně všechny karty
    n.ruce[hrac].push(n.balicek.pop());
  }
}

// ── Milost: 25 karet a končíš ────────────────────────────────
function zkontrolujMilost(n, hrac) {
  if (n.ruce[hrac].length < n.milost) return false;
  n.vyrazeni.push(hrac);

  // Karty vyřazeného se vracejí do hry. Bez toho odejdou ze hry
  // napořád: při šesti a osmi hráčích drželi vyřazení přes osmdesát
  // karet, balíček se vysypal a všichni už jen donekonečna pasovali.
  // Vkládá se POD vrchní kartu, ať se nezmění, co je zrovna ve hře.
  const ruka = n.ruce[hrac];
  n.ruce[hrac] = [];
  if (ruka.length) {
    const v = n.odhoz.pop();
    n.odhoz.push(...ruka);
    if (v) n.odhoz.push(v);
  }

  const zbyva = Array.from({ length: n.hracu }, (_, h) => h).filter(h => zije(n, h));
  if (zbyva.length === 1) n.vitez = zbyva[0];
  return true;
}

// ── Řekni UNO ────────────────────────────────────────────────
export function rekniUno(s, hrac) {
  const n = kopie(s);
  if (n.vitez !== null) return n;
  n.reklUno[hrac] = true;
  n.akci++;
  return n;
}

// ── Nachytej ─────────────────────────────────────────────────
export function nachytej(s, kdo) {
  const n = kopie(s);
  if (n.vitez !== null || n.unoOhrozeny === null) return n;
  if (kdo === n.unoOhrozeny) return n;      // sám sebe nikdo nechytá
  const obet = n.unoOhrozeny;
  tahni(n, obet, 2);
  n.unoOhrozeny = null;
  n.akci++;
  rekni(n, kdo, 'nachytal zapomenuté UNO – dvě karty navíc.');
  zkontrolujMilost(n, obet);
  return n;
}

// ── Zahrání karty ────────────────────────────────────────────
export function zahraj(s, idx, barva = null) {
  const n = kopie(s);
  if (n.vitez !== null) return n;
  const hrac = n.naTahu;
  if (!moznosti(n).includes(idx)) return n;

  const karta = n.ruce[hrac][idx];
  const zvolena = jeDivoka(karta)
    ? (BARVY.includes(barva) ? barva : BARVY[0])
    : karta.b;

  // Kdo zahraje předposlední kartu a neřekl UNO, dá se nachytat.
  n.unoOhrozeny = (n.ruce[hrac].length === 2 && !n.reklUno[hrac]) ? hrac : null;
  n.reklUno[hrac] = false;

  n.ruce[hrac].splice(idx, 1);
  n.odhoz.push(karta);
  n.barva = zvolena;
  n.akci++;
  n.tahu++;
  n.hlaska = null;

  // Prázdná ruka = konec. Efekt karty se pak už neuplatňuje (stejně
  // jako v předloze – hra tím okamžikem končí).
  if (!n.ruce[hrac].length) {
    n.vitez = hrac;
    n.unoOhrozeny = null;
    return n;
  }

  n.trest += trestZa(karta.z);

  if (karta.z === 'obrat') {
    n.smer *= -1;
    // Ve dvou je obrat totéž co stop – jinak by hráč obrátil směr
    // a stejně byl hned zase na tahu ten druhý.
    if (n.hracu - n.vyrazeni.length === 2) dalsi(n);
  }

  if (karta.z === 'vyhod') {
    // Výhoz barvy: z ruky odletí všechny karty té barvy – a putují na
    // odhazovací hromádku. V předloze se prostě smazaly, takže karty
    // ze hry mizely a balíček se vyčerpal; při osmi hráčích se kvůli
    // tomu partie nedohrála. Měření to ukázalo hned (132 karet musí
    // být pořád 132).
    const zbyle = [];
    const odlozene = [];
    for (const k of n.ruce[hrac]) (k.b === karta.b ? odlozene : zbyle).push(k);
    n.ruce[hrac] = zbyle;
    n.odhoz.push(...odlozene);
    const pryc = odlozene.length;
    if (pryc) rekni(n, hrac, `výhoz barvy – odloženo ${pryc} karet.`);
    if (!n.ruce[hrac].length) { n.vitez = hrac; n.unoOhrozeny = null; return n; }
  }

  n.lizl = false;
  n.musiLizat = false;

  if (karta.z === 'stopVsem') {
    // Stop všem = přeskočí se všichni ostatní, takže hraje znovu ten
    // samý hráč. V předloze se tady posouvalo o jednoho, což je totéž
    // jako obyčejná karta – karta tím nedělala vůbec nic.
    rekni(n, hrac, 'stop všem – hraje znovu.');
    return n;
  }

  dalsi(n, karta.z === 'stop' ? 1 : 0);
  return n;
}

// ── Líznutí ──────────────────────────────────────────────────
export function lizni(s) {
  const n = kopie(s);
  if (n.vitez !== null) return n;
  const hrac = n.naTahu;
  n.akci++;
  n.hlaska = null;

  if (n.trest > 0) {
    const kolik = n.trest;
    tahni(n, hrac, kolik);
    n.trest = 0;
    n.lizl = false;
    n.musiLizat = false;
    rekni(n, hrac, `lízl trest +${kolik}.`);
    if (zkontrolujMilost(n, hrac)) {
      if (n.vitez === null && n.naTahu === hrac) dalsi(n);
      return n;
    }
    dalsi(n);
    return n;
  }

  const pred = n.ruce[hrac].length;
  tahni(n, hrac, 1);
  if (n.ruce[hrac].length === pred) {
    // Došly karty úplně – ani balíček, ani odhazovací hromádka. Bez
    // tohohle by hráč, který nemá co hrát a nemá co líznout, zastavil
    // hru napořád. Radši se tah předá dál.
    n.lizl = false;
    n.musiLizat = false;
    rekni(n, hrac, 'nemá co líznout – karty došly.');
    dalsi(n);
    return n;
  }
  const nova = n.ruce[hrac][n.ruce[hrac].length - 1];
  if (nova && lzeHrat(nova, vrch(n), n.barva, 0)) {
    n.lizl = true;               // smí ji zahrát, nebo tah vzdát
    n.musiLizat = false;
  } else {
    n.lizl = false;
    n.musiLizat = true;          // líže dál
    if (zkontrolujMilost(n, hrac)) {
      if (n.vitez === null && n.naTahu === hrac) dalsi(n);
    }
  }
  return n;
}

// ── Vzdání tahu po líznutí ───────────────────────────────────
export function vzdejTah(s) {
  const n = kopie(s);
  if (n.vitez !== null || !n.lizl) return n;
  n.lizl = false;
  n.musiLizat = false;
  n.akci++;
  dalsi(n);
  return n;
}

// ── Stav pro zobrazení ───────────────────────────────────────
export function poradi(s) {
  return Array.from({ length: s.hracu }, (_, h) => h)
    .sort((a, b) => {
      const av = zije(s, a) ? 0 : 1;
      const bv = zije(s, b) ? 0 : 1;
      return av - bv || s.ruce[a].length - s.ruce[b].length;
    });
}
