// ─────────────────────────────────────────────────────────────
//  Kvak! – rybník 8×8 v DOM mřížce.
//
//  Kreslí a nic nerozhoduje. Kam se smí skočit, říká server v poli
//  `tahy`; klient si to nepočítá sám, aby si nešlo v konzoli povolit
//  skok přes půl desky.
//
//  Co je pod neotočenými kartičkami, se sem vůbec neposílá.
// ─────────────────────────────────────────────────────────────
import {
  STRANA, POLI, ZASOBA, KARTY, BARVY, klic, index,
} from '/shared/games/kvak/const.js';

export default {
  id: 'kvak',

  async mount(ctx) {
    this.ctx = ctx;
    this.view = ctx.view;
    this.vybrana = null;   // {r,c,kralovna} – žába, kterou právě táhnu

    const stage = document.getElementById('stage');
    if (stage) { this.stageDisplay = stage.style.display; stage.style.display = 'none'; }

    const host = document.getElementById('view-game');
    this.root = document.createElement('div');
    this.root.className = 'kv';
    host.appendChild(this.root);

    this.root.innerHTML = `
      <aside class="kv-vlevo">
        <div class="kv-nadpis">Hráči</div>
        <div class="kv-hraci" id="kvHraci"></div>
        <div class="kv-nadpis">Protokol</div>
        <div class="kv-log" id="kvLog"></div>
      </aside>

      <div class="kv-rybnik">
        <div class="kv-deska" id="kvDeska"></div>
        <div class="kv-hlaska hidden" id="kvHlaska"></div>
      </div>

      <aside class="kv-vpravo">
        <div class="kv-stav" id="kvStav">…</div>
        <div class="kv-pokyn" id="kvPokyn"></div>
        <button class="kv-btn hidden" id="kvNeskakat" type="button">Neskákat, končím tah</button>
        <div class="kv-nadpis">Kartičky</div>
        <div class="kv-legenda" id="kvLegenda"></div>
      </aside>`;

    // Deska se staví jednou; překresluje se jen obsah polí.
    const deska = this.root.querySelector('#kvDeska');
    this.pole = [];
    for (let r = 0; r < STRANA; r++) {
      for (let c = 0; c < STRANA; c++) {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'kv-pole';
        d.dataset.r = r;
        d.dataset.c = c;
        d.innerHTML = '<span class="kv-karta"></span><span class="kv-zaby"></span>';
        d.onclick = () => this.klik(r, c);
        deska.append(d);
        this.pole.push(d);
      }
    }

    const leg = this.root.querySelector('#kvLegenda');
    for (const [, k] of Object.entries(KARTY)) {
      const d = document.createElement('div');
      d.className = 'kv-leg';
      d.innerHTML = `<span class="kv-leg-i">${k.emoji}</span>
        <span><b>${k.nazev}</b><small>${k.popis}</small></span>`;
      leg.append(d);
    }

    this.root.querySelector('#kvNeskakat').onclick = () => this.posli({ a: 'skok', r: null });
    this.render(ctx.view);
  },

  posli(msg) { this.ctx.send('action', msg); },

  // ── Kliknutí ───────────────────────────────────────────────
  klik(r, c) {
    const v = this.view;
    if (!v || !v.myTurn) return;

    if (v.faze === 'leknin') {
      if (this.jeMezi(v.cileLekninu, r, c)) this.posli({ a: 'skok', r, c });
      return;
    }
    if (v.faze === 'plozeni') {
      if (this.jeMezi(v.cilePlozeni, r, c)) this.posli({ a: 'plozeni', r, c });
      return;
    }
    if (v.faze !== 'tah') return;

    // Druhé kliknutí = cíl, pokud tam vybraná žába smí.
    if (this.vybrana && this.cileVybrane().some(([tr, tc]) => tr === r && tc === c)) {
      const { r: zr, c: zc, kralovna } = this.vybrana;
      this.vybrana = null;
      return this.posli({ a: 'tah', zr, zc, kralovna, r, c });
    }

    // Jinak vyber (nebo odznač) vlastní žábu.
    const moje = (v.zaby[klic(r, c)] || []).find(z => z.hrac === v.mySeat);
    if (!moje) { this.vybrana = null; return this.render(v); }
    if (this.vybrana && this.vybrana.r === r && this.vybrana.c === c) this.vybrana = null;
    else if (v.tahy.some(t => t.z.r === r && t.z.c === c)) this.vybrana = { r, c, kralovna: moje.kralovna };
    this.render(v);
  },

  jeMezi(seznam, r, c) {
    return (seznam || []).some(([tr, tc]) => tr === r && tc === c);
  },

  cileVybrane() {
    if (!this.vybrana || !this.view) return [];
    return this.view.tahy
      .filter(t => t.z.r === this.vybrana.r && t.z.c === this.vybrana.c)
      .map(t => t.na);
  },

  update(view) {
    // Vybraná žába přežije jen do konce vlastní fáze tahu.
    if (!view.myTurn || view.faze !== 'tah') this.vybrana = null;
    this.view = view;
    this.render(view);
  },

  event(m) {
    if (m?.kind !== 'hlaska' || !m.text) return;
    const el = this.root?.querySelector('#kvHlaska');
    if (!el) return;
    el.textContent = m.text;
    el.classList.remove('hidden');
    clearTimeout(this._hlaskaT);
    this._hlaskaT = setTimeout(() => el.classList.add('hidden'), 3200);
  },

  // ── Vykreslení ─────────────────────────────────────────────
  render(v) {
    if (!v) return;

    const cile = v.faze === 'leknin' ? v.cileLekninu
      : v.faze === 'plozeni' ? v.cilePlozeni
        : this.cileVybrane();
    const lzeTahnout = new Set((v.tahy || []).map(t => `${t.z.r}-${t.z.c}`));

    for (let i = 0; i < POLI; i++) {
      const r = Math.floor(i / STRANA), c = i % STRANA;
      const el = this.pole[i];
      const druh = v.pole[i];
      const zaby = v.zaby[klic(r, c)] || [];

      const podpis = `${druh}|${v.zakazano[i]}|${JSON.stringify(zaby)}`;
      if (el._podpis !== podpis) {
        el._podpis = podpis;
        const karta = el.querySelector('.kv-karta');
        karta.textContent = druh ? KARTY[druh].emoji : '';
        el.className = 'kv-pole' + (druh ? ` odhalene kv-${druh}` : ' skryte')
          + (v.zakazano[i] ? ' zakazane' : '')
          + (zaby.length ? ' ma-zabu' : '');
        el.title = druh ? `${KARTY[druh].nazev} – ${KARTY[druh].popis}` : 'Neotočená kartička';

        const box = el.querySelector('.kv-zaby');
        box.innerHTML = '';
        for (const z of zaby) {
          // Žáby všech hráčů jsou táž emoji, takže barva musí být POD ní
          // jako podstavec. Samá zář kolem obrysu se na desce ztratila.
          const t = document.createElement('span');
          t.className = 'kv-zaba' + (z.kralovna ? ' kralovna' : '');
          t.style.setProperty('--c', BARVY[z.hrac]);
          t.dataset.hrac = z.hrac + 1;
          t.textContent = z.kralovna ? '👑' : '🐸';
          box.append(t);
        }
      }

      el.classList.toggle('vybrana', !!this.vybrana && this.vybrana.r === r && this.vybrana.c === c);
      el.classList.toggle('cil', this.jeMezi(cile, r, c));
      el.classList.toggle('lze', v.myTurn && v.faze === 'tah' && lzeTahnout.has(`${r}-${c}`));
    }

    this.renderHrace(v);
    this.renderPanel(v);

    const log = this.root.querySelector('#kvLog');
    const t = (v.log || []).slice(-8).map(x => `<div>${x}</div>`).join('');
    if (t !== this._log) { this._log = t; log.innerHTML = t; log.scrollTop = log.scrollHeight; }
  },

  renderHrace(v) {
    const box = this.root.querySelector('#kvHraci');
    const pocty = Array.from({ length: v.hracu }, () => ({ zab: 0, kral: 0 }));
    for (const seznam of Object.values(v.zaby)) {
      for (const z of seznam) {
        if (z.kralovna) pocty[z.hrac].kral++; else pocty[z.hrac].zab++;
      }
    }
    const podpis = JSON.stringify(pocty) + '|' + v.naTahu + '|' + JSON.stringify(v.hraci);
    if (podpis === this._podpisHracu) return;
    this._podpisHracu = podpis;

    box.innerHTML = '';
    for (let h = 0; h < v.hracu; h++) {
      const pl = this.ctx.players.find(x => x.uid === v.seats[h]);
      const jmeno = pl?.name || `Hráč ${h + 1}`;
      const zije = v.hraci[h].zije;
      const d = document.createElement('div');
      d.className = `kv-hrac${h === v.naTahu && zije ? ' on' : ''}${h === v.mySeat ? ' ja' : ''}${zije ? '' : ' mrtvy'}`;
      d.style.setProperty('--c', BARVY[h]);
      d.innerHTML = `
        <span class="kv-tecka"></span>
        <span class="kv-jmeno">${jmeno}</span>
        <span class="kv-pocty">${zije ? `${pocty[h].kral ? '👑' : '💀'} 🐸×${pocty[h].zab}` : '💀'}</span>
        <span class="kv-zasoba">v zásobě ${v.hraci[h].zasoba}/${ZASOBA}</span>`;
      box.append(d);
    }
  },

  renderPanel(v) {
    const naTahu = this.ctx.players.find(x => x.uid === v.seats[v.naTahu]);
    const stav = this.root.querySelector('#kvStav');
    const popis = {
      tah: v.myTurn ? 'Vyber žábu a skoč' : 'Hraje se',
      leknin: v.myTurn ? 'Leknín – smíš přeskočit' : 'Skáče po leknínu',
      plozeni: v.myTurn ? 'Polož novou žabku' : 'Rozmnožuje se',
    }[v.faze] || '';
    stav.textContent = v.vitez !== null ? 'Konec hry'
      : (v.myTurn ? popis : `${naTahu?.name || 'Soupeř'}: ${popis.toLowerCase()}`);
    stav.classList.toggle('muj', !!v.myTurn);

    const pokyn = this.root.querySelector('#kvPokyn');
    pokyn.textContent = !v.myTurn ? ''
      : v.faze === 'leknin' ? 'Klikni na jiný odhalený leknín, nebo tah ukonči.'
        : v.faze === 'plozeni' ? 'Klikni na volné pole vedle královny.'
          : this.vybrana ? 'Klikni na sousední pole. Dalším klikem na žábu výběr zrušíš.'
            : 'Klikni na svou žábu.';

    this.root.querySelector('#kvNeskakat').classList.toggle('hidden', !(v.myTurn && v.faze === 'leknin'));
  },

  resize() {},

  unmount() {
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = this.stageDisplay ?? '';
    clearTimeout(this._hlaskaT);
    this.root?.remove();
  },
};
