// ─────────────────────────────────────────────────────────────
//  Kvak! – rybník 8×8 v DOM mřížce.
//
//  Kreslí a nic nerozhoduje. Kam se smí skočit, říká server v poli
//  `tahy`; klient si to nepočítá sám, aby si nešlo v konzoli povolit
//  skok přes půl desky.
//
//  Co je pod neotočenými kartičkami, se sem vůbec neposílá.
//
//  Leknín i sameček se řeší samy na serveru – klient posílá vždycky
//  jen „skáču žábou z A na B“, žádné mezifáze nejsou.
// ─────────────────────────────────────────────────────────────
import {
  STRANA, POLI, KARTY, LEGENDA, SAMCI, BARVY, jeSamec, klic,
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
        d.innerHTML = '<span class="kv-karta"></span><span class="kv-zaby"></span>';
        d.onclick = () => this.klik(r, c);
        deska.append(d);
        this.pole.push(d);
      }
    }

    const leg = this.root.querySelector('#kvLegenda');
    for (const id of LEGENDA) {
      const k = KARTY[id];
      const d = document.createElement('div');
      d.className = 'kv-leg';
      // U samečka ukážeme rovnou všechny čtyři barvy – jsou to čtyři
      // různé kartičky a každá plodí zvlášť.
      const ikona = id === 'samec1' ? SAMCI.map(x => KARTY[x].emoji).join('') : k.emoji;
      d.innerHTML = `<span class="kv-leg-i">${ikona}</span>
        <span><b>${id === 'samec1' ? 'Samečci (4×)' : k.nazev}</b><small>${k.popis}</small></span>`;
      leg.append(d);
    }

    this.render(ctx.view);
  },

  posli(msg) { this.ctx.send('action', msg); },

  // ── Kliknutí ───────────────────────────────────────────────
  klik(r, c) {
    const v = this.view;
    if (!v || !v.myTurn) return;

    // Druhé kliknutí = cíl, pokud tam vybraná žába smí.
    if (this.vybrana && this.cileVybrane().some(([tr, tc]) => tr === r && tc === c)) {
      const { r: zr, c: zc, kralovna } = this.vybrana;
      this.vybrana = null;
      return this.posli({ a: 'tah', zr, zc, kralovna, r, c });
    }

    // Jinak vyber (nebo odznač) vlastní žábu, se kterou se smí hrát.
    if (this.vybrana && this.vybrana.r === r && this.vybrana.c === c) {
      this.vybrana = null;
      return this.render(v);
    }
    const lze = v.tahy.filter(t => t.z.r === r && t.z.c === c);
    if (lze.length) {
      // Na kládě a u samečka mohou stát dvě moje žáby. Královna má
      // přednost jen tehdy, když s ní jde táhnout.
      this.vybrana = { r, c, kralovna: lze.some(t => t.z.kralovna) };
    } else {
      this.vybrana = null;
    }
    this.render(v);
  },

  jeMezi(seznam, r, c) {
    return (seznam || []).some(([tr, tc]) => tr === r && tc === c);
  },

  cileVybrane() {
    if (!this.vybrana || !this.view) return [];
    return this.view.tahy
      .filter(t => t.z.r === this.vybrana.r && t.z.c === this.vybrana.c
        && !!t.z.kralovna === !!this.vybrana.kralovna)
      .map(t => t.na);
  },

  update(view) {
    if (!view.myTurn) this.vybrana = null;
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

    const cile = this.cileVybrane();
    const lzeTahnout = new Set((v.tahy || []).map(t => `${t.z.r}-${t.z.c}`));
    const nucena = v.nucena?.[v.mySeat] || null;

    for (let i = 0; i < POLI; i++) {
      const r = Math.floor(i / STRANA), c = i % STRANA;
      const el = this.pole[i];
      const druh = v.pole[i];
      const zaby = v.zaby[klic(r, c)] || [];
      const k = klic(r, c);

      const podpis = `${druh}|${JSON.stringify(zaby)}`;
      if (el._podpis !== podpis) {
        el._podpis = podpis;
        el.querySelector('.kv-karta').textContent = druh ? KARTY[druh].emoji : '';
        el.className = 'kv-pole'
          + (druh ? ` odhalene kv-${jeSamec(druh) ? 'samec' : druh}` : ' skryte')
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
      el.classList.toggle('lze', v.myTurn && lzeTahnout.has(k));
      el.classList.toggle('nucena', nucena === k);
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
      const plodil = v.hraci[h].plodil || {};
      const d = document.createElement('div');
      d.className = `kv-hrac${h === v.naTahu && zije ? ' on' : ''}${h === v.mySeat ? ' ja' : ''}${zije ? '' : ' mrtvy'}`;
      d.style.setProperty('--c', BARVY[h]);
      // Který sameček už pro tuhle královnu plodil. Vybledlý = vyčerpaný.
      const zbyva = SAMCI.filter(x => !plodil[x]).length;
      const samci = SAMCI.map(x => `<span class="kv-si${plodil[x] ? ' pryc' : ''}"
        title="${KARTY[x].nazev} – ${plodil[x] ? 'už plodil' : 'ještě dá žabku'}">${KARTY[x].emoji}</span>`).join('');
      d.innerHTML = `
        <span class="kv-tecka"></span>
        <span class="kv-jmeno">${jmeno}</span>
        <span class="kv-pocty">${zije ? `${pocty[h].kral ? '👑' : '💀'} 🐸×${pocty[h].zab}` : '💀'}</span>
        <span class="kv-samci">${samci}<small>${zbyva ? `zbývají ${zbyva}` : 'všichni využití'}</small></span>`;
      box.append(d);
    }
  },

  renderPanel(v) {
    const naTahu = this.ctx.players.find(x => x.uid === v.seats[v.naTahu]);
    const stav = this.root.querySelector('#kvStav');
    stav.textContent = v.vitez !== null ? 'Konec hry'
      : (v.myTurn ? 'Vyber žábu a skoč' : `Na tahu je ${naTahu?.name || 'soupeř'}`);
    stav.classList.toggle('muj', !!v.myTurn);

    const nucena = v.nucena?.[v.mySeat] || null;
    const pokyn = this.root.querySelector('#kvPokyn');
    pokyn.textContent = !v.myTurn ? ''
      : nucena ? 'Nová žabka od samečka musí táhnout jako první.'
        : v.omezeni ? (v.omezeni.typ === 'jen'
          ? 'Komár: táhneš znovu touž žábou.'
          : 'Leknín: tah navíc, ale jinou žábou.')
          : this.vybrana ? 'Klikni na sousední pole. Dalším klikem na žábu výběr zrušíš.'
            : 'Klikni na svou žábu.';
  },

  resize() {},

  unmount() {
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = this.stageDisplay ?? '';
    clearTimeout(this._hlaskaT);
    this.root?.remove();
  },
};
