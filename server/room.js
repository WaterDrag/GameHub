// ─────────────────────────────────────────────────────────────
//  Room – jedna herní místnost.
//
//  Drží autoritativní stav hry, jede vlastní tick smyčku a řeší
//  "returner systém": když se hráč odpojí, jeho postavu po 3 s
//  převezme bot, místnost jede dál a hráč se může do 3 minut
//  vrátit a převzít ji zpátky.
// ─────────────────────────────────────────────────────────────
import { STATUS, TIMING } from '../shared/constants.js';
import { makeRng, randomSeed } from '../shared/rng.js';
import { S, send } from './protocol.js';
import { GAMES, cistiVolby } from './games/index.js';
import { losujPlan, moznosti, tabulka, vitezove, PAUZA_MS, KOLA_VOLBY } from './party-mod.js';

const TURN_LOOP_HZ = 4;      // tahovky – stačí na odpočet kola
// Hubové tempo botů – používají ho hry, které mají `botThink()`
// (šachy, piškvorky). Odvozuje se ze stejné konstanty jako u ostatních,
// ať se tempo dá měnit na jednom místě.
const BOT_THINK_MIN = Math.round(TIMING.BOT_KROK_MS * 0.8);
const BOT_THINK_MAX = Math.round(TIMING.BOT_KROK_MS * 1.3);

let botCounter = 0;

export class Player {
  constructor({ uid, name, bot = false, botLevel = 'normal' }) {
    this.uid = uid;
    this.name = name;
    this.bot = bot;
    this.botLevel = botLevel;
    this.ws = null;
    this.connected = bot;          // bot je "vždy připojený"
    this.disconnectedAt = 0;
    this.ready = false;
    this.botControlled = bot;      // true i pro člověka, kterého zrovna hraje bot
    this.lastActAt = Date.now();   // poslední skutečná akce – hlídá neaktivitu
    this._botAt = 0;
    this._botMove = null;
    this._act = {};                // paměť pro rozpoznání skutečné aktivity
  }
  get isHuman() { return !this.bot; }
}

export class Room {
  constructor({ code, game, hostUid, visibility, maxPlayers, options, manager }) {
    this.code = code;
    this.game = game;
    this.manager = manager;
    this.hostUid = hostUid;
    this.options = options || {};
    // 'pratele' = v seznamu ji vidí jen kamarádi někoho uvnitř.
    this.visibility = ['private', 'pratele'].includes(visibility) ? visibility : 'public';
    this.maxPlayers = Math.min(maxPlayers || game.maxPlayers, game.maxPlayers);
    this.players = new Map();      // uid -> Player
    this.status = STATUS.LOBBY;
    this.state = null;
    this.seed = randomSeed();
    this.rng = makeRng(this.seed);
    this.tick = 0;
    this.timer = null;
    this.lastTick = 0;
    this.createdAt = Date.now();
    this.chat = [];
    // Párty mód: {kola, kolo, plan[], body{uid:n}, hotovo}. Mimo něj null –
    // místnost se pak chová úplně obyčejně.
    this.parta = null;
    this.partaTimer = null;
  }

  // ── Hráči ────────────────────────────────────────────────
  get list() { return [...this.players.values()]; }
  get humans() { return this.list.filter(p => p.isHuman); }
  get connectedHumans() { return this.humans.filter(p => p.connected); }
  get activeCount() { return this.players.size; }
  get isFull() { return this.activeCount >= this.maxPlayers; }

  add(user, ws) {
    let p = this.players.get(user.uid);
    if (p) { this.attach(p, ws); this.broadcastRoom(); return p; }
    if (this.isFull) return null;
    if (this.status !== STATUS.LOBBY) return null;
    p = new Player({ uid: user.uid, name: user.name });
    this.players.set(p.uid, p);
    this.attach(p, ws);
    this.broadcastRoom();
    return p;
  }

  attach(p, ws) {
    p.ws = ws;
    p.connected = true;
    p.disconnectedAt = 0;
    p.botControlled = false;
    // Nově připojený hráč nesmí spadnout do nečinnosti dřív, než stačil
    // něco udělat – hodiny se mu resetují až teď.
    p.lastActAt = Date.now();
    p._botAt = 0;
    p._botMove = null;
    p._act = {};
  }

  // Odpojení NIKDY neruší místnost. Jen se rozjede převzetí botem.
  //
  // `ws` je socket, který se zavřel. Když už mezitím hráč naběhl na
  // jiném spojení, opožděný close toho starého ho nesmí shodit –
  // jinak stačí bliknutí wifi a bot ti převezme postavu, přestože
  // dávno hraješ dál.
  detach(uid, ws = null) {
    const p = this.players.get(uid);
    if (!p || p.bot) return;
    if (ws && p.ws && p.ws !== ws) return;
    p.ws = null;
    p.connected = false;
    p.disconnectedAt = Date.now();
    if (this.status === STATUS.LOBBY) p.ready = false;
    this.broadcastRoom();
  }

  remove(uid, reason = 'left') {
    const p = this.players.get(uid);
    if (!p) return;
    if (p.ws) send(p.ws, S.LEFT, { reason });
    this.players.delete(uid);
    if (this.state && this.game.onPlayerGone) this.game.onPlayerGone(this.state, p, this.ctx());
    if (uid === this.hostUid) {
      const next = this.humans[0];
      this.hostUid = next ? next.uid : null;
    }
    this.broadcastRoom();
  }

  addBot(level = 'normal') {
    if (!this.game.supportsBots || this.isFull || this.status !== STATUS.LOBBY) return null;
    const names = ['Rychlík', 'Ostrozrak', 'Beton', 'Jehla', 'Kudla', 'Kvark', 'Šrapnel', 'Mlha'];
    botCounter++;
    const p = new Player({
      uid: `bot:${botCounter}`,
      name: `${names[botCounter % names.length]} (bot)`,
      bot: true,
      botLevel: (this.game.botLevels || []).includes(level) ? level : 'normal',
    });
    p.ready = true;
    this.players.set(p.uid, p);
    this.broadcastRoom();
    return p;
  }

  // ── Volby před hrou ──────────────────────────────────────
  //  Hub o žádné konkrétní volbě neví. Hra si je popisuje sama a sama
  //  taky řekne, které z nich při daném počtu hráčů nedávají smysl –
  //  proto `normalizeOptions`. Volá se při každém výpisu místnosti,
  //  takže se zámek přepočítá i tehdy, když někdo jen přijde nebo odejde.
  normOptions() {
    if (!this.game.normalizeOptions) return { zamky: {}, info: null };
    const r = this.game.normalizeOptions(this.options || {}, this.activeCount) || {};
    if (r.options) this.options = r.options;
    return { zamky: r.zamky || {}, info: r.info || null };
  }

  setOption(uid, key, value) {
    if (uid !== this.hostUid) return 'Volby mění jen hostitel.';
    if (this.status !== STATUS.LOBBY) return 'Hra už běží.';

    const def = (this.game.options || []).find(o => o.key === key);
    if (!def) return 'Takovou volbu hra nemá.';

    let v = value;
    if (def.typ === 'volba') {
      if (!def.volby?.some(x => x.v === v)) return 'Takovou možnost hra nenabízí.';
    } else {
      v = !!v;
    }

    // Zamčenou volbu nepřepíšeme ani hostiteli – jinak by šlo poslat
    // `setOption` z konzole a spustit osm hráčů na čtyřramenné desce.
    const { zamky } = this.normOptions();
    if (zamky[key]) return zamky[key];

    this.options = { ...this.options, [key]: v };
    this.normOptions();
    this.broadcastRoom();
    return null;
  }

  // ── Párty mód ────────────────────────────────────────────
  //  Místnost přestane být místností jedné hry: hru si losuje sama,
  //  sama ji nastaví podle počtu hráčů a po dohrání jede dál.
  spustParty(uid, kola) {
    if (uid !== this.hostUid) return 'Párty mód spouští hostitel.';
    if (this.status !== STATUS.LOBBY) return 'Hra už běží.';
    if (this.parta) return 'Párty mód už jede.';
    if (this.activeCount < 2) return 'Na párty mód jsou potřeba aspoň dva.';

    const k = KOLA_VOLBY.includes(Number(kola)) ? Number(kola) : KOLA_VOLBY[1];
    const sBoty = this.list.some(p => p.bot);
    const plan = losujPlan(this.activeCount, sBoty, k, this.rng);
    if (!plan.length) return 'Pro tenhle počet hráčů nemám žádnou minihru.';

    this.parta = { kola: k, kolo: 0, plan, body: {}, hotovo: false };
    for (const p of this.list) this.parta.body[p.uid] = 0;
    this.dalsiKolo();
    return null;
  }

  // Hráč mohl mezitím odejít – hra z plánu už nemusí na daný počet sedět.
  // Radši se vymění, než aby párty mód spadl.
  hraProKolo() {
    const id = this.parta.plan[this.parta.kolo];
    const g = GAMES[id];
    const sedi = (x) => x && this.activeCount >= x.minPlayers && this.activeCount <= x.maxPlayers
      && (!this.list.some(p => p.bot) || x.supportsBots);
    if (sedi(g)) return g;
    const nahrada = this.rng.pick(moznosti(this.activeCount, this.list.some(p => p.bot)) || []);
    if (nahrada) this.parta.plan[this.parta.kolo] = nahrada.id;
    return nahrada || null;
  }

  dalsiKolo() {
    if (!this.parta) return;
    const hra = this.hraProKolo();
    if (!hra) { this.ukonciParty('Pro tolik hráčů už nemám co pustit.'); return; }

    this.parta.kolo++;
    this.game = hra;
    this.maxPlayers = Math.min(hra.maxPlayers, Math.max(this.activeCount, this.maxPlayers));
    // Volby si hra losuje sama; přesto projdou stejnou kontrolou jako od
    // hostitele – hub nikdy nevěří ničemu, co do options přijde.
    this.options = cistiVolby(hra, hra.partyOptions?.(this.activeCount, this.rng) || {});
    this.normOptions();
    this.seed = randomSeed();
    this.state = null;
    this.status = STATUS.COUNTDOWN;
    for (const p of this.list) { p.ready = true; p._botAt = 0; p._botMove = null; }
    this.broadcastRoom();

    this.broadcast(S.PARTY_KOLO, {
      kolo: this.parta.kolo, kola: this.parta.kola,
      gameId: hra.id, title: hra.title, emoji: hra.emoji,
      tabulka: tabulka(this.parta, this.list),
    });

    let n = Math.round(TIMING.COUNTDOWN_MS / 1000);
    this.broadcast(S.COUNTDOWN, { n });
    const iv = setInterval(() => {
      n--;
      if (n > 0) { this.broadcast(S.COUNTDOWN, { n }); return; }
      clearInterval(iv);
      if (this.status === STATUS.COUNTDOWN) this.begin();
    }, 1000);
  }

  // Body se přičtou vítězi kola, pak se buď jede dál, nebo se vyhlásí.
  zapisKolo(result) {
    for (const uid of result.winners || []) {
      if (this.players.has(uid)) this.parta.body[uid] = (this.parta.body[uid] || 0) + 1;
    }
    const posledni = this.parta.kolo >= this.parta.kola;
    if (posledni) this.parta.hotovo = true;
    return {
      kolo: this.parta.kolo, kola: this.parta.kola, hotovo: posledni,
      tabulka: tabulka(this.parta, this.list),
      vitezove: posledni ? vitezove(this.parta, this.list).map(x => x.uid) : [],
      dalsi: posledni ? null : (GAMES[this.parta.plan[this.parta.kolo]] || null),
      pauza: PAUZA_MS,
    };
  }

  ukonciParty(duvod = null) {
    clearTimeout(this.partaTimer);
    this.partaTimer = null;
    this.parta = null;
    this.status = STATUS.LOBBY;
    this.state = null;
    for (const p of this.list) p.ready = p.bot;
    if (duvod) this.broadcast(S.ERROR, { msg: duvod });
    this.broadcastRoom();
  }

  // ── Start ────────────────────────────────────────────────
  requestStart(uid) {
    if (uid !== this.hostUid) return 'Jen hostitel může spustit hru.';
    if (this.status !== STATUS.LOBBY) return 'Hra už běží.';
    if (this.activeCount < this.game.minPlayers) return `Potřebujete aspoň ${this.game.minPlayers} hráče.`;

    this.status = STATUS.COUNTDOWN;
    this.broadcastRoom();
    let n = Math.round(TIMING.COUNTDOWN_MS / 1000);
    this.broadcast(S.COUNTDOWN, { n });
    const iv = setInterval(() => {
      n--;
      if (n > 0) { this.broadcast(S.COUNTDOWN, { n }); return; }
      clearInterval(iv);
      if (this.status === STATUS.COUNTDOWN) this.begin();
    }, 1000);
    return null;
  }

  begin() {
    this.status = STATUS.PLAYING;
    this.tick = 0;
    // Čekání v čekárně není nečinnost. `lastActAt` se nastavuje při
    // připojení, takže po dlouhém lobby byl hráč „unečinnělý“ už v první
    // vteřině hry a bot ho vzal, aniž by cokoliv udělal.
    for (const p of this.list) p.lastActAt = Date.now();
    this.hlasovani = null;
    this.rng = makeRng(this.seed);
    this.state = this.game.createState({
      players: this.list, rng: this.rng, room: this, options: this.options,
    });
    for (const p of this.list) {
      send(p.ws, S.START, {
        gameId: this.game.id,
        realtime: !!this.game.realtime,
        tickRate: this.game.tickRate || TURN_LOOP_HZ,
        tick: this.tick,
        view: this.game.view(this.state, p.uid),
        players: this.publicPlayers(),
      });
    }
    const hz = this.game.realtime ? (this.game.tickRate || 20) : TURN_LOOP_HZ;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.step(), 1000 / hz);
  }

  // ── Herní smyčka ─────────────────────────────────────────
  step() {
    if (this.status !== STATUS.PLAYING) return;
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.tick++;

    const ctx = this.ctx();
    this.runBots(now, ctx);
    if (this.game.tick) this.game.tick(this.state, dt, ctx);

    const res = this.game.result(this.state);

    // Snapshot MUSÍ odejít i (hlavně) u vítězného tahu – jinak klient
    // nikdy neuvidí poslední tah ani vítěznou řadu.
    // Realtime hry si přes snapEvery ředí snapshoty (simulace 30 Hz,
    // posílání 15 Hz); zbytek dorovná interpolace na klientu.
    const every = this.game.snapEvery || 1;
    if (res || this.tick % every === 0) {
      this.broadcastSnap();
      // Až TEĎ smí hra zahodit jednorázové efekty. Kdyby si je mazala
      // sama na začátku ticku, při snapEvery > 1 by se polovina z nich
      // nikdy neodeslala – výbuchy a zásahy by náhodně mizely.
      this.game.afterSnap?.(this.state);
    }

    if (res) return this.finish(res);

    this.reapDisconnected(now);
  }

  // Boti i "dočasní boti" za odpojené hráče jedou přes stejné rozhraní
  // jako lidi – herní modul nepozná (a nezajímá ho) rozdíl.
  runBots(now, ctx) {
    if (!this.game.botThink) return;
    for (const p of this.list) {
      if (!p.bot && !p.botControlled) continue;

      if (this.game.realtime) {
        const input = this.game.botThink(this.state, p, ctx);
        if (input) this.game.onInput?.(this.state, p, input, ctx);
        continue;
      }

      // Tahovky: rozmysli si tah jednou, zahraj ho po lidsky dlouhé pauze.
      if (!p._botAt) {
        const mv = this.game.botThink(this.state, p, ctx);
        if (!mv) continue;
        p._botMove = mv;
        p._botAt = now + BOT_THINK_MIN + ctx.rng() * (BOT_THINK_MAX - BOT_THINK_MIN);
      } else if (now >= p._botAt) {
        const mv = p._botMove;
        p._botAt = 0;
        p._botMove = null;
        if (mv) this.game.onAction?.(this.state, p, mv, ctx);
      }
    }
  }

  // Dva důvody, proč za člověka začne hrát bot:
  //  • odpojil se – hrát nemůže vůbec, bot ho bere po 3 s a po 3 min vypadává
  //  • je připojený, ale 2 minuty nic nedělá – hra nesmí viset na jednom člověku
  reapDisconnected(now) {
    for (const p of this.list) {
      if (p.bot) continue;

      if (!p.connected) {
        if (!p.botControlled && now - p.disconnectedAt > TIMING.BOT_TAKEOVER_MS) {
          this.takeOver(p, 'odpojení');
        }
        if (now - p.disconnectedAt > TIMING.REJOIN_GRACE_MS) this.remove(p.uid, 'timeout');
        continue;
      }

      if (this.status === STATUS.PLAYING && !p.botControlled
          && now - p.lastActAt > TIMING.IDLE_TAKEOVER_MS) {
        this.zacniHlasovani(p, now);
      }
    }
    this.dohledniHlasovani(now);
  }

  // ── Hlasování o nahrazení botem ──────────────────────
  //  Nečinný hráč se už nenahrazuje potichu. Ostatní dostanou otázku
  //  a bot ho vezme jen tehdy, když se všichni shodnou. Když ne, čeká se
  //  další dvě minuty – třeba jen odběhl.
  volici(krome) {
    return this.list.filter(x => !x.bot && !x.botControlled && x.connected && x.uid !== krome);
  }

  zacniHlasovani(p, now) {
    if (this.hlasovani) return;
    const volici = this.volici(p.uid);

    // Není se koho ptát – hráč je u stolu sám mezi boty a hra by na něm visela.
    if (!volici.length) return this.takeOver(p, 'nečinnost');

    this.hlasovani = { uid: p.uid, konci: now + TIMING.BOT_VOTE_MS, pro: new Set() };
    this.broadcast(S.EVENT, {
      kind: 'botVote', uid: p.uid, name: p.name,
      hlasu: volici.length, sekund: Math.round(TIMING.BOT_VOTE_MS / 1000),
      necinny: Math.round(TIMING.IDLE_TAKEOVER_MS / 1000),
    });
  }

  hlasuj(p, uid, ano) {
    const h = this.hlasovani;
    if (!h || h.uid !== uid || p.uid === uid || p.bot) return;
    if (!ano) return this.zrusHlasovani('proti');
    h.pro.add(p.uid);
    const volici = this.volici(h.uid);
    if (volici.length && volici.every(x => h.pro.has(x.uid))) {
      const cil = this.players.get(h.uid);
      this.hlasovani = null;
      if (cil) this.takeOver(cil, 'nečinnost – odhlasováno');
    }
  }

  zrusHlasovani(duvod) {
    const h = this.hlasovani;
    if (!h) return;
    this.hlasovani = null;
    // Odklad: další dotaz až za další dvě minuty.
    const cil = this.players.get(h.uid);
    if (cil) cil.lastActAt = Date.now();
    this.broadcast(S.EVENT, { kind: 'botVoteEnd', uid: h.uid, duvod });
  }

  dohledniHlasovani(now) {
    const h = this.hlasovani;
    if (!h) return;
    const cil = this.players.get(h.uid);
    if (!cil || cil.botControlled) { this.hlasovani = null; return; }
    if (now - cil.lastActAt < TIMING.IDLE_TAKEOVER_MS) return this.zrusHlasovani('ozval se');
    if (now >= h.konci) this.zrusHlasovani('nikdo neodpověděl');
  }

  takeOver(p, duvod) {
    p.botControlled = true;
    p._botAt = 0;
    this.broadcast(S.EVENT, {
      kind: 'botTakeover', uid: p.uid, name: p.name, reason: duvod,
      after: Math.round(TIMING.IDLE_TAKEOVER_MS / 1000),
    });
    this.broadcastRoom();
  }

  // Hráč se ozval – bere si postavu zpátky.
  giveBack(p) {
    if (!p.botControlled || p.bot) return;
    p.botControlled = false;
    p._botAt = 0;
    p._botMove = null;
    this.broadcast(S.EVENT, { kind: 'botReturn', uid: p.uid, name: p.name });
    this.broadcastRoom();
  }

  finish(result) {
    this.status = STATUS.OVER;
    clearInterval(this.timer);
    this.timer = null;

    // V párty módu není konec hry koncem místnosti – je to konec kola.
    const parta = this.parta ? this.zapisKolo(result) : null;
    this.broadcast(S.OVER, { result, players: this.publicPlayers(), parta });
    if (!parta) return;

    clearTimeout(this.partaTimer);
    this.partaTimer = setTimeout(() => {
      this.partaTimer = null;
      if (!this.parta) return;
      if (this.parta.hotovo) this.ukonciParty();
      else this.dalsiKolo();
    }, PAUZA_MS);
    this.partaTimer.unref?.();
  }

  rematch(uid) {
    if (this.parta) return 'V párty módu se pokračuje samo.';
    if (this.status !== STATUS.OVER) return 'Hra ještě neskončila.';
    if (uid !== this.hostUid) return 'Odvetu spouští hostitel.';
    this.status = STATUS.LOBBY;
    this.state = null;
    this.seed = randomSeed();
    for (const p of this.list) { p.ready = p.bot; p._botAt = 0; p._botMove = null; }
    this.broadcastRoom();
    return null;
  }

  // ── Vstupy od klientů ────────────────────────────────────
  handleAction(p, msg) {
    if (this.status !== STATUS.PLAYING || !this.state) return;
    p.lastActAt = Date.now();
    // Hráč se vrátil dřív, než vypršela lhůta – bere si postavu zpět.
    this.giveBack(p);
    this.game.onAction?.(this.state, p, msg, this.ctx());
    this.broadcastSnap();
    const res = this.game.result(this.state);
    if (res) return this.finish(res);
  }

  handleInput(p, msg) {
    if (this.status !== STATUS.PLAYING || !this.state) return;
    // V realtime hrách teče vstup každý tick i od hráče, který nesahá na
    // klávesnici – za aktivitu se proto počítá jen to, co si hra sama uzná.
    // Bez toho by nikdo v aréně nečinný nikdy nebyl.
    if (!this.game.isActivity || this.game.isActivity(msg, p._act)) {
      p.lastActAt = Date.now();
      this.giveBack(p);
    }
    this.game.onInput?.(this.state, p, msg, this.ctx());
  }

  ctx() {
    return {
      rng: this.rng,
      players: this.list,
      now: Date.now(),
      room: this,
      emit: (kind, data) => this.broadcast(S.EVENT, { kind, ...data }),
      emitTo: (uid, kind, data) => send(this.players.get(uid)?.ws, S.EVENT, { kind, ...data }),
      reject: (player, msg) => send(player.ws, S.ERROR, { msg }),
    };
  }

  // ── Odesílání ────────────────────────────────────────────
  broadcast(type, data) {
    for (const p of this.list) send(p.ws, type, data);
  }

  broadcastSnap() {
    if (!this.state) return;
    for (const p of this.list) {
      if (!p.ws) continue;
      send(p.ws, S.SNAP, { tick: this.tick, view: this.game.view(this.state, p.uid) });
    }
  }

  publicPlayers() {
    return this.list.map(p => ({
      uid: p.uid, name: p.name, bot: p.bot, botLevel: p.bot ? p.botLevel : null,
      connected: p.connected, ready: p.ready,
      botControlled: p.botControlled && !p.bot,
      isHost: p.uid === this.hostUid,
    }));
  }

  summary() {
    const { zamky, info } = this.normOptions();
    return {
      code: this.code, gameId: this.game.id, gameTitle: this.game.title, emoji: this.game.emoji,
      visibility: this.visibility, status: this.status,
      players: this.publicPlayers(), hostUid: this.hostUid,
      maxPlayers: this.maxPlayers, minPlayers: this.game.minPlayers,
      supportsBots: !!this.game.supportsBots, botLevels: this.game.botLevels || [],
      options: this.options, optionDefs: this.game.options || [],
      optionsTitle: this.game.optionsTitle || null,
      optionZamky: zamky, optionInfo: info,
      canStart: this.activeCount >= this.game.minPlayers,
      parta: this.parta
        ? { kolo: this.parta.kolo, kola: this.parta.kola, tabulka: tabulka(this.parta, this.list) }
        : null,
      chat: this.chat.slice(-30),
    };
  }

  broadcastRoom() {
    const s = this.summary();
    for (const p of this.list) send(p.ws, S.ROOM, { room: s });
    this.manager?.roomsChanged();
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    clearTimeout(this.partaTimer);
    this.partaTimer = null;
    for (const p of this.list) send(p.ws, S.LEFT, { reason: 'closed' });
    this.players.clear();
  }
}
