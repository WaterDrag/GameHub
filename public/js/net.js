// ─────────────────────────────────────────────────────────────
//  WebSocket klient.
//
//  Sám se připojuje zpátky (exponenciální backoff) a po každém
//  připojení pošle HELLO s čerstvým Firebase tokenem. Server pak
//  podle uid pozná, že patříš do rozehrané místnosti, a vrátí tě
//  tam – i po refreshi stránky nebo výpadku wifi.
// ─────────────────────────────────────────────────────────────

export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.ready = false;
    this.tokenProvider = null;   // async () => idToken
    this.name = null;
    this.retry = 0;
    this.latency = 0;
    this.serverSkew = 0;
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._closedByUs = false;
  }

  get url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  async connect(tokenProvider, name) {
    this.tokenProvider = tokenProvider || this.tokenProvider;
    this.name = name ?? this.name;
    this._closedByUs = false;
    clearTimeout(this._reconnectTimer);

    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;

    this.emit('status', { state: 'connecting' });
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = async () => {
      this.retry = 0;
      try {
        const token = await this.tokenProvider();
        ws.send(JSON.stringify({ t: 'hello', token, name: this.name }));
      } catch (e) {
        this.emit('status', { state: 'authfail', error: e.message });
        ws.close();
        return;
      }
      this.startPing();
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'pong') {
        this.latency = Date.now() - msg.t0;
        // odhad rozdílu hodin: server je uprostřed cesty tam a zpět
        this.serverSkew = msg.ts - (msg.t0 + this.latency / 2);
        this.emit('latency', { ms: this.latency });
        return;
      }
      if (msg.t === 'welcome') {
        this.ready = true;
        this.emit('status', { state: 'online' });
      }
      this.emit(msg.t, msg);
      this.emit('*', msg);
    };

    ws.onclose = () => {
      this.ready = false;
      this.stopPing();
      if (this._closedByUs) { this.emit('status', { state: 'offline' }); return; }
      const wait = Math.min(8000, 400 * 2 ** this.retry++);
      this.emit('status', { state: 'reconnecting', in: wait });
      this._reconnectTimer = setTimeout(() => this.connect(), wait);
    };

    ws.onerror = () => { /* onclose to dořeší */ };
  }

  disconnect() {
    this._closedByUs = true;
    this.stopPing();
    this.ws?.close();
  }

  send(t, data = {}) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify({ t, ...data }));
    return true;
  }

  startPing() {
    this.stopPing();
    const beat = () => this.send('ping', { t0: Date.now() });
    beat();
    this._pingTimer = setInterval(beat, 3000);
  }
  stopPing() { clearInterval(this._pingTimer); this._pingTimer = null; }

  // ── malý event helper ────────────────────────────────────
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) {
    const h = (e) => fn(e.detail);
    this.addEventListener(type, h);
    return () => this.removeEventListener(type, h);
  }
}

export const net = new Net();
