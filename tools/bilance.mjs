// Měření bilance arény. Obalí skutečné serverové funkce a zaznamená,
// kdo koho čím zabil, z jakého patra a s jakým power-upem.
// Spuštění: node bilance.mjs [obtížnost] [sekund] [hráčů] [běhů] [eventy]
import arena from '../server/games/arena.js';
import { A, WEAPONS, POWERS } from '../shared/games/arena/const.js';
import { makeRng } from '../shared/rng.js';

const LEVEL = process.argv[2] || 'hard';
const SEK = Number(process.argv[3] || 360);
const POCET = Number(process.argv[4] || 8);
const BEHU = Number(process.argv[5] || 3);
const EVENTY = (process.argv[6] || '').split(',').filter(Boolean);

const S = {
  dmg: {}, kill: {}, shots: {}, hits: {}, overkill: 0,   // podle zbraně
  splashDmg: 0, splashKill: 0,
  killByShooterLvl: {}, killByVictimLvl: {},
  tickAtLvl: {}, tickWithBuff: {}, killWithBuff: {},
  picked: {}, deaths: 0, ticks: 0, konec: {},
  fragTop: [],
};
const add = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };

for (let beh = 0; beh < BEHU; beh++) {
  const rng = makeRng(1000 + beh * 7919);
  const players = Array.from({ length: POCET }, (_, i) => ({
    uid: 'B' + (i + 1), name: 'B' + (i + 1), bot: true, botLevel: LEVEL,
  }));
  const options = {};
  for (const e of EVENTY) options[e] = true;

  // ── obalení skutečných funkcí ──
  const oDamage = arena.damage;
  const oExplode = arena.explode;
  const oTryFire = arena.tryFire;
  const oTake = arena.take;
  let vyBuchu = false;

  arena.explode = function (state, b, x, y, now) {
    vyBuchu = true;
    try { return oExplode.call(this, state, b, x, y, now); } finally { vyBuchu = false; }
  };
  arena.tryFire = function (state, p, now, ctx) {
    const pred = p.ammo, predFire = p.fireAt;
    const r = oTryFire.call(this, state, p, now, ctx);
    if (p.fireAt !== predFire && (p.ammo < pred || p.buffs.infammo)) add(S.shots, p.weapon);
    return r;
  };
  arena.damage = function (state, p, amount, byUid, now, hx, hy) {
    const k = state.players[byUid];
    const zbran = k ? (vyBuchu ? 'rocket-splash' : k.weapon) : 'event';
    const zil = p.alive;
    const hpPred = p.hp;
    const r = oDamage.call(this, state, p, amount, byUid, now, hx, hy);
    if (p.hp < hpPred) {
      add(S.dmg, zbran, hpPred - p.hp);
      add(S.hits, zbran);
      // Zásah do skomírajícího hráče se v součtu poškození projeví
      // jen tolik, kolik mu zbývalo – zbytek se "ztratí".
      if (hpPred < amount) S.overkill += amount - hpPred;
    }
    if (zil && !p.alive) {
      add(S.kill, zbran);
      if (vyBuchu) S.splashKill++;
      if (k) {
        add(S.killByShooterLvl, k.level || 0);
        add(S.killByVictimLvl, p.level || 0);
        for (const b of Object.keys(k.buffs || {})) add(S.killWithBuff, b);
      }
      S.deaths++;
    }
    return r;
  };
  arena.take = function (state, p, kind, now) {
    const r = oTake.call(this, state, p, kind, now);
    if (r) add(S.picked, kind);
    return r;
  };

  const state = arena.createState({ players, rng, options });
  let now = Date.now();
  const ctx = { rng, players, now, room: null, emit: () => {}, emitTo: () => {}, reject: () => {} };

  for (let t = 0; t < SEK * A.TICK && !state.over; t++) {
    now += 1000 / A.TICK;
    ctx.now = now;
    for (const p of players) {
      const inp = arena.botThink(state, p, ctx);
      if (inp) arena.onInput(state, p, inp, ctx);
    }
    arena.tick(state, A.DT, ctx);
    for (const p of Object.values(state.players)) {
      if (!p.alive) continue;
      S.ticks++;
      add(S.tickAtLvl, p.level || 0);
      for (const b of Object.keys(p.buffs || {})) add(S.tickWithBuff, b);
    }
    arena.afterSnap(state);
  }
  add(S.konec, state.over ? state.over.by : 'nedohráno');
  S.fragTop.push(Math.max(...Object.values(state.players).map(p => p.frags)));

  arena.damage = oDamage; arena.explode = oExplode;
  arena.tryFire = oTryFire; arena.take = oTake;
}

// ── výpis ──
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + ' %' : '–');
const n1 = (v) => (v || 0).toFixed(1);
console.log(`=== ${POCET} botů (${LEVEL}), ${SEK} s × ${BEHU} běhů${EVENTY.length ? ', eventy: ' + EVENTY.join('+') : ''} ===\n`);

console.log('ZBRANĚ              výstřelů  zásahů  úspěšnost  pošk./ZÁSAH  pošk./výstřel  zabití');
for (const w of ['blaster', 'rocket', 'raygun', 'rocket-splash']) {
  const sh = w === 'rocket-splash' ? S.shots.rocket || 0 : S.shots[w] || 0;
  const d = S.dmg[w] || 0, k = S.kill[w] || 0, h = S.hits[w] || 0;
  if (!sh && !d) continue;
  const uspech = w === 'rocket-splash' ? '–' : (sh ? (h / sh * 100).toFixed(0) + ' %' : '–');
  console.log(
    `  ${w.padEnd(16)} ${String(w === 'rocket-splash' ? '–' : sh).padStart(8)} ${String(h).padStart(7)} ${uspech.padStart(10)} ${(h ? (d / h).toFixed(1) : '–').padStart(12)} ${(sh ? (d / sh).toFixed(1) : '–').padStart(14)} ${String(k).padStart(7)}`
  );
}
console.log(`  (poškození "ztracené" přebitím umírajícího: ${Math.round(S.overkill)})`);
if (S.kill.event) console.log(`  ${'události'.padEnd(18)} ${'–'.padStart(7)}  ${String(Math.round(S.dmg.event || 0)).padStart(10)}  ${String(S.kill.event).padStart(7)}`);

console.log('\nSEBRÁNO');
console.log('  ' + Object.entries(S.picked).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));

console.log('\nPATRA');
const tl = S.tickAtLvl;
for (const l of [0, 1, 2]) {
  const cas = tl[l] || 0;
  const zab = S.killByShooterLvl[l] || 0;
  const smrt = S.killByVictimLvl[l] || 0;
  console.log(`  patro ${l}: čas ${pct(cas, S.ticks).padStart(7)} | zabití odtud ${String(zab).padStart(4)} | smrtí tam ${String(smrt).padStart(4)} | zabití/min ${n1(zab / (cas / A.TICK / 60 || 1))}`);
}

console.log('\nPOWER-UPY (podíl času s buffem vs. podíl zabití s buffem)');
for (const k of Object.keys(POWERS)) {
  const cas = S.tickWithBuff[k] || 0, zab = S.killWithBuff[k] || 0;
  if (!cas) continue;
  const cp = cas / S.ticks * 100, zp = zab / S.deaths * 100;
  console.log(`  ${k.padEnd(9)} čas ${cp.toFixed(1).padStart(5)} %  zabití ${zp.toFixed(1).padStart(5)} %  → účinnost ×${(zp / cp).toFixed(2)}`);
}

console.log(`\nKONEC ZÁPASU: ${JSON.stringify(S.konec)} | nejlepší skóre: ${S.fragTop.join(', ')}`);
console.log(`smrtí celkem: ${S.deaths} (${n1(S.deaths / BEHU / (SEK / 60))} za minutu)`);
