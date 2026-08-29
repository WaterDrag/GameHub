// Dělá výbuch rakety poškození? A trefí se vůbec do pohyblivého cíle,
// když detonuje na kurzoru?
import arena from '../server/games/arena.js';
import { A, WEAPONS } from '../shared/games/arena/const.js';
import { makeRng } from '../shared/rng.js';

const rng = makeRng(11);
const W = WEAPONS.rocket;
const ok = b => (b ? '✓' : '✗ CHYBA');

const mkP = (uid, x, y) => ({
  uid, name: uid, bot: false, x, y, vx: 0, vy: 0, aim: 0, spd: 1, level: 0,
  hp: A.HP, alive: true, respawnAt: 0, weapon: 'rocket', ammo: 4, fireAt: 0, reloadAt: 0,
  buffs: {}, frags: 0, deaths: 0, queue: [], last: null, ack: 0, aimD: 0,
  ai: { targetUid: null, nextPick: 0, fireFrom: 0, strafe: 1, strafeUntil: 0, lastX: 0, lastY: 0, stuckAt: 0, goalAt: 0, goalPad: null },
});
const mkS = (hraci) => ({
  players: Object.fromEntries(hraci.map(p => [p.uid, p])),
  bullets: [], pads: [], fx: [], zombies: [],
  events: { flood: false, meteors: false, storm: false, zombies: false },
  flood: { stage: 0, on: false, at: 1e15, until: 0 },
  met: { on: false, at: 1e15 }, storm: { on: false, at: 1e15 }, zomb: { on: false, at: 1e15 },
  meteors: [], bolts: [], stormAt: 1e15, meteorAt: 1e15, zombAt: 1e15,
  startedAt: Date.now(), endsAt: Date.now() + 6e5, fragLimit: 99, over: null,
});

console.log('=== 1) Výbuch přímo na cíli ===');
{
  const t = mkP('T', 500, 600);
  const s = mkS([mkP('A', 200, 600), t]);
  arena.explode(s, { owner: 'A', splashR: W.splashR, splashDmg: W.splashDmg }, t.x, t.y, Date.now());
  console.log(`  HP cíle: ${A.HP} → ${Math.round(t.hp)}  (ubráno ${Math.round(A.HP - t.hp)})  ${ok(t.hp < A.HP)}`);
}

console.log('\n=== 2) Útlum podle vzdálenosti od středu výbuchu ===');
console.log(`  poloměr výbuchu ${W.splashR} px, plná síla ${W.splashDmg}`);
for (const d of [0, 40, 80, 120, 134, 140]) {
  const t = mkP('T', 500 + d, 600);
  const s = mkS([mkP('A', 200, 600), t]);
  arena.explode(s, { owner: 'A', splashR: W.splashR, splashDmg: W.splashDmg }, 500, 600, Date.now());
  const ub = A.HP - t.hp;
  console.log(`  ${String(d).padStart(3)} px od středu → ${ub > 0 ? Math.round(ub) + ' poškození' : 'nic (mimo dosah)'}`);
}

console.log('\n=== 3) Zaměřená raketa na POHYBLIVÝ cíl ===');
console.log('  (mířím přesně na něj, on mezitím uhýbá do strany)');
for (const D of [200, 400, 600]) {
  for (const rychlost of [0, A.MAX_SPEED * 0.5, A.MAX_SPEED]) {
    const t = mkP('T', 200 + D, 600);
    t.vy = rychlost;
    const strelec = mkP('A', 200, 600);
    const s = mkS([strelec, t]);
    strelec.aim = 0;
    strelec.aimD = D;              // kurzor přesně na cíli
    arena.tryFire(s, strelec, Date.now(), { rng });
    // cíl se hýbe, dokud raketa nevybuchne
    for (let i = 0; i < 200 && s.bullets.length; i++) {
      t.y += t.vy * A.DT;
      arena.stepBullets(s, A.DT, Date.now());
    }
    const ub = Math.round(A.HP - t.hp);
    const popis = rychlost === 0 ? 'stojí     ' : rychlost === A.MAX_SPEED ? 'plná rychlost' : 'poloviční   ';
    console.log(`  ${String(D).padStart(3)} px, cíl ${popis} → ${ub > 0 ? ub + ' poškození' : 'MINUL'}`);
  }
}

console.log(`\n  doba letu rakety (${W.speed} px/s): 200 px = ${(200 / W.speed * 1000).toFixed(0)} ms, 400 px = ${(400 / W.speed * 1000).toFixed(0)} ms, 600 px = ${(600 / W.speed * 1000).toFixed(0)} ms`);
console.log(`  za tu dobu cíl v plné rychlosti ujede: ${(A.MAX_SPEED * 200 / W.speed).toFixed(0)} / ${(A.MAX_SPEED * 400 / W.speed).toFixed(0)} / ${(A.MAX_SPEED * 600 / W.speed).toFixed(0)} px`);
