// ─────────────────────────────────────────────────────────────
//  UNO No Mercy – stůl.
//
//  Kreslí a nic nerozhoduje. Co smí hráč zahrát, říká server v `moznosti`;
//  klient si to nepočítá sám, aby si nešlo v konzoli povolit cokoliv.
//
//  Karty soupeřů se sem vůbec neposílají – jen jejich počty.
// ─────────────────────────────────────────────────────────────
import {
  BARVY, BARVA_INFO, DIVOKA, znak, nazevZnaku, jeDivoka,
} from '/shared/games/uno/karty.js';

const MALY_ZNAK = new Set(['+4', '+6', '+10', '⏭', '🗑']);

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
      <div class="un-soupeti" id="unSoupeti"></div>

      <div class="un-stred">
        <div class="un-trest hidden" id="unTrest"></div>
        <div class="un-hromadky">
          <div class="un-hromadka">
            <span class="un-popis">Balíček</span>
            <div class="un-balicek" id="unBalicek">
              <div class="un-karta un-rub"><div class="un-ram"><div class="un-vnitrek">
                <span class="un-rub-text">UNO</span>
              </div></div></div>
            </div>
            <span class="un-pocet" id="unBalicekPocet">—</span>
          </div>

          <div class="un-smer">
            <span class="un-smer-text" id="unSmer">→</span>
            <span class="un-barva" id="unBarva"></span>
          </div>

          <div class="un-hromadka">
            <span class="un-popis">Odhoz</span>
            <div class="un-odhoz" id="unOdhoz"></div>
            <span class="un-pocet" id="unOdhozPocet"></span>
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

  // ── Akce ───────────────────────────────────────────────────
  lizni() {
    if (!this.view?.myTurn) return;
    this.ctx.send('action', { a: 'lizni' });
  },

  klikKarta(idx) {
    const v = this.view;
    if (!v?.myTurn || !(v.moznosti || []).includes(idx)) return;
    const karta = v.ruka[idx];
    if (jeDivoka(karta)) {
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
    // Nová karta v ruce = zavřít výběr barvy, který se mezitím rozešel.
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

    // Soupeři
    const box = this.root.querySelector('#unSoupeti');
    const podpis = `${v.naTahu}|${v.pocty.join(',')}|${v.vyrazeni.join(',')}|${v.unoOhrozeny}`;
    if (podpis !== this._podpisSoupeti) {
      this._podpisSoupeti = podpis;
      box.innerHTML = '';
      for (let h = 0; h < v.hracu; h++) {
        if (h === v.mySeat) continue;
        const p = this.ctx.players.find(x => x.uid === v.seats[h]);
        const jmeno = (p?.name || 'Hráč') + (p?.bot || p?.botControlled ? ' 🤖' : '');
        const ven = v.vyrazeni.includes(h);
        const mini = Array.from({ length: Math.min(v.pocty[h], 8) }, () => '<i></i>').join('');
        const d = document.createElement('div');
        d.className = `un-souper${h === v.naTahu ? ' on' : ''}${ven ? ' ven' : ''}`;
        d.innerHTML = ven
          ? `<span class="un-jmeno">${jmeno}</span><span class="un-ven">VYŘAZEN</span>`
          : `<span class="un-jmeno">${jmeno}</span>
             <span class="un-pocet-velky">${v.pocty[h]}</span>
             <span class="un-mini">${mini}${v.pocty[h] > 8 ? `<b>+${v.pocty[h] - 8}</b>` : ''}</span>
             ${v.unoOhrozeny === h ? '<span class="un-znacka">UNO?!</span>' : ''}`;
        box.append(d);
      }
    }

    // Střed
    this.root.querySelector('#unOdhoz').innerHTML = this.kartaHtml(v.vrch);
    this.root.querySelector('#unBalicekPocet').textContent = v.balicku;
    this.root.querySelector('#unOdhozPocet').textContent = v.odhozu;
    this.root.querySelector('#unSmer').textContent = v.smer === 1 ? '→' : '←';

    const barva = this.root.querySelector('#unBarva');
    barva.style.background = BARVA_INFO[v.barva]?.hex || '#888';
    barva.title = BARVA_INFO[v.barva]?.nazev || '';

    const trest = this.root.querySelector('#unTrest');
    trest.classList.toggle('hidden', !v.trest);
    if (v.trest) trest.textContent = `⚡ TREST +${v.trest} ⚡`;

    const log = this.root.querySelector('#unLog');
    const t = (v.log || []).slice(-2).join(' · ');
    if (t !== log.textContent) log.textContent = t;

    // Panel
    const stav = this.root.querySelector('#unStav');
    if (v.vitez !== null) stav.textContent = 'Konec hry';
    else if (v.vyrazeni.includes(v.mySeat)) stav.textContent = 'Jsi venku – 25 karet';
    else if (v.vymena && v.vymena.hrac === v.mySeat) stav.textContent = 'Vyber, s kým si vyměníš karty';
    else if (v.vymena) stav.textContent = `${this.ctx.players.find(p => p.uid === v.seats[v.vymena.hrac])?.name || 'Soupeř'} vybírá výměnu…`;
    else if (v.myTurn && v.musiZahrat !== null) stav.textContent = 'Líznutou kartu musíš zahrát';
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

    // Výběr protějšku pro sedmičku
    const vymBox = this.root.querySelector('#unVymena');
    const mojeVymena = v.vymena && v.vymena.hrac === v.mySeat;
    vymBox.classList.toggle('hidden', !mojeVymena);
    if (mojeVymena) {
      const podpisV = (v.cileVymeny || []).join(',') + '|' + v.pocty.join(',');
      if (podpisV !== this._podpisVymeny) {
        this._podpisVymeny = podpisV;
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
      }
    }

    // Ruka
    const ruka = this.root.querySelector('#unRuka');
    const podpisRuky = `${JSON.stringify(v.ruka)}|${(v.moznosti || []).join(',')}|${v.myTurn}`;
    if (podpisRuky !== this._podpisRuky) {
      this._podpisRuky = podpisRuky;
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
    }
  },

  resize() {},

  unmount() {
    const stage = document.getElementById('stage');
    if (stage) stage.style.display = this.stageDisplay ?? '';
    this.root?.remove();
  },
};
