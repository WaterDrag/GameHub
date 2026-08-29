// ─────────────────────────────────────────────────────────────
//  Závody – renderer.
//
//  Kreslí, nic nerozhoduje. Vlastní auto si predikuje stejnou
//  funkcí, jakou o ~40 ms později spustí server (applyInput ze
//  sdílené simulace), takže volant reaguje okamžitě. Ostatní auta
//  se kreslí ~110 ms v minulosti mezi dvěma snapshoty, aby necukala.
// ─────────────────────────────────────────────────────────────
import { PIXI, damp } from '../pixi.js';
import * as T from '../theme.js';
import { R, CAR_COLORS } from '/shared/games/racing/const.js';
import { DILY, PASTI, polozDil } from '/shared/games/racing/dily.js';
import { applyInput, finishBand, sledujCil, useku } from '/shared/games/racing/sim.js';

const INTERP_MS = 110;
const SMOOTH = 30;        // rychlost dojíždění vizuálu k predikci
const MAX_SNAPS = 24;

const KEY_UP = ['w', 'W', 'ArrowUp'];
const KEY_DOWN = ['s', 'S', 'ArrowDown'];
const KEY_LEFT = ['a', 'A', 'ArrowLeft'];
const KEY_RIGHT = ['d', 'D', 'ArrowRight'];

const hex = (s) => parseInt(String(s).replace('#', ''), 16);
const cas = (ms) => (ms ? (ms / 1000).toFixed(2) + ' s' : '–');

export default {
  id: 'racing',

  async mount(ctx) {
    this.ctx = ctx;
    this.pal = T.colors();
    this.offTheme = T.onThemeChange(({ colors }) => { this.pal = colors; this.drawTrack(); });

    this.view = ctx.view;
    this.seq = 0;
    this.pending = [];
    this.snaps = [];
    this.parts = [];
    this.keys = new Set();
    // Vizuální stav auta. Predikce (`me`) se hýbe ve skocích 30× za sekundu
    // a navíc ji každý snapshot opraví; `vis` za ní dojíždí filtrem, který
    // běží KAŽDÝ snímek – proto nedělá schody ani skoky.
    this.vis = null;
    this.camA = 0;          // vyhlazený úhel pro předstih kamery
    this.zoom = 1;

    const m = ctx.view.me;
    this.me = m
      ? { x: m.x, y: m.y, a: m.a, vx: m.vx, vy: m.vy, offTrack: !!m.offTrack, wet: !!m.wet, boost: !!m.boost }
      : { x: R.W / 2, y: R.H / 2, a: 0, vx: 0, vy: 0, offTrack: false, wet: false, boost: false };
    this.cam = { x: this.me.x, y: this.me.y };

    const stage = ctx.stage;
    this.world = new PIXI.Container();
    this.ui = new PIXI.Container();
    stage.addChild(this.world, this.ui);

    this.gTrack = new PIXI.Graphics();     // asfalt + krajnice, kreslí se jednou
    this.gPads = new PIXI.Graphics();      // turbo a kaluže
    this.gCars = new PIXI.Graphics();
    this.gParts = new PIXI.Graphics();
    this.nameLayer = new PIXI.Container();
    this.world.addChild(this.gTrack, this.gPads, this.gCars, this.gParts, this.nameLayer);

    this.names = new Map();

    this.tratPodpis = '';
    this.drawTrack();
    this.bindInput();

    // Vstup jede na pevných krocích podle SKUTEČNÉHO času, ne na fps.
    // Dřív to byl setInterval(33 ms) – jenže časovač v prohlížeči ujíždí
    // a krok se přitom simuloval vždy přesně DT. Klient tak nasimuloval
    // jiný čas než server a ten pak musel pořád dorovnávat dopředu.
    this.acc = 0;
    this.ticker = (t) => {
      const dt = Math.min(0.05, t.deltaMS / 1000);
      this.acc += dt;
      // Strop kroků na snímek: po delším zámrazu se nesmí vysypat dávka
      // vstupů, kterou by fronta serveru stejně zahodila.
      let kroku = 0;
      while (this.acc >= R.DT && kroku < 3) { this.acc -= R.DT; this.stepInput(); kroku++; }
      if (this.acc > R.DT * 3) this.acc = 0;
      this.render(dt);
    };
    ctx.app.ticker.add(this.ticker);
    this.buildHud();
    this.renderHud();
  },

  // ── Vstup ──────────────────────────────────────────────────
  bindInput() {
    this.onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const dolu = e.type === 'keydown';
      if (dolu) this.keys.add(e.key); else this.keys.delete(e.key);
      if ([...KEY_UP, ...KEY_DOWN, ...KEY_LEFT, ...KEY_RIGHT, ' '].includes(e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.onBlur = () => this.keys.clear();
    window.addEventListener('blur', this.onBlur);
  },

  has(list) { return list.some(k => this.keys.has(k)); },

  stepInput() {
    const v = this.view;
    const input = {
      seq: ++this.seq,
      gas: (this.has(KEY_UP) ? 1 : 0) - (this.has(KEY_DOWN) ? 1 : 0),
      steer: (this.has(KEY_RIGHT) ? 1 : 0) - (this.has(KEY_LEFT) ? 1 : 0),
      drift: this.keys.has(' '),
    };
    this.ctx.send('input', input);

    // Před startem a po dojetí se nepredikuje – auto stojí, resp. dojíždí.
    if (!v?.running || v?.me?.finished) return;

    this.pending.push(input);
    if (this.pending.length > 60) this.pending.shift();

    applyInput(this.me, input, R.DT);
  },

  // ── Snapshot ───────────────────────────────────────────────
  update(view) {
    const drivFaze = this.view?.faze;
    this.view = view;

    // Trať se mění po každém položeném dílu – překresli ji, ale jen tehdy.
    const podpis = `${view.trat?.body?.length}:${view.pasti?.length}`;
    if (podpis !== this.tratPodpis) { this.tratPodpis = podpis; this.drawTrack(); }
    if (drivFaze !== view.faze) { this.vybrany = null; this.vis = null; }

    this.snaps.push({ at: performance.now(), cars: view.cars || [] });
    while (this.snaps.length > MAX_SNAPS) this.snaps.shift();

    for (const f of view.fx || []) this.spawnFx(f);

    if (view.me) {
      // Sedni si na pozici serveru a přehraj vstupy, které ještě nestihl
      // potvrdit. Opravu neřeší žádný zvláštní offset – pohltí ji vizuální
      // filtr v render(). Dřív se tu chyba nad 160 px zahodila, což byl
      // TVRDÝ skok přesně v okamžiku, kdy hráč jel nejrychleji.
      this.me.x = view.me.x; this.me.y = view.me.y; this.me.a = view.me.a;
      this.me.vx = view.me.vx; this.me.vy = view.me.vy;
      // Povrch musí sedět, jinak by predikce jela po jiném podkladu
      // než server a pořád by ji to dorovnávalo.
      this.me.offTrack = !!view.me.offTrack;
      this.me.wet = !!view.me.wet;
      this.me.boost = !!view.me.boost;

      this.pending = this.pending.filter(i => i.seq > view.ack);
      for (const i of this.pending) applyInput(this.me, i, R.DT);
    }
    this.renderHud();
  },

  spawnFx(f) {
    if (f.k === 'hit' || f.k === 'boost') {
      const n = f.k === 'boost' ? 14 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const s = f.k === 'boost' ? 260 : 150;
        this.parts.push({
          x: f.x, y: f.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: 0.45, max: 0.45, c: f.k === 'boost' ? 0x35c8ff : 0xffc247, r: 4,
        });
      }
    }
  },

  // ── Trať ───────────────────────────────────────────────────
  // Kreslí se jednou: asfalt jako tlustá čára po středové čáře,
  // pod ním světlejší pás jako krajnice.
  // Trať se překresluje, jen když se opravdu změnila – ve stavěném režimu
  // po každém položeném dílu, jinak jednou za hru.
  drawTrack() {
    const t = this.view?.trat;
    if (!t || !t.body?.length) return;
    const g = this.gTrack;
    g.clear();

    const tráva = hex(this.pal?.bg2 || '#12321a');
    g.rect(0, 0, R.W, R.H).fill({ color: tráva });

    const body = t.uzavrena ? [...t.body, t.body[0]] : t.body;
    const cesta = (sirka, barva, alpha = 1) => {
      g.moveTo(body[0].x, body[0].y);
      for (let i = 1; i < body.length; i++) g.lineTo(body[i].x, body[i].y);
      g.stroke({ width: sirka, color: barva, alpha, cap: 'round', join: 'round' });
    };

    cesta((R.HALF + 16) * 2, 0xd8d0c0, 0.85);   // krajnice
    cesta(R.HALF * 2, 0x2f3136);                // asfalt
    cesta(6, 0xffffff, 0.16);                   // vodicí čára uprostřed

    // Startovní/cílová čára – geometrii drží sdílená simulace,
    // ať se dá ověřit testem a ne jen okem.
    for (const q of finishBand(t)) {
      g.poly(q.rohy).fill({ color: q.svetly ? 0xffffff : 0x101010, alpha: 0.95 });
    }
  },

  drawPads() {
    const g = this.gPads;
    g.clear();
    const cas = performance.now() / 1000;
    for (const p of this.view?.pasti || []) {
      const d = PASTI[p.typ];
      if (!d) continue;
      const barva = hex(d.barva);
      if (p.typ === 'turbo') {
        const puls = 0.55 + Math.sin(cas * 5 + p.x * 0.01) * 0.18;
        g.circle(p.x, p.y, d.r).fill({ color: barva, alpha: puls * 0.4 });
        g.circle(p.x, p.y, d.r).stroke({ width: 3, color: 0x9fe8ff, alpha: puls });
      } else {
        g.circle(p.x, p.y, d.r).fill({ color: barva, alpha: p.typ === 'olej' ? 0.62 : 0.32 });
        g.circle(p.x, p.y, d.r).stroke({ width: 2, color: barva, alpha: 0.7 });
      }
    }

    // Náhled dílu, který si hráč vybral – průhledný pás na volném konci.
    const v = this.view;
    if (v?.jaStavim && this.vybrany && v.kurzor) {
      const p = polozDil(this.vybrany, v.kurzor);
      const body = [{ x: v.kurzor.x, y: v.kurzor.y }, ...p.body];
      const legal = (v.ruka || []).find(r => r.id === this.vybrany)?.ok;
      g.moveTo(body[0].x, body[0].y);
      for (let i = 1; i < body.length; i++) g.lineTo(body[i].x, body[i].y);
      g.stroke({ width: R.HALF * 2, color: legal ? 0x35c8ff : 0xe04040,
        alpha: 0.35, cap: 'round', join: 'round' });
    }
  },

  // ── Interpolace ostatních ──────────────────────────────────
  othersAt(t) {
    const s = this.snaps;
    if (!s.length) return [];
    if (s.length === 1) return s[0].cars;
    let i = s.length - 1;
    while (i > 0 && s[i].at > t) i--;
    const a = s[i], b = s[Math.min(i + 1, s.length - 1)];
    const rozsah = b.at - a.at;
    const u = rozsah > 0 ? Math.max(0, Math.min(1, (t - a.at) / rozsah)) : 0;

    const podle = new Map(b.cars.map(c => [c.uid, c]));
    return a.cars.map(ca => {
      const cb = podle.get(ca.uid);
      if (!cb) return ca;
      // Úhel se musí interpolovat nejkratší cestou, jinak auto při
      // přechodu přes ±π udělá otočku kolem osy.
      let d = cb.a - ca.a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return {
        ...cb,
        x: ca.x + (cb.x - ca.x) * u,
        y: ca.y + (cb.y - ca.y) * u,
        a: ca.a + d * u,
      };
    });
  },

  // ── Kreslení ───────────────────────────────────────────────
  render(dt) {
    const v = this.view;
    if (!v) return;

    // Vizuální stav dojíždí k predikci. Filtr běží každý snímek, takže
    // rozpustí jak krok predikce (30 Hz), tak opravu od serveru (15 Hz)
    // do plynulého pohybu. Zpoždění je v/SMOOTH, při plné rychlosti ~29 px.
    // Cíl kreslení není holá predikce, ale predikce posunutá o ZBYTEK času
    // do dalšího kroku (`acc`) podle aktuální rychlosti. Bez toho by se
    // filtr honil za cílem, který sám poskakuje po 33 ms, a zbyla by v tom
    // vlnka; takhle se cíl hýbe rovnoměrně.
    if (!this.vis) this.vis = { x: this.me.x, y: this.me.y, a: this.me.a };
    const cil = {
      x: this.me.x + this.me.vx * this.acc,
      y: this.me.y + this.me.vy * this.acc,
      a: this.me.a,
    };
    sledujCil(this.vis, cil, SMOOTH, dt);
    const mx = this.vis.x, my = this.vis.y, ma = this.vis.a;

    // Kamera se dívá kousek před auto. Předstih se počítá z VYHLAZENÉHO
    // úhlu – syrový úhel se při směcích mění rychle a kamera by kmitala.
    // Při stavbě je zajímavý volný konec trati, ne stojící auto.
    if (v.faze === 'stavba' && v.kurzor) {
      this.cam.x = damp(this.cam.x, v.kurzor.x, 4, dt);
      this.cam.y = damp(this.cam.y, v.kurzor.y, 4, dt);
      const app0 = this.ctx.app;
      const m0 = Math.min(app0.renderer.width / 2600, app0.renderer.height / 1700);
      this.world.scale.set(m0);
      this.world.x = app0.renderer.width / 2 - this.cam.x * m0;
      this.world.y = app0.renderer.height / 2 - this.cam.y * m0;
      this.drawPads();
      this.gParts.clear();
      this.kresliAuta(mx, my, ma);
      return;
    }

    const v1 = Math.hypot(this.me.vx, this.me.vy);
    let dCam = ma - this.camA;
    while (dCam > Math.PI) dCam -= Math.PI * 2;
    while (dCam < -Math.PI) dCam += Math.PI * 2;
    this.camA += dCam * (1 - Math.exp(-7 * dt));
    const predstih = Math.min(1, v1 / R.MAX_SPEED) * 190;
    const cx = mx + Math.cos(this.camA) * predstih;
    const cy = my + Math.sin(this.camA) * predstih;
    this.cam.x = damp(this.cam.x, cx, 6, dt);
    this.cam.y = damp(this.cam.y, cy, 6, dt);

    const app = this.ctx.app;
    const sw = app.renderer.width, sh = app.renderer.height;
    const cilZoom = 1.05 - Math.min(1, v1 / R.MAX_SPEED) * 0.16;
    this.zoom = damp(this.zoom, cilZoom, 4, dt);
    // Základna byla 1500×950 – to ukázalo jen 16 % plochy okruhu a do
    // zatáčky se nedalo dohlédnout. Teď je vidět kus trati dopředu.
    const m = Math.min(sw / 2400, sh / 1550) * this.zoom;

    this.world.scale.set(m);
    this.world.x = sw / 2 - this.cam.x * m;
    this.world.y = sh / 2 - this.cam.y * m;

    this.drawPads();

    // Částice
    const gp = this.gParts;
    gp.clear();
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      gp.circle(p.x, p.y, p.r * (p.life / p.max)).fill({ color: p.c, alpha: p.life / p.max });
    }

    this.kresliAuta(mx, my, ma);
  },

  kresliAuta(mx, my, ma) {
    const v = this.view;
    const g = this.gCars;
    g.clear();
    const t = performance.now() - INTERP_MS;
    const ostatni = this.othersAt(t);
    const mujUid = v.me?.uid;

    for (const c of ostatni) {
      if (c.uid === mujUid) continue;
      this.drawCar(g, c.x, c.y, c.a, c.color, false, c);
      this.label(c.uid, c.name + (c.bot ? ' 🤖' : ''), c.x, c.y, c.color);
    }
    const jaSnap = ostatni.find(c => c.uid === mujUid);
    this.drawCar(g, mx, my, ma, jaSnap ? jaSnap.color : 0, true, {
      drift: this.keys.has(' '), offTrack: this.me.offTrack, boost: this.me.boost,
    });

    for (const [uid, el] of this.names) {
      if (!ostatni.some(c => c.uid === uid && c.uid !== mujUid)) { el.destroy(); this.names.delete(uid); }
    }
  },

  drawCar(g, x, y, a, colorIdx, jaSam, info = {}) {
    const barva = hex(CAR_COLORS[colorIdx % CAR_COLORS.length]);
    const cs = Math.cos(a), sn = Math.sin(a);
    const bod = (fx, fy) => ({ x: x + fx * cs - fy * sn, y: y + fx * sn + fy * cs });

    // Stopy po smyku / prach v trávě
    if (info.drift || info.offTrack) {
      const zad = bod(-16, 0);
      g.circle(zad.x, zad.y, 13).fill({ color: info.offTrack ? 0x6b8f4a : 0x1a1a1a, alpha: 0.22 });
    }
    if (info.boost) g.circle(x, y, 30).fill({ color: 0x35c8ff, alpha: 0.22 });

    const p1 = bod(20, 0), p2 = bod(-14, -12), p3 = bod(-8, 0), p4 = bod(-14, 12);
    g.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).lineTo(p3.x, p3.y).lineTo(p4.x, p4.y).closePath()
      .fill({ color: barva })
      .stroke({ width: jaSam ? 3 : 2, color: jaSam ? 0xffffff : 0x000000, alpha: jaSam ? 0.95 : 0.4 });

    // Čelní sklo, ať je poznat, kam auto míří
    const s1 = bod(11, -7), s2 = bod(11, 7), s3 = bod(2, 5), s4 = bod(2, -5);
    g.moveTo(s1.x, s1.y).lineTo(s2.x, s2.y).lineTo(s3.x, s3.y).lineTo(s4.x, s4.y).closePath()
      .fill({ color: 0x0d1117, alpha: 0.55 });
  },

  label(uid, text, x, y, colorIdx) {
    let el = this.names.get(uid);
    if (!el) {
      el = new PIXI.Text({
        text,
        style: { fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, fontWeight: '700', fill: 0xffffff },
      });
      el.anchor.set(0.5, 1);
      this.nameLayer.addChild(el);
      this.names.set(uid, el);
    }
    el.text = text;
    el.x = x;
    el.y = y - 30;
    el.tint = hex(CAR_COLORS[colorIdx % CAR_COLORS.length]);
  },

  // ── HUD ────────────────────────────────────────────────────
  // ── HUD ────────────────────────────────────────────────────
  // Postaví se JEDNOU. Dřív se celý přestavoval přes innerHTML 15× za
  // sekundu – tím se pokaždé restartovala animace odpočtu (blikal)
  // a prohlížeč zbytečně přepočítával rozložení.
  buildHud() {
    const hud = this.ctx.hud;
    hud.innerHTML = `
      <div class="rc-hud">
        <div class="rc-big"><b data-f="misto">–</b><span>pozice</span></div>
        <div class="rc-big"><b data-f="kolo">–</b><span>kolo</span></div>
        <div class="rc-big"><b data-f="rychlost">0</b><span>km/h</span></div>
        <div class="rc-big"><b data-f="nej">–</b><span>nejlepší</span></div>
      </div>
      <table class="rc-board"><tbody data-f="tabulka"></tbody></table>
      <div class="rc-build hidden" data-f="stavba">
        <div class="rc-bhead" data-f="bhead"></div>
        <div class="rc-dily" data-f="dily"></div>
        <div class="rc-past" data-f="pastRadek"></div>
        <button class="rc-polozit" data-f="polozit">Položit díl</button>
      </div>
      <div class="rc-warn hidden" data-f="mimo">Mimo trať!</div>
      <div class="rc-closing hidden" data-f="uzaverka"></div>
      <div class="rc-keys">W/S plyn a brzda · A/D volant · mezerník ruční brzda</div>`;
    this.f = {};
    for (const el of hud.querySelectorAll('[data-f]')) this.f[el.dataset.f] = el;
    this.podpisTabulky = '';
    this.podpisRuky = '';
    this.vybrany = null;
    this.pastKam = 0.5;
    this.pastBok = 0;

    this.f.dily.onclick = (e) => {
      const b = e.target.closest('[data-dil]');
      if (!b || b.disabled) return;
      this.vybrany = b.dataset.dil;
      this.renderHud();
    };
    this.f.pastRadek.onclick = (e) => {
      const b = e.target.closest('[data-bok]');
      if (!b) return;
      this.pastBok = Number(b.dataset.bok);
      this.renderHud();
    };
    this.f.polozit.onclick = () => {
      if (!this.vybrany) return;
      this.ctx.send('action', {
        a: 'postav', dil: this.vybrany,
        past: this.view?.mojePast, pastT: this.pastKam, pastOff: this.pastBok,
      });
      this.vybrany = null;
    };

    // Semafor stojí MIMO #hud, aby ho jeho překreslování nerestartovalo.
    const kam = hud.parentElement || document.body;
    this.lightEl = document.createElement('div');
    this.lightEl.className = 'rc-lights hidden';
    this.lightEl.innerHTML = '<i></i><i></i><i></i>';
    kam.appendChild(this.lightEl);
    this.faze = null;
  },

  // Semafor: tři světla se rozsvítí po jednom, pak zelená a zhasne.
  updateLights(v) {
    if (v.faze !== 'zavod') { this.lightEl.classList.add('hidden'); this.faze = 'pryc'; return; }
    let faze;
    if (v.startIn > 0) faze = 3 - Math.min(3, Math.floor(v.startIn / (R.COUNTDOWN_MS / 3)));
    else if (performance.now() - (this.startPerf || 0) < 1300) faze = 'jed';
    else faze = 'pryc';
    if (v.startIn > 0) this.startPerf = performance.now();

    if (faze === this.faze) return;      // třída se mění jen při změně, jinak by animace startovala pořád
    this.faze = faze;

    const l = this.lightEl;
    l.classList.toggle('hidden', faze === 'pryc');
    l.classList.toggle('jed', faze === 'jed');
    const zarovky = l.querySelectorAll('i');
    zarovky.forEach((z, i) => {
      z.classList.toggle('on', faze === 'jed' || (typeof faze === 'number' && i < faze));
    });
  },

  renderHud() {
    const v = this.view;
    if (!v || !this.f) return;
    const me = v.me;
    const moje = v.poradi?.find(p => p.uid === me?.uid);

    this.updateLights(v);

    this.f.misto.textContent = moje ? moje.place : '–';
    this.f.kolo.textContent = `${Math.min((me?.lap || 0) + 1, v.laps)}/${v.laps}`;
    this.f.rychlost.textContent = Math.round(Math.hypot(this.me.vx, this.me.vy) / 3);
    this.f.nej.textContent = cas(me?.best);

    this.f.mimo.classList.toggle('hidden', !me?.offTrack && v.faze === 'zavod');

    // ── Stavba ──
    const stavi = v.faze === 'stavba';
    this.f.stavba.classList.toggle('hidden', !stavi);
    if (stavi) {
      // Staví se najednou – hlavička ukazuje čas a kolik lidí už položilo.
      const hotovo = (v.polozili || []).length, vsech = (v.cars || []).length;
      this.f.bhead.innerHTML = v.jaStavim
        ? `<b>Postav kus trati</b> <small>${Math.ceil(v.stavbaZbyva / 1000)} s · položeno ${hotovo}/${vsech}</small>`
        : `<b>Položeno ✓</b> <small>čekáš na ostatní (${hotovo}/${vsech})</small>`;

      const jdeNeco = (v.ruka || []).some(r => r.ok);
      const podpis = (v.ruka || []).map(r => r.id + (r.ok ? '1' : '0')).join(',')
        + '|' + this.vybrany + '|' + v.jaStavim + '|' + this.pastBok;
      if (podpis !== this.podpisRuky) {
        this.podpisRuky = podpis;
        // Vybraný díl mohl mezitím znečinnět – někdo jiný už stavěl.
        if (this.vybrany && !(v.ruka || []).some(r => r.id === this.vybrany && r.ok)) this.vybrany = null;
        this.f.dily.innerHTML = (v.ruka || []).map(r => `
          <button data-dil="${r.id}" class="${this.vybrany === r.id ? 'sel' : ''}"
            ${r.ok && v.jaStavim ? '' : 'disabled'} title="${r.ok ? '' : r.proc || ''}">
            <i>${DILY[r.id]?.emoji || '?'}</i><span>${DILY[r.id]?.name || r.id}</span>
          </button>`).join('')
          + (jdeNeco || !v.jaStavim ? '' :
            '<div class="rc-nic">Teď se sem nic z tvých dílů nevejde – počkej, až někdo postaví</div>');

        const past = v.mojePast ? PASTI[v.mojePast] : null;
        this.f.pastRadek.innerHTML = past && v.jaStavim ? `
          <span>${past.emoji} ${past.name} položit</span>
          ${[['-0.45', 'vlevo'], ['0', 'doprostřed'], ['0.45', 'vpravo']].map(([b, t]) => `
            <button data-bok="${b}" class="${Number(b) === this.pastBok ? 'sel' : ''}">${t}</button>`).join('')}` : '';
      }
      this.f.polozit.disabled = !v.jaStavim || !this.vybrany;
      this.f.polozit.textContent = v.jaStavim ? 'Položit díl' : 'Položeno';
    } else {
      this.podpisRuky = '';
    }

    const uz = v.closingIn > 0 && !me?.finished;
    this.f.uzaverka.classList.toggle('hidden', !uz);
    if (uz) this.f.uzaverka.textContent = `Do konce ${Math.ceil(v.closingIn / 1000)} s`;

    // Tabulka se přestavuje jen když se změní pořadí nebo kola, ne pořád.
    const podpis = (v.poradi || []).map(p => `${p.uid}:${p.lap}:${p.finished ? 1 : 0}`).join('|');
    if (podpis !== this.podpisTabulky) {
      this.podpisTabulky = podpis;
      this.f.tabulka.innerHTML = (v.poradi || []).map(p => `
        <tr class="${p.uid === me?.uid ? 'me' : ''}">
          <td>${p.place}.</td>
          <td><i style="background:${CAR_COLORS[p.color % CAR_COLORS.length]}"></i>${p.name}${p.bot ? ' 🤖' : ''}</td>
          <td>${v.stavba ? p.body + ' b' : (p.finished ? '🏁' : p.lap + '/' + v.laps)}</td>
        </tr>`).join('');
    }
  },


  event() { /* efekty chodí ve snapshotu jako fx */ },
  resize() { /* kamera se přepočítá v render() */ },

  unmount() {
    this.ctx?.app?.ticker?.remove(this.ticker);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    this.offTheme?.();
    this.world?.destroy({ children: true });
    this.ui?.destroy({ children: true });
    this.names?.clear();
    this.lightEl?.remove();
    this.ctx.hud.innerHTML = '';
  },
};
