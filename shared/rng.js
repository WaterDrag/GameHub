// ─────────────────────────────────────────────────────────────
//  Deterministický RNG (mulberry32).
//
//  Proč ne Math.random(): server musí být jediným zdrojem náhody
//  (hody kostkou, spawny, loot). Se seedem navíc dokážeme kdykoliv
//  přehrát celý zápas z logu vstupů – k tomu se hodí i na klientu
//  pro predikci efektů, které nesmí "blikat".
// ─────────────────────────────────────────────────────────────
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (min, max) => min + Math.floor(rng() * (max - min + 1)); // včetně max
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.shuffle = (arr) => {
    const a2 = [...arr];
    for (let i = a2.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a2[i], a2[j]] = [a2[j], a2[i]];
    }
    return a2;
  };
  return rng;
}

export function randomSeed() {
  return (Math.random() * 0xFFFFFFFF) >>> 0;
}
