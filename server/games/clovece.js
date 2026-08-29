// ─────────────────────────────────────────────────────────────
//  Člověče, nezlob se – 2 až 8 hráčů.
//
//  Pravidla jsou v `shared/games/clovece/pravidla.js` a server je jediný,
//  kdo je vyhodnocuje. Klient posílá jen „házím“ a „táhnu figurkou 2“.
//
//  Kostkou hází SERVER svým RNG. V předloze ji losoval prohlížeč přes
//  Math.random() a výsledek zapisoval do databáze – kdo si otevřel
//  konzoli, mohl si hodit šestku pokaždé.
//
//  Když je možný jediný tah, server ho po vteřině zahraje sám. Není to
//  kosmetika na klientu: kdyby si to dokresloval každý prohlížeč po
//  svém, rozešly by se stavy. Takhle to vidí všichni stejně.
// ─────────────────────────────────────────────────────────────
import {
  novaHra, tahy, hod, tah, maxPokusu, hotovych, poradi,
} from '../../shared/games/clovece/pravidla.js';
import {
  MAPY, MAPA_PODLE, VYCHOZI_MAPA, mapaNebo,
  FIGUREK_MIN, FIGUREK_MAX, okruh, naOkruhu, barvaRamene,
  odhadHodu, odhadMinut, odhadText,
} from '../../shared/games/clovece/const.js';

const HOD_MS = 60000;      // kolik má člověk na hod
const TAH_MS = 60000;      // a kolik na výběr figurky
const AUTO_MS = 1000;      // jediná možnost se zahraje sama
const BOT_HOD_MS = 800;    // bot schválně nehraje okamžitě, ať se to dá sledovat
const BOT_TAH_MS = 900;
const LOG_MAX = 8;

// ── Bot ──────────────────────────────────────────────────────
// Kolik soupeřů může na tohle pole dosáhnout jedním hodem.
function ohrozeni(s, hrac, krok) {
  const m = MAPA_PODLE[s.mapa];
  const O = okruh(m);
  if (krok < 0 || krok >= O) return 0;          // v domečku ani v cíli na mě nikdo nemůže
  const pole = naOkruhu(m, s.ramena[hrac], krok);

  let n = 0;
  for (let h = 0; h < s.hracu; h++) {
    if (h === hrac) continue;
    for (let f = 0; f < s.figurek; f++) {
      const k = s.poz[h][f];
      if (k < 0) {
        // Z domečku se dá vyskočit jen na vlastní start, a jen za šestku.
        if (pole === naOkruhu(m, s.ramena[h], 0)) n++;
        continue;
      }
      if (k >= O) continue;                      // ten už je v cíli
      const d = (pole - naOkruhu(m, s.ramena[h], k) + O) % O;
      // Musí to na mě dojít jedním hodem a nesmí mu to spadnout do cíle.
      if (d >= 1 && d <= 6 && k + d < O) n++;
    }
  }
  return n;
}

function ohodnot(s, t, tvrdy) {
  const m = MAPA_PODLE[s.mapa];
  const O = okruh(m);
  let v = 0;

  // Vyhodit soupeře je tím cennější, čím dál byl.
  if (t.vyhodi) v += 60 + s.poz[t.vyhodi.hrac][t.vyhodi.fig] * 1.2;
  // Dostat figurku do cíle.
  if (t.na >= O) v += 45 + (t.na - O) * 5;
  // Vytáhnout z domečku – figurka v domečku nedělá nic.
  if (t.z < 0) v += 25;
  // A obecně jít dopředu.
  v += (t.na - Math.max(t.z, 0)) * 0.5;

  if (!tvrdy) return v;

  // Těžký bot navíc kouká, kam se tím postaví. Tah se doopravdy zkusí –
  // pravidla jsou čistá funkce, takže to nic nerozbije.
  const po = tah(s, t.fig);
  v -= ohrozeni(po, s.naTahu, t.na) * 20;
  v += ohrozeni(s, s.naTahu, t.z) * 14;      // utéct z ohroženého pole je taky zisk
  return v;
}

function vyberTah(s, level, rng) {
  const t = tahy(s);
  if (!t.length) return null;
  if (t.length === 1) return t[0];

  // Easy hraje doopravdy náhodně. Když jen "občas" chyboval, vycházel
  // z měření stejně dobře jako hard – rozdíl se v kostkách ztratil.
  if (level === 'easy') return rng.pick(t);

  const tvrdy = level === 'hard';
  let nej = t[0], nejV = -Infinity;
  for (const x of t) {
    const v = ohodnot(s, x, tvrdy);
    if (v > nejV) { nejV = v; nej = x; }
  }
  return nej;
}

// ── Modul ────────────────────────────────────────────────────
export default {
  id: 'clovece',
  title: 'Člověče, nezlob se',
  emoji: '🎲',
  desc: 'Vyhoď soupeře a dostaň své figurky domů. Až pro 8 hráčů na velké desce.',
  minPlayers: 2,
  maxPlayers: 8,
  realtime: false,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  optionsTitle: 'Nastavení hry',
  options: [
    {
      key: 'mapa',
      typ: 'volba',               // ne zaškrtávátko – vybírá se z možností
      label: 'Deska',
      def: VYCHOZI_MAPA,
      volby: MAPY.map(m => ({ v: m.id, label: m.nazev, emoji: m.emoji, desc: m.popis })),
    },
    {
      key: 'figurek',
      typ: 'volba',
      label: 'Figurek na hráče',
      def: 4,
      // Tímhle se řídí délka partie – proto u každé možnosti odhad,
      // který se v lobby přepočítá podle skutečného počtu hráčů.
      volby: [4, 3, 2, 1].map(n => ({ v: n, label: `${n}`, desc: null })),
    },
  ],

  // Hub se ptá, jestli volby sedí k počtu hráčů. Pravidlo zná hra, ne hub:
  // na klasický kříž se vejdou čtyři ramena, takže od pěti hráčů výš
  // není co vybírat a volba se zamkne na velkou desku.
  normalizeOptions(options, pocetHracu) {
    const out = { ...options };
    if (!MAPA_PODLE[out.mapa]) out.mapa = VYCHOZI_MAPA;
    const zamky = {};
    if (pocetHracu > 4) {
      out.mapa = 'velka';
      zamky.mapa = 'Na klasickou desku se vejdou jen čtyři hráči.';
    }

    const m = MAPA_PODLE[out.mapa];
    let f = Number(out.figurek);
    if (!Number.isFinite(f)) f = m.figurekDef;
    out.figurek = Math.max(FIGUREK_MIN, Math.min(FIGUREK_MAX, Math.round(f)));

    // Odhad délky – ať hostitel vidí, co si tou volbou kupuje.
    const h = Math.max(2, pocetHracu);
    const popisky = {};
    for (const n of [4, 3, 2, 1]) popisky[n] = odhadText(out.mapa, h, n);
    return {
      options: out,
      zamky,
      info: {
        figurek: popisky,
        odhad: odhadText(out.mapa, h, out.figurek),
        odhadHodu: odhadHodu(out.mapa, h, out.figurek),
      },
    };
  },

  createState({ players, rng, options }) {
    const seats = rng.shuffle(players.map(p => p.uid));
    // Pojistka: kdyby se do místnosti někdo vešel až po výběru desky.
    const { options: opt } = this.normalizeOptions(options || {}, seats.length);
    const hra = novaHra(opt.mapa, seats.length, opt.figurek, rng.int(0, seats.length - 1));

    const state = {
      hra,
      seats,
      log: [],
      deadline: 0,
      autoAt: 0,
      botAt: 0,
    };
    this.zapis(state, 'Hra začíná. Šestka tě dostane z domečku.');
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

  // Po každé změně stavu se přepočítají lhůty. Schválně to NENÍ v ticku –
  // tam by se deadline přepisoval pořád dokola a lidem by nikdy nedošel čas
  // (na tuhle past jsem už narazil v Dostizích).
  prepocti(state, ctx) {
    const s = state.hra;
    state.autoAt = 0;
    state.botAt = 0;
    if (s.vitez !== null) { state.deadline = 0; return; }

    const now = Date.now();
    const hrac = ctx?.players?.find(p => p.uid === state.seats[s.naTahu]);
    const bot = !!(hrac?.bot || hrac?.botControlled);

    if (s.hozeno) {
      // Jediná možnost se nevybírá – zahraje se sama.
      if (tahy(s).length <= 1) state.autoAt = now + AUTO_MS;
      else if (bot) state.botAt = now + BOT_TAH_MS;
      state.deadline = now + TAH_MS;
    } else {
      if (bot) state.botAt = now + BOT_HOD_MS;
      state.deadline = now + HOD_MS;
    }
  },

  // ── Akce hráče ─────────────────────────────────────────────
  onAction(state, player, msg, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    if (state.seats[s.naTahu] !== player.uid) return ctx.reject(player, 'Nejsi na tahu.');

    if (msg.a === 'hod') {
      if (s.hozeno) return ctx.reject(player, 'Kostka už padla, vyber figurku.');
      return this.hodit(state, ctx);
    }

    if (msg.a === 'tah') {
      if (!s.hozeno) return ctx.reject(player, 'Nejdřív hoď kostkou.');
      const fig = msg.fig | 0;
      if (!tahy(s).some(t => t.fig === fig)) return ctx.reject(player, 'Touhle figurkou to nejde.');
      return this.tahnout(state, fig, ctx);
    }
  },

  hodit(state, ctx) {
    const s = state.hra;
    const kdo = this.jmeno(ctx, state.seats[s.naTahu]);
    const kostka = ctx.rng.int(1, 6);
    const predtim = s.naTahu;

    state.hra = hod(s, kostka);
    const n = state.hra;

    if (n.hozeno) {
      this.zapis(state, `${kdo} hodil ${kostka}.`);
    } else if (n.naTahu !== predtim) {
      this.zapis(state, `${kdo} hodil ${kostka} a nemá tah. Konec tahu.`);
    } else {
      const p = n.pokusy;
      this.zapis(state, `${kdo} hodil ${kostka} – nemá tah, zbývá ${p} ${p === 1 ? 'pokus' : 'pokusy'}.`);
    }

    ctx.emit('kostka', { seat: predtim, hodnota: kostka });
    this.prepocti(state, ctx);
  },

  tahnout(state, fig, ctx) {
    const s = state.hra;
    const kdo = this.jmeno(ctx, state.seats[s.naTahu]);
    const t = tahy(s).find(x => x.fig === fig);
    const sest = s.kostka === 6;

    state.hra = tah(s, fig);
    const n = state.hra;

    if (t?.vyhodi) {
      const obet = this.jmeno(ctx, state.seats[t.vyhodi.hrac]);
      this.zapis(state, `${kdo} vyhodil ${obet} zpátky domů!`);
      ctx.emit('vyhozeni', { kdo: s.naTahu, komu: t.vyhodi.hrac });
    } else if (n.vitez === null && sest) {
      this.zapis(state, `${kdo} táhl a hází znovu (šestka).`);
    }

    if (n.vitez !== null) {
      this.zapis(state, `${kdo} má všechny figurky doma. Vyhrál!`);
      ctx.emit('vitez', { seat: n.vitez });
    }

    this.prepocti(state, ctx);
  },

  // ── Hodiny ─────────────────────────────────────────────────
  tick(state, dt, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    const now = Date.now();

    // Jediná možnost – zahraje se sama, ať už za člověka nebo za bota.
    if (state.autoAt && now >= state.autoAt) {
      const t = tahy(s);
      if (t.length === 1) return this.tahnout(state, t[0].fig, ctx);
      // Kostka padla, ale není čím táhnout – tenhle stav pravidla neumí
      // vytvořit (hod() by tah rovnou přepnul), takže jen dorovnáme lhůty.
      state.autoAt = 0;
      return;
    }

    if (state.botAt && now >= state.botAt) return this.zahrajZa(state, ctx, null);

    if (state.deadline && now >= state.deadline) {
      const uid = state.seats[s.naTahu];
      this.zapis(state, `${this.jmeno(ctx, uid)} nestihl tah, hraje za něj bot.`);
      return this.zahrajZa(state, ctx, 'normal');
    }
  },

  zahrajZa(state, ctx, vnuceny) {
    const s = state.hra;
    const hrac = ctx.players?.find(p => p.uid === state.seats[s.naTahu]);
    const level = vnuceny || hrac?.botLevel || 'normal';
    if (!s.hozeno) return this.hodit(state, ctx);
    const t = vyberTah(s, level, ctx.rng);
    if (!t) { state.botAt = 0; return; }
    return this.tahnout(state, t.fig, ctx);
  },

  // ── Bot ────────────────────────────────────────────────────
  // Boti se řídí stejnou cestou jako lidi – přes onAction to neposíláme,
  // protože tahy generuje tick podle vlastních lhůt.
  botThink() { return null; },

  // ── Pohled ─────────────────────────────────────────────────
  // Deska ani kostka nejsou tajemství, posílá se všechno. Seznam tahů
  // dostane jen ten, kdo je na tahu – ostatním by k ničemu nebyl.
  view(state, uid) {
    const s = state.hra;
    const m = mapaNebo(s.mapa);
    const seat = state.seats.indexOf(uid);
    const myTurn = seat === s.naTahu && s.vitez === null;
    const now = Date.now();

    return {
      mapa: s.mapa,
      ramen: m.ramen,
      figurek: s.figurek,
      hracu: s.hracu,
      ramena: s.ramena,
      barvy: s.ramena.map(r => barvaRamene(r).id),
      poz: s.poz,
      naTahu: s.naTahu,
      kostka: s.kostka,
      hozeno: s.hozeno,
      pokusy: s.pokusy ?? maxPokusu(s),
      maxPokusu: maxPokusu(s),
      posledni: s.posledni,
      vitez: s.vitez,
      seats: state.seats,
      mySeat: seat,
      myTurn,
      tahy: myTurn && s.hozeno ? tahy(s) : [],
      hotovo: Array.from({ length: s.hracu }, (_, h) => hotovych(s, h)),
      autoZa: state.autoAt ? Math.max(0, state.autoAt - now) : 0,
      casLeft: state.deadline ? Math.max(0, state.deadline - now) : 0,
      log: state.log,
    };
  },

  result(state) {
    const s = state.hra;
    if (s.vitez === null) return null;
    const p = poradi(s);
    return {
      winners: [state.seats[s.vitez]],
      reason: 'Všechny čtyři figurky doma!',
      poradi: p.map(h => state.seats[h]),
    };
  },
};
