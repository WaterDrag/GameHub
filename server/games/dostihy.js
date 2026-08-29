// ─────────────────────────────────────────────────────────────
//  Dostihy a sázky – tahová desková hra.
//
//  Celá pravidla drží server. Klient posílá jen "házím kostkou",
//  "kupuju", "stavím", "končím tah" – nikdy stav. Kostka padá
//  ze serverového RNG, takže si v konzoli nikdo nehodí šestku
//  ani si nepřipíše peníze.
// ─────────────────────────────────────────────────────────────
import {
  D, TILES, GROUPS, CARDS_FINANCE, CARDS_NAHODA,
} from '../../shared/games/dostihy/const.js';

const isProp = (t) => t.type === 'horse' || t.type === 'trainer' || t.type === 'service';

export default {
  id: 'dostihy',
  title: 'Dostihy a sázky',
  emoji: '🏇',
  desc: 'Klasická desková hra o koně, stáje a nájmy. Kdo zůstane poslední, vyhrál.',
  minPlayers: 2,
  maxPlayers: 6,
  realtime: false,
  supportsBots: true,
  botLevels: ['easy', 'normal', 'hard'],

  createState({ players, rng }) {
    const order = rng.shuffle(players.map(p => p.uid));
    const properties = {};
    for (const t of TILES) if (isProp(t)) properties[t.id] = { owner: null, level: 0 };

    return {
      seats: order,
      money: Object.fromEntries(order.map(u => [u, D.START_MONEY])),
      pos: Object.fromEntries(order.map(u => [u, 0])),
      skip: Object.fromEntries(order.map(u => [u, 0])),
      sixes: Object.fromEntries(order.map(u => [u, 0])),
      trapped: Object.fromEntries(order.map(u => [u, false])),
      tries: Object.fromEntries(order.map(u => [u, 0])),
      out: Object.fromEntries(order.map(u => [u, false])),
      properties,
      turn: 0,
      phase: 'roll',            // roll | action
      die: 1,
      again: false,             // padla šestka → hází znovu
      pendingBuy: null,
      parking: 0,
      trade: null,
      logs: [`🏇 Dostihy začaly! Hraje se ${D.MAX_ROUNDS} kol.`],
      round: 1,
      lastCard: null,
      deadline: Date.now() + D.TURN_MS,
      autoUid: null,           // člověku vypršel čas, dohrává za něj bot
      rate: rng.int(D.SELL_MIN, D.SELL_MAX),   // výkupní kurz banky v %
      over: null,
    };
  },

  // ── Pomocné ────────────────────────────────────────────────
  cur(state) { return state.seats[state.turn]; },
  alive(state) { return state.seats.filter(u => !state.out[u]); },

  log(state, msg) {
    state.logs.push(msg);
    if (state.logs.length > 60) state.logs.shift();
  },

  ownsGroup(state, uid, group) {
    return TILES.filter(t => t.group === group)
      .every(t => state.properties[t.id]?.owner === uid);
  },

  // Nájem: koně podle žetonů, trenéři a přeprava podle počtu stejných.
  rentOf(state, tile) {
    const prop = state.properties[tile.id];
    if (tile.type === 'horse') return tile.rent[prop.level];
    const same = Object.keys(state.properties).filter(id =>
      state.properties[id].owner === prop.owner && TILES[+id].type === tile.type).length;
    return Math.round(tile.price * same * 0.25);
  },

  // ── Vstupy od klienta ──────────────────────────────────────
  onAction(state, player, msg, ctx) {
    if (state.over) return;
    const uid = player.uid;

    // Obchod smí kdokoliv kdykoliv – je to jediná akce mimo tah.
    if (msg.a === 'tradeOpen') return this.tradeOpen(state, uid, msg, ctx);
    if (msg.a === 'tradeOffer') return this.tradeOffer(state, uid, msg, ctx);
    if (msg.a === 'tradeAccept') return this.tradeAccept(state, uid, msg, ctx);
    if (msg.a === 'tradeCancel') return this.tradeCancel(state, uid, ctx);
    // Prodávat bance smí kdokoliv kdykoliv, i mimo svůj tah – kurz se
    // mění každé kolo a čekat na vlastní tah by o dobrý kurz připravilo.
    if (msg.a === 'sell') return this.sell(state, uid, msg, ctx);

    if (this.cur(state) !== uid) return ctx.reject(player, 'Nejsi na tahu.');
    if (state.out[uid]) return;
    // Vrátil se k počítači – bot mu přestává hrát tah za něj.
    if (!player.bot && state.autoUid === uid) state.autoUid = null;

    switch (msg.a) {
      case 'roll': return this.roll(state, uid, ctx);
      case 'buy': return this.buy(state, uid, ctx);
      case 'skip': return this.skipBuy(state, uid, ctx);
      case 'build': return this.build(state, uid, msg.tile, ctx);
      case 'end': return this.endTurn(state, uid, ctx);
    }
  },

  // ── Hod kostkou ────────────────────────────────────────────
  roll(state, uid, ctx) {
    if (state.phase !== 'roll') return this.say(ctx, uid, 'Teď se nehází.');
    if (state.pendingBuy !== null) return;

    // odpykávání trestu za doping
    if (state.skip[uid] > 0) {
      state.skip[uid]--;
      this.log(state, `⏳ ${this.name(ctx, uid)} odpykává trest (zbývá ${state.skip[uid]})`);
      return this.advance(state, ctx);
    }

    const die = ctx.rng.int(1, 6);
    state.die = die;

    // na Distanci se hází na šestku, tři pokusy
    if (state.trapped[uid]) {
      state.tries[uid]++;
      this.log(state, `🔒 ${this.name(ctx, uid)} hodil ${die} na Distanci (pokus ${state.tries[uid]}/3)`);
      if (die === 6) {
        state.trapped[uid] = false;
        state.tries[uid] = 0;
        state.sixes[uid] = 0;
        state.again = true;
        state.phase = 'action';
        this.log(state, `✅ ${this.name(ctx, uid)} je volný a hází znovu!`);
      } else if (state.tries[uid] >= 3) {
        state.tries[uid] = 0;
        this.log(state, '❌ Třetí pokus nevyšel, tah končí.');
        this.advance(state, ctx);
      }
      return;
    }

    state.sixes[uid] = die === 6 ? state.sixes[uid] + 1 : 0;

    // tři šestky v řadě = doping a rovnou na Distanc
    if (state.sixes[uid] === 3) {
      this.log(state, `🚨 Třetí šestka! ${this.name(ctx, uid)} jde za doping na Distanc.`);
      state.pos[uid] = 10;
      state.trapped[uid] = true;
      state.sixes[uid] = 0;
      state.again = false;
      state.phase = 'action';
      return;
    }

    const from = state.pos[uid];
    state.pos[uid] = (from + die) % 40;
    if (state.pos[uid] < from) {
      state.money[uid] += D.PASS_START;
      this.log(state, `🏁 ${this.name(ctx, uid)} prošel STARTem! +${D.PASS_START} DK`);
    }

    this.log(state, `🎲 ${this.name(ctx, uid)} hodil ${die} → ${TILES[state.pos[uid]].name}${die === 6 ? ' 🎉' : ''}`);
    state.phase = 'action';
    state.again = die === 6;
    this.land(state, uid, ctx);
  },

  // ── Co se stane na políčku ─────────────────────────────────
  land(state, uid, ctx) {
    const tile = TILES[state.pos[uid]];

    if (tile.type === 'tax') {
      state.money[uid] -= tile.price;
      state.parking += tile.price;
      this.log(state, `💸 ${this.name(ctx, uid)} platí veterinu ${tile.price} DK (jde do banku)`);
      return this.checkOut(state, ctx);
    }

    if (tile.type === 'corner') {
      if (tile.id === 30) {
        state.skip[uid] = 2;
        this.log(state, `🚫 ${this.name(ctx, uid)} chycen na dopingu – stojí 2 kola.`);
      } else if (tile.id === 10) {
        this.log(state, `🔒 ${this.name(ctx, uid)} zastavil na Distanci.`);
      } else if (tile.id === 20) {
        // V původní verzi se bank jen plnil a nikdo si ho nikdy nevzal.
        if (state.parking > 0) {
          state.money[uid] += state.parking;
          this.log(state, `🅿️ ${this.name(ctx, uid)} shrábl bank ${state.parking} DK!`);
          state.parking = 0;
        }
      }
      return;
    }

    if (tile.type === 'card') {
      const finance = tile.name === 'Finance';
      const card = ctx.rng.pick(finance ? CARDS_FINANCE : CARDS_NAHODA);
      state.lastCard = { deck: finance ? 'finance' : 'nahoda', text: card.text, val: card.val ?? null, at: Date.now() };
      if (card.val !== undefined) {
        state.money[uid] += card.val;
      } else if (card.pos !== undefined) {
        const back = card.pos < state.pos[uid];
        state.pos[uid] = card.pos;
        if (card.pos === 0) state.money[uid] += D.PASS_START;
        if (card.trapped) { state.trapped[uid] = true; state.tries[uid] = 0; }
        if (!card.trapped && !back) { /* posun vpřed bez bonusu */ }
      }
      this.log(state, `🃏 ${this.name(ctx, uid)}: ${card.text}`);
      return this.checkOut(state, ctx);
    }

    if (isProp(tile)) {
      const prop = state.properties[tile.id];
      if (prop.owner === null) {
        state.pendingBuy = tile.id;
        this.log(state, `🏪 ${this.name(ctx, uid)} stojí na ${tile.name} (${tile.price} DK)`);
        return;
      }
      if (prop.owner === uid) return;

      // majitel mimo hru nájem nevybírá (pravidlo z původní verze)
      if (state.trapped[prop.owner] || state.skip[prop.owner] > 0) {
        this.log(state, `🍀 Majitel ${tile.name} je mimo hru, nájem se neplatí.`);
        return;
      }
      const rent = this.rentOf(state, tile);
      state.money[uid] -= rent;
      state.money[prop.owner] += rent;
      this.log(state, `💸 ${this.name(ctx, uid)} platí ${rent} DK za ${tile.name}`);
      return this.checkOut(state, ctx);
    }
  },

  // ── Koupě, stavba, konec tahu ──────────────────────────────
  buy(state, uid, ctx) {
    if (state.pendingBuy === null) return;
    const tile = TILES[state.pendingBuy];
    if (state.money[uid] < tile.price) return this.say(ctx, uid, 'Nemáš dost peněz.');
    state.money[uid] -= tile.price;
    state.properties[tile.id].owner = uid;
    state.pendingBuy = null;
    this.log(state, `🏇 ${this.name(ctx, uid)} koupil ${tile.name} za ${tile.price} DK`);
  },

  skipBuy(state, uid, ctx) {
    if (state.pendingBuy === null) return;
    this.log(state, `⏭️ ${this.name(ctx, uid)} nekoupil ${TILES[state.pendingBuy].name}`);
    state.pendingBuy = null;
  },

  build(state, uid, tileId, ctx) {
    const tile = TILES[tileId];
    const prop = tile && state.properties[tileId];
    if (!prop || prop.owner !== uid || tile.type !== 'horse') return;
    if (state.pendingBuy !== null || state.trade) return;
    if (!this.ownsGroup(state, uid, tile.group)) return this.say(ctx, uid, 'Musíš vlastnit celou skupinu.');
    if (prop.level >= D.MAX_LEVEL) return;
    if (state.money[uid] < tile.build) return this.say(ctx, uid, 'Nemáš dost peněz.');

    state.money[uid] -= tile.build;
    prop.level++;
    this.log(state, `🏗️ ${this.name(ctx, uid)} staví na ${tile.name} (úroveň ${prop.level})`);
  },

  // ── Prodej bance ───────────────────────────────────
  // Kurz se mění každé kolo (SELL_MIN–SELL_MAX %), takže stejná karta
  // může vynést 80 % ceny i jen 40 %. Prodávat jde kdykoliv – i když
  // je na tahu někdo jiný – proto se to řeší mimo přepínač tahu.
  sellPrice(state, tile, token) {
    const zaklad = token ? tile.build : tile.price;
    return Math.round(zaklad * state.rate / 100);
  },

  sell(state, uid, msg, ctx) {
    if (state.out[uid]) return;
    const id = Number(msg.tile);
    const tile = TILES[id];
    const prop = tile && state.properties[id];
    if (!prop || prop.owner !== uid) return this.say(ctx, uid, 'Tohle nevlastníš.');

    // Karta ležící na trhu se prodat nesmí – jinak by šlo přijmout obchod
    // za něco, co už mezitím shrábla banka.
    const naTrhu = state.trade
      && ((state.trade.maker === uid && state.trade.props.includes(id))
          || state.trade.offers?.[uid]?.props?.includes(id));
    if (naTrhu) return this.say(ctx, uid, 'Tahle karta je vystavená na trhu.');

    // Žeton zůstává na každé kartače – nejdřív se rozprodá stavba.
    if (prop.level > 0) {
      const za = this.sellPrice(state, tile, true);
      prop.level--;
      state.money[uid] += za;
      this.log(state, `🔨 ${this.name(ctx, uid)} prodal žeton z ${tile.name} za ${za} DK (kurz ${state.rate} %)`);
      return;
    }

    const za = this.sellPrice(state, tile, false);
    prop.owner = null;
    state.money[uid] += za;
    this.log(state, `💰 ${this.name(ctx, uid)} prodal ${tile.name} bance za ${za} DK (kurz ${state.rate} %)`);
  },

  // Co se teď dá prodat a za kolik – klient z toho kreslí tlačítka.
  sellable(state, uid) {
    if (state.out[uid]) return {};
    const out = {};
    for (const id of Object.keys(state.properties)) {
      const prop = state.properties[id];
      if (prop.owner !== uid) continue;
      const tile = TILES[+id];
      const naTrhu = state.trade
        && ((state.trade.maker === uid && state.trade.props.includes(+id))
            || state.trade.offers?.[uid]?.props?.includes(+id));
      if (naTrhu) continue;
      out[id] = { token: prop.level > 0, za: this.sellPrice(state, tile, prop.level > 0) };
    }
    return out;
  },

  endTurn(state, uid, ctx) {
    if (state.phase !== 'action' || state.pendingBuy !== null) return;
    if (state.again) {
      state.again = false;
      state.phase = 'roll';
      state.deadline = Date.now() + D.TURN_MS;
      return;
    }
    this.advance(state, ctx);
  },

  advance(state, ctx) {
    state.phase = 'roll';
    state.again = false;
    state.pendingBuy = null;
    let n = 0;
    do {
      state.turn = (state.turn + 1) % state.seats.length;
      if (state.turn === 0) {
        state.round++;                          // nové kolo
        // Banka přecení výkup. Kdo se chce zbavit karty draho, čeká na
        // dobré kolo; kdo potřebuje peníze hned, bere, co je.
        if (ctx?.rng) state.rate = ctx.rng.int(D.SELL_MIN, D.SELL_MAX);
        this.log(state, `📉 Nové kolo ${state.round}: výkupní kurz banky ${state.rate} %`);
      }
      n++;
    } while (state.out[this.cur(state)] && n <= state.seats.length);
    state.tries[this.cur(state)] = 0;
    state.deadline = Date.now() + D.TURN_MS;
  },

  // ── Bankrot a konec ────────────────────────────────────────
  checkOut(state, ctx) {
    for (const uid of state.seats) {
      if (state.out[uid] || state.money[uid] >= 0) continue;
      state.out[uid] = true;
      this.log(state, `💀 BANKROT! ${this.name(ctx, uid)} končí.`);
      for (const id of Object.keys(state.properties)) {
        if (state.properties[id].owner === uid) {
          state.properties[id].owner = null;
          state.properties[id].level = 0;
        }
      }
      if (state.trade && (state.trade.maker === uid || state.trade.offers[uid])) {
        if (state.trade.maker === uid) state.trade = null;
        else delete state.trade.offers[uid];
      }
    }
    // Zkrachoval ten, kdo byl zrovna na tahu? Pak musí pořadí popojet,
    // jinak hra zůstane viset na mrtvém hráči – nikdo už za něj nezahraje.
    if (this.alive(state).length > 1 && state.out[this.cur(state)]) this.advance(state, ctx);
  },

  // ── Obchod ─────────────────────────────────────────────────
  // Nabízet se dá jen to, na čem nestojí žetony – jinak by se
  // dala obejít podmínka "stavět smí jen majitel celé skupiny".
  tradable(state, uid) {
    return Object.keys(state.properties)
      .filter(id => state.properties[id].owner === uid && state.properties[id].level === 0)
      .map(Number);
  },

  tradeOpen(state, uid, msg, ctx) {
    if (state.trade || state.out[uid]) return;
    const money = Math.max(0, Math.floor(msg.money || 0));
    const mine = new Set(this.tradable(state, uid));
    const props = (msg.props || []).map(Number).filter(id => mine.has(id));
    if (money > state.money[uid]) return this.say(ctx, uid, 'Nemáš tolik peněz.');
    if (!money && !props.length) return;
    state.trade = { maker: uid, money, props, offers: {}, until: Date.now() + D.TRADE_MS };
    this.log(state, `📣 ${this.name(ctx, uid)} vyvěsil nabídku na trh.`);
  },

  tradeOffer(state, uid, msg, ctx) {
    const t = state.trade;
    if (!t || t.maker === uid || state.out[uid]) return;
    const money = Math.max(0, Math.floor(msg.money || 0));
    const mine = new Set(this.tradable(state, uid));
    const props = (msg.props || []).map(Number).filter(id => mine.has(id));
    if (money > state.money[uid]) return this.say(ctx, uid, 'Nemáš tolik peněz.');
    if (!money && !props.length) { delete t.offers[uid]; return; }
    t.offers[uid] = { money, props };
  },

  tradeAccept(state, uid, msg, ctx) {
    const t = state.trade;
    if (!t || t.maker !== uid) return;
    const other = msg.uid;
    const off = t.offers?.[other];
    if (!off) return;

    // Mezitím mohl kdokoliv o majetek nebo peníze přijít – ověř znovu.
    const stillMine = (owner, ids) => ids.every(id => state.properties[id]?.owner === owner);
    if (state.money[uid] < t.money || state.money[other] < off.money
      || !stillMine(uid, t.props) || !stillMine(other, off.props)) {
      this.log(state, '❌ Obchod padl – něco se mezitím změnilo.');
      state.trade = null;
      return;
    }

    state.money[uid] += off.money - t.money;
    state.money[other] += t.money - off.money;
    for (const id of t.props) state.properties[id].owner = other;
    for (const id of off.props) state.properties[id].owner = uid;
    this.log(state, `🤝 Obchod uzavřen: ${this.name(ctx, uid)} × ${this.name(ctx, other)}`);
    state.trade = null;
  },

  tradeCancel(state, uid, ctx) {
    const t = state.trade;
    if (!t) return;
    if (t.maker === uid) { state.trade = null; this.log(state, '🚫 Trh zrušen.'); }
    else delete t.offers[uid];
  },

  // Pošle hlášku konkrétnímu hráči. Dřív tu bylo ctx.reject({ws:null}),
  // což byl tichý no-op – hráč se nedozvěděl, proč akce neprošla.
  say(ctx, uid, msg) {
    const p = ctx.players?.find(x => x.uid === uid);
    if (p) ctx.reject?.(p, msg);
  },

  name(ctx, uid) {
    return ctx.players.find(p => p.uid === uid)?.name || 'Hráč';
  },

  // ── Časovač tahu ───────────────────────────────────────────
  tick(state, dt, ctx) {
    if (state.over) return;

    // Nabídka na trhu se po čase sama sundá – jinak by opuštěný trh
    // (hráč odešel, boti neobchodují) zablokoval obchodování všem.
    if (state.trade && Date.now() > state.trade.until) {
      this.log(state, '⌛ Nabídka na trhu vypršela.');
      state.trade = null;
    }

    if (Date.now() < state.deadline) return;
    const uid = this.cur(state);
    const p = ctx.players.find(x => x.uid === uid);
    if (!p) return;
    // po vypršení odehraje tah bot – hra se kvůli jednomu člověku nezasekne
    // Jakmile člověku vyprší čas, dohraje za něj bot celý tah svižně.
    // Příznak drží, dokud se pořadí neposune dál – jinak by se čekalo
    // celých 75 s na každý dílčí krok (hod, koupit/nekoupit, ukončit).
    if (!p.bot) state.autoUid = uid;
    const mv = this.botThink(state, { ...p, botLevel: p.botLevel || 'normal' }, ctx);
    if (mv) this.onAction(state, p, mv, ctx);

    // Tempo dalšího tiku se řídí tím, kdo je na tahu TEĎ – akce mohla
    // pořadí posunout. Bez toho dostal člověk po botovi jen 4 vteřiny
    // a bot mu tah odehrál pod rukama.
    const nyni = this.cur(state);
    if (state.autoUid && state.autoUid !== nyni) state.autoUid = null;
    const dalsi = ctx.players.find(x => x.uid === nyni);
    const clovekCeka = dalsi && !dalsi.bot && state.autoUid !== nyni;
    state.deadline = Date.now() + (clovekCeka ? D.TURN_MS : 4000);
  },

  // ── Bot ────────────────────────────────────────────────────
  botThink(state, player, ctx) {
    if (state.over) return null;
    const uid = player.uid;
    if (this.cur(state) !== uid || state.out[uid]) return null;

    // Docházejí peníze? Radši něco zpeněžit, než při dalším nájmu
    // zkrachovat. Každé volání pustí nejvýš jednu položku a ta ze
    // seznamu zmizí, takže se to nezacyklí.
    if (state.money[uid] < 1500) {
      const nabidka = this.sellable(state, uid);
      // Nejdřív to nejlevnější – drahé karty se hodí na nájmy.
      const nejlevnejsi = Object.keys(nabidka)
        .sort((a, b) => nabidka[a].za - nabidka[b].za)[0];
      if (nejlevnejsi !== undefined) return { a: 'sell', tile: Number(nejlevnejsi) };
    }

    if (state.pendingBuy !== null) {
      const tile = TILES[state.pendingBuy];
      const rezerva = { easy: 1000, normal: 2500, hard: 4000 }[player.botLevel] ?? 2500;
      // Kolik karet ze skupiny už mám – čím víc, tím spíš doplatit.
      const vSkupine = tile.group
        ? TILES.filter(t => t.group === tile.group && state.properties[t.id]?.owner === uid).length
        : 0;
      const dokonci = tile.group && this.wouldComplete(state, uid, tile);
      // hard si nechá polštář na nájmy, easy nakupuje bezhlavě
      const chce = dokonci
        || (vSkupine > 0 && state.money[uid] - tile.price >= rezerva * 0.4)
        || state.money[uid] - tile.price >= rezerva;
      // Podmínka "na co mám" musí být poslední slovo. Bez ní bot chtěl
      // kartu, na kterou neměl, server ji odmítl a pendingBuy zůstal
      // viset – v testu z toho bylo 60 tisíc pokusů o koupi.
      const staciNa = state.money[uid] >= tile.price;
      return { a: chce && staciNa ? 'buy' : 'skip' };
    }

    if (state.phase === 'roll') return { a: 'roll' };

    // před koncem tahu zkus postavit, pokud to dává smysl
    if (player.botLevel !== 'easy') {
      const kandidat = this.bestBuild(state, uid, player.botLevel);
      if (kandidat !== null) return { a: 'build', tile: kandidat };
    }
    return { a: 'end' };
  },

  wouldComplete(state, uid, tile) {
    if (!tile.group) return false;
    return TILES.filter(t => t.group === tile.group && t.id !== tile.id)
      .every(t => state.properties[t.id]?.owner === uid);
  },

  bestBuild(state, uid, level) {
    const rezerva = level === 'hard' ? 3000 : 6000;
    let best = null, bestRent = -1;
    for (const g of GROUPS) {
      if (!this.ownsGroup(state, uid, g)) continue;
      for (const t of TILES.filter(x => x.group === g)) {
        const prop = state.properties[t.id];
        if (prop.level >= D.MAX_LEVEL) continue;
        if (state.money[uid] - t.build < rezerva) continue;
        // stav rovnoměrně: nejdřív tam, kde je nejmíň žetonů
        const zisk = t.rent[prop.level + 1] - t.rent[prop.level];
        const skore = zisk - prop.level * 1000;
        if (skore > bestRent) { bestRent = skore; best = t.id; }
      }
    }
    return best;
  },

  // ── Pohled ─────────────────────────────────────────────────
  // Desková hra je veřejná – všichni vidí totéž, jen s vlastním uid.
  view(state, uid) {
    return {
      seats: state.seats,
      money: state.money, pos: state.pos, out: state.out,
      skip: state.skip, trapped: state.trapped,
      properties: state.properties,
      turn: state.turn, onTurn: this.cur(state),
      round: state.round, maxRounds: D.MAX_ROUNDS,
      rate: state.rate, sellable: this.sellable(state, uid),
      worth: Object.fromEntries(state.seats.map(u => [u, this.worth(state, u)])),
      phase: state.phase, die: state.die, again: state.again,
      pendingBuy: state.pendingBuy, parking: state.parking,
      trade: state.trade,
      tradeMsLeft: state.trade ? Math.max(0, state.trade.until - Date.now()) : 0,
      logs: state.logs.slice(-40),
      lastCard: state.lastCard,
      me: uid, myTurn: this.cur(state) === uid,
      msLeft: Math.max(0, state.deadline - Date.now()),
      canBuild: this.buildable(state, uid),
    };
  },

  // Které koně smí hráč zrovna vylepšit – klient z toho jen kreslí tlačítko.
  buildable(state, uid) {
    if (this.cur(state) !== uid || state.pendingBuy !== null || state.trade) return [];
    const out = [];
    for (const g of GROUPS) {
      if (!this.ownsGroup(state, uid, g)) continue;
      for (const t of TILES.filter(x => x.group === g)) {
        const prop = state.properties[t.id];
        if (prop.level < D.MAX_LEVEL && state.money[uid] >= t.build) out.push(t.id);
      }
    }
    return out;
  },

  // Čisté jmění = hotovost + ceny karet + to, co je do nich zastavěno.
  worth(state, uid) {
    let v = state.money[uid];
    for (const id of Object.keys(state.properties)) {
      const p = state.properties[id];
      if (p.owner !== uid) continue;
      v += TILES[id].price + p.level * (TILES[id].build || 0);
    }
    return v;
  },

  result(state) {
    const zivi = this.alive(state);
    if (!zivi.length) { state.over = true; return { draw: true, reason: 'Zkrachovali všichni.' }; }
    if (zivi.length === 1) {
      state.over = true;
      return { winners: [zivi[0]], reason: 'Všichni ostatní zkrachovali.' };
    }
    if (state.round <= D.MAX_ROUNDS) return null;

    // Po limitu kol rozhoduje majetek, ne poslední přeživší.
    const podle = [...zivi].sort((a, b) => this.worth(state, b) - this.worth(state, a));
    const top = this.worth(state, podle[0]);
    const shodni = podle.filter(u => this.worth(state, u) === top);
    state.over = true;
    if (shodni.length > 1) return { draw: true, reason: `Remíza na ${top.toLocaleString('cs')} DK.` };
    return {
      winners: [podle[0]],
      reason: `Po ${D.MAX_ROUNDS} kolech má nejvyšší jmění ${top.toLocaleString('cs')} DK.`,
    };
  },

  onPlayerGone(state, player, ctx) {
    const uid = player.uid;
    if (!state.out[uid]) {
      state.out[uid] = true;
      for (const id of Object.keys(state.properties)) {
        if (state.properties[id].owner === uid) {
          state.properties[id].owner = null;
          state.properties[id].level = 0;
        }
      }
      state.logs.push(`💀 ${player.name} opustil hru, majetek propadá bance.`);
    }
    if (state.trade?.maker === uid) state.trade = null;
    // Skutečný ctx, ne atrapa: `advance` z něj losuje nový výkupní kurz.
    if (this.cur(state) === uid) this.advance(state, ctx || { players: [] });
  },
};
