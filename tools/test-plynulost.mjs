// Ověří, že se auto na obrazovce hýbe SPOJITĚ – i když predikce skáče
// po 33 ms krocích a server ji navíc opravuje.
//
// Simuluje se to, co dělá klient: predikce v pevných krocích, snapshoty
// 15× za sekundu s injektovanou odchylkou, a kreslení na 60/144 fps.
//
//   node tools/test-plynulost.mjs
import { R } from '../shared/games/racing/const.js';
import { applyInput, sledujCil } from '../shared/games/racing/sim.js';

const SMOOTH = 30;

// Jeden běh: vrátí kroky mezi snímky (px za snímek) pro daný způsob kreslení.
function bez(fps, opravaPx, primo) {
  const me = { x: 500, y: 1700, a: 0, vx: 0, vy: 0, offTrack: false, wet: false, boost: false };
  const vis = { x: me.x, y: me.y, a: me.a };
  const vstup = { gas: 1, steer: 0, drift: false };

  const dt = 1 / fps;
  const kroky = [];
  let acc = 0, cas = 0, dalsiSnapshot = 0.2, znamenko = 1;
  let px = me.x, py = me.y;

  for (let s = 0; s < fps * 3; s++) {
    cas += dt;

    // predikce v pevných krocích podle skutečného času (jako klient)
    acc += dt;
    while (acc >= R.DT) { acc -= R.DT; applyInput(me, vstup, R.DT); }

    // snapshot 15×/s: server posune pozici o `opravaPx` proti predikci
    // Oprava střídá znaménko, jinak by se auto rozjelo a skončilo
    // na mantinelu světa – a měřily by se nárazy, ne plynulost.
    if (cas >= dalsiSnapshot) {
      dalsiSnapshot += 1 / 15;
      me.x += opravaPx * znamenko;
      znamenko = -znamenko;
    }

    // co se nakreslí
    let dx, dy;
    if (primo) { dx = me.x - px; dy = me.y - py; px = me.x; py = me.y; }
    else {
      const cil = { x: me.x + me.vx * acc, y: me.y + me.vy * acc, a: me.a };
      sledujCil(vis, cil, SMOOTH, dt);
      dx = vis.x - px; dy = vis.y - py; px = vis.x; py = vis.y;
    }
    // Až po rozjezdu a před dojezdem k mantinelu.
    if (s > fps * 1.5) kroky.push(Math.hypot(dx, dy));
  }
  kroky.sort((a, b) => a - b);
  const q = (p) => kroky[Math.floor(kroky.length * p)] || 0;
  return { p05: q(0.05), median: q(0.5), p95: q(0.95), max: q(0.999),
           rozptyl: (q(0.95) || 1) / Math.max(0.01, q(0.05)) };
}

const vysledky = [];
const zkus = (popis, ok, detail) => vysledky.push({ popis, ok, detail });

for (const fps of [60, 144]) {
  const primo = bez(fps, 0, true);
  const filtr = bez(fps, 0, false);
  zkus(`${fps} fps: bez filtru se kreslí schody`,
    primo.rozptyl > 5,
    `krok ${primo.p05.toFixed(1)}–${primo.p95.toFixed(1)} px (rozptyl ${primo.rozptyl.toFixed(0)}×)`);
  zkus(`${fps} fps: s filtrem je pohyb rovnoměrný`,
    filtr.rozptyl < 1.5,
    `krok ${filtr.p05.toFixed(1)}–${filtr.p95.toFixed(1)} px (rozptyl ${filtr.rozptyl.toFixed(2)}×)`);
}

// Oprava od serveru se nesmí projevit skokem.
for (const oprava of [30, 120, 300]) {
  const primo = bez(60, oprava, true);
  const filtr = bez(60, oprava, false);
  zkus(`oprava ${oprava} px: bez filtru skok`,
    primo.max >= oprava,
    `největší krok ${primo.max.toFixed(0)} px`);
  // Normální pohyb při 60 fps je MAX_SPEED/60 ≈ 14,7 px na snímek. Oprava
  // ho nesmí přehlušit – typický snímek má zůstat kolem té hodnoty.
  const bezny = R.MAX_SPEED / 60;
  zkus(`oprava ${oprava} px: typický snímek zůstává plynulý`,
    filtr.median < bezny * 3.5,
    `medián ${filtr.median.toFixed(1)} px (běžný krok ${bezny.toFixed(1)})`);
  // U oprav, které už jsou víc než jeden snímek pohybu, musí filtr skok
  // výrazně srazit. (Scénář je záměrně extrémní: server se plete o tolik
  //  px 15× za sekundu; ve skutečné hře je odchylka řádově menší.)
  if (oprava >= 100) {
    zkus(`oprava ${oprava} px: filtr skok srazil`,
      filtr.max < primo.max * 0.55,
      `${primo.max.toFixed(0)} → ${filtr.max.toFixed(1)} px`);
  }
}

// Filtr nesmí zaostávat tak, aby auto „plavalo" za skutečnou pozicí.
{
  const me = { x: 500, y: 1700, a: 0, vx: R.MAX_SPEED, vy: 0, offTrack: false, wet: false, boost: false };
  const vis = { x: me.x, y: me.y, a: me.a };
  for (let i = 0; i < 240; i++) {
    me.x += R.MAX_SPEED / 60;
    sledujCil(vis, me, SMOOTH, 1 / 60);
  }
  const zpozdeni = me.x - vis.x;
  zkus('zpoždění vizuálu je malé',
    zpozdeni < 40,
    `${zpozdeni.toFixed(1)} px při ${R.MAX_SPEED} px/s (teorie v/λ = ${(R.MAX_SPEED / SMOOTH).toFixed(0)})`);
}

console.log('=== plynulost kreslení ===');
for (const v of vysledky) console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(44)} ${v.detail}`);
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
