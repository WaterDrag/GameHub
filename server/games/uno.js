// ─────────────────────────────────────────────────────────────
//  UNO No Mercy – 2 až 8 hráčů.
//
//  Pravidla jsou v `shared/games/uno/pravidla.js`, server je jediný,
//  kdo je vyhodnocuje.
//
//  KARTY V RUCE JSOU TAJNÉ. `view()` posílá každému jen jeho vlastní
//  ruku, ostatním jen počty. V předloze ležely všechny ruce v databázi,
//  takže si kdokoliv mohl v konzoli přečíst karty soupeřů – u karetní
//  hry je to horší než podvádět s kostkou.
//
//  Balíček míchá server svým RNG, ne prohlížeč.
// ─────────────────────────────────────────────────────────────
import {
  novaHra, moznosti, zahraj, lizni, rekniUno, nachytej, vymen, cileVymeny,
  lzeHrat, vrch, zije, zivi, poradi,
} from '../../shared/games/uno/pravidla.js';
import {
  BARVY, DIVOKA, MILOST, novyBalicek, trestZa, jeDivoka, jeCislo, znak, nazevZnaku,
  BARVA_INFO,
} from '../../shared/games/uno/karty.js';
import { TIMING } from '../../shared/constants.js';

const TAH_MS = 60000;      // kolik má člověk na tah
const BOT_MS = TIMING.BOT_KROK_MS;   // 1,4 akce na tah → plný krok
const LOG_MAX = 8;

// ── Bot ──────────────────────────────────────────────────────
// Barva, které mám v ruce nejvíc. Divoké se nepočítají.
function nejcastejsiBarva(ruka, rng) {
  const pocty = Object.fromEntries(BARVY.map(b => [b, 0]));
  for (const k of ruka) if (!jeDivoka(k)) pocty[k.b]++;
  let nej = BARVY[0], nejV = -1;
  for (const b of BARVY) if (pocty[b] > nejV) { nejV = pocty[b]; nej = b; }
  return nejV > 0 ? nej : rng.pick(BARVY);
}

// Čím vyšší číslo, tím radši kartu zahraju.
function cena(s, karta, ruka, tvrdy) {
  const t = trestZa(karta.z);
  let v = 0;

  if (s.trest > 0) {
    // V souboji o trest je lepší přihodit co nejmíň, ať zůstane munice.
    return 100 - t;
  }

  if (t > 0) v += 55 + t * 3;               // trestat je dobré
  else if (karta.z === 'stop') v += 40;
  else if (karta.z === 'stopVsem') v += 50; // hraju znovu
  else if (karta.z === 'obrat') v += 30;
  else if (karta.z === 'vyhod') {
    // Výhoz je tím lepší, čím víc karet té barvy mi odejde.
    v += 20 + ruka.filter(k => k.b === karta.b).length * 12;
  } else v += 10 + Number(karta.z || 0) * 0.4;

  // Divoké si tvrdý bot schovává – jsou vždycky hratelné.
  if (jeDivoka(karta)) v -= tvrdy ? 35 : 15;
  return v;
}

function vyberKartu(s, level, rng) {
  const moz = moznosti(s);
  if (!moz.length) return null;
  if (level === 'easy') return rng.pick(moz);

  const ruka = s.ruce[s.naTahu];
  const tvrdy = level === 'hard';
  let nej = moz[0], nejV = -Infinity;
  for (const i of moz) {
    const v = cena(s, ruka[i], ruka, tvrdy);
    if (v > nejV) { nejV = v; nej = i; }
  }
  return nej;
}

// ── Modul ────────────────────────────────────────────────────
export default {
  id: 'uno',
  title: 'UNO No Mercy',
  emoji: '🃏',
  desc: 'Tresty se stohují, 25 karet znamená konec. Až pro 8 hráčů.',
  minPlayers: 2,
  maxPlayers: 8,
  realtime: false,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  createState({ players, rng }) {
    const seats = rng.shuffle(players.map(p => p.uid));
    const hra = novaHra(seats.length, rng.shuffle(novyBalicek()));
    hra.naTahu = rng.int(0, seats.length - 1);

    const state = { hra, seats, log: [], deadline: 0, botAt: 0 };
    this.zapis(state, 'Hra začíná. Bez milosti!');
    this.prepocti(state, null);
    return state;
  },

  zapis(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_MAX) state.log.shift();
  },

  jmeno(ctx, uid) {
    return ctx?.players?.find(p => p.uid === uid)?.name || 'Hráč';
  },

  // Lhůty se přepočítají po každé změně stavu, ne v ticku – tam by se
  // deadline přepisoval pořád dokola a lidem by nikdy nedošel čas.
  prepocti(state, ctx) {
    const s = state.hra;
    state.botAt = 0;
    if (s.vitez !== null) { state.deadline = 0; return; }
    const now = Date.now();
    const hrac = ctx?.players?.find(p => p.uid === state.seats[s.naTahu]);
    if (hrac?.bot || hrac?.botControlled) state.botAt = now + BOT_MS;
    state.deadline = now + TAH_MS;
  },

  // ── Akce hráče ─────────────────────────────────────────────
  onAction(state, player, msg, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    const seat = state.seats.indexOf(player.uid);
    if (seat < 0) return;

    // Nachytat a říct UNO smí hráč i mimo svůj tah.
    if (msg.a === 'nachytej') {
      if (s.unoOhrozeny === null) return ctx.reject(player, 'Není koho chytat.');
      if (s.unoOhrozeny === seat) return ctx.reject(player, 'Sám sebe nenachytáš.');
      return this.nachytat(state, seat, ctx);
    }
    if (msg.a === 'uno') {
      state.hra = rekniUno(s, seat);
      return;
    }

    if (s.vymena && s.vymena.hrac !== seat) return ctx.reject(player, 'Čeká se na výměnu karet.');
    if (!s.vymena && state.seats[s.naTahu] !== player.uid) return ctx.reject(player, 'Nejsi na tahu.');

    if (msg.a === 'zahraj') {
      const idx = msg.idx | 0;
      if (!moznosti(s).includes(idx)) return ctx.reject(player, 'Tuhle kartu teď zahrát nejde.');
      return this.zahrat(state, idx, msg.barva, ctx);
    }
    if (msg.a === 'lizni') {
      if (s.musiZahrat !== null) return ctx.reject(player, 'Líznutou kartu musíš zahrát.');
      return this.liznout(state, ctx);
    }
    if (msg.a === 'vymen') {
      if (!s.vymena) return ctx.reject(player, 'Teď se nevyměňuje.');
      if (s.vymena.hrac !== seat) return ctx.reject(player, 'Vybírá někdo jiný.');
      return this.vymenit(state, msg.cil | 0, ctx);
    }
  },

  vymenit(state, cil, ctx) {
    const s = state.hra;
    const kdo = this.jmeno(ctx, state.seats[s.vymena.hrac]);
    state.hra = vymen(s, cil);
    if (state.hra.vymena) return;                 // neplatný cíl
    this.zapis(state, `🔄 ${kdo} si vyměnil karty s ${this.jmeno(ctx, state.seats[cil])}.`);
    ctx.emit('vymena', { kdo: s.vymena.hrac, cil });
    if (state.hra.vitez !== null) this.zapis(state, `${this.jmeno(ctx, state.seats[state.hra.vitez])} vyhrál!`);
    this.prepocti(state, ctx);
  },

  zahrat(state, idx, barva, ctx) {
    const s = state.hra;
    const kdo = this.jmeno(ctx, state.seats[s.naTahu]);
    const karta = s.ruce[s.naTahu][idx];
    const predVyrazenych = s.vyrazeni.length;

    state.hra = zahraj(s, idx, barva);
    const n = state.hra;

    const barvaText = jeDivoka(karta) ? ` → ${BARVA_INFO[n.barva]?.nazev || n.barva}` : '';
    this.zapis(state, `${kdo} zahrál ${nazevZnaku(karta.z)}${barvaText}.`);
    if (n.hlaska) this.zapis(state, `${kdo}: ${n.hlaska.text}`);
    if (n.trest > s.trest) this.zapis(state, `Trest narostl na +${n.trest}.`);
    if (n.unoOhrozeny !== null) this.zapis(state, `${kdo} zapomněl říct UNO!`);

    ctx.emit('karta', { seat: s.naTahu, karta, barva: n.barva });
    if (n.vitez !== null) this.zapis(state, `${kdo} vyhrál!`);
    this.prepocti(state, ctx);
  },

  liznout(state, ctx) {
    const s = state.hra;
    const kdo = this.jmeno(ctx, state.seats[s.naTahu]);
    const predVyrazenych = s.vyrazeni.length;

    state.hra = lizni(s);
    const n = state.hra;
    if (n.hlaska) this.zapis(state, `${kdo} ${n.hlaska.text}`);
    else if (n.musiLizat) this.zapis(state, `${kdo} líže dál.`);

    if (n.vyrazeni.length > predVyrazenych) {
      const ven = n.vyrazeni[n.vyrazeni.length - 1];
      this.zapis(state, `💀 ${this.jmeno(ctx, state.seats[ven])} je venku – ${n.milost} karet.`);
      ctx.emit('vyrazen', { seat: ven });
    }
    if (n.vitez !== null) this.zapis(state, `${this.jmeno(ctx, state.seats[n.vitez])} vyhrál!`);
    this.prepocti(state, ctx);
  },

  nachytat(state, kdo, ctx) {
    const s = state.hra;
    const obet = s.unoOhrozeny;
    state.hra = nachytej(s, kdo);
    if (state.hra.unoOhrozeny === s.unoOhrozeny) return;   // neprošlo
    this.zapis(state, `🚨 ${this.jmeno(ctx, state.seats[kdo])} nachytal ${this.jmeno(ctx, state.seats[obet])} – dvě karty navíc.`);
    ctx.emit('nachytnuti', { kdo, obet });
    this.prepocti(state, ctx);
  },

  // ── Hodiny ─────────────────────────────────────────────────
  tick(state, dt, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    const now = Date.now();

    // Kdo je bot, se pozná až z `ctx`, které `createState` nedostává.
    if (!state.botAt) {
      const kdo = ctx?.players?.find(p => p.uid === state.seats[s.naTahu]);
      if (kdo?.bot || kdo?.botControlled) state.botAt = now + BOT_MS;
    }

    if (state.botAt && now >= state.botAt) return this.zahrajZa(state, ctx, null);
    if (state.deadline && now >= state.deadline) {
      this.zapis(state, `${this.jmeno(ctx, state.seats[s.naTahu])} nestihl tah, hraje za něj bot.`);
      return this.zahrajZa(state, ctx, 'normal');
    }
  },

  zahrajZa(state, ctx, vnuceny) {
    const s = state.hra;
    const hrac = ctx.players?.find(p => p.uid === state.seats[s.naTahu]);
    const level = vnuceny || hrac?.botLevel || 'normal';

    // Nachytat cizí zapomenuté UNO – tohle bot dělá i mimo svůj tah,
    // ale řeší se to tady, ať je jen jedno místo, kde boti jednají.
    if (s.unoOhrozeny !== null && s.unoOhrozeny !== s.naTahu && level !== 'easy') {
      return this.nachytat(state, s.naTahu, ctx);
    }

    // Předposlední karta – slušný bot UNO řekne, easy na to zapomíná.
    if (s.ruce[s.naTahu].length === 2 && !s.reklUno[s.naTahu]) {
      if (level !== 'easy' || ctx.rng() < 0.4) state.hra = rekniUno(s, s.naTahu);
    }

    // Sedmička čeká na výběr protějšku. Bere se ten s nejmíň kartami –
    // vyměnit si velkou ruku za malou je celý smysl té karty.
    if (s.vymena) {
      const cile = cileVymeny(s);
      if (!cile.length) { state.botAt = 0; return; }
      let nej = cile[0];
      for (const c of cile) if (s.ruce[c].length < s.ruce[nej].length) nej = c;
      return this.vymenit(state, level === 'easy' ? ctx.rng.pick(cile) : nej, ctx);
    }

    const idx = vyberKartu(state.hra, level, ctx.rng);
    if (idx !== null) {
      const karta = state.hra.ruce[state.hra.naTahu][idx];
      const barva = jeDivoka(karta)
        ? (level === 'easy' ? ctx.rng.pick(BARVY) : nejcastejsiBarva(state.hra.ruce[state.hra.naTahu], ctx.rng))
        : null;
      return this.zahrat(state, idx, barva, ctx);
    }

    // Nemá co hrát – líže. Líznutou hratelnou kartu pak musí zahrát,
    // což zařídí `moznosti` v dalším kroku.
    return this.liznout(state, ctx);
  },

  botThink() { return null; },

  // ── Pohled ─────────────────────────────────────────────────
  //  Tohle je jádro celé hry: každý dostane JEN SVOJE karty.
  view(state, uid) {
    const s = state.hra;
    const seat = state.seats.indexOf(uid);
    const myTurn = seat === s.naTahu && s.vitez === null;
    const now = Date.now();

    return {
      hracu: s.hracu,
      seats: state.seats,
      mySeat: seat,
      myTurn,
      ruka: seat >= 0 ? s.ruce[seat] : [],       // jen moje karty
      pocty: s.ruce.map(r => r.length),          // ostatním jen počet
      vrch: vrch(s),
      barva: s.barva,
      trest: s.trest,
      smer: s.smer,
      naTahu: s.naTahu,
      balicku: s.balicek.length,
      odhozu: s.odhoz.length,
      milost: s.milost,
      moznosti: myTurn ? moznosti(s) : [],
      musiLizat: myTurn && s.musiLizat,
      musiZahrat: myTurn ? s.musiZahrat : null,
      vymena: s.vymena,
      cileVymeny: s.vymena && s.vymena.hrac === seat ? cileVymeny(s) : [],
      unoOhrozeny: s.unoOhrozeny,
      muzuUno: myTurn && seat >= 0 && s.ruce[seat].length === 2 && !s.reklUno[seat],
      vyrazeni: s.vyrazeni,
      vitez: s.vitez,
      casLeft: state.deadline ? Math.max(0, state.deadline - now) : 0,
      log: state.log,
    };
  },

  result(state) {
    const s = state.hra;
    if (s.vitez === null) return null;
    return {
      winners: [state.seats[s.vitez]],
      reason: 'Došly karty!',
      poradi: poradi(s).map(h => state.seats[h]),
    };
  },
};
