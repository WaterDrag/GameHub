// ─────────────────────────────────────────────────────────────
//  RoomManager – evidence místností, kódy, matchmaking, úklid.
// ─────────────────────────────────────────────────────────────
import { ROOM, STATUS, TIMING } from '../shared/constants.js';
import { GAMES } from './games/index.js';
import { Room } from './room.js';
import { S, send } from './protocol.js';

export class RoomManager {
  constructor() {
    this.rooms = new Map();      // code -> Room
    this.lobbyWatchers = new Set(); // ws klientů, kteří koukají na seznam
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
    // Přijmi jen klíče, které hra sama nabízí – nic jiného se dovnitř
    // nedostane. Zaškrtávátko je boolean, výběr musí být jedna
    // z nabízených hodnot; cokoliv jiného spadne na výchozí.
    const clean = {};
    for (const o of game.options || []) {
      const v = options?.[o.key];
      if (o.typ === 'volba') {
        clean[o.key] = o.volby?.some(x => x.v === v) ? v : o.def;
      } else {
        clean[o.key] = !!v;
      }
    }
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

  publicList(gameId = null) {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.visibility !== 'public') continue;
      if (gameId && r.game.id !== gameId) continue;
      if (r.status !== STATUS.LOBBY) continue;
      if (r.isFull) continue;
      if (!r.connectedHumans.length) continue;
      out.push({
        code: r.code, gameId: r.game.id, gameTitle: r.game.title, emoji: r.game.emoji,
        hostName: r.players.get(r.hostUid)?.name || '?',
        count: r.activeCount, maxPlayers: r.maxPlayers,
        bots: r.list.filter(p => p.bot).length,
      });
    }
    return out.sort((a, b) => b.count - a.count);
  }

  // Najdi volnou veřejnou místnost, jinak založ vlastní.
  quickplay(user, ws, gameId) {
    const open = this.publicList(gameId).filter(r => r.count < r.maxPlayers);
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
  watchLobby(ws) { this.lobbyWatchers.add(ws); this.pushLobby(ws); this.roomsChanged(); }
  unwatchLobby(ws) {
    if (this.lobbyWatchers.delete(ws)) this.roomsChanged();
  }

  pushLobby(ws) { send(ws, S.ROOMS, { list: this.publicList(), stats: this.stats() }); }

  roomsChanged() {
    if (this._pending) return;                 // debounce – ať to nespamuje
    this._pending = setTimeout(() => {
      this._pending = null;
      const list = this.publicList();
      const stats = this.stats();
      for (const ws of this.lobbyWatchers) send(ws, S.ROOMS, { list, stats });
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
