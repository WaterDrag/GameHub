// ─────────────────────────────────────────────────────────────
//  Osadníci z Katanu – pravidla.
//
//  Server je jediný, kdo je vyhodnocuje. Funkce jsou čisté: mění se
//  předaný stav a vrací se, náhoda přichází zvenku jako čísla.
//
//  Proti předloze je tady několik věcí jinak, vždycky ve prospěch
//  oficiálních pravidel – je to poznamenané u každého místa:
//   • suroviny v ruce jsou TAJNÉ (vidí se jen počet karet)
//   • banka je konečná (19 od každé suroviny)
//   • nejdelší cesta se láme cizí osadou
//   • koupená karta se smí zahrát až další tah
// ─────────────────────────────────────────────────────────────
import {
  SUROVINY, POUST, CENY, LIMIT, DEV_BALICEK, PRISTAVY,
  BODU_NA_VYHRU, ARMADA_MIN, CESTA_MIN, RUKA_MAX, novaDeska,
} from './deska.js';

export const BANKA_NA_SUROVINU = 19;

const prazdneSuroviny = () => ({ drevo: 0, cihla: 0, vlna: 0, obili: 0, ruda: 0 });
export const kolikKaret = (s) => SUROVINY.reduce((a, r) => a + (s[r] || 0), 0);

// ── Nová hra ─────────────────────────────────────────────────
export function novaHra(hracu, rng) {
  const deska = novaDeska(rng);
  const balicek = [...DEV_BALICEK];
  for (let i = balicek.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [balicek[i], balicek[j]] = [balicek[j], balicek[i]];
  }

  return {
    hracu,
    deska,
    banka: Object.fromEntries(SUROVINY.map(r => [r, BANKA_NA_SUROVINU])),
    balicek,
    suroviny: Array.from({ length: hracu }, prazdneSuroviny),
    karty: Array.from({ length: hracu }, () => []),        // dev karty na ruce
    kartyDnes: Array.from({ length: hracu }, () => []),    // koupené tenhle tah
    rytiru: new Array(hracu).fill(0),
    bodoveKarty: new Array(hracu).fill(0),

    naTahu: 0,
    faze: 'rozmisteni',      // rozmisteni | hod | akce | zahazuje | zlodej | krade
    rozmisteniKrok: 0,       // 0..2*hracu-1
    cekaSilnice: false,      // v rozmístění: osada hotová, teď silnice
    posledniOsada: null,     // kvůli navázání silnice v rozmístění

    kostky: null,
    zlodej: deska.zlodej,
    volneSilnice: 0,
    zahazuji: {},            // hrac -> kolik musí zahodit
    obeti: [],               // koho smí okrást
    nabidka: null,           // {hrac, dava, chce}

    nejdelsiCesta: { hrac: -1, delka: 0 },
    nejvetsiArmada: { hrac: -1, pocet: 0 },

    vitez: null,
    hlaska: null,
    tahu: 0,
    akci: 0,
    log: [],
  };
}

export function kopie(s) {
  const n = JSON.parse(JSON.stringify(s));
  // Hláška patří k jedné akci. Kdyby se kopírovala dál, další akce
  // bez vlastní hlášky by hráči znovu vyhodila tu předchozí.
  n.hlaska = null;
  return n;
}

const rekni = (n, text) => { n.hlaska = text; n.log.push(text); if (n.log.length > 60) n.log.shift(); };

// ── Body ─────────────────────────────────────────────────────
export function body(s, h, sVevnitr = true) {
  const d = s.deska;
  let b = 0;
  for (const v of d.vrcholy) {
    if (v.majitel !== h) continue;
    b += v.typ === 'mesto' ? 2 : 1;
  }
  if (s.nejdelsiCesta.hrac === h) b += 2;
  if (s.nejvetsiArmada.hrac === h) b += 2;
  if (sVevnitr) b += s.bodoveKarty[h];
  return b;
}
// Body, které vidí ostatní – bez skrytých bodových karet.
export const bodyVerejne = (s, h) => body(s, h, false);

export const pocetStaveb = (s, h, typ) => {
  if (typ === 'silnice') return s.deska.hrany.filter(e => e.majitel === h).length;
  return s.deska.vrcholy.filter(v => v.majitel === h && v.typ === typ).length;
};

// ── Kde se smí stavět ────────────────────────────────────────
export function lzeOsada(s, h, vId) {
  const v = s.deska.vrcholy[vId];
  if (!v || v.majitel !== null) return false;
  // Odstup: na sousedním vrcholu nesmí nikdo stát.
  for (const so of v.sousedi) if (s.deska.vrcholy[so].majitel !== null) return false;
  if (pocetStaveb(s, h, 'osada') >= LIMIT.osada) return false;
  if (s.faze === 'rozmisteni') return true;
  // V běžné hře musí osada navazovat na vlastní silnici.
  return s.deska.hrany.some(e => e.majitel === h && (e.v1 === vId || e.v2 === vId));
}

export function lzeSilnice(s, h, eId) {
  const e = s.deska.hrany[eId];
  if (!e || e.majitel !== null) return false;
  if (pocetStaveb(s, h, 'silnice') >= LIMIT.silnice) return false;

  // V rozmístění musí silnice vyjít z právě postavené osady.
  if (s.faze === 'rozmisteni') {
    return s.posledniOsada !== null && (e.v1 === s.posledniOsada || e.v2 === s.posledniOsada);
  }
  return [e.v1, e.v2].some(vId => {
    const v = s.deska.vrcholy[vId];
    if (v.majitel === h) return true;
    // Cizí osada cestu přerušuje – navázat se za ní nedá.
    if (v.majitel !== null) return false;
    return s.deska.hrany.some(x => x.id !== eId && x.majitel === h && (x.v1 === vId || x.v2 === vId));
  });
}

export const lzeMesto = (s, h, vId) => {
  const v = s.deska.vrcholy[vId];
  return !!v && v.majitel === h && v.typ === 'osada' && pocetStaveb(s, h, 'mesto') < LIMIT.mesto;
};

// ── Peníze ───────────────────────────────────────────────────
export function maNa(s, h, co) {
  const c = CENY[co];
  return SUROVINY.every(r => (s.suroviny[h][r] || 0) >= (c[r] || 0));
}
function zaplat(n, h, co) {
  for (const [r, kolik] of Object.entries(CENY[co])) {
    n.suroviny[h][r] -= kolik;
    n.banka[r] += kolik;
  }
}
function dej(n, h, r, kolik) {
  const skutecne = Math.min(kolik, n.banka[r]);
  n.suroviny[h][r] += skutecne;
  n.banka[r] -= skutecne;
  return skutecne;
}

// ── Rozmístění ───────────────────────────────────────────────
// Hadí pořadí: 0,1,2,…,n-1, n-1,…,1,0
function hracRozmisteni(s, krok) {
  return krok < s.hracu ? krok : 2 * s.hracu - 1 - krok;
}

export function postavOsadu(s, vId) {
  const n = kopie(s);
  const h = n.naTahu;
  if (n.vitez !== null) return n;
  if (n.faze === 'rozmisteni') {
    if (n.cekaSilnice || !lzeOsada(n, h, vId)) return n;
  } else {
    if (n.faze !== 'akce' || !lzeOsada(n, h, vId) || !maNa(n, h, 'osada')) return n;
    zaplat(n, h, 'osada');
  }

  const v = n.deska.vrcholy[vId];
  v.majitel = h;
  v.typ = 'osada';
  n.akci++;

  if (n.faze === 'rozmisteni') {
    n.cekaSilnice = true;
    n.posledniOsada = vId;
    // Druhé kolo rozmístění nese suroviny z okolních polí.
    if (n.rozmisteniKrok >= n.hracu) {
      for (const pId of v.pole) {
        const p = n.deska.pole[pId];
        if (p.surovina !== POUST) dej(n, h, p.surovina, 1);
      }
    }
    rekni(n, `Hráč ${h + 1} postavil osadu.`);
  } else {
    rekni(n, `Hráč ${h + 1} postavil osadu.`);
    zkontrolujCestu(n);
    zkontrolujVyhru(n);
  }
  return n;
}

export function postavSilnici(s, eId) {
  const n = kopie(s);
  const h = n.naTahu;
  if (n.vitez !== null) return n;

  if (n.faze === 'rozmisteni') {
    if (!n.cekaSilnice || !lzeSilnice(n, h, eId)) return n;
    n.deska.hrany[eId].majitel = h;
    n.akci++;
    n.cekaSilnice = false;
    n.posledniOsada = null;
    zkontrolujCestu(n);
    dalsiRozmisteni(n);
    return n;
  }

  if (n.faze !== 'akce' || !lzeSilnice(n, h, eId)) return n;
  if (n.volneSilnice > 0) {
    n.volneSilnice--;
  } else {
    if (!maNa(n, h, 'silnice')) return n;
    zaplat(n, h, 'silnice');
  }
  n.deska.hrany[eId].majitel = h;
  n.akci++;
  rekni(n, `Hráč ${h + 1} postavil silnici.`);
  zkontrolujCestu(n);
  zkontrolujVyhru(n);
  return n;
}

export function postavMesto(s, vId) {
  const n = kopie(s);
  const h = n.naTahu;
  if (n.vitez !== null || n.faze !== 'akce') return n;
  if (!lzeMesto(n, h, vId) || !maNa(n, h, 'mesto')) return n;
  zaplat(n, h, 'mesto');
  n.deska.vrcholy[vId].typ = 'mesto';
  n.akci++;
  rekni(n, `Hráč ${h + 1} povýšil osadu na město.`);
  zkontrolujVyhru(n);
  return n;
}

function dalsiRozmisteni(n) {
  n.rozmisteniKrok++;
  if (n.rozmisteniKrok >= n.hracu * 2) {
    n.faze = 'hod';
    n.naTahu = 0;
    rekni(n, 'Rozmístění hotovo, hra začíná.');
    return;
  }
  n.naTahu = hracRozmisteni(n, n.rozmisteniKrok);
}

// ── Hod kostkami ─────────────────────────────────────────────
export function hod(s, d1, d2) {
  const n = kopie(s);
  if (n.vitez !== null || n.faze !== 'hod') return n;
  n.kostky = [d1, d2];
  n.akci++;
  const soucet = d1 + d2;
  rekni(n, `Hráč ${n.naTahu + 1} hodil ${soucet}.`);

  if (soucet === 7) {
    n.zahazuji = {};
    for (let h = 0; h < n.hracu; h++) {
      const karet = kolikKaret(n.suroviny[h]);
      if (karet > RUKA_MAX) n.zahazuji[h] = Math.floor(karet / 2);
    }
    n.faze = Object.keys(n.zahazuji).length ? 'zahazuje' : 'zlodej';
    if (n.faze === 'zahazuje') rekni(n, 'Sedmička! Kdo má víc než sedm karet, polovinu zahodí.');
    else rekni(n, 'Sedmička! Přesuň zloděje.');
    return n;
  }

  vyrob(n, soucet);
  n.faze = 'akce';
  return n;
}

// Výroba. Banka je konečná: když na všechny nezbývá, nedostane
// tu surovinu nikdo (pokud nejde o jediného hráče). Předloha měla
// banku nekonečnou.
function vyrob(n, soucet) {
  const naroky = {};   // surovina -> {hrac: kolik}
  for (const p of n.deska.pole) {
    if (p.cislo !== soucet || p.id === n.zlodej || p.surovina === POUST) continue;
    for (const vId of n.deska.poleVrcholy[p.id]) {
      const v = n.deska.vrcholy[vId];
      if (v.majitel === null) continue;
      const kolik = v.typ === 'mesto' ? 2 : 1;
      naroky[p.surovina] = naroky[p.surovina] || {};
      naroky[p.surovina][v.majitel] = (naroky[p.surovina][v.majitel] || 0) + kolik;
    }
  }

  for (const [r, podle] of Object.entries(naroky)) {
    const celkem = Object.values(podle).reduce((a, b) => a + b, 0);
    const hraci = Object.keys(podle);
    if (celkem > n.banka[r] && hraci.length > 1) {
      rekni(n, `Banka nemá dost ${r} – tentokrát nedostane nikdo.`);
      continue;
    }
    for (const h of hraci) dej(n, Number(h), r, podle[h]);
  }
}

// ── Sedmička: zahazování ─────────────────────────────────────
export function zahod(s, hrac, co) {
  const n = kopie(s);
  if (n.faze !== 'zahazuje' || !n.zahazuji[hrac]) return n;
  const potreba = n.zahazuji[hrac];
  const celkem = SUROVINY.reduce((a, r) => a + Math.max(0, co[r] | 0), 0);
  if (celkem !== potreba) return n;
  for (const r of SUROVINY) {
    const kolik = Math.max(0, co[r] | 0);
    if (kolik > n.suroviny[hrac][r]) return n;
  }
  for (const r of SUROVINY) {
    const kolik = Math.max(0, co[r] | 0);
    n.suroviny[hrac][r] -= kolik;
    n.banka[r] += kolik;
  }
  delete n.zahazuji[hrac];
  n.akci++;
  rekni(n, `Hráč ${hrac + 1} zahodil ${potreba} karet.`);
  if (!Object.keys(n.zahazuji).length) {
    n.faze = 'zlodej';
    rekni(n, 'Teď přesuň zloděje.');
  }
  return n;
}

// ── Zloděj ───────────────────────────────────────────────────
export function presunZlodeje(s, poleId) {
  const n = kopie(s);
  if (n.faze !== 'zlodej' || poleId === n.zlodej || !n.deska.pole[poleId]) return n;
  n.zlodej = poleId;
  n.akci++;

  const obeti = new Set();
  for (const vId of n.deska.poleVrcholy[poleId]) {
    const v = n.deska.vrcholy[vId];
    if (v.majitel !== null && v.majitel !== n.naTahu && kolikKaret(n.suroviny[v.majitel]) > 0) {
      obeti.add(v.majitel);
    }
  }
  n.obeti = [...obeti];
  rekni(n, `Zloděj se přesunul.`);
  if (n.obeti.length) n.faze = 'krade';
  else n.faze = n.kostky ? 'akce' : 'hod';
  return n;
}

// `los` je číslo 0–1 od serveru – vybírá se náhodná karta z ruky.
export function okradni(s, obet, los = 0) {
  const n = kopie(s);
  if (n.faze !== 'krade' || !n.obeti.includes(obet)) return n;
  const balik = [];
  for (const r of SUROVINY) for (let i = 0; i < n.suroviny[obet][r]; i++) balik.push(r);
  if (balik.length) {
    const r = balik[Math.min(balik.length - 1, Math.floor(los * balik.length))];
    n.suroviny[obet][r]--;
    n.suroviny[n.naTahu][r]++;
    rekni(n, `Hráč ${n.naTahu + 1} okradl hráče ${obet + 1}.`);
  }
  n.obeti = [];
  n.akci++;
  n.faze = n.kostky ? 'akce' : 'hod';
  return n;
}

// ── Dev karty ────────────────────────────────────────────────
export function koupKartu(s) {
  const n = kopie(s);
  const h = n.naTahu;
  if (n.vitez !== null || n.faze !== 'akce' || !n.balicek.length || !maNa(n, h, 'karta')) return n;
  zaplat(n, h, 'karta');
  const k = n.balicek.pop();
  n.karty[h].push(k);
  n.kartyDnes[h].push(k);       // dneska se hrát nesmí
  if (k === 'bod') n.bodoveKarty[h]++;
  n.akci++;
  rekni(n, `Hráč ${h + 1} koupil kartu.`);
  zkontrolujVyhru(n);
  return n;
}

// Kartu koupenou tenhle tah zahrát nejde – to předloha nehlídala.
export function lzeZahratKartu(s, h, typ) {
  if (s.vitez !== null || h !== s.naTahu) return false;
  if (s.faze !== 'akce' && s.faze !== 'hod') return false;
  if (typ === 'bod') return false;
  const mam = s.karty[h].filter(k => k === typ).length;
  const dnes = s.kartyDnes[h].filter(k => k === typ).length;
  return mam - dnes > 0;
}

export function zahrajKartu(s, typ, param = null) {
  const n = kopie(s);
  const h = n.naTahu;
  if (!lzeZahratKartu(n, h, typ)) return n;
  n.karty[h].splice(n.karty[h].indexOf(typ), 1);
  n.akci++;

  if (typ === 'rytir') {
    n.rytiru[h]++;
    zkontrolujArmadu(n);
    n.faze = 'zlodej';
    rekni(n, `Hráč ${h + 1} hraje Rytíře.`);
  } else if (typ === 'silnice') {
    n.volneSilnice = 2;
    if (n.faze === 'hod') n.faze = 'akce';
    rekni(n, `Hráč ${h + 1} staví dvě silnice zdarma.`);
  } else if (typ === 'hojnost') {
    const dvojice = Array.isArray(param) ? param : [];
    for (const r of dvojice.slice(0, 2)) if (SUROVINY.includes(r)) dej(n, h, r, 1);
    if (n.faze === 'hod') n.faze = 'akce';
    rekni(n, `Hráč ${h + 1} bere z banku dvě suroviny.`);
  } else if (typ === 'monopol') {
    if (!SUROVINY.includes(param)) return s;
    let celkem = 0;
    for (let i = 0; i < n.hracu; i++) {
      if (i === h) continue;
      celkem += n.suroviny[i][param];
      n.suroviny[h][param] += n.suroviny[i][param];
      n.suroviny[i][param] = 0;
    }
    if (n.faze === 'hod') n.faze = 'akce';
    rekni(n, `Hráč ${h + 1} má monopol na ${param} – sebral ${celkem}.`);
  }
  zkontrolujVyhru(n);
  return n;
}

// ── Obchod s bankou a přístavy ───────────────────────────────
export function kurz(s, h, surovina) {
  let nej = 4;
  for (const v of s.deska.vrcholy) {
    if (v.majitel !== h || !v.pristav) continue;
    if (v.pristav === surovina) return 2;
    if (v.pristav === 'vse') nej = Math.min(nej, 3);
  }
  return nej;
}

export function obchodBanka(s, dam, chci) {
  const n = kopie(s);
  const h = n.naTahu;
  if (n.vitez !== null || n.faze !== 'akce') return n;
  if (!SUROVINY.includes(dam) || !SUROVINY.includes(chci) || dam === chci) return n;
  const k = kurz(n, h, dam);
  if (n.suroviny[h][dam] < k || n.banka[chci] < 1) return n;
  n.suroviny[h][dam] -= k;
  n.banka[dam] += k;
  dej(n, h, chci, 1);
  n.akci++;
  rekni(n, `Hráč ${h + 1} vyměnil ${k}× ${dam} za ${chci}.`);
  return n;
}

// ── Obchod mezi hráči ────────────────────────────────────────
// Nabídka jde všem; kdo první přijme, ten obchoduje.
export function nabidni(s, dava, chce) {
  const n = kopie(s);
  const h = n.naTahu;
  if (n.vitez !== null || n.faze !== 'akce' || n.nabidka) return n;
  const cist = (o) => Object.fromEntries(SUROVINY.map(r => [r, Math.max(0, o?.[r] | 0)]));
  const d = cist(dava), c = cist(chce);
  if (!kolikKaret(d) || !kolikKaret(c)) return n;
  if (SUROVINY.some(r => n.suroviny[h][r] < d[r])) return n;
  n.nabidka = { hrac: h, dava: d, chce: c };
  n.akci++;
  rekni(n, `Hráč ${h + 1} nabízí obchod.`);
  return n;
}

export function prijmiNabidku(s, kdo) {
  const n = kopie(s);
  if (!n.nabidka || kdo === n.nabidka.hrac) return n;
  const { hrac, dava, chce } = n.nabidka;
  if (SUROVINY.some(r => n.suroviny[kdo][r] < chce[r])) return n;
  if (SUROVINY.some(r => n.suroviny[hrac][r] < dava[r])) return n;
  for (const r of SUROVINY) {
    n.suroviny[hrac][r] += chce[r] - dava[r];
    n.suroviny[kdo][r] += dava[r] - chce[r];
  }
  n.nabidka = null;
  n.akci++;
  rekni(n, `Hráči ${hrac + 1} a ${kdo + 1} si vyměnili suroviny.`);
  return n;
}

export function zrusNabidku(s) {
  const n = kopie(s);
  if (!n.nabidka) return n;
  n.nabidka = null;
  n.akci++;
  return n;
}

// ── Konec tahu ───────────────────────────────────────────────
export function konecTahu(s) {
  const n = kopie(s);
  if (n.vitez !== null || n.faze !== 'akce') return n;
  n.kartyDnes[n.naTahu] = [];
  n.volneSilnice = 0;
  n.nabidka = null;
  n.kostky = null;
  n.naTahu = (n.naTahu + 1) % n.hracu;
  n.faze = 'hod';
  n.tahu++;
  n.akci++;
  return n;
}

// ── Největší armáda ──────────────────────────────────────────
function zkontrolujArmadu(n) {
  let nej = -1, kolik = Math.max(ARMADA_MIN - 1, n.nejvetsiArmada.pocet);
  for (let h = 0; h < n.hracu; h++) {
    if (n.rytiru[h] > kolik) { kolik = n.rytiru[h]; nej = h; }
  }
  if (nej !== -1 && nej !== n.nejvetsiArmada.hrac) {
    n.nejvetsiArmada = { hrac: nej, pocet: kolik };
    rekni(n, `Hráč ${nej + 1} má největší armádu.`);
  } else if (nej !== -1) {
    n.nejvetsiArmada.pocet = kolik;
  }
}

// ── Nejdelší cesta ───────────────────────────────────────────
//  Hledá nejdelší souvislou cestu z vlastních silnic. Cizí osada
//  cestu LÁME – přes vrchol obsazený soupeřem se nepokračuje.
//  Předloha tohle pravidlo neměla.
export function delkaCesty(s, h) {
  const moje = s.deska.hrany.filter(e => e.majitel === h);
  if (!moje.length) return 0;
  const podleVrcholu = new Map();
  for (const e of moje) {
    for (const v of [e.v1, e.v2]) {
      if (!podleVrcholu.has(v)) podleVrcholu.set(v, []);
      podleVrcholu.get(v).push(e);
    }
  }
  const pruchozi = (vId) => {
    const m = s.deska.vrcholy[vId].majitel;
    return m === null || m === h;
  };

  let nej = 0;
  const projdi = (eId, vrchol, pouzite) => {
    let max = pouzite.size;
    if (!pruchozi(vrchol)) return max;
    for (const dalsi of podleVrcholu.get(vrchol) || []) {
      if (pouzite.has(dalsi.id)) continue;
      pouzite.add(dalsi.id);
      const konec = dalsi.v1 === vrchol ? dalsi.v2 : dalsi.v1;
      max = Math.max(max, projdi(dalsi.id, konec, pouzite));
      pouzite.delete(dalsi.id);
    }
    return max;
  };

  for (const e of moje) {
    for (const start of [e.v1, e.v2]) {
      const konec = e.v1 === start ? e.v2 : e.v1;
      const pouzite = new Set([e.id]);
      nej = Math.max(nej, projdi(e.id, konec, pouzite));
    }
  }
  return nej;
}

function zkontrolujCestu(n) {
  let nej = -1, delka = Math.max(CESTA_MIN - 1, n.nejdelsiCesta.delka);
  for (let h = 0; h < n.hracu; h++) {
    const d = delkaCesty(n, h);
    if (d > delka) { delka = d; nej = h; }
  }
  if (nej !== -1 && nej !== n.nejdelsiCesta.hrac) {
    n.nejdelsiCesta = { hrac: nej, delka };
    rekni(n, `Hráč ${nej + 1} má nejdelší cestu (${delka}).`);
  } else if (nej !== -1) {
    n.nejdelsiCesta.delka = delka;
  }
}

function zkontrolujVyhru(n) {
  for (let h = 0; h < n.hracu; h++) {
    if (body(n, h) >= BODU_NA_VYHRU) {
      n.vitez = h;
      rekni(n, `Hráč ${h + 1} vyhrál!`);
      return;
    }
  }
}

// ── Přehled pro klienta ──────────────────────────────────────
export function poradi(s) {
  return Array.from({ length: s.hracu }, (_, h) => h).sort((a, b) => body(s, b) - body(s, a));
}
