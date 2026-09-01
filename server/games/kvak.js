// ─────────────────────────────────────────────────────────────
//  Kvak! – 2 až 4 hráči.
//
//  Pravidla jsou v `shared/games/kvak/pravidla.js` a vyhodnocuje je
//  jenom server. Klient posílá „táhnu žábou z 3-4 na 3-5“.
//
//  CO JE POD KARTIČKAMI, SE NEPOSÍLÁ. V předloze ležel celý stav ve
//  Firestore, takže si šlo v konzoli přečíst, kde je štika a kde
//  sameček – a celá hra je právě o tom, že se to neví. `view()` posílá
//  druh kartičky až u odhalených.
//
//  Desku míchá server ze seedu. V předloze ji losoval prohlížeč, takže
//  šlo generovat znovu, dokud nepadlo příznivé rozložení.
// ─────────────────────────────────────────────────────────────
import {
  novaHra, tah, preskoc, tahy, kamMuze, lzeHrat,
  vsechnyZaby, zabyNa, druhNa,
} from '../../shared/games/kvak/pravidla.js';
import {
  POLI, KARTY, SAMCI, SLOZENI, SPINAVA, jeSamec, klic, index, sousedi,
} from '../../shared/games/kvak/const.js';
import { TIMING } from '../../shared/constants.js';

const TAH_MS = 90000;      // kolik má člověk na tah
const BOT_MS = TIMING.BOT_KROK_MS;   // 1,7 akce na tah → plný krok
const LOG_MAX = 10;

// ── Bot ──────────────────────────────────────────────────────
//  Ceny jsou naměřené (`tools/test-kvak.mjs`), ne odhadnuté.
const CENA = {
  cizoKralovna: 1000,
  cizoZaba: 120,
  komar: 20,            // tah navíc je zhruba jeden tah, ne půl sežrané žáby
  samec: 90,
  rakos: 30,
  neznameZabkou: 14,
  // `stikaKralovnou` a `stikaZabkou` se násobí pravděpodobností štiky,
  // takže tady už žádná paušální pokuta za neznámou kartičku není.
  stikaZabkou: -300,
  stikaKralovnou: -4000,  // štika sežere i královnu – rovnou prohra
  kralovnaVOhrozeni: -260,
  hrozbaNaKralovnu: 45,
  klada: 34,            // druhá žába na kládu = nedotknutelná dvojice
  zpatky: -22,          // proti přehazování mezi dvěma poli
  noveOtoceni: 18,      // otočit novou kartičku je pokrok
  ubranePole: 26,       // za každé pole, které cizí královně zavřu
  zabaVOhrozeni: -58,   // jen hard: nenechává žabky viset pod úderem
};

// Kdo barvu vody nečte, počítá se stejným rizikem všude: 8 štik z 60.
const PRUMERNE_RIZIKO = 8 / 60;

const mojeNa = (s, h, r, c) => zabyNa(s, r, c).filter(z => z.hrac === h).length;

// Kdo z cizích na to pole dosáhne příští tah.
function ohrozeno(s, h, r, c) {
  let poc = 0;
  for (const [nr, nc] of sousedi(r, c)) {
    for (const z of zabyNa(s, nr, nc)) if (z.hrac !== h && s.hraci[z.hrac].zije) poc++;
  }
  return poc;
}

function nejblizsiCiziKralovna(s, h, r, c) {
  let nej = null;
  for (let x = 0; x < s.hracu; x++) {
    if (x === h || !s.hraci[x].zije) continue;
    for (const z of vsechnyZaby(s, x)) {
      if (!z.kralovna) continue;
      const d = Math.max(Math.abs(z.r - r), Math.abs(z.c - c));
      if (nej === null || d < nej) nej = d;
    }
  }
  return nej;
}

export default {
  id: 'kvak',
  title: 'Kvak!',
  emoji: '🐸',
  desc: 'Rybník z 64 kartiček. Sežer cizí královny a uhlídej svou.',
  minPlayers: 2,
  maxPlayers: 4,
  realtime: false,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  createState({ players, rng }) {
    const seats = rng.shuffle(players.map(p => p.uid));
    const hra = novaHra(seats.length, rng);
    const state = { hra, seats, deadline: 0, botAt: 0 };
    this.prepocti(state, null);
    return state;
  },

  // Jaká je šance, že pod neotočenou kartičkou číhá štika. Počítá se
  // z toho, co vidí všichni: čistá voda štiku mít nemůže, ve špinavé je
  // poměr zbývajících štik k neotočeným špinavým polím. Bot si tedy
  // nekouká pod kartičky – počítá totéž co hráč.
  rizikoStiky(s, i) {
    if (s.voda[i] !== SPINAVA) return 0;
    let skryteSpinave = 0, videnoStik = 0;
    for (let j = 0; j < POLI; j++) {
      if (s.odhaleno[j]) { if (s.pole[j] === 'stika') videnoStik++; }
      else if (s.voda[j] === SPINAVA) skryteSpinave++;
    }
    const zbyva = Math.max(0, SLOZENI.stika - videnoStik);
    return skryteSpinave > 0 ? Math.min(1, zbyva / skryteSpinave) : 0;
  },

  jeBot(state, ctx, h) {
    const p = ctx?.players?.find(x => x.uid === state.seats[h]);
    return !!(p?.bot || p?.botControlled);
  },

  prepocti(state, ctx) {
    const s = state.hra;
    state.botAt = 0;
    if (s.vitez !== null) { state.deadline = 0; return; }
    const now = Date.now();
    if (this.jeBot(state, ctx, s.naTahu)) state.botAt = now + BOT_MS;
    state.deadline = now + TAH_MS;
  },

  uprav(state, novy, ctx) {
    const zmena = novy.akci !== state.hra.akci;
    state.hra = novy;
    if (zmena && novy.hlaska) ctx?.emit?.('hlaska', { text: novy.hlaska });
    this.prepocti(state, ctx);
  },

  // ── Akce hráče ─────────────────────────────────
  //  Jediná akce: skok žábou o pole. Leknín i sameček se vyřeší samy,
  //  žádné mezifáze už nejsou.
  onAction(state, player, msg, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    const seat = state.seats.indexOf(player.uid);
    if (seat < 0) return;
    if (s.naTahu !== seat) return ctx.reject(player, 'Nejsi na tahu.');
    if (msg.a !== 'tah') return;
    return this.uprav(state, tah(s, msg.zr | 0, msg.zc | 0, !!msg.kralovna, msg.r | 0, msg.c | 0), ctx);
  },

  // ── Hodiny ─────────────────────────────────────────────────
  tick(state, dt, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    const now = Date.now();
    if (!state.botAt && this.jeBot(state, ctx, s.naTahu)) state.botAt = now + BOT_MS;
    if (state.botAt && now >= state.botAt) return this.zahrajZa(state, ctx, null);
    if (state.deadline && now >= state.deadline) return this.zahrajZa(state, ctx, 'normal');
  },

  // Jeden krok za bota. Komár a leknín dají tah navíc, takže se sem
  // hned vrátíme – díky tomu jde složený tah sledovat po kouscích.
  zahrajZa(state, ctx, vnuceny) {
    const s = state.hra;
    const h = s.naTahu;
    const hrac = ctx.players?.find(p => p.uid === state.seats[h]);
    const level = vnuceny || hrac?.botLevel || 'normal';
    const rng = ctx.rng;

    const moznosti = tahy(s, h);
    if (!moznosti.length) return this.uprav(state, preskoc(s), ctx);

    const ohodnocene = moznosti
      .map(m => ({ ...m, v: this.cena(s, h, m, level) }))
      .sort((a, b) => b.v - a.v);

    let vybrany;
    if (level === 'easy') {
      // Easy nehraje náhodně – jen si mezi slušnými tahy vybírá nepřesně.
      const kolik = Math.max(1, Math.ceil(ohodnocene.length * 0.45));
      vybrany = rng.pick(ohodnocene.slice(0, kolik));
    } else {
      const nej = ohodnocene[0].v;
      vybrany = rng.pick(ohodnocene.filter(m => m.v === nej));
    }
    return this.uprav(state, tah(s, vybrany.z.r, vybrany.z.c, vybrany.z.kralovna, vybrany.na[0], vybrany.na[1]), ctx);
  },

  cena(s, h, m, level) {
    const [r, c] = m.na;
    const i = index(r, c);
    const druh = s.odhaleno[i] ? s.pole[i] : null;
    let v = 0;

    // Kdo na tom poli stojí. Na kládu se dvěma soupeři se stejně nesmí.
    for (const z of zabyNa(s, r, c)) {
      if (z.hrac === h || !s.hraci[z.hrac].zije) continue;
      v += z.kralovna ? CENA.cizoKralovna : CENA.cizoZaba;
    }

    if (druh === null) {
      v += CENA.noveOtoceni;
      // Štiky leží jen ve špinavé vodě. TVRDÝ bot to čte a do čisté vody
      // klidně posílá i královnu; slabší se bojí každé neotočené kartičky
      // stejně. Právě tím se úrovně liší – rozdíl je v informaci, ne v štěstí.
      // Riziko se počítá z veřejných čísel, ne z toho, co je pod kartičkou.
      const p = level === 'hard' ? this.rizikoStiky(s, i) : PRUMERNE_RIZIKO;
      v += m.z.kralovna
        ? CENA.stikaKralovnou * p
        : CENA.neznameZabkou + CENA.stikaZabkou * p;
    } else if (druh === 'komar' || druh === 'leknin') {
      // Kartička dá tah navíc jen jednou za tah. Bez téhle podmínky na ni
      // bot lezl i podruhé, nedostal nic a tah mu skončil právě tam –
      // vypadalo to, že jen poskáče mezi komáry.
      const uzDala = (s.pouzito || []).includes(`${r}-${c}`);
      // A leknín navíc potřebuje jinou žábu, kterou by šlo táhnout.
      const dostanu = !uzDala && (druh === 'komar' || vsechnyZaby(s, h).length > 1);
      if (dostanu) v += CENA.komar;
    } else if (druh === 'stika') {
      // Štika teď sežere i královnu – to je rovnou prohra.
      v += m.z.kralovna ? CENA.stikaKralovnou : CENA.stikaZabkou;
    } else if (jeSamec(druh)) {
      if (m.z.kralovna && !s.hraci[h].plodil[druh]) v += CENA.samec;
    } else if (druh === 'klada') {
      // Kláda je úkryt: ve dvou tam žábu nikdo nesebere.
      if (mojeNa(s, h, r, c) === 1) v += CENA.klada;
    }

    // Královnu nestrkej tam, kam na ni někdo dosáhne. Easy tohle
    // neřeší – právě tím se pozná od zbytku.
    if (level !== 'easy' && m.z.kralovna) {
      v += CENA.kralovnaVOhrozeni * ohrozeno(s, h, r, c);
    }
    // Žabkou se naopak vyplatí tlačit na cizí královnu. Samotná hrozba
    // nestačí – královna uhne. Počítá se proto i to, kolik jí ten tah
    // zavře únikových polí; bez toho se dvojice botů jen honila dokola.
    if (!m.z.kralovna) {
      for (const [nr, nc] of sousedi(r, c)) {
        for (const z of zabyNa(s, nr, nc)) {
          if (z.hrac !== h && z.kralovna && s.hraci[z.hrac].zije) {
            v += CENA.hrozbaNaKralovnu;
            const uteky = kamMuze(s, z.hrac, nr, nc, true);   // je to královna
            const zavrena = uteky.filter(([ur, uc]) => ur === r && uc === c).length;
            v += CENA.ubranePole * zavrena;
            if (uteky.length <= 2) v += CENA.ubranePole * 2;   // už je skoro v koutu
          }
        }
      }
      const pred = nejblizsiCiziKralovna(s, h, m.z.r, m.z.c);
      const po = nejblizsiCiziKralovna(s, h, r, c);
      if (pred !== null && po !== null && po < pred) v += 8;
    }

    // Vracet se tam, odkud jsem přišel, je nejčastější způsob, jak se
    // zacyklit – dvě královny se takhle uhýbaly do nekonečna.
    if (s.minule?.[h] === `${r}-${c}`) v += CENA.zpatky;

    // Tvrdý bot navíc nenechává žabky stát tam, kde je někdo sebere,
    // a dívá se, jestli si tím tahem neodkryje královnu. Normal ani jedno –
    // je to jediné, čím se ty dvě úrovně liší.
    if (level === 'hard') {
      // Na kládě ve dvou už žábu nikdo nesebere, tam ohrožení nehrozí.
      const kryta = druh === 'klada' && mojeNa(s, h, r, c) >= 1;
      if (!m.z.kralovna && !kryta) {
        v += CENA.zabaVOhrozeni * ohrozeno(s, h, r, c);
      }
      v += this.trestZaOdkryti(s, h, m);
    }
    return v;
  },

  // Kolik by po tomhle tahu stálo soupeřů u mojí královny. Nekopíruje
  // se celý stav – stačí, když se žába v hlavě přesune.
  trestZaOdkryti(s, h, m) {
    const kral = vsechnyZaby(s, h).find(z => z.kralovna);
    if (!kral) return 0;
    const kr = m.z.kralovna ? m.na[0] : kral.r;
    const kc = m.z.kralovna ? m.na[1] : kral.c;
    let hlidacu = 0;
    for (const [nr, nc] of sousedi(kr, kc)) {
      for (const z of zabyNa(s, nr, nc)) {
        if (z.hrac === h && !(nr === m.z.r && nc === m.z.c)) hlidacu++;
      }
    }
    const utocniku = ohrozeno(s, h, kr, kc);
    return utocniku > hlidacu ? -90 * (utocniku - hlidacu) : 0;
  },

  botThink() { return null; },

  // ── Pohled ─────────────────────────────────────────────────
  //  Druh kartičky jde ven až u odhalených. Neodhalené jsou `null`.
  view(state, uid) {
    const s = state.hra;
    const seat = state.seats.indexOf(uid);
    const muj = seat >= 0;
    const naTahu = muj && seat === s.naTahu && s.vitez === null;
    const now = Date.now();

    return {
      hracu: s.hracu,
      seats: state.seats,
      mySeat: seat,
      naTahu: s.naTahu,
      myTurn: naTahu,
      pole: Array.from({ length: POLI }, (_, i) => (s.odhaleno[i] ? s.pole[i] : null)),
      odhaleno: s.odhaleno,
      voda: s.voda,      // rub kartičky – veřejný, takže jde poslat celý
      zaby: s.zaby,
      hraci: s.hraci,
      nucena: s.nucena,
      omezeni: s.omezeni,

      // Co smím zrovna teď – počítá server, ne klient.
      tahy: naTahu ? tahy(s, seat) : [],

      vitez: s.vitez,
      casLeft: state.deadline ? Math.max(0, state.deadline - now) : 0,
      log: s.log.slice(-LOG_MAX),
    };
  },

  result(state) {
    const s = state.hra;
    if (s.vitez === null) return null;
    if (s.vitez < 0) return { draw: true, reason: 'Remíza – v rybníce nezůstala žádná královna.' };
    return { winners: [state.seats[s.vitez]], reason: 'Poslední živá královna!' };
  },
};
