// ─────────────────────────────────────────────────────────────
//  Lodě pro čtyři – jedna společná mřížka.
//
//  CIZÍ LODĚ SE NEPOSÍLAJÍ. To je celý důvod, proč tohle běží na
//  serveru: v předloze ležel stav ve Firestore, takže si každý mohl
//  přečíst, kde mají ostatní lodě – a tím hra končí. `view()` posílá
//  jen moje lodě a to, co už je prostřílené.
// ─────────────────────────────────────────────────────────────
import {
  novaHra, rozmisti, rozmistiNahodne, strel, konecTahu,
  cile, lzeStrelit, moznaPole, ziviNaPoli, zbyvaSegmentu, zbyvaLodi, lodNaPoli,
} from '../../shared/games/lode/pravidla.js';
import {
  LODE, POLI_LODI, STRELY, RAN_ZA_TAH, BARVY, idx, naDesce, sousedi,
} from '../../shared/games/lode/const.js';
import { TIMING } from '../../shared/constants.js';

const TAH_MS = 90000;
const ROZMISTENI_MS = 120000;   // kdo do té doby nerozmístí, dostane náhodné
const LOG_MAX = 10;

export default {
  id: 'lode',
  title: 'Lodě',
  emoji: '🚢',
  desc: 'Jedno moře pro všechny. Lodě se smějí překrývat a zásah bere všem.',
  minPlayers: 2,
  maxPlayers: 4,
  realtime: false,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  createState({ players, rng }) {
    const seats = rng.shuffle(players.map(p => p.uid));
    const state = { hra: novaHra(seats.length), seats, deadline: 0, botAt: 0 };
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

    if (s.faze === 'rozmisteni') {
      // Rozmisťují všichni naráz, takže se čeká na kohokoliv, kdo ještě nemá.
      const cekaBot = Array.from({ length: s.hracu }, (_, h) => h)
        .some(h => !s.hotovo[h] && this.jeBot(state, ctx, h));
      if (cekaBot) state.botAt = now + TIMING.BOT_KROK_MS;
      state.deadline = now + ROZMISTENI_MS;
      return;
    }

    if (this.jeBot(state, ctx, s.naTahu)) state.botAt = now + TIMING.BOT_KROK_MS;
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

    if (msg.a === 'rozmisti') {
      if (s.faze !== 'rozmisteni') return ctx.reject(player, 'Rozmístění už skončilo.');
      if (s.hotovo[seat]) return ctx.reject(player, 'Už máš rozmístěno.');
      const novy = msg.nahodne
        ? rozmistiNahodne(s, seat, ctx.rng)
        : rozmisti(s, seat, msg.lode);
      if (novy.akci === s.akci) return ctx.reject(player, 'Takhle to rozmístit nejde.');
      return this.uprav(state, novy, ctx);
    }

    if (s.faze !== 'bitva') return;
    if (s.naTahu !== seat) return ctx.reject(player, 'Nejsi na tahu.');

    if (msg.a === 'konec') return this.uprav(state, konecTahu(s), ctx);

    if (msg.a === 'strel') {
      const typ = String(msg.typ || 'normal');
      const x = msg.x | 0, y = msg.y | 0;
      if (!lzeStrelit(s, seat, typ, x, y)) return ctx.reject(player, 'Tam střílet nejde.');
      return this.uprav(state, strel(s, typ, x, y), ctx);
    }
  },

  // ── Hodiny ─────────────────────────────────────────────────
  tick(state, dt, ctx) {
    const s = state.hra;
    if (s.vitez !== null) return;
    const now = Date.now();

    if (!state.botAt) {
      const ceka = s.faze === 'rozmisteni'
        ? Array.from({ length: s.hracu }, (_, h) => h).some(h => !s.hotovo[h] && this.jeBot(state, ctx, h))
        : this.jeBot(state, ctx, s.naTahu);
      if (ceka) state.botAt = now + TIMING.BOT_KROK_MS;
    }
    if (state.botAt && now >= state.botAt) return this.zahrajZa(state, ctx, null);

    if (state.deadline && now >= state.deadline) {
      // Kdo nerozmístil včas, dostane náhodné moře – ať hra nestojí.
      if (s.faze === 'rozmisteni') {
        for (let h = 0; h < s.hracu; h++) {
          if (!state.hra.hotovo[h]) this.uprav(state, rozmistiNahodne(state.hra, h, ctx.rng), ctx);
        }
        return;
      }
      return this.zahrajZa(state, ctx, 'normal');
    }
  },

  zahrajZa(state, ctx, vnuceny) {
    const s = state.hra;

    if (s.faze === 'rozmisteni') {
      for (let h = 0; h < s.hracu; h++) {
        if (!s.hotovo[h] && (vnuceny || this.jeBot(state, ctx, h))) {
          return this.uprav(state, rozmistiNahodne(s, h, ctx.rng), ctx);
        }
      }
      return;
    }

    const h = s.naTahu;
    const hrac = ctx.players?.find(p => p.uid === state.seats[h]);
    const level = vnuceny || hrac?.botLevel || 'normal';
    const t = this.vyberStrelu(s, h, level, ctx.rng);
    if (!t) return this.uprav(state, konecTahu(s), ctx);
    return this.uprav(state, strel(s, t.typ, t.x, t.y), ctx);
  },

  // ── Bot ────────────────────────────────────────────────────
  //  Dva režimy jako u skutečných lodí:
  //    lov     – nikde nedokončený zásah, střílí se do neznáma
  //    dorážka – vedle zásahu skoro jistě pokračuje loď
  //
  //  Zásadní rozdíl proti klasickým lodím: zásah může patřit komukoliv
  //  včetně několika hráčů naráz, takže dorážka je tu ještě cennější –
  //  jedna trefa může ubírat třem soupeřům zároveň.
  vyberStrelu(s, h, level, rng) {
    const volna = moznaPole(s, h, 'normal');
    if (!volna.length) return null;

    // 1) Dorážka: pole vedle zásahu, na který se ještě nestřílelo.
    //    Tohle je u lodí největší rozdíl mezi hráči, takže to easy NEUMÍ –
    //    když to uměly všechny úrovně, byly k nerozeznání (0,2 σ).
    const dorazky = [];
    if (level !== 'easy') {
    for (const [k, kdo] of Object.entries(s.zasazeni)) {
      const [zx, zy] = k.split(',').map(Number);
      // Zásah, který patřil jen mně, nemá cenu dorážet.
      if (!kdo.some(c => c !== h && s.zije[c])) continue;
      for (const p of sousedi(s.strana, zx, zy)) {
        if (s.strileno[idx(s.strana, p.x, p.y)]) continue;
        if (lodNaPoli(s, h, p.x, p.y)) continue;    // do své lodi bot nestřílí
        // V přímce se zásahy je loď pravděpodobnější.
        const vRade = this.vRade(s, zx, zy, p.x, p.y, h);
        dorazky.push({ ...p, typ: 'normal', v: 100 + (vRade ? 60 : 0) + kdo.length * 15 });
      }
    }
    }

    // 2) Speciální střela, když na ni mám a vyplatí se.
    const spec = level === 'easy' ? null : this.vyberSpecial(s, h, level);

    // 3) Lov: šachovnice, ať se pokryje víc moře stejným počtem ran.
    //    Nejkratší loď má 2 pole, takže každé druhé stačí.
    // Střílet do vlastní lodi je povolené, ale bot to dělá jen tehdy,
    // když už není kam jinam – poslední pole společné všem to vyžaduje.
    // Šachovnice a střed jsou taky dovednost – easy střílí, kam ho napadne.
    // Tvrdý bot místo šachovnice počítá, kde ještě může loď vůbec ležet.
    const hust = level === 'hard' ? this.hustota(s, h) : null;
    const lov = volna.map(p => ({
      ...p, typ: 'normal',
      v: (lodNaPoli(s, h, p.x, p.y) ? -500 : 0)
        + (level === 'easy' ? 0
          : hust ? hust[idx(s.strana, p.x, p.y)] * 3
            : ((p.x + p.y) % 2 === 0 ? 20 : 6) + this.blizkostKuStredu(s, p)),
    }));

    let kandidati = dorazky.length ? dorazky : lov;
    if (spec && (!dorazky.length || spec.v > dorazky[0].v)) kandidati = [spec, ...kandidati];

    kandidati.sort((a, b) => b.v - a.v);
    if (level === 'easy') {
      // Nestřílí náhodně – jen si mezi slušnými poli vybírá nepřesně
      // a dorážku bere jen občas.
      const kolik = Math.max(1, Math.ceil(kandidati.length * 0.5));
      return rng.pick(kandidati.slice(0, kolik));
    }
    const nej = kandidati[0].v;
    return rng.pick(kandidati.filter(x => x.v === nej));
  },

  // ── Mapa hustoty (jen hard) ─────────────────────────
  //  Pro každou délku lodi se projdou všechna umístění, která ještě nejsou
  //  vyloučená prostřílenými poli, a spočítá se, kolik jich které pole
  //  pokrývá. Je to klasika ze skutečných lodí – a jediné, čím se tvrdý bot
  //  liší od normálního. Bez toho byly obě úrovně k nerozeznání (0,1 σ).
  //
  //  Počítá se jen z VEŘEJNÝCH údajů (co je prostřílené), ne z toho, kde
  //  lodě opravdu jsou – bot si nekouká do karet.
  hustota(s, h) {
    const N = s.strana;
    const map = new Array(N * N).fill(0);
    const volne = (x, y) => !s.strileno[idx(s.strana, x, y)];

    for (const lod of LODE) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          for (const svisle of [false, true]) {
            let sedi = true;
            for (let i = 0; i < lod.delka; i++) {
              const cx = svisle ? x : x + i;
              const cy = svisle ? y + i : y;
              if (!naDesce(N, cx, cy) || !volne(cx, cy)) { sedi = false; break; }
            }
            if (!sedi) continue;
            for (let i = 0; i < lod.delka; i++) {
              const cx = svisle ? x : x + i;
              const cy = svisle ? y + i : y;
              map[idx(N, cx, cy)]++;
            }
          }
        }
      }
    }
    return map;
  },

  // Leží (px,py) v přímce s dalším zásahem od (zx,zy)?
  vRade(s, zx, zy, px, py, h) {
    const dx = px - zx, dy = py - zy;
    const bx = zx - dx, by = zy - dy;
    if (!naDesce(s.strana, bx, by)) return false;
    const kdo = s.zasazeni[`${bx},${by}`];
    return !!kdo && kdo.some(c => c !== h && s.zije[c]);
  },

  blizkostKuStredu(s, p) {
    const stred = (s.strana - 1) / 2;
    const d = Math.max(Math.abs(p.x - stred), Math.abs(p.y - stred));
    return Math.max(0, 4 - d);       // střed je o kousek lepší, lodě se tam vejdou spíš
  },

  // Speciální střela se vyplatí, když pokryje hodně NEprostřílených polí
  // a netrefí moje vlastní lodě.
  vyberSpecial(s, h, level) {
    let nej = null;
    for (const typ of ['bomba', 'radek', 'sloupec']) {
      if (s.body[h] < STRELY[typ].cena) continue;
      for (let y = 0; y < s.strana; y++) {
        for (let x = 0; x < s.strana; x++) {
          if (!lzeStrelit(s, h, typ, x, y)) continue;
          const c = cile(s, typ, x, y).filter(p => !s.strileno[idx(s.strana, p.x, p.y)]);
          // Cena za pole – pod jedno pole na bod to nestojí za řeč.
          const hodnota = c.length * 26 - STRELY[typ].cena * 22;
          // Tvrdý bot střílí speciál radši tam, kde už něco našel.
          const bonus = level === 'hard'
            ? c.filter(p => sousedi(s.strana, p.x, p.y)
              .some(q => (s.zasazeni[`${q.x},${q.y}`] || []).some(k => k !== h && s.zije[k]))).length * 18
            : 0;
          const v = hodnota + bonus;
          if (v > 0 && (!nej || v > nej.v)) nej = { x, y, typ, v };
        }
      }
    }
    return nej;
  },

  botThink() { return null; },

  // ── Pohled ─────────────────────────────────────────────────
  //  Moje lodě ano, cizí ne. Ven jde jen to, co už někdo prostřílel.
  view(state, uid) {
    const s = state.hra;
    const seat = state.seats.indexOf(uid);
    const muj = seat >= 0;
    const now = Date.now();

    return {
      hracu: s.hracu,
      strana: s.strana,
      seats: state.seats,
      mySeat: seat,
      naTahu: s.naTahu,
      myTurn: muj && seat === s.naTahu && s.faze === 'bitva' && s.vitez === null,
      faze: s.faze,
      kolo: s.kolo,
      ranZbyva: s.ranZbyva,

      // Moje lodě a jejich stav. Cizí jen jako počty.
      mojeLode: muj ? s.lode[seat] : null,
      mojeZdrave: muj ? s.zdrave[seat] : null,
      hotovo: s.hotovo,
      zije: s.zije,
      body: s.body,
      zasahu: s.zasahu,
      lodiZbyva: Array.from({ length: s.hracu }, (_, h) => zbyvaLodi(s, h)),
      segmentuZbyva: Array.from({ length: s.hracu }, (_, h) => zbyvaSegmentu(s, h)),
      segmentuCelkem: POLI_LODI,

      // Co už je odhalené – tohle vidí všichni.
      strileno: s.strileno,
      zasazeni: s.zasazeni,

      strely: STRELY,
      ranZaTah: RAN_ZA_TAH,
      vitez: s.vitez,
      poradiVyrazeni: s.poradiVyrazeni,
      casLeft: state.deadline ? Math.max(0, state.deadline - now) : 0,
      log: s.log.slice(-LOG_MAX),
    };
  },

  // Vyhrává ten, kdo POTOPIL nejvíc cizích segmentů – ne ten, kdo přežil.
  //
  //  Změřeno na 200 partijích: při „poslední přeživší vyhrává“ vyhrál
  //  nejlepší střelec 26 % partijí (náhoda dá 25 %) a korelace mezi zásahy
  //  a výhrou byla r = 0,06. Na společné desce totiž nejde vybrat, koho
  //  poškodím, a vlastní přežití neovlivním vůbec – hra byla čirá loterie.
  //  Přežití pořád rozhoduje o tom, jak dlouho můžeš střílet, a je první
  //  rozstřel při shodě.
  result(state) {
    const s = state.hra;
    if (s.vitez === null) return null;
    const poradi = Array.from({ length: s.hracu }, (_, h) => h)
      .sort((a, b) => (s.zasahu[b] - s.zasahu[a])
        || ((s.poradiVyrazeni[b] ?? -1) - (s.poradiVyrazeni[a] ?? -1)));
    const nej = s.zasahu[poradi[0]];
    if (!nej) return { draw: true, reason: 'Nikdo nic nepotopil.' };
    const vitezove = poradi.filter(h => s.zasahu[h] === nej);
    if (vitezove.length > 1) {
      return { draw: true, reason: `Remíza – ${nej} potopených políček shodně.` };
    }
    return {
      winners: [state.seats[poradi[0]]],
      reason: `Potopil nejvíc – ${nej} políček.`,
    };
  },
};
