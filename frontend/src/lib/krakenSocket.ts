// Live order book + trade tape straight from Kraken's public WebSocket
// (wss://ws.kraken.com/v2) — this is what makes the book/trades feel like
// a real, moving market instead of the old 2s REST poll. Runs entirely in
// the visitor's browser (same reasoning as the TradingView chart): no
// dependency on our own backend, so it's unaffected by any restriction on
// server-side outbound requests.
//
// A single shared connection is reused for every subscriber (order book +
// trade tape can both be live for the same pair at once) rather than one
// socket per component.

export interface BookLevel {
  price: string;
  quantity: string;
}

export interface BookSnapshot {
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface LiveTrade {
  id: string;
  price: string;
  quantity: string;
  side: 'BUY' | 'SELL';
  time: number;
}

type BookListener = (snapshot: BookSnapshot) => void;
type TradeListener = (trade: LiveTrade) => void;
export type SocketStatus = 'connecting' | 'connected' | 'disconnected';
type StatusListener = (status: SocketStatus) => void;

interface BookState {
  bids: Map<string, string>;
  asks: Map<string, string>;
}

const WS_URL = 'wss://ws.kraken.com/v2';
const MAX_RECONNECT_DELAY_MS = 15_000;

class KrakenSocket {
  private ws: WebSocket | null = null;
  private connecting = false;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;

  private bookState = new Map<string, BookState>();
  private bookListeners = new Map<string, Set<BookListener>>();
  private tradeListeners = new Map<string, Set<TradeListener>>();

  // Real connection state, not a guess — flips on the socket's own
  // open/close events so UI can honestly show "reconnecting" instead of
  // silently sitting on stale data during an outage.
  private status: SocketStatus = 'disconnected';
  private statusListeners = new Set<StatusListener>();

  getStatus(): SocketStatus {
    return this.status;
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(status: SocketStatus) {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  subscribeBook(pair: string, listener: BookListener): () => void {
    this.ensureConnected();
    const isNewSubscription = !this.bookListeners.has(pair);
    if (isNewSubscription) this.bookListeners.set(pair, new Set());
    this.bookListeners.get(pair)!.add(listener);
    if (isNewSubscription) this.send({ method: 'subscribe', params: { channel: 'book', symbol: [pair], depth: 25 } });

    return () => {
      const set = this.bookListeners.get(pair);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) {
        this.bookListeners.delete(pair);
        this.bookState.delete(pair);
        this.send({ method: 'unsubscribe', params: { channel: 'book', symbol: [pair] } });
      }
    };
  }

  subscribeTrades(pair: string, listener: TradeListener): () => void {
    this.ensureConnected();
    const isNewSubscription = !this.tradeListeners.has(pair);
    if (isNewSubscription) this.tradeListeners.set(pair, new Set());
    this.tradeListeners.get(pair)!.add(listener);
    if (isNewSubscription) this.send({ method: 'subscribe', params: { channel: 'trade', symbol: [pair] } });

    return () => {
      const set = this.tradeListeners.get(pair);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) {
        this.tradeListeners.delete(pair);
        this.send({ method: 'unsubscribe', params: { channel: 'trade', symbol: [pair] } });
      }
    };
  }

  private ensureConnected() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.connecting) return;
    this.connecting = true;
    this.setStatus('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(WS_URL);
    } catch {
      this.connecting = false;
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.connecting = false;
      this.reconnectDelay = 1000;
      this.setStatus('connected');
      for (const pair of this.bookListeners.keys()) {
        this.send({ method: 'subscribe', params: { channel: 'book', symbol: [pair], depth: 25 } });
      }
      for (const pair of this.tradeListeners.keys()) {
        this.send({ method: 'subscribe', params: { channel: 'trade', symbol: [pair] } });
      }
    };
    socket.onmessage = (event) => this.handleMessage(event);
    socket.onclose = () => {
      this.ws = null;
      this.connecting = false;
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect() {
    if (this.bookListeners.size === 0 && this.tradeListeners.size === 0) return;
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private handleMessage(event: MessageEvent) {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.channel === 'book' && Array.isArray(msg.data)) {
      for (const entry of msg.data) {
        this.applyBookUpdate(entry, msg.type === 'snapshot');
      }
    } else if (msg.channel === 'trade' && Array.isArray(msg.data)) {
      for (const entry of msg.data) {
        this.emitTrade(entry);
      }
    }
  }

  private applyBookUpdate(entry: any, isSnapshot: boolean) {
    const pair = entry.symbol as string;
    let state = this.bookState.get(pair);
    if (isSnapshot || !state) {
      state = { bids: new Map(), asks: new Map() };
      this.bookState.set(pair, state);
    }

    for (const level of entry.bids ?? []) {
      if (Number(level.qty) === 0) state.bids.delete(String(level.price));
      else state.bids.set(String(level.price), String(level.qty));
    }
    for (const level of entry.asks ?? []) {
      if (Number(level.qty) === 0) state.asks.delete(String(level.price));
      else state.asks.set(String(level.price), String(level.qty));
    }

    const bids = Array.from(state.bids.entries())
      .map(([price, quantity]) => ({ price, quantity }))
      .sort((a, b) => Number(b.price) - Number(a.price))
      .slice(0, 50);
    const asks = Array.from(state.asks.entries())
      .map(([price, quantity]) => ({ price, quantity }))
      .sort((a, b) => Number(a.price) - Number(b.price))
      .slice(0, 50);

    this.bookListeners.get(pair)?.forEach((listener) => listener({ bids, asks }));
  }

  private emitTrade(entry: any) {
    const pair = entry.symbol as string;
    const trade: LiveTrade = {
      id: `${entry.trade_id ?? entry.timestamp}-${entry.price}-${entry.qty}`,
      price: String(entry.price),
      quantity: String(entry.qty),
      side: entry.side === 'buy' ? 'BUY' : 'SELL',
      time: Date.parse(entry.timestamp) || Date.now(),
    };
    this.tradeListeners.get(pair)?.forEach((listener) => listener(trade));
  }
}

export const krakenSocket = new KrakenSocket();
