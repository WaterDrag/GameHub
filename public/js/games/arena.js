// ─────────────────────────────────────────────────────────────
//  Aréna – klient.
//
//  Nerozhoduje o ničem. Ale aby hra nebyla "gumová", dělá tři věci:
//
//   1. PREDIKCE – tvoje postava se hne hned po stisku klávesy,
//      stejným kódem, jakým to spočítá server (shared/.../sim.js).
//   2. REKONCILIACE – když dorazí snapshot, sedne si na pozici
//      serveru a přehraje vstupy, které server ještě nestihl.
//   3. INTERPOLACE – ostatní hráče kreslí ~110 ms v minulosti mezi
//      dvěma snapshoty, takže se pohybují plynule i při 15 snap/s.
//
//  Kdo si tady v konzoli přepíše HP nebo pozici, oklame jen sám sebe.
// ─────────────────────────────────────────────────────────────
import { PIXI, damp } from '../pixi.js';
import * as T from '../theme.js';
import {
  A, WALLS, DECKS, RAMPS, RAFTS, WEAPONS, POWERS, PICKUP_BY_KIND, EVENT_BY_KEY,
} from '/shared/games/arena/const.js';
import { applyInput, deckLevelAt } from '/shared/games/arena/sim.js';

const INTERP_MS = 110;     // o kolik zpátky kreslíme ostatní
const SMOOTH = 14;         // jak rychle dojíždí korekce od serveru
const MAX_SNAPS = 24;

const KEYS_UP = ['w', 'W', 'ArrowUp'];
const KEYS_DOWN = ['s', 'S', 'ArrowDown'];
const KEYS_LEFT = ['a', 'A', 'ArrowLeft'];
const KEYS_RIGHT = ['d', 'D', 'ArrowRight'];

export default {
  id: 'arena',

  async mount(ctx) {
    this.ctx = ctx;
    this.pal = T.colors();
    this.offTheme = T.onThemeChange(({ colors }) => { this.pal = colors; this.drawMap(); });

    this.view = ctx.view;
    this.seq = 0;
    this.pending = [];
    this.snaps = [];
    this.parts = [];
    this.booms = [];
    this.rays = [];
    this.padText = new Map();
    this.wantReload = false;
    this.shake = 0;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0 };
    this.shooting = false;
    this.err = { x: 0, y: 0 };
    this.cam = { x: A.W / 2, y: A.H / 2 };
    this.names = new Map();

    // Predikovaná vlastní postava
    const m = ctx.view.me;
    this.me = m
      ? { x: m.x, y: m.y, vx: m.vx, vy: m.vy, aim: m.aim, level: m.level || 0 }
      : { x: A.W / 2, y: A.H / 2, vx: 0, vy: 0, aim: 0, level: 0 };

    // ── Scéna ──
    const stage = ctx.stage;
    this.world = new PIXI.Container();
    this.ui = new PIXI.Container();
    stage.addChild(this.world, this.ui);

    this.gMap = new PIXI.Graphics();
    this.gPacks = new PIXI.Graphics();
    this.gWater = new PIXI.Graphics();   // voda leží nad zemí, ale pod hráči
    this.gEnts = new PIXI.Graphics();
    this.gParts = new PIXI.Graphics();
    this.gWarn = new PIXI.Graphics();    // dopadové zóny a zaměřené blesky
    this.nameLayer = new PIXI.Container();
    this.world.addChild(this.gMap, this.gPacks, this.gWater, this.gEnts, this.gParts, this.gWarn, this.nameLayer);

    this.gCross = new PIXI.Graphics();
    this.ui.addChild(this.gCross);

    // Hlášení katastrof stojí mimo #hud, aby ho jeho přestavování
    // přes innerHTML nerestartovalo (viz updateAlert).
    const kam = ctx.hud.parentElement || document.body;
    this.alertEl = document.createElement('div');
    this.alertEl.className = 'ar-alert hidden';
    this.alertEdge = document.createElement('div');
    this.alertEdge.className = 'ar-alert-edge hidden';
    kam.append(this.alertEdge, this.alertEl);
    this.alertKind = null;

    this.drawMap();
    this.bindInput();

    // Vstupní smyčka běží na stejné frekvenci jako server, ne na fps.
    // Kdyby se odvíjela od snímků, hráč se 144Hz monitorem by měl
    // jiný pohyb než hráč s 60Hz.
    this.inputTimer = setInterval(() => this.stepInput(), 1000 / A.TICK);

    this.ticker = (t) => this.render(Math.min(0.05, t.deltaMS / 1000));
    ctx.app.ticker.add(this.ticker);
    this.renderHud();
  },

  // ── Vstup ──────────────────────────────────────────────────
  bindInput() {
    const cv = this.ctx.app.canvas;
    this.onKeyDown = (e) => {
      if (e.repeat) return;
      this.keys.add(e.key);
      if (e.key === 'Tab') { e.preventDefault(); this.showBoard = true; this.renderHud(); }
      // R přebije předčasně. Je to jednorázový povel, ne držená klávesa,
      // takže se odešle v nejbližším vstupu a hned zhasne.
      if (e.key === 'r' || e.key === 'R') this.wantReload = true;
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.key);
      if (e.key === 'Tab') { this.showBoard = false; this.renderHud(); }
    };
    this.onMove = (e) => {
      const r = cv.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    };
    this.onDown = (e) => { if (e.button === 0) this.shooting = true; };
    this.onUp = (e) => { if (e.button === 0) this.shooting = false; };
    this.onBlur = () => { this.keys.clear(); this.shooting = false; };
    this.onMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    cv.addEventListener('pointermove', this.onMove);
    cv.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    cv.addEventListener('contextmenu', this.onMenu);
  },

  has(list) { return list.some(k => this.keys.has(k)); },

  // Myš je v obrazovkových souřadnicích, svět je posunutý kamerou.
  aimTarget() {
    const wx = this.mouse.x - this.world.x;
    const wy = this.mouse.y - this.world.y;
    const dx = wx - this.me.x, dy = wy - this.me.y;
    return { a: Math.atan2(dy, dx), d: Math.hypot(dx, dy), x: wx, y: wy };
  },

  aimAngle() { return this.aimTarget().a; },

  stepInput() {
    const alive = this.view?.me?.alive;
    const cil = this.aimTarget();
    const input = {
      seq: ++this.seq,
      dx: (this.has(KEYS_RIGHT) ? 1 : 0) - (this.has(KEYS_LEFT) ? 1 : 0),
      dy: (this.has(KEYS_DOWN) ? 1 : 0) - (this.has(KEYS_UP) ? 1 : 0),
      aim: cil.a,
      aimD: cil.d,          // raketa vybuchne v téhle vzdálenosti
      shoot: this.shooting && !!alive,
      reload: !!this.wantReload,
    };
    this.wantReload = false;
    this.ctx.send('input', input);

    if (!alive) return;
    // Predikce: stejná funkce, jakou pustí server o ~40 ms později.
    applyInput(this.me, input, A.DT);
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
  },

  // ── Snapshot ze serveru ────────────────────────────────────
  update(view) {
    this.view = view;
    this.snaps.push({ at: performance.now(), ps: view.ps || [], bs: view.bs || [] });
    while (this.snaps.length > MAX_SNAPS) this.snaps.shift();

    for (const f of view.fx || []) this.spawnFx(f);

    if (view.me) {
      if (!view.me.alive) {
        // mrtvý se nepredikuje, jen se překreslí tam, kde padl
        this.me.x = view.me.x; this.me.y = view.me.y;
        this.me.vx = 0; this.me.vy = 0;
        this.me.level = view.me.level || 0;
        this.pending.length = 0;
      } else {
        const beforeX = this.me.x, beforeY = this.me.y;

        this.me.x = view.me.x; this.me.y = view.me.y;
        this.me.vx = view.me.vx; this.me.vy = view.me.vy;
        // Násobič rychlosti musí sedět, jinak by predikce s power-upem
        // běžela jinak rychle než server a pořád by ji to dorovnávalo.
        this.me.spd = view.me.spd || 1;
        // Úroveň taky – kolize se srázy se od ní odvíjí.
        this.me.level = view.me.level || 0;

        // Přehraj vstupy, které server ještě nezpracoval.
        this.pending = this.pending.filter(i => i.seq > view.ack);
        for (const i of this.pending) applyInput(this.me, i, A.DT);

        // Zbylý rozdíl nedoženeme skokem – uložíme ho jako offset,
        // který během pár snímků odteče. Jinak by postava cukala.
        const dx = beforeX - this.me.x, dy = beforeY - this.me.y;
        if (Math.hypot(dx, dy) < 140) { this.err.x = dx; this.err.y = dy; }
        else { this.err.x = 0; this.err.y = 0; }   // velký rozdíl = respawn/teleport
      }
    }
    this.updateAlert(view);
    this.renderHud();
  },

  // ── Efekty ─────────────────────────────────────────────────
  spawnFx(f) {
    const add = (n, opt) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = opt.sp * (0.4 + Math.random() * 0.6);
        this.parts.push({
          x: f.x, y: f.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: opt.life * (0.6 + Math.random() * 0.6), max: opt.life,
          r: opt.r, c: opt.c,
        });
      }
    };
    if (f.k === 'hit') add(7, { sp: 190, life: 0.32, r: 3, c: this.pal.bad });
    else if (f.k === 'wall') add(4, { sp: 130, life: 0.22, r: 2, c: this.pal.tx });
    else if (f.k === 'kill') add(26, { sp: 320, life: 0.8, r: 4, c: this.pal.bad });
    else if (f.k === 'spawn') add(16, { sp: 220, life: 0.55, r: 3, c: this.pal.acc });
    else if (f.k === 'heal') add(14, { sp: 170, life: 0.6, r: 3, c: this.pal.ok });
    else if (f.k === 'block') add(12, { sp: 200, life: 0.4, r: 3, c: this.pal.warn });
    else if (f.k === 'bubble') add(3, { sp: 70, life: 0.5, r: 3, c: 0x8fd0ff });
    else if (f.k === 'zhit') add(5, { sp: 150, life: 0.28, r: 3, c: 0x8fd06a });
    else if (f.k === 'zdie') add(18, { sp: 260, life: 0.6, r: 4, c: 0x5b9c46 });
    else if (f.k === 'bite') add(8, { sp: 180, life: 0.35, r: 3, c: 0xc7ff8a });
    else if (f.k === 'drown') add(20, { sp: 200, life: 0.7, r: 4, c: 0x8fd0ff });
    else if (f.k === 'meteor') {
      add(46, { sp: 520, life: 0.9, r: 6, c: this.pal.warn });
      add(26, { sp: 300, life: 1.1, r: 8, c: this.pal.bad });
      this.booms.push({ x: f.x, y: f.y, r: f.r, life: 0.6, max: 0.6 });
      this.shake = 0.5;
    } else if (f.k === 'bolt') {
      add(24, { sp: 340, life: 0.5, r: 4, c: this.pal.warn });
      this.rays.push({ x1: f.x, y1: f.y - 900, x2: f.x, y2: f.y, life: 0.18, max: 0.18, bolt: true });
      this.shake = 0.25;
    } else if (f.k === 'flood') {
      this.ctx.toast(`🌊 Voda stoupá! ${f.stage >= 2 ? 'Zaplavuje i první patro.' : 'Utíkej z země.'}`, 'warn', 5000);
      this.shake = 0.35;
    } else if (f.k === 'evstart') {
      const t = {
        meteors: '☄️ Přilétl roj meteoritů! Sleduj vyznačené zóny.',
        storm: '⛈️ Rozpoutala se bouře! Drž se u zdi.',
        zombies: '🧟 Nemrtví se valí z okrajů mapy! Střílej.',
      }[f.ev];
      if (t) this.ctx.toast(t, 'warn', 5000);
      this.shake = 0.4;
    } else if (f.k === 'evend') {
      const t = {
        flood: '🌊 Voda opadá. Přízemí je zase průchozí.',
        meteors: '☄️ Roj přešel. Klid – do další vlny.',
        storm: '⛈️ Bouře utichla.',
        zombies: '🧟 Horda se rozpadla.',
      }[f.ev];
      if (t) this.ctx.toast(t, 'success', 4000);
    }
    else if (f.k === 'pick') add(18, { sp: 230, life: 0.55, r: 3, c: this.pal.acc2 });
    else if (f.k === 'reload') add(8, { sp: 110, life: 0.35, r: 2, c: this.pal.tx });
    else if (f.k === 'boom') {
      add(40, { sp: 460, life: 0.75, r: 5, c: this.pal.warn });
      add(22, { sp: 240, life: 0.9, r: 7, c: this.pal.bad });
      this.booms.push({ x: f.x, y: f.y, r: f.r, life: 0.45, max: 0.45 });
    } else if (f.k === 'ray') {
      this.rays.push({ x1: f.x, y1: f.y, x2: f.x2, y2: f.y2, life: 0.22, max: 0.22 });
    } else if (f.k === 'shot') {
      const big = f.w === 'rocket';
      this.parts.push({
        x: f.x + Math.cos(f.a) * 24, y: f.y + Math.sin(f.a) * 24,
        vx: Math.cos(f.a) * 60, vy: Math.sin(f.a) * 60,
        life: big ? 0.16 : 0.09, max: big ? 0.16 : 0.09,
        r: big ? 12 : 7, c: this.pal.warn,
      });
    }
    if (this.parts.length > 500) this.parts.splice(0, this.parts.length - 500);
  },

  // ── Statická mapa ──────────────────────────────────────────
  drawMap() {
    const g = this.gMap.clear();
    g.rect(0, 0, A.W, A.H).fill({ color: this.pal.board });

    for (let x = 0; x <= A.W; x += 100) {
      g.moveTo(x, 0).lineTo(x, A.H).stroke({ width: 1, color: this.pal.line, alpha: 0.05 });
    }
    for (let y = 0; y <= A.H; y += 100) {
      g.moveTo(0, y).lineTo(A.W, y).stroke({ width: 1, color: this.pal.line, alpha: 0.05 });
    }

    g.rect(0, 0, A.W, A.H).stroke({ width: 4, color: this.pal.acc, alpha: 0.45 });

    // ── Budovy ──
    // Kreslí se odspoda nahoru, každé patro světlejší a s výraznějším
    // vrženým stínem, aby výška byla poznat na první pohled.
    const byLevel = [...DECKS].sort((a, b) => a.level - b.level);
    for (const d of byLevel) {
      const off = 7 * d.level;
      g.roundRect(d.x + off, d.y + off, d.w, d.h, 10)
        .fill({ color: 0x000000, alpha: 0.34 });                  // stín
      g.roundRect(d.x, d.y, d.w, d.h, 10)
        .fill({ color: this.pal.surface })
        .fill({ color: this.pal.ok, alpha: 0.07 + 0.06 * d.level })
        .stroke({ width: 2.5, color: this.pal.ok, alpha: 0.5 + 0.2 * d.level });
      // hrana směrem dolů dokresluje, že je to sráz
      g.moveTo(d.x, d.y + d.h).lineTo(d.x + d.w, d.y + d.h)
        .stroke({ width: 4, color: this.pal.ok, alpha: 0.25 * d.level + 0.25 });
    }

    // ── Rampy ──
    for (const r of RAMPS) {
      g.roundRect(r.x, r.y, r.w, r.h, 5)
        .fill({ color: this.pal.ok, alpha: 0.16 })
        .stroke({ width: 2, color: this.pal.ok, alpha: 0.6 });
      // šrafování jako u nájezdu
      const steps = 4;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (r.w > r.h) {
          g.moveTo(r.x + r.w * t, r.y + 3).lineTo(r.x + r.w * t, r.y + r.h - 3)
            .stroke({ width: 1.5, color: this.pal.ok, alpha: 0.35 });
        } else {
          g.moveTo(r.x + 3, r.y + r.h * t).lineTo(r.x + r.w - 3, r.y + r.h * t)
            .stroke({ width: 1.5, color: this.pal.ok, alpha: 0.35 });
        }
      }
    }

    // Zdi musí být na první pohled odlišené od podlahy. Samotný
    // `surface` je skoro stejně tmavý jako `board`, takže přidáváme
    // nádech akcentové barvy – ta je výrazná v každém motivu.
    for (const w of WALLS) {
      g.roundRect(w.x, w.y, w.w, w.h, 7).fill({ color: this.pal.surface });
      g.roundRect(w.x, w.y, w.w, w.h, 7)
        .fill({ color: this.pal.acc, alpha: 0.20 })
        .stroke({ width: 2.5, color: this.pal.acc, alpha: 0.75 });
      // světlejší horní hrana dává zdi trochu objemu
      g.moveTo(w.x + 4, w.y + 1.5).lineTo(w.x + w.w - 4, w.y + 1.5)
        .stroke({ width: 2, color: this.pal.acc, alpha: 0.35 });
    }
  },

  // ── Interpolace ostatních ──────────────────────────────────
  othersAt(renderT) {
    if (!this.snaps.length) return [];
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].at <= renderT) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
    }
    if (!a) return this.snaps[0].ps;
    if (!b) return a.ps;

    const span = b.at - a.at || 1;
    const t = Math.max(0, Math.min(1, (renderT - a.at) / span));
    const prev = new Map(a.ps.map(p => [p.uid, p]));

    return b.ps.map(p => {
      const q = prev.get(p.uid);
      if (!q) return p;                       // objevil se až teď
      return {
        ...p,
        x: q.x + (p.x - q.x) * t,
        y: q.y + (p.y - q.y) * t,
        aim: q.aim + Math.atan2(Math.sin(p.aim - q.aim), Math.cos(p.aim - q.aim)) * t,
      };
    });
  },

  // ── Vykreslení ─────────────────────────────────────────────
  render(dt) {
    const app = this.ctx.app;
    const sw = app.screen.width, sh = app.screen.height;

    // korekce od serveru odtéká
    this.err.x = damp(this.err.x, 0, SMOOTH, dt);
    this.err.y = damp(this.err.y, 0, SMOOTH, dt);
    const mx = this.me.x + this.err.x;
    const my = this.me.y + this.err.y;

    // kamera drží hráče uprostřed, ale nevyjede z mapy
    const camX = Math.max(sw / 2, Math.min(A.W - sw / 2, mx));
    const camY = Math.max(sh / 2, Math.min(A.H - sh / 2, my));
    this.cam.x = damp(this.cam.x, sw >= A.W ? A.W / 2 : camX, 18, dt);
    this.cam.y = damp(this.cam.y, sh >= A.H ? A.H / 2 : camY, 18, dt);
    // otřes po dopadu meteoritu / úderu blesku
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sx = this.shake ? (Math.random() - 0.5) * 26 * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * 26 * this.shake : 0;

    this.world.x = Math.round(sw / 2 - this.cam.x + sx);
    this.world.y = Math.round(sh / 2 - this.cam.y + sy);

    const v = this.view || {};
    const g = this.gEnts.clear();
    const now = performance.now();

    // ── podstavce s věcmi ──
    const gp = this.gPacks.clear();
    (v.pads || []).forEach((p, i) => {
      let txt = this.padText.get(i);
      if (!p.kind) { if (txt) txt.visible = false; return; }
      const info = PICKUP_BY_KIND[p.kind];
      const col = p.kind === 'heal' ? this.pal.ok
        : WEAPONS[p.kind] ? this.pal.warn
        : this.pal.acc2;
      // věc na jiném patře je vidět, ale zašedle – dosáhneš na ni,
      // až tam vylezeš
      const reach = deckLevelAt(p.x, p.y) === (v.me?.level || 0) ? 1 : 0.4;
      const pulse = 1 + 0.1 * Math.sin(now / 260 + i);
      gp.circle(p.x, p.y, 22 * pulse).fill({ color: col, alpha: 0.14 * reach });
      gp.circle(p.x, p.y, 18).stroke({ width: 2, color: col, alpha: 0.85 * reach });

      if (!txt) {
        txt = new PIXI.Text({ text: info.emoji, style: { fontSize: 19 } });
        txt.anchor.set(0.5);
        this.nameLayer.addChild(txt);
        this.padText.set(i, txt);
      }
      if (txt.text !== info.emoji) txt.text = info.emoji;
      txt.position.set(p.x, p.y + Math.sin(now / 400 + i) * 2);
      txt.alpha = reach;
      txt.visible = true;
    });

    // ── ostatní hráči (interpolovaní) ──
    const others = this.othersAt(now - INTERP_MS);
    const seen = new Set();
    for (const p of others) {
      seen.add(p.uid);
      // Hráč nad tebou je vidět jen proto, že právě vystřelil –
      // odliš ho, ať je jasné, že za chvíli zase zmizí.
      const nadeMnou = (p.lvl || 0) > (v.me?.level || 0);
      this.drawPlayer(g, p.x, p.y, p.aim, this.pal.bad, false, {
        shield: p.sh, fast: p.fast, revealed: nadeMnou,
      });
      this.drawHp(g, p.x, p.y, p.hp / A.HP, this.pal.bad);
      const wi = WEAPONS[p.w];
      const tag = (wi && p.w !== 'blaster' ? wi.emoji + ' ' : '') + p.name
        + (p.bot || this.zastoupeny(p.uid) ? ' 🤖' : '');
      this.label(p.uid, tag, p.x, p.y - 42, this.pal.bad);
    }
    for (const [uid, txt] of this.names) if (!seen.has(uid)) txt.visible = false;

    // ── nemrtví ──
    // Extrapolují se z posledního snapshotu stejně jako střely; při
    // 15 snapshotech za sekundu by jinak viditelně poskakovali.
    const Ez = EVENT_BY_KEY.zombies;
    const posl = this.snaps[this.snaps.length - 1];
    const stariZ = posl ? (now - posl.at) / 1000 : 0;
    for (const z of (v.zs || [])) {
      const zx = z.x, zy = z.y;
      const nadeMnou = (z.lvl || 0) > (v.me?.level || 0);
      const a = nadeMnou ? 0.4 : 1;
      // tělo
      g.circle(zx, zy, Ez.r + 6).fill({ color: 0x4caf50, alpha: 0.13 * a });
      g.circle(zx, zy, Ez.r).fill({ color: 0x5b9c46, alpha: a });
      g.circle(zx, zy, Ez.r).stroke({ width: 2, color: 0x2f5f28, alpha: 0.9 * a });
      // natažené pracky ve směru chůze
      for (const s of [-0.42, 0.42]) {
        g.moveTo(zx + Math.cos(z.aim + s) * 8, zy + Math.sin(z.aim + s) * 8)
          .lineTo(zx + Math.cos(z.aim + s) * (Ez.r + 12), zy + Math.sin(z.aim + s) * (Ez.r + 12))
          .stroke({ width: 5, color: 0x5b9c46, alpha: 0.95 * a, cap: 'round' });
      }
      g.circle(zx - 4, zy - 5, 3).fill({ color: 0xc7ff8a, alpha: a });
      g.circle(zx + 5, zy - 4, 3).fill({ color: 0xc7ff8a, alpha: a });
      if (z.hp < 1) this.drawHp(g, zx, zy, z.hp, 0x5b9c46);
    }

    // ── já (predikovaný) ──
    if (v.me?.alive) {
      const b = v.me.buffs || {};
      // neviditelnost vidím na sobě jako průhlednost; ostatním se
      // neposílám vůbec, takže o mně nevědí
      this.drawPlayer(g, mx, my, this.me.aim, this.pal.acc, true, {
        shield: !!b.invuln, fast: !!b.speed, alpha: b.invis ? 0.35 : 1,
      });
      this.drawHp(g, mx, my, v.me.hp / A.HP, this.pal.acc);
    }

    // ── výbuchy raket ──
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const bm = this.booms[i];
      bm.life -= dt;
      if (bm.life <= 0) { this.booms.splice(i, 1); continue; }
      const t = 1 - bm.life / bm.max;
      g.circle(bm.x, bm.y, bm.r * (0.25 + 0.75 * t))
        .stroke({ width: 5 * (1 - t), color: this.pal.warn, alpha: 0.85 * (1 - t) });
      g.circle(bm.x, bm.y, bm.r * t * 0.7).fill({ color: this.pal.bad, alpha: 0.22 * (1 - t) });
    }

    // ── paprsky raygunu ──
    for (let i = this.rays.length - 1; i >= 0; i--) {
      const r2 = this.rays[i];
      r2.life -= dt;
      if (r2.life <= 0) { this.rays.splice(i, 1); continue; }
      const a = r2.life / r2.max;
      const col = r2.bolt ? this.pal.warn : this.pal.acc2;
      if (r2.bolt) {
        // blesk je lomená čára, ne rovná – jinak vypadá jako laser
        let px = r2.x1, py = r2.y1;
        const kroku = 9;
        for (let s = 1; s <= kroku; s++) {
          const t = s / kroku;
          const nx = r2.x1 + (r2.x2 - r2.x1) * t + (s === kroku ? 0 : (Math.sin(s * 12.9 + r2.x1) * 34));
          const ny = r2.y1 + (r2.y2 - r2.y1) * t;
          g.moveTo(px, py).lineTo(nx, ny).stroke({ width: 16 * a, color: col, alpha: 0.16 * a, cap: 'round' });
          g.moveTo(px, py).lineTo(nx, ny).stroke({ width: 4 * a, color: 0xffffff, alpha: 0.95 * a, cap: 'round' });
          px = nx; py = ny;
        }
      } else {
        g.moveTo(r2.x1, r2.y1).lineTo(r2.x2, r2.y2)
          .stroke({ width: 14 * a, color: col, alpha: 0.18 * a, cap: 'round' });
        g.moveTo(r2.x1, r2.y1).lineTo(r2.x2, r2.y2)
          .stroke({ width: 4 * a, color: col, alpha: 0.95 * a, cap: 'round' });
      }
    }

    // ── střely (extrapolované z posledního snapshotu) ──
    const last = this.snaps[this.snaps.length - 1];
    if (last) {
      const age = (now - last.at) / 1000;
      for (const b of last.bs) {
        const bx = b.x + b.vx * age, by = b.y + b.vy * age;
        const rocket = b.k === 'rocket';
        const tail = rocket ? 0.05 : 0.022;
        const tx = bx - b.vx * tail, ty = by - b.vy * tail;
        const col = rocket ? this.pal.warn : (b.o === this.ctx.myUid ? this.pal.acc : this.pal.warn);
        const wdt = rocket ? 4 : 2;
        g.moveTo(tx, ty).lineTo(bx, by).stroke({ width: wdt * 2.5, color: col, alpha: 0.22, cap: 'round' });
        g.moveTo(tx, ty).lineTo(bx, by).stroke({ width: wdt, color: col, alpha: 0.95, cap: 'round' });
        g.circle(bx, by, rocket ? 9 : 5).fill({ color: col });
        if (rocket) g.circle(bx, by, 14).fill({ color: col, alpha: 0.2 });
      }
    }

    // ── voda ──
    // Kreslí se přes celou mapu a plošiny nad hladinou se pak
    // překreslí zpátky – tím je hned vidět, kam se dá utéct.
    const gw = this.gWater.clear();
    const stage = v.flood?.stage || 0;
    if (stage > 0) {
      const vlna = Math.sin(now / 900) * 0.02;
      gw.rect(0, 0, A.W, A.H).fill({ color: 0x2f7fd8, alpha: 0.30 + vlna });
      for (let i = 0; i < 5; i++) {
        const yy = ((now / 26 + i * 440) % (A.H + 300)) - 150;
        gw.rect(0, yy, A.W, 60).fill({ color: 0x8fd0ff, alpha: 0.035 });
      }
      // suchá místa: vory a plošiny nad hladinou
      for (const r of RAFTS) {
        gw.roundRect(r.x, r.y, r.w, r.h, 10)
          .fill({ color: this.pal.board })
          .stroke({ width: 3, color: this.pal.ok, alpha: 0.75 });
      }
      for (const d of DECKS) {
        if (d.level < stage) continue;
        gw.roundRect(d.x, d.y, d.w, d.h, 10).fill({ color: this.pal.board, alpha: 0.95 });
        gw.roundRect(d.x, d.y, d.w, d.h, 10)
          .fill({ color: this.pal.ok, alpha: 0.07 + 0.06 * d.level })
          .stroke({ width: 2.5, color: this.pal.ok, alpha: 0.5 + 0.2 * d.level });
      }
    }

    // ── varování: meteority a blesky ──
    const gwarn = this.gWarn.clear();
    for (const m of v.met || []) {
      const E = EVENT_BY_KEY.meteors;
      const t = 1 - Math.min(1, m.in / E.warnMs);          // 0 → 1 do dopadu
      // Vnější kruh = dosah tlakové vlny, vnitřní = smrtící jádro.
      // Ať je hned poznat, že na kraji se dá přežít, ve středu ne.
      gwarn.circle(m.x, m.y, m.r)
        .fill({ color: this.pal.bad, alpha: 0.07 + 0.13 * t })
        .stroke({ width: 2.5, color: this.pal.bad, alpha: 0.45 + 0.4 * t });
      gwarn.circle(m.x, m.y, m.r * E.core)
        .fill({ color: this.pal.bad, alpha: 0.16 + 0.26 * t })
        .stroke({ width: 2, color: this.pal.warn, alpha: 0.7 + 0.3 * t });
      // svírající se kruh odpočítává dopad
      gwarn.circle(m.x, m.y, m.r * (1 - t)).stroke({ width: 2, color: this.pal.warn, alpha: 0.9 });
    }
    for (const b of v.bolt || []) {
      const E = EVENT_BY_KEY.storm;
      const t = 1 - Math.min(1, b.in / E.warnMs);
      const bl = 0.5 + 0.5 * Math.sin(now / 60);
      gwarn.circle(b.x, b.y, E.hitR)
        .fill({ color: this.pal.warn, alpha: 0.08 + 0.14 * t })
        .stroke({ width: 2.5, color: this.pal.warn, alpha: (0.5 + 0.5 * t) * bl });
    }

    // ── částice ──
    const gpar = this.gParts.clear();
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      const a = p.life / p.max;
      gpar.circle(p.x, p.y, p.r * a).fill({ color: p.c, alpha: a });
    }

    // ── kam dopadne raketa ──
    // Bez téhle značky by hráč jen hádal, kde se to odpálí.
    const zbran = WEAPONS[v.me?.weapon];
    if (v.me?.alive && zbran?.aimed) {
      const t = this.aimTarget();
      const rm = Math.pow(A.HIGH_RANGE, v.me.level || 0);
      const d = Math.max(zbran.minFuse, Math.min(t.d, zbran.maxFuse * rm));
      const bx = this.me.x + Math.cos(t.a) * d;
      const by = this.me.y + Math.sin(t.a) * d;
      const mimo = t.d > zbran.maxFuse * rm;      // kurzor je za dostřelem
      const col = mimo ? this.pal.bad : this.pal.warn;
      const puls = 0.55 + 0.25 * Math.sin(now / 220);

      g.moveTo(this.me.x, this.me.y).lineTo(bx, by)
        .stroke({ width: 1.5, color: col, alpha: 0.25 });
      g.circle(bx, by, zbran.splashR)
        .fill({ color: col, alpha: 0.07 })
        .stroke({ width: 2, color: col, alpha: puls });
      g.circle(bx, by, 6).fill({ color: col, alpha: 0.9 });
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        g.moveTo(bx + Math.cos(a) * 12, by + Math.sin(a) * 12)
          .lineTo(bx + Math.cos(a) * 20, by + Math.sin(a) * 20)
          .stroke({ width: 2, color: col, alpha: puls });
      }
    }

    // ── zaměřovač ──
    const gc = this.gCross.clear();
    if (v.me?.alive) {
      const { x, y } = this.mouse;
      gc.circle(x, y, 11).stroke({ width: 1.5, color: this.pal.acc, alpha: 0.7 });
      gc.moveTo(x - 17, y).lineTo(x - 6, y).stroke({ width: 1.5, color: this.pal.acc, alpha: 0.7 });
      gc.moveTo(x + 6, y).lineTo(x + 17, y).stroke({ width: 1.5, color: this.pal.acc, alpha: 0.7 });
      gc.moveTo(x, y - 17).lineTo(x, y - 6).stroke({ width: 1.5, color: this.pal.acc, alpha: 0.7 });
      gc.moveTo(x, y + 6).lineTo(x, y + 17).stroke({ width: 1.5, color: this.pal.acc, alpha: 0.7 });
      gc.circle(x, y, 1.5).fill({ color: this.pal.acc });
    }
  },

  drawPlayer(g, x, y, aim, color, isMe, opt = {}) {
    const al = opt.alpha ?? 1;
    if (opt.fast) {
      // krátká stopa dozadu prozradí, že má rychlost
      g.circle(x - Math.cos(aim) * 14, y - Math.sin(aim) * 14, A.PLAYER_R * 0.75)
        .fill({ color, alpha: 0.16 * al });
    }
    g.circle(x, y, A.PLAYER_R + 7).fill({ color, alpha: 0.14 * al });
    if (isMe) g.circle(x, y, A.PLAYER_R + 4).stroke({ width: 2, color, alpha: 0.55 * al });
    g.circle(x, y, A.PLAYER_R).fill({ color, alpha: al });
    g.circle(x - 5, y - 6, 6).fill({ color: 0xffffff, alpha: 0.22 * al });
    // hlaveň
    g.moveTo(x + Math.cos(aim) * 10, y + Math.sin(aim) * 10)
      .lineTo(x + Math.cos(aim) * (A.PLAYER_R + 13), y + Math.sin(aim) * (A.PLAYER_R + 13))
      .stroke({ width: 6, color, alpha: 0.95 * al, cap: 'round' });
    if (opt.shield) {
      const pulse = 0.6 + 0.25 * Math.sin(performance.now() / 140);
      g.circle(x, y, A.PLAYER_R + 11)
        .stroke({ width: 3, color: this.pal.warn, alpha: pulse })
        .fill({ color: this.pal.warn, alpha: 0.10 });
    }
    if (opt.revealed) {
      const pulse = 0.5 + 0.4 * Math.sin(performance.now() / 110);
      g.circle(x, y, A.PLAYER_R + 16).stroke({ width: 2, color: this.pal.warn, alpha: pulse });
      g.circle(x, y, A.PLAYER_R + 22).stroke({ width: 1, color: this.pal.warn, alpha: pulse * 0.5 });
    }
  },

  drawHp(g, x, y, frac, color) {
    const w = 40, h = 5, ty = y - 30;
    g.roundRect(x - w / 2, ty, w, h, 3).fill({ color: 0x000000, alpha: 0.45 });
    if (frac > 0) {
      g.roundRect(x - w / 2, ty, w * Math.max(0, Math.min(1, frac)), h, 3)
        .fill({ color: frac > 0.5 ? color : this.pal.warn });
    }
  },

  // Textové popisky recyklujeme – vytvářet PIXI.Text každý snímek
  // je nejrychlejší cesta, jak si shodit fps.
  label(uid, text, x, y, color) {
    let t = this.names.get(uid);
    if (!t) {
      t = new PIXI.Text({
        text,
        style: { fill: color, fontSize: 13, fontFamily: 'Space Grotesk, sans-serif', fontWeight: '600' },
      });
      t.anchor.set(0.5);
      this.nameLayer.addChild(t);
      this.names.set(uid, t);
    }
    if (t.text !== text) t.text = text;
    t.style.fill = color;
    t.position.set(x, y);
    t.visible = true;
  },

  // Hlášení o blížící se katastrofě.
  //
  // Žije mimo `#hud`, protože ten se při každém snapshotu přestavuje
  // přes innerHTML – element by tak 15× za sekundu vznikl znovu a CSS
  // animace by se pokaždé restartovala. Přesně to způsobovalo cukání.
  // Tady se DOM dotkneme jen ve chvíli, kdy se hlášení opravdu změní.
  updateAlert(v) {
    const a = (v.alerts || [])[0];
    const druh = a ? a.k : null;
    if (druh === this.alertKind) return;
    this.alertKind = druh;

    if (!druh) {
      this.alertEl.classList.add('hidden');
      this.alertEdge.classList.add('hidden');
      return;
    }
    const text = {
      flood: 'VODA STOUPÁ – UTÍKEJ Z PŘÍZEMÍ',
      meteors: 'BLÍŽÍ SE ROJ METEORITŮ',
      storm: 'PŘICHÁZÍ BOUŘE – KRYJ SE U ZDI',
      zombies: 'BLÍŽÍ SE HORDA NEMRTVÝCH',
    }[druh];
    const emoji = { flood: '🌊', meteors: '☄️', storm: '⛈️', zombies: '🧟' }[druh];
    this.alertEl.innerHTML =
      `<span class="ar-alert-ico">${emoji}</span><span class="ar-alert-txt">${text}</span>`;
    this.alertEl.className = `ar-alert ${druh}`;
    this.alertEdge.className = `ar-alert-edge ${druh}`;
  },

  // Stavový proužek událostí – hráč musí vědět, co se na něj chystá,
  // jinak z toho není hra, ale loterie.
  eventHud(v) {
    if (!v.ev) return '';
    const chip = [];

    const w = v.wave || {};
    const za = (ms) => `${Math.ceil(ms / 1000)} s`;

    if (v.ev.flood && v.flood) {
      const s = v.flood.stage;
      const label = !v.flood.on ? `Klid · voda za ${za(v.flood.in)}`
        : s >= 2 ? `Voda i v 1. patře · opadne za ${za(v.flood.in)}`
        : `Zem pod vodou · opadne za ${za(v.flood.in)}`;
      chip.push(`<div class="ev ${v.drowning ? 'bad' : s ? 'warn' : ''}">🌊 ${label}</div>`);
    }
    if (v.ev.meteors) {
      const label = (v.met || []).length ? 'Padá!' : w.meteors ? 'Roj nad hlavou' : 'Klid';
      chip.push(`<div class="ev ${(v.met || []).length ? 'bad' : w.meteors ? 'warn' : ''}">☄️ ${label}</div>`);
    }
    if (v.ev.zombies) {
      const n = (v.zs || []).length;
      const label = !w.zombies ? 'Klid' : n ? n + ' nablízku' : 'Horda se blíží';
      chip.push(`<div class="ev ${!w.zombies ? '' : n ? 'bad' : 'warn'}">🧟 ${label}</div>`);
    }
    if (v.ev.storm) {
      const label = !w.storm ? 'Klid' : v.cover ? 'Kryt' : 'Na volném prostranství';
      chip.push(`<div class="ev ${!w.storm ? '' : v.cover ? 'ok' : 'warn'}">⛈️ ${label}</div>`);
    }
    if (!chip.length) return '';
    return `<div class="ar-events">${chip.join('')}</div>
      ${v.drowning ? '<div class="ar-drown">🌊 Topíš se! Utíkej nahoru nebo na vor</div>' : ''}`;
  },

  // ── HUD (DOM) ──────────────────────────────────────────────
  renderHud() {
    const v = this.view;
    if (!v?.me) return;
    const mm = Math.floor(v.endsIn / 60000);
    const ss = Math.floor((v.endsIn % 60000) / 1000);
    const hp = Math.max(0, Math.round(v.me.hp));

    const board = (v.sb || []).map((p, i) => `
      <tr class="${p.uid === this.ctx.myUid ? 'me' : ''}">
        <td>${i + 1}.</td>
        <td>${p.name}${p.bot || this.zastoupeny(p.uid) ? ' 🤖' : ''}</td>
        <td>${p.frags}</td>
        <td>${p.deaths}</td>
      </tr>`).join('');

    const w = WEAPONS[v.me.weapon] || WEAPONS.blaster;
    const reloading = v.me.reloadIn > 0;
    // zásobník jako tečky, ať se nemusí číst číslo uprostřed přestřelky
    const dots = Array.from({ length: v.me.mag }, (_, i) =>
      `<i class="${i < v.me.ammo ? 'on' : ''}"></i>`).join('');

    const buffs = Object.entries(v.me.buffs || {})
      .filter(([, ms]) => ms > 0)
      .map(([k, ms]) => {
        const p = POWERS[k];
        return p ? `<div class="ar-buff"><span>${p.emoji}</span>${(ms / 1000).toFixed(1)}s</div>` : '';
      }).join('');

    this.ctx.hud.innerHTML = `
      <div class="ar-top">
        <div class="ar-chip">⏱ ${mm}:${String(ss).padStart(2, '0')}</div>
        <div class="ar-chip">🎯 ${v.me.frags} / ${v.limit}</div>
        ${v.me.level > 0
          ? `<div class="ar-chip ${v.loud ? 'exposed' : 'high'}">🏢 ${v.me.level}. patro · ${
              v.loud ? 'PROZRAZEN výstřelem' : 'krytý, kratší dostřel'}</div>`
          : ''}
        <div class="ar-chip dim">Tab – výsledky · R – přebít</div>
      </div>
      ${buffs ? `<div class="ar-buffs">${buffs}</div>` : ''}
      ${this.eventHud(v)}
      <div class="ar-gun ${reloading ? 'reloading' : ''}">
        <span class="ar-gun-name">${w.emoji} ${w.name}</span>
        ${reloading
          ? `<span class="ar-reload"><i style="width:${100 - (v.me.reloadIn / (v.me.reloadMs || 1)) * 100}%"></i></span><span class="ar-gun-txt">přebíjím…</span>`
          : `<span class="ar-mag">${dots}</span><span class="ar-gun-txt">${v.me.ammo}${w.refill ? '' : ' zbývá'}</span>`}
      </div>
      <div class="ar-hp">
        <div class="ar-hp-bar"><i style="width:${hp}%"></i></div>
        <span>${hp}</span>
      </div>
      ${!v.me.alive ? `<div class="ar-dead">
        <div class="ar-dead-t">Padl jsi</div>
        <div class="ar-dead-s">Respawn za ${(v.me.respawnIn / 1000).toFixed(1)} s</div>
      </div>` : ''}
      ${this.showBoard ? `<div class="ar-board">
        <table><thead><tr><th></th><th>hráč</th><th>zásahy</th><th>smrti</th></tr></thead>
        <tbody>${board}</tbody></table>
      </div>` : ''}
    `;
  },

  event() { /* efekty chodí ve snapshotu jako fx */ },

  // Za koho prave hraje bot. Stav hry drzi jen puvodni `bot` z rozdani,
  // prevzeti kvuli necinnosti se hlasi v seznamu hracu mistnosti.
  zastoupeny(uid) {
    return !!this.ctx.players.find(p => p.uid === uid && !p.bot)?.botControlled;
  },

  resize() { /* kamera se přepočítá sama v render() */ },

  unmount() {
    clearInterval(this.inputTimer);
    this.offTheme?.();
    this.ctx.app.ticker.remove(this.ticker);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointerup', this.onUp);
    const cv = this.ctx.app.canvas;
    cv.removeEventListener('pointermove', this.onMove);
    cv.removeEventListener('pointerdown', this.onDown);
    cv.removeEventListener('contextmenu', this.onMenu);
    this.alertEl?.remove();
    this.alertEdge?.remove();
    this.names.clear();
    this.world.destroy({ children: true });
    this.ui.destroy({ children: true });
  },
};
