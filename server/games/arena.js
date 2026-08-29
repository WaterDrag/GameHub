// ─────────────────────────────────────────────────────────────
//  Aréna – top-down deathmatch v reálném čase.
//
//  Server simuluje úplně všechno: pohyb, střely, zásahy, kadenci,
//  munici, přebíjení, power-upy, respawny i podstavce s věcmi.
//  Od klienta přijímá jen "držím tyhle klávesy, mířím sem, chci
//  střílet / přebít". Rychlopalba ani nekonečná munice přes konzoli
//  proto nejsou možné – klient o nich nerozhoduje.
//
//  Navíc se posílá jen to, co hráč reálně může vidět (A.VIEW_R),
//  takže si v konzoli nepřečte pozice lidí přes půl mapy.
// ─────────────────────────────────────────────────────────────
import {
  A, WALLS, SPAWNS, PADS, WEAPONS, POWERS, PICKUPS, DEFAULT_WEAPON,
  EVENTS, EVENT_BY_KEY, RAFTS, DECKS,
} from '../../shared/games/arena/const.js';
import {
  applyInput, sanitizeInput, hasLOS, segCircle, segRect, clamp,
  deckLevelAt, canSeeLevel, rangeMul, isDrowning, isCovered, onRaft, isVisibleTo, isLoud,
  moveAndCollide,
} from '../../shared/games/arena/sim.js';
import { flowDir } from './arena-nav.js';

const MAX_QUEUE = 4;          // víc vstupů na tick = pokus o zrychlení
const IDEAL_RANGE = 340;

const LEVELS = {
  easy:   { aimErr: 0.22,  lead: 0.0, react: 460, range: 600, hold: 0.55, strafe: 0.45, greed: 0.3 },
  normal: { aimErr: 0.085, lead: 0.6, react: 230, range: 780, hold: 0.85, strafe: 0.80, greed: 0.7 },
  hard:   { aimErr: 0.03,  lead: 1.0, react: 110, range: 940, hold: 1.0,  strafe: 1.0,  greed: 0.75 },
};

const PICK_TOTAL = PICKUPS.reduce((s, p) => s + p.w, 0);

let bulletId = 1;
let zombieId = 1;

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const wep = (p) => WEAPONS[p.weapon] || WEAPONS[DEFAULT_WEAPON];

function rollPickup(rng) {
  let r = rng() * PICK_TOTAL;
  for (const p of PICKUPS) { r -= p.w; if (r <= 0) return p.kind; }
  return PICKUPS[0].kind;
}

// Místa, kam se dá obživnout, když je dole voda: střechy nad hladinou
// a vory. Bez toho hráč respawnoval rovnou pod vodou a hned se zase
// utopil – v testu z toho bylo 26 smrtí na hráče.
const DECK_MIDS = DECKS.map(d => ({ x: d.x + d.w / 2, y: d.y + d.h / 2, level: d.level }));
const RAFT_MIDS = RAFTS.map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, level: 0 }));

function spawnPool(stage) {
  if (!stage) return SPAWNS.map(s => ({ ...s, level: 0 }));
  const suche = [...DECK_MIDS.filter(d => d.level >= stage), ...RAFT_MIDS];
  return suche.length ? suche : DECK_MIDS;
}

function pickSpawn(state, rng) {
  const pool = spawnPool(state.flood?.stage || 0);
  const foes = Object.values(state.players).filter(p => p.alive);
  let best = pool[0], bestScore = -Infinity;
  for (const s of rng.shuffle(pool)) {
    let nearest = Infinity;
    for (const f of foes) nearest = Math.min(nearest, dist2(s, f));
    if (nearest > bestScore) { bestScore = nearest; best = s; }
    if (nearest > A.SPAWN_SAFE ** 2) break;
  }
  return best;
}

// ── Plánovač vln ─────────────────────────────────────────────
// Náhoda jde výhradně ze serverového RNG, aby zápas zůstal
// přehratelný ze semínka a klient do toho neměl co mluvit.
const roll = (rng, min, max) => min + rng() * (max - min);
const planStart = (E, rng, now) => now + roll(rng, E.firstMin, E.firstMax);
const planAgain = (E, rng, now) => now + roll(rng, E.gapMin, E.gapMax);
const planEnd = (E, rng, now) => now + roll(rng, E.durMin, E.durMax);

// Vybere velikost meteoritu podle vah.
function rollSize(E, rng) {
  const total = E.sizes.reduce((s, x) => s + x.w, 0);
  let r = rng() * total;
  for (const s of E.sizes) { r -= s.w; if (r <= 0) return s; }
  return E.sizes[0];
}

function giveWeapon(p, kind) {
  p.weapon = kind;
  p.ammo = WEAPONS[kind].mag;
  p.reloadAt = 0;
}

function spawnPlayer(state, p, rng) {
  const s = pickSpawn(state, rng);
  p.x = s.x; p.y = s.y;
  p.vx = 0; p.vy = 0;
  p.level = s.level ?? deckLevelAt(s.x, s.y);
  p.hp = A.HP;
  p.alive = true;
  p.respawnAt = 0;
  p.fireAt = 0;
  p.buffs = {};
  p.spd = 1;
  giveWeapon(p, DEFAULT_WEAPON);   // po smrti přicházíš o sebranou zbraň
  state.fx.push({ k: 'spawn', x: p.x, y: p.y });
}

export default {
  id: 'arena',
  title: 'Aréna',
  emoji: '🔫',
  desc: 'Top-down deathmatch. Zbraně, power-upy, budovy a živly.',
  minPlayers: 2,
  maxPlayers: 8,
  realtime: true,
  tickRate: A.TICK,
  snapEvery: 2,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  // Volby, které si hostitel zaškrtne před hrou. Klient si z toho
  // vykreslí zaškrtávátka sám, server přijme jen tyhle klíče.
  options: EVENTS.map(e => ({ key: e.key, label: e.name, emoji: e.emoji, desc: e.desc, def: false })),

  createState({ players, rng, options }) {
    const now = Date.now();
    const on = {};
    for (const e of EVENTS) on[e.key] = !!options?.[e.key];

    const state = {
      events: on,
      // Každá pohroma má vlastní vlnu: `at` = kdy začne, `until` = kdy poleví.
      flood: { stage: 0, on: false, at: planStart(EVENT_BY_KEY.flood, rng, now), until: 0 },
      met: { on: false, at: planStart(EVENT_BY_KEY.meteors, rng, now), until: 0 },
      storm: { on: false, at: planStart(EVENT_BY_KEY.storm, rng, now), until: 0 },
      zomb: { on: false, at: planStart(EVENT_BY_KEY.zombies, rng, now), until: 0 },
      meteors: [],
      bolts: [],
      zombies: [],
      zombAt: 0,
      stormAt: 0,
      meteorAt: 0,
      players: {},
      bullets: [],
      pads: PADS.map((p, i) => ({ id: i, x: p.x, y: p.y, kind: null, at: now + rng() * 4000 })),
      fx: [],
      startedAt: now,
      endsAt: now + A.MATCH_MS,
      // Pevných 20 zásahů bylo na zvětšené mapě nedosažitelných – po
      // šesti minutách měl vůdce 14 (8 hráčů) až 6 (4 hráči), takže
      // zápas vždycky skončil jen na čas. Limit teď roste s obsazeností.
      // Koeficient sleduje tempo hry – s blasterem na 13 poškození
      // dojde vůdce osmičlenného zápasu na 12 zásahů právě k šesté minutě.
      // S katastrofami se ale část času tráví útěkem a vůdce nasbírá
      // jen 8–10, takže limit klesá, aby zápas pořád došel do konce.
      fragLimit: Math.max(7, Math.round(
        players.length * (Object.values(on).some(Boolean) ? 1.2 : 1.5))),
      over: null,
    };
    for (const pl of players) {
      state.players[pl.uid] = {
        uid: pl.uid, name: pl.name, bot: pl.bot,
        x: 0, y: 0, vx: 0, vy: 0, aim: 0, spd: 1, level: 0,
        hp: A.HP, alive: false, respawnAt: 0,
        weapon: DEFAULT_WEAPON, ammo: WEAPONS[DEFAULT_WEAPON].mag, fireAt: 0, reloadAt: 0,
        buffs: {},
        frags: 0, deaths: 0,
        queue: [], last: null, ack: 0,
        ai: { targetUid: null, nextPick: 0, fireFrom: 0, strafe: 1, strafeUntil: 0, lastX: 0, lastY: 0, stuckAt: 0, goalAt: 0, goalPad: null },
      };
    }
    for (const p of Object.values(state.players)) spawnPlayer(state, p, rng);
    return state;
  },

  // Klient poslá vstup 30× za sekundu i tehdy, když hráč nesahá na
  // klávesnici. Za aktivitu se proto počítá jen pohyb, střelba, přebíjení
  // nebo otočení mířidel – jinak by člověk stojící jako sloup platil za
  // aktivního a nikdy by za něj bot nezahrál.
  isActivity(msg, pam) {
    const dela = msg.dx || msg.dy || msg.shoot || msg.reload;
    const mir = typeof msg.aim === 'number' ? msg.aim : null;
    const otocil = mir !== null && pam.aim !== undefined && Math.abs(mir - pam.aim) > 0.005;
    pam.aim = mir;
    return !!(dela || otocil);
  },

  onInput(state, player, msg) {
    const p = state.players[player.uid];
    if (!p) return;
    const inp = sanitizeInput(msg);
    if (p.queue.length >= MAX_QUEUE) p.queue.shift();
    p.queue.push(inp);
  },

  // ── Simulační krok ─────────────────────────────────────────
  tick(state, _dt, ctx) {
    const dt = A.DT;
    const now = ctx.now;

    for (const p of Object.values(state.players)) {
      if (!p.alive) {
        if (p.respawnAt && now >= p.respawnAt) spawnPlayer(state, p, ctx.rng);
        p.queue.length = 0;
        continue;
      }

      this.stepBuffs(p, now);

      // Když vstup nedorazí, pár ticků se zopakuje ten poslední – to
      // vyhladí zakolísání sítě. Ale jen pár: dřív se opakoval navěky
      // i s příznakem "střílím", takže odpojený hráč pálil donekonečna.
      let inp = p.queue.shift();
      if (inp) {
        p.last = inp;
        p.stale = 0;
      } else {
        p.stale = (p.stale || 0) + 1;
        inp = p.stale > 3 || !p.last
          ? { dx: 0, dy: 0, aim: p.aim, shoot: false, reload: false }
          : { ...p.last, reload: false };
      }
      if (inp.seq) p.ack = inp.seq;

      applyInput(p, inp, dt);
      p.aimD = inp.aimD || 0;        // kam až má doletět raketa

      if (inp.reload) this.startReload(p, now);
      if (p.reloadAt && now >= p.reloadAt) {
        p.ammo = wep(p).mag;
        p.reloadAt = 0;
        state.fx.push({ k: 'reload', x: p.x, y: p.y });
      }
      if (inp.shoot) this.tryFire(state, p, now, ctx);
    }

    this.stepBullets(state, dt, now);
    this.stepPads(state, now, ctx.rng);
    this.stepEvents(state, dt, now, ctx.rng);

    // pojistka, kdyby snapshot z jakéhokoliv důvodu dlouho nešel
    if (state.fx.length > 200) state.fx.splice(0, state.fx.length - 200);

    const leader = Object.values(state.players).sort((a, b) => b.frags - a.frags)[0];
    if (leader && leader.frags >= state.fragLimit) state.over = { by: 'frags' };
    else if (now >= state.endsAt) state.over = { by: 'time' };
  },

  // ── Power-upy ──────────────────────────────────────────────
  stepBuffs(p, now) {
    for (const k of Object.keys(p.buffs)) if (now >= p.buffs[k]) delete p.buffs[k];
    p.spd = p.buffs.speed ? POWERS.speed.mul : 1;
  },

  // ── Střelba ────────────────────────────────────────────────
  startReload(p, now) {
    const w = wep(p);
    if (!w.refill || p.reloadAt || p.ammo >= w.mag || p.buffs.infammo) return;
    p.reloadAt = now + w.reload;
  },

  tryFire(state, p, now, ctx) {
    const w = wep(p);
    if (p.reloadAt) return;                       // uprostřed přebíjení se nestřílí

    if (p.ammo <= 0) {
      if (w.refill) this.startReload(p, now);     // prázdný zásobník se dobije sám
      else giveWeapon(p, DEFAULT_WEAPON);         // vystřílená speciálka se zahodí
      return;
    }

    // Kadenci hlídá výhradně server. Klient může posílat "střílej"
    // jak chce často, dřív než uplyne interval se nic nestane.
    const rate = w.fire * (p.buffs.rapid ? POWERS.rapid.mul : 1);
    if (now < p.fireAt) return;
    p.fireAt = now + rate;
    p.loud = now + A.LOUD_MS;   // záblesk z hlavně tě prozradí
    if (!p.buffs.infammo) p.ammo--;

    const ang = p.aim + (ctx.rng() - 0.5) * 2 * w.spread;
    // Střelba shora nese kratší dosah – to je cena za výhodu výšky.
    const rm = rangeMul(p.level);

    if (w.kind === 'ray') return this.fireRay(state, p, ang, w, now, rm);

    // Zaměřená raketa vybuchne tam, kam ukazoval kurzor. Vzdálenost
    // přijde od klienta, ale server ji ořízne do mezí zbraně (a zkrátí
    // podle patra), takže se tím nedá dostřelit dál ani si odpálit
    // raketu v ruce.
    let fuse = 0;
    if (w.aimed) {
      // Klient měří vzdálenost od středu hráče, raketa ale vylétá
      // z ústí hlavně – bez tohohle odečtu vybuchne o kus dál.
      const usti = A.PLAYER_R + 8;
      fuse = clamp((p.aimD || w.maxFuse) - usti, w.minFuse, w.maxFuse * rm);
    }

    state.bullets.push({
      id: bulletId++,
      fuse,
      x: p.x + Math.cos(ang) * (A.PLAYER_R + 8),
      y: p.y + Math.sin(ang) * (A.PLAYER_R + 8),
      vx: Math.cos(ang) * w.speed,
      vy: Math.sin(ang) * w.speed,
      owner: p.uid, kind: w.kind, dmg: w.dmg, life: w.life * rm, r: w.r,
      splashR: w.splashR || 0, splashDmg: w.splashDmg || 0,
      lvl: p.level,
    });
    state.fx.push({ k: 'shot', x: p.x, y: p.y, a: ang, w: p.weapon });
  },

  // Raygun je okamžitý a prochází skrz hráče – zasáhne každého
  // na přímce, dokud nenarazí do zdi.
  fireRay(state, p, ang, w, now, rm = 1) {
    const range = w.range * rm;

    // zkrať paprsek o kus za nejbližší zeď
    let step = range;
    for (let d = 40; d <= range; d += 20) {
      const tx = p.x + Math.cos(ang) * d;
      const ty = p.y + Math.sin(ang) * d;
      if (!hasLOS(p.x, p.y, tx, ty)) { step = d; break; }
    }
    const ex = p.x + Math.cos(ang) * step;
    const ey = p.y + Math.sin(ang) * step;

    for (const t of Object.values(state.players)) {
      if (t.uid === p.uid || !t.alive) continue;
      if (t.level > p.level && !isLoud(t, now)) continue;   // výš postavený je krytý, dokud nevystřelí
      const hit = segCircle(p.x, p.y, ex, ey, t.x, t.y, A.PLAYER_R);
      if (hit >= 0) this.damage(state, t, w.dmg, p.uid, now, t.x, t.y);
    }
    state.fx.push({ k: 'ray', x: p.x, y: p.y, x2: ex, y2: ey });
  },

  stepBullets(state, dt, now) {
    const alive = Object.values(state.players).filter(p => p.alive);
    const keep = [];

    for (const b of state.bullets) {
      b.life -= dt;
      if (b.life <= 0) { if (b.splashR) this.explode(state, b, b.x, b.y, now); continue; }

      let nx = b.x + b.vx * dt;
      let ny = b.y + b.vy * dt;

      // Zaměřená raketa: došla-li k bodu pod kurzorem, bouchne přesně tam.
      let doletela = false;
      if (b.fuse > 0) {
        const krok = Math.hypot(nx - b.x, ny - b.y);
        if (krok >= b.fuse) {
          const t = b.fuse / (krok || 1);
          nx = b.x + (nx - b.x) * t;
          ny = b.y + (ny - b.y) * t;
          doletela = true;
        } else {
          b.fuse -= krok;
        }
      }

      let hitT = Infinity, victim = null;
      for (const p of alive) {
        if (p.uid === b.owner) continue;
        // Přímá střela nahoru nedosáhne. Raketa ale musí bouchnout
        // i o výš postaveného – jinak proletí kolem a obsazená věž
        // nemá vůbec žádný protilék.
        if (!b.splashR && p.level > (b.lvl || 0) && !isLoud(p, now)) continue;
        const t = segCircle(b.x, b.y, nx, ny, p.x, p.y, A.PLAYER_R + b.r);
        if (t >= 0 && t < hitT) { hitT = t; victim = p; }
      }

      // Nemrtví stojí střelám v cestě stejně jako hráči.
      let zT = Infinity, zVictim = null;
      for (const z of state.zombies) {
        const t = segCircle(b.x, b.y, nx, ny, z.x, z.y, EVENT_BY_KEY.zombies.r + b.r);
        if (t >= 0 && t < zT) { zT = t; zVictim = z; }
      }

      let wallT = Infinity;
      for (const w of WALLS) if (segRect(b.x, b.y, nx, ny, w)) { wallT = 0.999; break; }
      if (nx < 0 || ny < 0 || nx > A.W || ny > A.H) wallT = Math.min(wallT, 0.999);

      if (zVictim && zT <= hitT && zT <= wallT) {
        const hx = b.x + (nx - b.x) * zT;
        const hy = b.y + (ny - b.y) * zT;
        if (b.splashR) this.explode(state, b, hx, hy, now);
        else if (this.hurtZombie(state, zVictim, b.dmg, now)) {
          state.zombies = state.zombies.filter(z => z !== zVictim);
        }
        continue;
      }

      if (victim && hitT <= wallT) {
        const hx = b.x + (nx - b.x) * hitT;
        const hy = b.y + (ny - b.y) * hitT;
        if (b.splashR) {
          // Přímý zásah raketou musí bolet víc než těsné minutí.
          // Dřív se rovnou volal jen výbuch, takže `dmg` bylo mrtvé –
          // v měření z toho bylo 117 výstřelů a 0 přímých zabití.
          // Do vyššího patra ale plná rána nedoletí, zbude jen výbuch.
          const plnyZasah = victim.level <= (b.lvl || 0) || isLoud(victim, now);
          if (plnyZasah) this.damage(state, victim, b.dmg, b.owner, now, hx, hy);
          this.explode(state, b, hx, hy, now, plnyZasah ? victim.uid : null);
        } else {
          this.damage(state, victim, b.dmg, b.owner, now, hx, hy);
        }
        continue;
      }
      if (wallT < Infinity) {
        const wx = b.x + (nx - b.x) * wallT, wy = b.y + (ny - b.y) * wallT;
        if (b.splashR) this.explode(state, b, wx, wy, now);
        else state.fx.push({ k: 'wall', x: wx, y: wy });
        continue;
      }

      if (doletela) {
        b.x = nx; b.y = ny;
        this.explode(state, b, nx, ny, now);
        continue;
      }

      b.x = nx; b.y = ny;
      keep.push(b);
    }
    state.bullets = keep;
  },

  // Raketa bouchne při kolizi – přímý zásah plus okolí.
  // Skrz zeď výbuch nezraňuje, jinak by se dalo střílet do rohu domu.
  //
  // Výbuch jako jediný ignoruje výškové úrovně. Bez toho by se
  // nedobytá věž nedala vůbec vyčistit a kdo si na ni vyleze první,
  // vyhrál by zápas.
  explode(state, b, x, y, now, except = null) {
    state.fx.push({ k: 'boom', x, y, r: b.splashR });
    // výbuch trhá i nemrtvé – raketomet je proti hordě nejlepší volba
    if (state.zombies.length) {
      const padli = [];
      for (const z of state.zombies) {
        const d = Math.sqrt(dist2(z, { x, y }));
        if (d > b.splashR || !hasLOS(x, y, z.x, z.y)) continue;
        const sila = b.splashDmg * (0.35 + 0.65 * (1 - d / b.splashR));
        if (this.hurtZombie(state, z, sila, now)) padli.push(z);
      }
      if (padli.length) state.zombies = state.zombies.filter(z => !padli.includes(z));
    }
    for (const t of Object.values(state.players)) {
      if (!t.alive) continue;
      if (t.uid === except) continue;      // přímo zasažený už dostal svoje
      const d = Math.sqrt(dist2(t, { x, y }));
      if (d > b.splashR) continue;
      if (!hasLOS(x, y, t.x, t.y)) continue;
      const falloff = 1 - d / b.splashR;
      const dmg = Math.round(b.splashDmg * (0.35 + 0.65 * falloff));
      this.damage(state, t, dmg, b.owner, now, t.x, t.y);
    }
  },

  damage(state, p, amount, byUid, now, hx, hy) {
    if (p.buffs.invuln) { state.fx.push({ k: 'block', x: p.x, y: p.y }); return; }

    p.hp -= amount;
    state.fx.push({ k: 'hit', x: hx, y: hy });
    if (p.hp > 0) return;

    p.hp = 0;
    p.alive = false;
    p.deaths++;
    p.respawnAt = now + A.RESPAWN_MS;
    p.buffs = {};
    p.spd = 1;
    state.fx.push({ k: 'kill', x: p.x, y: p.y });

    const killer = state.players[byUid];
    if (killer && killer !== p) killer.frags++;
    // Bod se strhává jen za vlastní hloupost (typicky raketa pod nohy).
    // Blesk ani jiná smrt bez střelce hráče netrestá dvakrát.
    else if (killer === p) p.frags = Math.max(0, p.frags - 1);
  },

  // ── Podstavce s věcmi ──────────────────────────────────────
  stepPads(state, now, rng) {
    for (const pad of state.pads) {
      if (!pad.kind) {
        if (now >= pad.at) pad.kind = rollPickup(rng);
        continue;
      }
      const padLevel = deckLevelAt(pad.x, pad.y);
      for (const p of Object.values(state.players)) {
        if (!p.alive) continue;
        if (p.level !== padLevel) continue;       // na věc na střeše se ze země nedosáhne
        if (dist2(p, pad) > (A.PLAYER_R + A.PICKUP_R) ** 2) continue;
        if (!this.take(state, p, pad.kind, now)) continue;
        pad.kind = null;
        pad.at = now + A.PAD_RESPAWN_MS;
        break;
      }
    }
  },

  // Vrací false, když hráč věc nepotřebuje (plné HP) – ať se
  // lékárna zbytečně nespotřebuje průchodem.
  take(state, p, kind, now) {
    if (kind === 'heal') {
      if (p.hp >= A.HP) return false;
      p.hp = Math.min(A.HP, p.hp + A.PACK_HEAL);
      state.fx.push({ k: 'heal', x: p.x, y: p.y });
      return true;
    }
    if (WEAPONS[kind]) {
      giveWeapon(p, kind);
      state.fx.push({ k: 'pick', x: p.x, y: p.y, kind });
      return true;
    }
    if (POWERS[kind]) {
      p.buffs[kind] = now + POWERS[kind].ms;
      if (kind === 'infammo') p.reloadAt = 0;
      state.fx.push({ k: 'pick', x: p.x, y: p.y, kind });
      return true;
    }
    return false;
  },

  // ── Eventy ─────────────────────────────────────────────────
  stepEvents(state, dt, now, rng) {
    const alive = () => Object.values(state.players).filter(p => p.alive);

    // Když běží víc událostí naráz, hrozby se sčítají a hráči už jen
    // přežívají. V testu se všemi třemi měli boti 0–3 zásahy a 7–17
    // smrtí. Proto se meteoritům i bouřce v takovém případě ubere tempo.
    const soubezne = Object.values(state.events).filter(Boolean).length;
    const zpomal = soubezne > 1 ? 1.25 : 1;

    // Společný plánovač vln: pohroma náhodně začne, chvíli drží
    // a zase poleví. Vrací, jestli právě teď řádí.
    const vlna = (klic, st, E, start, konec) => {
      if (!state.events[klic]) return false;
      if (!st.on) {
        if (now < st.at) return false;
        st.on = true;
        st.from = now;
        st.until = planEnd(E, rng, now);
        start?.();
        state.fx.push({ k: 'evstart', ev: klic, x: A.W / 2, y: A.H / 2 });
        return true;
      }
      if (now >= st.until) {
        st.on = false;
        st.at = planAgain(E, rng, now);
        konec?.();
        state.fx.push({ k: 'evend', ev: klic, x: A.W / 2, y: A.H / 2 });
        return false;
      }
      return true;
    };

    // ── Potopa ──
    // Vlna vody: stoupne na zem, po části vlny zaplaví i první patro
    // a na konci zase opadne. Vory drží nad hladinou i dole.
    const Ef = EVENT_BY_KEY.flood;
    const potopa = vlna('flood', state.flood, Ef,
      () => { state.flood.stage = 1; state.fx.push({ k: 'flood', x: A.W / 2, y: A.H / 2, stage: 1 }); },
      () => { state.flood.stage = 0; });

    if (potopa) {
      if (state.flood.stage === 1) {
        const delka = state.flood.until - state.flood.from;
        if (now - state.flood.from >= delka * Ef.deepAt) {
          state.flood.stage = 2;
          state.fx.push({ k: 'flood', x: A.W / 2, y: A.H / 2, stage: 2 });
        }
      }
      for (const p of alive()) {
        if (!isDrowning(p, state.flood.stage)) continue;
        if (p.buffs.invuln) continue;
        p.hp -= Ef.dps * dt;
        if (p.hp <= 0) this.drown(state, p, now);
        else if (rng() < 0.06) state.fx.push({ k: 'bubble', x: p.x, y: p.y });
      }
    }

    // ── Meteority ──
    // Nejdřív se označí dopadová zóna, pak teprve spadne. Zasáhne
    // všechna patra – i věž, jinak by byla nedobytná.
    const Em = EVENT_BY_KEY.meteors;
    if (vlna('meteors', state.met, Em, () => { state.meteorAt = now; })) {
      if (now >= state.meteorAt) {
        state.meteorAt = now + Em.everyMs * zpomal;
        const cil = rng.pick(alive());
        // Padají ve shlucích. Jeden meteorit se dá odkrokovat stranou –
        // v testu boti odchodili 25 dopadů bez jediného zásahu. Dvě
        // překrývající se zóny už nutí skutečně někam doběhnout.
        const kusu = 2 + (rng() < 0.5 ? 1 : 0) + (rng() < 0.25 ? 1 : 0);
        const naNekoho = cil && rng() < 0.6;
        const bx = naNekoho ? cil.x : 90 + rng() * (A.W - 180);
        const by = naNekoho ? cil.y : 90 + rng() * (A.H - 180);
        for (let i = 0; i < kusu; i++) {
          const s = rollSize(Em, rng);            // každý kus jinak velký
          const uhel = rng() * Math.PI * 2;
          const odsad = i === 0 ? 0 : s.r * (0.9 + rng() * 0.7);
          state.meteors.push({
            x: clamp(bx + Math.cos(uhel) * odsad, 60, A.W - 60),
            y: clamp(by + Math.sin(uhel) * odsad, 60, A.H - 60),
            r: s.r, dmg: s.dmg,
            at: now + Em.warnMs + i * 260,      // dopadají krátce po sobě
          });
        }
      }
    }
    // Už označené zóny musí dopadnout, i když vlna mezitím skončila.
    state.meteors = state.meteors.filter(m => {
      if (now < m.at) return true;
      state.fx.push({ k: 'meteor', x: m.x, y: m.y, r: m.r });
      for (const p of alive()) {
        if (p.buffs.invuln) continue;
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d > m.r) continue;
        // Jádro dopadu zabíjí, k okraji síla klesá – jako u skutečného
        // dopadu, kde kráter je smrt a tlaková vlna už jen popálí.
        const t = d / m.r;
        const k = t <= Em.core ? 1 : 1 - (1 - Em.edge) * ((t - Em.core) / (1 - Em.core));
        this.damage(state, p, m.dmg * k, null, now, p.x, p.y);
      }
      return false;
    });

    // ── Bouře ──
    // Blesk se zaměří na nekrytého hráče a udeří se zpožděním –
    // kdo doběhne ke zdi nebo uskočí, vyvázne.
    const Es = EVENT_BY_KEY.storm;
    if (vlna('storm', state.storm, Es, () => { state.stormAt = now; })) {
      if (now >= state.stormAt) {
        state.stormAt = now + Es.everyMs * zpomal;
        // Kdo je uvězněný na voru uprostřed potopy, nemá kam uhnout –
        // blesk by z něj udělal jistou oběť. Vor se proto počítá jako kryt.
        const terce = alive().filter(p => !isCovered(p.x, p.y) && !onRaft(p.x, p.y));
        const cil = rng.pick(terce);
        if (cil) state.bolts.push({ x: cil.x, y: cil.y, at: now + Es.warnMs });
      }
    }
    // ── Zombie apokalypsa ──
    // Nemrtví přicházejí od okrajů, jdou po nejbližším hráči a lezou
    // i po rampách – před nimi neochrání ani věž.
    const Ez = EVENT_BY_KEY.zombies;
    if (vlna('zombies', state.zomb, Ez, () => { state.zombAt = now; },
      () => { state.zombies.length = 0; })) {         // s koncem vlny se rozpadnou
      if (now >= state.zombAt && state.zombies.length < Ez.max) {
        state.zombAt = now + Ez.everyMs * zpomal;
        for (let i = 0; i < Ez.perWave && state.zombies.length < Ez.max; i++) {
          state.zombies.push(this.spawnZombie(state, rng, now));
        }
      }
    }
    this.stepZombies(state, dt, now, Ez);

    {
      const E = Es;
      state.bolts = state.bolts.filter(b => {
        if (now < b.at) return true;
        state.fx.push({ k: 'bolt', x: b.x, y: b.y });
        for (const p of alive()) {
          if (p.buffs.invuln) continue;
          if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 > E.hitR ** 2) continue;
          if (isCovered(p.x, p.y) || onRaft(p.x, p.y)) continue;   // stihl se schovat
          this.damage(state, p, E.dmg, null, now, p.x, p.y);
        }
        return false;
      });
    }
  },

  // Nemrtví se rojí od okrajů mapy, ne z hráčských spawnů.
  spawnZombie(state, rng, now) {
    const okraj = Math.floor(rng() * 4);
    const m = 70;
    const x = okraj === 0 ? m : okraj === 1 ? A.W - m : m + rng() * (A.W - 2 * m);
    const y = okraj === 2 ? m : okraj === 3 ? A.H - m : m + rng() * (A.H - 2 * m);
    zombieId++;
    return {
      id: zombieId, x, y, vx: 0, vy: 0, level: deckLevelAt(x, y),
      hp: EVENT_BY_KEY.zombies.hp, hitAt: 0, dirAt: 0, dx: 0, dy: 0, aim: 0,
      lx: x, ly: y, chkAt: now + 500, side: 1, sideUntil: 0, sx: 0, sy: 0,
    };
  },

  stepZombies(state, dt, now, E) {
    const zs = state.zombies;
    if (!zs.length) return;
    const zivi = Object.values(state.players).filter(p => p.alive);

    // ── Rozestup ──
    // Nemrtví se navzájem odtlačují. Bez toho procházeli jeden druhým,
    // slezli se do jednoho chuchvalce a v úzké rampě se zablokovali –
    // 68 % všech zaseknutí bylo právě tam.
    const minD = E.r * 2.1;
    for (const z of zs) { z.sx = 0; z.sy = 0; }
    for (let i = 0; i < zs.length; i++) {
      for (let j = i + 1; j < zs.length; j++) {
        const a = zs[i], b = zs[j];
        if (a.level !== b.level) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dd = dx * dx + dy * dy;
        if (dd >= minD * minD || dd === 0) continue;
        const d = Math.sqrt(dd);
        const sila = (minD - d) / minD * E.speed * 0.85;
        const nx = dx / d * sila, ny = dy / d * sila;
        a.sx -= nx; a.sy -= ny;
        b.sx += nx; b.sy += ny;
      }
    }

    for (const z of zs) {
      // Cíl a směr se přepočítávají po dávkách, ne každý tick –
      // třicet zombíků × spádové pole třicetkrát za sekundu by
      // server zbytečně vytěžovalo.
      if (now >= z.dirAt) {
        z.dirAt = now + 220;
        let cil = null, nej = Infinity;
        for (const p of zivi) {
          const d = dist2(z, p);
          if (d < nej) { nej = d; cil = p; }
        }
        if (cil) {
          const f = flowDir(z.x, z.y, z.level, cil.x, cil.y, cil.level || 0);
          if (f) { z.dx = f.x; z.dy = f.y; }
          else {
            const a = Math.atan2(cil.y - z.y, cil.x - z.x);
            z.dx = Math.cos(a); z.dy = Math.sin(a);
          }
          z.aim = Math.atan2(z.dy, z.dx);
        } else { z.dx = 0; z.dy = 0; }
      }

      // ── Odseknutí ──
      // Když se za půl sekundy nikam nedostane, chvíli jde bokem
      // a přepočítá si směr. Jinak zůstane opřený o roh donekonečna.
      if (now >= z.chkAt) {
        const posun = Math.hypot(z.x - z.lx, z.y - z.ly);
        z.chkAt = now + 500;
        if (posun < E.speed * 0.5 * 0.3) {
          z.side = z.side ? -z.side : 1;
          z.sideUntil = now + 650;
          z.dirAt = 0;
        }
        z.lx = z.x; z.ly = z.y;
      }

      // stejná pohybová rutina jako hráči, jen pomalejší a bez setrvačnosti
      let sx = z.dx, sy = z.dy;
      if (now < z.sideUntil) {
        const a = Math.atan2(z.dy, z.dx) + z.side * 1.1;
        sx = Math.cos(a); sy = Math.sin(a);
      }
      z.vx = sx * E.speed + (z.sx || 0);
      z.vy = sy * E.speed + (z.sy || 0);
      moveAndCollide(z, dt, E.r);

      // kousnutí
      if (now < z.hitAt) continue;
      for (const p of zivi) {
        if (p.level !== z.level) continue;
        if (dist2(z, p) > (E.reachR + A.PLAYER_R) ** 2) continue;
        if (p.buffs.invuln) { state.fx.push({ k: 'block', x: p.x, y: p.y }); }
        else this.damage(state, p, E.dmg, null, now, p.x, p.y);
        z.hitAt = now + E.hitMs;
        state.fx.push({ k: 'bite', x: z.x, y: z.y });
        break;
      }
    }
  },

  hurtZombie(state, z, dmg, now) {
    z.hp -= dmg;
    state.fx.push({ k: 'zhit', x: z.x, y: z.y });
    if (z.hp > 0) return false;
    state.fx.push({ k: 'zdie', x: z.x, y: z.y });
    return true;
  },

  // Hlášení o blížící se vlně – seřazená podle naléhavosti.
  // Ohlašuje se každá vlna, ne jen ta první.
  alerts(state, now) {
    const out = [];
    const pridej = (k, st, E, okno) => {
      if (!state.events[k] || st.on) return;
      const zbyva = st.at - now;
      if (zbyva <= okno) out.push({ k, in: Math.max(0, zbyva), stage: 1 });
    };
    pridej('flood', state.flood, EVENT_BY_KEY.flood, EVENT_BY_KEY.flood.warnMs);
    pridej('meteors', state.met, EVENT_BY_KEY.meteors, EVENT_BY_KEY.meteors.announceMs);
    pridej('storm', state.storm, EVENT_BY_KEY.storm, EVENT_BY_KEY.storm.announceMs);
    return out.sort((a, b) => a.in - b.in);
  },

  drown(state, p, now) {
    this.kill(state, p, now, 'utopení');
    state.fx.push({ k: 'drown', x: p.x, y: p.y });
  },

  // Smrt bez střelce (meteorit, utopení). Počítá se jako smrt, ale
  // bod nebere – hráč za živly nemůže. Dokud to bod strhávalo, končily
  // zápasy s eventy skóre 3, protože utopení ubírala rychleji, než se
  // stíhalo střílet.
  kill(state, p, now, duvod) {
    if (!p.alive) return;
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    p.respawnAt = now + A.RESPAWN_MS;
    p.buffs = {};
    p.spd = 1;
    state.fx.push({ k: 'kill', x: p.x, y: p.y, duvod });
  },

  // ── Bot ────────────────────────────────────────────────────
  botThink(state, player, ctx) {
    const b = state.players[player.uid];
    if (!b || !b.alive || state.over) return null;

    const L = LEVELS[player.botLevel] || LEVELS.normal;
    const ai = b.ai;
    const now = ctx.now;
    const w = wep(b);

    // Bot vidí stejně málo jako člověk – neviditelné a výš postavené
    // nevnímá. Jinak by "věděl", kde jsou, což je zrovna to, co
    // hráči na botech nesnáší.
    const foes = Object.values(state.players).filter(p =>
      p.alive && p.uid !== b.uid && !p.buffs.invis && isVisibleTo(b.level, p, now));
    if (!foes.length) return { dx: 0, dy: 0, aim: b.aim, shoot: false, reload: false };

    if (now >= ai.nextPick || !state.players[ai.targetUid]?.alive) {
      ai.nextPick = now + 700;
      let best = null, bestScore = -Infinity;
      for (const f of foes) {
        const d = Math.sqrt(dist2(b, f));
        const score = (hasLOS(b.x, b.y, f.x, f.y) ? 1200 : 0) - d;
        if (score > bestScore) { bestScore = score; best = f; }
      }
      ai.targetUid = best?.uid || null;
    }

    const t = state.players[ai.targetUid];
    if (!t || !t.alive) return { dx: 0, dy: 0, aim: b.aim, shoot: false, reload: false };

    const d = Math.sqrt(dist2(b, t));
    const los = hasLOS(b.x, b.y, t.x, t.y);
    const range = L.range * rangeMul(b.level);   // shora se střílí kratčeji

    // Nemrtvý na dosah má přednost před přestřelkou – jinak by bota
    // horda v klidu sežrala, zatímco si vyměňuje rány přes půl mapy.
    let terc = t, dCil = d, losCil = los;
    let zNej = null, zD = Infinity;
    for (const z of state.zombies) {
      if (z.level !== b.level) continue;
      const dz = Math.sqrt(dist2(b, z));
      if (dz < zD && dz < 360 && hasLOS(b.x, b.y, z.x, z.y)) { zD = dz; zNej = z; }
    }
    if (zNej && zD < d) { terc = zNej; dCil = zD; losCil = true; }

    // ── Míření ──
    const flight = w.kind === 'ray' ? 0 : dCil / w.speed;
    const px = terc.x + terc.vx * flight * L.lead;
    const py = terc.y + terc.vy * flight * L.lead;
    const want = Math.atan2(py - b.y, px - b.x);
    const aim = want + (ctx.rng() - 0.5) * 2 * L.aimErr;

    // ── Přebíjení ──
    // Bot si dobíjí v klidu, ne až v přestřelce s prázdným zásobníkem.
    const lowMag = w.refill && b.ammo <= 1 && !b.buffs.infammo;
    const reload = lowMag && (!losCil || dCil > range);

    // ── Střelba ──
    if (losCil && dCil < range) { if (!ai.fireFrom) ai.fireFrom = now + L.react; }
    else ai.fireFrom = 0;

    const aligned = Math.abs(((aim - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3;
    // raketou si pod nohy nestřílí
    const suicidal = w.splashR && dCil < w.splashR * 1.15;
    const shoot = losCil && dCil < range && ai.fireFrom > 0 && now >= ai.fireFrom
      && aligned && !suicidal && b.ammo > 0 && !b.reloadAt && ctx.rng() < L.hold;

    // ── Kam jít ──
    // Rozhodnutí "podstavec, nebo souboj" padá jednou za čas a pak
    // se ho bot drží. Losovat ho každý tick znamenalo, že mezi obojím
    // kmital 30× za sekundu a nedošel ani k jednomu.
    if (now >= ai.goalAt) {
      ai.goalAt = now + 1300;
      ai.goalPad = null;
      if (b.hp < A.HP * 0.4) {
        const pad = state.pads.filter(p => p.kind === 'heal')
          .sort((p, q) => dist2(b, p) - dist2(b, q))[0];
        if (pad && Math.sqrt(dist2(b, pad)) < d * 1.3) ai.goalPad = pad;
      } else if (b.weapon === DEFAULT_WEAPON && ctx.rng() < L.greed) {
        // se základní zbraní stojí za to zajít si pro lepší
        const pad = state.pads.filter(p => p.kind && p.kind !== 'heal')
          .sort((p, q) => dist2(b, p) - dist2(b, q))[0];
        if (pad && Math.sqrt(dist2(b, pad)) < 620) ai.goalPad = pad;
      }
    }
    // někdo to mezitím sebral – přestaň tam běhat
    if (ai.goalPad && !state.pads.some(p => p.x === ai.goalPad.x && p.y === ai.goalPad.y && p.kind)) {
      ai.goalPad = null;
    }
    let goal = ai.goalPad || t;

    // ── Eventy přebijí všechno ostatní ──
    // Topícího se bota nezajímá přestřelka, potřebuje ven z vody.
    // Reagovat až ve chvíli, kdy se bot topí, nestačí – za nepřítelem
    // do vody klidně vleze a než se otočí, je po něm. Proto se hlídá
    // i to, kam právě míří.
    let panika = false;
    const stage = state.flood.stage;
    if (stage > 0) {
      const suche = (x, y, lvl) => lvl >= stage || onRaft(x, y);
      const cilLvl = goal.level ?? deckLevelAt(goal.x, goal.y);
      if (!suche(b.x, b.y, b.level) || !suche(goal.x, goal.y, cilLvl)) {
        panika = true;
        // Cílem musí být střecha nebo vor, ne rampa. Na rampě si hráč
        // drží původní úroveň, takže by tam doběhl a utopil se na místě.
        const utek = spawnPool(stage).sort((p, q) => dist2(b, p) - dist2(b, q))[0];
        if (utek) goal = utek;
      }
    }

    let dx = 0, dy = 0;
    if (panika) {
      const f = flowDir(b.x, b.y, b.level, goal.x, goal.y, goal.level ?? deckLevelAt(goal.x, goal.y));
      if (f) { dx = f.x; dy = f.y; }
      else { const a = Math.atan2(goal.y - b.y, goal.x - b.x); dx = Math.cos(a); dy = Math.sin(a); }
    } else if (los && goal === t) {
      if (now >= ai.strafeUntil) {
        ai.strafe = ctx.rng() < 0.5 ? -1 : 1;
        ai.strafeUntil = now + 500 + ctx.rng() * 900;
      }
      const ang = Math.atan2(t.y - b.y, t.x - b.x);
      const ideal = w.splashR ? w.splashR * 1.6 : IDEAL_RANGE;
      const push = clamp((d - ideal) / 220, -1, 1);
      dx = Math.cos(ang) * push + Math.cos(ang + Math.PI / 2) * ai.strafe * L.strafe;
      dy = Math.sin(ang) * push + Math.sin(ang + Math.PI / 2) * ai.strafe * L.strafe;
    } else {
      const f = flowDir(b.x, b.y, b.level, goal.x, goal.y, goal.level ?? deckLevelAt(goal.x, goal.y));
      if (f) { dx = f.x; dy = f.y; }
      else {
        const ang = Math.atan2(goal.y - b.y, goal.x - b.x);
        dx = Math.cos(ang); dy = Math.sin(ang);
      }
    }

    // Uhni z označené dopadové zóny a zpod zaměřeného blesku.
    // Obojí je předem vidět, takže bot má stejnou šanci jako člověk.
    for (const m of state.meteors) {
      const dd = Math.hypot(b.x - m.x, b.y - m.y);
      // Uhýbání nesmí být dokonalé, jinak jsou eventy jen dekorace –
      // v testu boti odchodili 20 meteoritů s jediným zásahem.
      if (dd < m.r + 55) {
        const a = Math.atan2(b.y - m.y, b.x - m.x);
        dx += Math.cos(a) * 1.5; dy += Math.sin(a) * 1.5;
      }
    }
    for (const bo of state.bolts) {
      const dd = Math.hypot(b.x - bo.x, b.y - bo.y);
      if (dd < EVENT_BY_KEY.storm.hitR + 60) {
        const a = Math.atan2(b.y - bo.y, b.x - bo.x);
        dx += Math.cos(a) * 0.9; dy += Math.sin(a) * 0.9;
      }
    }

    const moved = Math.hypot(b.x - ai.lastX, b.y - ai.lastY);
    ai.lastX = b.x; ai.lastY = b.y;
    if (moved < 0.6 && (dx || dy)) {
      if (!ai.stuckAt) ai.stuckAt = now;
      if (now - ai.stuckAt > 400) {
        const a = ctx.rng() * Math.PI * 2;
        dx = Math.cos(a); dy = Math.sin(a);
        if (now - ai.stuckAt > 900) ai.stuckAt = 0;
      }
    } else ai.stuckAt = 0;

    const len = Math.hypot(dx, dy) || 1;
    // aimD = kam bot chce odpálit raketu (na cíl, ne na maximum)
    return { dx: dx / len, dy: dy / len, aim, aimD: dCil, shoot, reload };
  },

  // ── Co hráč smí vidět ──────────────────────────────────────
  view(state, uid) {
    const me = state.players[uid];
    const now = Date.now();
    const R2 = A.VIEW_R ** 2;
    const ref = me || { x: A.W / 2, y: A.H / 2 };
    const near = (e) => (e.x - ref.x) ** 2 + (e.y - ref.y) ** 2 < R2;
    const left = (b) => Object.fromEntries(Object.entries(b).map(([k, t]) => [k, Math.max(0, t - now)]));

    return {
      t: now,
      ack: me?.ack || 0,
      me: me ? {
        x: me.x, y: me.y, vx: me.vx, vy: me.vy, aim: me.aim, spd: me.spd, level: me.level,
        hp: me.hp, alive: me.alive,
        respawnIn: me.alive ? 0 : Math.max(0, me.respawnAt - now),
        frags: me.frags, deaths: me.deaths,
        weapon: me.weapon, ammo: me.ammo, mag: wep(me).mag,
        reloadIn: me.reloadAt ? Math.max(0, me.reloadAt - now) : 0,
        reloadMs: wep(me).reload,
        buffs: left(me.buffs),
      } : null,
      // Neviditelné hráče vůbec neposíláme – v konzoli se pak nedá
      // zjistit, kde jsou. Prozradí je jen jejich vlastní střely.
      // Kdo stojí výš, ten se vůbec neposílá – ze země o něm klient
      // nemá jak vědět, ani kdyby si hrabal v konzoli.
      ps: Object.values(state.players)
        .filter(p => p.uid !== uid && p.alive && near(p) && !p.buffs.invis
          && isVisibleTo(me?.level || 0, p, now))
        .map(p => ({
          uid: p.uid, x: p.x, y: p.y, aim: p.aim, hp: p.hp, name: p.name, bot: p.bot,
          w: p.weapon, sh: !!p.buffs.invuln, fast: !!p.buffs.speed, lvl: p.level,
        })),
      bs: state.bullets.filter(near).map(b => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, o: b.owner, k: b.kind })),
      // Nemrtví jsou společná hrozba – posílají se bez ohledu na patro,
      // protože po rampách vylezou i za tebou.
      zs: state.zombies.filter(near).map(z => ({
        id: z.id, x: z.x, y: z.y, aim: z.aim, hp: z.hp / EVENT_BY_KEY.zombies.hp, lvl: z.level,
      })),
      pads: state.pads.map(p => ({ x: p.x, y: p.y, kind: p.kind })),
      fx: state.fx.filter(near),
      sb: Object.values(state.players)
        .sort((a, b) => b.frags - a.frags || a.deaths - b.deaths)
        .map(p => ({ uid: p.uid, name: p.name, bot: p.bot, frags: p.frags, deaths: p.deaths, alive: p.alive })),
      // Eventy jsou veřejné – meteority i blesky se musí dát vidět
      // včas, jinak by to nebyla hra, ale loterie.
      ev: state.events,
      flood: state.events.flood
        ? {
            stage: state.flood.stage,
            on: state.flood.on,
            // běží-li vlna, odpočet ukazuje, kdy voda opadne; jinak kdy stoupne
            in: Math.max(0, (state.flood.on ? state.flood.until : state.flood.at) - now),
          }
        : null,
      // které vlny právě řádí – kvůli stavovému proužku
      wave: { flood: state.flood.on, meteors: state.met.on, storm: state.storm.on, zombies: state.zomb.on },
      met: state.meteors.map(m => ({ x: m.x, y: m.y, r: m.r, in: Math.max(0, m.at - now) })),
      bolt: state.bolts.map(b => ({ x: b.x, y: b.y, in: Math.max(0, b.at - now) })),
      // Co se chystá a za jak dlouho. Hráč musí dostat čas se připravit,
      // jinak z katastrofy není napětí, ale jen náhodné umírání.
      alerts: this.alerts(state, now),
      cover: me ? isCovered(me.x, me.y) : false,
      loud: me ? isLoud(me, now) : false,      // výstřel tě na chvíli prozradí
      drowning: me ? isDrowning(me, state.flood.stage) : false,
      endsIn: Math.max(0, state.endsAt - now),
      limit: state.fragLimit,
    };
  },

  result(state) {
    if (!state.over) return null;
    const rank = Object.values(state.players).sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
    const top = rank[0];
    if (!top) return { draw: true, reason: 'Nikdo nezůstal.' };
    const tied = rank.filter(p => p.frags === top.frags);
    if (tied.length > 1) return { draw: true, reason: `Remíza na ${top.frags} zásazích.` };
    return {
      winners: [top.uid],
      reason: state.over.by === 'frags'
        ? `${top.name} nastřílel ${top.frags} zásahů.`
        : `Vypršel čas – vede ${top.name} s ${top.frags} zásahy.`,
    };
  },

  // Efekty se hromadí, dokud neodejde snapshot – teprve pak se zahodí.
  afterSnap(state) {
    state.fx.length = 0;
  },

  onPlayerGone(state, player) {
    delete state.players[player.uid];
  },
};
