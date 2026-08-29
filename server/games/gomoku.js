// ─────────────────────────────────────────────────────────────
//  Piškvorky (gomoku) – 15x15, pět v řadě, volný styl.
//
//  Ukázkový tahový modul: veškerá validace je tady na serveru.
//  Klient smí poslat jen {x,y}; jestli je na tahu, jestli je
//  políčko volné a jestli někdo vyhrál, rozhoduje výhradně server.
// ─────────────────────────────────────────────────────────────

const SIZE = 15;
const WIN = 5;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const TURN_MS = 60000;

const idx = (x, y) => y * SIZE + x;
const inB = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

// ── Vyhodnocení jedné linie pro heuristiku bota ──────────────
// Vrací sílu tahu na (x,y) pro hráče p ve směru (dx,dy):
// kolik kamenů by vzniklo v řadě a kolik má řada otevřených konců.
function lineScore(board, x, y, dx, dy, p) {
  let count = 1, open = 0;
  for (const s of [1, -1]) {
    let i = 1;
    while (inB(x + dx * i * s, y + dy * i * s) && board[idx(x + dx * i * s, y + dy * i * s)] === p) { count++; i++; }
    const ex = x + dx * i * s, ey = y + dy * i * s;
    if (inB(ex, ey) && board[idx(ex, ey)] === 0) open++;
  }
  if (count >= WIN) return 100000000;
  if (count === 4) return open === 2 ? 1000000 : open === 1 ? 100000 : 0;
  if (count === 3) return open === 2 ? 50000 : open === 1 ? 5000 : 0;
  if (count === 2) return open === 2 ? 500 : open === 1 ? 50 : 0;
  return open === 2 ? 10 : open === 1 ? 1 : 0;
}

function moveScore(board, x, y, p) {
  let s = 0;
  for (const [dx, dy] of DIRS) s += lineScore(board, x, y, dx, dy, p);
  return s;
}

// Kandidáti = volná pole do vzdálenosti 2 od nějakého kamene.
// Bez tohohle ořezu by bot na prázdné desce zvažoval 225 polí zbytečně.
function candidates(board) {
  const out = [];
  let any = false;
  for (let i = 0; i < board.length; i++) if (board[i]) { any = true; break; }
  if (!any) return [{ x: 7, y: 7 }];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[idx(x, y)] !== 0) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (!inB(x + dx, y + dy)) continue;
          if (board[idx(x + dx, y + dy)] !== 0) { near = true; break; }
        }
      if (near) out.push({ x, y });
    }
  }
  return out;
}

function findWinLine(board, x, y, p) {
  for (const [dx, dy] of DIRS) {
    const cells = [{ x, y }];
    for (const s of [1, -1]) {
      let i = 1;
      while (inB(x + dx * i * s, y + dy * i * s) && board[idx(x + dx * i * s, y + dy * i * s)] === p) {
        cells.push({ x: x + dx * i * s, y: y + dy * i * s });
        i++;
      }
    }
    if (cells.length >= WIN) return cells;
  }
  return null;
}

export default {
  id: 'gomoku',
  title: 'Piškvorky',
  emoji: '⭕',
  desc: 'Pět v řadě na desce 15×15.',
  minPlayers: 2,
  maxPlayers: 2,
  realtime: false,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  createState({ players, rng }) {
    const seats = rng.shuffle(players.map(p => p.uid)); // kdo začíná je náhoda ze serveru
    return {
      size: SIZE,
      board: new Array(SIZE * SIZE).fill(0),
      seats,
      turn: 0,
      lastMove: null,
      moves: 0,
      winner: null,
      winLine: null,
      turnDeadline: Date.now() + TURN_MS,
    };
  },

  // ── Tah hráče ────────────────────────────────────────────
  onAction(state, player, msg, ctx) {
    if (state.winner) return;
    if (state.seats[state.turn] !== player.uid) return ctx.reject(player, 'Nejsi na tahu.');

    const x = msg.x | 0, y = msg.y | 0;
    if (!inB(x, y)) return ctx.reject(player, 'Mimo desku.');
    if (state.board[idx(x, y)] !== 0) return ctx.reject(player, 'Obsazeno.');

    const mark = state.turn + 1;
    state.board[idx(x, y)] = mark;
    state.lastMove = { x, y, seat: state.turn };
    state.moves++;

    const line = findWinLine(state.board, x, y, mark);
    if (line) {
      state.winner = player.uid;
      state.winLine = line;
    } else if (state.moves >= SIZE * SIZE) {
      state.winner = 'draw';
    } else {
      state.turn = 1 - state.turn;
      state.turnDeadline = Date.now() + TURN_MS;
    }
    ctx.emit('move', { x, y, seat: state.lastMove.seat });
  },

  // ── Vypršel čas na tah → zahraje bot za tebe ─────────────
  tick(state, dt, ctx) {
    if (state.winner || Date.now() < state.turnDeadline) return;
    const onTurn = ctx.players.find(p => p.uid === state.seats[state.turn]);
    if (!onTurn) return;
    const mv = this.botThink(state, { ...onTurn, botLevel: 'normal' }, ctx);
    if (mv) this.onAction(state, onTurn, mv, ctx);
  },

  // ── Bot ──────────────────────────────────────────────────
  botThink(state, player, ctx) {
    if (state.winner) return null;
    if (state.seats[state.turn] !== player.uid) return null;

    const me = state.turn + 1;
    const opp = 2 - state.turn;
    const level = player.botLevel || 'normal';
    const cands = candidates(state.board);
    if (!cands.length) return null;

    const scored = cands.map(c => {
      const atk = moveScore(state.board, c.x, c.y, me);
      const def = moveScore(state.board, c.x, c.y, opp);
      // Útok mírně přebíjí obranu – jinak bot jen brání a nikdy nevyhraje.
      return { ...c, s: atk + def * 0.92 };
    }).sort((a, b) => b.s - a.s);

    if (level === 'easy') {
      // Občas zahraje hloupě, ale výhru/prohru v jednom tahu pozná.
      if (scored[0].s < 100000 && ctx.rng() < 0.35) return ctx.rng.pick(scored.slice(0, Math.min(8, scored.length)));
      return ctx.rng.pick(scored.slice(0, Math.min(3, scored.length)));
    }

    if (level === 'hard' && scored[0].s < 1000000) {
      // 2 pol.: zahraj tak, aby soupeřova nejlepší odpověď byla co nejslabší.
      let best = scored[0], bestVal = -Infinity;
      for (const c of scored.slice(0, 8)) {
        state.board[idx(c.x, c.y)] = me;
        let oppBest = 0;
        for (const r of candidates(state.board).slice(0, 24)) {
          const v = moveScore(state.board, r.x, r.y, opp) + moveScore(state.board, r.x, r.y, me) * 0.9;
          if (v > oppBest) oppBest = v;
        }
        state.board[idx(c.x, c.y)] = 0;
        const val = c.s - oppBest * 0.85;
        if (val > bestVal) { bestVal = val; best = c; }
      }
      return best;
    }

    return scored[0];
  },

  // Celý stav je veřejný, jen doplníme "kdo jsem".
  view(state, uid) {
    return {
      size: state.size,
      board: state.board,
      seats: state.seats,
      turn: state.turn,
      lastMove: state.lastMove,
      winner: state.winner,
      winLine: state.winLine,
      mySeat: state.seats.indexOf(uid),
      turnMsLeft: Math.max(0, state.turnDeadline - Date.now()),
    };
  },

  result(state) {
    if (!state.winner) return null;
    if (state.winner === 'draw') return { draw: true, reason: 'Remíza – deska je plná.' };
    return { winners: [state.winner], reason: 'Pět v řadě!' };
  },
};
