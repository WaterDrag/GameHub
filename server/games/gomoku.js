// ─────────────────────────────────────────────────────────────
//  Piškvorky – tři režimy: malé 3×3, velké 15×15 a ultimátní.
//
//  Pravidla jsou v `shared/games/gomoku/pravidla.js` a vyhodnocuje je
//  jenom server. Klient smí poslat jen souřadnice; jestli je na tahu,
//  jestli je políčko volné a jestli někdo vyhrál, rozhoduje server.
// ─────────────────────────────────────────────────────────────
import {
  REZIMY, VYCHOZI_REZIM, rezimNebo, REMIZA,
  novaHra, tah, tahy, lzeTah, idx, naDesce, vyherniRada, stavMaleDesky,
} from '../../shared/games/gomoku/pravidla.js';
import { TIMING } from '../../shared/constants.js';

const TAH_MS = 60000;

// ── Heuristika pro desku libovolné velikosti ─────────────────
// Vrací sílu tahu na (x,y) pro hráče `p` ve směru (dx,dy):
// kolik kamenů by vzniklo v řadě a kolik má řada otevřených konců.
function liniovaCena(board, strana, vyhra, x, y, dx, dy, p) {
  let pocet = 1, otevrenych = 0;
  for (const s of [1, -1]) {
    let i = 1;
    while (naDesce(strana, x + dx * i * s, y + dy * i * s)
      && board[idx(strana, x + dx * i * s, y + dy * i * s)] === p) { pocet++; i++; }
    const ex = x + dx * i * s, ey = y + dy * i * s;
    if (naDesce(strana, ex, ey) && board[idx(strana, ex, ey)] === 0) otevrenych++;
  }
  if (pocet >= vyhra) return 100000000;
  if (pocet === vyhra - 1) return otevrenych === 2 ? 1000000 : otevrenych === 1 ? 100000 : 0;
  if (pocet === vyhra - 2) return otevrenych === 2 ? 50000 : otevrenych === 1 ? 5000 : 0;
  if (pocet === vyhra - 3) return otevrenych === 2 ? 500 : otevrenych === 1 ? 50 : 0;
  return otevrenych === 2 ? 10 : otevrenych === 1 ? 1 : 0;
}

function cenaTahu(board, strana, vyhra, x, y, p) {
  let s = 0;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    s += liniovaCena(board, strana, vyhra, x, y, dx, dy, p);
  }
  return s;
}

// Kandidáti = volná pole do vzdálenosti 2 od nějakého kamene.
// Bez tohohle ořezu by bot na prázdné desce 15×15 zvažoval 225 polí zbytečně.
function kandidati(board, strana) {
  const out = [];
  if (board.every(v => v === 0)) return [{ x: Math.floor(strana / 2), y: Math.floor(strana / 2) }];
  for (let y = 0; y < strana; y++) {
    for (let x = 0; x < strana; x++) {
      if (board[idx(strana, x, y)] !== 0) continue;
      let blizko = false;
      for (let dy = -2; dy <= 2 && !blizko; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!naDesce(strana, x + dx, y + dy)) continue;
          if (board[idx(strana, x + dx, y + dy)] !== 0) { blizko = true; break; }
        }
      }
      if (blizko) out.push({ x, y });
    }
  }
  if (out.length) return out;
  // Deska bez volného pole u kamene (malé 3×3 na konci) – ber cokoliv volného.
  for (let y = 0; y < strana; y++) {
    for (let x = 0; x < strana; x++) if (!board[idx(strana, x, y)]) out.push({ x, y });
  }
  return out;
}

export default {
  id: 'gomoku',
  title: 'Piškvorky',
  emoji: '⭕',
  desc: 'Malé 3×3, velké 15×15, nebo ultimátní devět desek naráz.',
  minPlayers: 2,
  maxPlayers: 2,
  realtime: false,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  optionsTitle: 'Režim',
  options: [
    {
      key: 'rezim',
      typ: 'volba',
      label: 'Deska',
      def: VYCHOZI_REZIM,
      volby: REZIMY.map(r => ({ v: r.id, label: r.nazev, emoji: r.emoji, desc: r.popis })),
    },
  ],

  createState({ players, rng, options }) {
    const seats = rng.shuffle(players.map(p => p.uid));  // kdo začíná je náhoda ze serveru
    return {
      hra: novaHra(options?.rezim),
      seats,
      deadline: Date.now() + TAH_MS,
      botAt: 0,
    };
  },

  jeBot(state, ctx, seat) {
    const p = ctx?.players?.find(x => x.uid === state.seats[seat]);
    return !!(p?.bot || p?.botControlled);
  },

  prepocti(state, ctx) {
    state.botAt = 0;
    if (state.hra.winner !== null) { state.deadline = 0; return; }
    const now = Date.now();
    if (this.jeBot(state, ctx, state.hra.turn)) state.botAt = now + TIMING.BOT_KROK_MS;
    state.deadline = now + TAH_MS;
  },

  // ── Tah hráče ────────────────────────────────────────────
  onAction(state, player, msg, ctx) {
    const s = state.hra;
    if (s.winner !== null) return;
    const seat = state.seats.indexOf(player.uid);
    if (seat < 0) return;
    if (s.turn !== seat) return ctx.reject(player, 'Nejsi na tahu.');

    const t = s.ultimate
      ? { velka: msg.velka | 0, mala: msg.mala | 0 }
      : { x: msg.x | 0, y: msg.y | 0 };
    if (!lzeTah(s, t)) return ctx.reject(player, 'Tam se hrát nedá.');

    state.hra = tah(s, t);
    ctx.emit('move', { ...t, seat });
    this.prepocti(state, ctx);
  },

  tick(state, dt, ctx) {
    const s = state.hra;
    if (s.winner !== null) return;
    const now = Date.now();
    if (!state.botAt && this.jeBot(state, ctx, s.turn)) state.botAt = now + TIMING.BOT_KROK_MS;
    if (state.botAt && now >= state.botAt) return this.zahrajZa(state, ctx, null);
    if (state.deadline && now >= state.deadline) return this.zahrajZa(state, ctx, 'normal');
  },

  zahrajZa(state, ctx, vnuceny) {
    const s = state.hra;
    const hrac = ctx.players?.find(p => p.uid === state.seats[s.turn]);
    const level = vnuceny || hrac?.botLevel || 'normal';
    const t = this.vyberTah(s, level, ctx.rng);
    if (!t) return;
    const seat = s.turn;
    state.hra = tah(s, t);
    ctx.emit?.('move', { ...t, seat });
    this.prepocti(state, ctx);
  },

  // ── Bot ──────────────────────────────────────────────────
  vyberTah(s, level, rng) {
    return s.ultimate ? this.botUltimate(s, level, rng) : this.botKlasika(s, level, rng);
  },

  botKlasika(s, level, rng) {
    const me = s.turn + 1;
    const opp = 2 - s.turn;
    const cands = kandidati(s.board, s.strana);
    if (!cands.length) return null;

    const scored = cands.map(c => {
      const utok = cenaTahu(s.board, s.strana, s.vyhra, c.x, c.y, me);
      const obrana = cenaTahu(s.board, s.strana, s.vyhra, c.x, c.y, opp);
      // Útok mírně přebíjí obranu – jinak bot jen brání a nikdy nevyhraje.
      return { ...c, s: utok + obrana * 0.92 };
    }).sort((a, b) => b.s - a.s);

    if (level === 'easy') {
      // Občas zahraje hloupě, ale výhru/prohru v jednom tahu pozná.
      if (scored[0].s < 100000 && rng() < 0.35) return rng.pick(scored.slice(0, Math.min(8, scored.length)));
      return rng.pick(scored.slice(0, Math.min(3, scored.length)));
    }

    if (level === 'hard' && scored[0].s < 1000000) {
      // Dvě půltahy dopředu: zahraj tak, aby soupeřova nejlepší
      // odpověď byla co nejslabší.
      let nej = scored[0], nejV = -Infinity;
      for (const c of scored.slice(0, 8)) {
        s.board[idx(s.strana, c.x, c.y)] = me;
        let oppNej = 0;
        for (const r of kandidati(s.board, s.strana).slice(0, 24)) {
          const v = cenaTahu(s.board, s.strana, s.vyhra, r.x, r.y, opp)
            + cenaTahu(s.board, s.strana, s.vyhra, r.x, r.y, me) * 0.9;
          if (v > oppNej) oppNej = v;
        }
        s.board[idx(s.strana, c.x, c.y)] = 0;
        const val = c.s - oppNej * 0.85;
        if (val > nejV) { nejV = val; nej = c; }
      }
      return nej;
    }

    return scored[0];
  },

  // ── Bot pro ultimátní ────────────────────────────────────
  //  Hodnotí tři věci naráz: co tah udělá v malé desce, co udělá na
  //  velké, a KAM tím pošle soupeře. To poslední rozhoduje partie –
  //  poslat soupeře do desky, kterou si vezme, je horší než nevyhrát
  //  vlastní.
  botUltimate(s, level, rng) {
    const me = s.turn + 1;
    const opp = 2 - s.turn;
    const moznosti = tahy(s);
    if (!moznosti.length) return null;

    const ohodnocene = moznosti.map(t => ({ ...t, v: this.cenaUltimate(s, t, me, opp, level) }))
      .sort((a, b) => b.v - a.v);

    if (level === 'easy') {
      // Nehraje náhodně – jen si mezi slušnými tahy vybírá nepřesně.
      const kolik = Math.max(1, Math.ceil(ohodnocene.length * 0.4));
      return rng.pick(ohodnocene.slice(0, kolik));
    }
    const nej = ohodnocene[0].v;
    return rng.pick(ohodnocene.filter(x => x.v === nej));
  },

  cenaUltimate(s, t, me, opp, level) {
    const { velka, mala } = t;
    let v = 0;

    // 1) Co to udělá v malé desce.
    const po = s.desky[velka].slice();
    po[mala] = me;
    const stav = stavMaleDesky(po);
    if (stav === me) {
      v += 900;
      // Deska, která dotáhne velkou řadu, je rovnou výhra.
      const velkePo = s.velke.map(x => (x === REMIZA ? 0 : x));
      velkePo[velka] = me;
      if (vyherniRada(velkePo, 3, 3, velka % 3, Math.floor(velka / 3), me)) v += 100000;
      v += this.cenaPole(velka) * 12;
    } else {
      v += this.cenaMale(po, me, opp) - this.cenaMale(s.desky[velka], me, opp);
      if (this.hrozbaVDesce(po, opp)) v -= 260;   // desku by si vzal soupeř
    }

    // 2) Kam tím pošlu soupeře. Tohle rozhoduje partie.
    const cil = s.velke[mala] !== 0 ? null : mala;
    if (cil === null) {
      v -= 320;                        // volná ruka je pro soupeře největší dárek
    } else {
      const cilova = mala === velka ? po : s.desky[cil];
      if (this.hrozbaVDesce(cilova, opp)) v -= 420;    // tam si desku rovnou vezme
      else if (this.hrozbaVDesce(cilova, me)) v += 90; // tam mi naopak nemůže bránit zadarmo
      v -= this.cenaPole(cil) * 4;
    }

    // 3) Tvrdý bot navíc nedaruje desku, která by soupeři dotáhla velkou řadu.
    if (level === 'hard' && stav !== me) {
      const velkePo = s.velke.map(x => (x === REMIZA ? 0 : x));
      velkePo[velka] = opp;
      if (vyherniRada(velkePo, 3, 3, velka % 3, Math.floor(velka / 3), opp)
        && this.hrozbaVDesce(po, opp)) v -= 5000;
    }
    return v;
  },

  // Střed a rohy jsou v 3×3 cennější než strany.
  cenaPole(i) { return i === 4 ? 4 : (i % 2 === 0 ? 3 : 1); },

  // Má hráč v desce políčko, kterým ji hned vyhraje?
  hrozbaVDesce(deska, hrac) {
    for (let i = 0; i < 9; i++) {
      if (deska[i] !== 0) continue;
      const zkus = deska.slice();
      zkus[i] = hrac;
      if (stavMaleDesky(zkus) === hrac) return true;
    }
    return false;
  },

  cenaMale(deska, me, opp) {
    let v = 0;
    for (let i = 0; i < 9; i++) {
      if (deska[i] === me) v += this.cenaPole(i) * 2;
      else if (deska[i] === opp) v -= this.cenaPole(i) * 2;
    }
    if (this.hrozbaVDesce(deska, me)) v += 40;
    if (this.hrozbaVDesce(deska, opp)) v -= 40;
    return v;
  },

  botThink() { return null; },

  // Celý stav je veřejný – u piškvorek není co skrývat.
  view(state, uid) {
    const s = state.hra;
    const seat = state.seats.indexOf(uid);
    return {
      rezim: s.rezim,
      strana: s.strana,
      vyhra: s.vyhra,
      ultimate: s.ultimate,
      board: s.board || null,
      desky: s.desky || null,
      velke: s.velke || null,
      aktivni: s.ultimate ? s.aktivni : null,
      seats: state.seats,
      turn: s.turn,
      lastMove: s.lastMove,
      winner: s.winner === null ? null
        : (s.winner === 'draw' ? 'draw' : state.seats[s.winner - 1]),
      winLine: s.winLine,
      mySeat: seat,
      myTurn: seat >= 0 && seat === s.turn && s.winner === null,
      turnMsLeft: Math.max(0, state.deadline - Date.now()),
    };
  },

  result(state) {
    const s = state.hra;
    if (s.winner === null) return null;
    if (s.winner === 'draw') return { draw: true, reason: 'Remíza – deska je plná.' };
    const r = rezimNebo(s.rezim);
    return {
      winners: [state.seats[s.winner - 1]],
      reason: r.ultimate ? 'Tři desky v řadě!' : `${r.vyhra} v řadě!`,
    };
  },
};
