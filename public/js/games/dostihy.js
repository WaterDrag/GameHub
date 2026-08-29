// ─────────────────────────────────────────────────────────────
//  Dostihy a sázky – klient.
//
//  Jenom kreslí a posílá akce. Kostku hází server, peníze počítá
//  server, vlastnictví hlídá server. Kdo si tady v konzoli přepíše
//  hotovost, uvidí svoji lež do příštího snapshotu.
//
//  Deska je DOM, ne Pixi – karty, tabulky a modály se v HTML dělají
//  o dost líp než na plátně. Mřížka se staví jednou a pak se mění
//  jen to, co se opravdu hýbe.
// ─────────────────────────────────────────────────────────────
import {
  D, TILES, GROUP_COLORS, GROUP_NAMES, GROUPS, RENT_LABELS, PLAYER_COLORS, gridPos,
} from '/shared/games/dostihy/const.js';

const kc = (n) => (n ?? 0).toLocaleString('cs') + ' DK';
const isProp = (t) => t.type === 'horse' || t.type === 'trainer' || t.type === 'service';
const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export default {
  id: 'dostihy',

  async mount(ctx) {
    this.ctx = ctx;
    this.view = ctx.view;
    this.seatColor = {};
    this.lastDie = null;
    this.lastCardAt = 0;
    this.openTile = null;

    // Plátno tahle hra nepotřebuje – schováme ho, ať nesvítí pod deskou.
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = 'none';

    const host = ctx.hud.parentElement || document.body;
    this.root = document.createElement('div');
    this.root.className = 'dh';
    host.appendChild(this.root);

    this.root.innerHTML = `
      <aside class="dh-side">
        <div class="dh-label">Hráči</div>
        <div class="dh-players" id="dhPlayers"></div>
        <div class="dh-label">Protokol</div>
        <div class="dh-log" id="dhLog"></div>
      </aside>
      <div class="dh-boardwrap">
        <div class="dh-board" id="dhBoard">
          <div class="dh-center">
            <div class="dh-logo">
              <b>DOSTIHY</b><span>a sázky</span>
            </div>
            <div class="dh-rate" id="dhRate"></div>
            <div class="dh-die" id="dhDie">⚀</div>
            <div class="dh-buy" id="dhBuy"></div>
            <div class="dh-acts">
              <button class="dh-btn" id="dhMain"></button>
              <button class="dh-btn ok" id="dhBuyBtn">🏇 Koupit</button>
              <button class="dh-btn gray" id="dhSkipBtn">✗ Nekupovat</button>
              <button class="dh-btn blue" id="dhTradeBtn">🤝 Trh</button>
            </div>
            <div class="dh-timer" id="dhTimer"></div>
          </div>
        </div>
      </div>
      <div class="dh-modal" id="dhTileModal"></div>
      <div class="dh-modal" id="dhProfModal"></div>
      <div class="dh-modal" id="dhTradeModal"></div>
      <div class="dh-toast" id="dhToast"></div>
      <div class="dh-banner" id="dhBanner"></div>
    `;

    this.buildBoard();
    this.bind();
    this.render(ctx.view);
  },

  // ── Deska se staví jednou ──────────────────────────────────
  buildBoard() {
    const board = this.root.querySelector('#dhBoard');
    for (const t of TILES) {
      const g = gridPos(t.id);
      const el = document.createElement('div');
      // Strana desky – podle ní se barevny pruh otoci dovnitr,
      // stejne jako na skutecne desce.
      const strana = t.id <= 10 ? 'b' : t.id <= 20 ? 'l' : t.id <= 30 ? 't' : 'r';
      el.className = `dh-cell dh-${t.type} dh-side-${strana}`;
      el.style.gridColumn = g.col;
      el.style.gridRow = g.row;
      el.dataset.id = t.id;

      if (isProp(t)) {
        const col = GROUP_COLORS[t.group] || GROUP_COLORS[t.type];
        el.innerHTML = `
          <div class="dh-strip" style="background:${col}"></div>
          <div class="dh-cbody">
            <div class="dh-cname">${t.name}</div>
            <div class="dh-cprice">${t.price}</div>
          </div>
          <div class="dh-tokens" data-tok="${t.id}"></div>
          <div class="dh-owner" data-own="${t.id}"></div>`;
      } else if (t.type === 'corner') {
        el.innerHTML = `<div class="dh-clabel">${t.name}</div>${t.id === 20 ? '<div class="dh-pot" id="dhPot">0 DK</div>' : ''}`;
      } else {
        const ico = t.type === 'card' ? (t.name === 'Finance' ? '🃏' : '🎴') : t.type === 'tax' ? '🩺' : '🏁';
        el.innerHTML = `<div class="dh-cbody"><div class="dh-cico">${ico}</div><div class="dh-cname">${t.name}</div></div>`;
      }
      el.onclick = () => { if (isProp(t)) this.showTile(t.id); };
      board.appendChild(el);
    }
  },

  bind() {
    const q = (id) => this.root.querySelector(id);
    q('#dhMain').onclick = () => {
      const v = this.view;
      if (!v.myTurn) return;
      this.send(v.phase === 'roll' ? { a: 'roll' } : { a: 'end' });
    };
    q('#dhBuyBtn').onclick = () => this.send({ a: 'buy' });
    q('#dhSkipBtn').onclick = () => this.send({ a: 'skip' });
    q('#dhTradeBtn').onclick = () => this.showTrade();
    for (const m of this.root.querySelectorAll('.dh-modal')) {
      m.onmousedown = (e) => { if (e.target === m) m.classList.remove('open'); };
    }
  },

  send(msg) { this.ctx.send('action', msg); },

  update(view) { this.view = view; this.render(view); },

  name(uid) {
    return this.ctx.players.find(p => p.uid === uid)?.name || 'Hráč';
  },
  isBot(uid) { return !!this.ctx.players.find(p => p.uid === uid)?.bot; },
  // Clovek, za ktereho prave hraje bot (necinnost nebo odpojeni).
  jeZastoupeny(uid) { return !!this.ctx.players.find(p => p.uid === uid)?.botControlled; },
  color(uid) {
    const i = this.view.seats.indexOf(uid);
    return PLAYER_COLORS[i] || '#888';
  },

  // ── Překreslení ────────────────────────────────────────────
  render(v) {
    this.renderPlayers(v);
    this.renderProps(v);
    this.renderTokens(v);
    this.renderCenter(v);
    this.renderLog(v);
    this.renderTrade(v);

    const pot = this.root.querySelector('#dhPot');
    if (pot) pot.textContent = kc(v.parking);

    // kostka se zatřese jen když se opravdu změnila
    const die = this.root.querySelector('#dhDie');
    die.textContent = DICE[(v.die || 1) - 1];
    if (this.lastDie !== null && this.lastDie !== v.die) {
      die.classList.remove('roll');
      void die.offsetWidth;
      die.classList.add('roll');
    }
    this.lastDie = v.die;

    if (v.lastCard && v.lastCard.at !== this.lastCardAt) {
      this.lastCardAt = v.lastCard.at;
      this.toast(v.lastCard);
    }
    if (this.openTile !== null) this.showTile(this.openTile, true);
  },

  renderPlayers(v) {
    const box = this.root.querySelector('#dhPlayers');
    box.innerHTML = '';
    v.seats.forEach((uid) => {
      const el = document.createElement('div');
      const stav = v.out[uid] ? ' out' : (v.trapped[uid] || v.skip[uid] > 0) ? ' held' : '';
      el.className = `dh-p${uid === v.onTurn ? ' on' : ''}${stav}`;
      const majetek = Object.values(v.properties).filter(p => p.owner === uid).length;
      const skupiny = GROUPS.filter(g =>
        TILES.filter(t => t.group === g).every(t => v.properties[t.id]?.owner === uid));

      let popis = '';
      if (this.jeZastoupeny(uid)) popis = '<span class="dh-tag bot">🤖 hraje za něj bot</span>';
      if (v.out[uid]) popis = '<span class="dh-tag bad">💀 zkrachoval</span>';
      else if (v.trapped[uid]) popis = '<span class="dh-tag bad">🔒 na Distanci</span>';
      else if (v.skip[uid] > 0) popis = `<span class="dh-tag bad">⏳ stojí ${v.skip[uid]} kola</span>`;

      el.innerHTML = `
        <div class="dh-pname"><i style="background:${this.color(uid)}"></i>${this.name(uid)}${this.isBot(uid) || this.jeZastoupeny(uid) ? ' 🤖' : ''}</div>
        <div class="dh-pmoney">${v.out[uid] ? '—' : kc(v.money[uid])}</div>
        <div class="dh-pmeta">${majetek} karet · klikni pro profil</div>
        <div class="dh-pgroups">${skupiny.map(g => `<b style="background:${GROUP_COLORS[g]}"></b>`).join('')}</div>
        ${popis}`;
      el.onclick = () => this.showProfile(uid);
      box.appendChild(el);
    });
  },

  renderProps(v) {
    for (const t of TILES) {
      if (!isProp(t)) continue;
      const prop = v.properties[t.id];
      const bar = this.root.querySelector(`[data-own="${t.id}"]`);
      if (bar) bar.style.background = prop.owner ? this.color(prop.owner) : 'transparent';
      const tok = this.root.querySelector(`[data-tok="${t.id}"]`);
      if (tok) {
        tok.innerHTML = prop.level >= D.MAX_LEVEL
          ? '<b class="stable"></b>'
          : '<b></b>'.repeat(prop.level);
      }
    }
  },

  renderTokens(v) {
    for (const e of this.root.querySelectorAll('.dh-token')) e.remove();
    v.seats.forEach((uid, i) => {
      if (v.out[uid]) return;
      const cell = this.root.querySelector(`.dh-cell[data-id="${v.pos[uid]}"]`);
      if (!cell) return;
      const t = document.createElement('div');
      t.className = 'dh-token';
      t.style.background = this.color(uid);
      t.style.left = `${18 + (i % 3) * 26}%`;
      t.style.top = `${58 + Math.floor(i / 3) * 24}%`;
      t.title = this.name(uid);
      cell.appendChild(t);
    });
  },

  renderCenter(v) {
    const q = (id) => this.root.querySelector(id);
    const main = q('#dhMain'), buy = q('#dhBuyBtn'), skip = q('#dhSkipBtn'), trade = q('#dhTradeBtn');
    const info = q('#dhBuy');

    const kupuje = v.pendingBuy !== null;
    buy.style.display = kupuje && v.myTurn ? '' : 'none';
    skip.style.display = kupuje && v.myTurn ? '' : 'none';
    main.style.display = kupuje ? 'none' : '';
    trade.style.display = kupuje ? 'none' : '';

    if (kupuje) {
      const t = TILES[v.pendingBuy];
      info.classList.add('open');
      info.innerHTML = v.myTurn
        ? `<div class="dh-buyname">🏇 ${t.name}</div><div class="dh-buyprice">${kc(t.price)}</div>`
        : `<div class="dh-buyname">${this.name(v.onTurn)} rozhoduje…</div><div class="dh-buyprice">${t.name} · ${kc(t.price)}</div>`;
      buy.disabled = v.money[v.me] < t.price;
    } else {
      info.classList.remove('open');
      info.innerHTML = '';
    }

    // Trh je vedlejší kanál – server hod kostkou během něj povoluje,
    // tak ho neblokuj ani tady. Dřív stačila jedna zapomenutá nabídka
    // a nikdo nemohl hrát.
    main.disabled = !v.myTurn;
    trade.disabled = !!v.trade || v.out[v.me];
    main.className = 'dh-btn';
    if (!kupuje) {
      if (v.skip[v.onTurn] > 0) { main.textContent = `Odpykat trest (${v.skip[v.onTurn]})`; main.classList.add('red'); }
      else if (v.trapped[v.onTurn] && v.phase === 'roll') main.textContent = '🎲 Hodit 6 (Distanc)';
      else if (v.phase === 'roll') main.textContent = '🎲 Hodit kostkou';
      else { main.textContent = v.again ? '🎲 Hodit znovu (padla 6!)' : '✓ Ukončit tah'; if (!v.again) main.classList.add('ok'); }
    }

    const r = q('#dhRate');
    if (r) r.innerHTML = `Výkup <b>${v.rate} %</b> ceny <small>· kolo ${v.round}/${v.maxRounds}</small>`;

    const t = q('#dhTimer');
    if (v.myTurn && v.msLeft < 30000) t.textContent = `⏱ ${Math.ceil(v.msLeft / 1000)} s na tah`;
    else t.textContent = v.myTurn ? 'Jsi na tahu' : `Hraje ${this.name(v.onTurn)}`;
  },

  renderLog(v) {
    const box = this.root.querySelector('#dhLog');
    const dole = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    box.innerHTML = v.logs.map(m => `<div>${m}</div>`).join('');
    if (dole) box.scrollTop = box.scrollHeight;
  },

  toast(card) {
    const el = this.root.querySelector('#dhToast');
    el.innerHTML = `
      <div class="dh-tt">${card.deck === 'finance' ? '🃏 Finance' : '🎴 Náhoda'}</div>
      <div class="dh-tx">${card.text}</div>
      ${card.val ? `<div class="dh-tv" style="color:${card.val > 0 ? '#66bb6a' : '#ef5350'}">${card.val > 0 ? '+' : ''}${kc(card.val)}</div>` : ''}`;
    el.classList.add('open');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => el.classList.remove('open'), 4200);
  },

  // ── Kartička pole ──────────────────────────────────────────
  showTile(id, tichy) {
    const v = this.view;
    const t = TILES[id];
    const prop = v.properties[id];
    if (!prop) return;
    this.openTile = id;

    const col = GROUP_COLORS[t.group] || GROUP_COLORS[t.type];
    const gname = GROUP_NAMES[t.group] || GROUP_NAMES[t.type];
    const muzeStavet = (v.canBuild || []).includes(id);
    const prodej = (v.sellable || {})[id];   // {token, za} nebo undefined

    let telo;
    if (t.type === 'horse') {
      telo = `
        <div class="dh-toks">${prop.level >= D.MAX_LEVEL ? '<b class="stable"></b>' : '<b></b>'.repeat(prop.level) || '<span class="dim">bez žetonů</span>'}</div>
        <div class="dh-tags"><span class="hi">${kc(t.price)}</span><span>+${kc(t.build)}/žeton</span></div>
        <table class="dh-rent">${t.rent.map((r, i) => `
          <tr class="${i === prop.level ? 'cur' : ''}"><td>${RENT_LABELS[i]}</td><td>${kc(r)}</td></tr>`).join('')}</table>`;
    } else {
      telo = `<p class="dh-desc">${t.type === 'trainer' ? 'Nájem roste s počtem vlastněných trenérů.' : 'Nájem roste s počtem vlastněných služeb.'}</p>
        <div class="dh-tags"><span class="hi">${kc(t.price)}</span></div>`;
    }

    const m = this.root.querySelector('#dhTileModal');
    m.innerHTML = `
      <div class="dh-card">
        <div class="dh-chead" style="background:${col}">
          <small>${gname}</small><b>${t.name}</b>
        </div>
        <div class="dh-cbody2">
          <div class="dh-own ${prop.owner ? '' : 'free'}">${prop.owner
            ? `<i style="background:${this.color(prop.owner)}"></i>Vlastní ${this.name(prop.owner)}`
            : 'Volná karta'}</div>
          ${telo}
        </div>
        <div class="dh-cfoot">
          ${muzeStavet ? `<button class="dh-btn ok" id="dhBuild">🏗️ Postavit za ${kc(t.build)}</button>` : ''}
          ${prodej ? `<button class="dh-btn red" id="dhSell">🔨 Prodat ${prodej.token ? 'žeton' : 'bance'} za ${kc(prodej.za)}</button>` : ''}
          <button class="dh-btn gray" id="dhCloseTile">Zavřít</button>
        </div>
      </div>`;
    m.classList.add('open');
    m.querySelector('#dhCloseTile').onclick = () => { this.openTile = null; m.classList.remove('open'); };
    const b = m.querySelector('#dhBuild');
    if (b) b.onclick = () => { this.send({ a: 'build', tile: id }); };
    const pr = m.querySelector('#dhSell');
    if (pr) pr.onclick = () => { this.send({ a: 'sell', tile: id }); };
    if (!tichy) m.scrollTop = 0;
  },

  // ── Profil hráče ───────────────────────────────────────────
  showProfile(uid) {
    const v = this.view;
    const vlastni = Object.keys(v.properties)
      .filter(id => v.properties[id].owner === uid)
      .map(id => ({ t: TILES[+id], lvl: v.properties[id].level }));
    const kone = vlastni.filter(o => o.t.type === 'horse');
    const ostatni = vlastni.filter(o => o.t.type !== 'horse');
    const hodnota = vlastni.reduce((s, o) => s + o.t.price, 0);

    const karta = ({ t, lvl }) => {
      const col = GROUP_COLORS[t.group] || GROUP_COLORS[t.type];
      const gname = GROUP_NAMES[t.group] || GROUP_NAMES[t.type];
      const toks = t.type === 'horse'
        ? (lvl >= D.MAX_LEVEL ? '<b class="stable"></b>' : '<b></b>'.repeat(lvl) || '<span class="dim">–</span>')
        : '';
      return `<div class="dh-mini">
        <div class="dh-mhead" style="background:${col}">${gname}</div>
        <div class="dh-mbody">
          <div class="dh-mname">${t.name}</div>
          <div class="dh-toks small">${toks}</div>
          <div class="dh-tags"><span class="hi">${kc(t.price)}</span></div>
        </div></div>`;
    };

    const m = this.root.querySelector('#dhProfModal');
    m.innerHTML = `
      <div class="dh-prof">
        <div class="dh-phead">
          <div class="dh-pav" style="background:${this.color(uid)}">${this.name(uid)[0].toUpperCase()}</div>
          <div>
            <div class="dh-pn">${this.name(uid)}${this.isBot(uid) ? ' 🤖' : ''}</div>
            <div class="dh-pm">${v.out[uid] ? 'Zkrachoval' : kc(v.money[uid])}</div>
          </div>
          <button class="dh-btn gray" id="dhCloseProf">✕</button>
        </div>
        <div class="dh-stats">
          <div><b>${kone.length}</b><span>koní</span></div>
          <div><b>${ostatni.length}</b><span>trenéři/služby</span></div>
          <div><b>${kc(hodnota)}</b><span>hodnota karet</span></div>
          <div><b>${v.out[uid] ? '—' : kc(v.money[uid] + hodnota)}</b><span>čisté jmění</span></div>
        </div>
        ${vlastni.length ? `
          ${kone.length ? `<div class="dh-label">🐴 Koně</div><div class="dh-grid">${kone.map(karta).join('')}</div>` : ''}
          ${ostatni.length ? `<div class="dh-label">🎫 Trenéři a služby</div><div class="dh-grid">${ostatni.map(karta).join('')}</div>` : ''}
        ` : '<p class="dh-desc">Nevlastní žádné karty.</p>'}
      </div>`;
    m.classList.add('open');
    m.querySelector('#dhCloseProf').onclick = () => m.classList.remove('open');
  },

  // ── Trh ────────────────────────────────────────────────────
  mojeKarty(v) {
    return Object.keys(v.properties)
      .filter(id => v.properties[id].owner === v.me && v.properties[id].level === 0)
      .map(id => TILES[+id]);
  },

  showTrade() {
    const v = this.view;
    const karty = this.mojeKarty(v);
    const m = this.root.querySelector('#dhTradeModal');
    m.innerHTML = `
      <div class="dh-prof narrow">
        <div class="dh-label">Vypsat nabídku na trh</div>
        <p class="dh-desc">Co nabízíš ostatním? Karty se žetony nabízet nejdou.</p>
        <input type="number" id="dhTMoney" class="dh-input" value="0" min="0" step="500" placeholder="Peníze">
        <div class="dh-checks">${karty.length
          ? karty.map(t => `<label><input type="checkbox" value="${t.id}"><i style="background:${GROUP_COLORS[t.group] || GROUP_COLORS[t.type]}"></i>${t.name} <small>${kc(t.price)}</small></label>`).join('')
          : '<span class="dim">Nemáš volné karty.</span>'}</div>
        <div class="dh-row">
          <button class="dh-btn ok" id="dhTSend">Otevřít trh</button>
          <button class="dh-btn gray" id="dhTClose">Zrušit</button>
        </div>
      </div>`;
    m.classList.add('open');
    m.querySelector('#dhTClose').onclick = () => m.classList.remove('open');
    m.querySelector('#dhTSend').onclick = () => {
      const money = parseInt(m.querySelector('#dhTMoney').value) || 0;
      const props = [...m.querySelectorAll('input[type=checkbox]:checked')].map(c => +c.value);
      if (!money && !props.length) return this.ctx.toast('Musíš něco nabídnout.', 'warn');
      this.send({ a: 'tradeOpen', money, props });
      m.classList.remove('open');
    };
  },

  showOffer() {
    const v = this.view, t = v.trade;
    const karty = this.mojeKarty(v);
    const co = [t.money ? kc(t.money) : null, ...t.props.map(id => TILES[id].name)].filter(Boolean).join(' + ');
    const m = this.root.querySelector('#dhTradeModal');
    m.innerHTML = `
      <div class="dh-prof narrow">
        <div class="dh-label">${this.name(t.maker)} nabízí</div>
        <div class="dh-offer">${co}</div>
        <p class="dh-desc">Co za to nabídneš ty?</p>
        <input type="number" id="dhOMoney" class="dh-input" value="0" min="0" step="500" placeholder="Peníze">
        <div class="dh-checks">${karty.length
          ? karty.map(x => `<label><input type="checkbox" value="${x.id}"><i style="background:${GROUP_COLORS[x.group] || GROUP_COLORS[x.type]}"></i>${x.name} <small>${kc(x.price)}</small></label>`).join('')
          : '<span class="dim">Nemáš volné karty.</span>'}</div>
        <div class="dh-row">
          <button class="dh-btn ok" id="dhOSend">Poslat nabídku</button>
          <button class="dh-btn gray" id="dhOClose">Zavřít</button>
        </div>
      </div>`;
    m.classList.add('open');
    m.querySelector('#dhOClose').onclick = () => m.classList.remove('open');
    m.querySelector('#dhOSend').onclick = () => {
      const money = parseInt(m.querySelector('#dhOMoney').value) || 0;
      const props = [...m.querySelectorAll('input[type=checkbox]:checked')].map(c => +c.value);
      if (!money && !props.length) return this.ctx.toast('Musíš něco nabídnout.', 'warn');
      this.send({ a: 'tradeOffer', money, props });
      m.classList.remove('open');
    };
  },

  renderTrade(v) {
    const ban = this.root.querySelector('#dhBanner');
    const t = v.trade;
    if (!t) { ban.classList.remove('open'); ban.innerHTML = ''; return; }

    const popis = (o) => [o.money ? kc(o.money) : null, ...o.props.map(id => TILES[id].name)]
      .filter(Boolean).join(' + ');
    const zbyva = v.tradeMsLeft ? ` <small>(${Math.ceil(v.tradeMsLeft / 1000)} s)</small>` : '';

    if (t.maker === v.me) {
      const nab = Object.entries(t.offers || {});
      ban.innerHTML = `
        <div class="dh-bhead">🤝 Tvůj trh: <b>${popis(t)}</b>${zbyva}</div>
        ${nab.length
          ? nab.map(([uid, o]) => `<div class="dh-boffer">
              <span style="color:${this.color(uid)}">${this.name(uid)}</span> nabízí <b>${popis(o)}</b>
              <button class="dh-btn ok" data-acc="${uid}">Přijmout</button></div>`).join('')
          : '<div class="dim">Zatím žádné protinabídky…</div>'}
        <button class="dh-btn gray" id="dhTCancel">Zrušit trh</button>`;
      for (const b of ban.querySelectorAll('[data-acc]')) {
        b.onclick = () => this.send({ a: 'tradeAccept', uid: b.dataset.acc });
      }
      ban.querySelector('#dhTCancel').onclick = () => this.send({ a: 'tradeCancel' });
    } else {
      const moje = t.offers?.[v.me];
      ban.innerHTML = `
        <div class="dh-bhead">🤝 <b>${this.name(t.maker)}</b> nabízí <b>${popis(t)}</b>${zbyva}</div>
        ${moje ? `<div class="dim">Poslal jsi: ${popis(moje)}</div>` : ''}
        <button class="dh-btn ${moje ? 'gray' : 'blue'}" id="dhOfferBtn">${moje ? 'Změnit nabídku' : 'Nabídnout'}</button>
        ${moje ? '<button class="dh-btn gray" id="dhOfferCancel">Stáhnout</button>' : ''}`;
      ban.querySelector('#dhOfferBtn').onclick = () => this.showOffer();
      const c = ban.querySelector('#dhOfferCancel');
      if (c) c.onclick = () => this.send({ a: 'tradeCancel' });
    }
    ban.classList.add('open');
  },

  event() { /* efekty chodí ve stavu */ },
  resize() {},

  unmount() {
    clearTimeout(this._tt);
    this.root?.remove();
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = '';
  },
};
