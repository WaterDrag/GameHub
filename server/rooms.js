// ─────────────────────────────────────────────────────────────
//  RoomManager – evidence místností, kódy, matchmaking, úklid.
// ─────────────────────────────────────────────────────────────
import { ROOM, STATUS, TIMING } from '../shared/constants.js';
import { GAMES, cistiVolby } from './games/index.js';
import { Room } from './room.js';
import { S, send } from './protocol.js';

export class RoomManager {
  constructor() {
    this.rooms = new Map();      // code -> Room
    this.lobbyWatchers = new Map(); // ws klientů, kteří koukají na seznam -> uid
    // Doplní index.js. Bez přátel se chová, jako by nikdo nikoho neznal –
    // seznam místností tak funguje i sám o sobě.
    this.jePritel = () => false;
    this._pending = null;
    setInterval(() => this.sweep(), 10000);
  }

  newCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
      let c = '';
      for (let i = 0; i < ROOM.CODE_LEN; i++) {
        c += ROOM.CODE_ALPHABET[Math.floor(Math.random() * ROOM.CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('Nepodařilo se vygenerovat kód místnosti.');
  }

  create(user, { gameId, visibility = 'public', maxPlayers, options }) {
    const game = GAMES[gameId];
    if (!game) return { error: 'Neznámá hra.' };
    const clean = cistiVolby(game, options);
    const room = new Room({
      code: this.newCode(), game, hostUid: user.uid,
      visibility, maxPlayers, options: clean, manager: this,
    });
    this.rooms.set(room.code, room);
    return { room };
  }

  get(code) { return this.rooms.get(String(code || '').toUpperCase().trim()); }

  // Kde je tenhle hráč? Tohle je jádro "returner systému" – po
  // refreshi stránky se podle uid pozná, že patří do rozehrané hry.
  roomOf(uid) {
    for (const r of this.rooms.values()) if (r.players.has(uid)) return r;
    return null;
  }

  //  Seznam je pro každého jiný: „jen pro přátele“ vidí jenom kamarád
  //  někoho uvnitř. Bez uid (matchmaking) se počítá jen veřejné.
  publicList(gameId = null, uid = null) {
    const out = [];
    for (const r of this.rooms.values()) {
      if (gameId && r.game.id !== gameId) continue;
      if (r.status !== STATUS.LOBBY) continue;
      if (r.isFull) continue;
      if (!r.connectedHumans.length) continue;

      const kamarad = !!uid && r.humans.some(p => p.uid !== uid && this.jePritel(uid, p.uid));
      const jsemTam = !!uid && r.players.has(uid);
      if (r.visibility === 'private') continue;
      if (r.visibility === 'pratele' && !kamarad && !jsemTam) continue;

      out.push({
        code: r.code, gameId: r.game.id, gameTitle: r.game.title, emoji: r.game.emoji,
        hostName: r.players.get(r.hostUid)?.name || '?',
        count: r.activeCount, maxPlayers: r.maxPlayers,
        bots: r.list.filter(p => p.bot).length,
        pratele: kamarad, jenPratele: r.visibility === 'pratele',
      });
    }
    // Místnosti s kamarádem nahoru – kvůli tomu ten seznam vlastně je.
    return out.sort((a, b) => (b.pratele - a.pratele) || (b.count - a.count));
  }

  // Najdi volnou veřejnou místnost, jinak založ vlastní.
  quickplay(user, ws, gameId) {
    // S uid: seznam už má kamarádské místnosti nahoře, takže rychlá hra
    // sama posílá k přátelům dřív než k cizim.
    const open = this.publicList(gameId, user.uid).filter(r => r.count < r.maxPlayers);
    for (const info of open) {
      const room = this.get(info.code);
      if (room && !room.isFull && room.status === STATUS.LOBBY) {
        const p = room.add(user, ws);
        if (p) return { room, player: p };
      }
    }
    const res = this.create(user, { gameId, visibility: 'public' });
    if (res.error) return res;
    const p = res.room.add(user, ws);
    return { room: res.room, player: p };
  }

  // ── Živý seznam místností pro lobby ──────────────────────
  watchLobby(ws, uid = null) { this.lobbyWatchers.set(ws, uid); this.pushLobby(ws); this.roomsChanged(); }
  unwatchLobby(ws) {
    if (this.lobbyWatchers.delete(ws)) this.roomsChanged();
  }

  pushLobby(ws) {
    send(ws, S.ROOMS, { list: this.publicList(null, this.lobbyWatchers.get(ws)), stats: this.stats() });
  }

  roomsChanged() {
    if (this._pending) return;                 // debounce – ať to nespamuje
    this._pending = setTimeout(() => {
      this._pending = null;
      const stats = this.stats();
      // Veřejná část je pro všechny stejná, tak se spočítá jednou; osobní
      // seznam se dopočítává jen tomu, kdo vůbec nějaké přátele může mít.
      const spolecny = this.publicList();
      for (const [ws, uid] of this.lobbyWatchers) {
        send(ws, S.ROOMS, { list: uid ? this.publicList(null, uid) : spolecny, stats });
      }
    }, 150);
  }

  // ── Úklid ────────────────────────────────────────────────
  sweep() {
    const now = Date.now();
    let changed = false;
    for (const [code, r] of this.rooms) {
      const anyoneComing = r.humans.some(p =>
        p.connected || (now - p.disconnectedAt < TIMING.REJOIN_GRACE_MS)
      );
      const stale = !anyoneComing && now - r.createdAt > TIMING.EMPTY_ROOM_MS;
      if (stale || r.players.size === 0) {
        r.destroy();
        this.rooms.delete(code);
        changed = true;
      }
    }
    if (changed) this.roomsChanged();
  }

  stats() {
    let players = 0, playing = 0;
    for (const r of this.rooms.values()) {
      players += r.connectedHumans.length;
      if (r.status === STATUS.PLAYING) playing++;
    }
    // + lidi, co zrovna koukají na hub a nejsou v žádné místnosti
    return { rooms: this.rooms.size, players: players + this.lobbyWatchers.size, playing };
  }
}
