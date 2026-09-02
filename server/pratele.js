// ─────────────────────────────────────────────────────────────
//  Přátelé.
//
//  Jediná část Hubu, která si něco pamatuje mezi restarty. Všechno
//  ostatní (místnosti, party) je efemérní – kamarádství ne, to by
//  nemělo smysl.
//
//  Identita hosta drží na podepsaném device tokenu (auth.js), takže
//  i host bez registrace má stálé uid a přátele o refresh nepřijde.
//
//  Adresář se hledá stejně jako `.secret` – vedle serveru. Zápis jde
//  přes dočasný soubor a přejmenování: kdyby se to seklo v půlce,
//  původní seznam zůstane celý.
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOM } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOUBOR = process.env.GH_PRATELE || path.join(__dirname, 'data', 'pratele.json');

export const MAX_PRATEL = 100;
const KOD_DELKA = 6;

function novyKod(obsazene) {
  for (let i = 0; i < 500; i++) {
    let c = '';
    for (let j = 0; j < KOD_DELKA; j++) {
      c += ROOM.CODE_ALPHABET[Math.floor(Math.random() * ROOM.CODE_ALPHABET.length)];
    }
    if (!obsazene.has(c)) return c;
  }
  throw new Error('Došly kódy přátel.');
}

export class Pratele {
  constructor(soubor = SOUBOR) {
    this.soubor = soubor;
    this.lide = new Map();      // uid -> {uid, kod, jmeno, pratele:Set, zadosti:Set}
    this.podleKodu = new Map(); // kod -> uid
    this.ulozitZa = null;
    this.nacti();
  }

  // ── Disk ───────────────────────────────────────────────────
  nacti() {
    let raw;
    try { raw = fs.readFileSync(this.soubor, 'utf8'); }
    catch { return; }                       // první spuštění – prázdno
    let data;
    try { data = JSON.parse(raw); }
    catch { console.warn('⚠ pratele.json je poškozený, začínám nanovo.'); return; }
    for (const z of data.lide || []) {
      this.lide.set(z.uid, {
        uid: z.uid, kod: z.kod, jmeno: z.jmeno || 'Hráč',
        pratele: new Set(z.pratele || []), zadosti: new Set(z.zadosti || []),
      });
      this.podleKodu.set(z.kod, z.uid);
    }
  }

  // Ukládá se se zpožděním – kliknutí „přijmout“ jinak sáhne na disk
  // třikrát za sebou.
  uloz() {
    if (this.ulozitZa) return;
    this.ulozitZa = setTimeout(() => { this.ulozitZa = null; this.ulozHned(); }, 400);
    this.ulozitZa.unref?.();
  }

  ulozHned() {
    const data = {
      verze: 1,
      lide: [...this.lide.values()].map(z => ({
        uid: z.uid, kod: z.kod, jmeno: z.jmeno,
        pratele: [...z.pratele], zadosti: [...z.zadosti],
      })),
    };
    const tmp = `${this.soubor}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.soubor), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
      fs.renameSync(tmp, this.soubor);
    } catch (e) {
      console.warn('⚠ Nelze uložit přátele:', e.message);
    }
  }

  // ── Záznamy ────────────────────────────────────────────────
  //  Zakládá se líně: kdo si přátele nikdy neotevře, nezabere místo.
  zaznam(uid, jmeno = null, zaloz = true) {
    let z = this.lide.get(uid);
    if (!z) {
      if (!zaloz) return null;
      z = { uid, kod: novyKod(this.podleKodu), jmeno: jmeno || 'Hráč', pratele: new Set(), zadosti: new Set() };
      this.lide.set(uid, z);
      this.podleKodu.set(z.kod, uid);
      this.uloz();
    } else if (jmeno && z.jmeno !== jmeno) {
      z.jmeno = jmeno;                       // ať přátelé vidí aktuální přezdívku
      this.uloz();
    }
    return z;
  }

  jmenoOf(uid) { return this.lide.get(uid)?.jmeno || 'Hráč'; }
  pratelaOf(uid) { return [...(this.lide.get(uid)?.pratele || [])]; }
  jsouPratele(a, b) { return !!this.lide.get(a)?.pratele.has(b); }

  // ── Žádosti ────────────────────────────────────────────────
  //  Vrací seznam uid, kterým se změnil stav – volající je obešle.
  pozadat(uid, jmeno, kod) {
    const ja = this.zaznam(uid, jmeno);
    const cilUid = this.podleKodu.get(String(kod || '').toUpperCase().trim());
    if (!cilUid) return { chyba: 'Takový kód nikdo nemá.' };
    if (cilUid === uid) return { chyba: 'Sám sobě kamarádem být nemusíš.' };
    const cil = this.zaznam(cilUid);
    if (ja.pratele.has(cilUid)) return { chyba: 'Už kamarádi jste.' };
    if (ja.pratele.size >= MAX_PRATEL) return { chyba: 'Máš plný seznam přátel.' };

    // Když už čeká žádost od něj, kliknutí na „přidat“ ji rovnou přijme.
    if (ja.zadosti.has(cilUid)) return this.prijmi(uid, cilUid);

    if (cil.zadosti.has(uid)) return { chyba: 'Žádost už jsi poslal, čeká se na něj.' };
    cil.zadosti.add(uid);
    this.uloz();
    return { dotcene: [uid, cilUid], zprava: `Žádost odešla hráči ${cil.jmeno}.` };
  }

  prijmi(uid, druhy) {
    const ja = this.zaznam(uid);
    if (!ja.zadosti.has(druhy)) return { chyba: 'Taková žádost tu není.' };
    const on = this.zaznam(druhy, null, false);
    ja.zadosti.delete(druhy);
    if (!on) { this.uloz(); return { chyba: 'Ten hráč už tu není.' }; }
    ja.pratele.add(druhy);
    on.pratele.add(uid);
    on.zadosti.delete(uid);
    this.uloz();
    return { dotcene: [uid, druhy], zprava: `${on.jmeno} je teď tvůj kamarád.` };
  }

  odmitni(uid, druhy) {
    const ja = this.zaznam(uid);
    if (!ja.zadosti.delete(druhy)) return { chyba: 'Taková žádost tu není.' };
    this.uloz();
    return { dotcene: [uid] };
  }

  // Odebírá se oboustranně – jednostranné kamarádství by jen mátlo.
  smaz(uid, druhy) {
    const ja = this.zaznam(uid);
    const on = this.lide.get(druhy);
    ja.pratele.delete(druhy);
    ja.zadosti.delete(druhy);
    on?.pratele.delete(uid);
    on?.zadosti.delete(uid);
    this.uloz();
    return { dotcene: [uid, druhy] };
  }

  // ── Stav pro klienta ───────────────────────────────────────
  //  `kde(uid)` dodá index.js: {code, hra, status} nebo null.
  stav(uid, jmeno, { online, kde }) {
    const z = this.zaznam(uid, jmeno);
    const info = (u) => {
      const on = !!online(u);
      return { uid: u, name: this.jmenoOf(u), online: on, kde: on ? kde(u) : null };
    };
    return {
      kod: z.kod,
      pratele: [...z.pratele].map(info).sort((a, b) =>
        (b.online - a.online) || a.name.localeCompare(b.name, 'cs')),
      zadosti: [...z.zadosti].map(u => ({ uid: u, name: this.jmenoOf(u) })),
    };
  }
}
