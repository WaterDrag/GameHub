// ─────────────────────────────────────────────────────────────
//  Piškvorky – pouze vykreslování a odchyt kliknutí.
//
//  Tenhle soubor NEROZHODUJE o ničem. Nezná pravidla, neví kdo
//  vyhrál. Jen kreslí to, co přišlo ze serveru, a posílá zpátky
//  "chci hrát tady". Kdo si tu v konzoli přepíše desku, uvidí
//  svoji lež přesně do příštího snapshotu.
//
//  Tři režimy na jedné mřížce: 3×3, 15×15 a ultimátní. Ultimátní se
//  kreslí jako 9×9 – devět malých desek vedle sebe, oddělených
//  tlustší čarou. Souřadnice mřížky se přepočítají na {velká, malá}.
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
      if (!c || !this.lzeSem(c.x, c.y)) return;
      if (this.view.ultimate) ctx.send('action', this.uIdx(c.x, c.y));
      else ctx.send('action', { x: c.x, y: c.y });
    });

    this.layout(ctx.app.screen.width, ctx.app.screen.height);
    this.ticker = (t) => this.draw(t.deltaMS / 1000);
    ctx.app.ticker.add(this.ticker);
    this.renderHud();
  },

  // ── Souřadnice ─────────────────────────────────────────────
  // Kolik políček má mřížka na stranu. Ultimátní se kreslí jako 9×9.
  get mrizka() { return this.view.ultimate ? 9 : this.view.strana; },

  // Mřížka 9×9 → {velká deska, malé políčko} a zpátky.
  uIdx(x, y) {
    return {
      velka: Math.floor(y / 3) * 3 + Math.floor(x / 3),
      mala: (y % 3) * 3 + (x % 3),
    };
  },
  uPos(velka, mala) {
    return {
      x: (velka % 3) * 3 + (mala % 3),
      y: Math.floor(velka / 3) * 3 + Math.floor(mala / 3),
    };
  },

  znakNa(x, y) {
    const v = this.view;
    if (!v.ultimate) return v.board[y * v.strana + x];
    const { velka, mala } = this.uIdx(x, y);
    return v.desky[velka][mala];
  },

  // Smím sem teď kliknout? Server to počítá taky – tohle je jen
  // proto, aby kurzor neukazoval na nemožné.
  lzeSem(x, y) {
    const v = this.view;
    if (v.winner || v.mySeat !== v.turn) return false;
    if (!v.ultimate) return v.board[y * v.strana + x] === 0;
    const { velka, mala } = this.uIdx(x, y);
    if (v.velke[velka] !== 0) return false;
    if (v.aktivni !== null && v.aktivni !== velka) return false;
    return v.desky[velka][mala] === 0;
  },

  layout(w, h) {
    const size = this.mrizka;
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
    const size = this.mrizka;
    const x = Math.floor((px - this.ox) / this.cell);
    const y = Math.floor((py - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    return { x, y };
  },

  cx(x) { return this.ox + (x + 0.5) * this.cell; },
  cy(y) { return this.oy + (y + 0.5) * this.cell; },

  drawBoard() {
    const g = this.gBoard.clear();
    const { ox, oy, boardPx, cell } = this;
    const v = this.view;
    const size = this.mrizka;
    const line = this.pal.line;

    g.roundRect(ox - 10, oy - 10, boardPx + 20, boardPx + 20, 18)
      .fill({ color: this.pal.board })
      .stroke({ width: 1, color: line, alpha: 0.10 });

    for (let i = 0; i <= size; i++) {
      // U ultimátní se každá třetí čára zesílí – jinak se devět malých
      // desek slije do jedné velké mřížky a nejde je od sebe rozeznat.
      const hranice = i === 0 || i === size;
      const mezideska = v.ultimate && i % 3 === 0 && !hranice;
      const a = hranice ? 0.20 : mezideska ? 0.30 : 0.08;
      const w = mezideska ? 3 : 1;
      g.moveTo(ox + i * cell, oy).lineTo(ox + i * cell, oy + boardPx).stroke({ width: w, color: line, alpha: a });
      g.moveTo(ox, oy + i * cell).lineTo(ox + boardPx, oy + i * cell).stroke({ width: w, color: line, alpha: a });
    }

    // Hvězdné body jako na skutečné desce – jen u velké klasiky.
    if (!v.ultimate && size >= 15) {
      for (const [hx, hy] of [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]]) {
        g.circle(this.cx(hx), this.cy(hy), 2.5).fill({ color: line, alpha: 0.22 });
      }
    }
  },

  update(view) {
    const jinaMrizka = view.ultimate !== this.view?.ultimate || view.strana !== this.view?.strana;
    this.view = view;
    if (jinaMrizka) this.layout(this.ctx.app.screen.width, this.ctx.app.screen.height);
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

  // Podklad malých desek: která je dohraná a která se zrovna hraje.
  kresliDesky(fx) {
    const v = this.view;
    if (!v.ultimate) return;
    const d = this.cell * 3;
    const myTurn = !v.winner && v.mySeat === v.turn;

    for (let velka = 0; velka < 9; velka++) {
      const x = this.ox + (velka % 3) * d;
      const y = this.oy + Math.floor(velka / 3) * d;
      const stav = v.velke[velka];

      if (stav === 1 || stav === 2) {
        const col = stav === 1 ? this.pal.acc : this.pal.ok;
        fx.rect(x, y, d, d).fill({ color: col, alpha: 0.08 });
        // Velký symbol přes celou desku, ať je vidět, komu patří.
        this.drawMark(fx, x + d / 2, y + d / 2, d * 0.32, stav, col, 0.5, Math.max(4, d * 0.05));
      } else if (stav) {
        fx.rect(x, y, d, d).fill({ color: this.pal.tx, alpha: 0.05 });   // remíza
      } else if (myTurn && (v.aktivni === null || v.aktivni === velka)) {
        // Sem se teď smí hrát.
        fx.rect(x, y, d, d).fill({ color: this.pal.warn, alpha: 0.05 });
        fx.rect(x + 1.5, y + 1.5, d - 3, d - 3)
          .stroke({ width: 2.5, color: this.pal.warn, alpha: 0.75 });
      }
    }
  },

  draw(dt) {
    const v = this.view;
    const size = this.mrizka;
    const r = this.cell * 0.38;
    const lw = Math.max(2.5, this.cell * 0.13);
    const g = this.gStones.clear();
    const fx = this.gFx.clear();

    this.kresliDesky(fx);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const m = this.znakNa(x, y);
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

    // náhled tahu
    if (this.hover && this.lzeSem(this.hover.x, this.hover.y)) {
      const mine = v.mySeat === 0 ? this.pal.acc : this.pal.ok;
      this.drawMark(fx, this.cx(this.hover.x), this.cy(this.hover.y), r, v.mySeat + 1, mine, 0.42, lw);
    }

    // poslední tah
    if (v.lastMove) {
      const p = v.ultimate ? this.uPos(v.lastMove.velka, v.lastMove.mala) : v.lastMove;
      const pulse = 0.4 + 0.25 * Math.sin(performance.now() / 320);
      fx.circle(this.cx(p.x), this.cy(p.y), r * 1.5)
        .stroke({ width: 2, color: this.pal.tx, alpha: pulse * 0.5 });
    }

    // Vítězná řada. U ultimátní je v souřadnicích VELKÝCH desek,
    // takže se kreslí přes jejich středy.
    if (v.winLine?.length) {
      const gold = this.pal.warn;
      const body = v.winLine.map(c => (v.ultimate ? { x: c.x * 3 + 1, y: c.y * 3 + 1 } : c));
      const pr = v.ultimate ? this.cell * 1.4 : r * 1.35;
      const a = body[0], b = body[body.length - 1];
      fx.moveTo(this.cx(a.x), this.cy(a.y)).lineTo(this.cx(b.x), this.cy(b.y))
        .stroke({ width: 6, color: gold, alpha: 0.9, cap: 'round' });
      for (const c of body) {
        fx.circle(this.cx(c.x), this.cy(c.y), pr).stroke({ width: 3, color: gold, alpha: 0.8 });
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

    // U ultimátní je nejdůležitější informace, kam se zrovna smí.
    const sektor = v.ultimate && !v.winner
      ? ` · ${v.aktivni === null ? 'volná deska' : `deska ${v.aktivni + 1}`}`
      : '';

    this.ctx.hud.innerHTML = `
      <div class="hud-row">
        <div class="hud-seat ${v.turn === 0 ? 'active' : ''}" style="--c:var(${SEAT_VAR[0]})">
          <span class="mark">✕</span>${nameOf(0)}${v.mySeat === 0 ? ' (ty)' : ''}
        </div>
        <div class="hud-turn">${turnTxt}${sektor}</div>
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
