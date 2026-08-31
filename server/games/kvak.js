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
  novaHra, tah, skok, plozeni, vzdejSe, preskoc,
  tahy, kamMuze, cileLekninu, cilePlozeni, vsechnyZaby, zabyNa, mojeZabyNa,
} from '../../shared/games/kvak/pravidla.js';
import {
  POLI, STRANA, ZASOBA, KARTY, index, naDesce, sousedi,
} from '../../shared/games/kvak/const.js';

const TAH_MS = 90000;      // kolik má člověk na tah
const BOT_MS = 650;
const LOG_MAX = 10;

// ── Bot ──────────────────────────────────────────────────────
//  Ceny jsou naměřené (`tools/test-kvak.mjs`), ne odhadnuté.
const CENA = {
  cizoKralovna: 1000,
  cizoZaba: 120,
  komar: 45,
  samec: 90,
  rakos: 30,
  neznameZabkou: 14,
  neznameKralovnou: -18,
  stikaZabkou: -300,
  stikaKralovnou: -60,
  kralovnaVOhrozeni: -260,
  hrozbaNaKralovnu: 45,
  zpatky: -22,          // proti přehazování mezi dvěma poli
  noveOtoceni: 18,      // otočit novou kartičku je pokrok
  ubranePole: 26,       // za každé pole, které cizí královně zavřu
  zabaVOhrozeni: -58,   // jen hard: nenechává žabky viset pod úderem
};

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

  // ── Akce hráče ─────────────────────────────────────────────
  onAction(state, player, msg, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    const seat = state.seats.indexOf(player.uid);
    if (seat < 0) return;
    if (s.naTahu !== seat) return ctx.reject(player, 'Nejsi na tahu.');

    switch (msg.a) {
      case 'tah':
        if (s.faze !== 'tah') return ctx.reject(player, 'Teď se netáhne.');
        return this.uprav(state, tah(s, msg.zr | 0, msg.zc | 0, !!msg.kralovna, msg.r | 0, msg.c | 0), ctx);
      case 'skok':
        if (s.faze !== 'leknin') return ctx.reject(player, 'Teď se neskáče.');
        return this.uprav(state, msg.r === null ? vzdejSe(s) : skok(s, msg.r | 0, msg.c | 0), ctx);
      case 'plozeni':
        if (s.faze !== 'plozeni') return ctx.reject(player, 'Teď se nerozmnožuje.');
        return this.uprav(state, plozeni(s, msg.r | 0, msg.c | 0), ctx);
      default:
        return;
    }
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

  // Jeden krok za bota. Vrací se po každé akci, aby složený tah
  // (skok po leknínu, rozmnožení) proběhl po kouskách a šel sledovat.
  zahrajZa(state, ctx, vnuceny) {
    const s = state.hra;
    const h = s.naTahu;
    const hrac = ctx.players?.find(p => p.uid === state.seats[h]);
    const level = vnuceny || hrac?.botLevel || 'normal';
    const rng = ctx.rng;

    if (s.faze === 'leknin') return this.uprav(state, this.botSkok(s, h, level, rng), ctx);
    if (s.faze === 'plozeni') return this.uprav(state, this.botPlozeni(s, h, rng), ctx);

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

    // Kdo na tom poli stojí. Na rákosu se žabka vyhodit nedá, královna ano.
    for (const z of zabyNa(s, r, c)) {
      if (z.hrac === h || !s.hraci[z.hrac].zije) continue;
      if (z.kralovna) v += CENA.cizoKralovna;
      else if (druh !== 'rakos') v += CENA.cizoZaba;
    }

    if (druh === null) {
      v += CENA.noveOtoceni;
      v += m.z.kralovna ? CENA.neznameKralovnou : CENA.neznameZabkou;
    } else if (druh === 'komar') {
      v += CENA.komar;
    } else if (druh === 'stika') {
      v += m.z.kralovna ? CENA.stikaKralovnou : CENA.stikaZabkou;
    } else if (druh === 'samec') {
      if (m.z.kralovna && s.hraci[h].zasoba > 0) v += CENA.samec;
    } else if (druh === 'rakos') {
      if (!m.z.kralovna) v += CENA.rakos;   // útočiště jen pro žabky
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
            const uteky = kamMuze(s, z.hrac, nr, nc);
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
      if (!m.z.kralovna && druh !== 'rakos') {
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

  botSkok(s, h, level, rng) {
    const { r, c, kralovna } = s.vybrana;
    const cile = cileLekninu(s, h, r, c);
    if (!cile.length) return vzdejSe(s);

    let nej = null, nejV = -Infinity;
    for (const [tr, tc] of cile) {
      const m = { z: { r, c, kralovna }, na: [tr, tc] };
      const v = this.cena(s, h, m, level);
      if (v > nejV) { nejV = v; nej = [tr, tc]; }
    }
    // Skákat se nemusí – když by to bylo horší než zůstat, zůstane.
    const teď = this.cena(s, h, { z: { r, c, kralovna }, na: [r, c] }, level);
    if (nejV <= teď) return vzdejSe(s);
    return skok(s, nej[0], nej[1]);
  },

  botPlozeni(s, h, rng) {
    const { r, c } = s.vybrana;
    const cile = cilePlozeni(s, h, r, c);
    if (!cile.length) return vzdejSe(s);
    // Nová žabka ať radši stojí u královny a kryje ji.
    let nej = cile[0], nejV = -Infinity;
    for (const [tr, tc] of cile) {
      const i = index(tr, tc);
      let v = s.odhaleno[i] && s.pole[i] === 'stika' ? -500 : 0;
      v -= ohrozeno(s, h, tr, tc) * 20;
      if (v > nejV) { nejV = v; nej = [tr, tc]; }
    }
    return plozeni(s, nej[0], nej[1]);
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
      faze: s.faze,
      vybrana: s.vybrana,

      pole: Array.from({ length: POLI }, (_, i) => (s.odhaleno[i] ? s.pole[i] : null)),
      odhaleno: s.odhaleno,
      zakazano: s.zakazano,
      zaby: s.zaby,
      hraci: s.hraci,

      // Co smím zrovna teď – počítá server, ne klient.
      tahy: naTahu && s.faze === 'tah' ? tahy(s, seat) : [],
      cileLekninu: naTahu && s.faze === 'leknin' && s.vybrana
        ? cileLekninu(s, seat, s.vybrana.r, s.vybrana.c) : [],
      cilePlozeni: naTahu && s.faze === 'plozeni' && s.vybrana
        ? cilePlozeni(s, seat, s.vybrana.r, s.vybrana.c) : [],

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
