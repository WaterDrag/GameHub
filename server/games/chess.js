// ─────────────────────────────────────────────────────────────
//  Šachy – tahová hra pro dva.
//
//  Server drží pozici a KAŽDÝ tah si sám ověří proti pravidlům ze
//  `shared/games/chess/pravidla.js`. Klient posílá jen „táhnu z e2 na e4";
//  kdo si v konzoli vymyslí nemožný tah, dostane ho zpátky odmítnutý.
//
//  Bot je alfa-beta prohledávání s hodnocením materiálu a postavení.
//  Tři obtížnosti se liší hloubkou a tím, jak často udělá chybu.
// ─────────────────────────────────────────────────────────────
import {
  novaHra, vsechnyTahy, tahyZ, proved, stavHry, zapis, jeSach, naPole,
  HODNOTY, BILY, CERNY, opak, radek, sloupec,
} from '../../shared/games/chess/pravidla.js';

const TAH_MS = 120000;        // po vypršení zahraje bot za tebe

const LEVELS = {
  easy:   { hloubka: 1, chyba: 0.35 },
  normal: { hloubka: 2, chyba: 0.08 },
  hard:   { hloubka: 3, chyba: 0 },
};

// Kam se která figura hodí. Čísla jsou z pohledu bílého, pro černého se
// tabulka obrátí. Bez toho bot tahá figury bez ladu a skladu, protože
// samotný materiál na začátku partie nic nerozliší.
const POZICE = {
  p: [0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0],
  j: [-50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50],
  s: [-20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20],
  v: [0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0],
  d: [-20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20],
};

// Hodnocení z pohledu bílého.
function ohodnot(s) {
  let v = 0;
  for (let i = 0; i < 64; i++) {
    const f = s.pole[i];
    if (!f) continue;
    const zrcadlo = f.b === BILY ? i : (7 - radek(i)) * 8 + sloupec(i);
    const hodnota = HODNOTY[f.t] + (POZICE[f.t]?.[zrcadlo] || 0);
    v += f.b === BILY ? hodnota : -hodnota;
  }
  return v;
}

function alfaBeta(s, hloubka, alfa, beta) {
  if (hloubka === 0) return ohodnot(s);
  const tahy = vsechnyTahy(s);
  if (!tahy.length) {
    // Mat je tím horší, čím dřív přijde – jinak by ho bot odkládal.
    if (jeSach(s, s.naTahu)) return s.naTahu === BILY ? -90000 - hloubka : 90000 + hloubka;
    return 0;
  }
  // Braní napřed – s lepším pořadím ořeže alfa-beta mnohem víc.
  tahy.sort((a, b) => (s.pole[b.na] ? HODNOTY[s.pole[b.na].t] : 0)
    - (s.pole[a.na] ? HODNOTY[s.pole[a.na].t] : 0));

  if (s.naTahu === BILY) {
    let nej = -Infinity;
    for (const t of tahy) {
      nej = Math.max(nej, alfaBeta(proved(s, t, true), hloubka - 1, alfa, beta));
      alfa = Math.max(alfa, nej);
      if (beta <= alfa) break;
    }
    return nej;
  }
  let nej = Infinity;
  for (const t of tahy) {
    nej = Math.min(nej, alfaBeta(proved(s, t, true), hloubka - 1, alfa, beta));
    beta = Math.min(beta, nej);
    if (beta <= alfa) break;
  }
  return nej;
}

export default {
  id: 'chess',
  title: 'Šachy',
  emoji: '♟️',
  desc: 'Klasika proti kamarádovi i botovi.',
  minPlayers: 1,
  maxPlayers: 2,
  realtime: false,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  createState({ players }) {
    const s = novaHra();
    return {
      hra: s,
      seats: players.map(p => p.uid),
      // První hráč má bílé, druhý černé.
      barvy: Object.fromEntries(players.map((p, i) => [p.uid, i === 0 ? BILY : CERNY])),
      protokol: [],
      posledni: null,
      deadline: Date.now() + TAH_MS,
      over: null,
    };
  },

  kdoJeNaTahu(state) {
    return state.seats.find(u => state.barvy[u] === state.hra.naTahu) || null;
  },

  onAction(state, player, msg, ctx) {
    if (state.over) return;
    if (msg?.a !== 'tah') return;
    const uid = player.uid;
    if (this.kdoJeNaTahu(state) !== uid) return ctx?.reject?.(player, 'Nejsi na tahu.');

    const od = Number(msg.od), na = Number(msg.na);
    if (!Number.isInteger(od) || !Number.isInteger(na)) return;

    // Server si tah najde mezi LEGÁLNÍMI – nic jiného neprojde.
    const mozne = tahyZ(state.hra, od).filter(t => t.na === na);
    if (!mozne.length) return ctx?.reject?.(player, 'Takhle to táhnout nejde.');
    const tah = mozne.find(t => !t.promo || t.promo === msg.promo) || mozne[0];

    this.zahraj(state, tah);
  },

  zahraj(state, tah) {
    state.protokol.push({
      cislo: state.hra.tah,
      bily: state.hra.naTahu === BILY,
      zapis: zapis(state.hra, tah),
    });
    state.posledni = { od: tah.od, na: tah.na };
    state.hra = proved(state.hra, tah);
    state.deadline = Date.now() + TAH_MS;
  },

  // Tahovka nemá vlastní smyčku, ale lhůtu na tah hlídat chceme –
  // jinak by parta čekala na někoho, kdo odešel od počítače.
  tick(state, dt, ctx) {
    if (state.over || Date.now() < state.deadline) return;
    const uid = this.kdoJeNaTahu(state);
    if (!uid) return;
    const hrac = ctx.players?.find(p => p.uid === uid);
    const tah = this.vyberTah(state, hrac?.botLevel || 'normal', ctx);
    if (tah) this.zahraj(state, tah);
    else state.deadline = Date.now() + TAH_MS;
  },

  botThink(state, player, ctx) {
    if (state.over) return null;
    if (this.kdoJeNaTahu(state) !== player.uid) return null;
    const tah = this.vyberTah(state, player.botLevel || 'normal', ctx);
    return tah ? { a: 'tah', od: tah.od, na: tah.na, promo: tah.promo } : null;
  },

  vyberTah(state, uroven, ctx) {
    const L = LEVELS[uroven] || LEVELS.normal;
    const tahy = vsechnyTahy(state.hra);
    if (!tahy.length) return null;

    // Snadný bot občas schválně šlápne vedle, ať se dá porazit.
    if (L.chyba && ctx?.rng && ctx.rng() < L.chyba) {
      return tahy[ctx.rng.int(0, tahy.length - 1)];
    }

    const bily = state.hra.naTahu === BILY;
    let nej = bily ? -Infinity : Infinity;
    let nejlepsi = [];
    for (const t of tahy) {
      const v = alfaBeta(proved(state.hra, t, true), L.hloubka - 1, -Infinity, Infinity);
      if (bily ? v > nej : v < nej) { nej = v; nejlepsi = [t]; }
      else if (v === nej) nejlepsi.push(t);
    }
    const i = ctx?.rng ? ctx.rng.int(0, nejlepsi.length - 1) : 0;
    return nejlepsi[i];
  },

  view(state, uid) {
    const naTahu = this.kdoJeNaTahu(state);
    const mojeBarva = state.barvy[uid] || BILY;
    return {
      pole: state.hra.pole,
      naTahu: state.hra.naTahu,
      mojeBarva,
      myTurn: naTahu === uid,
      // Legální tahy dostane jen ten, kdo je na tahu – klient podle nich
      // svítí pole. Server si je stejně počítá znovu při každém tahu.
      tahy: naTahu === uid ? vsechnyTahy(state.hra).map(t => ({
        od: t.od, na: t.na, promo: t.promo || null,
      })) : [],
      sach: jeSach(state.hra, state.hra.naTahu),
      posledni: state.posledni,
      protokol: state.protokol.slice(-40),
      cisloTahu: state.hra.tah,
      msLeft: Math.max(0, state.deadline - Date.now()),
      seats: state.seats.map(u => ({ uid: u, barva: state.barvy[u] })),
      zajate: this.zajate(state.hra.pole),
    };
  },

  // Co komu chybí na desce – z toho se dá dopočítat, co bylo sebráno.
  zajate(pole) {
    const plne = { p: 8, j: 2, s: 2, v: 2, d: 1 };
    const out = { [BILY]: [], [CERNY]: [] };
    for (const b of [BILY, CERNY]) {
      for (const [t, kolik] of Object.entries(plne)) {
        const zbylo = pole.filter(f => f && f.b === b && f.t === t).length;
        for (let i = 0; i < kolik - zbylo; i++) out[b].push(t);
      }
    }
    return out;
  },

  result(state) {
    if (state.over) return state.over;
    const konec = stavHry(state.hra);
    if (konec === 'hraje') return null;

    if (konec === 'mat') {
      // Matovaný je ten, kdo je na tahu – vyhrál soupeř.
      const prohral = this.kdoJeNaTahu(state);
      const vitez = state.seats.find(u => u !== prohral);
      state.over = vitez
        ? { winners: [vitez], reason: `Mat ve ${state.hra.tah}. tahu.` }
        : { draw: true, reason: 'Mat.' };
    } else {
      const duvod = {
        pat: 'Pat – hráč na tahu nemá kam táhnout.',
        padesat: 'Remíza – 50 tahů bez braní a bez pěšce.',
        material: 'Remíza – na mat už není čím.',
        opakovani: 'Remíza – trojí opakování pozice.',
      }[konec] || 'Remíza.';
      state.over = { draw: true, reason: duvod };
    }
    return state.over;
  },

  onPlayerGone(state, player) {
    if (state.over) return;
    const zbytek = state.seats.filter(u => u !== player.uid);
    if (zbytek.length === 1) {
      state.over = { winners: [zbytek[0]], reason: 'Soupeř odešel ze hry.' };
    }
  },
};
