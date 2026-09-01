// ─────────────────────────────────────────────────────────────
//  Piškvorky – tři režimy nad jedním jádrem.
//
//    • malé      3×3, tři v řadě (klasika na papír)
//    • klasika   15×15, pět v řadě (co tu bylo doteď)
//    • ultimate  devět desek 3×3; kam zahraješ v malé desce,
//                tam musí soupeř hrát tu velkou
//
//  Čisté funkce, žádná náhoda – server je jen volá a hlídá, kdo je
//  na tahu. Klient si legální tahy nepočítá, dostává je hotové.
// ─────────────────────────────────────────────────────────────

export const REZIMY = [
  {
    id: 'male', nazev: 'Malé 3×3', emoji: '⭕',
    popis: 'Klasika na papír. Tři v řadě.',
    strana: 3, vyhra: 3, ultimate: false,
  },
  {
    id: 'klasika', nazev: 'Velké 15×15', emoji: '⬛',
    popis: 'Pět v řadě na velké desce.',
    strana: 15, vyhra: 5, ultimate: false,
  },
  {
    id: 'ultimate', nazev: 'Ultimátní', emoji: '🎯',
    popis: 'Devět desek 3×3. Kam zahraješ, tam soupeř hraje.',
    strana: 3, vyhra: 3, ultimate: true,
  },
];

export const VYCHOZI_REZIM = 'klasika';
export const rezimNebo = (id) => REZIMY.find(r => r.id === id) || REZIMY.find(r => r.id === VYCHOZI_REZIM);

// 3 = remíza, používá se u velké desky v ultimate
export const REMIZA = 3;

const SMERY = [[1, 0], [0, 1], [1, 1], [1, -1]];

export const idx = (strana, x, y) => y * strana + x;
export const naDesce = (strana, x, y) => x >= 0 && y >= 0 && x < strana && y < strana;

// ── Výhra ────────────────────────────────────────────────────
// Vrací pole souřadnic výherní řady, nebo null.
export function vyherniRada(board, strana, vyhra, x, y, znak) {
  for (const [dx, dy] of SMERY) {
    const rada = [{ x, y }];
    for (const s of [1, -1]) {
      let i = 1;
      while (naDesce(strana, x + dx * i * s, y + dy * i * s)
        && board[idx(strana, x + dx * i * s, y + dy * i * s)] === znak) {
        rada.push({ x: x + dx * i * s, y: y + dy * i * s });
        i++;
      }
    }
    if (rada.length >= vyhra) return rada;
  }
  return null;
}

// Kdo vyhrál malou desku 3×3? Vrací 1, 2, REMIZA nebo 0.
export function stavMaleDesky(deska) {
  for (let i = 0; i < 9; i++) {
    if (!deska[i]) continue;
    if (vyherniRada(deska, 3, 3, i % 3, Math.floor(i / 3), deska[i])) return deska[i];
  }
  return deska.every(v => v !== 0) ? REMIZA : 0;
}

// ── Nová hra ─────────────────────────────────────────────────
export function novaHra(rezimId) {
  const r = rezimNebo(rezimId);
  const s = {
    rezim: r.id,
    strana: r.strana,
    vyhra: r.vyhra,
    ultimate: r.ultimate,
    turn: 0,
    tahu: 0,
    winner: null,      // uid doplní server; tady 1 | 2 | 'draw'
    winLine: null,
    lastMove: null,
    akci: 0,
  };
  if (r.ultimate) {
    s.desky = Array.from({ length: 9 }, () => new Array(9).fill(0));
    s.velke = new Array(9).fill(0);
    s.aktivni = null;    // null = smí se kamkoliv
  } else {
    s.board = new Array(r.strana * r.strana).fill(0);
  }
  return s;
}

const kopie = (s) => JSON.parse(JSON.stringify(s));

// ── Legální tahy ─────────────────────────────────────────────
//  Klasika: {x,y}. Ultimate: {velka, mala}.
export function lzeTah(s, tah) {
  if (s.winner !== null) return false;
  if (s.ultimate) {
    const { velka, mala } = tah;
    if (!(velka >= 0 && velka < 9 && mala >= 0 && mala < 9)) return false;
    if (s.velke[velka] !== 0) return false;                  // deska je dohraná
    if (s.aktivni !== null && s.aktivni !== velka) return false;
    return s.desky[velka][mala] === 0;
  }
  const { x, y } = tah;
  if (!naDesce(s.strana, x, y)) return false;
  return s.board[idx(s.strana, x, y)] === 0;
}

export function tahy(s) {
  if (s.winner !== null) return [];
  const out = [];
  if (s.ultimate) {
    for (let v = 0; v < 9; v++) {
      if (s.velke[v] !== 0) continue;
      if (s.aktivni !== null && s.aktivni !== v) continue;
      for (let m = 0; m < 9; m++) if (s.desky[v][m] === 0) out.push({ velka: v, mala: m });
    }
    return out;
  }
  for (let y = 0; y < s.strana; y++) {
    for (let x = 0; x < s.strana; x++) if (!s.board[idx(s.strana, x, y)]) out.push({ x, y });
  }
  return out;
}

// ── Tah ──────────────────────────────────────────────────────
export function tah(s, t) {
  if (!lzeTah(s, t)) return s;
  const n = kopie(s);
  const znak = n.turn + 1;
  n.akci++;
  n.tahu++;

  if (n.ultimate) {
    const { velka, mala } = t;
    n.desky[velka][mala] = znak;
    n.lastMove = { velka, mala, seat: n.turn };

    // Dohrála se tím malá deska?
    const stav = stavMaleDesky(n.desky[velka]);
    if (stav) n.velke[velka] = stav;

    // A velká? Remízové desky se do řady nepočítají.
    const proRadu = n.velke.map(v => (v === REMIZA ? 0 : v));
    const rada = stav && stav !== REMIZA
      ? vyherniRada(proRadu, 3, 3, velka % 3, Math.floor(velka / 3), znak)
      : null;
    if (rada) {
      n.winner = znak;
      n.winLine = rada;
      return n;
    }
    if (n.velke.every(v => v !== 0)) { n.winner = 'draw'; return n; }

    // Kam se pošle soupeř. Na dohranou desku se neposílá – tam by
    // neměl co hrát, takže si vybere sám.
    n.aktivni = n.velke[mala] !== 0 ? null : mala;
    n.turn = 1 - n.turn;
    return n;
  }

  const { x, y } = t;
  n.board[idx(n.strana, x, y)] = znak;
  n.lastMove = { x, y, seat: n.turn };
  const rada = vyherniRada(n.board, n.strana, n.vyhra, x, y, znak);
  if (rada) { n.winner = znak; n.winLine = rada; return n; }
  if (n.tahu >= n.strana * n.strana) { n.winner = 'draw'; return n; }
  n.turn = 1 - n.turn;
  return n;
}
