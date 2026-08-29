// ─────────────────────────────────────────────────────────────
//  Šachy – deska v DOM.
//
//  Kreslí a nic nerozhoduje: klikneš na figuru, klient si od serveru
//  vezme seznam legálních tahů a rozsvítí pole. Samotný tah pak jen
//  pošle a čeká, co server odpoví – ten si ho ověří znovu.
// ─────────────────────────────────────────────────────────────
import { naPole, radek, sloupec, BILY, CERNY } from '/shared/games/chess/pravidla.js';

// Figury jsou obrázky uložené u nás (viz public/img/chess/LICENCE.md).
// Původní verze si je tahala z Wikimedie při každém načtení – když byl jejich
// server pomalý, zůstala deska prázdná.
const SOUBOR = { k: 'k', d: 'q', v: 'r', s: 'b', j: 'n', p: 'p' };
const obrazek = (f) => `/img/chess/${f.b === BILY ? 'w' : 'b'}${SOUBOR[f.t]}.svg`;

// Unicode zůstává na zajaté figury a na výběr při proměně – tam stačí.
const ZNAKY = {
  [BILY]: { k: '♔', d: '♕', v: '♖', s: '♗', j: '♘', p: '♙' },
  [CERNY]: { k: '♚', d: '♛', v: '♜', s: '♝', j: '♞', p: '♟' },
};
const JMENA = { k: 'král', d: 'dáma', v: 'věž', s: 'střelec', j: 'jezdec', p: 'pěšec' };

// Vzhledy desky. Drží se u každého hráče zvlášť – je to jeho věc, ne hry.
const MOTIVY = [
  { id: 'zelena',   name: 'Zelená',   svetla: '#ebecd0', tmava: '#779556', ram: '#5c7043' },
  { id: 'drevo',    name: 'Dřevo',    svetla: '#f0d9b5', tmava: '#b58863', ram: '#8a6244' },
  { id: 'modra',    name: 'Modrá',    svetla: '#dee3e6', tmava: '#8ca2ad', ram: '#6b7f8a' },
  { id: 'noc',      name: 'Noc',      svetla: '#7d8a99', tmava: '#37414d', ram: '#232b33' },
];

export default {
  id: 'chess',

  async mount(ctx) {
    this.ctx = ctx;
    this.view = ctx.view;
    this.vybrane = null;
    this.promo = null;

    // Šachovnice je mřížka, ne plátno – Pixi se schová stranou.
    const stage = document.getElementById('stage');
    if (stage) { this.stageDisplay = stage.style.display; stage.style.display = 'none'; }

    const host = document.getElementById('view-game');
    this.root = document.createElement('div');
    this.root.className = 'ch';
    host.appendChild(this.root);

    this.root.innerHTML = `
      <aside class="ch-side">
        <div class="ch-label">Hráči</div>
        <div class="ch-hraci" id="chHraci"></div>
        <div class="ch-label">Zajaté figury</div>
        <div class="ch-zajate" id="chZajate"></div>
        <div class="ch-label">Protokol</div>
        <div class="ch-log" id="chLog"></div>
      </aside>
      <div class="ch-deskawrap">
        <div class="ch-stav" id="chStav"></div>
        <div class="ch-deska" id="chDeska"></div>
        <div class="ch-motivy" id="chMotivy"></div>
      </div>
      <div class="ch-promo hidden" id="chPromo"></div>`;

    this.postavDesku();
    this.postavMotivy();
    this.render(ctx.view);
  },

  // Vzhled desky si drzí každý hráč sám – do hry to nezasahuje,
  // takže ho není proč posílat na server.
  postavMotivy() {
    let ulozeny = null;
    try { ulozeny = localStorage.getItem('gh_sach_motiv'); } catch (e) { /* soukromé okno */ }
    this.motiv = MOTIVY.find(m => m.id === ulozeny) || MOTIVY[0];
    this.nastavMotiv(this.motiv);

    const box = this.root.querySelector('#chMotivy');
    box.innerHTML = MOTIVY.map(m => `
      <button data-m="${m.id}" title="${m.name}" class="${m.id === this.motiv.id ? 'sel' : ''}">
        <i style="background:linear-gradient(135deg,${m.svetla} 50%,${m.tmava} 50%)"></i>
        <span>${m.name}</span>
      </button>`).join('');
    box.onclick = (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const m = MOTIVY.find(x => x.id === b.dataset.m);
      if (!m) return;
      this.motiv = m;
      this.nastavMotiv(m);
      try { localStorage.setItem('gh_sach_motiv', m.id); } catch (er) { /* nevadi */ }
      for (const x of box.querySelectorAll('[data-m]')) x.classList.toggle('sel', x.dataset.m === m.id);
    };
  },

  nastavMotiv(m) {
    const d = this.root.querySelector('#chDeska');
    d.style.setProperty('--sv', m.svetla);
    d.style.setProperty('--tm', m.tmava);
    d.style.setProperty('--ram', m.ram);
  },

  // Deska se staví jednou, pak se mění jen obsah polí.
  postavDesku() {
    const d = this.root.querySelector('#chDeska');
    for (let i = 0; i < 64; i++) {
      const el = document.createElement('div');
      el.className = `ch-pole ${(radek(i) + sloupec(i)) % 2 ? 'tmave' : 'svetle'}`;
      el.dataset.i = i;
      el.innerHTML = '<img class="ch-fig" alt="" draggable="false"><i class="ch-tecka"></i>';
      el.onclick = () => this.klik(i);
      d.appendChild(el);
    }
    this.pole = [...d.children];
  },

  klik(i) {
    const v = this.view;
    if (!v?.myTurn) return;

    // Klik na vlastní figuru = výběr (i když už je něco vybrané).
    const f = v.pole[i];
    if (f && f.b === v.mojeBarva) {
      this.vybrane = this.vybrane === i ? null : i;
      this.render(v);
      return;
    }
    if (this.vybrane === null) return;

    const mozne = (v.tahy || []).filter(t => t.od === this.vybrane && t.na === i);
    if (!mozne.length) { this.vybrane = null; this.render(v); return; }

    // Proměna pěšce – nech vybrat, ať to není vždycky dáma.
    if (mozne.length > 1 && mozne[0].promo) {
      this.promo = { od: this.vybrane, na: i };
      this.render(v);
      return;
    }
    this.posli(mozne[0]);
  },

  posli(t) {
    this.ctx.send('action', { a: 'tah', od: t.od, na: t.na, promo: t.promo || undefined });
    this.vybrane = null;
    this.promo = null;
  },

  update(view) {
    // Po tahu soupeře padá výběr – pozice je jiná.
    if (view.naTahu !== this.view?.naTahu) { this.vybrane = null; this.promo = null; }
    this.view = view;
    this.render(view);
  },

  render(v) {
    if (!v) return;
    const otoc = v.mojeBarva === CERNY;   // černý se dívá ze své strany
    const cile = new Set((v.tahy || []).filter(t => t.od === this.vybrane).map(t => t.na));

    for (let i = 0; i < 64; i++) {
      // Při pohledu za černého je deska otočená o 180°.
      const zobraz = otoc ? 63 - i : i;
      const el = this.pole[i];
      const f = v.pole[zobraz];
      const fig = el.querySelector('.ch-fig');
      const src = f ? obrazek(f) : '';
      if (fig.getAttribute('src') !== src) {
        // Prázdné pole nesmí mít src='' – prohlížeč by na něj poslal další
        // požadavek na stránku samotnou.
        if (src) fig.setAttribute('src', src); else fig.removeAttribute('src');
      }
      fig.style.visibility = f ? '' : 'hidden';
      fig.alt = f ? `${f.b === BILY ? 'bílý' : 'černý'} ${JMENA[f.t]}` : '';
      el.dataset.i = zobraz;
      el.classList.toggle('vybrane', this.vybrane === zobraz);
      el.classList.toggle('cil', cile.has(zobraz));
      el.classList.toggle('bral', cile.has(zobraz) && !!v.pole[zobraz]);
      el.classList.toggle('posledni', !!v.posledni
        && (v.posledni.od === zobraz || v.posledni.na === zobraz));
      el.classList.toggle('sach', v.sach && f?.t === 'k' && f.b === v.naTahu);
      el.title = f ? `${JMENA[f.t]} na ${naPole(zobraz)}` : naPole(zobraz);
    }

    const stav = this.root.querySelector('#chStav');
    const cekaSe = v.myTurn ? 'Jsi na tahu' : 'Na tahu je soupeř';
    stav.innerHTML = `<b>${v.sach ? 'ŠACH! ' : ''}${cekaSe}</b>`
      + `<small>${v.cisloTahu}. tah · ${v.naTahu === BILY ? 'bílý' : 'černý'}</small>`;
    stav.classList.toggle('muj', !!v.myTurn);

    this.renderHraci(v);
    this.renderZajate(v);
    this.renderLog(v);
    this.renderPromo(v);
  },

  renderHraci(v) {
    const box = this.root.querySelector('#chHraci');
    box.innerHTML = (v.seats || []).map(s => {
      const p = this.ctx.players.find(x => x.uid === s.uid);
      const jmeno = (p?.name || 'Hráč') + (p?.bot || p?.botControlled ? ' 🤖' : '');
      return `<div class="ch-hrac ${v.naTahu === s.barva ? 'on' : ''}">
        <i class="${s.barva === BILY ? 'bila' : 'cerna'}"></i>${jmeno}
      </div>`;
    }).join('');
  },

  renderZajate(v) {
    const box = this.root.querySelector('#chZajate');
    const rada = (b) => (v.zajate?.[b] || []).map(t => ZNAKY[b][t]).join('') || '–';
    box.innerHTML = `<div class="ch-zrada cerny">${rada(CERNY)}</div>`
      + `<div class="ch-zrada bily">${rada(BILY)}</div>`;
  },

  renderLog(v) {
    const box = this.root.querySelector('#chLog');
    const podpis = (v.protokol || []).length;
    if (podpis === this.logPodpis) return;
    this.logPodpis = podpis;

    // Dvojice tahů na řádek, jak se to v šachu zapisuje.
    const radky = [];
    for (const z of v.protokol || []) {
      if (z.bily) radky.push({ c: z.cislo, b: z.zapis, cr: '' });
      else if (radky.length) radky[radky.length - 1].cr = z.zapis;
      else radky.push({ c: z.cislo, b: '…', cr: z.zapis });
    }
    box.innerHTML = radky.map(r =>
      `<div><span>${r.c}.</span> ${r.b} <b>${r.cr}</b></div>`).join('');
    box.scrollTop = box.scrollHeight;
  },

  renderPromo(v) {
    const box = this.root.querySelector('#chPromo');
    box.classList.toggle('hidden', !this.promo);
    if (!this.promo) return;
    const moje = (v.tahy || []).filter(t => t.od === this.promo.od && t.na === this.promo.na);
    box.innerHTML = '<div class="ch-promobox"><div>Na co pěšce proměnit?</div><div class="ch-promorada">'
      + moje.map(t => `<button data-p="${t.promo}">${ZNAKY[v.mojeBarva][t.promo]}<span>${JMENA[t.promo]}</span></button>`).join('')
      + '</div></div>';
    for (const b of box.querySelectorAll('[data-p]')) {
      b.onclick = () => this.posli(moje.find(t => t.promo === b.dataset.p));
    }
  },

  event() {},
  resize() {},

  unmount() {
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = this.stageDisplay ?? '';
    this.root?.remove();
  },
};
