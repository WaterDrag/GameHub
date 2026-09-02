// ─────────────────────────────────────────────────────────────
//  Game Hub – autoritativní server.
//
//  Obsluhuje statického klienta i WebSocket. Klient posílá jen
//  vstupy, server posílá jen pohledy na stav. Nic víc.
// ─────────────────────────────────────────────────────────────
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { identify, PROJECT_ID, DEV_AUTH } from './auth.js';
import { C, S, send } from './protocol.js';
import { RoomManager } from './rooms.js';
import { PartyManager } from './party.js';
import { Pratele } from './pratele.js';
import { gameList } from './games/index.js';
import { TIMING, STATUS, PROTO_VERSION } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = process.env.PORT || 3000;

const manager = new RoomManager();

// Spojení podle uid – vůdce party potřebuje ostatní někam přesunout.
// Drží se poslední spojení, stejně jako to dělá místnost.
const conns = new Map();

const pratele = new Pratele();
manager.jePritel = (a, b) => pratele.jsouPratele(a, b);

// Kde hráč zrovna je – přátelé to vidí v seznamu, ať se dá skočit za nimi.
function kdeJe(uid) {
  const r = manager.roomOf(uid);
  if (!r) return null;
  return {
    code: r.code, hra: r.game.title, emoji: r.game.emoji,
    status: r.status, soukroma: r.visibility === 'private',
  };
}

function stavPratel(uid) {
  const c = conns.get(uid);
  if (!c || !c.user) return;
  send(c.ws, S.FRIENDS, pratele.stav(uid, c.user.name, {
    online: (u) => conns.has(u), kde: kdeJe,
  }));
}

// Přátelům se posílá vlastní seznam, ne ten můj – proto jednomu po druhém.
function oznamPratelum(uid, dotcene = null) {
  for (const u of dotcene || [uid, ...pratele.pratelaOf(uid)]) stavPratel(u);
  if (!dotcene) stavPratel(uid);
}

const party = new PartyManager({
  najdiConn: (uid) => conns.get(uid) || null,
  posli: (ws, stav) => send(ws, S.PARTY, { party: stav }),
  dejDoMistnosti: (conn, kod) => {
    const room = manager.get(kod);
    if (!room) return false;
    if (conn.room === room) return true;
    if (conn.room) leave(conn);
    const p = room.add(conn.user, conn.ws);
    if (!p) return false;
    conn.room = room; conn.player = p;
    manager.unwatchLobby(conn.ws);
    send(conn.ws, S.RESUME, { code: room.code, status: room.status });
    return true;
  },
});

// ── Statika ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

// Kód (html/js/css) se NIKDY necachuje natvrdo – jen se revaliduje
// přes ETag. Cachovat js "na 5 minut" je přesně ta věc, kvůli které
// pak člověk hodinu hledá bug, který už dávno opravil.
const CODE = new Set(['.html', '.js', '.css', '.mjs', '.json']);

function serveFile(res, base, rel) {
  const file = path.resolve(base, '.' + rel);
  if (!file.startsWith(base)) { res.writeHead(403).end('nope'); return; }   // ../../ útoky
  fs.stat(file, (statErr, st) => {
    if (statErr || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${st.size}-${st.mtimeMs}"`;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': CODE.has(ext) ? 'no-cache' : 'public, max-age=86400',
      'ETag': etag,
    };
    if (res.req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
      res.writeHead(200, headers);
      res.end(buf);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let p = decodeURIComponent(url.pathname);

  if (p === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ...manager.stats(), uptime: process.uptime() }));
  }
  if (p === '/api/games') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(gameList()));
  }
  if (p.startsWith('/shared/')) return serveFile(res, SHARED, p.slice('/shared'.length));
  if (p === '/') p = '/index.html';
  serveFile(res, PUBLIC, p);
});

// ── WebSocket ────────────────────────────────────────────────
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

// Jednoduchý token bucket. Konzole sice nemůže podvádět ve hře,
// ale zaplavit server zprávami by mohla – tohle to utne.
function bucket(rate = 80, burst = 160) {
  let tokens = burst, last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const cleanName = (s) =>
  String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Hráč';

wss.on('connection', (ws, req) => {
  const conn = {
    ws, user: null, room: null, player: null, alive: true, take: bucket(),
    addr: req.socket.remoteAddress,
  };
  ws.conn = conn;
  // do `conns` se zapisuje až při HELLO, dřív nemá spojení uid

  ws.on('pong', () => { conn.alive = true; });

  ws.on('message', async (raw) => {
    if (!conn.take()) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    try { await handle(conn, msg); }
    catch (e) { send(ws, S.ERROR, { msg: e.message || 'Chyba serveru.' }); }
  });

  ws.on('close', () => {
    manager.unwatchLobby(ws);
    if (conn.user && conns.get(conn.user.uid) === conn) conns.delete(conn.user.uid);
    if (conn.room && conn.user) conn.room.detach(conn.user.uid, ws);
    // Ostatní v partě mají vědět, že je teď offline.
    if (conn.user) {
      party.rozesli(party.proHrace(conn.user.uid));
      for (const u of pratele.pratelaOf(conn.user.uid)) stavPratel(u);
    }
  });
});

// Mrtvá spojení (zavřený laptop, vypadlá wifi) se poznají až pingem.
setInterval(() => {
  for (const ws of wss.clients) {
    const conn = ws.conn;
    if (!conn) continue;
    if (!conn.alive) { ws.terminate(); continue; }
    conn.alive = false;
    ws.ping();
  }
}, TIMING.HEARTBEAT_MS);

// ── Routing zpráv ────────────────────────────────────────────
async function handle(conn, msg) {
  const { ws } = conn;

  if (msg.t === C.PING) return send(ws, S.PONG, { t0: msg.t0, ts: Date.now() });

  if (msg.t === C.HELLO) {
    const auth = await identify({ token: msg.token, name: cleanName(msg.name) }, conn.addr);
    conn.user = { uid: auth.uid, name: cleanName(msg.name || auth.name), guest: auth.guest };
    conns.set(conn.user.uid, conn);
    send(ws, S.WELCOME, {
      uid: conn.user.uid, name: conn.user.name, guest: conn.user.guest,
      deviceToken: auth.issued || null,   // klient si ho uloží, ať přežije refresh
      games: gameList(), proto: PROTO_VERSION,
    });

    // Returner: pokud hráč pořád patří do nějaké místnosti, vrať ho tam.
    const back = manager.roomOf(conn.user.uid);
    if (back) {
      conn.room = back;
      conn.player = back.players.get(conn.user.uid);
      back.attach(conn.player, ws);
      back.broadcastRoom();
      send(ws, S.RESUME, { code: back.code, status: back.status });
      if (back.status === STATUS.PLAYING || back.status === STATUS.OVER) {
        send(ws, S.START, {
          gameId: back.game.id, realtime: !!back.game.realtime,
          tickRate: back.game.tickRate || 4, tick: back.tick,
          view: back.game.view(back.state, conn.user.uid),
          players: back.publicPlayers(), resumed: true,
        });
      }
    } else {
      manager.watchLobby(ws, conn.user.uid);
    }
    // Přátelé: aktualizuj přezdívku, pošli seznam sobě i těm, kterým
    // jsem teď naskočil jako online.
    pratele.zaznam(conn.user.uid, conn.user.name);
    oznamPratelum(conn.user.uid);

    // Parta přežije refresh – po přihlášení se rovnou pošle zpátky.
    const mojeParty = party.proHrace(conn.user.uid);
    if (mojeParty) {
      mojeParty.pridej(conn.user);       // jméno se mohlo změnit
      party.rozesli(mojeParty);
    }
    return;
  }

  if (!conn.user) return send(ws, S.ERROR, { msg: 'Nejdřív se přihlas.' });

  switch (msg.t) {
    case C.LIST:
      manager.watchLobby(ws, conn.user.uid);
      return manager.pushLobby(ws);

    case C.CREATE: {
      if (conn.room) leave(conn);
      const { room, error } = manager.create(conn.user, {
        gameId: msg.gameId, visibility: msg.visibility, maxPlayers: msg.maxPlayers,
        options: msg.options,
      });
      if (error) return send(ws, S.ERROR, { msg: error });
      const p = room.add(conn.user, ws);
      conn.room = room; conn.player = p;
      manager.unwatchLobby(ws);
      for (let i = 0; i < (msg.bots | 0); i++) room.addBot(msg.botLevel);
      return;
    }

    case C.JOIN: {
      const room = manager.get(msg.code);
      if (!room) return send(ws, S.ERROR, { msg: 'Místnost neexistuje.' });
      if (conn.room && conn.room !== room) leave(conn);
      const p = room.add(conn.user, ws);
      if (!p) return send(ws, S.ERROR, { msg: room.isFull ? 'Místnost je plná.' : 'Hra už běží.' });
      conn.room = room; conn.player = p;
      manager.unwatchLobby(ws);
      return;
    }

    case C.QUICKPLAY: {
      if (conn.room) leave(conn);
      const { room, player, error } = manager.quickplay(conn.user, ws, msg.gameId);
      if (error || !player) return send(ws, S.ERROR, { msg: error || 'Nepodařilo se připojit.' });
      conn.room = room; conn.player = player;
      manager.unwatchLobby(ws);
      return;
    }

    case C.LEAVE:
      leave(conn);
      manager.watchLobby(ws, conn.user.uid);
      send(ws, S.LEFT, { reason: 'left' });
      return manager.pushLobby(ws);

    // ── Parta ────────────────────────────────────────────────
    case C.PARTY_NEW:
      return party.rozesli(party.vytvor(conn.user));

    case C.PARTY_JOIN: {
      const { party: p, chyba } = party.pripoj(conn.user, msg.kod);
      if (chyba) return send(ws, S.ERROR, { msg: chyba });
      return party.rozesli(p);
    }

    case C.PARTY_LEAVE: {
      const p = party.opust(conn.user.uid);
      send(ws, S.PARTY, { party: null });
      return party.rozesli(p);
    }

    case C.PARTY_KICK:
      return void party.vyhod(conn.user.uid, String(msg.uid || ''));

    case C.PARTY_PULL: {
      const p = party.proHrace(conn.user.uid);
      if (!p) return send(ws, S.ERROR, { msg: 'Nejsi v partě.' });
      if (p.vudce !== conn.user.uid) return send(ws, S.ERROR, { msg: 'Jen vůdce party.' });
      if (!conn.room) return send(ws, S.ERROR, { msg: 'Nejdřív založ místnost.' });
      const { vzato, nevzato } = party.natahni(p, conn.room.code);
      party.rozesli(p);
      conn.room.broadcastRoom();
      if (nevzato.length) {
        send(ws, S.ERROR, { msg: `Nevzal jsem: ${nevzato.join(', ')} (offline nebo plno).` });
      } else if (!vzato) {
        send(ws, S.ERROR, { msg: 'Nikoho dalšího v partě nemáš.' });
      }
      return;
    }

    // ── Přátelé ──────────────────────────────────────────────
    case C.FRIENDS:
      return stavPratel(conn.user.uid);

    case C.FRIEND_ADD: {
      const r = pratele.pozadat(conn.user.uid, conn.user.name, msg.kod);
      if (r.chyba) return send(ws, S.ERROR, { msg: r.chyba });
      oznamPratelum(conn.user.uid, r.dotcene);
      manager.roomsChanged();
      if (r.zprava) send(ws, S.ERROR, { msg: r.zprava, ok: true });
      return;
    }

    case C.FRIEND_ACCEPT: {
      const r = pratele.prijmi(conn.user.uid, String(msg.uid || ''));
      if (r.chyba) return send(ws, S.ERROR, { msg: r.chyba });
      oznamPratelum(conn.user.uid, r.dotcene);
      manager.roomsChanged();
      if (r.zprava) send(ws, S.ERROR, { msg: r.zprava, ok: true });
      return;
    }

    case C.FRIEND_DECLINE: {
      const r = pratele.odmitni(conn.user.uid, String(msg.uid || ''));
      if (r.chyba) return send(ws, S.ERROR, { msg: r.chyba });
      return oznamPratelum(conn.user.uid, r.dotcene);
    }

    case C.FRIEND_REMOVE: {
      const r = pratele.smaz(conn.user.uid, String(msg.uid || ''));
      oznamPratelum(conn.user.uid, r.dotcene);
      return manager.roomsChanged();
    }
  }

  // ── Dál už jen věci uvnitř místnosti ───────────────────────
  const room = conn.room, me = conn.player;
  if (!room || !me) return;

  switch (msg.t) {
    case C.READY:
      me.ready = !!msg.v;
      return room.broadcastRoom();

    case C.PARTY_MOD: {
      const err = room.spustParty(conn.user.uid, msg.kola);
      if (err) send(ws, S.ERROR, { msg: err });
      return;
    }

    case C.PARTY_STOP: {
      if (conn.user.uid !== room.hostUid) return send(ws, S.ERROR, { msg: 'Párty mód ukončuje hostitel.' });
      if (!room.parta) return;
      return room.ukonciParty('Hostitel párty mód ukončil.');
    }

    case C.START: {
      const err = room.requestStart(conn.user.uid);
      if (err) send(ws, S.ERROR, { msg: err });
      return;
    }

    case C.KICK: {
      if (conn.user.uid !== room.hostUid) return send(ws, S.ERROR, { msg: 'Jen hostitel.' });
      if (msg.uid === room.hostUid) return;
      const victim = room.players.get(msg.uid);
      if (victim?.ws?.conn) { victim.ws.conn.room = null; victim.ws.conn.player = null; }
      return room.remove(msg.uid, 'kicked');
    }

    case C.SET_OPTION: {
      const err = room.setOption(conn.user.uid, msg.key, msg.value);
      if (err) send(ws, S.ERROR, { msg: err });
      return;
    }

    case C.ADD_BOT:
      if (conn.user.uid !== room.hostUid) return send(ws, S.ERROR, { msg: 'Jen hostitel.' });
      if (!room.addBot(msg.difficulty)) send(ws, S.ERROR, { msg: 'Bota teď přidat nejde.' });
      return;

    case C.DEL_BOT:
      if (conn.user.uid !== room.hostUid) return send(ws, S.ERROR, { msg: 'Jen hostitel.' });
      if (room.players.get(msg.uid)?.bot) room.remove(msg.uid, 'removed');
      return;

    case C.CHAT: {
      const text = String(msg.msg || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
      if (!text) return;
      // uid posíláme kvůli bublinám – podle jména se to rozlišit nedá,
      // dva hráči můžou mít stejnou přezdívku
      const entry = { uid: conn.user.uid, from: conn.user.name, msg: text, ts: Date.now() };
      room.chat.push(entry);
      if (room.chat.length > 60) room.chat.shift();
      return room.broadcast(S.CHAT, entry);
    }

    case C.ACTION:
      return room.handleAction(me, msg);

    case C.INPUT:
      return room.handleInput(me, msg);

    case C.REMATCH: {
      const err = room.rematch(conn.user.uid);
      if (err) send(ws, S.ERROR, { msg: err });
      return;
    }

    case C.VOTE_BOT:
      return room.hlasuj(me, String(msg.uid || ''), !!msg.ano);
  }
}

function leave(conn) {
  if (!conn.room) return;
  conn.room.remove(conn.user.uid, 'left');
  conn.room = null;
  conn.player = null;
}

server.listen(PORT, () => {
  console.log(`▶ Game Hub běží na http://localhost:${PORT}`);
  console.log(`  Firebase projekt: ${PROJECT_ID}`);
  console.log(`  Hry: ${gameList().map(g => g.title).join(', ')}`);
  if (DEV_AUTH) {
    console.log('  ⚠ DEV_AUTH je ZAPNUTÝ – z localhostu lze přihlásit tokenem "dev:Jmeno".');
    console.log('    V produkci NIKDY nenastavuj GH_DEV_AUTH=1.');
  }
});
