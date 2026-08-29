// ─────────────────────────────────────────────────────────────
//  Závody – top-down okruh v reálném čase.
//
//  Dva režimy:
//   • klasika – pevný okruh, jede se na kola
//   • stavěná trať – hráči si ji každé kolo sami skládají z dílků jako
//     autodráhu a přidávají do ní turba a pasti; pak se to jede a rozdají
//     se body. Po pár kolech vyhrává celkový součet.
//
//  Server simuluje jízdu, kontrolní body i srážky a od klienta bere jen
//  "plyn, volant, ruční brzda" a "pokládám tenhle díl". Kdo si v konzoli
//  přepíše rychlost, uvidí svou lež do dalšího snapshotu – a kontrolní
//  body se musí sebrat popořadě, takže zatáčku přes trávu neobjede.
// ─────────────────────────────────────────────────────────────
import {
  R, OPTIONS, START, ZAKLAD, BOOSTS, PUDDLES,
} from '../../shared/games/racing/const.js';
import { DILY_IDS, PASTI, PASTI_IDS, polozDil } from '../../shared/games/racing/dily.js';
import {
  applyInput, sanitizeInput, surfaceAt, vTurbu, checkProgress, progress,
  gridSlot, trackPoint, nearestSeg, dilSedi, tratZRetezu, useku, konecUseku, poSume,
  KLASIK, clamp,
} from '../../shared/games/racing/sim.js';

const MAX_QUEUE = 4;

// Na otevřené trati je bod 0 zároveň startovní čára – auta na něm už stojí.
// Když se čekalo, až ho seberou, auta ze druhé a třetí řady roštu na něj
// nedosáhla (stojí 185 a 280 px dál, dosah je 150) a celý závod projela
// bez jediného postupu – do cíle dojela pokaždé jen první dvě.
const prvniCp = (trat) => (trat.uzavrena ? 0 : 1);

// Boti. Pozor na past: plyn sám o sobě žádný rozdíl nedělá – zrychlení je
// vůči odporu tak velké, že i s polovičním plynem auto dojede na strop
// rychlosti. Rozlišuje se proto CÍLOVÁ rychlost do zatáčky:
//   tempo     – kolik ze stropu si dovolí na rovince
//   opatrnost – jak moc ubere podle lomu trati před sebou
//   minV      – pod co už nezpomalí ani ve vlásence
const LEVELS = {
  easy:   { look: 0.70, err: 0.30, brake: 0.70, drift: false, tempo: 0.82, opatrnost: 1.05, minV: 0.42 },
  normal: { look: 1.00, err: 0.10, brake: 0.85, drift: true,  tempo: 0.92, opatrnost: 0.88, minV: 0.52 },
  hard:   { look: 1.25, err: 0.03, brake: 1.00, drift: true,  tempo: 1.00, opatrnost: 0.72, minV: 0.62 },
};

const uhelRozdil = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// Jak moc se trať láme v následujících `dist` pixelech. 0 = rovinka,
// 1 = vlásenka. Počítá se ve VZDÁLENOSTI, ne v úsecích – stavěná trať má
// úseky 170 px, klasický okruh přes 300, a bot by se díval pokaždé jinam.
function zatoceni(t, seg, tt, dist) {
  const n = useku(t);
  const smer = (i) => {
    const a = t.body[i], b = konecUseku(t, i);
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  let sum = 0, i = seg, ujeto = 0, cur = tt;
  for (let k = 0; k < n; k++) {
    const a = t.body[i], b = konecUseku(t, i);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    ujeto += (1 - cur) * len;
    if (!t.uzavrena && i + 1 >= n) break;
    const dalsi = (i + 1) % n;
    sum += Math.abs(uhelRozdil(smer(dalsi), smer(i)));
    if (ujeto >= dist) break;
    i = dalsi;
    cur = 0;
  }
  return Math.min(1, sum / (Math.PI * 0.9));
}

export default {
  id: 'racing',
  title: 'Závody',
  emoji: '🏁',
  desc: 'Trať si postavíte sami, pak se po ní honíte.',
  minPlayers: 1,
  maxPlayers: 6,
  realtime: true,
  tickRate: R.TICK,
  snapEvery: 2,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],
  optionsTitle: 'Jak se bude hrát',
  options: OPTIONS.map(o => ({ key: o.key, label: o.label, emoji: o.emoji, desc: o.desc, def: !!o.def })),

  createState({ players, rng, options }) {
    const stavba = options?.stavba !== false;
    const state = {
      stavba,
      retez: stavba ? [...ZAKLAD] : [],
      pasti: [],
      kolo: 1,
      kolCelkem: stavba ? R.KOL : 1,
      faze: stavba ? 'stavba' : 'zavod',
      polozil: {},
      botKdy: {},
      ruka: {},
      body: {},
      seats: players.map(p => p.uid),
      cars: {},
      deadline: 0,
      startAt: 0,
      firstDone: 0,
      poradi: [],
      hlaska: null,
      fx: [],
      over: null,
    };

    if (stavba) {
      const r = tratZRetezu(state.retez, START);
      state.trat = r.trat;
      state.kurzor = r.kurzor;
    } else {
      state.trat = KLASIK;
      state.kurzor = null;
      // Klasika má turba a kaluže natvrdo na svých místech – do stejného
      // seznamu, jako by je pokladá hráči, ať to dál řeší jedna cesta.
      for (const b of BOOSTS) {
        const p = trackPoint(KLASIK, b.seg, 0.5, b.off);
        state.pasti.push({ x: p.x, y: p.y, typ: 'turbo', kdo: null });
      }
      for (const b of PUDDLES) {
        const p = trackPoint(KLASIK, b.seg, 0.5, b.off);
        state.pasti.push({ x: p.x, y: p.y, typ: 'kaluz', kdo: null });
      }
    }

    players.forEach((pl, i) => {
      state.body[pl.uid] = 0;
      state.cars[pl.uid] = this.novyVuz(pl, i, state);
    });

    if (stavba) this.rozdejRuce(state, rng);
    else state.startAt = Date.now() + R.COUNTDOWN_MS;

    return state;
  },

  novyVuz(pl, i, state) {
    const g = gridSlot(state.trat, i);
    return {
      uid: pl.uid, name: pl.name, bot: !!pl.bot, botLevel: pl.botLevel || 'normal',
      color: i, x: g.x, y: g.y, a: g.a, vx: 0, vy: 0,
      lap: 0, nextCp: prvniCp(state.trat), offTrack: false, wet: false, olej: false, drift: false,
      boost: 0, finished: 0, place: 0,
      lapStart: 0, best: 0,
      seq: 0, input: { gas: 0, steer: 0, drift: false }, queue: [], stale: 0,
    };
  },

  // ── Stavba ─────────────────────────────────────────────────
  // Staví se NAJEDNOU, ne po řadě: kdo položí dřív, položí dřív. Střýdání
  // po hráčích mělo ošklivou vadu – ruka se rozdala na začátku kola, ale než
  // přišel poslední na řadu, volnej konec byl už jinde a všechny jeho díly
  // byly zašedivělé. Teď se legalita počítá živě v každém snapshotu.
  rozdejRuce(state, rng) {
    state.ruka = {};
    state.polozil = {};
    state.botKdy = {};
    const ted = Date.now();
    for (const uid of state.seats) {
      state.ruka[uid] = { dily: this.nabidka(state, rng), past: PASTI_IDS[rng.int(0, PASTI_IDS.length - 1)] };
      // Boti se rozloží v čase, ať neskočí všichni v té samé milisekundě.
      state.botKdy[uid] = ted + R.BOT_STAVBA_MIN + rng() * (R.BOT_STAVBA_MAX - R.BOT_STAVBA_MIN);
    }
    state.deadline = ted + R.STAVBA_MS;
  },

  // Ruka se dobírá PŘEDNOSTNĚ z dílů, které se teď dá položit. Náhodná ruka
  // totiž většinou obsahovala samou nemožnost a stavební tah propadl – za
  // 20 tahů se položily tři díly.
  nabidka(state, rng) {
    if (!state.kurzor) return [];
    const jde = [], nejde = [];
    for (const id of DILY_IDS) {
      const p = polozDil(id, state.kurzor);
      (dilSedi(state.trat.body, p.body).ok ? jde : nejde).push(id);
    }
    const zamichej = (pole) => {
      const a = pole.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    return [...zamichej(jde), ...zamichej(nejde)].slice(0, R.RUKA);
  },

  prepocti(state) {
    const r = tratZRetezu(state.retez, START);
    state.trat = r.trat;
    state.kurzor = r.kurzor;
  },

  // Které díly z ruky se dají položit – klient podle toho šedí nabídku
  // a server tím samým validuje tah.
  legalni(state, uid) {
    const ruka = state.ruka[uid];
    if (!ruka || !state.kurzor) return [];
    return ruka.dily.map((id, i) => {
      const p = polozDil(id, state.kurzor);
      return { i, id, ...dilSedi(state.trat.body, p.body) };
    });
  },

  postav(state, uid, msg, ctx) {
    if (state.faze !== 'stavba') return;
    if (state.polozil[uid]) return ctx?.reject?.({ uid }, 'V tomhle kole už jsi stavěl.');
    const ruka = state.ruka[uid];
    if (!ruka) return;
    if (!ruka.dily.includes(msg?.dil)) return ctx?.reject?.({ uid }, 'Tenhle díl nemáš.');

    const p = polozDil(msg.dil, state.kurzor);
    const ok = dilSedi(state.trat.body, p.body);
    if (!ok.ok) return ctx?.reject?.({ uid }, `Sem to nejde – ${ok.proc}.`);

    const predUseku = useku(state.trat);
    state.retez.push(msg.dil);
    this.prepocti(state);

    // Past se pokládá rovnou na položený díl, ne kamkoliv po mapě.
    if (msg.past && PASTI[msg.past] && ruka.past === msg.past) {
      const t = clamp(Number(msg.pastT) || 0.5, 0.08, 0.92);
      const off = clamp(Number(msg.pastOff) || 0, -0.6, 0.6);
      const novych = useku(state.trat) - predUseku;
      const seg = Math.min(predUseku + Math.floor(novych * t), useku(state.trat) - 1);
      const bod = trackPoint(state.trat, seg, (novych * t) % 1, off);
      state.pasti.push({ x: bod.x, y: bod.y, typ: msg.past, kdo: uid });
    }

    state.polozil[uid] = true;
    if (state.seats.every(u => state.polozil[u])) this.zacniZavod(state);
  },

  zacniZavod(state) {
    state.faze = 'zavod';
    state.firstDone = 0;
    state.poradi = [];
    state.startAt = Date.now() + R.COUNTDOWN_MS;
    state.seats.forEach((uid, i) => {
      const c = state.cars[uid];
      if (!c) return;
      const g = gridSlot(state.trat, i);
      Object.assign(c, {
        x: g.x, y: g.y, a: g.a, vx: 0, vy: 0,
        lap: 0, nextCp: prvniCp(state.trat), finished: 0, place: 0, boost: 0,
        offTrack: false, wet: false, olej: false, queue: [], stale: 0, lapStart: 0,
      });
    });
  },

  // ── Vstupy ─────────────────────────────────────────────────
  onInput(state, player, msg) {
    if (state.faze !== 'zavod') return;
    const c = state.cars[player.uid];
    if (!c) return;
    if (c.queue.length >= MAX_QUEUE) c.queue.shift();
    c.queue.push(sanitizeInput(msg));
  },

  onAction(state, player, msg, ctx) {
    if (msg?.a === 'postav') return this.postav(state, player.uid, msg, ctx);
  },

  // ── Simulace ───────────────────────────────────────────────
  tick(state, dt, ctx) {
    const now = Date.now();
    state.fx = [];

    if (state.faze === 'stavba') return this.tickStavba(state, now, ctx);
    if (state.faze !== 'zavod') return;

    const bezi = now >= state.startAt;
    for (const uid of state.seats) {
      const c = state.cars[uid];
      if (!c) continue;
      if (!bezi) { c.vx = 0; c.vy = 0; c.queue.length = 0; continue; }
      if (c.finished) { c.vx *= 0.9; c.vy *= 0.9; c.x += c.vx * R.DT; c.y += c.vy * R.DT; continue; }
      if (!c.lapStart) c.lapStart = state.startAt;

      // Fronta vstupů se odbavuje až DVA za tick: časovač klienta a serveru
      // nikdy nejdou stejně, fronta se plnila a při přetečení se zahazoval
      // nejstarší vstup – jenže ten si klient už zapředikoval, takže se
      // pozice trvale rozešly. Dobíháním se srovnají místo zahazování.
      const kolik = c.queue.length > 1 ? 2 : 1;
      if (c.boost && now > c.boost) c.boost = 0;

      for (let k = 0; k < kolik; k++) {
        let vstup;
        if (c.queue.length) { vstup = c.queue.shift(); c.input = vstup; c.seq = vstup.seq; c.stale = 0; }
        else if (k > 0) break;
        else { c.stale++; vstup = c.stale > 3 ? { gas: 0, steer: 0, drift: false } : c.input; }

        const povrch = surfaceAt(state.trat, c.x, c.y, state.pasti);
        c.offTrack = povrch.offTrack;
        c.wet = povrch.wet;
        c.olej = povrch.olej;
        applyInput(c, vstup, R.DT);
      }

      if (!c.offTrack && vTurbu(c.x, c.y, state.pasti)) {
        if (!c.boost) state.fx.push({ k: 'boost', x: c.x, y: c.y });
        c.boost = now + R.BOOST_MS;
      }

      if (checkProgress(state.trat, c)) {
        const cas = now - c.lapStart;
        if (!c.best || cas < c.best) c.best = cas;
        c.lapStart = now;
        if (c.lap >= (state.trat.uzavrena ? R.LAPS : 1)) {
          c.finished = now;
          state.poradi.push(uid);
          c.place = state.poradi.length;
          if (!state.firstDone) state.firstDone = now;
          state.fx.push({ k: 'finish', uid, place: c.place });
        }
      }
    }

    if (bezi) this.srazky(state);

    // Konec závodu: dojeli všichni, nebo vypršela uzávěrka po vítězi.
    const vsichni = state.seats.map(u => state.cars[u]).filter(Boolean);
    const hotovo = vsichni.length && (vsichni.every(c => c.finished)
      || (state.firstDone && now > state.firstDone + R.FINISH_MS));
    if (hotovo) this.konecZavodu(state, ctx);
  },

  tickStavba(state, now, ctx) {
    if (!state.seats.length) return this.zacniZavod(state);

    // Boti pokládají každý ve svůj čas, lidé kdykoliv sami. Po vypršení
    // lhůty se doplní za všechny, kdo nestihli, a jede se.
    const konec = now >= state.deadline;
    for (const uid of state.seats) {
      if (state.polozil[uid]) continue;
      const hrac = ctx.players?.find(p => p.uid === uid);
      const jeBot = !hrac || hrac.bot || hrac.botControlled;
      if (!konec && !(jeBot && now >= (state.botKdy[uid] || 0))) continue;

      const volba = this.botStavi(state, uid, ctx);
      if (volba) this.postav(state, uid, volba, null);
      else state.polozil[uid] = true;      // sem nic nesedí, kolo se přeskočí
    }

    if (konec || state.seats.every(u => state.polozil[u])) {
      if (state.faze === 'stavba') this.zacniZavod(state);
    }
  },

  // Bot (a záskok za nečinného člověka) kouká o tah dopředu: z dílů, které
  // sedí, vybere ten, po kterém zůstane nejvíc možností. Čistě náhodná volba
  // zazdila trať už po třináctém dílu a zbytek hry se už nestavělo.
  botStavi(state, uid, ctx) {
    const moznosti = this.legalni(state, uid).filter(m => m.ok);
    if (!moznosti.length) return null;

    let nej = -1;
    const nejlepsi = [];
    for (const m of moznosti) {
      const p = polozDil(m.id, state.kurzor);
      const potom = [...state.trat.body, ...p.body];
      let kolik = 0;
      for (const dalsi of DILY_IDS) {
        if (dilSedi(potom, polozDil(dalsi, p.kurzor).body).ok) kolik++;
      }
      if (kolik > nej) { nej = kolik; nejlepsi.length = 0; }
      if (kolik === nej) nejlepsi.push(m.id);
    }

    const i = ctx?.rng ? ctx.rng.int(0, nejlepsi.length - 1) : 0;
    return {
      dil: nejlepsi[i],
      past: state.ruka[uid]?.past,
      pastT: 0.5,
      pastOff: ctx?.rng ? (ctx.rng() * 1.2 - 0.6) : 0,
    };
  },

  konecZavodu(state, ctx) {
    // Body podle pořadí + bonus za dojetí vůbec.
    const dojeli = state.poradi.slice();
    const zbytek = state.seats.filter(u => !dojeli.includes(u))
      .sort((a, b) => progress(state.trat, state.cars[b]) - progress(state.trat, state.cars[a]));

    [...dojeli, ...zbytek].forEach((uid, i) => {
      state.body[uid] = (state.body[uid] || 0) + (R.BODY[i] || 0)
        + (state.cars[uid]?.finished ? R.BOD_DOJEL : 0);
    });

    if (!state.stavba || state.kolo >= state.kolCelkem) {
      state.faze = 'konec';
      return;
    }
    state.kolo++;
    state.faze = 'stavba';
    state.hlaska = `Kolo ${state.kolo} z ${state.kolCelkem} – stavte dál`;
    this.rozdejRuce(state, ctx.rng);
  },

  // Auta do sebe strkají – žádné projíždění skrz.
  srazky(state) {
    const zivi = state.seats.map(u => state.cars[u]).filter(c => c && !c.finished);
    for (let i = 0; i < zivi.length; i++) {
      for (let j = i + 1; j < zivi.length; j++) {
        const a = zivi[i], b = zivi[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = R.CAR_R * 2;
        if (d >= min || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        const prekryv = (min - d) / 2;
        a.x -= nx * prekryv; a.y -= ny * prekryv;
        b.x += nx * prekryv; b.y += ny * prekryv;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = rel * R.HIT_PUSH;
          a.vx += nx * imp; a.vy += ny * imp;
          b.vx -= nx * imp; b.vy -= ny * imp;
          state.fx.push({ k: 'hit', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
      }
    }
  },

  afterSnap(state) { state.fx = []; state.hlaska = null; },

  // ── Bot za volantem ────────────────────────────────────────
  botThink(state, player, ctx) {
    if (state.faze !== 'zavod') return null;
    const c = state.cars[player.uid];
    if (!c || c.finished) return null;
    if (Date.now() < state.startAt) return { gas: 0, steer: 0, drift: false };

    const L = LEVELS[player.botLevel] || LEVELS.normal;
    const t = state.trat;
    const n = useku(t);
    const s = nearestSeg(t, c.x, c.y);
    const v = Math.hypot(c.vx, c.vy);

    // Kam mířit: bod na stopě kousek před autem, v PIXELECH. Když se
    // předstih počítal v úsecích, znamenal na každé trati něco jiného a na
    // stavěné se bot díval o polovinu blíž, než měl.
    // Zatáčka se hlídá na dalších ~700 px, ať je čas ubrat.
    const lom = zatoceni(t, s.i, s.t, 700);

    // V zatáčce se musí dívat blíž: předstih 510 px na vlásence o poloměru
    // 200 znamená mířit přes zatáčku rovnou do trávy.
    const predstih = (150 + (v / R.MAX_SPEED) * 360 * L.look) * (1 - 0.62 * lom);
    const c1 = poSume(t, s.i, s.t, Math.max(90, predstih));
    const seg = c1.seg, tt = c1.t;

    const bokem = ctx.rng ? (ctx.rng() * 2 - 1) * L.err : 0;
    const cil = trackPoint(t, seg, tt, clamp(bokem, -0.6, 0.6));

    const chci = Math.atan2(cil.y - c.y, cil.x - c.x);
    const odchylka = uhelRozdil(chci, c.a);
    const steer = clamp(odchylka * 2.4, -1, 1);

    const cilV = R.MAX_SPEED * L.tempo * clamp(1 - lom * L.opatrnost, L.minV, 1);

    let gas;
    if (c.offTrack) gas = 0.6;
    else if (v < cilV) gas = 1;
    else gas = -L.brake;

    const drift = L.drift && Math.abs(odchylka) > 0.8 && v > R.MAX_SPEED * 0.55;
    return { gas, steer, drift };
  },

  // ── Pohled ─────────────────────────────────────────────────
  // Závody jsou veřejné – všichni vidí trať i soupeře. Skrývá se jen ruka:
  // co má kdo za dílky, do toho ostatním nic není.
  view(state, uid) {
    const me = state.cars[uid];
    const now = Date.now();
    const por = this.poradi(state);

    return {
      stavba: state.stavba,
      faze: state.faze,
      kolo: state.kolo,
      kolCelkem: state.kolCelkem,
      trat: state.trat,
      kurzor: state.kurzor,
      pasti: state.pasti,
      hlaska: state.hlaska,

      jaStavim: state.faze === 'stavba' && !state.polozil[uid],
      polozili: state.seats.filter(u => state.polozil[u]),
      ruka: state.faze === 'stavba' ? this.legalni(state, uid) : [],
      mojePast: state.ruka[uid]?.past || null,
      stavbaZbyva: state.faze === 'stavba' ? Math.max(0, state.deadline - now) : 0,

      laps: state.trat.uzavrena ? R.LAPS : 1,
      startIn: state.faze === 'zavod' ? Math.max(0, state.startAt - now) : 0,
      running: state.faze === 'zavod' && now >= state.startAt,
      closingIn: state.firstDone ? Math.max(0, state.firstDone + R.FINISH_MS - now) : 0,

      me: me ? {
        uid, x: me.x, y: me.y, a: me.a, vx: me.vx, vy: me.vy,
        offTrack: me.offTrack, wet: me.wet, olej: me.olej, boost: me.boost > now,
        lap: me.lap, nextCp: me.nextCp, finished: me.finished, place: me.place, best: me.best,
      } : null,
      ack: me ? me.seq : 0,
      cars: state.seats.map(u => {
        const c = state.cars[u];
        return {
          uid: u, name: c.name, bot: c.bot, color: c.color,
          x: c.x, y: c.y, a: c.a, drift: c.drift, offTrack: c.offTrack,
          boost: c.boost > now, lap: c.lap, finished: !!c.finished,
        };
      }),
      poradi: por.map((c, i) => ({
        uid: c.uid, name: c.name, bot: c.bot, color: c.color,
        lap: Math.min(c.lap + 1, state.trat.uzavrena ? R.LAPS : 1),
        place: i + 1, finished: !!c.finished, best: c.best,
        body: state.body[c.uid] || 0,
      })),
      fx: state.fx,
    };
  },

  // V závodě rozhoduje pořadí v cíli a ujetá vzdálenost, mezi koly body.
  poradi(state) {
    const vsichni = state.seats.map(u => state.cars[u]).filter(Boolean);
    if (state.faze !== 'zavod') {
      return vsichni.sort((a, b) => (state.body[b.uid] || 0) - (state.body[a.uid] || 0));
    }
    return vsichni.sort((a, b) => {
      if (a.finished && b.finished) return a.finished - b.finished;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return progress(state.trat, b) - progress(state.trat, a);
    });
  },

  result(state) {
    if (state.over) return state.over;
    if (state.faze !== 'konec') return null;

    const podle = [...state.seats].sort((a, b) => (state.body[b] || 0) - (state.body[a] || 0));
    if (!podle.length) return null;
    const nej = state.body[podle[0]] || 0;
    const shodni = podle.filter(u => (state.body[u] || 0) === nej);

    if (shodni.length > 1) {
      state.over = { draw: true, reason: `Remíza na ${nej} bodech.` };
      return state.over;
    }
    // V klasice se jede jeden závod, takže body nikoho nezajímají – řekni čas.
    const vitez = state.cars[podle[0]];
    state.over = {
      winners: [podle[0]],
      reason: state.stavba
        ? `${nej} bodů za ${state.kolCelkem} kol stavby a závodů.`
        : (vitez?.finished
          ? `${R.LAPS} kola za ${((vitez.finished - state.startAt) / 1000).toFixed(1)} s`
          : 'Uzávěrka vypršela – rozhodla ujetá vzdálenost.'),
    };
    return state.over;
  },

  onPlayerGone(state, player) {
    const i = state.seats.indexOf(player.uid);
    if (i < 0) return;
    state.seats.splice(i, 1);
    delete state.cars[player.uid];
    delete state.ruka[player.uid];
    delete state.polozil[player.uid];
    delete state.botKdy[player.uid];
    // Odešel poslední, na koho se čekalo? Pak už není na co čekat.
    if (state.faze === 'stavba' && state.seats.length && state.seats.every(u => state.polozil[u])) {
      this.zacniZavod(state);
    }
  },
};
