// ─────────────────────────────────────────────────────────────
//  Kvak! – pravidla. Čisté funkce, náhoda leze zvenčí.
//
//  Hraje se podle DODANÝCH PRAVIDEL, ne podle přiložené předlohy.
//  Ty dvě se rozcházely dost zásadně:
//
//    • předloha uměla jen 2 hráče, pravidla mluví o 2 až 4
//    • štika v předloze sežrala i královnu → hráč rovnou vypadl.
//      Podle pravidel se královny lekne a ta přežije, jen jí končí tah.
//    • leknín v předloze nutil hrát jinou žábou. Podle pravidel je to
//      NEPOVINNÝ přeskok na jiný už odhalený leknín kdekoliv na desce.
//    • sameček v předloze přidal žábu na totéž pole a vnutil jí tah.
//      Podle pravidel si hráč vybere libovolné volné SOUSEDNÍ pole.
//    • „bahno“ a „kláda“ v pravidlech nejsou vůbec; místo nich je
//      voda (nic se neděje) a rákos (chráněné pole).
//    • předloha neotáčela startovní kartičky, pravidla ano.
//
//  Vlastní rozhodnutí tam, kde pravidla mlčí:
//    • na rákosu se nedá vyhodit žabka. Kartička je ale lícem dolů, takže
//      se to pozná až po otočení – útočník tam prostě zůstane stát vedle.
//      KRÁLOVNU rákos NECHRÁNÍ. Pravidla označují ochranu za nepovinnou
//      variantu a s královnou se hra rozbije: naměřeno, že půlka partijí
//      skončila vyscháním rybníka s královnou zaparkovanou na rákosu,
//      kde ji nikdo nikdy nemohl chytit.
//    • na jedno pole se vejde jen jedna VLASTNÍ žába.
//    • zásoba žabek je 4 na hráče (pravidla počet neuvádějí).
//    • efekt kartičky pod nově položenou žabkou se vyhodnotí, ale
//      leknín z položení neskáče – jinak by se fáze tahu zacyklily.
//    • efekt se spouští při KAŽDÉM vstupu, ne jen při prvním otočení.
//      Pravidla píší „pokud na toto pole stoupne“ a jinak by byl sameček
//      prázdný: kartičku skoro vždycky odhalí žabka, ne královna.
//    • komár se tím ale SNÍ („žába si na komárovi pochutná“) a podruhé už
//      tah navíc nedá – jinak by dvě žáby u jednoho komára táhly do nekonečna.
// ─────────────────────────────────────────────────────────────
import {
  POLI, ZASOBA, BEZ_POKROKU, STARTY, klic, rozklic, index, naDesce, sousedi, novaDeska,
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
  const pole = novaDeska(rng, hracu);
  const s = {
    hracu,
    pole,
    odhaleno: new Array(POLI).fill(false),
    zakazano: new Array(POLI).fill(false),   // odhalená štika – nikdo tam nesmí
    snezeno: new Array(POLI).fill(false),    // komár už snědený
    bezPokroku: 0,      // kolik tahů se už nic neděje
    pokrok: false,      // stalo se v tomhle tahu něco počítaného?
    minule: Array.from({ length: hracu }, () => null),   // odkud kdo naposled skočil
    zaby: {},
    hraci: Array.from({ length: hracu }, () => ({ zije: true, zasoba: ZASOBA })),
    naTahu: 0,
    faze: 'tah',        // tah | leknin | plozeni
    vybrana: null,      // {r,c} žáby, která právě něco řeší
    vitez: null,
    log: [],
    hlaska: null,
    akci: 0,
  };

  // Tři žáby na roh a k němu dvě sousední kartičky. Startovní pole
  // se rovnou otáčejí lícem nahoru.
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

export function mojeZabyNa(s, h, r, c) {
  return zabyNa(s, r, c).filter(z => z.hrac === h);
}

export function vsechnyZaby(s, h) {
  const out = [];
  for (const [k, seznam] of Object.entries(s.zaby)) {
    const [r, c] = rozklic(k);
    for (const z of seznam) if (z.hrac === h) out.push({ r, c, kralovna: z.kralovna });
  }
  return out;
}

export const maKralovnu = (s, h) => vsechnyZaby(s, h).some(z => z.kralovna);

// Kam smí žába z (r,c). Cíl nesmí být odhalená štika ani pole,
// kde už stojí vlastní žába.
export function kamMuze(s, h, r, c) {
  const out = [];
  for (const [nr, nc] of sousedi(r, c)) {
    if (s.zakazano[index(nr, nc)]) continue;
    if (mojeZabyNa(s, h, nr, nc).length) continue;
    out.push([nr, nc]);
  }
  return out;
}

// Všechny tahy hráče – seznam {z:{r,c,kralovna}, na:[r,c]}.
export function tahy(s, h) {
  const out = [];
  for (const z of vsechnyZaby(s, h)) {
    for (const na of kamMuze(s, h, z.r, z.c)) out.push({ z, na });
  }
  return out;
}

// Odhalené lekníny mimo pole, na kterém žába zrovna stojí.
export function cileLekninu(s, h, r, c) {
  const out = [];
  for (let i = 0; i < POLI; i++) {
    if (!s.odhaleno[i] || s.pole[i] !== 'leknin') continue;
    const tr = Math.floor(i / 8), tc = i % 8;
    if (tr === r && tc === c) continue;
    if (mojeZabyNa(s, h, tr, tc).length) continue;
    out.push([tr, tc]);
  }
  return out;
}

// Kam smí nová žabka po rozmnožení – volné sousední pole.
export function cilePlozeni(s, h, r, c) {
  const out = [];
  for (const [nr, nc] of sousedi(r, c)) {
    if (s.zakazano[index(nr, nc)]) continue;
    if (zabyNa(s, nr, nc).length) continue;   // „volné“ = úplně prázdné
    out.push([nr, nc]);
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

// Vyřadí hráče a smete z desky všechny jeho žáby.
function vyrad(n, h, duvod) {
  if (!n.hraci[h].zije) return;
  n.hraci[h].zije = false;
  for (const k of Object.keys(n.zaby)) {
    n.zaby[k] = n.zaby[k].filter(z => z.hrac !== h);
    if (!n.zaby[k].length) delete n.zaby[k];
  }
  rekni(n, `${jmeno(h)} ${duvod}`);
}

// ── Konec tahu ───────────────────────────────────────────────
//  Přeskakuje mrtvé a vyřadí toho, kdo se nemá čím hnout.
function dalsi(n) {
  n.faze = 'tah';
  n.vybrana = null;
  n.bezPokroku = n.pokrok ? 0 : n.bezPokroku + 1;
  n.pokrok = false;

  for (let i = 0; i < n.hracu + 1; i++) {
    n.naTahu = (n.naTahu + 1) % n.hracu;
    if (!n.hraci[n.naTahu].zije) continue;
    if (tahy(n, n.naTahu).length) break;
    // Zablokovaný hráč končí – pravidlo „nemůže provést žádný platný tah“.
    vyrad(n, n.naTahu, 'nemá kam skočit a končí.');
  }
  dohrano(n);
}

// Rybník vyschl. Rozhoduje se ve třech krocích, ať remíza zůstane
// poslední možností: počet žab (královna za dvě), pak kolik žabek se
// komu podařilo vyplodit, pak tlak na cizí královny.
function skore(n, h) {
  const zaby = vsechnyZaby(n, h);
  const vyplozeno = ZASOBA - n.hraci[h].zasoba;
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
    const porovnej = nejS === null ? 1 : (sc[0] - nejS[0]) || (sc[1] - nejS[1]) || (sc[2] - nejS[2]);
    if (porovnej > 0) { nejS = sc; nej = h; remiza = false; }
    else if (porovnej === 0) remiza = true;
  }
  n.vitez = remiza || nej < 0 ? -1 : nej;
  n.faze = 'konec';
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
    n.vitez = zivi.length === 1 ? zivi[0] : -1;   // -1 = remíza
    n.faze = 'konec';
    rekni(n, zivi.length === 1 ? `${jmeno(zivi[0])} vyhrál!` : 'Remíza – rybník je prázdný.');
    return;
  }
  if (n.bezPokroku >= BEZ_POKROKU) vyschlo(n);
}

// ── Efekt kartičky ───────────────────────────────────────────
//  `zPolozeni` = žabka sem byla položena při rozmnožování, ne skočila.
//  Vrací true, když tah pokračuje (komár, výběr leknínu, plození).
function efekt(n, h, r, c, kralovna, zPolozeni) {
  const i = index(r, c);
  const druh = n.pole[i];

  if (druh === 'stika') {
    // Odhalená štika je pro všechny navždy zavřená.
    n.zakazano[i] = true;
    if (kralovna) {
      rekni(n, 'Štika! Královna se jí nelekla, ale tah končí.');
      return false;
    }
    seber(n, r, c, h, false);
    n.pokrok = true;
    rekni(n, `Štika sežrala žabku ${jmeno(h)}.`);
    return false;
  }

  if (druh === 'komar') {
    if (n.snezeno[i]) return false;   // tenhle už někdo snědl
    n.snezeno[i] = true;
    // Tah navíc má cenu jen tehdy, když je čím táhnout. Bez téhle
    // kontroly by se hráč se zablokovanými žabami zasekl na tahu navždy.
    if (!tahy(n, h).length) {
      rekni(n, 'Komár, ale žádná žába už nemá kam.');
      return false;
    }
    rekni(n, 'Komár! Táhneš ještě jednou.');
    n.faze = 'tah';
    n.vybrana = null;
    return true;
  }

  if (druh === 'leknin' && !zPolozeni) {
    if (!cileLekninu(n, h, r, c).length) return false;
    n.faze = 'leknin';
    n.vybrana = { r, c, kralovna };
    rekni(n, 'Leknín – můžeš přeskočit na jiný odhalený leknín.');
    return true;
  }

  if (druh === 'samec' && !zPolozeni && kralovna) {
    if (n.hraci[h].zasoba <= 0) {
      rekni(n, 'Sameček, ale zásoba žabek je prázdná.');
      return false;
    }
    if (!cilePlozeni(n, h, r, c).length) {
      rekni(n, 'Sameček, ale kolem není volné pole.');
      return false;
    }
    n.faze = 'plozeni';
    n.vybrana = { r, c, kralovna };
    rekni(n, 'Rozmnožování! Polož novou žabku vedle.');
    return true;
  }

  return false;
}

// Vyhodí soupeřovy žáby z pole. Na rákosu se nevyhazuje.
function vyhod(n, h, r, c) {
  const i = index(r, c);
  const seznam = n.zaby[klic(r, c)] || [];
  const cizi = seznam.filter(z => z.hrac !== h);
  if (!cizi.length) return;

  // Rákos kryje jen žabky. Královna si tam neodpočine.
  const chranene = n.pole[i] === 'rakos' ? cizi.filter(z => !z.kralovna) : [];
  const kOdstraneni = cizi.filter(z => !chranene.includes(z));
  if (chranene.length) {
    rekni(n, 'Rákos – žabku tady nevyhodíš, stoupne si vedle.');
  }
  for (const z of kOdstraneni) {
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
  if (n.vitez !== null || n.faze !== 'tah') return n;
  if (!naDesce(zR, zC) || !naDesce(naR, naC)) return n;
  if (!mojeZabyNa(n, h, zR, zC).some(z => z.kralovna === kralovna)) return n;
  if (!kamMuze(n, h, zR, zC).some(([r, c]) => r === naR && c === naC)) return n;

  const zaba = seber(n, zR, zC, h, kralovna);
  if (!zaba) return n;

  const i = index(naR, naC);
  if (!n.odhaleno[i]) n.pokrok = true;
  n.odhaleno[i] = true;
  n.minule[h] = klic(zR, zC);

  vyhod(n, h, naR, naC);
  poloz(n, naR, naC, zaba);
  n.akci++;

  const pokracuje = efekt(n, h, naR, naC, kralovna, false);
  if (!pokracuje && n.vitez === null) dalsi(n);
  else dohrano(n);
  return n;
}

// ── Leknín: přeskok, nebo odmítnutí ──────────────────────────
export function skok(s, naR, naC) {
  const n = kopie(s);
  const h = n.naTahu;
  if (n.vitez !== null || n.faze !== 'leknin' || !n.vybrana) return n;

  // null/mimo desku = hráč skákat nechce
  if (naR === null || naC === null) {
    n.akci++;
    rekni(n, 'Leknín zůstal nevyužitý.');
    dalsi(n);
    return n;
  }
  if (!cileLekninu(n, h, n.vybrana.r, n.vybrana.c).some(([r, c]) => r === naR && c === naC)) return n;

  const { r, c, kralovna } = n.vybrana;
  const zaba = seber(n, r, c, h, kralovna);
  if (!zaba) return n;

  vyhod(n, h, naR, naC);
  poloz(n, naR, naC, zaba);
  n.akci++;
  rekni(n, `${jmeno(h)} přeskočil na jiný leknín.`);

  // Cíl je z definice už odhalený leknín, takže nic dalšího nespouští.
  if (n.vitez === null) dalsi(n);
  else dohrano(n);
  return n;
}

// ── Rozmnožování: kam s novou žabkou ─────────────────────────
export function plozeni(s, naR, naC) {
  const n = kopie(s);
  const h = n.naTahu;
  if (n.vitez !== null || n.faze !== 'plozeni' || !n.vybrana) return n;
  if (!cilePlozeni(n, h, n.vybrana.r, n.vybrana.c).some(([r, c]) => r === naR && c === naC)) return n;
  if (n.hraci[h].zasoba <= 0) return n;

  n.hraci[h].zasoba--;
  n.pokrok = true;
  poloz(n, naR, naC, { hrac: h, kralovna: false });
  n.akci++;
  rekni(n, `${jmeno(h)} má novou žabku.`);

  n.odhaleno[index(naR, naC)] = true;

  n.faze = 'tah';
  n.vybrana = null;
  const pokracuje = efekt(n, h, naR, naC, false, true);
  if (!pokracuje && n.vitez === null) dalsi(n);
  else dohrano(n);
  return n;
}

// Vzdá tah – používá se, když hráč nechce skákat po leknínu.
export function vzdejSe(s) {
  return skok(s, null, null);
}

// Nouzový ventil: předat tah dál bez ohledu na fázi. Nemělo by se
// stát, ale radši to než nekonečná smyčka na serveru.
export function preskoc(s) {
  const n = kopie(s);
  if (n.vitez !== null) return n;
  n.akci++;
  dalsi(n);
  return n;
}
