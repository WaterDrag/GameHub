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
  snipe, sniperCile, obetuj, lzeObetovat, obetovatelne,
} from '../../shared/games/clovece/pravidla.js';
import { MODY, NERVY_SANCE } from '../../shared/games/clovece/mody.js';
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
  const po = tah(s, t.fig, t.couv);
  v -= ohrozeni(po, s.naTahu, t.na) * 20;
  v += ohrozeni(s, s.naTahu, t.z) * 14;      // utéct z ohroženého pole je taky zisk
  return v;
}

// Vyplatí se teď obětovat? Dvě figurky za jednu stojí za to jen tehdy,
// když je cíl výrazně dál než ty moje, kterých se vzdávám.
function obetTah(s, level) {
  if (level === 'easy') return null;          // easy neplánuje
  if (!lzeObetovat(s)) return null;
  const moje = obetovatelne(s).sort((a, b) => s.poz[s.naTahu][a] - s.poz[s.naTahu][b]);
  const cile = sniperCile(s, s.naTahu);
  if (moje.length < 2 || !cile.length) return null;

  let nej = cile[0];
  for (const c of cile) if (s.poz[c.hrac][c.fig] > s.poz[nej.hrac][nej.fig]) nej = c;

  // Práh je NAMĚŘENÝ, ne odhadnutý. Bot, který obětuje při každé
  // příležitosti, prohrává (38,2 % výher proti botovi, co neobětuje,
  // −5,3 σ) – dvě figurky do domečku jsou v Člověče drahé, protože
  // zpátky se dostanou jen za šestku. Až kolem prahu 8 je to vyrovnané.
  // Nižší číslo by boty poškodilo, vyšší by mód nikdy nespustilo.
  const cena = s.poz[s.naTahu][moje[0]] + s.poz[s.naTahu][moje[1]];
  const zisk = s.poz[nej.hrac][nej.fig];
  const prah = level === 'hard' ? 8 : 12;
  if (zisk - cena < prah) return null;
  return { a1: moje[0], a2: moje[1], hrac: nej.hrac, fig: nej.fig };
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
    // Módy jsou obyčejná zaškrtávátka a dají se kombinovat.
    ...MODY.map(m => ({ key: m.id, label: m.nazev, emoji: m.emoji, desc: m.popis, def: false })),
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
    const mody = Object.fromEntries(MODY.map(m => [m.id, !!opt[m.id]]));
    const hra = novaHra(opt.mapa, seats.length, opt.figurek, mody, rng.int(0, seats.length - 1));

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

    if (s.sniper) {
      // Když je na mušce jediná figurka, není co vybírat.
      if (sniperCile(s).length <= 1) state.autoAt = now + AUTO_MS;
      else if (bot) state.botAt = now + BOT_TAH_MS;
      state.deadline = now + TAH_MS;
    } else if (s.hozeno) {
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
      if (s.sniper) return ctx.reject(player, 'Nejdřív vyber, koho sundáš.');
      if (!s.hozeno) return ctx.reject(player, 'Nejdřív hoď kostkou.');
      const fig = msg.fig | 0;
      const couv = !!msg.couv;
      if (!tahy(s).some(t => t.fig === fig && !!t.couv === couv)) {
        return ctx.reject(player, 'Takhle to touhle figurkou nejde.');
      }
      return this.tahnout(state, fig, couv, ctx);
    }

    if (msg.a === 'snipe') {
      if (!s.sniper) return ctx.reject(player, 'Teď se nestřílí.');
      return this.sniprout(state, msg.hrac | 0, msg.fig | 0, ctx);
    }

    if (msg.a === 'obetuj') {
      if (!lzeObetovat(s)) return ctx.reject(player, 'Obětovat teď nejde.');
      return this.obetovat(state, msg.a1 | 0, msg.a2 | 0, msg.hrac | 0, msg.fig | 0, ctx);
    }
  },

  sniprout(state, cilHrac, cilFig, ctx) {
    const s = state.hra;
    const kdo = this.jmeno(ctx, state.seats[s.naTahu]);
    const obet = this.jmeno(ctx, state.seats[cilHrac]);
    const pred = s.poz[cilHrac][cilFig];
    state.hra = snipe(s, cilHrac, cilFig);
    if (state.hra.poz[cilHrac][cilFig] === pred) return;   // neplatný cíl
    this.zapis(state, `🎯 ${kdo} sniperem sundal ${obet}.`);
    ctx.emit('vyhozeni', { kdo: s.naTahu, komu: cilHrac });
    this.prepocti(state, ctx);
  },

  obetovat(state, a1, a2, cilHrac, cilFig, ctx) {
    const s = state.hra;
    const kdo = this.jmeno(ctx, state.seats[s.naTahu]);
    const obet = this.jmeno(ctx, state.seats[cilHrac]);
    state.hra = obetuj(s, a1, a2, cilHrac, cilFig);
    if (state.hra.tahu === s.tahu) return;                 // neprošlo
    this.zapis(state, `⚔️ ${kdo} obětoval dvě figurky a sundal ${obet}.`);
    ctx.emit('vyhozeni', { kdo: s.naTahu, komu: cilHrac });
    this.prepocti(state, ctx);
  },

  hodit(state, ctx) {
    const s = state.hra;
    const kdo = this.jmeno(ctx, state.seats[s.naTahu]);
    const predtim = s.naTahu;

    // Double trouble: dvě kostky a platí jejich součet. Minimum je tím
    // pádem 2 – o jedno pole se posunout nedá, což hlídá pravidlo
    // o přesném doskoku do cíle.
    const dve = s.mody.double;
    const a = ctx.rng.int(1, 6);
    const b = dve ? ctx.rng.int(1, 6) : 0;
    const kostka = dve ? a + b : a;

    state.hra = hod(s, kostka, dve ? [a, b] : null);
    const n = state.hra;

    if (n.hozeno) {
      this.zapis(state, `${kdo} hodil ${kostka}.`);
    } else if (n.naTahu !== predtim) {
      this.zapis(state, `${kdo} hodil ${kostka} a nemá tah. Konec tahu.`);
    } else {
      const p = n.pokusy;
      this.zapis(state, `${kdo} hodil ${kostka} – nemá tah, zbývá ${p} ${p === 1 ? 'pokus' : 'pokusy'}.`);
    }

    if (n.hlaska) this.zapis(state, n.hlaska.text);
    ctx.emit('kostka', { seat: predtim, hodnota: kostka, kostky: dve ? [a, b] : null });
    this.prepocti(state, ctx);
  },

  tahnout(state, fig, couv, ctx) {
    const s = state.hra;
    const kdo = this.jmeno(ctx, state.seats[s.naTahu]);
    const t = tahy(s).find(x => x.fig === fig && !!x.couv === !!couv);
    const sest = s.kostka === 6;

    // Náhodu pro Nervy losuje server, aby si ji klient nemohl vybrat.
    state.hra = tah(s, fig, !!couv, ctx.rng());
    const n = state.hra;

    // Hlášku módu píšeme vždycky – hráč musí vědět, proč se stalo,
    // co se stalo.
    if (n.hlaska) this.zapis(state, `${kdo}: ${n.hlaska.text}`);
    if (n.hlaska?.mod === 'nervy') { ctx.emit('nervy', { seat: s.naTahu }); this.prepocti(state, ctx); return; }

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

    // Kdo je bot, se pozná až z `ctx`, které `createState` nedostává –
    // a taky se to změní ve chvíli, kdy hráče převezme bot za nečinnost.
    // Proto se plán bota dorovnává tady, ne jen v `prepocti`. Bez toho
    // hra po rozdání stála, dokud nevypršel šedesátivteřinový limit.
    if (!state.autoAt && !state.botAt) {
      const kdo = ctx?.players?.find(p => p.uid === state.seats[s.naTahu]);
      if (kdo?.bot || kdo?.botControlled) {
        state.botAt = now + (s.hozeno || s.sniper ? BOT_TAH_MS : BOT_HOD_MS);
      }
    }

    // Jediná možnost – zahraje se sama, ať už za člověka nebo za bota.
    if (state.autoAt && now >= state.autoAt) {
      if (s.sniper) {
        const c = sniperCile(s);
        if (c.length === 1) return this.sniprout(state, c[0].hrac, c[0].fig, ctx);
        state.autoAt = 0;
        return;
      }
      const t = tahy(s);
      if (t.length === 1) return this.tahnout(state, t[0].fig, t[0].couv, ctx);
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

    if (s.sniper) {
      // Sundá se ten, kdo je nejdál – tam je ztráta největší.
      const c = sniperCile(s);
      if (!c.length) { state.botAt = 0; return; }
      let nej = c[0];
      for (const x of c) if (s.poz[x.hrac][x.fig] > s.poz[nej.hrac][nej.fig]) nej = x;
      const vyber = level === 'easy' ? ctx.rng.pick(c) : nej;
      return this.sniprout(state, vyber.hrac, vyber.fig, ctx);
    }

    if (!s.hozeno) {
      // Než hodí: nevyplatí se radši obětovat? Stojí to celý tah, takže
      // se to dělá místo hodu, ne vedle něj.
      const ob = obetTah(s, level);
      if (ob) return this.obetovat(state, ob.a1, ob.a2, ob.hrac, ob.fig, ctx);
      return this.hodit(state, ctx);
    }
    const t = vyberTah(s, level, ctx.rng);
    if (!t) { state.botAt = 0; return; }
    return this.tahnout(state, t.fig, t.couv, ctx);
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
      kostky: s.kostky,
      mody: s.mody,
      hlaska: s.hlaska,
      sniper: s.sniper,
      sniperCile: s.sniper ? sniperCile(s) : [],
      muzeObetovat: myTurn && lzeObetovat(s),
      obetovatelne: myTurn ? obetovatelne(s) : [],
      obetiCile: myTurn && lzeObetovat(s) ? sniperCile(s, seat) : [],
      hozeno: s.hozeno,
      pokusy: s.pokusy ?? maxPokusu(s),
      maxPokusu: maxPokusu(s),
      posledni: s.posledni,
      vitez: s.vitez,
      seats: state.seats,
      mySeat: seat,
      myTurn,
      tahy: myTurn && s.hozeno && !s.sniper ? tahy(s) : [],
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
