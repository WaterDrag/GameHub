// ─────────────────────────────────────────────────────────────
//  UNO No Mercy – stůl.
//
//  Hráči sedí kolem stolu: já dole, ostatní po horním oblouku, každý
//  s vějířem rubů natočeným do středu. Uprostřed leží balíček a odhoz.
//
//  Kreslí a nic nerozhoduje. Co smí hráč zahrát, říká server
//  v `moznosti`; klient si to nepočítá sám, aby si nešlo v konzoli
//  povolit cokoliv. Karty soupeřů se sem vůbec neposílají – jen počty.
// ─────────────────────────────────────────────────────────────
import {
  BARVY, BARVA_INFO, znak, nazevZnaku, jeDivoka,
} from '/shared/games/uno/karty.js';

const MALY_ZNAK = new Set(['+4', '+6', '+10', '⏭', '🗑', '🎯']);

// Kolik rubů se u soupeře vykreslí, než se to zjednoduší na číslo.
const RUBU_MAX = 7;

export default {
  id: 'uno',

  async mount(ctx) {
    this.ctx = ctx;
    this.view = ctx.view;
    this.divokaIdx = null;

    const stage = document.getElementById('stage');
    if (stage) { this.stageDisplay = stage.style.display; stage.style.display = 'none'; }

    const host = document.getElementById('view-game');
    this.root = document.createElement('div');
    this.root.className = 'un';
    host.appendChild(this.root);

    this.root.innerHTML = `
      <div class="un-stul" id="unStul">
        <div class="un-mista" id="unMista"></div>

        <div class="un-stred">
          <div class="un-trest hidden" id="unTrest"></div>
          <div class="un-hromadky">
            <div class="un-hromadka">
              <div class="un-balicek" id="unBalicek">
                <div class="un-karta un-rub"><div class="un-ram"><div class="un-vnitrek">
                  <span class="un-rub-text">UNO</span>
                </div></div></div>
              </div>
              <span class="un-pocet" id="unBalicekPocet">—</span>
            </div>

            <div class="un-smer">
              <span class="un-smer-sipka" id="unSmer">↻</span>
              <span class="un-barva" id="unBarva"></span>
            </div>

            <div class="un-hromadka">
              <div class="un-odhoz" id="unOdhoz"></div>
              <span class="un-pocet" id="unOdhozPocet"></span>
            </div>
          </div>
        </div>

        <div class="un-log" id="unLog"></div>
      </div>

      <div class="un-panel">
        <div class="un-stav">
          <b id="unStav">…</b>
          <span class="un-mych" id="unMych"></span>
          <button class="un-btn un-chyt hidden" id="unChyt" type="button">🚨 Nachytej!</button>
        </div>
        <div class="un-tlacitka">
          <button class="un-btn" id="unLizni" type="button">Líznout</button>
          <button class="un-btn un-uno hidden" id="unUno" type="button">UNO!</button>
        </div>
        <div class="un-ruka-obal"><div class="un-ruka" id="unRuka"></div></div>
      </div>

      <div class="un-vyber hidden" id="unVyber">
        <div class="un-vyber-box">
          <div class="un-vyber-nadpis">Vyber barvu</div>
          <div class="un-vyber-mrizka" id="unVyberMrizka"></div>
        </div>
      </div>

      <div class="un-vyber hidden" id="unVymena">
        <div class="un-vyber-box">
          <div class="un-vyber-nadpis">S kým si vyměníš karty?</div>
          <div class="un-hraci-mrizka" id="unVymenaMrizka"></div>
        </div>
      </div>`;

    this.root.querySelector('#unLizni').onclick = () => this.lizni();
    this.root.querySelector('#unBalicek').onclick = () => this.lizni();
    this.root.querySelector('#unUno').onclick = () => this.ctx.send('action', { a: 'uno' });
    this.root.querySelector('#unChyt').onclick = () => this.ctx.send('action', { a: 'nachytej' });

    const mrizka = this.root.querySelector('#unVyberMrizka');
    for (const b of BARVY) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `un-barva-btn un-${b}`;
      btn.textContent = BARVA_INFO[b].nazev;
      btn.onclick = () => this.vyberBarvu(b);
      mrizka.append(btn);
    }

    this.render(ctx.view);
  },

  // ── Karta ──────────────────────────────────────────────────
  kartaHtml(k, tridy = '') {
    const s = znak(k.z);
    const maly = MALY_ZNAK.has(s) ? ' maly' : '';
    return `<div class="un-karta un-${k.b} ${tridy}">
      <div class="un-ram"><div class="un-vnitrek">
        <span class="un-oval"></span>
        <span class="un-roh un-roh-lh">${s}</span>
        <span class="un-hlavni${maly}">${s}</span>
        <span class="un-roh un-roh-pd">${s}</span>
      </div></div>
    </div>`;
  },

  // ── Kde kdo sedí ───────────────────────────────────────────
  //  Já jsem dole a nekreslím se – moje karty leží v panelu. Ostatní
  //  se rozprostřou po HORNÍM oblouku, protože obrazovka je široká
  //  a ne kulatá; kolem dokola by se dolní hráči lezli do ruky.
  //
  //  Vrací {x, y} v procentech stolu a náklon vějíře.
  misto(poradi, celkem) {
    const t = celkem === 1 ? 0.5 : poradi / (celkem - 1);
    const uhel = 168 - t * 156;                 // 168° vlevo → 12° vpravo
    const rad = (uhel * Math.PI) / 180;
    // Vodorovný poloměr je menší než svislý poměr stolu – jinak by
    // krajní hráči viseli přes okraj a jmenovky se ořízly.
    return {
      x: 50 + Math.cos(rad) * 36,
      y: 50 - Math.sin(rad) * 42,
      // Vějíř se naklání ke stolu, ale jen mírně – svisle by se
      // zleva i zprava špatně četl.
      naklon: (90 - uhel) * 0.35,
    };
  },

  // ── Akce ───────────────────────────────────────────────────
  lizni() {
    if (!this.view?.myTurn || this.view.musiZahrat !== null || this.view.vymena) return;
    this.ctx.send('action', { a: 'lizni' });
  },

  klikKarta(idx) {
    const v = this.view;
    if (!v?.myTurn || !(v.moznosti || []).includes(idx)) return;
    if (jeDivoka(v.ruka[idx])) {
      this.divokaIdx = idx;
      this.root.querySelector('#unVyber').classList.remove('hidden');
      return;
    }
    this.ctx.send('action', { a: 'zahraj', idx });
  },

  vyberBarvu(b) {
    this.root.querySelector('#unVyber').classList.add('hidden');
    if (this.divokaIdx === null) return;
    this.ctx.send('action', { a: 'zahraj', idx: this.divokaIdx, barva: b });
    this.divokaIdx = null;
  },

  update(view) {
    if (view.naTahu !== this.view?.naTahu) {
      this.root.querySelector('#unVyber').classList.add('hidden');
      this.divokaIdx = null;
    }
    this.view = view;
    this.render(view);
  },

  event(m) {
    if (m?.kind === 'karta') this.blikni();
  },

  blikni() {
    const el = this.root?.querySelector('#unOdhoz .un-karta');
    if (!el) return;
    el.animate([
      { transform: 'scale(.6) rotate(-12deg)', opacity: 0 },
      { transform: 'scale(1.12) rotate(4deg)', opacity: 1, offset: .7 },
      { transform: 'scale(1) rotate(0deg)', opacity: 1 },
    ], { duration: 320, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  },

  // ── Vykreslení ─────────────────────────────────────────────
  render(v) {
    if (!v) return;
    const naTahu = this.ctx.players.find(p => p.uid === v.seats[v.naTahu]);

    this.renderMista(v);

    // Střed
    this.root.querySelector('#unOdhoz').innerHTML = this.kartaHtml(v.vrch);
    this.root.querySelector('#unBalicekPocet').textContent = v.balicku;
    this.root.querySelector('#unOdhozPocet').textContent = v.odhozu;
    const sipka = this.root.querySelector('#unSmer');
    sipka.textContent = v.smer === 1 ? '↻' : '↺';
    sipka.title = v.smer === 1 ? 'Hraje se po směru hodinových ručiček' : 'Hraje se proti směru';

    const barva = this.root.querySelector('#unBarva');
    barva.style.background = BARVA_INFO[v.barva]?.hex || '#888';
    barva.title = BARVA_INFO[v.barva]?.nazev || '';

    const trest = this.root.querySelector('#unTrest');
    trest.classList.toggle('hidden', !v.trest);
    if (v.trest) trest.textContent = `⚡ TREST +${v.trest} ⚡`;

    const log = this.root.querySelector('#unLog');
    const t = (v.log || []).slice(-2).join(' · ');
    if (t !== log.textContent) log.textContent = t;

    this.renderPanel(v);
    this.renderVymenu(v);
    this.renderRuku(v);
  },

  // Místa kolem stolu.
  renderMista(v) {
    const box = this.root.querySelector('#unMista');
    const podpis = `${v.hracu}|${v.mySeat}|${v.naTahu}|${v.pocty.join(',')}|${v.vyrazeni.join(',')}|${v.unoOhrozeny}`;
    if (podpis === this._podpisMist) return;
    this._podpisMist = podpis;
    box.innerHTML = '';

    // Pořadí kolem stolu: po směru sedadel ode mě dál.
    const soupeRi = [];
    for (let o = 1; o < v.hracu; o++) soupeRi.push((v.mySeat + o) % v.hracu);

    soupeRi.forEach((h, i) => {
      const p = this.ctx.players.find(x => x.uid === v.seats[h]);
      const jmeno = (p?.name || 'Hráč') + (p?.bot || p?.botControlled ? ' 🤖' : '');
      const ven = v.vyrazeni.includes(h);
      const m = this.misto(i, soupeRi.length);

      const d = document.createElement('div');
      d.className = `un-misto${h === v.naTahu ? ' on' : ''}${ven ? ' ven' : ''}`;
      d.style.left = `${m.x}%`;
      d.style.top = `${m.y}%`;

      const rubu = Math.min(v.pocty[h], RUBU_MAX);
      const vejir = Array.from({ length: rubu }, (_, j) => {
        // Vějíř se rozevírá od středu; každá karta o kousek jinak.
        const stred = (rubu - 1) / 2;
        const uhel = (j - stred) * 7;
        const zdvih = Math.abs(j - stred) * 2;
        return `<i style="--r:${uhel}deg;--y:${zdvih}px"></i>`;
      }).join('');

      d.innerHTML = ven
        ? `<div class="un-jmenovka"><span class="un-jmeno">${jmeno}</span><b class="un-ven">VEN</b></div>`
        : `<div class="un-vejir" style="--naklon:${m.naklon.toFixed(1)}deg">${vejir}</div>
           <div class="un-jmenovka">
             <span class="un-jmeno">${jmeno}</span>
             <b>${v.pocty[h]}</b>
           </div>
           ${v.unoOhrozeny === h ? '<span class="un-znacka">UNO?!</span>' : ''}`;
      box.append(d);
    });
  },

  renderPanel(v) {
    const naTahu = this.ctx.players.find(p => p.uid === v.seats[v.naTahu]);
    const stav = this.root.querySelector('#unStav');
    if (v.vitez !== null) stav.textContent = 'Konec hry';
    else if (v.vyrazeni.includes(v.mySeat)) stav.textContent = `Jsi venku – ${v.milost} karet`;
    else if (v.vymena && v.vymena.hrac === v.mySeat) stav.textContent = 'Vyber, s kým si vyměníš karty';
    else if (v.vymena) {
      const kdo = this.ctx.players.find(p => p.uid === v.seats[v.vymena.hrac]);
      stav.textContent = `${kdo?.name || 'Soupeř'} vybírá výměnu…`;
    } else if (v.myTurn && v.musiZahrat !== null) stav.textContent = 'Líznutou kartu musíš zahrát';
    else if (v.myTurn) stav.textContent = v.musiLizat ? 'Líži dál…' : 'Jsi na tahu';
    else stav.textContent = `Hraje ${naTahu?.name || 'soupeř'}`;
    stav.classList.toggle('muj', !!v.myTurn);

    this.root.querySelector('#unMych').textContent = `${v.ruka.length} karet`;

    const lizniBtn = this.root.querySelector('#unLizni');
    lizniBtn.disabled = !v.myTurn || v.vitez !== null || v.musiZahrat !== null || !!v.vymena;
    lizniBtn.textContent = v.trest ? `⚡ Líznout +${v.trest}` : 'Líznout';
    lizniBtn.classList.toggle('trest', !!v.trest && v.myTurn);

    this.root.querySelector('#unUno').classList.toggle('hidden', !v.muzuUno);
    this.root.querySelector('#unChyt').classList.toggle('hidden',
      v.unoOhrozeny === null || v.unoOhrozeny === v.mySeat);
  },

  renderVymenu(v) {
    const box = this.root.querySelector('#unVymena');
    const moje = v.vymena && v.vymena.hrac === v.mySeat;
    box.classList.toggle('hidden', !moje);
    if (!moje) return;
    const podpis = (v.cileVymeny || []).join(',') + '|' + v.pocty.join(',');
    if (podpis === this._podpisVymeny) return;
    this._podpisVymeny = podpis;

    const m = this.root.querySelector('#unVymenaMrizka');
    m.innerHTML = '';
    for (const h of v.cileVymeny || []) {
      const p = this.ctx.players.find(x => x.uid === v.seats[h]);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'un-hrac-btn';
      b.innerHTML = `<span>${p?.name || 'Hráč'}</span><b>${v.pocty[h]}</b>`;
      b.onclick = () => this.ctx.send('action', { a: 'vymen', cil: h });
      m.append(b);
    }
  },

  renderRuku(v) {
    const ruka = this.root.querySelector('#unRuka');
    const podpis = `${JSON.stringify(v.ruka)}|${(v.moznosti || []).join(',')}|${v.myTurn}`;
    if (podpis === this._podpisRuky) return;
    this._podpisRuky = podpis;

    ruka.innerHTML = '';
    v.ruka.forEach((k, i) => {
      const lze = v.myTurn && (v.moznosti || []).includes(i);
      const el = document.createElement('div');
      el.innerHTML = this.kartaHtml(k, lze ? 'lze' : 'nelze');
      const karta = el.firstElementChild;
      karta.title = `${nazevZnaku(k.z)}${jeDivoka(k) ? '' : ` (${BARVA_INFO[k.b]?.nazev})`}`;
      if (lze) karta.onclick = () => this.klikKarta(i);
      ruka.append(karta);
    });
  },

  resize() {},

  unmount() {
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = this.stageDisplay ?? '';
    this.root?.remove();
  },
};
