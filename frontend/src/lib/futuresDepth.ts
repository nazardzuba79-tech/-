/** Public linear-perpetual depth, for presentation only. No account or order API.
 * Protocol: https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook
 */
export interface FuturesDepthLevel { price: string; quantity: string }

/**
 * What the terminal is allowed to believe about the book right now.
 *
 *  - `connecting` — nothing has arrived yet. There is no book, and the panel
 *    must not draw one.
 *  - `live` — the levels are the venue's current book.
 *  - `stale` — these levels were the venue's book, and nothing has updated
 *    them for a while. They are still shown, because a book that was true
 *    twelve seconds ago is worth more than an empty panel during a
 *    reconnect, but they are labelled.
 *  - `unavailable` — too old to stand behind. The levels are dropped rather
 *    than aged further: an empty array here means "we do not know", and the
 *    panel says so instead of drawing zero depth.
 */
export type FuturesDepthStatus = 'connecting' | 'live' | 'stale' | 'unavailable';

export interface FuturesDepthSnapshot {
  bids: FuturesDepthLevel[];
  asks: FuturesDepthLevel[];
  status: FuturesDepthStatus;
  /** LOCAL arrival time of the newest accepted frame — see `apply`. */
  asOf: number | null;
  source: 'socket' | 'rest' | null;
}

export interface FuturesTrade { id:string; price:string; quantity:string; time:number; side:'BUY'|'SELL' }

export function parseFuturesTrades(frame:any,symbol:string,now:number):FuturesTrade[] {
  if(frame?.topic!==`publicTrade.${symbol}`)return [];
  if(!Array.isArray(frame.data)||frame.data.length>1024)return [];
  return frame.data.filter((r:any)=>r?.s===symbol&&typeof r.i==='string'&&r.i.length>0&&['Buy','Sell'].includes(r.S)&&
    Number.isFinite(r.T)&&
    [r.p,r.v].every(v=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v))&&Number(v)>0))
    .map((r:any)=>({id:r.i,price:r.p,quantity:r.v,time:r.T,side:r.S==='Buy'?'BUY':'SELL'}));
}

const DEPTH = 200;
/** No accepted frame for this long and the book is labelled, not cleared. */
const STALE_AFTER_MS = 12_000;
/** ...and at this point it is dropped, because it is no longer a price. */
const UNAVAILABLE_AFTER_MS = 60_000;
const FLUSH_MS = 300;
const PING_MS = 20_000;
const IDLE_CLOSE_MS = 750;
/**
 * How long a socket WE HAVE JUST OPENED is given to produce its first frame
 * before the heartbeat is allowed to call it dead.
 *
 * Without this the heartbeat judged the connection purely on how long it had
 * been since the last accepted frame. Once a book had been silent for
 * `STALE_AFTER_MS` that condition stayed true no matter how young the socket
 * was, so the one-second tick tore down every reconnect attempt one second
 * after it opened — before a handshake, a subscribe and a first
 * `orderbook.200` snapshot could complete. Measured on the fake-timer
 * harness: eight sockets opened in eighty seconds, every one of them closed,
 * each alive for a single tick. A visitor whose round trip to the venue
 * takes longer than a second therefore never reconnected at all, and
 * "Данные не обновляются — переподключение" was permanent rather than
 * momentary — the label was accurate, and the reconnect it promised was the
 * thing being prevented.
 *
 * A socket is now judged on its OWN age. Six seconds is the same allowance
 * `FALLBACK_AFTER_MS` gives a healthy connection, and the backend fallback
 * is already polling throughout, so nothing waits on this.
 */
const SOCKET_GRACE_MS = 6_000;
/** Give the socket this long to produce a first frame before ALSO asking
 *  our own backend. Long enough that a healthy connection never triggers it. */
const FALLBACK_AFTER_MS = 6_000;
const FALLBACK_POLL_MS = 1_000;
const WS_URL = 'wss://stream.bybit.com/v5/public/linear';

/**
 * Two kinds of bad news, deliberately separated.
 *
 * The old transport had one: any complaint from the book tore down the
 * socket and emptied every panel. That made a single malformed level — or a
 * book that momentarily crossed — indistinguishable from the venue going
 * away, and it is most of why this panel went blank in production.
 */
/** This frame is unusable. Drop the frame; the book is still good. */
export class DepthFrameError extends Error {}
/** Our copy of the book is no longer trustworthy. Ask for a new snapshot. */
export class DepthDesyncError extends Error {}

export class FuturesDepthBook {
  private bids = new Map<string,string>();
  private asks = new Map<string,string>();
  private update = 0;
  private sequence = 0;
  private initialized = false;
  constructor(readonly symbol: string) {}

  get ready(): boolean { return this.initialized; }

  /**
   * Applies one frame, atomically.
   *
   * `now` is used ONLY to stamp arrival. It is deliberately never compared
   * against `frame.ts`.
   *
   * That comparison is what used to empty this book. `frame.ts` is the
   * VENUE's clock; `Date.now()` in a browser is the VISITOR's, and the two
   * are routinely seconds apart — a laptop resuming from sleep, a machine
   * with no time sync, a phone that has just changed network. The previous
   * implementation rejected any frame stamped more than one second ahead of
   * the local clock, so a visitor whose clock ran a second slow had every
   * single frame throw, every throw tore down the socket, and the fresh
   * snapshot that followed was rejected the same way. A permanently empty
   * book and an endless reconnect, on a machine whose only fault was a
   * wrong clock.
   *
   * Ordering does not need a clock. `u` and `seq` are the venue's own
   * monotonic counters and are checked below; freshness is measured by how
   * long it has been since WE last accepted something, which compares the
   * local clock only against itself.
   */
  apply(frame: any, now: number): boolean {
    if (frame?.topic !== `orderbook.${DEPTH}.${this.symbol}`) return false;
    const d = frame.data;
    if (!d || d.s !== this.symbol || !['snapshot','delta'].includes(frame.type) ||
        !Number.isSafeInteger(d.u) || d.u < 1 || !Number.isSafeInteger(d.seq) || d.seq < 0) {
      throw new DepthFrameError('Invalid depth frame');
    }
    const reset = frame.type === 'snapshot' || d.u === 1;
    if (!reset && !this.initialized) throw new DepthDesyncError('Snapshot required');
    // Update IDs are monotonic, not necessarily contiguous across messages.
    if (!reset && d.u <= this.update) return false;
    if (!reset && d.seq < this.sequence) throw new DepthDesyncError('Depth sequence rollback');
    const bids = reset ? new Map<string,string>() : new Map(this.bids);
    const asks = reset ? new Map<string,string>() : new Map(this.asks);
    for (const [levels, target] of [[d.b,bids],[d.a,asks]] as [unknown,Map<string,string>][]) {
      if (!Array.isArray(levels) || levels.length > 1000) throw new DepthFrameError('Invalid depth levels');
      for (const level of levels) {
        if (!Array.isArray(level) || level.length !== 2 ||
            level.some(v => typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v)) ||
            !Number.isFinite(Number(level[0])) || Number(level[0]) <= 0 || !Number.isFinite(Number(level[1]))) throw new DepthFrameError('Invalid depth level');
        const price = String(Number(level[0]));
        if (Number(level[1]) === 0) target.delete(price); else target.set(price,level[1]);
      }
      if (target.size > 1000) throw new DepthFrameError('Depth bound exceeded');
    }
    // Within one Bybit frame both sides describe the same book state, so a
    // cross AFTER applying a whole frame is real desync, not a transient —
    // but it is desync, not a transport fault. Ask for a new snapshot and
    // keep showing the last good book meanwhile.
    if (bids.size && asks.size) {
      let bestBid = -Infinity, bestAsk = Infinity;
      for (const price of bids.keys()) { const p = Number(price); if (p > bestBid) bestBid = p; }
      for (const price of asks.keys()) { const p = Number(price); if (p < bestAsk) bestAsk = p; }
      if (bestBid >= bestAsk) throw new DepthDesyncError('Crossed depth');
    }
    this.bids=bids; this.asks=asks; this.update=d.u; this.sequence=d.seq; this.initialized=true;
    return true;
  }

  /** Replace the whole book from a REST snapshot (the fallback path). */
  replace(bids: FuturesDepthLevel[], asks: FuturesDepthLevel[], updateId: number) {
    this.bids = new Map(bids.map(l => [String(Number(l.price)), l.quantity]));
    this.asks = new Map(asks.map(l => [String(Number(l.price)), l.quantity]));
    this.update = updateId; this.sequence = 0; this.initialized = true;
  }

  levels(): { bids: FuturesDepthLevel[]; asks: FuturesDepthLevel[] } {
    const sorted = (levels: Map<string,string>, direction: number) => [...levels].sort((a,b)=>(Number(a[0])-Number(b[0]))*direction)
      .slice(0,DEPTH).map(([price,quantity])=>({price,quantity}));
    return { bids:sorted(this.bids,-1), asks:sorted(this.asks,1) };
  }
}

type DepthListener = (book: FuturesDepthSnapshot) => void;

interface ActiveDepth {
  book: FuturesDepthBook;
  listeners: Set<DepthListener>;
  tradeListeners: Set<(trades:FuturesTrade[])=>void>;
  pendingTrades: FuturesTrade[];
  tradeFlush: ReturnType<typeof setTimeout> | null;
  /** LOCAL time we last accepted depth, from either source. */
  lastAccepted: number | null;
  /**
   * The last levels we were willing to stand behind, held separately from
   * the book that deltas accumulate into.
   *
   * They are two different things. Recovering from a desync means throwing
   * away our delta state and asking for a new snapshot — but it does NOT
   * mean the trader should watch the panel empty while that round trip
   * happens. The accumulator is reset; this is what stays on screen.
   */
  lastGood: { bids: FuturesDepthLevel[]; asks: FuturesDepthLevel[] } | null;
  source: 'socket' | 'rest' | null;
  status: FuturesDepthStatus;
  flush: ReturnType<typeof setTimeout> | null;
  /** When this contract was first asked for, so the fallback can start. */
  subscribedAt: number;
  poll: ReturnType<typeof setTimeout> | null;
  polling: boolean;
}

/** `/api/v1` unless the app is served from a different origin than its API.
 *  Set explicitly rather than read from `import.meta`, which this module
 *  must stay free of so it can be tested outside the bundler. */
let fallbackBase = '/api/v1';
export function setFuturesDepthFallbackBase(base: string) { fallbackBase = base; }

/**
 * One shared Bybit linear socket for the Futures tab, with our own backend
 * as a strictly secondary source.
 *
 * Switching contracts unsubscribes/subscribes topics on the existing
 * connection rather than opening a new WebSocket per click. Two rules do
 * most of the reliability work:
 *
 *  1. A good book is never thrown away to show an empty one. Not on
 *     reconnect, not on a re-subscribe, not when the tab goes to the
 *     background. It is labelled `stale` and kept until it is genuinely too
 *     old to mean anything, and only then dropped — as unknown, not as zero.
 *  2. Failure is graded. A bad frame drops that frame; a desync asks for a
 *     new snapshot; only the transport actually dying reconnects the
 *     transport.
 */
class FuturesDepthTransport {
  private socket: WebSocket | null = null;
  private subscriptions = new Map<string, ActiveDepth>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1000;
  private lastPing = 0;
  /** When the CURRENT socket was created — see `SOCKET_GRACE_MS`. */
  private socketStartedAt = 0;
  private visibilityAttached = false;

  subscribe(pair: string, listener: DepthListener, onTrades?:(trades:FuturesTrade[])=>void): () => void {
    if (!/^[A-Z0-9]{1,32}\/USDT$/.test(pair)) {
      listener({ bids: [], asks: [], status: 'unavailable', asOf: null, source: null });
      return () => {};
    }
    const symbol = pair.replace('/','');
    this.cancelIdleClose();
    this.attachVisibility();

    let active = this.subscriptions.get(symbol);
    const isNewTopic = !active;
    if (!active) {
      active = { book: new FuturesDepthBook(symbol), listeners: new Set(), tradeListeners: new Set(), pendingTrades: [],
        tradeFlush: null, lastAccepted: null, lastGood: null, source: null, status: 'connecting', flush: null,
        subscribedAt: Date.now(), poll: null, polling: false };
      this.subscriptions.set(symbol, active);
    }
    active.listeners.add(listener);
    if(onTrades) active.tradeListeners.add(onTrades);

    // A late subscriber gets what we already know, immediately. Emitting an
    // empty book here is what made a remount — or React's own double-mount
    // in development — flash the panel blank on a perfectly live contract.
    listener(this.view(active));

    this.connect();
    if (isNewTopic) this.send('subscribe', symbol);
    this.scheduleFallback(active, symbol);

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const current = this.subscriptions.get(symbol);
      if (!current) return;
      current.listeners.delete(listener);
      if(onTrades) current.tradeListeners.delete(onTrades);
      if (current.listeners.size === 0) {
        if (current.flush !== null) clearTimeout(current.flush);
        current.flush = null;
        if(current.tradeFlush!==null)clearTimeout(current.tradeFlush);
        current.tradeFlush=null;current.pendingTrades=[];
        this.stopFallback(current);
        this.subscriptions.delete(symbol);
        this.send('unsubscribe', symbol);
      }
      if (this.subscriptions.size === 0) this.scheduleIdleClose();
    };
  }

  /** The book as the terminal should currently understand it. */
  private view(active: ActiveDepth): FuturesDepthSnapshot {
    const meta = { status: active.status, asOf: active.lastAccepted, source: active.source };
    // `unavailable` is the one state that shows nothing, and it shows
    // nothing on purpose: those levels have been declared too old to be a
    // price, and an empty array here reads as "unknown", never as "zero".
    if (active.status === 'unavailable') return { bids: [], asks: [], ...meta };
    if (active.book.ready) return { ...active.book.levels(), ...meta };
    if (active.lastGood) return { bids: active.lastGood.bids, asks: active.lastGood.asks, ...meta };
    return { bids: [], asks: [], ...meta };
  }

  private emit(symbol: string, active: ActiveDepth) {
    if (this.subscriptions.get(symbol) !== active) return;
    const snapshot = this.view(active);
    for (const subscriber of active.listeners) subscriber(snapshot);
  }

  /** Coalesce bursts of deltas into one repaint, as before. */
  private scheduleEmit(symbol: string, active: ActiveDepth) {
    if (active.flush !== null) return;
    active.flush = setTimeout(() => {
      active.flush = null;
      this.emit(symbol, active);
    }, FLUSH_MS);
  }

  private accepted(symbol: string, active: ActiveDepth, source: 'socket' | 'rest') {
    active.lastAccepted = Date.now();
    active.lastGood = active.book.levels();
    active.source = source;
    active.status = 'live';
    if (source === 'socket') this.stopFallback(active);
    this.scheduleEmit(symbol, active);
  }

  // ---- fallback: our own backend, only while the socket has nothing ----

  private scheduleFallback(active: ActiveDepth, symbol: string) {
    if (active.polling || active.poll !== null || typeof fetch !== 'function') return;
    const wait = Math.max(0, active.subscribedAt + FALLBACK_AFTER_MS - Date.now());
    active.poll = setTimeout(() => { active.poll = null; void this.pollOnce(symbol, active); }, wait);
  }

  private stopFallback(active: ActiveDepth) {
    if (active.poll !== null) clearTimeout(active.poll);
    active.poll = null;
    active.polling = false;
  }

  /**
   * One request, then decide whether another is warranted.
   *
   * A fixed interval would keep firing while a request was still in flight,
   * and would keep firing after the socket recovered. This chains instead:
   * at most one request per contract is ever outstanding, the chain stops
   * the moment a socket frame lands, and it never starts while the tab is
   * hidden or nobody is subscribed.
   */
  private async pollOnce(symbol: string, active: ActiveDepth) {
    if (this.subscriptions.get(symbol) !== active) return;
    if (active.source === 'socket' && active.status === 'live') return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (active.listeners.size === 0) return;
    active.polling = true;
    try {
      const response = await fetch(`${fallbackBase}/market/futures/orderbook/${symbol}`, { headers: { Accept: 'application/json' } });
      if (this.subscriptions.get(symbol) !== active) return;
      const body = response.ok ? await response.json() : null;
      // An unavailable venue is not an empty book: nothing is applied, the
      // last good levels stay, and the staleness clock keeps running.
      if (body && body.available === true && Array.isArray(body.bids) && Array.isArray(body.asks) &&
          Number.isSafeInteger(body.updateId) && (body.bids.length > 0 || body.asks.length > 0)) {
        active.book.replace(body.bids, body.asks, body.updateId);
        this.accepted(symbol, active, 'rest');
      }
    } catch {
      // Network failure. Same rule: change nothing about the book.
    } finally {
      active.polling = false;
      if (this.subscriptions.get(symbol) === active && !(active.source === 'socket' && active.status === 'live')) {
        if (active.poll !== null) clearTimeout(active.poll);
        active.poll = setTimeout(() => { active.poll = null; void this.pollOnce(symbol, active); }, FALLBACK_POLL_MS);
      }
    }
  }

  private attachVisibility() {
    if (this.visibilityAttached || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityAttached = true;
  }

  private detachVisibility() {
    if (!this.visibilityAttached || typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityAttached = false;
  }

  private onVisibilityChange = () => {
    this.cancelReconnect();
    if (document.hidden) {
      // Stop spending the visitor's battery and the venue's connection —
      // but keep the book. Coming back to a labelled book that is seconds
      // old beats coming back to an empty panel.
      this.markStale();
      for (const active of this.subscriptions.values()) this.stopFallback(active);
      this.clearSocket();
      return;
    }
    this.reconnectDelay = 1000;
    this.connect();
    for (const [symbol, active] of this.subscriptions) {
      active.subscribedAt = Date.now();
      this.scheduleFallback(active, symbol);
    }
  };

  private connect() {
    if (this.subscriptions.size === 0 || (typeof document !== 'undefined' && document.hidden) || this.socket || this.reconnectTimer !== null) return;
    try {
      const ws = new WebSocket(WS_URL);
      this.socket = ws;
      this.socketStartedAt = Date.now();
      this.lastPing = Date.now();
      this.startHeartbeat();
      ws.onopen = () => {
        if (this.socket !== ws) return;
        this.reconnectDelay = 1000;
        this.lastPing = Date.now();
        for (const symbol of this.subscriptions.keys()) this.send('subscribe', symbol);
      };
      ws.onmessage = event => {
        if (this.socket !== ws) return;
        let frame: any;
        try { frame = JSON.parse(event.data); } catch { this.reconnect(); return; }
        if (frame?.success === false) { this.reconnect(); return; }
        if(typeof frame?.topic==='string'&&frame.topic.startsWith('publicTrade.')) {
          const symbol=frame.topic.slice('publicTrade.'.length);
          const active=this.subscriptions.get(symbol);
          if(!active||!active.tradeListeners.size)return;
          active.pendingTrades=[...parseFuturesTrades(frame,symbol,Date.now()),...active.pendingTrades].sort((a,b)=>b.time-a.time).slice(0,40);
          if(active.pendingTrades.length&&active.tradeFlush===null)active.tradeFlush=setTimeout(()=>{
            active.tradeFlush=null;
            if(this.socket!==ws||this.subscriptions.get(symbol)!==active)return;
            const trades=active.pendingTrades;active.pendingTrades=[];
            for(const subscriber of active.tradeListeners)subscriber(trades);
          },FLUSH_MS);
          return;
        }
        const prefix = `orderbook.${DEPTH}.`;
        if (typeof frame?.topic !== 'string' || !frame.topic.startsWith(prefix)) return;
        const symbol = frame.topic.slice(prefix.length);
        const active = this.subscriptions.get(symbol);
        if (!active) return;
        try {
          if (!active.book.apply(frame, Date.now())) return;
        } catch (error) {
          if (error instanceof DepthDesyncError) {
            // Our copy is wrong; the connection is fine. Ask this ONE topic
            // for a fresh snapshot and keep showing the last good book.
            // Reset the accumulator only. `lastGood` is untouched, so the
            // panel keeps the book it had while the new snapshot is in
            // flight — labelled, because it is no longer being updated.
            active.book = new FuturesDepthBook(symbol);
            active.status = active.lastGood === null ? 'connecting' : 'stale';
            this.send('unsubscribe', symbol);
            this.send('subscribe', symbol);
            this.scheduleEmit(symbol, active);
            return;
          }
          // A frame we cannot read is a frame we skip. It says nothing about
          // the socket, and tearing the socket down for it is what used to
          // empty every panel on the page.
          return;
        }
        this.reconnectDelay = 1000;
        this.accepted(symbol, active, 'socket');
      };
      ws.onerror = ws.onclose = () => { if (this.socket === ws) this.reconnect(); };
    } catch {
      this.reconnect();
    }
  }

  private send(op: 'subscribe' | 'unsubscribe', symbol: string) {
    const ws = this.socket;
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({ op, args: [`orderbook.${DEPTH}.${symbol}`, `publicTrade.${symbol}`] }));
    } catch {
      this.reconnect();
    }
  }

  private startHeartbeat() {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (this.subscriptions.size === 0) return;
      const now = Date.now();
      let silent = false;
      for (const [symbol, active] of this.subscriptions) {
        const since = now - (active.lastAccepted ?? active.subscribedAt);
        if (active.lastAccepted !== null && since > UNAVAILABLE_AFTER_MS) {
          // Past this point the levels are not a price any more. Drop them
          // and say so. `unavailable` renders as "no data", never as zero.
          if (active.status !== 'unavailable') {
            active.status = 'unavailable';
            active.book = new FuturesDepthBook(symbol);
            active.lastGood = null;
            this.emit(symbol, active);
          }
        } else if (active.lastAccepted !== null && since > STALE_AFTER_MS && active.status === 'live') {
          active.status = 'stale';
          this.emit(symbol, active);
        }
        if (since > STALE_AFTER_MS) { silent = true; this.scheduleFallback(active, symbol); }
      }
      // A socket that has gone quiet across EVERY contract is a dead socket,
      // not a quiet market. Reconnect it — without emptying anything.
      //
      // ...but only once it has HAD its chance. A socket opened a moment ago
      // has not gone quiet, it has not finished connecting, and the book
      // being stale says nothing about it: the staleness clock runs from the
      // last accepted frame, which by definition predates every reconnect
      // attempt. Judging the socket by that clock meant this tick fired one
      // second after each new socket opened and closed it mid-handshake,
      // forever. See SOCKET_GRACE_MS.
      if (silent && now - this.socketStartedAt > SOCKET_GRACE_MS &&
          [...this.subscriptions.values()].every(a => now - (a.lastAccepted ?? a.subscribedAt) > STALE_AFTER_MS)) {
        this.reconnect();
        return;
      }
      const ws = this.socket;
      if (ws?.readyState === 1 && now - this.lastPing >= PING_MS) {
        try { ws.send(JSON.stringify({ op: 'ping' })); this.lastPing = now; }
        catch { this.reconnect(); }
      }
    }, 1000);
  }

  /** Label every book as no-longer-updating. Deliberately keeps the levels. */
  private markStale() {
    for (const [symbol, active] of this.subscriptions) {
      if (active.flush !== null) clearTimeout(active.flush);
      active.flush = null;
      if(active.tradeFlush!==null)clearTimeout(active.tradeFlush);
      active.tradeFlush=null;active.pendingTrades=[];
      if (active.status === 'live') {
        active.status = 'stale';
        this.emit(symbol, active);
      }
    }
  }

  private reconnect() {
    this.clearSocket();
    this.markStale();
    if (this.subscriptions.size === 0 || (typeof document !== 'undefined' && document.hidden) || this.reconnectTimer !== null) return;
    // While the socket is down, our own backend is the second source. It
    // stops again the instant a socket frame lands.
    for (const [symbol, active] of this.subscriptions) this.scheduleFallback(active, symbol);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearSocket() {
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null;
      try { ws.close(); } catch {}
    }
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private cancelReconnect() {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private cancelIdleClose() {
    if (this.idleCloseTimer !== null) clearTimeout(this.idleCloseTimer);
    this.idleCloseTimer = null;
  }

  private scheduleIdleClose() {
    this.cancelIdleClose();
    this.idleCloseTimer = setTimeout(() => {
      this.idleCloseTimer = null;
      if (this.subscriptions.size !== 0) return;
      this.cancelReconnect();
      this.clearSocket();
      this.reconnectDelay = 1000;
      this.detachVisibility();
    }, IDLE_CLOSE_MS);
  }

  /** Tear everything down now: drop the socket, the timers, the books and
   *  the visibility hook. The idle path reaches the same state 750ms after
   *  the last unsubscribe; this is that state on demand, for a caller that
   *  knows the terminal is finished with depth. */
  close() {
    this.cancelIdleClose();
    this.cancelReconnect();
    for (const active of this.subscriptions.values()) {
      if (active.flush !== null) clearTimeout(active.flush);
      if (active.tradeFlush !== null) clearTimeout(active.tradeFlush);
      this.stopFallback(active);
    }
    this.subscriptions.clear();
    this.clearSocket();
    this.reconnectDelay = 1000;
    this.detachVisibility();
  }
}

const transport = new FuturesDepthTransport();

/** Release the shared depth transport — see `FuturesDepthTransport.close`. */
export function closeFuturesDepth() { transport.close(); }

export function subscribeFuturesDepth(pair: string, listener: (book:FuturesDepthSnapshot)=>void, onTrades?:(trades:FuturesTrade[])=>void): () => void {
  return transport.subscribe(pair, listener, onTrades);
}
