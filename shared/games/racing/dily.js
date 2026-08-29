// ─────────────────────────────────────────────────────────────
//  Závody – stavební dílky trati.
//
//  Díl je popsaný v LOKÁLNÍCH souřadnicích: začíná v (0,0) se směrem
//  +x a končí někde jinde s jiným směrem. Trať se pak skládá tak, že
//  se každý další díl přicvakne na volný konec toho předchozího –
//  jako autodráha. Nesjízdná trať tím pádem nevznikne.
//
//  Ze složeného řetězu se dopočítá středová čára a všechno ostatní
//  (kresba, povrch, kontrolní body, stopa botů) z ní žije dál beze změny.
// ─────────────────────────────────────────────────────────────

// Rozestup bodů na středové čáře. Musí být větší než dosah kontrolního
// bodu (CP_R), aby se body nepřekrývaly, a zároveň dost malý, aby oblouk
// nevypadal jako mnohoúhelník.
const KROK = 170;
// Navíc strop na úhel mezi body: vlásenka vzorkovaná jen podle délky
// vyšla na dva body, tedy trojúhelník místo zatáčky.
const MAX_UHEL = Math.PI / 6;

export const DILY = {
  rovinka: { name: 'Rovinka', emoji: '▬', rovne: 320 },
  dlouha:  { name: 'Dlouhá rovinka', emoji: '▬▬', rovne: 640 },
  zatL:    { name: 'Zatáčka vlevo', emoji: '↰', oblouk: { r: 300, uhel: -Math.PI / 2 } },
  zatP:    { name: 'Zatáčka vpravo', emoji: '↱', oblouk: { r: 300, uhel: Math.PI / 2 } },
  mirnaL:  { name: 'Mírně vlevo', emoji: '↖', oblouk: { r: 520, uhel: -Math.PI / 4 } },
  mirnaP:  { name: 'Mírně vpravo', emoji: '↗', oblouk: { r: 520, uhel: Math.PI / 4 } },
  vlasenka: { name: 'Vlásenka', emoji: '⮌', oblouk: { r: 200, uhel: Math.PI } },
  vlasenkaL: { name: 'Vlásenka vlevo', emoji: '⮎', oblouk: { r: 200, uhel: -Math.PI } },
};

export const DILY_IDS = Object.keys(DILY);

// Body dílu v lokálních souřadnicích + kam a jak natočený končí.
export function tvarDilu(id) {
  const d = DILY[id];
  if (!d) return { body: [], konec: { x: 0, y: 0, a: 0 } };

  if (d.rovne) {
    const kusu = Math.max(1, Math.round(d.rovne / KROK));
    const body = [];
    for (let i = 1; i <= kusu; i++) body.push({ x: (d.rovne * i) / kusu, y: 0 });
    return { body, konec: { x: d.rovne, y: 0, a: 0 } };
  }

  // Oblouk začíná v (0,0) se směrem +x, střed má kolmo na směr jízdy.
  const { r, uhel } = d.oblouk;
  const znak = Math.sign(uhel);
  const sx = 0, sy = znak * r;                    // střed otáčení
  const delka = Math.abs(uhel) * r;
  const kusu = Math.max(2, Math.round(delka / KROK), Math.ceil(Math.abs(uhel) / MAX_UHEL));
  const body = [];
  for (let i = 1; i <= kusu; i++) {
    const u = (uhel * i) / kusu;
    body.push({
      x: sx + Math.sin(Math.abs(u)) * r * 1,
      y: sy - znak * Math.cos(u) * r,
    });
  }
  const posl = body[body.length - 1];
  return { body, konec: { x: posl.x, y: posl.y, a: uhel } };
}

// Přicvakne díl na kurzor (pozice + směr) a vrátí body ve světě
// i nový kurzor pro další díl.
export function polozDil(id, kurzor) {
  const { body, konec } = tvarDilu(id);
  const cs = Math.cos(kurzor.a), sn = Math.sin(kurzor.a);
  const doSveta = (p) => ({
    x: kurzor.x + p.x * cs - p.y * sn,
    y: kurzor.y + p.x * sn + p.y * cs,
  });
  const svet = body.map(doSveta);
  const k = doSveta(konec);
  return { body: svet, kurzor: { x: k.x, y: k.y, a: kurzor.a + konec.a } };
}

// Postaví celou trať z řetězu dílů. Vrací body středové čáry
// a kurzor volného konce, kam půjde přicvaknout další díl.
export function postavTrat(retez, start) {
  const body = [{ x: start.x, y: start.y }];
  let kurzor = { ...start };
  const konce = [{ ...start }];
  for (const id of retez) {
    const r = polozDil(id, kurzor);
    body.push(...r.body);
    kurzor = r.kurzor;
    konce.push({ ...kurzor });
  }
  return { body, kurzor, konce };
}

// ── Pasti a turba ────────────────────────────────────────────
export const PASTI = {
  turbo: { name: 'Turbo', emoji: '⚡', r: 62, barva: '#35c8ff' },
  kaluz: { name: 'Kaluž', emoji: '💧', r: 96, barva: '#2b6cb0' },
  olej:  { name: 'Olej',  emoji: '🛢️', r: 78, barva: '#1a1a22' },
};
export const PASTI_IDS = Object.keys(PASTI);
