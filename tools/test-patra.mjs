// Ověření pravidel výškových úrovní přímo na serverovém modulu arény.
// Žádné chození po mapě – stav se poskládá ručně a zavolá se skutečný
// view() / stepBullets() / fireRay(), tedy přesně ten kód, co běží v ostrém provozu.
import arena from '../server/games/arena.js';
import { A, WEAPONS } from '../shared/games/arena/const.js';
import { makeRng } from '../shared/rng.js';

const rng = makeRng(1);
const ok = (b) => (b ? '✓' : '✗ CHYBA');

function mkState(aLevel, bLevel, ax, ay, bx, by) {
  const mk = (uid, x, y, level) => ({
    uid, name: uid, bot: false, x, y, vx: 0, vy: 0, aim: 0, spd: 1, level,
    hp: A.HP, alive: true, respawnAt: 0,
    weapon: 'blaster', ammo: 5, fireAt: 0, reloadAt: 0,
    buffs: {}, frags: 0, deaths: 0, queue: [], last: null, ack: 0,
    ai: { targetUid: null, nextPick: 0, fireFrom: 0, strafe: 1, strafeUntil: 0, lastX: 0, lastY: 0, stuckAt: 0 },
  });
  return {
    players: { A: mk('A', ax, ay, aLevel), B: mk('B', bx, by, bLevel) },
    bullets: [], pads: [], fx: [],
    startedAt: Date.now(), endsAt: Date.now() + 60000, over: null,
  };
}

// A na zemi (0), B na věži (2), 200 px od sebe – tedy dobře v dosahu VIEW_R
const s = mkState(0, 2, 1600, 1300, 1600, 1100);

const viewA = arena.view(s, 'A');
const viewB = arena.view(s, 'B');

console.log('=== Viditelnost ===');
console.log('A je na patře 0, B na patře 2, vzdálenost 200 px (VIEW_R =', A.VIEW_R + ')');
console.log('  A vidí hráčů:', viewA.ps.length, '→', ok(viewA.ps.length === 0), '(výš postavený se nesmí posílat vůbec)');
console.log('  B vidí hráčů:', viewB.ps.length, '→', ok(viewB.ps.length === 1), '(dolů se vidět má)');
if (viewB.ps.length) console.log('  B vidí:', viewB.ps[0].uid, 'na patře', viewB.ps[0].lvl);

console.log('\n=== Střelba nahoru (nesmí zasáhnout) ===');
const s2 = mkState(0, 2, 1600, 1300, 1600, 1100);
const A0 = s2.players.A;
A0.aim = -Math.PI / 2;                     // míří přímo na B
arena.tryFire(s2, A0, Date.now(), { rng });
console.log('  A vystřelil střel:', s2.bullets.length, '| úroveň střely:', s2.bullets[0]?.lvl);
for (let i = 0; i < 20; i++) arena.stepBullets(s2, A.DT, Date.now());
console.log('  HP B po zásahu zdola:', s2.players.B.hp, '→', ok(s2.players.B.hp === A.HP));

console.log('\n=== Střelba dolů (zasáhnout musí) ===');
const s3 = mkState(0, 2, 1600, 1300, 1600, 1100);
const B2 = s3.players.B;
B2.aim = Math.PI / 2;                      // míří dolů na A
arena.tryFire(s3, B2, Date.now(), { rng });
for (let i = 0; i < 20; i++) arena.stepBullets(s3, A.DT, Date.now());
console.log('  HP A po zásahu shora:', s3.players.A.hp, '→', ok(s3.players.A.hp < A.HP));

console.log('\n=== Kratší dosah shora ===');
const s4 = mkState(0, 0, 100, 100, 3000, 2000);
const g = s4.players.A;                    // ze země
g.aim = 0;
arena.tryFire(s4, g, Date.now(), { rng });
const lifeZem = s4.bullets[0].life;

const s5 = mkState(2, 0, 1600, 1100, 3000, 2000);
const v = s5.players.A;                    // z věže
v.aim = 0;
arena.tryFire(s5, v, Date.now(), { rng });
const lifeVez = s5.bullets[0].life;

console.log('  dolet ze země:', lifeZem.toFixed(3), 's | z 2. patra:', lifeVez.toFixed(3), 's');
console.log('  poměr:', (lifeVez / lifeZem).toFixed(3), '| očekáváno', Math.pow(A.HIGH_RANGE, 2).toFixed(3),
  '→', ok(Math.abs(lifeVez / lifeZem - Math.pow(A.HIGH_RANGE, 2)) < 0.001));

console.log('\n=== Výbuch ignoruje patra (jinak by věž byla nedobytná) ===');
const s6 = mkState(0, 2, 1600, 1150, 1600, 1100);
arena.explode(s6, { owner: 'A', splashR: 200, splashDmg: 50 }, 1600, 1120, Date.now());
console.log('  HP B po výbuchu zdola:', s6.players.B.hp, '→', ok(s6.players.B.hp < A.HP));
