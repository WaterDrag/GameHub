// ─────────────────────────────────────────────────────────────
//  Osadníci z Katanu – 2 až 4 hráči.
//
//  Pravidla jsou v `shared/games/katan/pravidla.js` a server je jediný,
//  kdo je vyhodnocuje. Klient posílá jen „stavím osadu na vrcholu 17“.
//
//  SUROVINY V RUCE JSOU TAJNÉ. `view()` posílá každému jen jeho vlastní
//  karty, ostatním počty. V předloze ležel celý stav ve Firestore, takže
//  si kdokoliv mohl přečíst, co kdo drží – a u zloděje nebo monopolu je
//  to celá hra.
//
//  Deska se míchá seedem na serveru. V předloze ji losoval prohlížeč,
//  takže šlo generovat znovu, dokud nepadlo hezké číslo u vlastní osady.
// ─────────────────────────────────────────────────────────────
import {
  novaHra, body, bodyVerejne, kolikKaret, pocetStaveb,
  lzeOsada, lzeSilnice, lzeMesto, maNa, kurz, delkaCesty,
  postavOsadu, postavSilnici, postavMesto, hod, zahod, presunZlodeje,
  okradni, koupKartu, zahrajKartu, lzeZahratKartu, obchodBanka,
  nabidni, prijmiNabidku, zrusNabidku, konecTahu, poradi,
} from '../../shared/games/katan/pravidla.js';
import {
  SUROVINY, POUST, CENY, DEV_INFO, SUROVINA_INFO, tecky, BODU_NA_VYHRU,
} from '../../shared/games/katan/deska.js';

const TAH_MS = 120000;     // kolik má člověk na tah
const BOT_MS = 700;
const NABIDKA_MS = 1400;  // jak dlouho boti „premysli“ nad nabidkou
const LOG_MAX = 10;

// ── Bot ──────────────────────────────────────────────────────
// Cena místa: součet teček okolních polí + bonus za rozmanitost
// a za přístav. Bez rozmanitosti si bot postaví dvě osady na stejnou
// surovinu a pak nemá čím stavět.
function cenaVrcholu(s, vId) {
  const v = s.deska.vrcholy[vId];
  let soucet = 0;
  const druhy = new Set();
  for (const pId of v.pole) {
    const p = s.deska.pole[pId];
    if (p.surovina === POUST) continue;
    soucet += tecky(p.cislo);
    druhy.add(p.surovina);
  }
  return soucet + druhy.size * 2 + (v.pristav ? 1.5 : 0);
}

// `sum` je rozptyl výběru. Easy nestaví náhodně – v Katanu rozhoduje
// rozmístění skoro všechno a úplná náhoda z něj dělá otloukánka
// (prohrával 99 % partií). Místo toho vybírá nepřesně: mezi slušnými
// místy, ale ne vždycky to nejlepší.
function nejlepsiVrchol(s, h, rng, sum = 0.8) {
  const volne = s.deska.vrcholy.filter(v => lzeOsada(s, h, v.id));
  if (!volne.length) return null;
  let nej = volne[0], nejV = -Infinity;
  for (const v of volne) {
    const c = cenaVrcholu(s, v.id) + rng() * sum;
    if (c > nejV) { nejV = c; nej = v; }
  }
  return nej.id;
}

// Silnice směrem k dobrému volnému místu.
function nejlepsiSilnice(s, h, rng) {
  const moznosti = s.deska.hrany.filter(e => lzeSilnice(s, h, e.id));
  if (!moznosti.length) return null;
  let nej = moznosti[0], nejV = -1;
  for (const e of moznosti) {
    let c = rng() * 0.5;
    for (const vId of [e.v1, e.v2]) {
      const v = s.deska.vrcholy[vId];
      if (v.majitel !== null) continue;
      const volny = v.sousedi.every(so => s.deska.vrcholy[so].majitel === null);
      if (volny) c += cenaVrcholu(s, vId) * 0.5;
    }
    if (c > nejV) { nejV = c; nej = e; }
  }
  return nej.id;
}

// Čeho má hráč nejmíň – to je dobré brát z banku i monopolem.
function nejvzacnejsi(s, h) {
  let nej = SUROVINY[0];
  for (const r of SUROVINY) if (s.suroviny[h][r] < s.suroviny[h][nej]) nej = r;
  return nej;
}
function nejhojnejsi(s, h) {
  let nej = SUROVINY[0];
  for (const r of SUROVINY) if (s.suroviny[h][r] > s.suroviny[h][nej]) nej = r;
  return nej;
}

// Kam se zlodějem: na pole, kde má nejsilnější soupeř nejvíc.
function kamZlodej(s, h, rng) {
  let nej = null, nejV = -Infinity;
  for (const p of s.deska.pole) {
    if (p.id === s.zlodej) continue;
    let c = rng() * 0.5;
    let mojeTam = false;
    for (const vId of s.deska.poleVrcholy[p.id]) {
      const v = s.deska.vrcholy[vId];
      if (v.majitel === null) continue;
      if (v.majitel === h) { mojeTam = true; continue; }
      const vaha = (v.typ === 'mesto' ? 2 : 1) * tecky(p.cislo);
      c += vaha * (1 + bodyVerejne(s, v.majitel) * 0.15);
    }
    if (mojeTam) c -= 100;              // vlastní pole si bot neblokuje
    if (c > nejV) { nejV = c; nej = p.id; }
  }
  return nej === null ? (s.zlodej + 1) % s.deska.pole.length : nej;
}

// ── Modul ────────────────────────────────────────────────────
export default {
  id: 'katan',
  title: 'Osadníci z Katanu',
  emoji: '🏝️',
  desc: 'Stav osady, obchoduj a hlídej si zloděje. Kdo první nasbírá 10 bodů, vyhrál.',
  minPlayers: 2,
  maxPlayers: 4,
  realtime: false,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  createState({ players, rng }) {
    const seats = rng.shuffle(players.map(p => p.uid));
    const hra = novaHra(seats.length, rng);
    const state = { hra, seats, deadline: 0, botAt: 0, nabidkaAt: 0 };
    this.prepocti(state, null);
    return state;
  },

  jmeno(ctx, uid) {
    return ctx?.players?.find(p => p.uid === uid)?.name || 'Hráč';
  },

  // Kdo je zrovna na řadě něco udělat. Při zahazování to nejsou jen
  // hráči na tahu – sedmička sáhne na každého, kdo má moc karet.
  kdoJedna(state) {
    const s = state.hra;
    if (s.vitez !== null) return [];
    if (s.faze === 'zahazuje') return Object.keys(s.zahazuji).map(Number);
    return [s.naTahu];
  },

  jeBot(state, ctx, h) {
    const p = ctx?.players?.find(x => x.uid === state.seats[h]);
    return !!(p?.bot || p?.botControlled);
  },

  prepocti(state, ctx) {
    const s = state.hra;
    state.botAt = 0;
    state.nabidkaAt = 0;
    if (s.vitez !== null) { state.deadline = 0; return; }
    const now = Date.now();
    const jednaji = this.kdoJedna(state);
    const bot = jednaji.some(h => this.jeBot(state, ctx, h));
    if (bot) state.botAt = now + BOT_MS;

    // Nabidku posuzuji i hraci mimo tah, takze ma vlastni budik.
    if (s.nabidka) {
      const jeKdo = Array.from({ length: s.hracu }, (_, h) => h)
        .some(h => h !== s.nabidka.hrac && this.jeBot(state, ctx, h));
      if (jeKdo) state.nabidkaAt = now + NABIDKA_MS;
    }

    state.deadline = now + TAH_MS;
  },

  // ── Akce hráče ─────────────────────────────────────────────
  onAction(state, player, msg, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    const seat = state.seats.indexOf(player.uid);
    if (seat < 0) return;

    // Zahazování a přijetí nabídky smí i hráč mimo tah.
    if (msg.a === 'zahod') {
      if (s.faze !== 'zahazuje' || !s.zahazuji[seat]) return ctx.reject(player, 'Teď nezahazuješ.');
      return this.uprav(state, zahod(s, seat, msg.co || {}), ctx);
    }
    if (msg.a === 'prijmi') {
      if (!s.nabidka) return ctx.reject(player, 'Žádná nabídka neběží.');
      return this.uprav(state, prijmiNabidku(s, seat), ctx);
    }

    if (s.naTahu !== seat) return ctx.reject(player, 'Nejsi na tahu.');

    switch (msg.a) {
      case 'osada': return this.uprav(state, postavOsadu(s, msg.v | 0), ctx);
      case 'silnice': return this.uprav(state, postavSilnici(s, msg.e | 0), ctx);
      case 'mesto': return this.uprav(state, postavMesto(s, msg.v | 0), ctx);
      case 'hod': {
        if (s.faze !== 'hod') return ctx.reject(player, 'Teď se nehází.');
        const d1 = ctx.rng.int(1, 6), d2 = ctx.rng.int(1, 6);
        ctx.emit('kostky', { seat, kostky: [d1, d2] });
        return this.uprav(state, hod(s, d1, d2), ctx);
      }
      case 'zlodej': return this.uprav(state, presunZlodeje(s, msg.pole | 0), ctx);
      case 'kradni': return this.uprav(state, okradni(s, msg.komu | 0, ctx.rng()), ctx);
      case 'karta': return this.uprav(state, koupKartu(s), ctx);
      case 'zahraj': return this.uprav(state, zahrajKartu(s, msg.typ, msg.param), ctx);
      case 'banka': return this.uprav(state, obchodBanka(s, msg.dam, msg.chci), ctx);
      case 'nabidni': return this.uprav(state, nabidni(s, msg.dava, msg.chce), ctx);
      case 'zrus': return this.uprav(state, zrusNabidku(s), ctx);
      case 'konec': return this.uprav(state, konecTahu(s), ctx);
      default: return;
    }
  },

  uprav(state, novy, ctx) {
    const zmena = novy.akci !== state.hra.akci;
    state.hra = novy;
    if (zmena && novy.hlaska) ctx?.emit?.('hlaska', { text: novy.hlaska });
    this.prepocti(state, ctx);
  },

  // ── Hodiny ─────────────────────────────────────────────────
  tick(state, dt, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    const now = Date.now();

    if (!state.botAt) {
      const bot = this.kdoJedna(state).some(h => this.jeBot(state, ctx, h));
      if (bot) state.botAt = now + BOT_MS;
    }

    if (state.nabidkaAt && now >= state.nabidkaAt) {
      state.nabidkaAt = 0;
      return this.botNabidka(state, ctx);
    }
    if (state.botAt && now >= state.botAt) return this.zahrajZa(state, ctx, null);
    if (state.deadline && now >= state.deadline) {
      return this.zahrajZa(state, ctx, 'normal');
    }
  },

  // Jeden krok za bota. Vrací se po každé akci, takže složitý tah
  // (postavit, koupit, obchodovat, ukončit) proběhne po kouskách
  // a jde ho sledovat.
  zahrajZa(state, ctx, vnuceny) {
    const s = state.hra;
    const rng = ctx.rng;

    // Zahazování řeší i hráči mimo tah.
    if (s.faze === 'zahazuje') {
      const h = Object.keys(s.zahazuji).map(Number)[0];
      const kolik = s.zahazuji[h];
      const co = Object.fromEntries(SUROVINY.map(r => [r, 0]));
      let zbyva = kolik;
      const kopie = { ...s.suroviny[h] };
      while (zbyva > 0) {
        let nej = SUROVINY[0];
        for (const r of SUROVINY) if (kopie[r] > kopie[nej]) nej = r;
        if (kopie[nej] <= 0) break;
        kopie[nej]--; co[nej]++; zbyva--;
      }
      return this.uprav(state, zahod(s, h, co), ctx);
    }

    const h = s.naTahu;
    const hrac = ctx.players?.find(p => p.uid === state.seats[h]);
    const level = vnuceny || hrac?.botLevel || 'normal';

    if (s.faze === 'rozmisteni') {
      if (s.cekaSilnice) {
        const e = nejlepsiSilnice(s, h, rng);
        return this.uprav(state, e === null ? s : postavSilnici(s, e), ctx);
      }
      const v = nejlepsiVrchol(s, h, rng, level === 'easy' ? 7 : 0.8);
      return this.uprav(state, v === null ? s : postavOsadu(s, v), ctx);
    }

    if (s.faze === 'zlodej') {
      return this.uprav(state, presunZlodeje(s, kamZlodej(s, h, rng)), ctx);
    }

    if (s.faze === 'krade') {
      // Okrádá se ten, kdo má nejvíc karet.
      let nej = s.obeti[0];
      for (const o of s.obeti) if (kolikKaret(s.suroviny[o]) > kolikKaret(s.suroviny[nej])) nej = o;
      return this.uprav(state, okradni(s, nej, rng()), ctx);
    }

    if (s.faze === 'hod') {
      // Rytíře se vyplatí zahrát před hodem – zloděj se dá odstranit
      // z vlastního pole ještě dřív, než začne výroba.
      if (level === 'hard' && lzeZahratKartu(s, h, 'rytir') && this.zlodejMiVadi(s, h)) {
        return this.uprav(state, zahrajKartu(s, 'rytir'), ctx);
      }
      const d1 = rng.int(1, 6), d2 = rng.int(1, 6);
      ctx.emit('kostky', { seat: h, kostky: [d1, d2] });
      return this.uprav(state, hod(s, d1, d2), ctx);
    }

    if (s.faze === 'akce') return this.botAkce(state, ctx, level);
  },

  // Nejlepší volné místo, které ta silnice zpřístupní.
  hodnotaSilnice(s, h, eId) {
    const e = s.deska.hrany[eId];
    let nej = 0;
    for (const vId of [e.v1, e.v2]) {
      const v = s.deska.vrcholy[vId];
      if (v.majitel !== null) continue;
      if (!v.sousedi.every(so => s.deska.vrcholy[so].majitel === null)) continue;
      nej = Math.max(nej, cenaVrcholu(s, vId));
    }
    return nej;
  },

  zlodejMiVadi(s, h) {
    return s.deska.poleVrcholy[s.zlodej].some(vId => s.deska.vrcholy[vId].majitel === h);
  },

  botAkce(state, ctx, level) {
    const s = state.hra;
    const h = s.naTahu;
    const rng = ctx.rng;

    // Volné silnice z karty se musí dostavět.
    if (s.volneSilnice > 0) {
      const e = nejlepsiSilnice(s, h, rng);
      if (e !== null) return this.uprav(state, postavSilnici(s, e), ctx);
    }

    // Karty s okamžitým efektem.
    if (level !== 'easy') {
      if (lzeZahratKartu(s, h, 'monopol')) {
        // Bere se to, co má nejvíc soupeřů dohromady.
        let nej = SUROVINY[0], nejV = -1;
        for (const r of SUROVINY) {
          let sum = 0;
          for (let i = 0; i < s.hracu; i++) if (i !== h) sum += s.suroviny[i][r];
          if (sum > nejV) { nejV = sum; nej = r; }
        }
        if (nejV >= 3) return this.uprav(state, zahrajKartu(s, 'monopol', nej), ctx);
      }
      if (lzeZahratKartu(s, h, 'hojnost')) {
        const chce = this.coChybi(s, h);
        return this.uprav(state, zahrajKartu(s, 'hojnost', chce.slice(0, 2)), ctx);
      }
      if (lzeZahratKartu(s, h, 'silnice') && pocetStaveb(s, h, 'silnice') < 13) {
        return this.uprav(state, zahrajKartu(s, 'silnice'), ctx);
      }
    }

    // Stavění podle priority: město > osada > karta > silnice.
    if (maNa(s, h, 'mesto')) {
      const v = s.deska.vrcholy.find(x => lzeMesto(s, h, x.id));
      if (v) return this.uprav(state, postavMesto(s, v.id), ctx);
    }
    if (maNa(s, h, 'osada')) {
      const v = nejlepsiVrchol(s, h, rng);
      if (v !== null) return this.uprav(state, postavOsadu(s, v), ctx);
    }
    if (maNa(s, h, 'karta') && s.balicek.length && (level === 'hard' || rng() < 0.6)) {
      return this.uprav(state, koupKartu(s), ctx);
    }
    if (maNa(s, h, 'silnice') && pocetStaveb(s, h, 'silnice') < 13) {
      const e = nejlepsiSilnice(s, h, rng);
      if (e !== null) {
        // Tvrdý bot silnici staví jen tehdy, když mu otevře slušné
        // místo na osadu. Slabší ji staví, protože zrovna může –
        // a tím si projí suroviny, které chyběly na město.
        const otevira = this.hodnotaSilnice(s, h, e);
        const stavim = level === 'hard' ? otevira >= 9
          : level === 'normal' ? rng() < 0.7 : rng() < 0.45;
        if (stavim) return this.uprav(state, postavSilnici(s, e), ctx);
      }
    }

    // Obchod s bankou, když má bot přebytek a něco mu chybí.
    if (level !== 'easy') {
      const chybi = this.coChybi(s, h);
      if (chybi.length) {
        // Normální bot mění jen z přebytku, tvrdý sáhne i do zásob –
        // v Katanu je lepší mít stavbu než hromadu karet na sedmičku.
        const rezerva = level === 'hard' ? 0 : 1;
        for (const r of SUROVINY) {
          const k = kurz(s, h, r);
          if (s.suroviny[h][r] >= k + rezerva && !chybi.includes(r)) {
            return this.uprav(state, obchodBanka(s, r, chybi[0]), ctx);
          }
        }
      }
    }

    return this.uprav(state, konecTahu(s), ctx);
  },

  // Co botovi chybí k nejbližší stavbě.
  coChybi(s, h) {
    const cil = pocetStaveb(s, h, 'osada') >= 1 && maNa(s, h, 'karta') ? 'mesto' : 'osada';
    const poradiCilu = ['mesto', 'osada', 'silnice', 'karta'];
    for (const co of poradiCilu) {
      const chybi = [];
      for (const [r, kolik] of Object.entries(CENY[co])) {
        const schazi = kolik - s.suroviny[h][r];
        for (let i = 0; i < schazi; i++) chybi.push(r);
      }
      if (chybi.length && chybi.length <= 3) return chybi;
    }
    return [];
  },

  // ── Nabidka od hrace ─────────────────────────────
  //  Boti nabidku sami nevymysli, ale umi ji posoudit. Bere ji prvni
  //  po smeru hry, komu vymena pomuze k dalsi stavbe.
  botNabidka(state, ctx) {
    const s = state.hra;
    if (!s.nabidka) return;
    const { hrac } = s.nabidka;

    for (let i = 1; i < s.hracu; i++) {
      const h = (hrac + i) % s.hracu;
      if (!this.jeBot(state, ctx, h)) continue;
      const p = ctx?.players?.find(x => x.uid === state.seats[h]);
      if (this.chceNabidku(s, h, p?.botLevel || 'normal')) {
        return this.uprav(state, prijmiNabidku(s, h), ctx);
      }
    }

    // Nikdo z botu nechce. Kdyz uz nema kdo jiny prijmout, nabidka padne –
    // at hrac necuma na neco, co se nikdy nevyresi.
    const cekaClovek = Array.from({ length: s.hracu }, (_, h) => h)
      .some(h => h !== hrac && !this.jeBot(state, ctx, h) && state.seats[h]);
    if (!cekaClovek) {
      this.uprav(state, zrusNabidku(s), ctx);
      ctx?.emit?.('hlaska', { text: 'Nabídku nikdo nepřijal.' });
    }
  },

  chceNabidku(s, h, level) {
    const { hrac, dava, chce } = s.nabidka;
    if (hrac === h) return false;
    if (SUROVINY.some(r => s.suroviny[h][r] < chce[r])) return false;

    const dostanu = SUROVINY.reduce((a, r) => a + dava[r], 0);
    const dam = SUROVINY.reduce((a, r) => a + chce[r], 0);
    if (dam > dostanu && level !== 'easy') return false;

    // Meritko je jedine: posune me to bliz k nejblizsi stavbe?
    const po = {
      ...s,
      suroviny: s.suroviny.map((x, i) => (i === h
        ? Object.fromEntries(SUROVINY.map(r => [r, x[r] + dava[r] - chce[r]]))
        : x)),
    };
    const pred = this.coChybi(s, h).length;
    const potom = this.coChybi(po, h).length;
    if (!pred || potom >= pred) return false;

    // Tvrdy bot nepodrzi tomu, kdo je krok od vyhry.
    if (level === 'hard' && bodyVerejne(s, hrac) >= 8) return false;
    return true;
  },

  botThink() { return null; },

  // ── Pohled ─────────────────────────────────────────────────
  //  Deska je veřejná, ruce nejsou. Každý dostane svoje suroviny
  //  a svoje dev karty; o ostatních jen počty.
  view(state, uid) {
    const s = state.hra;
    const seat = state.seats.indexOf(uid);
    const muj = seat >= 0;
    const now = Date.now();

    return {
      hracu: s.hracu,
      seats: state.seats,
      mySeat: seat,
      naTahu: s.naTahu,
      myTurn: muj && seat === s.naTahu && s.vitez === null,
      faze: s.faze,
      kostky: s.kostky,
      zlodej: s.zlodej,
      volneSilnice: s.volneSilnice,

      // Statická deska + co je kde postavené.
      pole: s.deska.pole.map(p => ({
        id: p.id, x: p.x, y: p.y, surovina: p.surovina, cislo: p.cislo,
      })),
      vrcholy: s.deska.vrcholy.map(v => ({
        id: v.id, x: v.x, y: v.y, majitel: v.majitel, typ: v.typ, pristav: v.pristav,
      })),
      hrany: s.deska.hrany.map(e => ({ id: e.id, v1: e.v1, v2: e.v2, majitel: e.majitel })),
      pristavy: s.deska.pristavy,

      // Moje karty – nikoho jiného.
      suroviny: muj ? s.suroviny[seat] : null,
      karty: muj ? s.karty[seat] : [],
      kartyDnes: muj ? s.kartyDnes[seat] : [],
      pocetKaret: s.suroviny.map(kolikKaret),
      pocetDevKaret: s.karty.map(k => k.length),

      banka: s.banka,
      balicku: s.balicek.length,
      rytiru: s.rytiru,
      body: Array.from({ length: s.hracu }, (_, h) => (h === seat ? body(s, h) : bodyVerejne(s, h))),
      nejdelsiCesta: s.nejdelsiCesta,
      nejvetsiArmada: s.nejvetsiArmada,

      zahazuji: s.zahazuji,
      musimZahodit: muj ? (s.zahazuji[seat] || 0) : 0,
      obeti: s.obeti,
      nabidka: s.nabidka,

      // Co smím zrovna teď – počítá server, ne klient.
      lzeOsada: muj && seat === s.naTahu
        ? s.deska.vrcholy.filter(v => lzeOsada(s, seat, v.id)
          && (s.faze === 'rozmisteni' ? !s.cekaSilnice : s.faze === 'akce' && maNa(s, seat, 'osada'))).map(v => v.id)
        : [],
      lzeSilnice: muj && seat === s.naTahu
        ? s.deska.hrany.filter(e => lzeSilnice(s, seat, e.id)
          && (s.faze === 'rozmisteni' ? s.cekaSilnice
            : s.faze === 'akce' && (s.volneSilnice > 0 || maNa(s, seat, 'silnice')))).map(e => e.id)
        : [],
      lzeMesto: muj && seat === s.naTahu && s.faze === 'akce' && maNa(s, seat, 'mesto')
        ? s.deska.vrcholy.filter(v => lzeMesto(s, seat, v.id)).map(v => v.id)
        : [],
      lzeKarta: muj && seat === s.naTahu && s.faze === 'akce' && maNa(s, seat, 'karta') && s.balicek.length > 0,
      kurzy: muj ? Object.fromEntries(SUROVINY.map(r => [r, kurz(s, seat, r)])) : {},

      vitez: s.vitez,
      casLeft: state.deadline ? Math.max(0, state.deadline - now) : 0,
      log: s.log.slice(-LOG_MAX),
    };
  },

  result(state) {
    const s = state.hra;
    if (s.vitez === null) return null;
    return {
      winners: [state.seats[s.vitez]],
      reason: `${BODU_NA_VYHRU} vítězných bodů!`,
      poradi: poradi(s).map(h => state.seats[h]),
    };
  },
};
