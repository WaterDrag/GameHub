// ─────────────────────────────────────────────────────────────
//  Párty mód – celá série proti běžícímu serveru.
//
//  Hráči jsou boti, takže hry doopravdy doběhnou samy; test jen
//  sedí a kouká, jestli místnost sama losuje, přepíná hry, počítá
//  body a nakonec vyhlásí. Trvá to minuty – to je cena za to, že
//  se testuje skutečný běh, ne jen volání metody.
//
//  Spusť server a pak `node tools/test-party-mod.mjs`.
// ─────────────────────────────────────────────────────────────
import { WebSocket } from 'ws';
import { GAMES } from '../server/games/index.js';
import { moznosti, losujPlan } from '../server/party-mod.js';
import { makeRng } from '../shared/rng.js';

const URL = process.env.HUB || 'ws://localhost:3000';
const spi = (ms) => new Promise(r => setTimeout(r, ms));
let chyb = 0;
const ok = (podm, popis) => { if (!podm) chyb++; console.log(`${podm ? '  ok ' : '  !! '} ${popis}`); };

class Klient {
  constructor(jmeno) { this.jmeno = jmeno; this.zpravy = []; this.kola = []; }
  async pripoj() {
    this.ws = new WebSocket(URL);
    await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      this.zpravy.push(m);
      if (m.t === 'welcome') this.uid = m.uid;
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'partyKolo') this.kola.push(m);
      if (m.t === 'over') this.konce = [...(this.konce || []), m];
    });
    this.posli('hello', { name: this.jmeno });
    await this.cekej(m => m.t === 'welcome');
    return this;
  }
  posli(t, d = {}) { this.ws.send(JSON.stringify({ t, ...d })); }
  async cekej(fn, ms = 2000) {
    const konec = Date.now() + ms;
    while (Date.now() < konec) { const m = this.zpravy.find(fn); if (m) return m; await spi(30); }
    return null;
  }
  posledni(t) { return [...this.zpravy].reverse().find(m => m.t === t) || null; }
  zavri() { this.ws.close(); }
}

console.log('\n── Párty mód ─────────────────────────────────────\n');

// 1. Los plánu (čistá funkce – rychlé a bez serveru)
{
  const rng = makeRng(11);
  const plan = losujPlan(4, true, 5, rng);
  ok(plan.length === 5, 'plán má tolik her, kolik je kol');
  ok(plan.every(id => GAMES[id]?.party), 'a všechny jsou označené jako minihry');
  ok(plan.every(id => GAMES[id].supportsBots), 's boty se losují jen hry, které boty umí');
  let opak = 0;
  for (let seed = 0; seed < 300; seed++) {
    const p = losujPlan(4, false, 5, makeRng(seed));
    for (let i = 1; i < p.length; i++) if (p[i] === p[i - 1]) opak++;
  }
  ok(opak === 0, `stejná hra nikdy dvakrát po sobě (${opak} z 1200)`);
  ok(moznosti(8, false).every(g => g.maxPlayers >= 8), 'pro osm hráčů se nabízí jen hry pro osm');
  ok(moznosti(2, false).some(g => g.id === 'gomoku'), 'dvouhry (piškvorky) jsou v nabídce jen ve dvou');
  ok(!moznosti(3, false).some(g => g.id === 'gomoku'), 'a ve třech už ne');
  ok(!moznosti(4, false).some(g => g.id === 'katan'), 'dlouhé hry (Katan) v párty módu nejsou');
}

// 2. Auto-nastavení
{
  const rng = makeRng(3);
  const c = GAMES.clovece.partyOptions(6, rng);
  ok(c.mapa === 'velka', 'člověče: šest hráčů = velká deska');
  ok(GAMES.clovece.partyOptions(3, rng).mapa === 'mala', 'a tři hráči = malá');
  ok(c.figurek <= 3, `člověče: málo figurek kvůli délce (${c.figurek})`);
  const mods = Object.keys(c).filter(k => c[k] === true);
  ok(mods.length === 1, `a přesně jeden náhodný mód (${mods.join(',') || 'žádný'})`);
  const g = GAMES.gomoku.partyOptions(2, rng);
  ok(['male', 'klasika', 'ultimate'].includes(g.rezim), `piškvorky: náhodný režim (${g.rezim})`);
}

// 3. Ostrý běh: hostitel + 3 boti, 3 kola
const h = await new Klient('Hostitel').pripoj();
h.posli('create', { gameId: 'clovece', visibility: 'private', maxPlayers: 4 });
await h.cekej(m => m.t === 'room');
for (let i = 0; i < 3; i++) h.posli('addBot', { difficulty: 'normal' });
await spi(500);
ok(h.room.players.length === 4, `v místnosti jsou 4 hráči (${h.room?.players.length})`);

h.zpravy.length = 0;
h.posli('partyMod', { kola: 3 });
await h.cekej(m => m.t === 'partyKolo', 3000);
ok(h.kola.length === 1, 'párty mód se rozjel a ohlásil první kolo');
ok(h.room?.parta?.kola === 3, 'místnost ví, kolik kol se hraje');

// Doběhnutí – tři minihry s boty chvíli trvají.
const zacatek = Date.now();
const limit = 12 * 60 * 1000;
let hotovo = null;
while (Date.now() - zacatek < limit) {
  hotovo = (h.konce || []).find(m => m.parta?.hotovo);
  if (hotovo) break;
  await spi(1000);
}

ok(!!hotovo, `párty doběhla (${Math.round((Date.now() - zacatek) / 1000)} s)`);
if (hotovo) {
  ok(h.kola.length === 3, `odehrála se všechna tři kola (${h.kola.length})`);
  const hry = h.kola.map(k => k.gameId);
  ok(new Set(hry).size === hry.length, `a pokaždé jiná hra (${hry.join(', ')})`);
  const t = hotovo.parta.tabulka;
  ok(t.length === 4, 'tabulka má všechny hráče');
  const soucet = t.reduce((a, x) => a + x.bodu, 0);
  ok(soucet <= 3 && soucet >= 1, `bodů je nejvýš tolik co kol (${soucet} za 3 kola)`);
  ok(t[0].bodu >= t[t.length - 1].bodu, 'tabulka je seřazená od nejlepšího');
  ok(hotovo.parta.vitezove.length >= 1, 'a někdo vyhrál');
  const vysledky = (h.konce || []).map(m => (m.result.draw ? 'remíza' : 'výhra'));
  console.log(`     kola: ${h.kola.map((k, i) => `${k.title} (${vysledky[i] || '?'})`).join(' · ')}`);
  await spi(hotovo.parta.pauza + 1500);   // vyhlášení chvíli visí, teprve pak se zavírá
  ok(h.room?.status === 'lobby', 'po vyhlášení se místnost vrátila do čekárny');
  ok(!h.room?.parta, 'a párty mód je zavřený');
}

h.zavri();
console.log(`\n${chyb ? `!! ${chyb} chyb` : 'Všechno sedí.'}\n`);
process.exit(chyb ? 1 : 0);
