// ─────────────────────────────────────────────────────────────
//  Člověče, nezlob se – pravidla.
//
//  Základ převzatý z předlohy doslova:
//   • ven z domečku jen za šestku, na vlastní startovní pole
//   • do cíle se musí trefit přesně, přešlap je neplatný tah
//   • na vlastní figurku se nesmí ani na dráze, ani v cíli
//   • cizí figurka se vyhodí zpátky do jejího domečku
//   • šestka = házíš znovu
//   • tři pokusy dostaneš jen tehdy, když nemáš čím táhnout
//
//  Na to se dají zapnout módy z `mody.js`. Každý, který hráči něco
//  vnutí nebo vezme, nastaví `hlasku` – bez ní by to vypadalo jako
//  chyba hry („proč nemůžu zahrát tohle?“).
//
//  Funkce jsou čisté – vrací nový stav, nemění vstup. Náhoda (Nervy)
//  se předává zvenku jako číslo, aby to šlo testovat.
// ─────────────────────────────────────────────────────────────
import {
  CIL, MAPA_PODLE, mapaNebo, okruh, posledniKrok,
  FIGUREK_MIN, FIGUREK_MAX,
  V_DOMECKU, vDomecku, vCili, naDraze, naOkruhu, ramenaProHrace,
} from './const.js';
import { cisteMody, NERVY_SANCE, COUV_MAX } from './mody.js';

export const POKUSU = 3;

// ── Nová hra ─────────────────────────────────────────────────
export function novaHra(mapaId, hracu, figurek, mody = {}, zacina = 0) {
  const m = mapaNebo(mapaId);
  const pocet = Math.max(2, Math.min(hracu, m.ramen));
  // Počet figurek je volba před hrou, ne vlastnost desky – proto sedí
  // ve stavu partie a ne v mapě.
  const fig = Math.max(FIGUREK_MIN, Math.min(FIGUREK_MAX, (figurek ?? m.figurekDef) | 0));
  return {
    mapa: m.id,
    hracu: pocet,
    figurek: fig,
    mody: cisteMody(mody),
    ramena: ramenaProHrace(m, pocet),
    poz: Array.from({ length: pocet }, () => new Array(fig).fill(V_DOMECKU)),
    naTahu: zacina % pocet,
    kostka: null,
    kostky: null,        // [a, b] u Double trouble – kvůli zobrazení
    hozeno: false,
    pokusy: null,
    sniper: null,        // {hrac} – čeká se, koho sundá
    znovu: false,        // po vyřízení sniperu se ještě jednou hází
    hlaska: null,        // {mod, text} – proč se stalo, co se stalo
    posledni: null,      // {hrac, fig, z, na, vyhodil} – kvůli zvýraznění
    vitez: null,
    tahu: 0,
    hodu: 0,
    // Kazda akce, ktera stav posune. Hodu ani tahu na to nestaci:
    // sniper i nepovedeny zasah menou stav, aniz by jimi hnuly,
    // a test by to cetl jako zaseknutou partii.
    akci: 0,
  };
}

const mapaHry = (s) => MAPA_PODLE[s.mapa];

export function kopie(s) {
  return {
    ...s,
    poz: s.poz.map(p => [...p]),
    mody: { ...s.mody },
    kostky: s.kostky ? [...s.kostky] : null,
    sniper: s.sniper ? { ...s.sniper } : null,
    hlaska: s.hlaska ? { ...s.hlaska } : null,
    posledni: s.posledni ? { ...s.posledni } : null,
  };
}

const rekni = (n, mod, text) => { n.hlaska = { mod, text }; };

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

// Políčka, přes která figurka po cestě přejde (bez výchozího i cílového).
// Jen dráha – v cíli ani v domečku není koho přeskakovat.
export function cesta(s, hrac, z, na) {
  const m = mapaHry(s);
  const O = okruh(m);
  const out = [];
  if (z < 0) return out;                       // z domečku se neskáče
  if (na > z) {
    for (let k = z + 1; k < na && k < O; k++) out.push(naOkruhu(m, s.ramena[hrac], k));
  } else {
    for (let k = z - 1; k > na; k--) out.push(naOkruhu(m, s.ramena[hrac], k));
  }
  return out;
}

// ── Legální tahy ─────────────────────────────────────────────
// Vrací pole {fig, z, na, vyhodi, couv, preskoci}.
export function tahy(s, hrac = s.naTahu, kostka = s.kostka) {
  if (s.vitez !== null || s.sniper || !kostka) return [];
  const m = mapaHry(s);
  const O = okruh(m);
  const konec = posledniKrok(m);
  const draha = obsazeniDrahy(s);
  const out = [];

  const ciziNa = (krok) => {
    const c = draha.get(naOkruhu(m, s.ramena[hrac], krok));
    return c && c.hrac !== hrac ? c : null;
  };

  for (let f = 0; f < s.figurek; f++) {
    const k = s.poz[hrac][f];

    // Z domečku ven – jen za šestku a jen když na startu nestojím sám.
    if (vDomecku(k)) {
      if (kostka !== 6) continue;
      if (mamNaKroku(s, hrac, 0)) continue;
      out.push({ fig: f, z: k, na: 0, vyhodi: ciziNa(0), couv: false });
      continue;
    }

    // Dopředu.
    const na = k + kostka;
    if (na <= konec && !mamNaKroku(s, hrac, na)) {
      out.push({ fig: f, z: k, na, vyhodi: vCili(m, na) ? null : ciziNa(na), couv: false });
    }

    // Boomerang: za 1 až 3 se smí couvat, ale jen po dráze a ne za
    // vlastní start – zpátky do domečku to figurku nevrátí.
    if (s.mody.boomerang && kostka <= COUV_MAX && naDraze(m, k)) {
      const zpet = k - kostka;
      if (zpet >= 0 && !mamNaKroku(s, hrac, zpet)) {
        out.push({ fig: f, z: k, na: zpet, vyhodi: ciziNa(zpet), couv: true });
      }
    }
  }

  // Kolik cizích figurek tah po cestě přeskočí.
  for (const t of out) {
    t.preskoci = cesta(s, hrac, t.z, t.na)
      .filter(pole => { const c = draha.get(pole); return c && c.hrac !== hrac; }).length;
  }

  // Žába: když jde přeskočit cizí figurku, jiný tah DOPŘEDU se hrát nesmí.
  //
  // Nezávislost módů je ve SPOUŠTĚČi, ne ve výsledku: přeskok pozpátku
  // žábu nikdy nespustí (to je Boomerangova věc). Ale když už se žába
  // spustí, je to donucení jako každé jiné – hraje se přeskok a couvat
  // se v tom tahu nesmí.
  if (s.mody.zaba) {
    const skoky = out.filter(t => !t.couv && t.preskoci > 0);
    if (skoky.length) return skoky;
  }
  return out;
}

// Vrací true, když Žába zrovna omezuje výběr (kvůli hlášce).
// Couvnutí se do toho nepočítá – to žába nikdy nebere.
export function zabaOmezuje(s, hrac = s.naTahu, kostka = s.kostka) {
  if (!s.mody.zaba || !kostka) return false;
  const bez = { ...s, mody: { ...s.mody, zaba: false } };
  return tahy(bez, hrac, kostka).length > tahy(s, hrac, kostka).length;
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
// deterministická a šla testovat. `kostky` je dvojice u Double trouble.
export function hod(s, hodnota, kostky = null) {
  const n = kopie(s);
  if (n.vitez !== null || n.hozeno || n.sniper) return n;
  n.hodu++;
  n.akci++;
  n.kostka = hodnota;
  n.kostky = kostky;
  n.hlaska = null;

  if (tahy(n).length) {
    n.hozeno = true;      // čeká se, kterou figurkou
    n.pokusy = null;
    if (zabaOmezuje(n)) rekni(n, 'zaba', 'Žába: můžeš přeskočit soupeře, takže musíš.');
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
// `nahoda` je číslo 0–1 od serveru, potřebné jen pro mód Nervy.
export function tah(s, fig, nahoda = 1) {
  const n = kopie(s);
  if (n.vitez !== null || !n.hozeno || n.sniper) return n;
  const m = mapaHry(n);
  const O = okruh(m);

  const t = tahy(n).find(x => x.fig === fig);
  if (!t) return n;      // neplatný tah se prostě neprovede
  n.akci++;
  n.hlaska = null;

  // Nervy: útok se nemusí povést. Pak se nikam nejde a tah propadá.
  if (t.vyhodi && n.mody.nervy && nahoda < NERVY_SANCE) {
    rekni(n, 'nervy', 'Nervy: vyhození se nepovedlo, tah propadá.');
    n.hozeno = false;
    n.kostka = null;
    n.kostky = null;
    n.pokusy = null;
    dalsiHrac(n);
    return n;
  }

  const doCile = !vCili(m, t.z) && vCili(m, t.na);

  n.poz[n.naTahu][fig] = t.na;
  if (t.vyhodi) n.poz[t.vyhodi.hrac][t.vyhodi.fig] = V_DOMECKU;
  n.posledni = { hrac: n.naTahu, fig, z: t.z, na: t.na, vyhodil: t.vyhodi || null, couv: !!t.couv };
  n.tahu++;

  // Lovec odměn: za vyhození figurka navíc na start, nebo posun toho,
  // kdo na startu stojí.
  if (t.vyhodi && n.mody.lovec) odmena(n, n.naTahu);

  if (n.poz[n.naTahu].every(k => vCili(m, k))) {
    n.vitez = n.naTahu;
    n.hozeno = false;
    n.kostka = null;
    return n;
  }

  const znovu = n.kostka === 6;   // šestka = házíš znovu
  n.hozeno = false;
  n.kostka = null;
  n.kostky = null;
  n.pokusy = null;

  // Sniper: kdo VEJDE do domečku, sundá jednu soupeřovu figurku z dráhy.
  // Posun uvnitř domečku se nepočítá.
  if (doCile && n.mody.sniper && sniperCile(n, n.naTahu).length) {
    n.sniper = { hrac: n.naTahu };
    n.znovu = znovu;
    rekni(n, 'sniper', 'Sniper: došel jsi do domečku – vyber, koho sundáš.');
    return n;
  }

  if (!znovu) dalsiHrac(n);
  return n;
}

// Koho smí sniper sundat: cizí figurky NA DRÁZE. Kdo je v domečku nebo
// v cíli, je mimo dostřel.
export function sniperCile(s, hrac = s.sniper?.hrac ?? s.naTahu) {
  const m = mapaHry(s);
  const out = [];
  for (let h = 0; h < s.hracu; h++) {
    if (h === hrac) continue;
    for (let f = 0; f < s.figurek; f++) {
      if (naDraze(m, s.poz[h][f])) out.push({ hrac: h, fig: f });
    }
  }
  return out;
}

export function snipe(s, cilHrac, cilFig) {
  const n = kopie(s);
  if (!n.sniper) return n;
  const ok = sniperCile(n, n.sniper.hrac).some(c => c.hrac === cilHrac && c.fig === cilFig);
  if (!ok) return n;
  n.akci++;

  n.poz[cilHrac][cilFig] = V_DOMECKU;
  rekni(n, 'sniper', 'Sniper zasáhl.');
  const znovu = n.znovu;
  n.sniper = null;
  n.znovu = false;
  if (!znovu) dalsiHrac(n);
  return n;
}

// ── Lovec odměn ──────────────────────────────────────────────
function odmena(n, hrac) {
  const m = mapaHry(n);
  const O = okruh(m);
  const naStartu = n.poz[hrac].indexOf(0);

  if (naStartu === -1) {
    const vDomecku_ = n.poz[hrac].indexOf(V_DOMECKU);
    if (vDomecku_ === -1) return;
    n.poz[hrac][vDomecku_] = 0;
    rekni(n, 'lovec', 'Lovec odměn: nasazuješ figurku na start.');
    return;
  }

  // Na startu už někdo stojí – posuneme ho o pole dál, když je volno.
  const dal = 1;
  if (dal < O && !n.poz[hrac].some(k => k === dal)) {
    n.poz[hrac][naStartu] = dal;
    rekni(n, 'lovec', 'Lovec odměn: figurka na startu se posunula o pole.');
  }
}

// ── Sacrifice ────────────────────────────────────────────────
// Dvě svoje figurky z dráhy za jednu soupeřovu. Stojí to celý tah,
// takže se to nedá kombinovat s hodem.
export function obetovatelne(s, hrac = s.naTahu) {
  const m = mapaHry(s);
  const out = [];
  for (let f = 0; f < s.figurek; f++) if (naDraze(m, s.poz[hrac][f])) out.push(f);
  return out;
}

export function lzeObetovat(s, hrac = s.naTahu) {
  return !!s.mody.sacrifice && !s.hozeno && !s.sniper && s.vitez === null
    && obetovatelne(s, hrac).length >= 2 && sniperCile(s, hrac).length > 0;
}

export function obetuj(s, figA, figB, cilHrac, cilFig) {
  const n = kopie(s);
  if (!lzeObetovat(n)) return n;
  const moje = obetovatelne(n);
  if (figA === figB || !moje.includes(figA) || !moje.includes(figB)) return n;
  if (!sniperCile(n, n.naTahu).some(c => c.hrac === cilHrac && c.fig === cilFig)) return n;
  n.akci++;

  n.poz[n.naTahu][figA] = V_DOMECKU;
  n.poz[n.naTahu][figB] = V_DOMECKU;
  n.poz[cilHrac][cilFig] = V_DOMECKU;
  n.hlaska = null;
  rekni(n, 'sacrifice', 'Sacrifice: dvě za jednu. Tah tím končí.');
  n.hozeno = false;
  n.kostka = null;
  n.kostky = null;
  n.pokusy = null;
  n.tahu++;
  dalsiHrac(n);
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
