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

const TURN_LOOP_HZ = 4;      // tahovky – stačí na odpočet kola
const BOT_THINK_MIN = 500;   // ať bot nehraje nelidsky okamžitě
const BOT_THINK_MAX = 1400;

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
    this.visibility = visibility === 'private' ? 'private' : 'public';
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
        this.takeOver(p, 'nečinnost');
      }
    }
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
    this.broadcast(S.OVER, { result, players: this.publicPlayers() });
  }

  rematch(uid) {
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
    return {
      code: this.code, gameId: this.game.id, gameTitle: this.game.title, emoji: this.game.emoji,
      visibility: this.visibility, status: this.status,
      players: this.publicPlayers(), hostUid: this.hostUid,
      maxPlayers: this.maxPlayers, minPlayers: this.game.minPlayers,
      supportsBots: !!this.game.supportsBots, botLevels: this.game.botLevels || [],
      options: this.options, optionDefs: this.game.options || [],
      canStart: this.activeCount >= this.game.minPlayers,
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
    for (const p of this.list) send(p.ws, S.LEFT, { reason: 'closed' });
    this.players.clear();
  }
}
