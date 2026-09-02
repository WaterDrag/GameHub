// ─────────────────────────────────────────────────────────────
//  Parta – test proti BĚŽÍCÍMU serveru přes opravdové WebSockety.
//
//  Ostatní testy volají čisté funkce, tohle ne: parta žije v
//  index.js mezi spojeními, a chyby v ní jsou právě v tom, kdo
//  co dostane. Takže se to musí protáhnout celým protokolem.
//
//  Spusť server (`node server/index.js`) a pak `node tools/test-parta.mjs`.
// ─────────────────────────────────────────────────────────────
import { WebSocket } from 'ws';
import { PartyManager, PRAZDNA_MS } from '../server/party.js';

const URL = process.env.HUB || 'ws://localhost:3000';
const spi = (ms) => new Promise(r => setTimeout(r, ms));

let chyb = 0;
const ok = (podm, popis) => {
  if (!podm) chyb++;
  console.log(`${podm ? '  ok ' : '  !! '} ${popis}`);
};

class Klient {
  constructor(jmeno) {
    this.jmeno = jmeno;
    this.zpravy = [];
    this.party = undefined;
    this.room = null;
  }
  async pripoj() {
    this.ws = new WebSocket(URL);
    await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      this.zpravy.push(m);
      if (m.t === 'welcome') this.uid = m.uid;
      if (m.t === 'party') this.party = m.party;
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'left') this.room = null;
    });
    this.posli('hello', { name: this.jmeno });
    await this.cekej(m => m.t === 'welcome');
    return this;
  }
  posli(t, data = {}) { this.ws.send(JSON.stringify({ t, ...data })); }
  async cekej(fn, ms = 1500) {
    const konec = Date.now() + ms;
    while (Date.now() < konec) {
      const m = this.zpravy.find(fn);
      if (m) return m;
      await spi(20);
    }
    return null;
  }
  posledni(t) { return [...this.zpravy].reverse().find(m => m.t === t) || null; }
  zavri() { this.ws.close(); }
}

const vsichni = [];
async function novy(jmeno) { const k = await new Klient(jmeno).pripoj(); vsichni.push(k); return k; }

console.log('\n── Parta ─────────────────────────────────────────\n');

const a = await novy('Alfa');
const b = await novy('Beta');
const c = await novy('Gama');

// 1. Založení a připojení
a.posli('partyNew');
await a.cekej(m => m.t === 'party' && m.party);
const kod = a.party.kod;
ok(!!kod, `vůdce založil partu (kód ${kod})`);
ok(a.party.vudce === a.uid, 'zakladatel je vůdce');

b.posli('partyJoin', { kod });
await b.cekej(m => m.t === 'party' && m.party);
await spi(120);
ok(b.party?.kod === kod, 'druhý se připojil kódem');
ok(a.party.clenove.length === 2, `vůdci přišel update se 2 členy (${a.party.clenove.length})`);

c.posli('partyJoin', { kod: kod.toLowerCase() });
await spi(150);
ok(c.party?.clenove.length === 3, 'kód funguje i malými písmeny');

// 2. Neexistující kód nesmí projít
c.zpravy.length = 0;
c.posli('partyJoin', { kod: 'XXXXX' });
const err = await c.cekej(m => m.t === 'error');
ok(!!err, 'neexistující kód vrátí chybu');
ok(c.party?.kod === kod, 'a nevyhodí z původní party');

// 3. Natažení do místnosti
a.posli('create', { gameId: 'clovece', visibility: 'private', maxPlayers: 4 });
const r = await a.cekej(m => m.t === 'room');
ok(!!r, 'vůdce založil místnost');
const mkod = a.room.code;

a.posli('partyPull');
await spi(400);
ok(b.room?.code === mkod, 'druhého to natáhlo do místnosti vůdce');
ok(c.room?.code === mkod, 'třetího taky');
ok(a.room.players.length === 3, `v místnosti jsou 3 hráči (${a.room?.players.length})`);

// 4. Natáhne i toho, kdo sedí jinde
b.posli('leave');
await spi(200);
b.zpravy.length = 0;          // ať `cekej` nechytne starou zprávu o místnosti
b.posli('create', { gameId: 'clovece', visibility: 'private', maxPlayers: 4 });
await b.cekej(m => m.t === 'room');
const jinyKod = b.room.code;
ok(jinyKod !== mkod, 'druhý si mezitím udělal vlastní místnost');
a.posli('partyPull');
await spi(400);
ok(b.room?.code === mkod, 'pull ho přetáhl zpátky z cizí místnosti');

// 5. Pull smí jen vůdce
b.zpravy.length = 0;
b.posli('partyPull');
await spi(200);
ok(!!b.posledni('error'), 'člen bez hodnosti pull nespustí');

// 6. Vyhození
a.posli('partyKick', { uid: c.uid });
await spi(250);
ok(c.party === null, 'vyhozený dostal prázdnou partu');
ok(a.party.clenove.length === 2, 'vůdci ubyl člen');

b.zpravy.length = 0;
b.posli('partyKick', { uid: a.uid });
await spi(200);
ok(a.party?.clenove.some(x => x.uid === a.uid), 'člen nemůže vyhodit vůdce');

// 7. Offline se pozná
c.posli('partyJoin', { kod });
await spi(150);
c.zavri();
await spi(300);
const cl = a.party.clenove.find(x => x.uid === c.uid);
ok(cl && cl.online === false, 'odpojený člen je označený jako offline');

// 8. Vůdcovství padá dál
a.posli('partyLeave');
await spi(250);
ok(a.party === null, 'odcházející vůdce už partu nemá');
ok(b.party?.vudce === b.uid, 'vůdcovství přebral další v pořadí');

// 9. Parta přežije odpojení, ale ne navždy
const d = await novy('Delta');
d.posli('partyJoin', { kod });
await spi(250);
ok(d.party?.kod === kod, 'parta žije dál kvůli odpojenému členovi (návrat po refreshi)');
d.posli('partyLeave');
await spi(150);

// 10. Vyprsení prazdne party (primo na manageru, cas se necha zestarnout)
{
  const pm = new PartyManager({ najdiConn: () => null, dejDoMistnosti: () => true, posli: () => {} });
  clearInterval(pm.casovac);
  const p = pm.vytvor({ uid: 'u1', name: 'Duch' });
  pm.uklid();
  ok(pm.party.has(p.kod), 'čerstvě opuštěná parta ještě drží');
  pm.uklid(Date.now() + PRAZDNA_MS + 1000);
  ok(!pm.party.has(p.kod), 'po vypršení zmizí');
  ok(!pm.kdeJe.has('u1'), 'a člen v ní už není zapsaný');
}

for (const k of vsichni) k.zavri();
console.log(`\n${chyb ? `!! ${chyb} chyb` : 'Všechno sedí.'}\n`);
process.exit(chyb ? 1 : 0);
