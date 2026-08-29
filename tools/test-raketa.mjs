// Ověří, že zaměřená raketa vybuchne přesně tam, kam mířil kurzor,
// a že se přes aimD nedá dostřelit dál ani si odpálit raketu v ruce.
import arena from '../server/games/arena.js';
import { A, WEAPONS } from '../shared/games/arena/const.js';
import { makeRng } from '../shared/rng.js';

const rng = makeRng(5);
const W = WEAPONS.rocket;
const ok = (b) => (b ? '✓' : '✗ CHYBA');

function stav() {
  const mk = (uid, x, y) => ({
    uid, name: uid, bot: false, x, y, vx: 0, vy: 0, aim: 0, spd: 1, level: 0,
    hp: A.HP, alive: true, respawnAt: 0, weapon: 'rocket', ammo: 4, fireAt: 0, reloadAt: 0,
    buffs: {}, frags: 0, deaths: 0, queue: [], last: null, ack: 0, aimD: 0,
    ai: { targetUid: null, nextPick: 0, fireFrom: 0, strafe: 1, strafeUntil: 0, lastX: 0, lastY: 0, stuckAt: 0, goalAt: 0, goalPad: null },
  });
  return {
    players: { A: mk('A', 200, 600) }, bullets: [], pads: [], fx: [],
    events: { flood: false, meteors: false, storm: false },
    flood: { stage: 0, nextAt: 1e15 }, meteors: [], bolts: [], stormAt: 1e15, meteorAt: 1e15,
    startedAt: Date.now(), endsAt: Date.now() + 6e5, fragLimit: 99, over: null,
  };
}

// vystřelí doprava se zadanou vzdáleností k zaměřovači a vrátí bod výbuchu
function vystrel(aimD) {
  const s = stav();
  const p = s.players.A;
  p.aim = 0;
  p.aimD = aimD;
  arena.tryFire(s, p, Date.now(), { rng });
  const start = p.x;
  let boom = null;
  for (let i = 0; i < 300 && !boom; i++) {
    arena.stepBullets(s, A.DT, Date.now());
    const f = s.fx.find(f => f.k === 'boom');
    if (f) boom = f;
    s.fx.length = 0;
  }
  return boom ? Math.round(boom.x - start) : null;
}

console.log(`raketa: minFuse ${W.minFuse}, maxFuse ${W.maxFuse}, dolet bez zaměření ${Math.round(W.speed * W.life)}\n`);
for (const chtel of [150, 400, 800, 1200]) {
  const skutecne = vystrel(chtel);
  const chyba = Math.abs(skutecne - chtel);
  console.log(`  kurzor ${String(chtel).padStart(5)} px → výbuch na ${String(skutecne).padStart(5)} px   odchylka ${String(chyba).padStart(3)} px  ${ok(chyba <= 25)}`);
}
console.log('\npokusy o zneužití:');
const daleko = vystrel(9999);
console.log(`  aimD 9999 → výbuch na ${daleko} px  ${ok(daleko <= W.maxFuse + 30)} (strop ${W.maxFuse})`);
const blizko = vystrel(5);
console.log(`  aimD 5    → výbuch na ${blizko} px  ${ok(blizko >= W.minFuse - 30)} (minimum ${W.minFuse})`);
