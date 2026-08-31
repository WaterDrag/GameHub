// ─────────────────────────────────────────────────────────────
//  Osadníci z Katanu – deska v SVG.
//
//  Kreslí a nic nerozhoduje. Kam se smí stavět, říká server v polích
//  `lzeOsada` / `lzeSilnice` / `lzeMesto`; klient si to nepočítá sám,
//  aby si nešlo v konzoli povolit stavbu kdekoliv.
//
//  Suroviny soupeřů se sem vůbec neposílají – jen počty karet.
// ─────────────────────────────────────────────────────────────
import {
  SUROVINY, SUROVINA_INFO, POUST, CENY, DEV_INFO, bodyPole, VELIKOST, tecky,
} from '/shared/games/katan/deska.js';

const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, a = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
  return n;
};
const BARVY = ['#e53935', '#1e88e5', '#43a047', '#fdd835'];
// Hrstka surovin jako emoji – pouziva se v nabidkach obchodu.
const hromadka = (o) => SUROVINY
  .filter(r => (o?.[r] | 0) > 0)
  .map(r => SUROVINA_INFO[r].emoji.repeat(o[r]))
  .join(' ') || '—';
const KOSTKY = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
// Tvary staveb - domecek a vetsi mesto se dvema kridly.
const TVAR = {
  prazdno: 'M-5,0 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0',
  osada:   'M-7,7 L-7,-1 L0,-8 L7,-1 L7,7 Z',
  mesto:   'M-11,8 L-11,-1 L-5,-8 L1,-1 L1,2 L11,2 L11,8 Z',
};

export default {
  id: 'katan',

  async mount(ctx) {
    this.ctx = ctx;
    this.view = ctx.view;
    this.modal = null;

    const stage = document.getElementById('stage');
    if (stage) { this.stageDisplay = stage.style.display; stage.style.display = 'none'; }

    const host = document.getElementById('view-game');
    this.root = document.createElement('div');
    this.root.className = 'ka';
    host.appendChild(this.root);

    this.root.innerHTML = `
      <aside class="ka-vlevo">
        <div class="ka-nadpis">Hráči</div>
        <div class="ka-hraci" id="kaHraci"></div>
        <div class="ka-nadpis">Protokol</div>
        <div class="ka-log" id="kaLog"></div>
      </aside>

      <div class="ka-deska">
        <svg class="ka-svg" id="kaSvg" viewBox="0 0 700 620"></svg>
        <div class="ka-hlaska hidden" id="kaHlaska"></div>
      </div>

      <aside class="ka-vpravo">
        <div class="ka-stav" id="kaStav">…</div>

        <div class="ka-nadpis">Moje suroviny</div>
        <div class="ka-suroviny" id="kaSuroviny"></div>

        <div class="ka-kostky">
          <span class="ka-kostka" id="kaK1">—</span>
          <span class="ka-kostka" id="kaK2">—</span>
          <b class="ka-soucet" id="kaSoucet"></b>
        </div>
        <button class="ka-btn hlavni" id="kaHod" type="button">🎲 Hodit</button>

        <div class="ka-nadpis">Stavění</div>
        <div class="ka-stavby" id="kaStavby"></div>

        <div class="ka-nadpis">Karty</div>
        <div class="ka-karty" id="kaKarty"></div>

        <div class="ka-nadpis">Banka</div>
        <div class="ka-banka">
          <select id="kaDam"></select>
          <span class="ka-sipka">→</span>
          <select id="kaChci"></select>
        </div>
        <button class="ka-btn" id="kaBanka" type="button">Vyměnit</button>

        <div class="ka-nadpis">Obchod s hráči</div>
        <div class="ka-obchod" id="kaObchod"></div>

        <button class="ka-btn konec" id="kaKonec" type="button">Ukončit tah ➡</button>
      </aside>

      <div class="ka-modal hidden" id="kaModal"><div class="ka-modal-box" id="kaModalBox"></div></div>`;

    for (const id of ['kaDam', 'kaChci']) {
      const sel = this.root.querySelector('#' + id);
      for (const r of SUROVINY) {
        const o = document.createElement('option');
        o.value = r;
        o.textContent = `${SUROVINA_INFO[r].emoji} ${SUROVINA_INFO[r].nazev}`;
        sel.append(o);
      }
    }
    this.root.querySelector('#kaChci').selectedIndex = 1;

    this.root.querySelector('#kaHod').onclick = () => this.posli({ a: 'hod' });
    this.root.querySelector('#kaKonec').onclick = () => this.posli({ a: 'konec' });
    this.root.querySelector('#kaBanka').onclick = () => this.posli({
      a: 'banka',
      dam: this.root.querySelector('#kaDam').value,
      chci: this.root.querySelector('#kaChci').value,
    });
    this.root.querySelector('#kaDam').onchange = () => this.render(this.view);

    this.postavDesku(ctx.view);
    this.render(ctx.view);
  },

  posli(msg) { this.ctx.send('action', msg); },

  // ── Deska se staví jednou ──────────────────────────────────
  postavDesku(v) {
    const svg = this.root.querySelector('#kaSvg');
    svg.innerHTML = '';
    svg.append(mk('rect', { x: 0, y: 0, width: 700, height: 620, fill: '#0a2a5a', rx: 16 }));

    // Přístavy leží vně desky, kreslí se první.
    this.pristavPrvky = [];
    for (const p of v.pristavy || []) {
      const a = v.vrcholy[p.vrcholy[0]], b = v.vrcholy[p.vrcholy[1]];
      if (!a || !b) continue;
      const sx = (a.x + b.x) / 2, sy = (a.y + b.y) / 2;
      const dx = sx - 350, dy = sy - 310;
      const d = Math.hypot(dx, dy) || 1;
      const hx = sx + (dx / d) * 40, hy = sy + (dy / d) * 40;
      const info = p.typ === 'vse' ? { emoji: '⚓', nazev: '3:1' } : SUROVINA_INFO[p.typ];
      const g = mk('g', { 'pointer-events': 'none' });
      for (const konec of [a, b]) {
        g.append(mk('line', {
          x1: hx, y1: hy, x2: konec.x, y2: konec.y,
          stroke: '#7aa7d9', 'stroke-width': 2.5, 'stroke-opacity': .55, 'stroke-dasharray': '4,4',
        }));
      }
      g.append(mk('circle', { cx: hx, cy: hy, r: 17, fill: '#0d2b52', stroke: '#7aa7d9', 'stroke-width': 2 }));
      const t1 = mk('text', { x: hx, y: hy - 3, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 14 });
      t1.textContent = info.emoji;
      const t2 = mk('text', { x: hx, y: hy + 10, 'text-anchor': 'middle', 'font-size': 9, fill: '#cfe2ff', 'font-weight': 700 });
      t2.textContent = p.typ === 'vse' ? '3:1' : '2:1';
      g.append(t1, t2);
      svg.append(g);
    }

    // Pole.
    this.polePrvky = [];
    for (const p of v.pole) {
      const info = SUROVINA_INFO[p.surovina];
      const g = mk('g', { class: 'ka-pole' });
      const body = bodyPole(p.x, p.y, VELIKOST - 2).map(b => b.map(n => n.toFixed(1)).join(',')).join(' ');
      g.append(mk('polygon', { points: body, fill: info.barva, stroke: info.svetla, 'stroke-width': 2 }));
      const e = mk('text', { x: p.x, y: p.y - 8, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 21, 'pointer-events': 'none' });
      e.textContent = info.emoji;
      g.append(e);

      if (p.cislo !== null) {
        const horke = p.cislo === 6 || p.cislo === 8;
        g.append(mk('circle', { cx: p.x, cy: p.y + 15, r: 15, fill: '#f5e6c8', stroke: horke ? '#bf360c' : '#8d6e63', 'stroke-width': 1.5 }));
        const t = mk('text', {
          x: p.x, y: p.y + 15, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': 13, 'font-weight': 700, fill: horke ? '#bf360c' : '#3e2723', 'pointer-events': 'none',
        });
        t.textContent = p.cislo;
        g.append(t);
        const n = tecky(p.cislo);
        for (let i = 0; i < n; i++) {
          g.append(mk('circle', {
            cx: p.x + (i - (n - 1) / 2) * 4.5, cy: p.y + 27, r: 1.4,
            fill: horke ? '#bf360c' : '#3e2723', 'pointer-events': 'none',
          }));
        }
      }
      g.onclick = () => this.klikPole(p.id);
      svg.append(g);
      this.polePrvky.push(g);
    }

    // Zloděj.
    this.zlodejPrvek = mk('text', {
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 24, 'pointer-events': 'none', class: 'ka-zlodej',
    });
    this.zlodejPrvek.textContent = '🦹';
    svg.append(this.zlodejPrvek);

    // Hrany.
    this.hranaPrvky = [];
    for (const e of v.hrany) {
      const a = v.vrcholy[e.v1], b = v.vrcholy[e.v2];
      const cara = mk('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        class: 'ka-hrana', 'stroke-linecap': 'round', 'stroke-width': 6, stroke: 'transparent',
      });
      cara.onclick = () => this.klikHrana(e.id);
      svg.append(cara);
      this.hranaPrvky.push(cara);
    }

    // Vrcholy.
    this.vrcholPrvky = [];
    for (const vr of v.vrcholy) {
      const c = mk('path', { d: TVAR.prazdno, transform: `translate(${vr.x},${vr.y})`, class: 'ka-vrchol' });
      c.onclick = () => this.klikVrchol(vr.id);
      svg.append(c);
      this.vrcholPrvky.push(c);
    }
  },

  // ── Kliknutí ───────────────────────────────────────────────
  klikVrchol(id) {
    const v = this.view;
    if (!v) return;
    if ((v.lzeMesto || []).includes(id)) return this.posli({ a: 'mesto', v: id });
    if ((v.lzeOsada || []).includes(id)) return this.posli({ a: 'osada', v: id });
  },
  klikHrana(id) {
    if ((this.view?.lzeSilnice || []).includes(id)) this.posli({ a: 'silnice', e: id });
  },
  klikPole(id) {
    const v = this.view;
    if (v?.myTurn && v.faze === 'zlodej' && id !== v.zlodej) this.posli({ a: 'zlodej', pole: id });
  },

  update(view) { this.view = view; this.render(view); },
  event(m) {
    if (m?.kind !== 'hlaska' || !m.text) return;
    const el = this.root?.querySelector('#kaHlaska');
    if (!el) return;
    el.textContent = m.text;
    el.classList.remove('hidden');
    clearTimeout(this._hlaskaT);
    this._hlaskaT = setTimeout(() => el.classList.add('hidden'), 3500);
  },

  // ── Vykreslení ─────────────────────────────────────────────
  render(v) {
    if (!v) return;
    const jaNaTahu = v.myTurn;

    // Zloděj
    const p = v.pole[v.zlodej];
    if (p) { this.zlodejPrvek.setAttribute('x', p.x); this.zlodejPrvek.setAttribute('y', p.y - 26); }

    // Pole – při přesunu zloděje se dají klikat
    const cilZlodej = jaNaTahu && v.faze === 'zlodej';
    this.polePrvky.forEach((g, i) => g.classList.toggle('cil', cilZlodej && i !== v.zlodej));

    // Hrany
    const lzeSil = new Set(v.lzeSilnice || []);
    v.hrany.forEach((e, i) => {
      const el = this.hranaPrvky[i];
      if (e.majitel !== null) {
        el.setAttribute('stroke', BARVY[e.majitel]);
        el.setAttribute('stroke-width', 6);
        el.classList.remove('lze');
      } else if (lzeSil.has(e.id)) {
        el.setAttribute('stroke', '#ffffff');
        el.setAttribute('stroke-width', 6);
        el.classList.add('lze');
      } else {
        el.setAttribute('stroke', 'transparent');
        el.classList.remove('lze');
      }
    });

    // Vrcholy
    const lzeOs = new Set(v.lzeOsada || []);
    const lzeMe = new Set(v.lzeMesto || []);
    v.vrcholy.forEach((vr, i) => {
      const el = this.vrcholPrvky[i];
      el.classList.toggle('lze', lzeOs.has(vr.id) || lzeMe.has(vr.id));
      if (vr.majitel !== null) {
        el.setAttribute('d', vr.typ === 'mesto' ? TVAR.mesto : TVAR.osada);
        el.setAttribute('fill', BARVY[vr.majitel]);
        el.setAttribute('stroke', '#f5e6c8');
        el.setAttribute('stroke-width', 1.8);
        el.setAttribute('opacity', 1);
      } else if (lzeOs.has(vr.id)) {
        el.setAttribute('d', TVAR.prazdno);
        el.setAttribute('fill', '#f5e6c8');
        el.setAttribute('stroke', '#0a2a5a'); el.setAttribute('stroke-width', 1.5);
        el.setAttribute('opacity', .9);
      } else {
        el.setAttribute('opacity', 0);
      }
    });

    this.renderHrace(v);
    this.renderPanel(v);
    this.renderModal(v);

    const log = this.root.querySelector('#kaLog');
    const t = (v.log || []).slice(-6).map(x => `<div>${x}</div>`).join('');
    if (t !== this._log) { this._log = t; log.innerHTML = t; log.scrollTop = log.scrollHeight; }
  },

  renderHrace(v) {
    const box = this.root.querySelector('#kaHraci');
    const podpis = `${v.naTahu}|${v.body.join(',')}|${v.pocetKaret.join(',')}|${v.rytiru.join(',')}|${v.nejdelsiCesta.hrac}|${v.nejvetsiArmada.hrac}`;
    if (podpis === this._podpisHracu) return;
    this._podpisHracu = podpis;
    box.innerHTML = '';
    for (let h = 0; h < v.hracu; h++) {
      const pl = this.ctx.players.find(x => x.uid === v.seats[h]);
      const jmeno = (pl?.name || 'Hráč') + (pl?.botControlled && !/\(bot\)/i.test(pl?.name || '') ? ' 🤖' : '');
      const d = document.createElement('div');
      d.className = `ka-hrac${h === v.naTahu ? ' on' : ''}${h === v.mySeat ? ' ja' : ''}`;
      d.style.setProperty('--c', BARVY[h]);
      d.innerHTML = `
        <span class="ka-tecka"></span>
        <span class="ka-jmeno">${jmeno}</span>
        <span class="ka-body">${v.body[h]} b</span>
        <span class="ka-drobne">
          🂠 ${v.pocetKaret[h]} · 🃏 ${v.pocetDevKaret[h]} · ⚔ ${v.rytiru[h]}
          ${v.nejdelsiCesta.hrac === h ? ' 🛣' : ''}${v.nejvetsiArmada.hrac === h ? ' 🏅' : ''}
        </span>`;
      box.append(d);
    }
  },

  renderPanel(v) {
    const naTahu = this.ctx.players.find(x => x.uid === v.seats[v.naTahu]);
    const stav = this.root.querySelector('#kaStav');
    const popis = {
      rozmisteni: v.myTurn ? 'Rozmísti osadu a silnici' : 'Rozmísťuje se',
      hod: v.myTurn ? 'Hoď kostkami' : 'Hází se',
      akce: v.myTurn ? 'Stav, obchoduj, nebo ukonči tah' : 'Hraje se',
      zahazuje: v.musimZahodit ? `Zahoď ${v.musimZahodit} karet` : 'Ostatní zahazují',
      zlodej: v.myTurn ? 'Vyber pole pro zloděje' : 'Přesouvá se zloděj',
      krade: v.myTurn ? 'Vyber, koho okradeš' : 'Krade se',
    }[v.faze] || '';
    stav.textContent = v.vitez !== null ? 'Konec hry'
      : (v.myTurn || v.musimZahodit ? popis : `${naTahu?.name || 'Soupeř'}: ${popis.toLowerCase()}`);
    stav.classList.toggle('muj', !!v.myTurn);

    // Suroviny
    const sur = this.root.querySelector('#kaSuroviny');
    const podpisSur = JSON.stringify(v.suroviny) + '|' + JSON.stringify(v.kurzy);
    if (podpisSur !== this._podpisSur) {
      this._podpisSur = podpisSur;
      sur.innerHTML = '';
      for (const r of SUROVINY) {
        const d = document.createElement('div');
        d.className = 'ka-sur';
        d.title = `${SUROVINA_INFO[r].nazev} · kurz ${v.kurzy?.[r] ?? 4}:1`;
        d.innerHTML = `<span>${SUROVINA_INFO[r].emoji}</span><b>${v.suroviny?.[r] ?? 0}</b>`;
        sur.append(d);
      }
    }

    // Kostky
    this.root.querySelector('#kaK1').textContent = v.kostky ? KOSTKY[v.kostky[0] - 1] : '—';
    this.root.querySelector('#kaK2').textContent = v.kostky ? KOSTKY[v.kostky[1] - 1] : '—';
    this.root.querySelector('#kaSoucet').textContent = v.kostky ? v.kostky[0] + v.kostky[1] : '';

    this.root.querySelector('#kaHod').disabled = !(v.myTurn && v.faze === 'hod');
    this.root.querySelector('#kaKonec').disabled = !(v.myTurn && v.faze === 'akce');

    // Stavby – tlačítka jsou jen nápověda, staví se klikem na desku.
    const stavby = this.root.querySelector('#kaStavby');
    const moznosti = [
      ['silnice', 'Silnice', (v.lzeSilnice || []).length],
      ['osada', 'Osada', (v.lzeOsada || []).length],
      ['mesto', 'Město', (v.lzeMesto || []).length],
    ];
    const podpisSt = moznosti.map(m => m[2]).join(',') + '|' + v.lzeKarta + '|' + v.volneSilnice;
    if (podpisSt !== this._podpisSt) {
      this._podpisSt = podpisSt;
      stavby.innerHTML = '';
      for (const [klic, nazev, kolik] of moznosti) {
        const cena = Object.entries(CENY[klic])
          .map(([r, n]) => SUROVINA_INFO[r].emoji.repeat(n)).join('');
        const d = document.createElement('div');
        d.className = 'ka-stavba' + (kolik ? ' lze' : '');
        d.innerHTML = `<b>${nazev}</b><span class="ka-cena">${cena}</span>
          <span class="ka-kolik">${kolik ? `${kolik} míst` : '—'}</span>`;
        stavby.append(d);
      }
      const k = document.createElement('button');
      k.type = 'button';
      k.className = 'ka-btn maly';
      k.disabled = !v.lzeKarta;
      k.textContent = `🃏 Koupit kartu ${SUROVINA_INFO.vlna.emoji}${SUROVINA_INFO.obili.emoji}${SUROVINA_INFO.ruda.emoji}`;
      k.onclick = () => this.posli({ a: 'karta' });
      stavby.append(k);
      if (v.volneSilnice > 0) {
        const p = document.createElement('div');
        p.className = 'ka-pozn';
        p.textContent = `Zbývají ${v.volneSilnice} silnice zdarma.`;
        stavby.append(p);
      }
    }

    // Dev karty
    const karty = this.root.querySelector('#kaKarty');
    const podpisK = (v.karty || []).join(',') + '|' + (v.kartyDnes || []).join(',') + '|' + v.faze;
    if (podpisK !== this._podpisK) {
      this._podpisK = podpisK;
      karty.innerHTML = '';
      const pocty = {};
      for (const k of v.karty || []) pocty[k] = (pocty[k] || 0) + 1;
      const dnes = {};
      for (const k of v.kartyDnes || []) dnes[k] = (dnes[k] || 0) + 1;
      if (!Object.keys(pocty).length) {
        karty.innerHTML = '<div class="ka-pozn">Žádné karty.</div>';
      }
      for (const [typ, n] of Object.entries(pocty)) {
        const info = DEV_INFO[typ];
        const lze = typ !== 'bod' && v.myTurn && (v.faze === 'akce' || v.faze === 'hod')
          && n - (dnes[typ] || 0) > 0;
        const d = document.createElement('div');
        d.className = 'ka-karta' + (lze ? ' lze' : '');
        d.innerHTML = `<span class="ka-kikona">${info.emoji}</span>
          <span class="ka-kinfo"><b>${info.nazev}${n > 1 ? ` ×${n}` : ''}</b><small>${info.popis}</small></span>`;
        if (lze) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'ka-btn maly';
          b.textContent = 'Hrát';
          b.onclick = () => this.zahrajKartu(typ);
          d.append(b);
        }
        karty.append(d);
      }
    }

    // Banka
    const dam = this.root.querySelector('#kaDam').value;
    const chci = this.root.querySelector('#kaChci').value;
    const k = v.kurzy?.[dam] ?? 4;
    const bt = this.root.querySelector('#kaBanka');
    bt.textContent = `Vyměnit ${k}:1`;
    bt.disabled = !(v.myTurn && v.faze === 'akce' && dam !== chci && (v.suroviny?.[dam] ?? 0) >= k);

    this.renderObchod(v);
  },

  // ── Obchod s hráči ─────────────────────────────────
  //  Nabídka běží jen jedna a vidí ji všichni. Kdo přijme první, ten má
  //  obchod – stejně jako u stolu, kde se křičí „berím“.
  renderObchod(v) {
    const box = this.root.querySelector('#kaObchod');
    const n = v.nabidka;
    const podpis = JSON.stringify(n) + '|' + v.myTurn + '|' + v.faze + '|' + JSON.stringify(v.suroviny);
    if (podpis === this._podpisOb) return;
    this._podpisOb = podpis;
    box.innerHTML = '';

    if (!n) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ka-btn maly';
      b.textContent = '🤝 Nabídnout obchod';
      b.disabled = !(v.myTurn && v.faze === 'akce');
      b.onclick = () => this.otevriNabidku(this.view);
      box.append(b);
      return;
    }

    const moje = n.hrac === v.mySeat;
    const kdo = this.ctx.players.find(x => x.uid === v.seats[n.hrac]);
    const d = document.createElement('div');
    d.className = 'ka-nabidka';
    d.style.setProperty('--c', BARVY[n.hrac]);
    d.innerHTML = `
      <b>${moje ? 'Tvoje nabídka' : (kdo?.name || 'Hráč')}</b>
      <span class="ka-vymena"><small>${moje ? 'dáváš' : 'dostaneš'}</small>${hromadka(n.dava)}</span>
      <span class="ka-vymena"><small>${moje ? 'chceš' : 'dáš'}</small>${hromadka(n.chce)}</span>`;
    box.append(d);

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ka-btn maly';
    if (moje) {
      b.textContent = 'Zrušit nabídku';
      b.onclick = () => this.posli({ a: 'zrus' });
    } else {
      const mohu = v.mySeat >= 0 && SUROVINY.every(r => (v.suroviny?.[r] ?? 0) >= n.chce[r]);
      b.classList.add('hlavni');
      b.textContent = mohu ? 'Přijmout' : 'Nemáš na to';
      b.disabled = !mohu;
      b.onclick = () => this.posli({ a: 'prijmi' });
    }
    box.append(b);
  },

  otevriNabidku(v) {
    this.nabDavam = Object.fromEntries(SUROVINY.map(r => [r, 0]));
    this.nabChci = Object.fromEntries(SUROVINY.map(r => [r, 0]));
    const box = this.otevri('nabidka', `
      <div class="ka-modal-nadpis">Nabídnout obchod</div>
      <div class="ka-pozn">Nabídka jde všem. Obchoduje ten, kdo ji přijme první.</div>
      <div class="ka-nadpis">Dávám</div>
      <div class="ka-vyber" id="kaNabDavam"></div>
      <div class="ka-nadpis">Chci</div>
      <div class="ka-vyber" id="kaNabChci"></div>
      <button class="ka-btn hlavni" id="kaNabOk" type="button">Nabídnout</button>
      <button class="ka-btn maly" id="kaNabZpet" type="button">Zpět</button>`);

    const kresli = () => {
      for (const [cil, id, strop] of [[this.nabDavam, '#kaNabDavam', null], [this.nabChci, '#kaNabChci', 4]]) {
        const vyber = box.querySelector(id);
        vyber.innerHTML = '';
        for (const r of SUROVINY) {
          const max = strop === null ? (v.suroviny?.[r] ?? 0) : strop;
          const rad = document.createElement('div');
          rad.className = 'ka-vyber-radek';
          rad.innerHTML = `<span>${SUROVINA_INFO[r].emoji} ${SUROVINA_INFO[r].nazev}</span>
            <span class="ka-pocitadlo"><button type="button">−</button><b>${cil[r]}</b>
            <button type="button">+</button><small>${strop === null ? `z ${max}` : ''}</small></span>`;
          const [minus, plus] = rad.querySelectorAll('button');
          minus.onclick = () => { if (cil[r] > 0) { cil[r]--; kresli(); } };
          plus.onclick = () => { if (cil[r] < max) { cil[r]++; kresli(); } };
          vyber.append(rad);
        }
      }
      const dam = SUROVINY.reduce((a, r) => a + this.nabDavam[r], 0);
      const chci = SUROVINY.reduce((a, r) => a + this.nabChci[r], 0);
      const ok = box.querySelector('#kaNabOk');
      ok.disabled = !dam || !chci;
      ok.textContent = dam && chci ? `Nabídnout ${dam} za ${chci}` : 'Vyber, co za co';
      ok.onclick = () => {
        this.posli({ a: 'nabidni', dava: this.nabDavam, chce: this.nabChci });
        this.zavri();
      };
    };
    kresli();
    box.querySelector('#kaNabZpet').onclick = () => this.zavri();
  },

  zahrajKartu(typ) {
    if (typ === 'hojnost') return this.otevriHojnost();
    if (typ === 'monopol') return this.otevriMonopol();
    this.posli({ a: 'zahraj', typ });
  },

  // ── Modály ─────────────────────────────────────────────────
  renderModal(v) {
    const box = this.root.querySelector('#kaModal');
    // Zahazování a krádež jdou ze stavu, ostatní si otevírá hráč sám.
    if (v.musimZahodit) return this.otevriZahazovani(v);
    if (v.myTurn && v.faze === 'krade' && v.obeti.length) return this.otevriKradez(v);
    if (this.modal === 'zahod' || this.modal === 'krade') this.zavri();
    if (this.modal === 'nabidka' && (!v.myTurn || v.faze !== 'akce' || v.nabidka)) this.zavri();
  },

  zavri() {
    this.modal = null;
    this.root.querySelector('#kaModal').classList.add('hidden');
  },

  otevri(nazev, html) {
    this.modal = nazev;
    const box = this.root.querySelector('#kaModal');
    this.root.querySelector('#kaModalBox').innerHTML = html;
    box.classList.remove('hidden');
    return this.root.querySelector('#kaModalBox');
  },

  otevriZahazovani(v) {
    if (this.modal === 'zahod' && this._zahodPro === v.musimZahodit) return;
    this._zahodPro = v.musimZahodit;
    this.zahod = Object.fromEntries(SUROVINY.map(r => [r, 0]));
    const box = this.otevri('zahod', `
      <div class="ka-modal-nadpis">Zahoď ${v.musimZahodit} karet</div>
      <div class="ka-vyber" id="kaZahodVyber"></div>
      <button class="ka-btn hlavni" id="kaZahodOk" type="button">Zahodit</button>`);
    const kresli = () => {
      const vyber = box.querySelector('#kaZahodVyber');
      vyber.innerHTML = '';
      for (const r of SUROVINY) {
        const mam = v.suroviny?.[r] ?? 0;
        const d = document.createElement('div');
        d.className = 'ka-vyber-radek';
        d.innerHTML = `<span>${SUROVINA_INFO[r].emoji} ${SUROVINA_INFO[r].nazev}</span>
          <span class="ka-pocitadlo"><button type="button">−</button><b>${this.zahod[r]}</b>
          <button type="button">+</button><small>z ${mam}</small></span>`;
        const [minus, plus] = d.querySelectorAll('button');
        minus.onclick = () => { if (this.zahod[r] > 0) { this.zahod[r]--; kresli(); } };
        plus.onclick = () => {
          const celkem = SUROVINY.reduce((a, x) => a + this.zahod[x], 0);
          if (this.zahod[r] < mam && celkem < v.musimZahodit) { this.zahod[r]++; kresli(); }
        };
        vyber.append(d);
      }
      const celkem = SUROVINY.reduce((a, x) => a + this.zahod[x], 0);
      const ok = box.querySelector('#kaZahodOk');
      ok.disabled = celkem !== v.musimZahodit;
      ok.textContent = `Zahodit (${celkem}/${v.musimZahodit})`;
      ok.onclick = () => { this.posli({ a: 'zahod', co: this.zahod }); this.zavri(); };
    };
    kresli();
  },

  otevriKradez(v) {
    if (this.modal === 'krade') return;
    const box = this.otevri('krade', `
      <div class="ka-modal-nadpis">Koho okradeš?</div>
      <div class="ka-vyber" id="kaKradezVyber"></div>`);
    const vyber = box.querySelector('#kaKradezVyber');
    for (const o of v.obeti) {
      const pl = this.ctx.players.find(x => x.uid === v.seats[o]);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ka-btn';
      b.style.borderLeft = `4px solid ${BARVY[o]}`;
      b.textContent = `${pl?.name || 'Hráč'} — ${v.pocetKaret[o]} karet`;
      b.onclick = () => { this.posli({ a: 'kradni', komu: o }); this.zavri(); };
      vyber.append(b);
    }
  },

  otevriHojnost() {
    const vybrane = [];
    const box = this.otevri('hojnost', `
      <div class="ka-modal-nadpis">Vyber dvě suroviny</div>
      <div class="ka-vyber" id="kaHojnostVyber"></div>
      <div class="ka-pozn" id="kaHojnostStav">Vybráno 0 ze 2.</div>`);
    const vyber = box.querySelector('#kaHojnostVyber');
    for (const r of SUROVINY) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ka-btn';
      b.textContent = `${SUROVINA_INFO[r].emoji} ${SUROVINA_INFO[r].nazev}`;
      b.onclick = () => {
        vybrane.push(r);
        box.querySelector('#kaHojnostStav').textContent = `Vybráno ${vybrane.length} ze 2.`;
        if (vybrane.length === 2) { this.posli({ a: 'zahraj', typ: 'hojnost', param: vybrane }); this.zavri(); }
      };
      vyber.append(b);
    }
  },

  otevriMonopol() {
    const box = this.otevri('monopol', `
      <div class="ka-modal-nadpis">Na co vyhlásíš monopol?</div>
      <div class="ka-vyber" id="kaMonopolVyber"></div>`);
    const vyber = box.querySelector('#kaMonopolVyber');
    for (const r of SUROVINY) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ka-btn';
      b.textContent = `${SUROVINA_INFO[r].emoji} ${SUROVINA_INFO[r].nazev}`;
      b.onclick = () => { this.posli({ a: 'zahraj', typ: 'monopol', param: r }); this.zavri(); };
      vyber.append(b);
    }
  },

  resize() {},

  unmount() {
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = this.stageDisplay ?? '';
    this.root?.remove();
  },
};
