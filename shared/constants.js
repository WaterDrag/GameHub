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
  // Po dvou minutách se nečinný hráč NENAHRAZUJE rovnou – nejdřív se
  // ostatních zeptáme. Kdo neodpoví do téhle lhůty, hlasování padá
  // a čeká se další dvě minuty.
  BOT_VOTE_MS: 30000,
  REJOIN_GRACE_MS: 180000,  // 3 min na návrat do rozehrané hry
  LOBBY_DROP_MS: 20000,     // odpojení v lobby = vyhození po 20 s
  EMPTY_ROOM_MS: 60000,     // místnost bez živého člověka
  COUNTDOWN_MS: 3000,

  // Tempo botů v TAHOVÝCH hrách. Dřív hráli tak rychle, že nebylo poznat,
  // co vlastně udělali. Jeden krok = jedna akce bota, ne celý tah –
  // naměřené akce na tah: Katan 3,7 · Člověče 2,6 · Kvak 1,7 · UNO 1,4.
  // Hry s víc akcemi na tah si krok krátí, ať jeden tah nezabere půl minuty.
  BOT_KROK_MS: 1400,
};

export const STATUS = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  OVER: 'over',
};
