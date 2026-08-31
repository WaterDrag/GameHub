// ─────────────────────────────────────────────────────────────
//  UNO No Mercy – pravidla.
//
//  Podle oficiálních pravidel, ne podle předlohy – ta měla několik věcí
//  jinak nebo vůbec. Rozdíly jsou popsané u jednotlivých míst.
//
//   • tresty se sčítají, přihodit smíš jen STEJNOU NEBO VYŠŠÍ hodnotu
//   • kdo nemá co hrát, líže dokud nevytáhne hratelnou – tu MUSÍ zahrát
//   • 0 = všichni posílají ruku dál, 7 = výměna ruky s vybraným hráčem
//   • ruleta: další hráč líže, dokud nevytáhne zvolenou barvu
//   • 25 karet na ruce = konec, karty se odloží zpátky do hry
//   • kdo zapomene říct UNO, dá se nachytat na +2
//
//  Funkce jsou čisté – vrací nový stav a nemění vstup. Míchá se
//  zvenku (server svým RNG), aby to šlo testovat.
// ─────────────────────────────────────────────────────────────
import {
  BARVY, MILOST, NA_RUKU, trestZa, jeDivoka,
  POSLI_RUKY, VYMEN_RUKY,
} from './karty.js';

// ── Nová hra ─────────────────────────────────────────────────
// `balicek` přichází zamíchaný zvenku.
export function novaHra(hracu, balicek, milost = MILOST) {
  const b = [...balicek];
  const ruce = [];
  for (let h = 0; h < hracu; h++) ruce.push(b.splice(0, NA_RUKU));

  // První odhozená karta nesmí být divoká ani nic s okamžitým efektem –
  // jinak by hra začínala uprostřed akce, než kdokoliv zahraje.
  let i = b.findIndex(k => !jeDivoka(k) && trestZa(k.z) === 0
    && k.z !== POSLI_RUKY && k.z !== VYMEN_RUKY);
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
    musiLizat: false,      // lízl nehratelnou, líže dál
    musiZahrat: null,      // lízl hratelnou – právě tu musí zahrát
    vymena: null,          // {hrac} – zahrál sedmičku a vybírá protějšek
    reklUno: new Array(hracu).fill(false),
    unoOhrozeny: null,
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
    vymena: s.vymena ? { ...s.vymena } : null,
    hlaska: s.hlaska ? { ...s.hlaska } : null,
  };
}

const rekni = (n, kdo, text) => { n.hlaska = { kdo, text }; };
export const vrch = (s) => s.odhoz[s.odhoz.length - 1];
export const zije = (s, h) => !s.vyrazeni.includes(h);
export const zivi = (s) => Array.from({ length: s.hracu }, (_, h) => h).filter(h => zije(s, h));

// ── Smí se ta karta zahrát? ──────────────────────────────────
//  Na trest se smí odpovědět jen kartou se stejnou nebo vyšší hodnotou.
//  Barva se přitom NEŘEŠÍ – předloha u barevných trestů vyžadovala
//  i shodu barvy, oficiální pravidla mluví jen o hodnotě.
export function lzeHrat(karta, vrchni, barva, trest) {
  const muj = trestZa(karta.z);
  const jeho = trestZa(vrchni.z);
  if (trest > 0) return muj > 0 && muj >= jeho;
  if (jeDivoka(karta)) return true;
  return karta.b === barva || karta.z === vrchni.z;
}

// Indexy karet, které smí hráč na tahu zahrát.
export function moznosti(s, hrac = s.naTahu) {
  if (s.vitez !== null || s.vymena || !zije(s, hrac)) return [];
  // Po líznutí hratelné karty se musí zahrát právě ta.
  if (s.musiZahrat !== null) return hrac === s.naTahu ? [s.musiZahrat] : [];
  const v = vrch(s);
  const out = [];
  s.ruce[hrac].forEach((k, i) => {
    if (lzeHrat(k, v, s.barva, s.trest)) out.push(i);
  });
  return out;
}

// Koho si smí hráč vybrat na výměnu ruky.
export function cileVymeny(s, hrac = s.vymena?.hrac) {
  if (hrac === undefined || hrac === null) return [];
  return zivi(s).filter(h => h !== hrac);
}

// ── Posun na dalšího ─────────────────────────────────────────
function dalsi(n, preskoc = 0) {
  for (let i = 0; i < 1 + preskoc; i++) {
    let pojistka = 0;
    do {
      n.naTahu = (n.naTahu + n.smer + n.hracu) % n.hracu;
    } while (!zije(n, n.naTahu) && ++pojistka < n.hracu * 2);
  }
  n.reklUno[n.naTahu] = false;
  n.musiLizat = false;
  n.musiZahrat = null;
}

// ── Doplnění balíčku z odhazovacího ──────────────────────────
function doplnit(n) {
  if (n.balicek.length) return;
  const v = n.odhoz.pop();
  n.balicek = n.odhoz;
  n.odhoz = v ? [v] : [];
  n.balicek.reverse();
}

function tahni(n, hrac, kolik) {
  let vzato = 0;
  for (let i = 0; i < kolik; i++) {
    doplnit(n);
    if (!n.balicek.length) break;
    n.ruce[hrac].push(n.balicek.pop());
    vzato++;
  }
  return vzato;
}

// ── Milost: 25 karet a končíš ────────────────────────────────
function zkontrolujMilost(n, hrac) {
  if (!zije(n, hrac) || n.ruce[hrac].length < n.milost) return false;
  n.vyrazeni.push(hrac);

  // Karty vyřazeného se vracejí do hry – jinak ze hry zmizí a balíček se
  // při šesti a osmi hráčích vysype. Vkládají se POD vrchní kartu, ať se
  // nezmění, co je zrovna ve hře.
  const ruka = n.ruce[hrac];
  n.ruce[hrac] = [];
  if (ruka.length) {
    const v = n.odhoz.pop();
    n.odhoz.push(...ruka);
    if (v) n.odhoz.push(v);
  }

  const z = zivi(n);
  if (z.length === 1) n.vitez = z[0];
  return true;
}

// Okno na nachytání se zavírá, jakmile něco udělá někdo jiný.
function zavriUno(n, kdoJedna) {
  if (n.unoOhrozeny !== null && n.unoOhrozeny !== kdoJedna) n.unoOhrozeny = null;
}

// ── Řekni UNO / nachytej ─────────────────────────────────────
export function rekniUno(s, hrac) {
  const n = kopie(s);
  if (n.vitez !== null) return n;
  n.reklUno[hrac] = true;
  n.akci++;
  return n;
}

export function nachytej(s, kdo) {
  const n = kopie(s);
  if (n.vitez !== null || n.unoOhrozeny === null || kdo === n.unoOhrozeny) return n;
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
  if (n.vitez !== null || n.vymena) return n;
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
  n.musiLizat = false;
  n.musiZahrat = null;
  n.akci++;
  n.tahu++;
  n.hlaska = null;

  if (!n.ruce[hrac].length) { n.vitez = hrac; n.unoOhrozeny = null; return n; }

  n.trest += trestZa(karta.z);

  if (karta.z === 'obrat') {
    n.smer *= -1;
    if (zivi(n).length === 2) dalsi(n);   // ve dvou je obrat totéž co stop
  }

  if (karta.z === 'vyhod') {
    // Výhoz barvy: z ruky odletí všechny karty té barvy a putují na
    // odhazovací hromádku (v předloze se prostě smazaly ze hry).
    const zbyle = [], odlozene = [];
    for (const k of n.ruce[hrac]) (k.b === karta.b ? odlozene : zbyle).push(k);
    n.ruce[hrac] = zbyle;
    n.odhoz.push(...odlozene);
    if (odlozene.length) rekni(n, hrac, `výhoz barvy – odloženo ${odlozene.length} karet.`);
    if (!n.ruce[hrac].length) { n.vitez = hrac; n.unoOhrozeny = null; return n; }
  }

  // Nula: všichni posílají celou ruku dalšímu v pořadí hry.
  if (karta.z === POSLI_RUKY) {
    const poradiHry = [];
    let cur = hrac;
    for (let i = 0; i < n.hracu; i++) {
      if (zije(n, cur)) poradiHry.push(cur);
      cur = (cur + n.smer + n.hracu) % n.hracu;
    }
    if (poradiHry.length > 1) {
      const puvodni = poradiHry.map(h => n.ruce[h]);
      poradiHry.forEach((h, i) => { n.ruce[poradiHry[(i + 1) % poradiHry.length]] = puvodni[i]; });
      rekni(n, hrac, 'všichni posílají ruku dál.');
      for (const h of [...poradiHry]) zkontrolujMilost(n, h);
      if (n.vitez !== null) return n;
    }
  }

  // Sedmička: výměna ruky s vybraným hráčem. Čeká se na volbu.
  if (karta.z === VYMEN_RUKY && cileVymeny(n, hrac).length) {
    n.vymena = { hrac };
    rekni(n, hrac, 'vybírá, s kým si vymění karty.');
    return n;
  }

  // Ruleta: další hráč líže, dokud nevytáhne zvolenou barvu, a ztrácí tah.
  // Přebít se nedá – nemá lízací hodnotu, takže na ni žádný trest nesedí.
  if (karta.z === 'ruleta') {
    dalsi(n);
    const obet = n.naTahu;
    let vzato = 0, pojistka = 0;
    while (pojistka++ < 300) {
      if (!tahni(n, obet, 1)) break;                     // došly karty
      vzato++;
      if (n.ruce[obet][n.ruce[obet].length - 1].b === zvolena) break;
    }
    rekni(n, obet, `ruleta – lízl ${vzato} karet, než přišla barva.`);
    zkontrolujMilost(n, obet);
    if (n.vitez === null) dalsi(n);
    return n;
  }

  if (karta.z === 'stopVsem') {
    // Přeskočí se všichni ostatní, takže hraje znovu ten samý hráč.
    // V předloze se tady posouvalo o jednoho, takže karta nedělala nic.
    rekni(n, hrac, 'stop všem – hraje znovu.');
    return n;
  }

  dalsi(n, karta.z === 'stop' ? 1 : 0);
  return n;
}

// ── Výměna ruky (sedmička) ───────────────────────────────────
export function vymen(s, cil) {
  const n = kopie(s);
  if (!n.vymena || !cileVymeny(n).includes(cil)) return n;
  const hrac = n.vymena.hrac;

  const moje = n.ruce[hrac];
  n.ruce[hrac] = n.ruce[cil];
  n.ruce[cil] = moje;
  n.vymena = null;
  n.akci++;
  rekni(n, hrac, 'vyměnil si karty.');

  if (!n.ruce[hrac].length) { n.vitez = hrac; return n; }
  zkontrolujMilost(n, hrac);
  zkontrolujMilost(n, cil);
  if (n.vitez !== null) return n;

  dalsi(n);
  return n;
}

// ── Líznutí ──────────────────────────────────────────────────
export function lizni(s) {
  const n = kopie(s);
  if (n.vitez !== null || n.vymena) return n;
  const hrac = n.naTahu;
  n.akci++;
  n.hlaska = null;
  zavriUno(n, hrac);

  if (n.trest > 0) {
    const kolik = n.trest;
    tahni(n, hrac, kolik);
    n.trest = 0;
    n.musiLizat = false;
    n.musiZahrat = null;
    rekni(n, hrac, `lízl trest +${kolik}.`);
    if (zkontrolujMilost(n, hrac)) {
      if (n.vitez === null && n.naTahu === hrac) dalsi(n);
      return n;
    }
    dalsi(n);
    return n;
  }

  if (!tahni(n, hrac, 1)) {
    // Došly karty úplně. Bez tohohle by hráč, který nemá co hrát ani co
    // líznout, zastavil hru napořád.
    n.musiLizat = false;
    n.musiZahrat = null;
    rekni(n, hrac, 'nemá co líznout – karty došly.');
    dalsi(n);
    return n;
  }

  const idx = n.ruce[hrac].length - 1;
  if (lzeHrat(n.ruce[hrac][idx], vrch(n), n.barva, 0)) {
    // Oficiální pravidlo: líznutou hratelnou kartu MUSÍŠ zahrát.
    // Předloha nabízela „vzdát tah“, což hru dělalo o dost mírnější.
    n.musiZahrat = idx;
    n.musiLizat = false;
    rekni(n, hrac, 'lízl hratelnou – musí ji zahrát.');
  } else {
    n.musiZahrat = null;
    n.musiLizat = true;
    if (zkontrolujMilost(n, hrac) && n.vitez === null && n.naTahu === hrac) dalsi(n);
  }
  return n;
}

// ── Pořadí na konci ──────────────────────────────────────────
export function poradi(s) {
  return Array.from({ length: s.hracu }, (_, h) => h)
    .sort((a, b) => {
      const av = zije(s, a) ? 0 : 1;
      const bv = zije(s, b) ? 0 : 1;
      return av - bv || s.ruce[a].length - s.ruce[b].length;
    });
}
