// ─────────────────────────────────────────────────────────────
//  Člověče, nezlob se – deska v SVG.
//
//  Kreslí a nic nerozhoduje. Souřadnice si nevymýšlí: bere je ze
//  sdílené `geometrie()`, takže klasický kříž i osmiramenný kruh jsou
//  jedna a ta samá kreslicí smyčka.
//
//  SVG schválně místo mřížky z divů – deska pro osm hráčů je 80 polí
//  a musí se vejít na mobil i na monitor beze změny kódu.
// ─────────────────────────────────────────────────────────────
import {
  MAPA_PODLE, geometrie, okruh, naOkruhu, barvaRamene, CIL,
} from '/shared/games/clovece/const.js';

const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

// Body na kostce – souřadnice v mřížce 3×3.
const PUNTIKY = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

export default {
  id: 'clovece',

  async mount(ctx) {
    this.ctx = ctx;
    this.view = ctx.view;
    this.animKostka = 0;

    // Deska je SVG, ne plátno – Pixi jde stranou.
    const stage = document.getElementById('stage');
    if (stage) { this.stageDisplay = stage.style.display; stage.style.display = 'none'; }

    const host = document.getElementById('view-game');
    this.root = document.createElement('div');
    this.root.className = 'cl';
    host.appendChild(this.root);

    this.root.innerHTML = `
      <div class="cl-hraci" id="clHraci"></div>
      <div class="cl-deskawrap"><svg class="cl-svg" id="clSvg"></svg></div>
      <div class="cl-panel">
        <div class="cl-hlaska hidden" id="clHlaska"></div>
        <div class="cl-stav">
          <b id="clStav">…</b>
          <span class="cl-pokusy" id="clPokusy"></span>
        </div>
        <div class="cl-log" id="clLog"></div>
        <div class="cl-akce">
          <div class="cl-kostky" id="clKostka"><div class="cl-kmrizka"></div></div>
          <button class="cl-hod" id="clHod" type="button">HODIT</button>
          <button class="cl-obet hidden" id="clObet" type="button">⚔️ Obětovat</button>
        </div>
        <div class="cl-figurky" id="clFigurky"></div>
      </div>
      <div class="cl-let" id="clLet"><div class="cl-kmrizka"></div></div>`;

    this.root.querySelector('#clHod').onclick = () => this.hod();
    this.root.querySelector('#clObet').onclick = () => this.zacniObet();

    this.postavDesku(ctx.view);
    this.render(ctx.view);
  },

  // ── Deska se staví jednou ──────────────────────────────────
  postavDesku(v) {
    const mapa = MAPA_PODLE[v.mapa];
    this.mapa = mapa;
    this.geo = geometrie(mapa, v.figurek);
    const g = this.geo;

    const svg = this.root.querySelector('#clSvg');
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${g.velikost} ${g.velikost}`);

    const vrstvaPole = mk('g');
    const vrstvaFig = mk('g');
    svg.append(vrstvaPole, vrstvaFig);

    const r = g.rPole;

    // Domečky a cíle patří ramenům, ne sedadlům – nakreslíme je pro
    // všechna ramena, ale obarvíme jen ta obsazená.
    const obsazene = new Map(v.ramena.map((rameno, seat) => [rameno, seat]));
    this.cilPrvky = [];      // kvůli zvýraznění tahu do domečku

    for (let rameno = 0; rameno < mapa.ramen; rameno++) {
      const seat = obsazene.get(rameno);
      const b = barvaRamene(rameno);
      const zive = seat !== undefined;

      const cilRada = [];
      for (const p of g.cile[rameno]) {
        const c = mk('circle', {
          cx: p.x, cy: p.y, r: r * 0.9,
          class: `cl-cil${zive ? '' : ' mrtve'}`,
          fill: zive ? b.barva : 'transparent',
          'fill-opacity': zive ? 0.32 : 0,
          stroke: zive ? b.barva : 'currentColor',
          'stroke-opacity': zive ? 0.9 : 0.15,
          'stroke-width': zive ? 2 : 1,
        });
        vrstvaPole.append(c);
        cilRada.push(c);
      }
      this.cilPrvky.push(cilRada);
      for (const p of g.domecky[rameno]) {
        vrstvaPole.append(mk('circle', {
          cx: p.x, cy: p.y, r: r * 0.95,
          fill: zive ? b.barva : 'transparent',
          'fill-opacity': zive ? 0.24 : 0,
          stroke: zive ? b.barva : 'currentColor',
          'stroke-opacity': zive ? 0.75 : 0.12,
          'stroke-width': zive ? 2 : 1,
        }));
      }
    }

    // Dráha. Startovní pole dostane barvu svého ramene.
    this.polePrvky = [];
    const startPole = new Map();
    for (let rameno = 0; rameno < mapa.ramen; rameno++) {
      if (obsazene.has(rameno)) startPole.set(naOkruhu(mapa, rameno, 0), rameno);
    }
    for (let i = 0; i < g.draha.length; i++) {
      const p = g.draha[i];
      const rameno = startPole.get(i);
      const b = rameno !== undefined ? barvaRamene(rameno) : null;
      const c = mk('circle', {
        cx: p.x, cy: p.y, r,
        class: 'cl-pole' + (b ? ' cl-start' : ''),
        fill: b ? b.barva : 'currentColor',
        'fill-opacity': b ? 0.3 : 0.10,
        stroke: b ? b.barva : 'currentColor',
        'stroke-opacity': b ? 0.95 : 0.18,
        'stroke-width': b ? 2.5 : 1,
      });
      vrstvaPole.append(c);
      this.polePrvky.push(c);
    }

    // Figurky – po jedné skupině na hráče a figurku.
    this.figPrvky = [];
    for (let h = 0; h < v.hracu; h++) {
      const b = barvaRamene(v.ramena[h]);
      const rada = [];
      for (let f = 0; f < v.figurek; f++) {
        // Dvě skupiny schválně: vnější drží POZICI (atribut transform),
        // vnitřní se smí hýbat animací. V SVG je totiž `transform` atribut
        // tou samou vlastností jako CSS `transform`, takže poskakování
        // hratelné figurky vnější pozici přepsalo a figurka skočila do
        // rohu desky. Na atributu to vidět nebylo – ten zůstal správný.
        const skup = mk('g', { class: 'cl-fig' });
        const vnitrek = mk('g', { class: 'cl-figv' });
        vnitrek.append(mk('circle', { r: r * 0.8, fill: b.tmava, cx: 0, cy: 2.5 }));
        const telo = mk('circle', { r: r * 0.8, fill: b.barva, stroke: '#fff', 'stroke-width': 1.6, 'stroke-opacity': 0.55, cx: 0, cy: 0 });
        const lesk = mk('circle', { r: r * 0.26, fill: '#fff', 'fill-opacity': 0.4, cx: -r * 0.24, cy: -r * 0.26 });
        const cislo = mk('text', { class: 'cl-fignum', x: 0, y: r * 0.34, 'text-anchor': 'middle' });
        cislo.textContent = String(f + 1);
        vnitrek.append(telo, lesk, cislo);
        skup.append(vnitrek);
        skup.addEventListener('click', () => this.klikFigurka(h, f));
        vrstvaFig.append(skup);
        rada.push(skup);
      }
      this.figPrvky.push(rada);
    }
  },

  // ── Kde figurka stojí ──────────────────────────────────────
  bod(v, hrac, fig) {
    const krok = v.poz[hrac][fig];
    const rameno = v.ramena[hrac];
    if (krok < 0) return this.geo.domecky[rameno][fig];
    const O = okruh(this.mapa);
    if (krok >= O) return this.geo.cile[rameno][Math.min(CIL - 1, krok - O)];
    return this.geo.draha[naOkruhu(this.mapa, rameno, krok)];
  },

  // ── Akce ───────────────────────────────────────────────────
  hod() {
    if (!this.view?.myTurn || this.view.hozeno) return;
    this.ctx.send('action', { a: 'hod' });
  },

  // Jeden klik na figurku obslouží tři různé věci podle toho, v jaké
  // fázi jsme: běžný tah, výběr oběti sniperu a výběr při Sacrifice.
  klikFigurka(hrac, fig) {
    const v = this.view;
    if (!v) return;

    if (v.sniper && v.sniper.hrac === v.mySeat) {
      if (!(v.sniperCile || []).some(c => c.hrac === hrac && c.fig === fig)) return;
      return this.ctx.send('action', { a: 'snipe', hrac, fig });
    }

    if (this.obet) return this.obetKlik(hrac, fig);

    if (!v.myTurn || !v.hozeno) return;
    if (hrac !== v.mySeat) return;
    if (!(v.tahy || []).some(t => t.fig === fig)) return;
    this.ctx.send('action', { a: 'tah', fig });
  },

  tah(hrac, fig) { this.klikFigurka(hrac, fig); },

  // ── Sacrifice: dvě svoje, pak jedna soupeřova ──────────────
  zacniObet() {
    if (!this.view?.muzeObetovat) return;
    this.obet = { moje: [] };
    this.render(this.view);
  },

  zrusObet() {
    this.obet = null;
    if (this.view) this.render(this.view);
  },

  obetKlik(hrac, fig) {
    const v = this.view;
    if (!this.obet) return;

    if (this.obet.moje.length < 2) {
      if (hrac !== v.mySeat) return;
      if (!(v.obetovatelne || []).includes(fig)) return;
      if (this.obet.moje.includes(fig)) this.obet.moje = this.obet.moje.filter(x => x !== fig);
      else this.obet.moje.push(fig);
      return this.render(v);
    }

    if (!(v.obetiCile || []).some(c => c.hrac === hrac && c.fig === fig)) return;
    this.ctx.send('action', {
      a: 'obetuj', a1: this.obet.moje[0], a2: this.obet.moje[1], hrac, fig,
    });
    this.obet = null;
  },

  update(view) {
    if (view.mapa !== this.view?.mapa || view.figurek !== this.view?.figurek) {
      this.zrusLet();
      this.view = view;
      this.postavDesku(view);
    }
    this.view = view;
    this.render(view);
  },

  // Hub posílá CELOU zprávu jedním parametrem (`{kind, ...data}`), ne
  // dvojici (kind, data). Žádná jiná hra události nepoužívá, takže na to
  // tady nebylo podle čeho přijít – animace se prostě tiše nespouštěla.
  event(m) {
    if (m?.kind !== 'kostka') return;
    // Kostka na stole ukazuje POSLEDNÍ hod, ne `view.kostka`. Ta je jen
    // po dobu výběru figurky – když hod nic neumožní, server ji hned
    // nuluje a hráč by se nikdy nedozvěděl, co vlastně hodil.
    this.posledniHod = m.hodnota;
    this.posledniPar = m.kostky || null;
    this.hodKostkou(m.hodnota, m.seat);
  },

  // ── Letící kostka ──────────────────────────────────────────
  //  Vyletí od toho, kdo hází (u sebe od tlačítka, u ostatních od jejich
  //  jmenovky), doskáče doprostřed desky a dotočí se na hozenou hodnotu.
  //  Během letu ukazuje náhodné stěny, dopadne na tu skutečnou.
  //
  //  Kreslí se přes Web Animations API, ne přes přepínání CSS tříd –
  //  ta se u překreslovaného panelu restartují a odpočet v závodech kvůli
  //  tomu blikal. Tenhle prvek navíc žije MIMO panel, takže ho překreslení
  //  stavu nemůže přerušit.
  hodKostkou(hodnota, seat) {
    const letec = this.root?.querySelector('#clLet');
    const svg = this.root?.querySelector('#clSvg');
    if (!letec || !svg) return;

    this.zrusLet();

    // Kdo nechce animace, dostane jen výsledek. Totéž na skryté záložce:
    // tam neběží requestAnimationFrame, takže by kostka visela ve vzduchu.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      || document.visibilityState === 'hidden') {
      this.kresliKostku(hodnota, this.view?.kostky);
      return;
    }

    const zdroj = (seat === this.view?.mySeat)
      ? this.root.querySelector('#clHod')
      : this.root.querySelectorAll('.cl-hrac')[seat];
    const a = (zdroj || this.root.querySelector('#clHod')).getBoundingClientRect();
    const b = svg.getBoundingClientRect();
    const r = this.root.getBoundingClientRect();
    if (!a.width || !b.width) { this.kresliKostku(hodnota, this.view?.kostky); return; }

    const V = 58;
    const x0 = a.left + a.width / 2 - r.left - V / 2;
    const y0 = a.top + a.height / 2 - r.top - V / 2;
    const x1 = b.left + b.width / 2 - r.left - V / 2;
    const y1 = b.top + b.height / 2 - r.top - V / 2;

    // Směr otáčení se liší podle sedadla, ať dva hody po sobě nevypadají stejně.
    const otoc = (seat % 2 ? -1 : 1) * (430 + ((hodnota * 53) % 170));

    letec.style.display = 'block';
    this._leti = true;
    this._anim = letec.animate([
      { transform: `translate(${x0}px,${y0}px) rotate(0deg) scale(.35)`, opacity: 0, offset: 0 },
      { opacity: 1, offset: .14 },
      { transform: `translate(${x1}px,${y1 - 26}px) rotate(${otoc * .8}deg) scale(1.2)`, offset: .58 },
      { transform: `translate(${x1}px,${y1 + 8}px) rotate(${otoc}deg) scale(.92)`, offset: .74 },
      { transform: `translate(${x1}px,${y1 - 7}px) rotate(${otoc}deg) scale(1.06)`, offset: .87 },
      { transform: `translate(${x1}px,${y1}px) rotate(${otoc}deg) scale(1)`, opacity: 1, offset: 1 },
    ], { duration: 620, easing: 'cubic-bezier(.25,.9,.35,1)', fill: 'forwards' });

    // Během letu se stěny přebíjejí – výsledek se ukáže až po dopadu.
    const mrizka = letec.querySelector('.cl-kmrizka');
    let i = 0;
    this._tocim = setInterval(() => this.puntiky(mrizka, 1 + ((i++ * 5 + 2) % 6)), 65);

    this._anim.onfinish = () => this.dopad(hodnota);
    // Pojistka. Když prohlížeč animaci nedokončí – schovaná záložka,
    // uspaný stroj – `onfinish` nepřijde nikdy, kostka by se přetáčela
    // donekonečna a hodnota by se nikdy neukázala. Časovač běží i tam,
    // kde neběží animace, takže dopad zařídí on.
    this._pojistka = setTimeout(() => this.dopad(hodnota), 900);
  },

  // Dopad se může spustit dvakrát (animace i pojistka), tak ať to nevadí.
  dopad(hodnota) {
    if (!this._leti) return;
    this._leti = false;
    if (this._pojistka) { clearTimeout(this._pojistka); this._pojistka = null; }
    if (this._tocim) { clearInterval(this._tocim); this._tocim = null; }

    const letec = this.root?.querySelector('#clLet');
    if (!letec) return;
    this.puntiky(letec.querySelector('.cl-kmrizka'), hodnota);
    this.kresliKostku(hodnota, this.view?.kostky);

    // Chvíli podržet, ať je hodnota čitelná, a zmizet.
    this._mizi = setTimeout(() => {
      const f = letec.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
      const schovej = () => { letec.style.display = 'none'; };
      f.onfinish = schovej;
      this._schovej = setTimeout(schovej, 400);   // zase pojistka
    }, 380);
  },

  zrusLet() {
    if (this._tocim) { clearInterval(this._tocim); this._tocim = null; }
    if (this._mizi) { clearTimeout(this._mizi); this._mizi = null; }
    if (this._pojistka) { clearTimeout(this._pojistka); this._pojistka = null; }
    if (this._schovej) { clearTimeout(this._schovej); this._schovej = null; }
    if (this._anim) { this._anim.onfinish = null; this._anim.cancel(); this._anim = null; }
    this._leti = false;
    const letec = this.root?.querySelector('#clLet');
    if (letec) { letec.getAnimations().forEach(x => x.cancel()); letec.style.display = 'none'; }
  },

  puntiky(mrizka, n) {
    if (!mrizka) return;
    mrizka.innerHTML = '';
    if (!n) return;
    const body = new Set((PUNTIKY[n] || []).map(([r, c]) => `${r},${c}`));
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const d = document.createElement('i');
        if (!body.has(`${r},${c}`)) d.className = 'prazdno';
        mrizka.append(d);
      }
    }
  },

  // Panel umí jednu kostku i dvojici (Double trouble). U dvojice se
  // pod ně připíše součet – na jedné stěně se dvěnáctka nezobrazí.
  kresliKostku(n, kostky = null) {
    const box = this.root?.querySelector('#clKostka');
    if (!box) return;
    const par = kostky && kostky.length === 2;
    const chce = par ? 2 : 1;
    let mrizky = [...box.querySelectorAll('.cl-kmrizka')];
    while (mrizky.length < chce) {
      const d = document.createElement('div');
      d.className = 'cl-kmrizka';
      box.insertBefore(d, box.querySelector('.cl-soucet'));
      mrizky.push(d);
    }
    while (mrizky.length > chce) mrizky.pop().remove();

    if (par) {
      this.puntiky(mrizky[0], kostky[0]);
      this.puntiky(mrizky[1], kostky[1]);
    } else {
      this.puntiky(mrizky[0], n);
    }

    let soucet = box.querySelector('.cl-soucet');
    if (par && n) {
      if (!soucet) {
        soucet = document.createElement('span');
        soucet.className = 'cl-soucet';
        box.append(soucet);
      }
      soucet.textContent = `= ${n}`;
    } else if (soucet) soucet.remove();
    box.classList.toggle('dve', !!par);
  },

  // ── Vykreslení ─────────────────────────────────────────────
  render(v) {
    if (!v) return;
    const O = okruh(this.mapa);
    const moje = new Set((v.tahy || []).map(t => t.fig));
    const cile = new Set((v.tahy || []).map(t => t.na));

    // Kdo je zrovna na výčepě: sniper míří na soupeře, Sacrifice
    // nejdřív na dvě moje a pak taky na soupeře.
    const jaSniper = v.sniper && v.sniper.hrac === v.mySeat;
    const naMusce = new Set();
    if (jaSniper) for (const c of v.sniperCile || []) naMusce.add(`${c.hrac}:${c.fig}`);
    else if (this.obet && this.obet.moje.length >= 2) {
      for (const c of v.obetiCile || []) naMusce.add(`${c.hrac}:${c.fig}`);
    }
    const kObeti = new Set();
    if (this.obet && this.obet.moje.length < 2) {
      for (const f of v.obetovatelne || []) kObeti.add(`${v.mySeat}:${f}`);
    }
    const vybrane = new Set((this.obet?.moje || []).map(f => `${v.mySeat}:${f}`));

    // Figurky
    for (let h = 0; h < v.hracu; h++) {
      for (let f = 0; f < v.figurek; f++) {
        const p = this.bod(v, h, f);
        const skup = this.figPrvky[h]?.[f];
        if (!skup) continue;
        skup.setAttribute('transform', `translate(${p.x} ${p.y})`);
        const klic = `${h}:${f}`;
        const hratelna = !jaSniper && !this.obet && h === v.mySeat && moje.has(f);
        skup.classList.toggle('hratelna', hratelna);
        skup.classList.toggle('namusce', naMusce.has(klic));
        skup.classList.toggle('kobeti', kObeti.has(klic));
        skup.classList.toggle('vybrana', vybrane.has(klic));
        const posl = v.posledni && v.posledni.hrac === h && v.posledni.fig === f;
        skup.classList.toggle('posledni', !!posl);
      }
    }

    // Cílová pole tahů – ať je vidět, kam to půjde. Platí to i pro tah
    // DO DOMEČKU: ten se dřív nezvýrazňoval vůbec, takže když šlo dojít
    // do cíle, hráč nevěděl kam.
    for (const c of this.polePrvky) c.classList.remove('navrh');
    for (const rada of this.cilPrvky || []) for (const c of rada) c.classList.remove('navrh');

    if (v.myTurn && v.hozeno) {
      const mojeRameno = v.ramena[v.mySeat];
      for (const t of v.tahy || []) {
        if (t.na >= O) {
          this.cilPrvky?.[mojeRameno]?.[t.na - O]?.classList.add('navrh');
        } else {
          this.polePrvky[naOkruhu(this.mapa, mojeRameno, t.na)]?.classList.add('navrh');
        }
      }
    }

    this.renderHraci(v);
    this.renderPanel(v);
  },

  renderHraci(v) {
    const box = this.root.querySelector('#clHraci');
    const podpis = `${v.naTahu}|${v.hotovo.join(',')}|${v.vitez}`;
    if (podpis === this._podpisHraci) return;
    this._podpisHraci = podpis;

    box.innerHTML = '';
    for (let h = 0; h < v.hracu; h++) {
      const b = barvaRamene(v.ramena[h]);
      const p = this.ctx.players.find(x => x.uid === v.seats[h]);
      const jmeno = (p?.name || 'Hráč') + (p?.bot || p?.botControlled ? ' 🤖' : '');
      const karta = document.createElement('div');
      karta.className = 'cl-hrac' + (h === v.naTahu ? ' on' : '') + (h === v.mySeat ? ' ja' : '');
      karta.style.setProperty('--c', b.barva);
      const tecky = Array.from({ length: v.figurek }, (_, i) =>
        `<i class="${i < v.hotovo[h] ? 'doma' : ''}"></i>`).join('');
      karta.innerHTML = `<span class="cl-pruh"></span>
        <span class="cl-jmeno">${jmeno}</span>
        <span class="cl-tecky">${tecky}</span>`;
      box.append(karta);
    }
  },

  renderPanel(v) {
    const stav = this.root.querySelector('#clStav');
    const pokusy = this.root.querySelector('#clPokusy');
    const btn = this.root.querySelector('#clHod');
    const figBox = this.root.querySelector('#clFigurky');

    const naTahu = this.ctx.players.find(x => x.uid === v.seats[v.naTahu]);
    const jenJedna = v.hozeno && (v.tahy || []).length === 1;

    const jaSniper = v.sniper && v.sniper.hrac === v.mySeat;
    if (v.vitez !== null) {
      stav.textContent = 'Konec hry';
    } else if (this.obet) {
      stav.textContent = this.obet.moje.length < 2
        ? `Sacrifice: vyber dvě svoje (${this.obet.moje.length}/2)`
        : 'Sacrifice: vyber soupeřovu figurku';
    } else if (jaSniper) {
      stav.textContent = 'Sniper: vyber, koho sundáš';
    } else if (v.sniper) {
      stav.textContent = `${naTahu?.name || 'Soupeř'} míří sniperem…`;
    } else if (!v.myTurn) {
      stav.textContent = `Na tahu je ${naTahu?.name || 'soupeř'}`;
    } else if (!v.hozeno) {
      stav.textContent = 'Hoď kostkou';
    } else if (jenJedna) {
      stav.textContent = 'Jediná možnost – hraje se sama';
    } else {
      stav.textContent = 'Vyber figurku';
    }
    stav.classList.toggle('muj', !!(v.myTurn || jaSniper));

    // Hláška módu. Bez ní vypadá vnucený tah nebo propadlý hod jako chyba.
    const hb = this.root.querySelector('#clHlaska');
    if (v.hlaska?.text) {
      hb.textContent = v.hlaska.text;
      hb.className = `cl-hlaska mod-${v.hlaska.mod}`;
    } else hb.className = 'cl-hlaska hidden';

    const ob = this.root.querySelector('#clObet');
    ob.classList.toggle('hidden', !v.muzeObetovat && !this.obet);
    ob.textContent = this.obet ? '✖ Zrušit oběť' : '⚔️ Obětovat';
    ob.onclick = () => (this.obet ? this.zrusObet() : this.zacniObet());

    // Tečky pokusů dávají smysl jen tam, kde jsou tři – tedy když
    // nemáš čím táhnout a čekáš na šestku.
    pokusy.innerHTML = '';
    if (v.myTurn && v.maxPokusu > 1 && !v.hozeno) {
      for (let i = 0; i < v.maxPokusu; i++) {
        const d = document.createElement('i');
        if (i < v.pokusy) d.className = 'zbyva';
        pokusy.append(d);
      }
    }

    btn.disabled = !v.myTurn || v.hozeno || v.vitez !== null || !!v.sniper || !!this.obet;
    btn.textContent = v.hozeno ? '…' : 'HODIT';
    // Dokud kostka letí, panel výsledek neprozradí – jinak by tam číslo
    // svítilo dřív, než kostka dopadne.
    if (!this._leti) this.kresliKostku(this.posledniHod ?? v.kostka, v.kostky ?? this.posledniPar);

    // Čísla figurek dole. Když je možnost jedna, server ji stejně
    // za vteřinu zahraje sám, tak se nic nenabízí.
    const podpis = `${v.myTurn}|${v.hozeno}|${(v.tahy || []).map(t => t.fig).join(',')}`;
    if (podpis !== this._podpisFig) {
      this._podpisFig = podpis;
      figBox.innerHTML = '';
      if (v.myTurn && v.hozeno && (v.tahy || []).length > 1) {
        const b = barvaRamene(v.ramena[v.mySeat]);
        figBox.append(Object.assign(document.createElement('span'),
          { className: 'cl-fighint', textContent: 'Táhni figurkou:' }));
        for (const t of v.tahy) {
          const btn2 = document.createElement('button');
          btn2.type = 'button';
          btn2.className = 'cl-figbtn' + (t.vyhodi ? ' bere' : '') + (t.couv ? ' couv' : '');
          btn2.style.setProperty('--c', b.barva);
          btn2.textContent = String(t.fig + 1);
          btn2.title = [t.vyhodi ? 'Vyhodí soupeře' : '', t.couv ? 'Couvá zpátky' : ''].filter(Boolean).join(' · ');
          btn2.onclick = () => this.tah(v.mySeat, t.fig);
          figBox.append(btn2);
        }
      }
    }

    const log = this.root.querySelector('#clLog');
    const t = (v.log || []).slice(-3).join(' · ');
    if (t !== log.textContent) log.textContent = t;
  },

  resize() {},

  unmount() {
    this.zrusLet();
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = this.stageDisplay ?? '';
    this.root?.remove();
  },
};
