/** Public linear-perpetual depth, for presentation only. No account or order API.
 * Protocol: https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook
 */
export interface FuturesDepthSnapshot { bids: {price:string;quantity:string}[]; asks: {price:string;quantity:string}[] }
export interface FuturesTrade { id:string; price:string; quantity:string; time:number; side:'BUY'|'SELL' }
export function parseFuturesTrades(frame:any,symbol:string,now:number):FuturesTrade[] {
  if(frame?.topic!==`publicTrade.${symbol}`)return [];
  if(!Array.isArray(frame.data)||frame.data.length>1024)return [];
  return frame.data.filter((r:any)=>r?.s===symbol&&typeof r.i==='string'&&r.i.length>0&&['Buy','Sell'].includes(r.S)&&
    Number.isFinite(r.T)&&r.T<=now+1000&&now-r.T<=30000&&
    [r.p,r.v].every(v=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v))&&Number(v)>0))
    .map((r:any)=>({id:r.i,price:r.p,quantity:r.v,time:r.T,side:r.S==='Buy'?'BUY':'SELL'}));
}
const empty = (): FuturesDepthSnapshot => ({ bids: [], asks: [] });
const DEPTH = 200;
const MAX_AGE_MS = 30_000;
const FLUSH_MS = 300;
const PING_MS = 20_000;
const IDLE_CLOSE_MS = 750;
const WS_URL = 'wss://stream.bybit.com/v5/public/linear';

export class FuturesDepthBook {
  private bids = new Map<string,string>();
  private asks = new Map<string,string>();
  private update = 0;
  private sequence = 0;
  private initialized = false;
  constructor(readonly symbol: string) {}

  apply(frame: any, now: number): boolean {
    if (frame?.topic !== `orderbook.${DEPTH}.${this.symbol}`) return false;
    const d = frame.data;
    if (!d || d.s !== this.symbol || !['snapshot','delta'].includes(frame.type) ||
        !Number.isFinite(frame.ts) || frame.ts > now + 1000 || now - frame.ts > MAX_AGE_MS ||
        !Number.isSafeInteger(d.u) || d.u < 1 || !Number.isSafeInteger(d.seq) || d.seq < 0) throw new Error('Invalid depth frame');
    const reset = frame.type === 'snapshot' || d.u === 1;
    if (!reset && !this.initialized) throw new Error('Snapshot required');
    // Update IDs are monotonic, not necessarily contiguous across messages.
    if (!reset && d.u <= this.update) return false;
    if (!reset && d.seq < this.sequence) throw new Error('Depth sequence rollback');
    const bids = reset ? new Map<string,string>() : new Map(this.bids);
    const asks = reset ? new Map<string,string>() : new Map(this.asks);
    for (const [levels, target] of [[d.b,bids],[d.a,asks]] as [unknown,Map<string,string>][]) {
      if (!Array.isArray(levels) || levels.length > 1000) throw new Error('Invalid depth levels');
      for (const level of levels) {
        if (!Array.isArray(level) || level.length !== 2 ||
            level.some(v => typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v)) ||
            !Number.isFinite(Number(level[0])) || Number(level[0]) <= 0 || !Number.isFinite(Number(level[1]))) throw new Error('Invalid depth level');
        const price = String(Number(level[0]));
        if (Number(level[1]) === 0) target.delete(price); else target.set(price,level[1]);
      }
      if (target.size > 1000) throw new Error('Depth bound exceeded');
    }
    if (bids.size && asks.size && Math.max(...[...bids.keys()].map(Number)) >= Math.min(...[...asks.keys()].map(Number))) throw new Error('Crossed depth');
    this.bids=bids; this.asks=asks; this.update=d.u; this.sequence=d.seq; this.initialized=true;
    return true;
  }

  snapshot(): FuturesDepthSnapshot {
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
  lastFrame: number;
  flush: ReturnType<typeof setTimeout> | null;
}

/**
 * One shared Bybit linear socket for the Futures tab. Switching contracts now
 * unsubscribes/subscribes topics on the existing connection instead of closing
 * and opening a brand-new WebSocket for every click. The small idle grace keeps
 * React's cleanup -> next effect handoff on the same transport, eliminating the
 * connection churn that could leave the order book blank while Bybit throttled
 * repeated reconnects.
 */
class FuturesDepthTransport {
  private socket: WebSocket | null = null;
  private subscriptions = new Map<string, ActiveDepth>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1000;
  private lastPing = 0;
  private visibilityAttached = false;

  subscribe(pair: string, listener: DepthListener, onTrades?:(trades:FuturesTrade[])=>void): () => void {
    listener(empty());
    if (!/^[A-Z0-9]{1,32}\/USDT$/.test(pair)) return () => {};
    const symbol = pair.replace('/','');
    this.cancelIdleClose();
    this.attachVisibility();

    let active = this.subscriptions.get(symbol);
    const isNewTopic = !active;
    if (!active) {
      active = { book: new FuturesDepthBook(symbol), listeners: new Set(), tradeListeners: new Set(), pendingTrades: [], tradeFlush: null, lastFrame: Date.now(), flush: null };
      this.subscriptions.set(symbol, active);
    }
    active.listeners.add(listener);
    if(onTrades) active.tradeListeners.add(onTrades);

    this.connect();
    if (isNewTopic) this.send('subscribe', symbol);

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
        this.subscriptions.delete(symbol);
        this.send('unsubscribe', symbol);
      }
      if (this.subscriptions.size === 0) this.scheduleIdleClose();
    };
  }

  private attachVisibility() {
    if (this.visibilityAttached) return;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityAttached = true;
  }

  private detachVisibility() {
    if (!this.visibilityAttached) return;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityAttached = false;
  }

  private onVisibilityChange = () => {
    this.cancelReconnect();
    if (document.hidden) {
      this.resetBooks();
      this.clearSocket();
      return;
    }
    this.connect();
  };

  private connect() {
    if (this.subscriptions.size === 0 || document.hidden || this.socket || this.reconnectTimer !== null) return;
    try {
      const ws = new WebSocket(WS_URL);
      this.socket = ws;
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
        } catch {
          this.reconnect();
          return;
        }
        active.lastFrame = Date.now();
        this.reconnectDelay = 1000;
        if (active.flush === null) {
          active.flush = setTimeout(() => {
            active.flush = null;
            if (this.subscriptions.get(symbol) !== active) return;
            const snapshot = active.book.snapshot();
            for (const subscriber of active.listeners) subscriber(snapshot);
          }, FLUSH_MS);
        }
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
      for (const active of this.subscriptions.values()) {
        if (now - active.lastFrame > MAX_AGE_MS) { this.reconnect(); return; }
      }
      const ws = this.socket;
      if (ws?.readyState === 1 && now - this.lastPing >= PING_MS) {
        try { ws.send(JSON.stringify({ op: 'ping' })); this.lastPing = now; }
        catch { this.reconnect(); }
      }
    }, 1000);
  }

  private resetBooks() {
    const now = Date.now();
    for (const [symbol, active] of this.subscriptions) {
      if (active.flush !== null) clearTimeout(active.flush);
      active.flush = null;
      if(active.tradeFlush!==null)clearTimeout(active.tradeFlush);
      active.tradeFlush=null;active.pendingTrades=[];
      for(const subscriber of active.tradeListeners)subscriber([]);
      active.book = new FuturesDepthBook(symbol);
      active.lastFrame = now;
      for (const subscriber of active.listeners) subscriber(empty());
    }
  }

  private reconnect() {
    this.clearSocket();
    this.resetBooks();
    if (this.subscriptions.size === 0 || document.hidden || this.reconnectTimer !== null) return;
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
}

const transport = new FuturesDepthTransport();

export function subscribeFuturesDepth(pair: string, listener: (book:FuturesDepthSnapshot)=>void, onTrades?:(trades:FuturesTrade[])=>void): () => void {
  return transport.subscribe(pair, listener, onTrades);
}
