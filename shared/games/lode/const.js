// ─────────────────────────────────────────────────────────────
//  Lodě pro čtyři – jedna SPOLEČNÁ mřížka.
//
//  Není to klasické „každý má svoje moře“. Všichni rozmístí lodě do
//  téže mřížky, můžou se překrývat, a kdo trefí pole, ubere všem,
//  kdo na něm mají loď. Kdo přijde o všechny lodě, končí.
//
//  Rozměry desky se odvíjejí od počtu hráčů – při pevných 9×9 by
//  ve čtyřech bylo obsazeno 59 % polí a slepá rána by trefovala
//  častěji než míjela (naměřeno, viz `tools/test-lode.mjs`).
// ─────────────────────────────────────────────────────────────

export const LODE = [
  { id: 's4', delka: 4, nazev: 'Bitevník' },
  { id: 's3a', delka: 3, nazev: 'Křižník' },
  { id: 's3b', delka: 3, nazev: 'Křižník' },
  { id: 's2', delka: 2, nazev: 'Torpédoborec' },
];

export const POLI_LODI = LODE.reduce((a, l) => a + l.delka, 0);   // 12

// Strana mřížky podle počtu hráčů. Cíl je držet obsazenost kolem 30 %,
// aby slepá rána spíš minula a hledání dávalo smysl.
export const STRANA = (hracu) => (hracu <= 2 ? 9 : hracu === 3 ? 11 : 12);

export const BARVY = ['#7eb8c9', '#c9a87e', '#9ec97e', '#c97e9e'];
export const PISMENA = 'ABCDEFGHIJKLMNOP';

// Speciální střely. Cena je v bodech, body se získávají za zásahy.
//
// Body jsou ČISTÁ MĚNA – utrácení nesnižuje skóre (to je počet potopených
// políček), takže se speciál vyplatí vždycky, když na něj máš.
//
// Ceny musí sedět na POKRYTÍ, jinak je jedna střela prostě lepší. Původně
// bomba 9 polí za 3 (3,0 na bod) a řádek 9 za 5 (1,8) – řádek neměl smysl
// nikdy. Teď bomba 9 za 4 (2,25) a linie 12 za 5 (2,4): linie odkryje víc
// polí, ale rozesetých, takže se hůř doráží začatá loď.
export const STRELY = {
  normal: { cena: 0, nazev: 'Střela', emoji: '🎯', popis: 'Jedno pole.' },
  bomba: { cena: 4, nazev: 'Bomba 3×3', emoji: '💥', popis: 'Devět polí kolem cíle.' },
  radek: { cena: 5, nazev: 'Řádek', emoji: '➡', popis: 'Celý řádek.' },
  sloupec: { cena: 5, nazev: 'Sloupec', emoji: '⬇', popis: 'Celý sloupec.' },
};

// Kolik ran po sobě smí jeden hráč vypálit. Zásah dává ránu navíc,
// ale ne donekonečna – bez stropu by první hráč na tak obsazené desce
// řetězil rány přes půlku moře (naměřeno).
export const RAN_ZA_TAH = 3;

export const idx = (strana, x, y) => y * strana + x;
export const naDesce = (strana, x, y) => x >= 0 && y >= 0 && x < strana && y < strana;

export function sousedi(strana, x, y) {
  const out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (naDesce(strana, x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
  }
  return out;
}

// Pole, která by loď zabrala. `null`, když by přesahovala.
export function poleLodi(strana, x, y, delka, svisle) {
  const out = [];
  for (let i = 0; i < delka; i++) {
    const cx = svisle ? x : x + i;
    const cy = svisle ? y + i : y;
    if (!naDesce(strana, cx, cy)) return null;
    out.push({ x: cx, y: cy });
  }
  return out;
}

// Náhodné rozmístění – používá ho bot i „rozmísti za mě“.
// Vlastní lodě se nesmí překrývat; cizí ano, to je celý vtip hry.
export function nahodneRozmisteni(strana, rng) {
  for (let pokus = 0; pokus < 200; pokus++) {
    const obsazeno = new Set();
    const lode = [];
    let ok = true;
    for (const l of LODE) {
      let umisteno = null;
      for (let i = 0; i < 120 && !umisteno; i++) {
        const svisle = rng() < 0.5;
        const x = rng.int(0, strana - 1);
        const y = rng.int(0, strana - 1);
        const pole = poleLodi(strana, x, y, l.delka, svisle);
        if (!pole) continue;
        if (pole.some(p => obsazeno.has(`${p.x},${p.y}`))) continue;
        umisteno = pole;
      }
      if (!umisteno) { ok = false; break; }
      for (const p of umisteno) obsazeno.add(`${p.x},${p.y}`);
      lode.push(umisteno);
    }
    if (ok) return lode;
  }
  return null;
}
