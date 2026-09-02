import gomoku from './gomoku.js';
import arena from './arena.js';
import dostihy from './dostihy.js';
import racing from './racing.js';
import chess from './chess.js';
import clovece from './clovece.js';
import uno from './uno.js';
import katan from './katan.js';
import kvak from './kvak.js';
import lode from './lode.js';

export const GAMES = Object.fromEntries([arena, racing, dostihy, chess, clovece, uno, katan, kvak, lode, gomoku].map(g => [g.id, g]));

// Přijmi jen klíče, které hra sama nabízí – nic jiného se dovnitř
// nedostane. Zaškrtávátko je boolean, výběr musí být jedna z nabízených
// hodnot; cokoliv jiného spadne na výchozí. Platí pro volby od hostitele
// i pro ty, které si v párty módu vylosuje sama hra.
export function cistiVolby(game, options) {
  const clean = {};
  for (const o of game.options || []) {
    const v = options?.[o.key];
    if (o.typ === 'volba') clean[o.key] = o.volby?.some(x => x.v === v) ? v : o.def;
    else clean[o.key] = !!v;
  }
  return clean;
}

export function gameList() {
  return Object.values(GAMES).map(g => ({
    id: g.id, title: g.title, emoji: g.emoji, desc: g.desc,
    minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
    realtime: !!g.realtime, supportsBots: !!g.supportsBots,
    botLevels: g.botLevels || [],
    options: g.options || [],      // volby do zaškrtávátek před hrou
    optionsTitle: g.optionsTitle || null,
  }));
}
