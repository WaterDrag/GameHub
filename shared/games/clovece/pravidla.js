// ─────────────────────────────────────────────────────────────
//  Člověče, nezlob se – pravidla.
//
//  Převzatá z předlohy doslova:
//   • ven z domečku jen za šestku, na vlastní startovní pole
//   • do cíle se musí trefit přesně, přešlap je neplatný tah
//   • na vlastní figurku se nesmí ani na dráze, ani v cíli
//   • cizí figurka se vyhodí zpátky do jejího domečku
//   • šestka = házíš znovu
//   • tři pokusy dostaneš jen tehdy, když nemáš čím táhnout
//
//  Funkce jsou čisté – vrací nový stav, nemění vstup. Díky tomu se
//  můžou pouštět v testu po tisících a bot si může dopředu zkusit tah,
//  aniž by rozbil skutečnou partii.
// ─────────────────────────────────────────────────────────────
import {
  CIL, MAPA_PODLE, mapaNebo, okruh, posledniKrok,
  FIGUREK_MIN, FIGUREK_MAX,
  V_DOMECKU, vDomecku, vCili, naDraze, naOkruhu, ramenaProHrace,
} from './const.js';

export const POKUSU = 3;

// ── Nová hra ─────────────────────────────────────────────────
export function novaHra(mapaId, hracu, figurek, zacina = 0) {
  const m = mapaNebo(mapaId);
  const pocet = Math.max(2, Math.min(hracu, m.ramen));
  // Počet figurek je volba před hrou, ne vlastnost desky – proto sedí
  // ve stavu partie a ne v mapě.
  const fig = Math.max(FIGUREK_MIN, Math.min(FIGUREK_MAX, (figurek ?? m.figurekDef) | 0));
  return {
    mapa: m.id,
    hracu: pocet,
    figurek: fig,
    ramena: ramenaProHrace(m, pocet),
    poz: Array.from({ length: pocet }, () => new Array(fig).fill(V_DOMECKU)),
    naTahu: zacina % pocet,
    kostka: null,
    hozeno: false,
    pokusy: null,
    posledni: null,      // {hrac, fig, z, na, vyhodil} – kvůli zvýraznění
    vitez: null,
    tahu: 0,
    hodu: 0,
  };
}

const mapaHry = (s) => MAPA_PODLE[s.mapa];

export function kopie(s) {
  return { ...s, poz: s.poz.map(p => [...p]), posledni: s.posledni ? { ...s.posledni } : null };
}

// ── Kde co stojí ─────────────────────────────────────────────
// Obsazenost dráhy v absolutních polích. Klíč = pole, hodnota = {hrac, fig}.
export function obsazeniDrahy(s) {
  const m = mapaHry(s);
  const out = new Map();
  for (let h = 0; h < s.hracu; h++) {
    for (let f = 0; f < s.figurek; f++) {
      const k = s.poz[h][f];
      if (!naDraze(m, k)) continue;
      out.set(naOkruhu(m, s.ramena[h], k), { hrac: h, fig: f });
    }
  }
  return out;
}

const mamNaKroku = (s, hrac, krok) => s.poz[hrac].some(k => k === krok);

// ── Legální tahy ─────────────────────────────────────────────
// Vrací pole {fig, z, na, vyhodi} pro hráče na tahu při hozené kostce.
export function tahy(s, hrac = s.naTahu, kostka = s.kostka) {
  if (s.vitez !== null || !kostka) return [];
  const m = mapaHry(s);
  const konec = posledniKrok(m);
  const draha = obsazeniDrahy(s);
  const out = [];

  for (let f = 0; f < s.figurek; f++) {
    const k = s.poz[hrac][f];

    // Z domečku ven – jen za šestku a jen když na startu nestojím sám.
    if (vDomecku(k)) {
      if (kostka !== 6) continue;
      if (mamNaKroku(s, hrac, 0)) continue;
      const pole = naOkruhu(m, s.ramena[hrac], 0);
      const cizi = draha.get(pole);
      out.push({ fig: f, z: k, na: 0, vyhodi: cizi && cizi.hrac !== hrac ? cizi : null });
      continue;
    }

    const na = k + kostka;
    if (na > konec) continue;               // do cíle se musí trefit přesně
    if (mamNaKroku(s, hrac, na)) continue;  // na vlastní se nesmí

    if (vCili(m, na)) {
      out.push({ fig: f, z: k, na, vyhodi: null });
    } else {
      const pole = naOkruhu(m, s.ramena[hrac], na);
      const cizi = draha.get(pole);
      out.push({ fig: f, z: k, na, vyhodi: cizi && cizi.hrac !== hrac ? cizi : null });
    }
  }
  return out;
}

// ── Tři pokusy ───────────────────────────────────────────────
// Přesně podle předlohy: tři hody dostaneš jen tehdy, když nemáš na
// dráze nic a figurky v cíli jsou naskládané až vzadu – tedy když se
// nedá dělat vůbec nic jiného než hodit šestku.
export function triPokusy(s, hrac = s.naTahu) {
  const m = mapaHry(s);
  if (s.poz[hrac].some(k => naDraze(m, k))) return false;
  const vCilich = s.poz[hrac].filter(k => vCili(m, k))
    .map(k => k - okruh(m))
    .sort((a, b) => b - a);
  for (let i = 0; i < vCilich.length; i++) {
    if (vCilich[i] !== CIL - 1 - i) return false;
  }
  return true;
}

export const maxPokusu = (s, hrac = s.naTahu) => (triPokusy(s, hrac) ? POKUSU : 1);

// ── Hod kostkou ──────────────────────────────────────────────
// Hodnota přichází zvenku (server ji losuje svým RNG), aby byla funkce
// deterministická a šla testovat.
export function hod(s, hodnota) {
  const n = kopie(s);
  if (n.vitez !== null || n.hozeno) return n;
  n.hodu++;
  n.kostka = hodnota;

  if (tahy(n).length) {
    n.hozeno = true;      // čeká se, kterou figurkou
    n.pokusy = null;
    return n;
  }

  // Není čím táhnout – ubereme pokus.
  const max = maxPokusu(n);
  const zbyva = (n.pokusy ?? max) - 1;
  n.kostka = null;
  n.hozeno = false;
  if (zbyva <= 0) {
    n.pokusy = null;
    dalsiHrac(n);
  } else {
    n.pokusy = zbyva;
  }
  return n;
}

// ── Tah figurkou ─────────────────────────────────────────────
export function tah(s, fig) {
  const n = kopie(s);
  if (n.vitez !== null || !n.hozeno) return n;
  const m = mapaHry(n);

  const t = tahy(n).find(x => x.fig === fig);
  if (!t) return n;      // neplatný tah se prostě neprovede

  n.poz[n.naTahu][fig] = t.na;
  if (t.vyhodi) n.poz[t.vyhodi.hrac][t.vyhodi.fig] = V_DOMECKU;
  n.posledni = { hrac: n.naTahu, fig, z: t.z, na: t.na, vyhodil: t.vyhodi || null };
  n.tahu++;

  if (n.poz[n.naTahu].every(k => vCili(m, k))) {
    n.vitez = n.naTahu;
    n.hozeno = false;
    n.kostka = null;
    return n;
  }

  const znovu = n.kostka === 6;   // šestka = házíš znovu
  n.hozeno = false;
  n.kostka = null;
  n.pokusy = null;
  if (!znovu) dalsiHrac(n);
  return n;
}

function dalsiHrac(n) {
  n.naTahu = (n.naTahu + 1) % n.hracu;
  n.pokusy = null;
}

// ── Stav pro zobrazení ───────────────────────────────────────
export function hotovych(s, hrac) {
  const m = mapaHry(s);
  return s.poz[hrac].filter(k => vCili(m, k)).length;
}

// Jak daleko je hráč celkově – pro pořadí, když hra skončí předčasně.
export function postup(s, hrac) {
  const m = mapaHry(s);
  return s.poz[hrac].reduce((a, k) => a + (k < 0 ? 0 : k + 1), 0);
}

export function poradi(s) {
  return Array.from({ length: s.hracu }, (_, h) => h)
    .sort((a, b) => (hotovych(s, b) - hotovych(s, a)) || (postup(s, b) - postup(s, a)));
}
