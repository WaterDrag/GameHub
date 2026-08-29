// Cílené zkoušky trati a povrchů – to, co závod mezi boty nezměří,
// protože boti z asfaltu nesjedou.
//
//   node tools/test-trat.mjs
import hra from '../server/games/racing.js';
import { R, LINE, BOOSTS, PUDDLES } from '../shared/games/racing/const.js';
import {
  applyInput, surfaceAt, nearestSeg, trackPoint, gridSlot, finishBand, useku, KLASIK,
} from '../shared/games/racing/sim.js';

// Klasický okruh – trať už není konstanta, chodí jako parametr.
const T = KLASIK;
const N = LINE.length;
// Pevná turba a kaluže klasiky jako seznam pastí (server je tvoří stejně).
const BOOST_PTS = BOOSTS.map(b => trackPoint(T, b.seg, 0.5, b.off));
const PUDDLE_PTS = PUDDLES.map(b => trackPoint(T, b.seg, 0.5, b.off));
const PASTI_LIST = [
  ...BOOST_PTS.map(p => ({ ...p, typ: 'turbo' })),
  ...PUDDLE_PTS.map(p => ({ ...p, typ: 'kaluz' })),
];
import { makeRng } from '../shared/rng.js';

let VIRT = Date.now();
Date.now = () => VIRT;

const auto = (x, y, a) => ({ x, y, a, vx: 0, vy: 0, lap: 0, nextCp: 0, offTrack: false, wet: false });

// Rozjezd na plný plyn s PEVNĚ nastaveným podkladem.
// (Dřív se podklad počítal z pozice – jenže auto jízdou rovně vyjelo ze
//  zatáčky do trávy a asfaltové měření skončilo taky na stropu trávy.)
// Start u levého okraje a jen 2 s: při delším rozjezdu auto dorazí na
// mantinel světa, odrazí se – a naměří se směšných 100 px/s místo stropu.
// S turbem dokonce ještě míně, protože je u zdi dřív.
function rozjezd(sek, { offTrack = false, wet = false, boost = false } = {}) {
  const X0 = 200;
  const p = auto(X0, 1700, 0);
  for (let i = 0; i < sek * R.TICK; i++) {
    p.offTrack = offTrack;
    p.wet = wet;
    p.boost = boost;
    applyInput(p, { gas: 1, steer: 0, drift: false }, R.DT);
  }
  return { drah: Math.abs(p.x - X0), v: Math.hypot(p.vx, p.vy), x: p.x };
}

const vysledky = [];
const zkus = (popis, ok, detail) => { vysledky.push({ popis, ok, detail }); };

// ── 1. asfalt vs tráva ───────────────────────────────
{
  const asfalt = rozjezd(2, { offTrack: false });
  const trava = rozjezd(2, { offTrack: true });
  zkus('asfalt dovede na plnou rychlost',
    asfalt.v > R.MAX_SPEED * 0.98,
    `${asfalt.v.toFixed(0)} px/s (strop ${R.MAX_SPEED})`);
  zkus('měření nedojelo na mantinel', asfalt.x < R.W - 200 && trava.x < R.W - 200,
    `konec na x=${asfalt.x.toFixed(0)} (svět ${R.W})`);
  zkus('tráva zpomaluje',
    trava.v < asfalt.v * 0.5,
    `asfalt ${asfalt.v.toFixed(0)} px/s / ${asfalt.drah.toFixed(0)} px, tráva ${trava.v.toFixed(0)} px/s / ${trava.drah.toFixed(0)} px`);
  zkus('na trávě platí strop GRASS_MAX',
    trava.v <= R.GRASS_MAX + 5,
    `${trava.v.toFixed(0)} ≤ ${R.GRASS_MAX}`);
}

// ── 1b. rozpoznání povrchu podle pozice ──────────────────
{
  const stred = trackPoint(T, 1, 0.5, 0);
  const kraj = trackPoint(T, 1, 0.5, 0.95);
  const a = LINE[1], b = LINE[2];
  const smer = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = Math.cos(smer + Math.PI / 2), ny = Math.sin(smer + Math.PI / 2);
  const venku = { x: stred.x + nx * 300, y: stred.y + ny * 300 };

  zkus('osa trati je asfalt', !surfaceAt(T, stred.x, stred.y).offTrack, 'stred → offTrack=false');
  zkus('kraj trati je ještě asfalt', !surfaceAt(T, kraj.x, kraj.y).offTrack, '95 % poloviční šířky');
  zkus('300 px stranou už je tráva', surfaceAt(T, venku.x, venku.y).offTrack, `HALF je ${R.HALF}`);
}

// ── 2. zkratka přes trávu kolo nezapočítá ────────────────────
{
  const rng = makeRng(4);
  const players = [{ uid: 'A', name: 'Podvodník', bot: false }];
  const state = hra.createState({ players, rng, options: { stavba: false } });
  state.startAt = Date.now() - 1;
  const c = state.cars.A;

  // Teleport rovnou před cíl, jako by se přejelo přes vnitřek okruhu.
  const cil = LINE[0];
  c.x = cil.x; c.y = cil.y;
  hra.tick(state, R.DT, { players: [] });
  const poPrvnim = { lap: c.lap, cp: c.nextCp };

  // Ještě jednou – projet bod 0 dokola bez ostatních kontrolních bodů.
  for (let k = 0; k < 5; k++) {
    c.x = cil.x + 5000; c.y = cil.y;      // pryč z dosahu
    hra.tick(state, R.DT, { players: [] });
    c.x = cil.x; c.y = cil.y;
    hra.tick(state, R.DT, { players: [] });
  }
  zkus('zkratka nepřidá kolo',
    c.lap === 0,
    `po 6 průjezdech cílem: kol ${c.lap}, další kontrolní bod ${c.nextCp} (sebral se jen bod 0)`);
  zkus('sebral se přesně jeden kontrolní bod',
    poPrvnim.cp === 1 && c.nextCp === 1,
    `nextCp ${c.nextCp}`);
}

// ── 3. poctivé kolo se započítá ──────────────────────────────
{
  const rng = makeRng(5);
  const state = hra.createState({ players: [{ uid: 'A', name: 'Poctivec', bot: false }], rng, options: { stavba: false } });
  state.startAt = Date.now() - 1;
  const c = state.cars.A;
  // Projeď všechny body popořadě.
  for (let i = 0; i < N; i++) {
    c.x = LINE[i].x; c.y = LINE[i].y;
    VIRT += 500;
    hra.tick(state, R.DT, { players: [] });
  }
  zkus('poctivý okruh = 1 kolo',
    c.lap === 1 && c.nextCp === 0,
    `kol ${c.lap}, nextCp ${c.nextCp}, nejlepší ${((c.best || 0) / 1000).toFixed(1)} s`);
}

// ── 4. turbo a kaluž ─────────────────────────────
{
  const bez = rozjezd(2, {});
  const turbo = rozjezd(2, { boost: true });
  zkus('turbo zvyšuje strop',
    turbo.v > bez.v * 1.4,
    `bez ${bez.v.toFixed(0)} px/s, s turbem ${turbo.v.toFixed(0)} px/s (čekáno ×${R.BOOST_MUL})`);

  // Turbo pole i kaluže musí ležet na asfaltu, jinak jsou k ničemu.
  const mimoTurbo = BOOST_PTS.filter(p => surfaceAt(T, p.x, p.y).offTrack).length;
  zkus('všechna turbo pole leží na trati', mimoTurbo === 0, `mimo: ${mimoTurbo}/${BOOST_PTS.length}`);
  const mimoKaluz = PUDDLE_PTS.filter(p => surfaceAt(T, p.x, p.y).offTrack).length;
  zkus('všechny kaluže leží na trati', mimoKaluz === 0, `mimo: ${mimoKaluz}/${PUDDLE_PTS.length}`);

  // Kaluž: auto s bočním smykem má na mokru delší skluz.
  const smyk = (wet) => {
    const p = auto(1200, 1700, 0);
    p.vx = 0; p.vy = 500;          // čistě boční rychlost
    p.wet = wet;
    for (let i = 0; i < R.TICK; i++) applyInput(p, { gas: 0, steer: 0, drift: false }, R.DT);
    return Math.abs(p.vy);
  };
  const sucho = smyk(false), mokro = smyk(true);
  zkus('kaluž bere přilnavost',
    mokro > sucho * 1.5,
    `zbytkový boční smyk po 1 s: sucho ${sucho.toFixed(1)}, mokro ${mokro.toFixed(1)} px/s`);
}

// ── 5. rošt stojí na trati a v pořadí ────────────────────────
{
  let vseNaTrati = true, detail = [];
  for (let i = 0; i < 6; i++) {
    const g = gridSlot(T, i);
    const d = nearestSeg(T, g.x, g.y).d;
    if (d > R.HALF) vseNaTrati = false;
    detail.push(d.toFixed(0));
  }
  zkus('všech 6 startovních pozic je na asfaltu',
    vseNaTrati,
    `vzdálenosti od osy: ${detail.join(', ')} (limit ${R.HALF})`);

  // Auta se na startu nesmí překrývat – kolizní řešič by je rozmetl do trávy.
  let nejmensi = Infinity;
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const a = gridSlot(T, i), b = gridSlot(T, j);
      nejmensi = Math.min(nejmensi, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  zkus('auta na startu se nedotýkají',
    nejmensi > R.CAR_R * 2 + 10,
    `nejmenší rozestup ${nejmensi.toFixed(0)} px, průměr auta ${R.CAR_R * 2} px`);

  // Kolem trati musí být dojezd, ne rovnou zeď světa.
  let nejtesnejsi = Infinity;
  for (const p of LINE) {
    nejtesnejsi = Math.min(nejtesnejsi, p.x, p.y, R.W - p.x, R.H - p.y);
  }
  zkus('kolem trati je dojezd',
    nejtesnejsi - R.HALF > 150,
    `nejtěsnější místo ${(nejtesnejsi - R.HALF).toFixed(0)} px od zdi světa`);
}

// ── 5b. cílová čára ──────────────────────────────────────────
{
  const pas = finishBand(T);
  // Každý čtverec musí ležet na asfaltu.
  let mimo = 0, minD = Infinity, maxD = 0;
  for (const q of pas) {
    for (let i = 0; i < q.rohy.length; i += 2) {
      const d = nearestSeg(T, q.rohy[i], q.rohy[i + 1]).d;
      minD = Math.min(minD, d); maxD = Math.max(maxD, d);
      if (d > R.HALF + 2) mimo++;
    }
  }
  zkus('cílová čára leží na trati', mimo === 0,
    `${pas.length} čtverců, rohy ${minD.toFixed(0)}–${maxD.toFixed(0)} px od osy (limit ${R.HALF})`);

  // Sousedé v řadě se musí dotýkat – žádné díry.
  const rada = pas.slice(0, 11);
  let mezera = 0;
  for (let i = 1; i < rada.length; i++) {
    // pravý horní roh předchozího vs levý horní roh dalšího
    const dx = rada[i].rohy[0] - rada[i - 1].rohy[2];
    const dy = rada[i].rohy[1] - rada[i - 1].rohy[3];
    mezera = Math.max(mezera, Math.hypot(dx, dy));
  }
  zkus('čtverce na sebe navazují', mezera < 0.5, `největší mezera ${mezera.toFixed(3)} px`);

  // Pás musí být kolmý na trať: spojnice krajů kolmá na směr jízdy.
  const prvni = pas[0], posledni = rada[rada.length - 1];
  const sx = posledni.rohy[2] - prvni.rohy[0], sy = posledni.rohy[3] - prvni.rohy[1];
  const a0 = LINE[N - 1], b0 = LINE[0], c0 = LINE[1];
  const u1 = Math.atan2(b0.y - a0.y, b0.x - a0.x), u2 = Math.atan2(c0.y - b0.y, c0.x - b0.x);
  const dir = Math.atan2((Math.sin(u1) + Math.sin(u2)) / 2, (Math.cos(u1) + Math.cos(u2)) / 2);
  const skalar = Math.abs(Math.cos(dir) * sx + Math.sin(dir) * sy) / Math.hypot(sx, sy);
  zkus('pás stojí kolmo na trať', skalar < 0.02, `odchylka od kolmice ${(Math.asin(skalar) * 180 / Math.PI).toFixed(2)}°`);
}

// ── 6. trať se nekříží sama se sebou ─────────────────────────
{
  const prusecik = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
  };
  let krizi = null;
  for (let i = 0; i < N && !krizi; i++) {
    for (let j = i + 2; j < N; j++) {
      if (i === 0 && j === N - 1) continue;        // sousedé přes uzávěr
      if (prusecik(LINE[i], LINE[(i + 1) % N], LINE[j], LINE[(j + 1) % N])) { krizi = `${i}×${j}`; break; }
    }
  }
  zkus('okruh se nekříží', !krizi, krizi ? `kříží se úseky ${krizi}` : `${N} úseků bez průsečíku`);
}

// ── výpis ────────────────────────────────────────────────────
console.log('=== trať a povrchy ===');
for (const v of vysledky) {
  console.log(`  ${v.ok ? '✓' : '✗'} ${v.popis.padEnd(38)} ${v.detail}`);
}
const spatne = vysledky.filter(v => !v.ok).length;
console.log(spatne ? `\n✗ ${spatne} z ${vysledky.length} neprošlo` : `\n✓ všech ${vysledky.length} prošlo`);
process.exit(spatne ? 1 : 0);
