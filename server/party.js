// ─────────────────────────────────────────────────────────────
//  Parta – skupina, která drží pohromadě napříč hrami.
//
//  Místnost je jedna hra. Parta je parta lidí: vůdce vybere hru,
//  klikne „hrát“ a všichni se do ní přesunou naráz, aniž by kdokoliv
//  opisoval kód. Po dohrané hře parta zůstává a jede se dál.
//
//  Vlastní entita, ne příznak na místnosti – jinak by se parta
//  rozpadla pokaždé, když hra skončí.
// ─────────────────────────────────────────────────────────────
import { ROOM } from '../shared/constants.js';

const MAX_CLENU = 8;

// Parta přežije odpojení – kdo si obnoví stránku, musí se vrátit mezi svoje.
// Ale parta, kde už nikdo není online, je jen zabraný kód; po téhle době padá.
export const PRAZDNA_MS = 10 * 60 * 1000;

function novyKod(obsazene) {
  for (let i = 0; i < 200; i++) {
    let c = '';
    for (let j = 0; j < ROOM.CODE_LEN; j++) {
      c += ROOM.CODE_ALPHABET[Math.floor(Math.random() * ROOM.CODE_ALPHABET.length)];
    }
    if (!obsazene.has(c)) return c;
  }
  throw new Error('Nepodařilo se vygenerovat kód party.');
}

export class Party {
  constructor(kod, vudce) {
    this.kod = kod;
    this.vudce = vudce.uid;
    // Pořadí členů drží, kdo přišel dřív – vůdcovství padá na dalšího.
    this.clenove = new Map();      // uid -> {uid, name}
    this.prazdnaOd = null;         // od kdy je parta bez jediného online člena
    this.pridej(vudce);
    this.vytvoreno = Date.now();
  }

  get pocet() { return this.clenove.size; }
  get plna() { return this.clenove.size >= MAX_CLENU; }
  ma(uid) { return this.clenove.has(uid); }

  pridej(user) {
    if (this.clenove.has(user.uid)) {
      this.clenove.get(user.uid).name = user.name;
      return true;
    }
    if (this.plna) return false;
    this.clenove.set(user.uid, { uid: user.uid, name: user.name });
    return true;
  }

  odeber(uid) {
    this.clenove.delete(uid);
    // Vůdce odešel – bere to další v pořadí, ať parta nezůstane bez hlavy.
    if (this.vudce === uid) {
      const dalsi = this.clenove.keys().next();
      this.vudce = dalsi.done ? null : dalsi.value;
    }
  }
}

export class PartyManager {
  //  `najdiConn(uid)` vrátí spojení hráče, `dejDoMistnosti(conn, kod)`
  //  ho tam přesune. Obojí umí index.js – party o něm nemusí vědět.
  constructor({ najdiConn, dejDoMistnosti, posli }) {
    this.party = new Map();        // kod -> Party
    this.kdeJe = new Map();        // uid -> kod
    this.najdiConn = najdiConn;
    this.dejDoMistnosti = dejDoMistnosti;
    this.posli = posli;
    this.casovac = setInterval(() => this.uklid(), 30000);
    this.casovac.unref?.();
  }

  proHrace(uid) {
    const kod = this.kdeJe.get(uid);
    return kod ? this.party.get(kod) : null;
  }

  vytvor(user) {
    this.opust(user.uid);          // víc part naráz nedává smysl
    const p = new Party(novyKod(this.party), user);
    this.party.set(p.kod, p);
    this.kdeJe.set(user.uid, p.kod);
    return p;
  }

  pripoj(user, kod) {
    const p = this.party.get(String(kod || '').toUpperCase().trim());
    if (!p) return { chyba: 'Parta neexistuje.' };
    if (p.ma(user.uid)) { this.kdeJe.set(user.uid, p.kod); return { party: p }; }
    if (p.plna) return { chyba: 'Parta je plná.' };
    this.opust(user.uid);
    p.pridej(user);
    this.kdeJe.set(user.uid, p.kod);
    return { party: p };
  }

  opust(uid) {
    const p = this.proHrace(uid);
    if (!p) return null;
    p.odeber(uid);
    this.kdeJe.delete(uid);
    if (!p.pocet) this.party.delete(p.kod);
    return p;
  }

  vyhod(vudceUid, uid) {
    const p = this.proHrace(vudceUid);
    if (!p || p.vudce !== vudceUid || uid === vudceUid) return null;
    if (!p.ma(uid)) return null;
    p.odeber(uid);
    this.kdeJe.delete(uid);
    this.rozesli(p);
    this.posliJednomu(uid, null);
    return p;
  }

  // ── Přesun celé party do místnosti ─────────────────────────
  //  Vůdce založí nebo najde místnost a ostatní se do ní natáhnou.
  //  Kdo je zrovna offline, prostě zůstane – parta se kvůli němu
  //  nezastaví.
  natahni(p, kod) {
    if (!p) return { vzato: 0, nevzato: [] };
    let vzato = 0;
    const nevzato = [];
    for (const c of p.clenove.values()) {
      if (c.uid === p.vudce) continue;
      const conn = this.najdiConn(c.uid);
      if (!conn) { nevzato.push(c.name); continue; }
      const ok = this.dejDoMistnosti(conn, kod);
      if (ok) vzato++; else nevzato.push(c.name);
    }
    return { vzato, nevzato };
  }

  // ── Rozeslání stavu ────────────────────────────────────────
  stav(p) {
    if (!p) return null;
    return {
      kod: p.kod,
      vudce: p.vudce,
      clenove: [...p.clenove.values()].map(c => ({
        uid: c.uid, name: c.name, online: !!this.najdiConn(c.uid),
      })),
      max: MAX_CLENU,
    };
  }

  rozesli(p) {
    if (!p) return;
    const s = this.stav(p);
    for (const c of p.clenove.values()) this.posliJednomu(c.uid, s);
  }

  posliJednomu(uid, stav) {
    const conn = this.najdiConn(uid);
    if (conn) this.posli(conn.ws, stav);
  }

  // Prázdné party se samy zahodí, ať se kódy nehromadí.
  uklid(ted = Date.now()) {
    for (const [kod, p] of this.party) {
      const nikdo = !p.pocet || !p.vudce;
      const vsichniPryc = !nikdo && ![...p.clenove.values()].some(c => this.najdiConn(c.uid));
      if (vsichniPryc) p.prazdnaOd = p.prazdnaOd || ted;
      else p.prazdnaOd = null;
      if (nikdo || (p.prazdnaOd && ted - p.prazdnaOd > PRAZDNA_MS)) {
        for (const c of p.clenove.values()) this.kdeJe.delete(c.uid);
        this.party.delete(kod);
      }
    }
  }
}
