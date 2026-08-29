// ─────────────────────────────────────────────────────────────
//  Protokol klient <-> server.
//
//  Klíčové pravidlo celého Hubu: klient posílá VÝHRADNĚ vstupy
//  (co zmáčkl, kam míří, jaký tah chce udělat). Nikdy neposílá
//  stav – žádné HP, pozice, skóre. Server je jediná pravda.
//  Proto se přes konzoli nedá podvádět: není co přepsat.
// ─────────────────────────────────────────────────────────────

// klient -> server
export const C = {
  HELLO:      'hello',      // {token, name}
  PING:       'ping',       // {t0}
  LIST:       'list',       // {gameId?}  – veřejné místnosti
  CREATE:     'create',     // {gameId, visibility, maxPlayers, bots}
  JOIN:       'join',       // {code}
  QUICKPLAY:  'quickplay',  // {gameId}   – najdi místnost nebo vytvoř
  LEAVE:      'leave',      // {}
  READY:      'ready',      // {v}
  START:      'start',      // {}         – jen host
  KICK:       'kick',       // {uid}      – jen host
  SET_OPTION: 'setOption',  // {key, value} – jen host, jen v lobby
  ADD_BOT:    'addBot',     // {difficulty}
  DEL_BOT:    'delBot',     // {uid}
  CHAT:       'chat',       // {msg}
  INPUT:      'input',      // {seq, ...} – realtime hry
  ACTION:     'action',     // {...}      – tahové hry
  REMATCH:    'rematch',    // {}
};

// server -> klient
export const S = {
  WELCOME:   'welcome',    // {uid, name, guest, games[]}
  PONG:      'pong',       // {t0, ts}
  ROOMS:     'rooms',      // {list[]}
  ROOM:      'room',       // {room}  – stav lobby
  LEFT:      'left',       // {reason}
  COUNTDOWN: 'countdown',  // {n}
  START:     'start',      // {gameId, tickRate, view, tick}
  SNAP:      'snap',       // {tick, view, ack}
  EVENT:     'event',      // {kind, ...} – jednorázové efekty (výstřel, zásah, zvuk)
  OVER:      'over',       // {result}
  CHAT:      'chat',       // {from, msg, ts}
  ERROR:     'error',      // {msg}
  RESUME:    'resume',     // {code} – server sám nabídne návrat do rozehrané hry
};

export function send(ws, type, data = {}) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ t: type, ...data }));
}
