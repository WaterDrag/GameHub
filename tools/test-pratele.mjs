// ─────────────────────────────────────────────────────────────
//  Přátelé – přes opravdové WebSockety proti běžícímu serveru.
//
//  Hosté dostávají uid z device tokenu, takže si tu jeden vyrobíme
//  a znovu použijeme – tím se testuje i to, že kamarádství přežije
//  odpojení a návrat.
//
//  Server pusť s vlastním souborem, ať ti test nezaplevelí ostrá data:
//    GH_PRATELE=%TEMP%\pratele-test.json node server/index.js
// ─────────────────────────────────────────────────────────────
import { WebSocket } from 'ws';

const URL = process.env.HUB || 'ws://localhost:3000';
const spi = (ms) => new Promise(r => setTimeout(r, ms));
let chyb = 0;
const ok = (podm, popis) => { if (!podm) chyb++; console.log(`${podm ? '  ok ' : '  !! '} ${popis}`); };

class Klient {
  constructor(jmeno, token = null) { this.jmeno = jmeno; this.token = token; this.zpravy = []; }
  async pripoj() {
    this.ws = new WebSocket(URL);
    await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      this.zpravy.push(m);
      if (m.t === 'welcome') { this.uid = m.uid; this.token = m.deviceToken || this.token; }
      if (m.t === 'friends') this.pratele = m;
      if (m.t === 'rooms') this.rooms = m.list;
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'left') this.room = null;
    });
    this.posli('hello', { name: this.jmeno, token: this.token });
    await this.cekej(m => m.t === 'welcome');
    return this;
  }
  posli(t, d = {}) { this.ws.send(JSON.stringify({ t, ...d })); }
  async cekej(fn, ms = 1500) {
    const konec = Date.now() + ms;
    while (Date.now() < konec) { const m = this.zpravy.find(fn); if (m) return m; await spi(20); }
    return null;
  }
  posledni(t) { return [...this.zpravy].reverse().find(m => m.t === t) || null; }
  zavri() { this.ws.close(); }
}

const vsichni = [];
async function novy(jmeno, token = null) { const k = await new Klient(jmeno, token).pripoj(); vsichni.push(k); return k; }

console.log('\n── Přátelé ───────────────────────────────────────\n');

const a = await novy('Alfa');
const b = await novy('Beta');
await spi(200);

ok(!!a.pratele?.kod, `kód přátel přišel sám po přihlášení (${a.pratele?.kod})`);
ok(a.pratele.kod !== b.pratele.kod, 'každý má jiný');

// 1. Žádost a přijetí
a.posli('friendAdd', { kod: b.pratele.kod });
await spi(250);
ok(b.pratele.zadosti.length === 1, 'druhému přišla žádost hned, bez refreshe');
ok(a.pratele.pratele.length === 0, 'žadatel kamaráda ještě nemá');

b.posli('friendAccept', { uid: a.uid });
await spi(250);
ok(a.pratele.pratele.length === 1 && b.pratele.pratele.length === 1, 'po přijetí jsou kamarády oba');
ok(a.pratele.pratele[0].online === true, 'a vidí se online');

// 2. Nesmysly
a.zpravy.length = 0;
a.posli('friendAdd', { kod: 'ZZZZZZ' });
await spi(150);
ok(a.posledni('error') && !a.posledni('error').ok, 'neexistující kód odmítne');
a.zpravy.length = 0;
a.posli('friendAdd', { kod: a.pratele.kod });
await spi(150);
ok(a.posledni('error') && !a.posledni('error').ok, 'sám sebe si nepřidá');

// 3. Vidím, kde kamarád je
b.posli('create', { gameId: 'clovece', visibility: 'public', maxPlayers: 4 });
await b.cekej(m => m.t === 'room');
await spi(300);
a.posli('friends');
await spi(250);
ok(a.pratele.pratele[0].kde?.code === b.room.code, 'kamarádova místnost je vidět v seznamu');

// 4. Místnost „jen přátelé“
b.posli('leave'); await spi(200);
b.zpravy.length = 0;
b.posli('create', { gameId: 'clovece', visibility: 'pratele', maxPlayers: 4 });
await b.cekej(m => m.t === 'room');
await spi(400);
const kodM = b.room.code;
ok(b.room.visibility === 'pratele', 'místnost se založila jako „jen přátelé“');

a.posli('list'); await spi(350);
const uA = a.rooms.find(r => r.code === kodM);
ok(!!uA, 'kamarád ji v seznamu vidí');
ok(uA?.pratele === true && uA?.jenPratele === true, 'a je označená jako kamarádská');
ok(a.rooms[0]?.code === kodM, 'a je připnutá nahoře');

const cizi = await novy('Cizinec');
cizi.posli('list'); await spi(350);
ok(!cizi.rooms.some(r => r.code === kodM), 'cizí ji v seznamu nevidí');

// Na kód se tam ale dostane – „jen přátelé“ je o seznamu, ne o zámku.
cizi.posli('join', { code: kodM });
await spi(250);
ok(cizi.room?.code === kodM, 'na přímý kód se tam dostane i cizí');

// 5. Kamarádství přežije odpojení i restart identity
const tokenA = a.token;
a.zavri();
await spi(300);
ok(b.pratele.pratele[0].online === false, 'odpojený kamarád je offline');

const a2 = await novy('Alfa2', tokenA);
await spi(300);
ok(a2.uid === a.uid, 'stejný device token = stejné uid');
ok(a2.pratele.pratele.length === 1, 'a kamarády má pořád');
ok(b.pratele.pratele[0].online === true, 'druhému naskočil zpátky jako online');

// 6. Odebrání je oboustranné
a2.posli('friendRemove', { uid: b.uid });
await spi(300);
ok(a2.pratele.pratele.length === 0 && b.pratele.pratele.length === 0, 'odebrání platí pro oba');

for (const k of vsichni) k.zavri();
console.log(`\n${chyb ? `!! ${chyb} chyb` : 'Všechno sedí.'}\n`);
process.exit(chyb ? 1 : 0);
