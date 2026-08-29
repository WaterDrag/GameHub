// ─────────────────────────────────────────────────────────────
//  Závody – sdílená simulace.
//
//  Stejný kód běží na serveru (autorita) i v prohlížeči (predikce),
//  takže volant reaguje okamžitě a snapshot ho jen dorovná. Nesmí
//  tu být nic nedeterministického – žádné Math.random(), Date.now()
//  ani proměnlivý dt.
//
//  Trať je PARAMETR, ne konstanta: ve stavěném režimu ji hráči skládají
//  z dílků, takže každá místnost má vlastní. Všechno ostatní – povrch,
//  kontrolní body, rošt, cílová čára i stopa botů – se z ní odvodí
//  a nezajímá ho, kdo ji postavil.
// ─────────────────────────────────────────────────────────────
import { R, LINE, PUDDLE_R } from './const.js';
import { PASTI, postavTrat } from './dily.js';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ── Trať ─────────────────────────────────────────────────────
export const mkTrat = (body, uzavrena = false) => ({ body, uzavrena });

// Klasický pevný okruh (režim bez stavění).
export const KLASIK = mkTrat(LINE, true);

// Kolik úseků má trať: u uzavřené se poslední bod spojuje s prvním.
export const useku = (t) => (t.uzavrena ? t.body.length : t.body.length - 1);
export const konecUseku = (t, i) => t.body[(i + 1) % t.body.length];

// Nejkratší vzdálenost bodu od úsečky + kde na ní leží (t = 0..1).
export function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + dx * t, cy = a.y + dy * t;
  return { d: Math.hypot(px - cx, py - cy), t, cx, cy };
}

// Který úsek je nejblíž a jak daleko od jeho osy jsme.
export function nearestSeg(t, x, y) {
  let best = { d: Infinity, i: 0, t: 0 };
  const n = useku(t);
  for (let i = 0; i < n; i++) {
    const r = segDist(x, y, t.body[i], konecUseku(t, i));
    if (r.d < best.d) best = { d: r.d, i, t: r.t };
  }
  return best;
}

export const onTrack = (t, x, y) => nearestSeg(t, x, y).d <= R.HALF;

// Bod na trati posunutý napříč (off = -1 kraj vlevo, +1 kraj vpravo).
export function trackPoint(t, seg, tt, off) {
  const n = useku(t);
  const i = ((seg % n) + n) % n;
  const a = t.body[i], b = konecUseku(t, i);
  const cx = a.x + (b.x - a.x) * tt, cy = a.y + (b.y - a.y) * tt;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  return { x: cx + nx * off * R.HALF, y: cy + ny * off * R.HALF };
}

// ── Postavení na startu ──────────────────────────────────────
// Rozestup se počítá v PIXELECH po ose trati – když se bral jako podíl
// úseku, vyšlo mezi řadami 19 px, auta se při průměru 40 px překrývala
// a kolizní řešič je na startu rozmetl do trávy.
function zpetOd(t, odUseku, dist) {
  let i = odUseku, zbyva = dist;
  const n = useku(t);
  for (let k = 0; k < n; k++) {
    const a = t.body[i], b = konecUseku(t, i);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (zbyva <= len) return { seg: i, t: 1 - zbyva / len };
    zbyva -= len;
    i = (i - 1 + n) % n;
  }
  return { seg: 0, t: 0 };
}

// Posun po ose trati dopředu od začátku, taky v pixelech.
function vpredOd(t, dist) {
  const n = useku(t);
  let zbyva = dist;
  for (let i = 0; i < n; i++) {
    const a = t.body[i], b = konecUseku(t, i);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (zbyva <= len) return { seg: i, t: zbyva / len };
    zbyva -= len;
  }
  return { seg: n - 1, t: 0.9 };
}

// Posun po ose trati o `dist` pixelů dopředu z bodu (seg, tt).
// Boti si podle toho hledají stopu – v úsecích to počítat nejde, protože
// stavěná trať má úseky 170 px, kdežto klasický okruh přes 300.
export function poSume(t, seg, tt, dist) {
  const n = useku(t);
  let i = seg, zbyva = dist;
  let cur = tt;
  for (let k = 0; k < n + 1; k++) {
    const a = t.body[i], b = konecUseku(t, i);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const zbytekUseku = (1 - cur) * len;
    if (zbyva <= zbytekUseku) return { seg: i, t: cur + zbyva / len, konec: false };
    zbyva -= zbytekUseku;
    if (!t.uzavrena && i + 1 >= n) return { seg: n - 1, t: 1, konec: true };
    i = (i + 1) % n;
    cur = 0;
  }
  return { seg: i, t: 0.5, konec: false };
}

export function gridSlot(t, i) {
  const n = useku(t);
  const rada = Math.floor(i / 2);
  // Uzavřený okruh: stojí se PŘED bodem 0, tedy na posledním úseku.
  // Otevřená trať: na její úvodní rovince, taky s rozestupem v pixelech –
  // jako podíl úseku vycházely řady 27 px od sebe při průměru auta 40.
  const { seg, t: tt } = t.uzavrena
    ? zpetOd(t, n - 1, 70 + rada * 95)
    : vpredOd(t, 90 + rada * 95);
  const off = i % 2 === 0 ? -0.42 : 0.42;
  const p = trackPoint(t, seg, tt, off);
  const a = t.body[seg], b = konecUseku(t, seg);
  return { x: p.x, y: p.y, a: Math.atan2(b.y - a.y, b.x - a.x) };
}

// ── Cílová čára ──────────────────────────────────────────────
// Šachovnicový pás napříč tratí. Stojí kolmo na PRŮMĚR směrů před bodem
// a za ním – když se bral jen příjezdový úsek, ležel pás v ohybu šikmo
// a mezi čtverci zůstávaly díry.
// Vrací pole { rohy: [x,y, x,y, x,y, x,y], svetly: bool }.
export function finishBand(t, sloupcu = 11, rad = 2, vyska = 20) {
  const n = t.body.length;
  // Uzavřený okruh má cíl na startu, otevřená trať na svém konci.
  const idx = t.uzavrena ? 0 : n - 1;
  const pa = t.body[(idx - 1 + n) % n];
  const pb = t.body[idx];
  const u1 = Math.atan2(pb.y - pa.y, pb.x - pa.x);
  const u2 = t.uzavrena
    ? Math.atan2(t.body[(idx + 1) % n].y - pb.y, t.body[(idx + 1) % n].x - pb.x)
    : u1;
  const dir = Math.atan2((Math.sin(u1) + Math.sin(u2)) / 2, (Math.cos(u1) + Math.cos(u2)) / 2);
  const nx = Math.cos(dir + Math.PI / 2), ny = Math.sin(dir + Math.PI / 2);
  const fx = Math.cos(dir), fy = Math.sin(dir);
  const sirka = (R.HALF * 2) / sloupcu;

  const out = [];
  for (let r = 0; r < rad; r++) {
    for (let i = 0; i < sloupcu; i++) {
      const s0 = -R.HALF + i * sirka;
      const d0 = (r - rad / 2) * vyska;
      const rohy = [[s0, d0], [s0 + sirka, d0], [s0 + sirka, d0 + vyska], [s0, d0 + vyska]]
        .flatMap(([px, py]) => [pb.x + nx * px + fx * py, pb.y + ny * px + fy * py]);
      out.push({ rohy, svetly: (i + r) % 2 === 1 });
    }
  }
  return out;
}

// ── Jízdní model ─────────────────────────────────────────────
// Rychlost se rozkládá na podélnou (kam auto míří) a příčnou (smyk).
// Přilnavost maže tu příčnou – čím nižší, tím větší drift.
export function applyInput(p, input, dt) {
  const gas = clamp(input?.gas || 0, -1, 1);
  const steer = clamp(input?.steer || 0, -1, 1);
  const drift = !!input?.drift;

  const cs = Math.cos(p.a), sn = Math.sin(p.a);
  let vf = p.vx * cs + p.vy * sn;     // podélná
  let vs = -p.vx * sn + p.vy * cs;    // příčná (smyk)

  if (gas > 0) {
    vf += R.ACCEL * gas * dt;
  } else if (gas < 0) {
    // Dokud se auto žene vpřed, je to brzda; až když se zastaví, couvá.
    const sila = vf > 0 ? R.BRAKE : R.REVERSE;
    vf -= sila * (-gas) * dt;
  }

  const mimo = !!p.offTrack;
  const drag = mimo ? R.GRASS_DRAG : R.DRAG;
  let grip = mimo ? R.GRASS_GRIP : (drift ? R.DRIFT_GRIP : R.GRIP);
  if (p.wet) grip = Math.min(grip, R.PUDDLE_GRIP);
  if (p.olej) grip = Math.min(grip, R.OLEJ_GRIP);

  vf *= Math.exp(-drag * dt);
  vs *= Math.exp(-grip * dt);

  let max = R.MAX_SPEED * (p.boost ? R.BOOST_MUL : 1);
  if (mimo) max = Math.min(max, R.GRASS_MAX);
  if (vf > max) vf = max;
  if (vf < -R.MAX_REVERSE) vf = -R.MAX_REVERSE;

  // Zatáčení roste s rychlostí: stojící auto se neotáčí na místě.
  const podil = Math.min(1, Math.abs(vf) / R.TURN_REF);
  const ucin = R.TURN_SLOW + (1 - R.TURN_SLOW) * podil;
  p.a += steer * R.TURN * ucin * dt * (vf < 0 ? -1 : 1);
  if (p.a > Math.PI) p.a -= Math.PI * 2;
  if (p.a < -Math.PI) p.a += Math.PI * 2;

  const cs2 = Math.cos(p.a), sn2 = Math.sin(p.a);
  p.vx = vf * cs2 - vs * sn2;
  p.vy = vf * sn2 + vs * cs2;

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // Mantinel světa – ven se nedá vyjet, jen se odrazit.
  const m = R.CAR_R;
  if (p.x < m) { p.x = m; p.vx = Math.abs(p.vx) * R.BOUNCE; }
  if (p.x > R.W - m) { p.x = R.W - m; p.vx = -Math.abs(p.vx) * R.BOUNCE; }
  if (p.y < m) { p.y = m; p.vy = Math.abs(p.vy) * R.BOUNCE; }
  if (p.y > R.H - m) { p.y = R.H - m; p.vy = -Math.abs(p.vy) * R.BOUNCE; }

  p.drift = drift;
  return p;
}

// ── Povrch a pasti ───────────────────────────────────────────
// Pasti jsou pole { x, y, typ }. Server je pošle ve snapshotu, aby
// predikce klienta jela po stejném podkladu.
export function surfaceAt(t, x, y, pasti = []) {
  const s = nearestSeg(t, x, y);
  let wet = false, olej = false;
  for (const p of pasti) {
    const r = PASTI[p.typ]?.r || PUDDLE_R;
    if ((x - p.x) ** 2 + (y - p.y) ** 2 > r * r) continue;
    if (p.typ === 'kaluz') wet = true;
    else if (p.typ === 'olej') olej = true;
  }
  return { offTrack: s.d > R.HALF, wet, olej, seg: s.i, t: s.t };
}

export function vTurbu(x, y, pasti = []) {
  for (const p of pasti) {
    if (p.typ !== 'turbo') continue;
    const r = PASTI.turbo.r;
    if ((x - p.x) ** 2 + (y - p.y) ** 2 <= r * r) return true;
  }
  return false;
}

// ── Postup po trati ──────────────────────────────────────────
// Kontrolní body jsou body středové čáry a musí se projet POPOŘADĚ,
// takže zkratka přes trávu nic neušetří – bod prostě zůstane nesebraný.
export function checkProgress(t, p) {
  const n = t.body.length;
  if (!t.uzavrena && p.nextCp >= n) return false;     // otevřená trať: už v cíli
  const k = p.nextCp % n;
  const cp = t.body[k];

  // Stačí projet KOLEM bodu, ne přesně přes něj: bere se i konec úseku,
  // který k němu vede. S pouhým kruhem se dal bod ve venkovní stopě
  // zatáčky minout a auto pak muselo couvat, jinak se do cíle nedostalo.
  // Podmínka „konec úseku" drží ochranu proti zkratce: z dálky ji nesplníš.
  const vKruhu = (p.x - cp.x) ** 2 + (p.y - cp.y) ** 2 <= R.CP_R * R.CP_R;
  let naUseku = false;
  if (!vKruhu && (t.uzavrena || k > 0)) {
    const pred = t.body[(k - 1 + n) % n];
    const s = segDist(p.x, p.y, pred, cp);
    naUseku = s.d <= R.CP_R && s.t >= 0.75;
  }
  if (!vKruhu && !naUseku) return false;
  p.nextCp++;
  if (t.uzavrena) {
    if (p.nextCp >= n) { p.nextCp = 0; p.lap++; return true; }
    return false;
  }
  if (p.nextCp >= n) { p.lap++; return true; }        // poslední bod = cíl
  return false;
}

// Jak daleko je auto v závodě – pro pořadí.
export function progress(t, p) {
  const n = t.body.length;
  const s = nearestSeg(t, p.x, p.y);
  let cast = 0;
  if (s.i === p.nextCp - 1 || (t.uzavrena && p.nextCp === 0 && s.i === useku(t) - 1)) cast = s.t;
  return p.lap * n + p.nextCp + cast * 0.9;
}

// ── Vizuální dojíždění ───────────────────────────────────────
// Predikce se hýbe ve skocích 30× za sekundu a snapshot ji navíc opraví.
// Kreslit ji přímo znamená schody a při opravě skok. `vis` proto za cílem
// dojíždí exponenciálním filtrem, který běží každý snímek – výsledek je
// spojitý ze své podstaty. Zpoždění je v/lambda (při 880 px/s a λ=30
// zhruba 29 px), skok nastane jen při skutečném teleportu.
export function sledujCil(vis, cil, lambda, dt, skokNad = 400) {
  const d = Math.hypot(cil.x - vis.x, cil.y - vis.y);
  if (d > skokNad) {
    vis.x = cil.x; vis.y = cil.y; vis.a = cil.a;
    return { skok: true, posun: d };
  }
  const k = 1 - Math.exp(-lambda * dt);
  const px = vis.x, py = vis.y;
  vis.x += (cil.x - vis.x) * k;
  vis.y += (cil.y - vis.y) * k;
  let da = cil.a - vis.a;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  vis.a += da * k;
  return { skok: false, posun: Math.hypot(vis.x - px, vis.y - py) };
}

// ── Stavba: smí ten díl na tohle místo? ──────────────────────
// Tři pravidla: nesmí vyjet ze světa, nesmí křížit už postavenou trať
// a nesmí se k ní přimáčknout tak, že by nebylo poznat, kudy se jede.
// Server tím validuje tah, klient podle toho šedí nabídku.
function usecky(body) {
  const out = [];
  for (let i = 1; i < body.length; i++) out.push([body[i - 1], body[i]]);
  return out;
}

function krizi(a1, a2, b1, b2) {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

// `stare` = body dosavadní trati, `nove` = body přidávaného dílu
// (bez navazujícího bodu, ten už je poslední ve `stare`).
export function dilSedi(stare, nove) {
  const okraj = R.HALF + 60;
  for (const p of nove) {
    if (p.x < okraj || p.y < okraj || p.x > R.W - okraj || p.y > R.H - okraj) {
      return { ok: false, proc: 'vede ven ze světa' };
    }
  }
  const spoj = [stare[stare.length - 1], ...nove];
  const staU = usecky(stare), novU = usecky(spoj);
  for (let i = 0; i < staU.length - 1; i++) {          // poslední úsek navazuje
    for (const nu of novU) {
      if (krizi(staU[i][0], staU[i][1], nu[0], nu[1])) return { ok: false, proc: 'kříží trať' };
    }
  }
  // Odstup od starší trati, ať se dvě cesty nepřekrývají.
  const min = R.HALF * 1.5;
  for (let i = 0; i < stare.length - 3; i++) {
    for (const p of nove) {
      if (segDist(p.x, p.y, stare[i], stare[i + 1]).d < min) {
        return { ok: false, proc: 'moc blízko trati' };
      }
    }
  }
  return { ok: true };
}

// Postaví trať z řetězu dílů a zabalí ji pro zbytek kódu.
export function tratZRetezu(retez, start) {
  const r = postavTrat(retez, start);
  return { trat: mkTrat(r.body, false), kurzor: r.kurzor, konce: r.konce };
}

export function sanitizeInput(msg) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    seq: Math.max(0, Math.floor(n(msg?.seq))),
    gas: clamp(n(msg?.gas), -1, 1),
    steer: clamp(n(msg?.steer), -1, 1),
    drift: !!msg?.drift,
  };
}
