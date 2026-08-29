// Jak těžké je trefit uhýbající cíl, když míříš přímo na něj
// (tak, jak to dělá člověk) místo dokonalého předsazení jako bot.
import { A, WEAPONS } from '../shared/games/arena/const.js';

const W = WEAPONS.blaster;
const okno = A.PLAYER_R + W.r;          // o kolik smí střela minout střed

console.log('=== Jak daleko se dá trefit BEZ předsazení ===');
console.log(`hitbox: poloměr hráče ${A.PLAYER_R} + střela ${W.r} = ${okno} px\n`);
console.log('rychlost střely   dolet za 0,5 s   trefíš přímým mířením do');
for (const v of [W.speed, 1300, 1700, 2200]) {
  // cíl uhýbá kolmo max rychlostí; za dobu letu se posune o v_cile * t
  // minutí = MAX_SPEED * D / v  →  trefa, dokud je to menší než okno
  const dosah = okno * v / A.MAX_SPEED;
  const znak = v === W.speed ? ' (teď)' : '';
  console.log(`  ${String(v).padStart(4)} px/s${znak.padEnd(7)}  ${Math.round(v * 0.5)} px`.padEnd(42) + `${dosah.toFixed(0)} px`);
}

console.log('\n=== O kolik se musí předsadit (v šířkách hráče) ===');
console.log('vzdálenost   ' + [W.speed, 1300, 1700, 2200].map(v => (v + ' px/s').padStart(10)).join(''));
for (const D of [200, 400, 600, 800, 1000]) {
  const rada = [W.speed, 1300, 1700, 2200].map(v => {
    const posun = A.MAX_SPEED * (D / v);
    return (posun / (A.PLAYER_R * 2)).toFixed(1) + '×';
  }).map(s => s.padStart(10)).join('');
  console.log(`  ${String(D).padStart(4)} px   ` + rada);
}

console.log('\n=== Doba letu ===');
console.log('vzdálenost   ' + [W.speed, 1300, 1700, 2200].map(v => (v + ' px/s').padStart(10)).join(''));
for (const D of [200, 400, 600, 800]) {
  const rada = [W.speed, 1300, 1700, 2200]
    .map(v => (D / v * 1000).toFixed(0) + ' ms').map(s => s.padStart(10)).join('');
  console.log(`  ${String(D).padStart(4)} px   ` + rada);
}
