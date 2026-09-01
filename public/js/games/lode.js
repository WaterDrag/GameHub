// ─────────────────────────────────────────────────────────────
//  Lodě pro čtyři – jedno společné moře.
//
//  Kreslí a nic nerozhoduje. Kam se smí střílet, říká server; klient
//  si to nepočítá sám, aby si nešlo v konzoli povolit cokoliv.
//
//  CIZÍ LODĚ SEM VŮBEC NECHODÍ. Ve výhledu jsou jen moje lodě a to,
//  co už je prostřílené – jinak by stačilo otevřít konzoli.
// ─────────────────────────────────────────────────────────────
import {
  LODE, BARVY, PISMENA, STRELY, idx, poleLodi,
} from '/shared/games/lode/const.js';

export default {
  id: 'lode',

  async mount(ctx) {
    this.ctx = ctx;
    this.view = ctx.view;
    this.typ = 'normal';        // vybraná střela
    this.mirim = null;          // {x,y} pod myší
    this.rozlozeni = [];        // rozpracované rozmístění
    this.vybranaLod = 0;
    this.svisle = false;

    const stage = document.getElementById('stage');
    if (stage) { this.stageDisplay = stage.style.display; stage.style.display = 'none'; }

    const host = document.getElementById('view-game');
    this.root = document.createElement('div');
    this.root.className = 'lo';
    host.appendChild(this.root);

    this.root.innerHTML = `
      <aside class="lo-vlevo">
        <div class="lo-nadpis">Kapitáni</div>
        <div class="lo-hraci" id="loHraci"></div>
        <div class="lo-nadpis">Deník</div>
        <div class="lo-log" id="loLog"></div>
      </aside>

      <div class="lo-more">
        <div class="lo-deska" id="loDeska"></div>
        <div class="lo-hlaska hidden" id="loHlaska"></div>
      </div>

      <aside class="lo-vpravo">
        <div class="lo-stav" id="loStav">…</div>
        <div class="lo-pokyn" id="loPokyn"></div>
        <div id="loBoj">
          <div class="lo-nadpis">Střely</div>
          <div class="lo-strely" id="loStrely"></div>
        </div>
        <div id="loPriprava" class="hidden">
          <div class="lo-nadpis">Lodě</div>
          <div class="lo-lodicky" id="loLodicky"></div>
          <button class="lo-btn" id="loOtoc" type="button">↔ Vodorovně</button>
          <button class="lo-btn" id="loNahodne" type="button">🎲 Rozmístit za mě</button>
          <button class="lo-btn" id="loZnovu" type="button">↺ Začít znovu</button>
          <button class="lo-btn hlavni" id="loHotovo" type="button" disabled>Potvrdit</button>
        </div>
      </aside>`;

    this.postavDesku(ctx.view);

    this.root.querySelector('#loOtoc').onclick = () => {
      this.svisle = !this.svisle;
      this.render(this.view);
    };
    this.root.querySelector('#loNahodne').onclick = () => this.posli({ a: 'rozmisti', nahodne: true });
    this.root.querySelector('#loZnovu').onclick = () => {
      this.rozlozeni = []; this.vybranaLod = 0; this.render(this.view);
    };
    this.root.querySelector('#loHotovo').onclick = () => {
      if (this.rozlozeni.length !== LODE.length) return;
      this.posli({ a: 'rozmisti', lode: this.rozlozeni });
    };

    this.render(ctx.view);
  },

  posli(msg) { this.ctx.send('action', msg); },

  postavDesku(v) {
    const deska = this.root.querySelector('#loDeska');
    deska.innerHTML = '';
    deska.style.setProperty('--n', v.strana);
    this.pole = [];

    // Rohové prázdné políčko + hlavička sloupců
    deska.append(this.popisek(''));
    for (let x = 0; x < v.strana; x++) deska.append(this.popisek(PISMENA[x]));

    for (let y = 0; y < v.strana; y++) {
      deska.append(this.popisek(String(y + 1)));
      for (let x = 0; x < v.strana; x++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lo-pole';
        b.onclick = () => this.klik(x, y);
        b.onmouseenter = () => { this.mirim = { x, y }; this.render(this.view); };
        b.onmouseleave = () => { this.mirim = null; this.render(this.view); };
        deska.append(b);
        this.pole.push(b);
      }
    }
  },

  popisek(t) {
    const d = document.createElement('div');
    d.className = 'lo-popisek';
    d.textContent = t;
    return d;
  },

  bunka(x, y) { return this.pole[y * this.view.strana + x]; },

  // ── Kliknutí ───────────────────────────────────────────────
  klik(x, y) {
    const v = this.view;
    if (v.faze === 'rozmisteni') return this.klikRozmisteni(x, y);
    if (v.faze !== 'bitva' || !v.myTurn) return;
    if (!this.lzeStrelit(x, y)) return;
    this.posli({ a: 'strel', typ: this.typ, x, y });
    this.typ = 'normal';
  },

  klikRozmisteni(x, y) {
    const v = this.view;
    if (v.hotovo[v.mySeat]) return;

    // Klik na už položenou loď ji sundá.
    const i = this.rozlozeni.findIndex(l => l && l.some(p => p.x === x && p.y === y));
    if (i >= 0) {
      this.rozlozeni.splice(i, 1);
      this.vybranaLod = Math.min(this.rozlozeni.length, LODE.length - 1);
      return this.render(v);
    }
    const cells = this.pokusLod(x, y);
    if (!cells) return;
    this.rozlozeni.push(cells);
    this.vybranaLod = this.rozlozeni.length;
    this.render(v);
  },

  // Kam by šla položit další loď v pořadí.
  pokusLod(x, y) {
    const v = this.view;
    const idxLodi = this.rozlozeni.length;
    if (idxLodi >= LODE.length) return null;
    const cells = poleLodi(v.strana, x, y, LODE[idxLodi].delka, this.svisle);
    if (!cells) return null;
    const obsazeno = new Set(this.rozlozeni.flat().map(p => `${p.x},${p.y}`));
    if (cells.some(p => obsazeno.has(`${p.x},${p.y}`))) return null;
    return cells;
  },

  // ── Co střela zasáhne ──────────────────────────────────────
  cile(x, y) {
    const v = this.view;
    const out = [];
    const push = (cx, cy) => {
      if (cx >= 0 && cy >= 0 && cx < v.strana && cy < v.strana) out.push({ x: cx, y: cy });
    };
    if (this.typ === 'bomba') {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) push(x + dx, y + dy);
    } else if (this.typ === 'radek') {
      for (let i = 0; i < v.strana; i++) push(i, y);
    } else if (this.typ === 'sloupec') {
      for (let i = 0; i < v.strana; i++) push(x, i);
    } else push(x, y);
    return out;
  },

  lzeStrelit(x, y) {
    const v = this.view;
    if (!v.myTurn) return false;
    if (v.body[v.mySeat] < (STRELY[this.typ]?.cena ?? 0)) return false;
    return this.cile(x, y).some(p => !v.strileno[idx(v.strana, p.x, p.y)]);
  },

  mojePole(x, y) {
    const v = this.view;
    if (v.faze === 'rozmisteni') {
      return this.rozlozeni.some(l => l.some(p => p.x === x && p.y === y));
    }
    return !!v.mojeLode && v.mojeLode.some(l => l.some(p => p.x === x && p.y === y));
  },

  update(view) {
    const jinaDeska = view.strana !== this.view?.strana;
    this.view = view;
    if (jinaDeska) this.postavDesku(view);
    // Po odeslání rozmístění se rozpracovaná verze zahodí.
    if (view.faze !== 'rozmisteni') this.rozlozeni = [];
    this.render(view);
  },

  event(m) {
    if (m?.kind !== 'hlaska' || !m.text) return;
    const el = this.root?.querySelector('#loHlaska');
    if (!el) return;
    el.textContent = m.text;
    el.classList.remove('hidden');
    clearTimeout(this._hlaskaT);
    this._hlaskaT = setTimeout(() => el.classList.add('hidden'), 3200);
  },

  // ── Vykreslení ─────────────────────────────────────────────
  render(v) {
    if (!v) return;
    const priprava = v.faze === 'rozmisteni';
    const cekam = priprava && v.hotovo[v.mySeat];

    // Náhled střely / lodi
    let nahled = new Set();
    let blokovano = false;
    if (this.mirim) {
      if (priprava && !cekam) {
        const c = this.pokusLod(this.mirim.x, this.mirim.y);
        if (c) nahled = new Set(c.map(p => `${p.x},${p.y}`));
        else blokovano = true;
      } else if (v.myTurn) {
        const c = this.cile(this.mirim.x, this.mirim.y);
        if (this.lzeStrelit(this.mirim.x, this.mirim.y)) nahled = new Set(c.map(p => `${p.x},${p.y}`));
        else blokovano = true;
      }
    }

    for (let y = 0; y < v.strana; y++) {
      for (let x = 0; x < v.strana; x++) {
        const el = this.bunka(x, y);
        const i = idx(v.strana, x, y);
        const k = `${x},${y}`;
        const zasah = v.zasazeni[k];
        const strileno = v.strileno[i];

        el.className = 'lo-pole'
          + (strileno ? (zasah ? ' zasah' : ' minuto') : '')
          + (this.mojePole(x, y) ? ' moje' : '')
          + (nahled.has(k) ? (blokovano ? ' spatne' : ' nahled') : '')
          + (v.myTurn && !strileno && !priprava ? ' lze' : '');

        el.innerHTML = '';
        if (strileno && zasah) {
          // Kdo v tom poli schytal – barevné čtvrtky, klidně několik naráz.
          const box = document.createElement('span');
          box.className = 'lo-kdo';
          for (const h of zasah.slice(0, 4)) {
            const d = document.createElement('i');
            d.style.background = BARVY[h];
            box.append(d);
          }
          el.append(box);
        }
        el.title = strileno
          ? (zasah ? `Zásah – ${zasah.map(h => `hráč ${h + 1}`).join(', ')}` : 'Vedle')
          : `${PISMENA[x]}${y + 1}`;
      }
    }

    this.renderHrace(v);
    this.renderPanel(v);

    const log = this.root.querySelector('#loLog');
    const t = (v.log || []).slice(-8).map(x => `<div>${x}</div>`).join('');
    if (t !== this._log) { this._log = t; log.innerHTML = t; log.scrollTop = log.scrollHeight; }
  },

  renderHrace(v) {
    const box = this.root.querySelector('#loHraci');
    const podpis = JSON.stringify([v.zije, v.body, v.zasahu, v.segmentuZbyva, v.naTahu, v.hotovo]);
    if (podpis === this._podpisHracu) return;
    this._podpisHracu = podpis;

    box.innerHTML = '';
    for (let h = 0; h < v.hracu; h++) {
      const pl = this.ctx.players.find(x => x.uid === v.seats[h]);
      const jmeno = pl?.name || `Hráč ${h + 1}`;
      const d = document.createElement('div');
      d.className = `lo-hrac${h === v.naTahu && v.faze === 'bitva' ? ' on' : ''}`
        + `${h === v.mySeat ? ' ja' : ''}${v.zije[h] ? '' : ' potopen'}`;
      d.style.setProperty('--c', BARVY[h]);

      const stav = v.faze === 'rozmisteni'
        ? (v.hotovo[h] ? 'připraven' : 'rozmisťuje…')
        : (!v.zije[h] ? 'potopen' : `${v.segmentuZbyva[h]}/${v.segmentuCelkem} polí`);

      d.innerHTML = `
        <span class="lo-tecka"></span>
        <span class="lo-jmeno">${jmeno}</span>
        <span class="lo-skore" title="Potopeno cizích políček">${v.zasahu[h]}</span>
        <span class="lo-drobne">${stav}${v.faze === 'bitva' ? ` · ${v.body[h]} b.` : ''}</span>`;
      box.append(d);
    }
  },

  renderPanel(v) {
    const priprava = v.faze === 'rozmisteni';
    const cekam = priprava && v.hotovo[v.mySeat];
    this.root.querySelector('#loPriprava').classList.toggle('hidden', !priprava || cekam);
    this.root.querySelector('#loBoj').classList.toggle('hidden', priprava);

    const naTahu = this.ctx.players.find(x => x.uid === v.seats[v.naTahu]);
    const stav = this.root.querySelector('#loStav');
    stav.textContent = v.vitez !== null ? 'Konec bitvy'
      : priprava ? (cekam ? 'Čekáš na ostatní' : 'Rozmísti lodě')
        : (v.myTurn ? `Pal! (${v.ranZbyva}/${v.ranZaTah})` : `Střílí ${naTahu?.name || 'soupeř'}`);
    stav.classList.toggle('muj', !!v.myTurn || (priprava && !cekam));

    const pokyn = this.root.querySelector('#loPokyn');
    pokyn.textContent = priprava
      ? (cekam ? 'Ostatní ještě rozmisťují.'
        : `Polož ${LODE[this.rozlozeni.length]?.nazev || ''} (${LODE[this.rozlozeni.length]?.delka || ''}). Klik na loď ji sundá.`)
      : v.myTurn
        ? (this.typ === 'normal' ? 'Klikni na pole. Zásah ti dá ránu navíc.'
          : `${STRELY[this.typ].nazev}: klikni na střed zásahu.`)
        : '';

    if (priprava && !cekam) this.renderLodicky(v);
    else if (!priprava) this.renderStrely(v);
  },

  renderLodicky(v) {
    const box = this.root.querySelector('#loLodicky');
    const podpis = this.rozlozeni.length + '|' + this.svisle;
    if (podpis !== this._podpisLodi) {
      this._podpisLodi = podpis;
      box.innerHTML = '';
      LODE.forEach((l, i) => {
        const d = document.createElement('div');
        d.className = 'lo-lodicka' + (i < this.rozlozeni.length ? ' hotova'
          : i === this.rozlozeni.length ? ' nadrade' : '');
        d.innerHTML = `<b>${l.nazev}</b><span>${'▮'.repeat(l.delka)}</span>`;
        box.append(d);
      });
    }
    this.root.querySelector('#loOtoc').textContent = this.svisle ? '↕ Svisle' : '↔ Vodorovně';
    this.root.querySelector('#loHotovo').disabled = this.rozlozeni.length !== LODE.length;
    this.root.querySelector('#loHotovo').textContent =
      `Potvrdit (${this.rozlozeni.length}/${LODE.length})`;
  },

  renderStrely(v) {
    const box = this.root.querySelector('#loStrely');
    const body = v.body[v.mySeat] ?? 0;
    const podpis = `${body}|${this.typ}|${v.myTurn}`;
    if (podpis === this._podpisStrel) return;
    this._podpisStrel = podpis;

    box.innerHTML = '';
    for (const [id, s] of Object.entries(STRELY)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lo-strela' + (this.typ === id ? ' vybrana' : '');
      b.disabled = !v.myTurn || body < s.cena;
      b.innerHTML = `<span class="lo-s-e">${s.emoji}</span>
        <span class="lo-s-t"><b>${s.nazev}</b><small>${s.popis}</small></span>
        ${s.cena ? `<span class="lo-s-c">${s.cena} b.</span>` : ''}`;
      b.onclick = () => { this.typ = id; this.render(this.view); };
      box.append(b);
    }
  },

  resize() {},

  unmount() {
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = this.stageDisplay ?? '';
    clearTimeout(this._hlaskaT);
    this.root?.remove();
  },
};
