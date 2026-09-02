// ─────────────────────────────────────────────────────────────
//  Párty mód – série minihier v jedné místnosti.
//
//  Vybere se počet kol, pak už se nic nenastavuje: hub sám losuje
//  hry, sám je nastaví podle počtu hráčů a sám je spouští. Za výhru
//  je bod, po posledním kole vyhrává, kdo jich má nejvíc.
//
//  Které hry se smí losovat, si určuje každá hra sama příznakem
//  `party` a metodou `partyOptions(hracu, rng)` – hub o žádné
//  konkrétní volbě neví, stejně jako u obyčejné čekárny.
// ─────────────────────────────────────────────────────────────
import { GAMES } from './games/index.js';

export const KOLA_VOLBY = [3, 5, 7];
export const KOLA_DEF = 5;
export const PAUZA_MS = 7000;      // mezi koly – tak akorát na přečtení tabulky

// Hry vhodné pro daný počet hráčů (a pro to, jestli jsou v místnosti boti).
export function moznosti(hracu, sBoty) {
  return Object.values(GAMES).filter(g =>
    g.party && hracu >= g.minPlayers && hracu <= g.maxPlayers && (!sBoty || g.supportsBots)
  );
}

// Los pořadí. Nejdřív se protočí celá nabídka, teprve pak se opakuje –
// při pěti kolech a šesti hrách by čistý náhodný los dal dvakrát totéž
// zhruba v polovině partií.
export function losujPlan(hracu, sBoty, kola, rng) {
  const pool = moznosti(hracu, sBoty);
  if (!pool.length) return [];
  const plan = [];
  while (plan.length < kola) {
    const kolecko = rng.shuffle(pool.slice());
    // Na hraně dvou průchodů by jinak stejná hra vyšla dvakrát po sobě.
    if (pool.length > 1 && plan.length && kolecko[0].id === plan[plan.length - 1]) {
      [kolecko[0], kolecko[1]] = [kolecko[1], kolecko[0]];
    }
    for (const g of kolecko) {
      plan.push(g.id);
      if (plan.length >= kola) break;
    }
  }
  return plan;
}

// Tabulka bodů seřazená od nejlepšího. `remis` = nikdo bod nedostal.
export function tabulka(parta, hraci) {
  return hraci
    .map(p => ({ uid: p.uid, name: p.name, bot: p.bot, bodu: parta.body[p.uid] || 0 }))
    .sort((a, b) => b.bodu - a.bodu || a.name.localeCompare(b.name, 'cs'));
}

export function vitezove(parta, hraci) {
  const t = tabulka(parta, hraci);
  if (!t.length || !t[0].bodu) return [];
  return t.filter(x => x.bodu === t[0].bodu);
}
