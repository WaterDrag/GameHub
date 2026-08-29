// Sdílené konstanty – importuje je server (../shared/...) i prohlížeč (/shared/...).
export const PROTO_VERSION = 1;

export const ROOM = {
  CODE_LEN: 5,
  CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // bez I/O/0/1 kvůli přepisování z obrazovky
};

export const TIMING = {
  HEARTBEAT_MS: 10000,      // ping z klienta
  DEAD_MS: 30000,           // bez pongu = mrtvé spojení
  BOT_TAKEOVER_MS: 3000,    // po odpojení převezme postavu bot
  // Odpojený hráč nemůže hrát vůbec, takže ho bot bere hned. Tohle je
  // něco jiného: hráč je připojený, ale dvě minuty nic nedělá.
  IDLE_TAKEOVER_MS: 120000,
  REJOIN_GRACE_MS: 180000,  // 3 min na návrat do rozehrané hry
  LOBBY_DROP_MS: 20000,     // odpojení v lobby = vyhození po 20 s
  EMPTY_ROOM_MS: 60000,     // místnost bez živého člověka
  COUNTDOWN_MS: 3000,
};

export const STATUS = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  OVER: 'over',
};
