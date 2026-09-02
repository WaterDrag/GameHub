// ─────────────────────────────────────────────────────────────
//  Hub – lepidlo mezi Firebase Auth, WebSocketem a herními views.
// ─────────────────────────────────────────────────────────────
import { net } from './net.js';
import * as A from './auth.js';
import { Identity } from './identity.js';
import * as T from './theme.js';
import { $, $$, el, toast, openModal, closeModal, bindModals, uidColor } from './ui.js';
import { getApp, clearStage } from './pixi.js';

const state = {
  me: null,
  games: [],
  rooms: [],
  room: null,
  players: [],
  gameId: null,
  view: null,      // aktivní herní modul
  pendingGame: null,
  filter: 'all',
  chatRoom: null,   // kód místnosti, jejíž historii máme vykreslenou
  lastChat: null,
  party: null,      // {kod, vudce, clenove[]} nebo null
  cekaPozvanka: null,   // z odkazu: {typ:'m'|'p', kod}
  pratele: null,    // {kod, pratele[], zadosti[]}
  parta: null,      // párty mód: {kolo, kola, tabulka[]} – jiná věc než `party` výše
};

// ── Přepínání obrazovek ──────────────────────────────────────
function show(name) {
  for (const v of $$('.view')) v.classList.toggle('active', v.id === `view-${name}`);
  document.body.dataset.screen = name;
}

// ── Přihlášení ───────────────────────────────────────────────
function applyMe(name, colorKey) {
  const color = uidColor(colorKey);
  const initial = name[0].toUpperCase();
  $('#userName').textContent = name;
  $('#userAvatar').textContent = initial;
  $('#userAvatar').style.background = color;
  $('#heroNick').textContent = name;
  $('#heroAvatar').textContent = initial;
  $('#heroAvatar').style.background = `linear-gradient(135deg,${color},var(--acc))`;
  $('#userChip').classList.add('show');
  $('#btnLogin').classList.add('hidden');
  $('#btnSettings').classList.remove('hidden');
}

function signedOut() {
  state.me = null;
  net.disconnect();
  $('#userChip').classList.remove('show');
  $('#btnLogin').classList.remove('hidden');
  $('#btnSettings').classList.add('hidden');
  show('login');
}

// Hraní bez registrace. Prázdný token = server vydá nový a pošle
// ho ve WELCOME; uložíme si ho, aby přežil refresh i zavření okna.
async function startGuest(nick) {
  const name = String(nick || '').trim().slice(0, 16) || 'Host';
  Identity.mode = 'guest';
  Identity.nick = name;
  state.me = { uid: `guest:${name}`, name, guest: true };
  applyMe(name, Identity.token || name);
  closeModal('modalAuth');
  await net.connect(Identity.guestProvider(), name);
}

A.onUser(async (user) => {
  // Hraješ jako host? Pak do toho Firebase nemluví – ani když v prohlížeči
  // zůstala stará relace. Jinak by ti přepsala uid a UI by tě považovalo
  // za někoho jiného (typicky bys viděl ovládání hostitele, i když jím nejsi).
  if (Identity.mode === 'guest') return;
  if (!user) { signedOut(); return; }
  const name = A.displayName();
  state.me = { uid: user.uid, name, guest: user.isAnonymous, email: user.email };
  applyMe(name, user.uid);
  closeModal('modalAuth');
  await net.connect(A.idToken, name);
});

// ── Stav spojení ─────────────────────────────────────────────
net.on('status', ({ state: s }) => {
  const dot = $('#connDot');
  const txt = $('#connText');
  const map = {
    connecting: ['warn', 'připojuji…'],
    reconnecting: ['warn', 'obnovuji spojení…'],
    online: ['ok', 'online'],
    offline: ['bad', 'odpojeno'],
    authfail: ['bad', 'chyba přihlášení'],
  };
  const [cls, label] = map[s] || ['bad', s];
  dot.className = `conn-dot ${cls}`;
  txt.textContent = label;
});
net.on('latency', ({ ms }) => {
  $('#connPing').textContent = `${ms} ms`;
  $('#statPing').textContent = `${ms}`;
});

// ── Zprávy ze serveru ────────────────────────────────────────
net.on('welcome', (m) => {
  if (m.deviceToken) Identity.token = m.deviceToken;   // nová hostovská identita
  if (state.me) { state.me.uid = m.uid; state.me.name = m.name; }
  state.games = m.games;
  renderGames();
  if (!state.room) { show('hub'); net.send('list'); }
  vyriditPozvanku();
});

// ── Pozvánka z odkazu ──────────────────────────────
//  `?m=KOD` do čekárny, `?p=KOD` do party. Adresa se hned uklidí,
//  jinak by refresh po odchodu člověka natáhl zpátky.
function nactiPozvanku() {
  const q = new URLSearchParams(location.search);
  const m = q.get('m'), pp = q.get('p');
  if (m) state.cekaPozvanka = { typ: 'm', kod: m.toUpperCase().trim() };
  else if (pp) state.cekaPozvanka = { typ: 'p', kod: pp.toUpperCase().trim() };
  if (state.cekaPozvanka) history.replaceState(null, '', location.pathname);
}

function vyriditPozvanku() {
  const z = state.cekaPozvanka;
  if (!z) return;
  state.cekaPozvanka = null;
  if (z.typ === 'p') {
    net.send('partyJoin', { kod: z.kod });
    toast('Připojuji do party…', 'info');
  } else {
    net.send('join', { code: z.kod });
    toast('Připojuji do čekárny…', 'info');
  }
}
nactiPozvanku();

net.on('rooms', (m) => {
  state.rooms = m.list;
  if (m.stats) {
    $('#statOnline').textContent = m.stats.players;
    $('#statRooms').textContent = m.stats.rooms;
  }
  renderRooms();
});

// Nové kolo párty módu – místnost si sama přepnula hru.
net.on('partyKolo', (m) => {
  state.parta = { kolo: m.kolo, kola: m.kola, tabulka: m.tabulka };
  renderPartaChip();
  $('#gameOver').classList.remove('open');
  toast(`Kolo ${m.kolo}/${m.kola}: ${m.emoji} ${m.title}`, 'info', 4000);
});

net.on('friends', (m) => {
  state.pratele = m;
  renderPratele();
  renderRooms();     // kamarádi v seznamu se poznají podle příznaku ze serveru
});

net.on('party', (m) => {
  state.party = m.party;
  if (!m.party) $('#btnParta').textContent = '👥 Založit partu';
  renderParty();
});

net.on('room', (m) => {
  state.room = m.room;
  state.players = m.room.players;
  // Mezi koly párty módu se do čekárny neskáče – hráč zůstane u výsledků
  // předchozí minihry a rovnou mu naběhne odpočet na další.
  const mezikoli = m.room.parta && m.room.status === 'countdown' && document.body.dataset.screen === 'game';
  if (!mezikoli && (m.room.status === 'lobby' || m.room.status === 'countdown')) { show('room'); renderRoom(); }
  else if (mezikoli) renderRoom();
  else renderRoom();
});

net.on('resume', (m) => {
  toast(m.status === 'playing' ? 'Vracím tě do rozehrané hry.' : 'Jsi zpátky v čekárně.', 'success');
});

net.on('countdown', ({ n }) => {
  const ov = $('#countdown');
  ov.classList.add('open');
  ov.querySelector('.count-num').textContent = n;
  ov.querySelector('.count-num').animate(
    [{ transform: 'scale(1.5)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
});

net.on('start', async (m) => {
  $('#countdown').classList.remove('open');
  $('#gameOver').classList.remove('open');
  state.gameId = m.gameId;
  state.players = m.players;
  await mountGame(m);
  if (m.resumed) toast('Pokračuješ tam, kde jsi skončil.', 'success');
});

net.on('snap', (m) => { state.view?.update?.(m.view); });
net.on('event', (m) => {
  // Prevzeti botem hlasi hub centralne, at je to ve vsech hrach stejne.
  if (m.kind === 'botTakeover') {
    const ja = m.uid === state.me?.uid;
    const proc = m.reason === 'nečinnost' ? `${m.after ?? 120} s bez akce` : 'odpojení';
    toast(ja
      // Ikonu si toast přidává sám podle typu, takže tady žádnou nedávej.
      ? `Hraje za tebe bot (${proc}). Ozvi se a bereš si postavu zpět.`
      : `Za hráče ${m.name} teď hraje bot (${proc}).`, ja ? 'warn' : 'info');
  } else if (m.kind === 'botReturn') {
    const ja = m.uid === state.me?.uid;
    toast(ja ? 'Máš postavu zpátky.' : `${m.name} se vrátil ke hře.`, 'success');
  } else if (m.kind === 'botVote') {
    hlasovaniOBota(m);
  } else if (m.kind === 'botVoteEnd') {
    zavriHlasovani();
    if (m.uid !== state.me?.uid) {
      toast(m.duvod === 'ozval se' ? 'Už se ozval, hraje dál.'
        : m.duvod === 'proti' ? 'Nechaláváme mu ještě čas.'
          : 'Hlasování vypršelo, čekáme dál.', 'info');
    }
  }
  state.view?.event?.(m);
});

// ── Hlasování o nahrazení nečinného hráče botem ────────────
//  Dřív bot bral postavu potichu po dvou minutách. Teď se ostatních
//  zeptáme a bot ho vezme jen při shodě všech.
let hlasT = null;

function zavriHlasovani() {
  clearTimeout(hlasT); hlasT = null;
  document.getElementById('botVote')?.remove();
}

function hlasovaniOBota(m) {
  zavriHlasovani();
  const ja = m.uid === state.me?.uid;
  const box = document.createElement('div');
  box.id = 'botVote';
  box.className = 'bot-vote' + (ja ? ' ja' : '');
  box.innerHTML = ja
    ? `<div class="bv-nadpis">⏰ Jsi tam ještě?</div>
       <div class="bv-text">${m.necinny} s bez akce. Ostatní hlasují, jestli tě má nahradit bot –
       stačí cokoliv udělat a hlasování padne.</div>`
    : `<div class="bv-nadpis">⏰ ${m.name} už ${m.necinny} s nic nedělá</div>
       <div class="bv-text">Má ho nahradit bot? Musí se shodnout všichni (${m.hlasu}).
       Když ne, čeká se další dvě minuty.</div>
       <div class="bv-tlacitka">
         <button type="button" class="bv-ne">Ještě počkat</button>
         <button type="button" class="bv-ano">Nahradit botem</button>
       </div>`;
  document.body.appendChild(box);
  if (!ja) {
    box.querySelector('.bv-ano').onclick = () => {
      net.send('voteBot', { uid: m.uid, ano: true });
      box.querySelector('.bv-tlacitka').innerHTML = '<span class="bv-cekam">Čeká se na ostatní…</span>';
    };
    box.querySelector('.bv-ne').onclick = () => {
      net.send('voteBot', { uid: m.uid, ano: false });
      zavriHlasovani();
    };
  }
  hlasT = setTimeout(zavriHlasovani, (m.sekund || 30) * 1000 + 1500);
}

net.on('over', (m) => {
  state.players = m.players;
  const r = m.result;
  const ov = $('#gameOver');
  const p = m.parta;
  // V párty módu rozhoduje celková tabulka, ne tohle kolo – po posledním
  // kole se proto titulek přepne na celkové pořadí.
  const jaVyhral = p?.hotovo ? p.vitezove.includes(state.me?.uid) : r.winners?.includes(state.me?.uid);
  const remiza = p?.hotovo ? p.vitezove.length !== 1 : !!r.draw;
  ov.querySelector('.over-title').textContent = remiza
    ? (p?.hotovo ? 'Párty končí remízou' : 'Remíza')
    : (jaVyhral ? 'Vyhrál jsi! 🏆' : 'Prohrál jsi');
  ov.querySelector('.over-title').className = `over-title ${remiza ? '' : jaVyhral ? 'win' : 'lose'}`;
  ov.querySelector('.over-reason').textContent = r.reason || '';

  const pb = $('#overParta');
  pb.innerHTML = '';
  pb.classList.toggle('hidden', !p);
  if (p) {
    state.parta = { kolo: p.kolo, kola: p.kola, tabulka: p.tabulka };
    renderPartaChip();
    pb.append(el('div', { class: 'op-hlava', text: p.hotovo ? '🏁 Konečné pořadí' : `Po ${p.kolo}. kole z ${p.kola}` }));
    for (const [i, x] of p.tabulka.entries()) {
      pb.append(el('div', { class: `op-radek${x.uid === state.me?.uid ? ' ja' : ''}` },
        el('span', { class: 'op-poradi', text: `${i + 1}.` }),
        el('span', { class: 'op-tecka', style: `background:${uidColor(x.uid)}` }),
        el('span', { class: 'op-jmeno', text: x.name }),
        el('b', { class: 'op-body', text: `${x.bodu}` }),
      ));
    }
    if (!p.hotovo && p.dalsi) {
      pb.append(el('div', { class: 'op-dalsi' },
        `Další kolo: ${p.dalsi.emoji} ${p.dalsi.title} — začíná za `,
        el('b', { id: 'opOdpocet', text: `${Math.round(p.pauza / 1000)} s` }),
      ));
      odpocitej(Math.round(p.pauza / 1000));
    }
  }

  // Odveta se v párty módu neřeší – pokračuje se samo.
  $('#btnRematch').classList.toggle('hidden', !!p || state.room?.hostUid !== state.me?.uid);
  ov.classList.add('open');
});

let odpocetTimer = null;
function odpocitej(n) {
  clearInterval(odpocetTimer);
  odpocetTimer = setInterval(() => {
    n--;
    const b = $('#opOdpocet');
    if (!b || n <= 0) { clearInterval(odpocetTimer); return; }
    b.textContent = `${n} s`;
  }, 1000);
}

net.on('chat', (m) => pushChat(m));

net.on('left', ({ reason }) => {
  const why = {
    kicked: 'Hostitel tě vyhodil.',
    timeout: 'Nestihl ses vrátit do hry.',
    closed: 'Místnost byla zrušena.',
    left: null,
  }[reason];
  if (why) toast(why, 'warn');
  unmountGame();
  state.room = null;
  state.chatRoom = null;      // při dalším vstupu vykreslit historii znovu
  $('#gameOver').classList.remove('open');
  show('hub');
  net.send('list');
});

// Server posílá i potvrzení („žádost odešla“) stejnou cestou – liší se `ok`.
net.on('error', (m) => toast(m.msg, m.ok ? 'success' : 'error'));

// ── Herní view ───────────────────────────────────────────────
async function mountGame(m) {
  unmountGame();
  show('game');
  const holder = $('#stage');
  const app = await getApp(holder);
  clearStage();

  const mod = (await import(`./games/${m.gameId}.js`)).default;
  state.view = mod;
  const ctx = {
    app, stage: app.stage, net,
    send: (t, d) => net.send(t, d),
    view: m.view,
    // Zivy odkaz, ne kopie: `net.on('room')` cele pole nahrazuje novym,
    // takze hra by jinak navzdy koukala na seznam z okamziku pripojeni
    // a nikdy by se nedozvedela, ze za nekoho zacal hrat bot.
    get players() { return state.players; },
    myUid: state.me.uid,
    hud: $('#hud'),
    toast,
  };
  await mod.mount(ctx);
  if (!state._resizeBound) {
    app.renderer.on('resize', (w, h) => state.view?.resize?.(w, h));
    state._resizeBound = true;
  }
}

function unmountGame() {
  if (!state.view) return;
  try { state.view.unmount?.(); } catch { /* při rychlém přepnutí nevadí */ }
  state.view = null;
  $('#hud').innerHTML = '';
  clearStage();
}

// ── Render: mřížka her ───────────────────────────────────────
// Každá hra má vlastní akcentovou barvu – karty pak nejsou jen
// emoji na šedém obdélníku, ale dají se od sebe poznat na první pohled.
const GAME_ACCENT = {
  gomoku: '#7c6ff7',
  chess:  '#e0b25c',
  ludo:   '#ff6b81',
  arena:  '#ff4d4d',
  racing: '#22d3ee',
};

// Hry, které teprve budou. Bez nich vypadá hub s jednou hrou prázdně
// a zároveň je z něj hned vidět, co se chystá.
const PLANNED = [
  { id: 'arena',  title: 'Arena',              emoji: '🔫', desc: 'Top-down deathmatch v reálném čase.', realtime: true,  minPlayers: 2, maxPlayers: 8 },
  { id: 'racing', title: 'Závody',             emoji: '🏁', desc: 'Rychlá kola shora, boti drží stopu.',  realtime: true,  minPlayers: 2, maxPlayers: 6 },
];

function accentFor(id) {
  if (GAME_ACCENT[id]) return GAME_ACCENT[id];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 68% 62%)`;
}

function gameCard(g, soon) {
  const card = el('div', {
    class: `game-card${soon ? ' soon' : ''}`,
    style: `--c:${accentFor(g.id)}`,
    onclick: soon ? () => toast(`${g.title} se teprve chystá.`, 'info') : () => openGame(g),
  },
    soon ? el('span', { class: 'soon-tag', text: 'brzy' }) : null,
    el('div', { class: 'game-emoji', text: g.emoji }),
    el('div', { class: 'game-title', text: g.title }),
    el('div', { class: 'game-desc', text: g.desc || '' }),
    el('div', { class: 'badges' },
      el('span', { class: 'badge', text: `👥 ${g.minPlayers}–${g.maxPlayers}` }),
      g.supportsBots ? el('span', { class: 'badge', text: '🤖 boti' }) : null,
      el('span', { class: `badge${soon ? '' : ' hot'}`, text: g.realtime ? '⚡ real-time' : '♟ tahová' }),
    ),
  );
  return card;
}

// Bez tohohle by "zavo" nenašlo Závody a "piskvorky" Piškvorky –
// nikdo při hledání diakritiku nepíše.
const fold = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function renderGames() {
  const grid = $('#gameGrid');
  const q = fold($('#gameSearch').value.trim());
  const f = state.filter;
  const match = (g) => {
    if (f === 'realtime' && !g.realtime) return false;
    if (f === 'turn' && g.realtime) return false;
    if (!q) return true;
    return fold(`${g.title} ${g.desc || ''}`).includes(q);
  };

  const live = state.games.filter(match);
  const liveIds = new Set(state.games.map(g => g.id));
  const soon = PLANNED.filter(g => !liveIds.has(g.id)).filter(match);

  grid.innerHTML = '';
  if (!live.length && !soon.length) {
    grid.append(el('div', { class: 'empty', text: 'Nic takového tu není. Zkus jiné hledání.' }));
    return;
  }
  for (const g of live) grid.append(gameCard(g, false));
  for (const g of soon) grid.append(gameCard(g, true));
}

// ── Render: motivy ───────────────────────────────────────────
function renderThemes() {
  const active = T.getTheme();

  const grid = $('#themeGrid');
  grid.innerHTML = '';
  for (const t of T.THEMES) {
    // paletu vytáhneme tak, že motiv nanečisto aplikujeme na odpojený
    // element – nemusíme ji tak držet duplicitně v JS
    const probe = document.createElement('div');
    probe.dataset.theme = t.id;
    probe.style.display = 'none';
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    const v = (n) => cs.getPropertyValue(n).trim();
    const pal = { bg: v('--surface'), acc: v('--acc'), ok: v('--ok'), tx: v('--tx'), tx2: v('--tx2'), bg2: v('--bg') };
    probe.remove();

    grid.append(el('div', {
      class: `theme-card${t.id === active ? ' active' : ''}`,
      style: `--t-bg:${pal.bg};--t-acc:${pal.acc};--t-tx:${pal.tx};--t-tx2:${pal.tx2}`,
      onclick: () => { T.applyTheme(t.id); renderThemes(); },
    },
      el('div', { class: 'theme-top' },
        el('span', { text: t.emoji }),
        el('div', {},
          el('div', { class: 'theme-name', text: t.name }),
          el('div', { class: 'theme-note', text: t.note }),
        ),
        t.id === active ? el('span', { class: 'theme-check', text: '✓' }) : null,
      ),
      el('div', { class: 'theme-swatches' },
        el('i', { style: `background:${pal.bg2}` }),
        el('i', { style: `background:${pal.acc}` }),
        el('i', { style: `background:${pal.ok}` }),
        el('i', { style: `background:${pal.tx}` }),
      ),
    ));
  }

  // rychlý přepínač na přihlašovací obrazovce
  const mini = $('#heroThemes');
  mini.innerHTML = '';
  for (const t of T.THEMES) {
    const probe = document.createElement('div');
    probe.dataset.theme = t.id;
    probe.style.display = 'none';
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    const a = cs.getPropertyValue('--acc').trim();
    const o = cs.getPropertyValue('--ok').trim();
    probe.remove();
    mini.append(el('div', {
      class: `theme-mini${t.id === active ? ' active' : ''}`,
      style: `--m1:${a};--m2:${o}`,
      title: t.name,
      onclick: () => { T.applyTheme(t.id); renderThemes(); },
    }));
  }
}

function openGame(g) {
  state.pendingGame = g;
  $('#pickTitle').textContent = `${g.emoji} ${g.title}`;
  $('#pickBots').max = String(g.maxPlayers - 1);
  $('#pickBots').value = '0';
  $('#pickBotRow').classList.toggle('hidden', !g.supportsBots);

  // Volby si hra popisuje sama, hub o žádné konkrétní neví.
  const box = $('#pickOptions');
  box.innerHTML = '';
  const opts = g.options || [];
  box.classList.toggle('hidden', !opts.length);
  if (opts.length) {
    // Nadpis si může hra pojmenovat sama – „Události“ sedí aréně,
    // ale u závodů jsou to prostě prvky na trati.
    box.append(el('div', { class: 'opt-head', text: g.optionsTitle || 'Události ve hře' }));
    for (const o of opts) box.append(optionRow(o, null, {}));
  }
  openModal('modalPick');
}

// Jeden řádek nastavení. Používá se dvakrát: při zakládání místnosti
// (kde se hodnoty jen posbírají z DOMu) i v čekárně (kde se každá změna
// hned posílá serveru). Hub nezná ani jednu konkrétní volbu – všechno,
// včetně zámků a popisků, přijde od hry.
function optionRow(o, hodnoty, { zamek = null, info = null, editable = true, onZmena = null } = {}) {
  const mam = hodnoty ? hodnoty[o.key] : undefined;

  if (o.typ === 'volba') {
    const cur = mam !== undefined ? mam : o.def;
    const box = el('div', { class: `opt-volba${zamek ? ' zamceno' : ''}`, 'data-key': o.key });
    box.dataset.v = JSON.stringify(cur);
    box.append(el('div', { class: 'opt-label' },
      el('b', { text: o.label }),
      zamek ? el('small', { class: 'zamek', text: `🔒 ${zamek}` }) : null,
    ));
    const rada = el('div', { class: 'opt-choices' });
    for (const v of o.volby || []) {
      const popis = info?.[o.key]?.[v.v] || v.desc || '';
      const b = el('button', {
        type: 'button',
        class: `opt-choice${v.v === cur ? ' sel' : ''}`,
        title: v.desc || '',
        disabled: (!editable || zamek) ? '' : null,
      },
        el('span', { class: 'oc-top', text: `${v.emoji ? v.emoji + ' ' : ''}${v.label}` }),
        popis ? el('small', { text: popis }) : null,
      );
      b.onclick = () => {
        if (!editable || zamek) return;
        box.dataset.v = JSON.stringify(v.v);
        for (const x of rada.children) x.classList.toggle('sel', x === b);
        onZmena?.(o.key, v.v);
      };
      rada.append(b);
    }
    box.append(rada);
    return box;
  }

  const cur = mam !== undefined ? !!mam : !!o.def;
  const inp = el('input', {
    type: 'checkbox', 'data-key': o.key,
    ...(cur ? { checked: 'checked' } : {}),
    disabled: editable ? null : '',
  });
  inp.onchange = () => onZmena?.(o.key, inp.checked);
  return el('label', { class: `opt${editable ? '' : ' zamceno'}` }, inp,
    el('span', { class: 'opt-emoji', text: o.emoji || '' }),
    el('span', { class: 'opt-text' },
      el('b', { text: o.label }),
      el('small', { text: o.desc || '' }),
    ),
  );
}

function pickedOptions() {
  const out = {};
  for (const i of $$('#pickOptions input[type=checkbox]')) out[i.dataset.key] = i.checked;
  for (const b of $$('#pickOptions .opt-volba')) {
    try { out[b.dataset.key] = JSON.parse(b.dataset.v); } catch (e) { /* nevadí */ }
  }
  return out;
}

// ── Parta ───────────────────────────────────────
//  Parta je skupina lidí, ne jedna hra – drží pohromadě i po dohrání.
//  Vůdce založí místnost a jedním tlačítkem do ní natáhne všechny.
function odkazNa(typ, kod) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set(typ, kod);
  return u.toString();
}

async function zkopiruj(text, hlaska) {
  try {
    await navigator.clipboard.writeText(text);
    toast(hlaska, 'success');
  } catch {
    // Bez schránky (nezabezpečený kontext) ať to aspoň jde přečíst.
    toast(text, 'info');
  }
}

function renderParty() {
  const box = $('#partyBox');
  const p = state.party;
  box.classList.toggle('hidden', !p);
  if (!p) return;

  const jsemVudce = p.vudce === state.me?.uid;
  $('#partyKod').textContent = p.kod;
  $('#btnParta').textContent = '👥 Parta';
  // Když vůdce založí místnost, parta se do ní natáhne sama; tlačítko je
  // pro případ, že se někdo připojil až potom nebo mezitím odešel jinam.
  $('#partyNatahni').classList.toggle('hidden', !jsemVudce || !state.room);
  $('#partyNatahni').textContent = p.clenove.length > 1 ? '⬇ Natáhnout do hry' : '⬇ Natáhnout';

  const box2 = $('#partyClenove');
  box2.innerHTML = '';
  for (const c of p.clenove) {
    const radek = el('div', { class: `party-clen${c.online ? '' : ' pryc'}` },
      el('span', { class: 'party-tecka', style: `background:${uidColor(c.uid)}` }),
      el('span', { class: 'party-jmeno', text: c.name + (c.uid === p.vudce ? ' ★' : '') }),
      (jsemVudce && c.uid !== p.vudce)
        ? el('button', {
          class: 'party-x', type: 'button', title: 'Vyhodit z party',
          onclick: () => net.send('partyKick', { uid: c.uid }),
        }, document.createTextNode('✕'))
        : null,
    );
    box2.append(radek);
  }
}

// ── Render: párty mód ────────────────────────────────────────
//  Malý štítek u hry – jinak se v páté minihře zapomene, o co se hraje.
function renderPartaChip() {
  const chip = $('#partaChip');
  const p = state.parta;
  chip.classList.toggle('hidden', !p);
  if (!p) return;
  chip.innerHTML = '';
  chip.append(el('span', { class: 'pc-kolo', text: `Kolo ${p.kolo}/${p.kola}` }));
  for (const x of (p.tabulka || []).slice(0, 4)) {
    chip.append(el('span', { class: 'pc-hrac' },
      el('span', { class: 'pc-tecka', style: `background:${uidColor(x.uid)}` }),
      el('span', { text: `${x.name} ${x.bodu}` }),
    ));
  }
}

// ── Render: přátelé ──────────────────────────────────────────
function renderPratele() {
  const p = state.pratele;
  const badge = $('#prateleBadge');
  badge.classList.toggle('hidden', !p?.zadosti?.length);
  badge.textContent = p?.zadosti?.length || '';
  if (!p) return;

  $('#prMujKod').textContent = p.kod;

  const zb = $('#prZadosti');
  zb.innerHTML = '';
  $('#prZadostiBox').classList.toggle('hidden', !p.zadosti.length);
  for (const z of p.zadosti) {
    zb.append(el('div', { class: 'pr-radek' },
      el('span', { class: 'pr-tecka', style: `background:${uidColor(z.uid)}` }),
      el('span', { class: 'pr-jmeno', text: z.name }),
      el('button', { class: 'btn ok small', onclick: () => net.send('friendAccept', { uid: z.uid }) }, '✓'),
      el('button', { class: 'btn ghost small', onclick: () => net.send('friendDecline', { uid: z.uid }) }, '✕'),
    ));
  }

  const sb = $('#prSeznam');
  sb.innerHTML = '';
  if (!p.pratele.length) {
    sb.append(el('div', { class: 'empty', text: 'Zatím nikoho. Vyměňte si kódy!' }));
    return;
  }
  for (const k of p.pratele) {
    // Do soukromé místnosti kamaráda skočit nejde – ta je jen na kód.
    const lze = k.kde && !k.kde.soukroma && k.kde.status === 'lobby';
    sb.append(el('div', { class: `pr-radek${k.online ? '' : ' pryc'}` },
      el('span', { class: 'pr-tecka', style: `background:${uidColor(k.uid)}` }),
      el('span', { class: 'pr-jmeno', text: k.name }),
      el('span', {
        class: 'pr-kde',
        text: k.kde ? `${k.kde.emoji} ${k.kde.hra}` : (k.online ? 'v hubu' : 'offline'),
      }),
      lze ? el('button', {
        class: 'btn ok small',
        onclick: () => { closeModal('modalPratele'); net.send('join', { code: k.kde.code }); },
      }, 'Přidat se') : null,
      el('button', {
        class: 'btn ghost small', title: 'Odebrat z přátel',
        onclick: () => { if (confirm(`Odebrat ${k.name} z přátel?`)) net.send('friendRemove', { uid: k.uid }); },
      }, '✕'),
    ));
  }
}

// ── Render: veřejné místnosti ────────────────────────────────
function renderRooms() {
  const box = $('#roomList');
  box.innerHTML = '';
  if (!state.rooms.length) {
    box.append(el('div', { class: 'empty', text: 'Zatím nikdo nehledá spoluhráče. Založ místnost!' }));
    return;
  }
  for (const r of state.rooms) {
    box.append(el('div', { class: `room-row${r.pratele ? ' kamarad' : ''}`, onclick: () => net.send('join', { code: r.code }) },
      el('div', { class: 'room-emoji', text: r.emoji }),
      el('div', { class: 'room-info' },
        el('div', { class: 'room-title' }, r.gameTitle,
          r.pratele ? el('span', { class: 'room-znak', text: r.jenPratele ? '🫂 jen přátelé' : '🫂 kamarád' }) : null),
        el('div', { class: 'room-meta', text: `${r.hostName} · kód ${r.code}${r.bots ? ` · ${r.bots} bot(i)` : ''}` }),
      ),
      el('div', { class: 'room-count', text: `${r.count}/${r.maxPlayers}` }),
    ));
  }
}

// ── Render: čekárna ──────────────────────────────────────────
function renderRoom() {
  const r = state.room;
  if (!r) return;
  const amHost = r.hostUid === state.me?.uid;
  $('#roomTitle').textContent = `${r.emoji} ${r.gameTitle}`;
  $('#roomCode').textContent = r.code;
  $('#roomVis').textContent =
    { public: '🌐 veřejná', pratele: '🫂 jen přátelé', private: '🔒 soukromá' }[r.visibility] || '🔒 soukromá';
  $('#roomCount').textContent = `${r.players.length}/${r.maxPlayers}`;

  // Nastavení se mění TADY, ne při zakládání místnosti. Teprve v čekárně
  // je totiž známý počet hráčů, a podle něj hra některé volby zamyká.
  const ob = $('#roomOptions');
  ob.innerHTML = '';
  const defs = r.optionDefs || [];
  ob.className = 'opt-panel';
  ob.classList.toggle('hidden', !defs.length);
  if (defs.length) {
    ob.append(el('div', { class: 'opt-head', text: r.optionsTitle || 'Události ve hře' }));
    for (const o of defs) {
      ob.append(optionRow(o, r.options, {
        zamek: r.optionZamky?.[o.key] || null,
        info: r.optionInfo,
        editable: amHost,
        onZmena: (key, value) => net.send('setOption', { key, value }),
      }));
    }
    if (r.optionInfo?.odhad) {
      ob.append(el('div', { class: 'opt-odhad' },
        el('span', { text: '⏱ Odhad délky partie: ' }),
        el('b', { text: r.optionInfo.odhad }),
        el('small', { text: r.optionInfo.odhadPozn
          ? ` (${r.optionInfo.odhadPozn})`
          : ' (změřeno na botech, ne slib)' }),
      ));
    }
    if (!amHost) ob.append(el('div', { class: 'opt-pozn', text: 'Nastavení mění hostitel.' }));
  }

  const list = $('#playerList');
  list.innerHTML = '';
  for (const p of r.players) {
    list.append(el('div', { class: `player ${p.connected ? '' : 'off'}` },
      el('div', { class: 'p-avatar', text: p.name[0].toUpperCase() }),
      el('div', { class: 'p-name' }, p.name,
        p.isHost ? el('span', { class: 'tag host', text: 'host' }) : null,
        p.bot ? el('span', { class: 'tag bot', text: p.botLevel }) : null,
        !p.connected && !p.bot ? el('span', { class: 'tag off', text: 'odpojen' }) : null,
      ),
      amHost && p.uid !== state.me.uid
        ? el('button', {
            class: 'btn tiny danger',
            text: p.bot ? 'odebrat' : 'vyhodit',
            onclick: () => net.send(p.bot ? 'delBot' : 'kick', { uid: p.uid }),
          })
        : null,
    ));
  }

  const full = r.players.length >= r.maxPlayers;

  // Párty mód: buď se dá spustit, nebo je vidět, jak jde.
  state.parta = r.parta ? { ...r.parta } : null;
  renderPartaChip();
  const vParty = !!r.parta;
  $('#partaModRow').classList.toggle('hidden', !amHost || vParty || r.players.length < 2);
  const ps = $('#partaStav');
  ps.classList.toggle('hidden', !vParty);
  if (vParty) {
    ps.innerHTML = '';
    ps.append(el('b', { text: `🎉 Párty mód · kolo ${r.parta.kolo}/${r.parta.kola}` }));
    ps.append(el('div', { class: 'ps-tabulka' },
      ...r.parta.tabulka.map(x => el('span', { class: 'ps-hrac', text: `${x.name} ${x.bodu}` }))));
    if (amHost) {
      ps.append(el('button', { class: 'btn ghost small', onclick: () => net.send('partyStop') }, 'Ukončit párty mód'));
    }
  }

  $('#btnStart').classList.toggle('hidden', !amHost || vParty);
  $('#btnStart').disabled = r.players.length < r.minPlayers;
  $('#btnStart').textContent = r.players.length < r.minPlayers
    ? `Potřeba ${r.minPlayers} hráči` : '🚀 Spustit hru';

  // Celý blok s boty je věc hostitele – host bez práv ho nemá vůbec vidět.
  // A když je lobby plné, nedává smysl ani ta obtížnost.
  $('#botRow').classList.toggle('hidden', !amHost || !r.supportsBots);
  $('#btnAddBot').disabled = full;
  $('#lobbyBotLevel').disabled = full;
  $('#btnAddBot').textContent = full ? '✓ Lobby je plné' : '🤖 Přidat bota';

  $('#waitMsg').classList.toggle('hidden', amHost);
  renderChat(r);
}

// ── Chat ─────────────────────────────────────────────────────
function chatBubble(m, prev) {
  const mine = m.uid === state.me?.uid;
  // jméno opakujeme jen když se střídá pisatel – jinak je z toho zeď textu
  const showName = !mine && prev?.uid !== m.uid;
  return el('div', { class: `bubble ${mine ? 'me' : 'them'}${showName ? ' first' : ''}` },
    showName ? el('span', { class: 'who', text: m.from }) : null,
    el('span', { class: 'txt', text: m.msg }),
  );
}

function pushChat(m) {
  const box = $('#chatLog');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.append(chatBubble(m, state.lastChat));
  state.lastChat = m;
  if (nearBottom) box.scrollTop = box.scrollHeight;   // ať mi to neuteče, když čtu starší
}

// Historii vykreslíme jen při vstupu do místnosti; dál se jen připisuje.
function renderChat(r) {
  if (state.chatRoom === r.code) return;
  state.chatRoom = r.code;
  state.lastChat = null;
  const box = $('#chatLog');
  box.innerHTML = '';
  for (const m of r.chat || []) pushChat(m);
}

// ── Ovládací prvky ───────────────────────────────────────────
function bind() {
  bindModals();

  $('#btnLogin').onclick = () => openModal('modalAuth');
  $('#btnLoginBig').onclick = (e) => { e.preventDefault(); openModal('modalAuth'); };

  const playAsGuest = () => startGuest($('#nickStart').value);
  $('#btnPlayGuest').onclick = playAsGuest;
  $('#nickStart').addEventListener('keydown', e => { if (e.key === 'Enter') playAsGuest(); });
  $('#btnSettings').onclick = () => $('#menu').classList.toggle('open');
  $('#btnTheme').onclick = () => { $('#menu').classList.remove('open'); renderThemes(); openModal('modalTheme'); };

  // filtry a hledání her
  for (const tab of $$('#gameTabs .tab')) {
    tab.onclick = () => {
      $$('#gameTabs .tab').forEach(t => t.classList.toggle('active', t === tab));
      state.filter = tab.dataset.f;
      renderGames();
    };
  }
  $('#gameSearch').addEventListener('input', renderGames);
  document.addEventListener('click', e => {
    if (!e.target.closest('#btnSettings') && !e.target.closest('#menu')) $('#menu').classList.remove('open');
  });

  // Přihlášení přes Firebase musí nejdřív vypnout hostovský režim,
  // jinak by ho onUser níž ignoroval. Při neúspěchu se režim vrátí.
  const useFirebase = async (fn) => {
    const prev = Identity.mode;
    Identity.mode = 'firebase';
    try { await fn(); }
    catch (e) { Identity.mode = prev; toast(e.message, 'error'); }
  };
  $('#btnDoLogin').onclick = () => useFirebase(() => A.login($('#authEmail').value, $('#authPass').value));
  $('#btnDoRegister').onclick = () => useFirebase(() => A.register($('#authEmail').value, $('#authPass').value));
  $('#btnGoogle').onclick = () => useFirebase(() => A.loginGoogle());
  $('#btnLogout').onclick = () => {
    if (Identity.mode === 'guest') { Identity.forget(); signedOut(); return; }
    Identity.mode = null;
    A.logout();
  };

  $('#btnNick').onclick = () => { $('#nickInput').value = state.me?.name || ''; openModal('modalNick'); };
  $('#btnSaveNick').onclick = async () => {
    const n = $('#nickInput').value.trim().slice(0, 16);
    if (!n) return;
    closeModal('modalNick');
    if (Identity.mode === 'guest') {
      // device token zůstává, mění se jen zobrazované jméno
      Identity.nick = n;
      state.me.name = n;
      $('#userName').textContent = n;
      net.disconnect();
      await net.connect(Identity.guestProvider(), n);
    } else {
      await A.setNick(n);
      state.me.name = n;
      $('#userName').textContent = n;
      net.disconnect();
      await net.connect(A.idToken, n);
    }
    toast('Přezdívka změněna.', 'success');
  };

  // výběr hry
  $('#btnPickQuick').onclick = () => {
    net.send('quickplay', { gameId: state.pendingGame.id });
    closeModal('modalPick');
  };
  $('#btnPickCreate').onclick = () => {
    net.send('create', {
      gameId: state.pendingGame.id,
      visibility: $('#pickVis').value,
      bots: parseInt($('#pickBots').value) || 0,
      botLevel: $('#pickBotLevel').value,
      options: pickedOptions(),
    });
    closeModal('modalPick');
  };

  // připojení kódem
  const joinByCode = () => {
    const code = $('#codeInput').value.trim().toUpperCase();
    if (code) net.send('join', { code });
    $('#codeInput').value = '';
  };
  $('#btnJoinCode').onclick = joinByCode;
  $('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinByCode(); });

  // čekárna
  $('#btnStart').onclick = () => net.send('start');
  $('#btnAddBot').onclick = () => net.send('addBot', { difficulty: $('#lobbyBotLevel').value });
  $('#btnLeaveRoom').onclick = () => net.send('leave');
  $('#roomCode').onclick = () => {
    navigator.clipboard.writeText(state.room.code).then(() => toast('Kód zkopírován.', 'success'));
  };

  // hra
  $('#btnLeaveGame').onclick = () => {
    if (confirm('Opustit hru? Do 3 minut se můžeš vrátit, pak tvoje místo zanikne.')) net.send('leave');
  };
  $('#btnRematch').onclick = () => { $('#gameOver').classList.remove('open'); net.send('rematch'); };
  $('#btnBackToHub').onclick = () => net.send('leave');

  const sendChat = () => {
    const i = $('#chatInput');
    if (i.value.trim()) net.send('chat', { msg: i.value.trim() });
    i.value = '';
  };
  $('#btnChat').onclick = sendChat;

  // ── Parta ───────────────────────────────────
  $('#btnParta').onclick = () => {
    if (state.party) return toast('Už partu máš.', 'info');
    net.send('partyNew');
  };
  $('#btnPartaMod').onclick = () => net.send('partyMod', { kola: Number($('#partaKola').value) });

  $('#btnPratele').onclick = () => { net.send('friends'); openModal('modalPratele'); };
  $('#prMujKod').onclick = () => {
    if (state.pratele?.kod) zkopiruj(state.pratele.kod, 'Tvůj kód je ve schránce.');
  };
  const pridej = () => {
    const kod = $('#prKodInput').value.trim().toUpperCase();
    if (kod.length < 4) return toast('Zadej kód kamaráda.', 'warn');
    net.send('friendAdd', { kod });
    $('#prKodInput').value = '';
  };
  $('#btnPrPridat').onclick = pridej;
  $('#prKodInput').onkeydown = (e) => { if (e.key === 'Enter') pridej(); };

  $('#partyPryc').onclick = () => net.send('partyLeave');
  $('#partyNatahni').onclick = () => net.send('partyPull');
  const odkazParty = () => {
    if (!state.party) return;
    zkopiruj(odkazNa('p', state.party.kod), 'Odkaz na partu je ve schránce.');
  };
  $('#partyOdkaz').onclick = odkazParty;
  $('#partyKod').onclick = odkazParty;
  $('#partySbal').onclick = () => {
    const t = $('#partyTelo');
    const sbaleno = t.classList.toggle('hidden');
    $('#partySbal').textContent = sbaleno ? '+' : '–';
  };

  // Pozvánka do čekárny – odkaz, ne opisování kódu.
  $('#btnPozvanka').onclick = () => {
    if (!state.room) return;
    zkopiruj(odkazNa('m', state.room.code), 'Pozvánka do čekárny je ve schránce.');
  };
  $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}

// ── Dev přihlášení ───────────────────────────────────────────
// Jen na localhostu a jen když server běží s GH_DEV_AUTH=1.
// Umožní otevřít dva taby a odehrát zápas bez zakládání účtů.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.ghDev = async (name = 'Dev') => {
    state.me = { uid: `dev:${name.toLowerCase()}`, name, guest: true };
    $('#userName').textContent = name;
    $('#userAvatar').textContent = name[0].toUpperCase();
    $('#userAvatar').style.background = uidColor(state.me.uid);
    $('#userChip').classList.add('show');
    $('#btnLogin').classList.add('hidden');
    $('#btnSettings').classList.remove('hidden');
    closeModal('modalAuth');
    net.disconnect();
    await net.connect(async () => `dev:${name}`, name);
  };
  console.info('%cDev: ghDev("Jmeno") tě přihlásí bez Firebase účtu.', 'color:#7c6ff7;font-weight:700');
}

bind();
renderThemes();
renderGames();          // ať jsou "brzy" karty vidět i před připojením
show('login');
$('#nickStart').value = Identity.nick;

// Host se po refreshi přihlásí sám. Bez toho by returner systém
// nefungoval – server by nevěděl, že ses vrátil ty.
if (Identity.mode === 'guest') startGuest(Identity.nick);
