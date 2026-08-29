// ─────────────────────────────────────────────────────────────
//  Šachy – pravidla.
//
//  Sdílené: server podle nich tah VALIDUJE, klient podle nich jen
//  zvýrazňuje, kam smí táhnout. Kdo si v konzoli povolí nemožný tah,
//  dostane ho zpátky odmítnutý – server se klienta na nic neptá.
//
//  Deska je pole 64 polí, index 0 = a8 (vlevo nahoře z pohledu bílého),
//  index 63 = h1. Řádek r = 0 je 8. řada, sloupec c = 0 je sloupec „a".
// ─────────────────────────────────────────────────────────────

export const BILY = 'b';
export const CERNY = 'c';
export const opak = (barva) => (barva === BILY ? CERNY : BILY);

// p = pěšec, j = jezdec, s = střelec, v = věž, d = dáma, k = král
export const HODNOTY = { p: 100, j: 320, s: 330, v: 500, d: 900, k: 20000 };

export const idx = (r, c) => r * 8 + c;
export const radek = (i) => Math.floor(i / 8);
export const sloupec = (i) => i % 8;
export const naDesce = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

// „e4" ↔ index
export const naPole = (i) => 'abcdefgh'[sloupec(i)] + (8 - radek(i));
export const zPole = (s) => idx(8 - Number(s[1]), 'abcdefgh'.indexOf(s[0]));

const ZAKLADNI = 'vjsdksjv';

export function novaHra() {
  const pole = new Array(64).fill(null);
  for (let c = 0; c < 8; c++) {
    pole[idx(0, c)] = { t: ZAKLADNI[c], b: CERNY };
    pole[idx(1, c)] = { t: 'p', b: CERNY };
    pole[idx(6, c)] = { t: 'p', b: BILY };
    pole[idx(7, c)] = { t: ZAKLADNI[c], b: BILY };
  }
  return {
    pole,
    naTahu: BILY,
    // Práva na rošádu mizí, jakmile se král nebo věž pohne.
    roch: { bK: true, bD: true, cK: true, cD: true },
    ep: null,          // pole, kam smí brát mimochodem
    pulTahy: 0,        // tahů bez braní a bez pěšce (pravidlo 50 tahů)
    tah: 1,
    pozice: {},        // kolikrát se pozice opakovala
  };
}

export const kopie = (s) => ({
  pole: s.pole.slice(),
  naTahu: s.naTahu,
  roch: { ...s.roch },
  ep: s.ep,
  pulTahy: s.pulTahy,
  tah: s.tah,
  pozice: { ...s.pozice },
});

// ── Ohrožení ─────────────────────────────────────────────────
const SMERY = {
  j: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]],
  s: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  v: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  k: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
};
SMERY.d = [...SMERY.s, ...SMERY.v];

// Útočí barva `b` na pole `cil`? Pěšce je nutné řešit zvlášť, protože
// berou jinak, než táhnou.
export function utoci(pole, cil, b) {
  const r = radek(cil), c = sloupec(cil);

  const smerPesce = b === BILY ? 1 : -1;   // pěšec bílého útočí „nahoru"
  for (const dc of [-1, 1]) {
    const rr = r + smerPesce, cc = c + dc;
    if (!naDesce(rr, cc)) continue;
    const f = pole[idx(rr, cc)];
    if (f && f.b === b && f.t === 'p') return true;
  }

  for (const [dr, dc] of SMERY.j) {
    const rr = r + dr, cc = c + dc;
    if (!naDesce(rr, cc)) continue;
    const f = pole[idx(rr, cc)];
    if (f && f.b === b && f.t === 'j') return true;
  }

  for (const [dr, dc] of SMERY.k) {
    const rr = r + dr, cc = c + dc;
    if (!naDesce(rr, cc)) continue;
    const f = pole[idx(rr, cc)];
    if (f && f.b === b && f.t === 'k') return true;
  }

  for (const [typ, smery] of [['s', SMERY.s], ['v', SMERY.v]]) {
    for (const [dr, dc] of smery) {
      let rr = r + dr, cc = c + dc;
      while (naDesce(rr, cc)) {
        const f = pole[idx(rr, cc)];
        if (f) {
          if (f.b === b && (f.t === typ || f.t === 'd')) return true;
          break;
        }
        rr += dr; cc += dc;
      }
    }
  }
  return false;
}

export function kralNa(pole, b) {
  for (let i = 0; i < 64; i++) {
    const f = pole[i];
    if (f && f.b === b && f.t === 'k') return i;
  }
  return -1;
}

export function jeSach(stav, b) {
  const k = kralNa(stav.pole, b);
  return k >= 0 && utoci(stav.pole, k, opak(b));
}

// ── Tahy jedné figury (bez ohledu na vlastního krále) ────────
function pseudoTahy(stav, od) {
  const f = stav.pole[od];
  if (!f) return [];
  const out = [];
  const r = radek(od), c = sloupec(od);
  const moje = f.b;

  const pridej = (rr, cc, extra = {}) => {
    if (!naDesce(rr, cc)) return false;
    const cil = idx(rr, cc);
    const t = stav.pole[cil];
    if (t && t.b === moje) return false;
    out.push({ od, na: cil, ...extra });
    return !t;                       // pokračovat v paprsku jen po prázdném
  };

  if (f.t === 'p') {
    const smer = moje === BILY ? -1 : 1;
    const startRada = moje === BILY ? 6 : 1;
    const promoRada = moje === BILY ? 0 : 7;

    // dopředu
    if (naDesce(r + smer, c) && !stav.pole[idx(r + smer, c)]) {
      if (r + smer === promoRada) {
        for (const p of ['d', 'v', 's', 'j']) out.push({ od, na: idx(r + smer, c), promo: p });
      } else {
        out.push({ od, na: idx(r + smer, c) });
        if (r === startRada && !stav.pole[idx(r + 2 * smer, c)]) {
          out.push({ od, na: idx(r + 2 * smer, c), dvojkrok: true });
        }
      }
    }
    // braní
    for (const dc of [-1, 1]) {
      const rr = r + smer, cc = c + dc;
      if (!naDesce(rr, cc)) continue;
      const cil = idx(rr, cc);
      const t = stav.pole[cil];
      if (t && t.b !== moje) {
        if (rr === promoRada) {
          for (const p of ['d', 'v', 's', 'j']) out.push({ od, na: cil, promo: p });
        } else out.push({ od, na: cil });
      } else if (!t && stav.ep === cil) {
        out.push({ od, na: cil, mimochodem: true });
      }
    }
    return out;
  }

  if (f.t === 'j' || f.t === 'k') {
    for (const [dr, dc] of SMERY[f.t]) pridej(r + dr, c + dc);
  } else {
    for (const [dr, dc] of SMERY[f.t]) {
      let rr = r + dr, cc = c + dc;
      while (pridej(rr, cc)) { rr += dr; cc += dc; }
    }
  }

  // Rošáda: král se nesmí nacházet v šachu, projít přes napadené pole
  // ani na napadené doskočit; mezi ním a věží musí být prázdno.
  if (f.t === 'k') {
    const rada = moje === BILY ? 7 : 0;
    if (od === idx(rada, 4) && !utoci(stav.pole, od, opak(moje))) {
      const kratka = moje === BILY ? stav.roch.bK : stav.roch.cK;
      const dlouha = moje === BILY ? stav.roch.bD : stav.roch.cD;
      const prazdno = (...cc) => cc.every(x => !stav.pole[idx(rada, x)]);
      const bezpecne = (...cc) => cc.every(x => !utoci(stav.pole, idx(rada, x), opak(moje)));

      if (kratka && prazdno(5, 6) && bezpecne(5, 6)) {
        const v = stav.pole[idx(rada, 7)];
        if (v && v.t === 'v' && v.b === moje) out.push({ od, na: idx(rada, 6), roch: 'K' });
      }
      if (dlouha && prazdno(1, 2, 3) && bezpecne(2, 3)) {
        const v = stav.pole[idx(rada, 0)];
        if (v && v.t === 'v' && v.b === moje) out.push({ od, na: idx(rada, 2), roch: 'D' });
      }
    }
  }
  return out;
}

// ── Legální tahy ─────────────────────────────────────────────
export function tahyZ(stav, od) {
  const f = stav.pole[od];
  if (!f || f.b !== stav.naTahu) return [];
  return pseudoTahy(stav, od).filter(t => {
    const po = proved(stav, t, true);
    return !jeSach({ ...po, naTahu: stav.naTahu }, stav.naTahu);
  });
}

export function vsechnyTahy(stav) {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const f = stav.pole[i];
    if (f && f.b === stav.naTahu) out.push(...tahyZ(stav, i));
  }
  return out;
}

// ── Provedení tahu ───────────────────────────────────────────
export function proved(stav, tah, tiche = false) {
  const s = kopie(stav);
  const f = s.pole[tah.od];
  if (!f) return s;
  const moje = f.b;
  const bral = !!s.pole[tah.na] || tah.mimochodem;

  s.pole[tah.na] = tah.promo ? { t: tah.promo, b: moje } : f;
  s.pole[tah.od] = null;

  if (tah.mimochodem) {
    // Sebraný pěšec stojí VEDLE cílového pole, ne na něm.
    const smer = moje === BILY ? 1 : -1;
    s.pole[idx(radek(tah.na) + smer, sloupec(tah.na))] = null;
  }

  if (tah.roch) {
    const rada = moje === BILY ? 7 : 0;
    if (tah.roch === 'K') {
      s.pole[idx(rada, 5)] = s.pole[idx(rada, 7)];
      s.pole[idx(rada, 7)] = null;
    } else {
      s.pole[idx(rada, 3)] = s.pole[idx(rada, 0)];
      s.pole[idx(rada, 0)] = null;
    }
  }

  // Práva na rošádu
  if (f.t === 'k') {
    if (moje === BILY) { s.roch.bK = false; s.roch.bD = false; }
    else { s.roch.cK = false; s.roch.cD = false; }
  }
  const zrus = (i) => {
    if (i === idx(7, 0)) s.roch.bD = false;
    if (i === idx(7, 7)) s.roch.bK = false;
    if (i === idx(0, 0)) s.roch.cD = false;
    if (i === idx(0, 7)) s.roch.cK = false;
  };
  zrus(tah.od); zrus(tah.na);

  s.ep = tah.dvojkrok ? idx((radek(tah.od) + radek(tah.na)) / 2, sloupec(tah.od)) : null;
  s.pulTahy = (bral || f.t === 'p') ? 0 : s.pulTahy + 1;
  if (moje === CERNY) s.tah++;
  s.naTahu = opak(moje);

  if (!tiche) {
    const k = klic(s);
    s.pozice[k] = (s.pozice[k] || 0) + 1;
  }
  return s;
}

// Otisk pozice pro trojí opakování – co se opakuje, musí sedět včetně
// práv na rošádu a braní mimochodem, ne jen rozestavení figur.
export function klic(s) {
  let out = '';
  for (const f of s.pole) out += f ? (f.b === BILY ? f.t.toUpperCase() : f.t) : '.';
  return out + s.naTahu + (s.roch.bK ? 'K' : '') + (s.roch.bD ? 'D' : '')
    + (s.roch.cK ? 'k' : '') + (s.roch.cD ? 'd' : '') + (s.ep ?? '-');
}

// ── Konec partie ─────────────────────────────────────────────
export function malMaterial(pole) {
  const f = pole.filter(Boolean);
  if (f.length > 4) return false;
  const bezKralu = f.filter(x => x.t !== 'k').map(x => x.t).sort().join('');
  // Král proti králi, král a lehká figura, dva střelci (zjednodušeně).
  return ['', 'j', 's', 'jj', 'ss', 'js'].includes(bezKralu);
}

export function stavHry(s) {
  const tahy = vsechnyTahy(s);
  if (!tahy.length) return jeSach(s, s.naTahu) ? 'mat' : 'pat';
  if (s.pulTahy >= 100) return 'padesat';
  if (malMaterial(s.pole)) return 'material';
  if ((s.pozice[klic(s)] || 0) >= 3) return 'opakovani';
  return 'hraje';
}

// Zápis tahu do protokolu: "Jf3", "exd5", "O-O", "Dh5#"
export function zapis(stav, tah) {
  const f = stav.pole[tah.od];
  if (!f) return '?';
  if (tah.roch) return tah.roch === 'K' ? 'O-O' : 'O-O-O';
  const znak = { p: '', j: 'J', s: 'S', v: 'V', d: 'D', k: 'K' }[f.t];
  const bral = !!stav.pole[tah.na] || tah.mimochodem;
  const zac = f.t === 'p' ? (bral ? 'abcdefgh'[sloupec(tah.od)] : '') : znak;

  // Rozlišení, když může táhnout víc stejných figur na totéž pole.
  let rozliseni = '';
  if (f.t !== 'p' && f.t !== 'k') {
    const jini = vsechnyTahy(stav).filter(t =>
      t.na === tah.na && t.od !== tah.od && stav.pole[t.od]?.t === f.t);
    if (jini.length) {
      rozliseni = jini.some(t => sloupec(t.od) === sloupec(tah.od))
        ? String(8 - radek(tah.od))
        : 'abcdefgh'[sloupec(tah.od)];
    }
  }

  const po = proved(stav, tah, true);
  const konec = vsechnyTahy(po).length === 0
    ? (jeSach(po, po.naTahu) ? '#' : '') : (jeSach(po, po.naTahu) ? '+' : '');

  return zac + rozliseni + (bral ? 'x' : '') + naPole(tah.na)
    + (tah.promo ? '=' + { j: 'J', s: 'S', v: 'V', d: 'D' }[tah.promo] : '') + konec;
}
