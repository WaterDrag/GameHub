// ─────────────────────────────────────────────────────────────
//  Piškvorky – pouze vykreslování a odchyt kliknutí.
//
//  Tenhle soubor NEROZHODUJE o ničem. Nezná pravidla, neví kdo
//  vyhrál. Jen kreslí to, co přišlo ze serveru, a posílá zpátky
//  "chci hrát na X,Y". Kdo si tu v konzoli přepíše board, uvidí
//  svoji lež přesně do příštího snapshotu.
// ─────────────────────────────────────────────────────────────
import { PIXI, damp } from '../pixi.js';
import * as T from '../theme.js';

const PAD = 28;
// Barvy sedadel bere z aktivního motivu, ne natvrdo – jinak by hra
// vypadala jako cizí těleso vedle přebarveného menu.
const SEAT_VAR = ['--acc', '--ok'];

export default {
  id: 'gomoku',

  async mount(ctx) {
    this.ctx = ctx;
    this.view = ctx.view;
    this.hover = null;
    this.anim = new Map();                 // "x,y" -> 0..1 náběh kamene
    this.pal = T.colors();
    this.offTheme = T.onThemeChange(({ colors }) => {
      this.pal = colors;
      this.drawBoard();
      this.renderHud();
    });

    const root = new PIXI.Container();
    ctx.stage.addChild(root);
    this.root = root;

    this.gBoard = new PIXI.Graphics();
    this.gStones = new PIXI.Graphics();
    this.gFx = new PIXI.Graphics();
    root.addChild(this.gBoard, this.gStones, this.gFx);

    this.hit = new PIXI.Container();
    this.hit.eventMode = 'static';
    this.hit.cursor = 'pointer';
    root.addChild(this.hit);
    this.hitRect = new PIXI.Graphics();
    this.hitRect.alpha = 0;
    this.hit.addChild(this.hitRect);

    this.hit.on('pointermove', (e) => {
      const p = e.getLocalPosition(root);
      this.hover = this.cellAt(p.x, p.y);
    });
    this.hit.on('pointerleave', () => { this.hover = null; });
    this.hit.on('pointertap', (e) => {
      const p = e.getLocalPosition(root);
      const c = this.cellAt(p.x, p.y);
      if (!c) return;
      if (this.view.winner) return;
      if (this.view.mySeat !== this.view.turn) return;
      if (this.view.board[c.y * this.view.size + c.x] !== 0) return;
      ctx.send('action', { x: c.x, y: c.y });
    });

    this.layout(ctx.app.screen.width, ctx.app.screen.height);
    this.ticker = (t) => this.draw(t.deltaMS / 1000);
    ctx.app.ticker.add(this.ticker);
    this.renderHud();
  },

  layout(w, h) {
    const size = this.view.size;
    const boardPx = Math.max(120, Math.min(w, h) - PAD * 2);
    this.cell = boardPx / size;
    this.ox = (w - boardPx) / 2;
    this.oy = (h - boardPx) / 2;
    this.boardPx = boardPx;

    this.hitRect.clear().rect(this.ox, this.oy, boardPx, boardPx).fill({ color: 0xffffff });
    this.drawBoard();
  },

  resize(w, h) { this.layout(w, h); },

  cellAt(px, py) {
    const x = Math.floor((px - this.ox) / this.cell);
    const y = Math.floor((py - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= this.view.size || y >= this.view.size) return null;
    return { x, y };
  },

  cx(x) { return this.ox + (x + 0.5) * this.cell; },
  cy(y) { return this.oy + (y + 0.5) * this.cell; },

  drawBoard() {
    const g = this.gBoard.clear();
    const { ox, oy, boardPx, cell } = this;
    const size = this.view.size;

    const line = this.pal.line;

    g.roundRect(ox - 10, oy - 10, boardPx + 20, boardPx + 20, 18)
      .fill({ color: this.pal.board })
      .stroke({ width: 1, color: line, alpha: 0.10 });

    for (let i = 0; i <= size; i++) {
      const a = i === 0 || i === size ? 0.20 : 0.08;
      g.moveTo(ox + i * cell, oy).lineTo(ox + i * cell, oy + boardPx).stroke({ width: 1, color: line, alpha: a });
      g.moveTo(ox, oy + i * cell).lineTo(ox + boardPx, oy + i * cell).stroke({ width: 1, color: line, alpha: a });
    }
    // hvězdné body jako na skutečné desce
    for (const [hx, hy] of [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]]) {
      if (hx >= size || hy >= size) continue;
      g.circle(this.cx(hx), this.cy(hy), 2.5).fill({ color: line, alpha: 0.22 });
    }
  },

  update(view) {
    this.view = view;
    this.renderHud();
  },

  event(ev) {
    if (ev.kind === 'botTakeover') {
      this.ctx.toast(`${ev.name} se odpojil – hraje za něj bot.`, 'warn');
    }
  },

  // Skutečný křížek a kolečko, ne barevné kameny.
  // mark 1 = ✕, mark 2 = ◯
  drawMark(g, cx, cy, r, mark, color, alpha, width) {
    if (mark === 1) {
      const d = r * 0.74;
      g.moveTo(cx - d, cy - d).lineTo(cx + d, cy + d)
        .stroke({ width, color, alpha, cap: 'round' });
      g.moveTo(cx + d, cy - d).lineTo(cx - d, cy + d)
        .stroke({ width, color, alpha, cap: 'round' });
    } else {
      g.circle(cx, cy, r * 0.8).stroke({ width, color, alpha });
    }
  },

  draw(dt) {
    const v = this.view;
    const size = v.size;
    const r = this.cell * 0.38;
    const lw = Math.max(2.5, this.cell * 0.13);
    const g = this.gStones.clear();

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const m = v.board[y * size + x];
        if (!m) { this.anim.delete(`${x},${y}`); continue; }
        const key = `${x},${y}`;
        const t = damp(this.anim.get(key) ?? 0, 1, 14, dt);
        this.anim.set(key, t);

        const col = m === 1 ? this.pal.acc : this.pal.ok;
        const rr = r * (0.55 + 0.45 * t);
        // rozmazaná kopie vespod dělá záři, bez ní jsou tahy ploché
        this.drawMark(g, this.cx(x), this.cy(y), rr, m, col, 0.22 * t, lw * 2.1);
        this.drawMark(g, this.cx(x), this.cy(y), rr, m, col, t, lw);
      }
    }

    const fx = this.gFx.clear();

    // náhled tahu
    const myTurn = !v.winner && v.mySeat === v.turn;
    if (myTurn && this.hover && v.board[this.hover.y * size + this.hover.x] === 0) {
      const mine = v.mySeat === 0 ? this.pal.acc : this.pal.ok;
      this.drawMark(fx, this.cx(this.hover.x), this.cy(this.hover.y), r, v.mySeat + 1, mine, 0.42, lw);
    }

    // poslední tah
    if (v.lastMove) {
      const pulse = 0.4 + 0.25 * Math.sin(performance.now() / 320);
      fx.circle(this.cx(v.lastMove.x), this.cy(v.lastMove.y), r * 1.5)
        .stroke({ width: 2, color: this.pal.tx, alpha: pulse * 0.5 });
    }

    // vítězná řada
    if (v.winLine?.length) {
      const gold = this.pal.warn;
      const a = v.winLine[0], b = v.winLine[v.winLine.length - 1];
      fx.moveTo(this.cx(a.x), this.cy(a.y)).lineTo(this.cx(b.x), this.cy(b.y))
        .stroke({ width: 6, color: gold, alpha: 0.9, cap: 'round' });
      for (const c of v.winLine) {
        fx.circle(this.cx(c.x), this.cy(c.y), r * 1.35).stroke({ width: 3, color: gold, alpha: 0.8 });
      }
    }
  },

  renderHud() {
    const v = this.view;
    const p = this.ctx.players;
    const nameOf = (seat) => {
      const pl = p.find(x => x.uid === v.seats[seat]);
      if (!pl) return '?';
      return pl.name + (pl.botControlled ? ' 🤖' : '');
    };
    const turnTxt = v.winner
      ? (v.winner === 'draw' ? 'Remíza' : `Vyhrál ${nameOf(v.seats.indexOf(v.winner))}`)
      : (v.mySeat === v.turn ? 'Jsi na tahu' : `Hraje ${nameOf(v.turn)}`);

    this.ctx.hud.innerHTML = `
      <div class="hud-row">
        <div class="hud-seat ${v.turn === 0 ? 'active' : ''}" style="--c:var(${SEAT_VAR[0]})">
          <span class="mark">✕</span>${nameOf(0)}${v.mySeat === 0 ? ' (ty)' : ''}
        </div>
        <div class="hud-turn">${turnTxt}</div>
        <div class="hud-seat ${v.turn === 1 ? 'active' : ''}" style="--c:var(${SEAT_VAR[1]})">
          <span class="mark">◯</span>${nameOf(1)}${v.mySeat === 1 ? ' (ty)' : ''}
        </div>
      </div>`;
  },

  unmount() {
    this.offTheme?.();
    this.ctx.app.ticker.remove(this.ticker);
    this.root.destroy({ children: true });
    this.anim.clear();
  },
};
