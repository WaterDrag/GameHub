import gomoku from './gomoku.js';
import arena from './arena.js';
import dostihy from './dostihy.js';
import racing from './racing.js';
import chess from './chess.js';
import clovece from './clovece.js';
import uno from './uno.js';

export const GAMES = Object.fromEntries([arena, racing, dostihy, chess, clovece, uno, gomoku].map(g => [g.id, g]));

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
