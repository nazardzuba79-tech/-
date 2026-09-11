import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { BybitMarketDataService, type BybitCategory } from './BybitMarketDataService';
import { MarketUniverse } from './MarketUniverse';
import { BybitTickerBook, categoryOf, instrumentKey } from './BybitTickerBook';
import { LiveFeed, reconnectDelay } from '../live/contract';

export interface SubscriptionPlan { category: BybitCategory; topics: string[]; requests: string[][] }
/** Measure encoded arrays, including quotes/separators, not symbol counts.
 * First-fit decreasing packs long unusual symbols without wasting sockets. */
export function planSubscriptions(category: BybitCategory, symbols: string[], maxChars = 21_000): SubscriptionPlan[] {
  const topics = [...new Set(symbols)].map(s => `tickers.${s}`).sort((a,b) => b.length - a.length || a.localeCompare(b));
  const bins: string[][] = [];
  for (const topic of topics) {
    if (JSON.stringify([topic]).length > maxChars) throw new Error('Subscription topic exceeds connection limit');
    let bin = bins.find(b => JSON.stringify([...b, topic]).length <= maxChars);
    if (!bin) { bin = []; bins.push(bin); }
    bin.push(topic);
  }
  return bins.map(topics => ({ category, topics, requests: category === 'spot'
    ? Array.from({ length: Math.ceil(topics.length / 10) }, (_, i) => topics.slice(i * 10, i * 10 + 10)) : [topics] }));
}
interface Connection {
  plan: SubscriptionPlan; ws: WebSocket | null; timer: NodeJS.Timeout | null;
  heartbeat: NodeJS.Timeout | null; attempt: number; stopped: boolean;
  state: 'connecting' | 'live' | 'backoff'; pending: Set<string>; pongAt: number;
  openedAt: number; topicSet: Set<string>;
}
export interface CollectorOptions {
  spotUrl?: string; linearUrl?: string; batchMs?: number; staleMs?: number;
  now?: () => number; random?: () => number;
  socket?: (url: string) => WebSocket;
}

export class BybitLiveTickerCollector {
  readonly book: BybitTickerBook;
  readonly feed: LiveFeed;
  readonly universe: MarketUniverse;
  readonly counters = { messages: 0, batches: 0, changedRows: 0, connectionsOpened: 0, subscriptions: 0, reconnects: 0, malformed: 0 };
  private connections: Connection[] = [];
  private running = false;
  private generation = 0;
  private bootstrapTimer: NodeJS.Timeout | null = null;
  private batchTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private spotTimer: NodeJS.Timeout | null = null;
  private spotRefreshing = false;
  private refreshing = false;
  private now: () => number;
  constructor(readonly rest: BybitMarketDataService, private options: CollectorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.book = new BybitTickerBook(this.now);
    this.feed = new LiveFeed(randomUUID(), this.now);
    this.universe = new MarketUniverse(rest);
  }
  start(): void {
    if (this.running) return;
    this.running = true; this.generation++;
    this.batchTimer = setInterval(() => this.flush(), Math.max(200, Math.min(500, this.options.batchMs ?? 250)));
    void this.bootstrap(0);
  }
  private async bootstrap(attempt: number): Promise<void> {
    const generation = this.generation;
    try {
      const result = await this.universe.refresh();
      if (!result.ok || !this.universe.snapshot().instruments.length) throw new Error('Universe unavailable');
      const [spot, linear] = await Promise.all([this.rest.getTickers('spot'), this.rest.getTickers('linear')]);
      if (!this.running || generation !== this.generation) return;
      this.book.setUniverse(this.universe.snapshot().instruments);
      this.book.bootstrap('spot', spot); this.book.bootstrap('linear', linear);
      this.feed.publish('snapshot', [...this.book.rows.values()]); this.book.drain();
      for (const category of ['spot','linear'] as const) {
        for (const plan of planSubscriptions(category, [...this.book.instruments.values()].filter(i => categoryOf(i) === category).map(i => i.providerSymbol))) {
          const connection: Connection = { plan, ws: null, timer: null, heartbeat: null, attempt: 0, stopped: false, state: 'connecting', pending: new Set(), pongAt: 0, openedAt: 0, topicSet: new Set(plan.topics) };
          this.connections.push(connection); void this.connect(connection, false);
        }
      }
      this.refreshTimer = setInterval(() => void this.refreshUniverse(), 60_000);
      // Spot ticker WS does not supply bid/ask. One category snapshot keeps
      // these real quotes current without a per-symbol orderbook fan-out.
      this.spotTimer = setInterval(() => void this.refreshSpot(), 5_000);
    } catch {
      if (!this.running || generation !== this.generation) return;
      this.feed.status = 'stale'; this.feed.publish('state');
      this.bootstrapTimer = setTimeout(() => { this.bootstrapTimer = null; void this.bootstrap(attempt + 1); }, reconnectDelay(attempt, this.options.random));
    }
  }
  private async refreshUniverse(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    const generation = this.generation;
    try {
      const before = [...this.book.instruments.keys()].sort().join('|');
      const result = await this.universe.refresh();
      if (!this.running || generation !== this.generation) return;
      if (!result.ok || result.stale) { this.book.stale(new Set(this.book.rows.keys())); return; }
      const after = this.universe.snapshot().instruments.filter(i => i.status === 'Trading').map(i => `${categoryOf(i)}:${i.providerSymbol}`).sort().join('|');
      if (before !== after) {
        // Listings are rare. Rebuild only on an actual universe change;
        // stop old sessions before creating new ones, with one bootstrap.
        this.stop(); this.start();
      }
    } finally { this.refreshing = false; }
  }
  private async refreshSpot(): Promise<void> {
    if (this.spotRefreshing) return;
    this.spotRefreshing = true; const generation = this.generation;
    try {
      const snapshot = await this.rest.getTickers('spot');
      if (this.running && generation === this.generation) this.book.bootstrap('spot', snapshot);
    } catch {
      if (this.running && generation === this.generation) this.book.stale(new Set([...this.book.rows.values()].filter(row => row.marketType === 'spot').map(row => row.id)));
    } finally { this.spotRefreshing = false; }
  }
  private async connect(c: Connection, resnapshot: boolean): Promise<void> {
    const generation = this.generation;
    c.state = 'connecting';
    try {
      if (resnapshot) {
        const data = await this.rest.getTickers(c.plan.category);
        if (c.stopped || generation !== this.generation) return;
        this.book.bootstrap(c.plan.category, data);
      }
      if (c.stopped || !this.running || generation !== this.generation) return;
      const url = c.plan.category === 'spot' ? this.options.spotUrl ?? 'wss://stream.bybit.com/v5/public/spot' : this.options.linearUrl ?? 'wss://stream.bybit.com/v5/public/linear';
      const ws = this.options.socket?.(url) ?? new WebSocket(url, { handshakeTimeout: 10_000, maxPayload: 1_048_576 });
      c.ws = ws; this.counters.connectionsOpened++;
      const fail = () => this.disconnected(c, ws);
      ws.on('error', fail); ws.on('close', fail);
      ws.on('open', () => {
        if (c.stopped || c.ws !== ws) return;
        c.pongAt = this.now(); c.openedAt = this.now(); c.pending.clear();
        c.plan.requests.forEach((args, index) => {
          const req_id = String(index); c.pending.add(req_id);
          ws.send(JSON.stringify({ op: 'subscribe', req_id, args })); this.counters.subscriptions++;
        });
        c.heartbeat = setInterval(() => {
          if (this.now() - c.pongAt > 40_000 || c.pending.size > 0) { fail(); return; }
          if (this.now() - c.openedAt >= 60_000) c.attempt = 0;
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
        }, 20_000);
      });
      ws.on('message', data => {
        if (c.stopped || c.ws !== ws) return;
        this.counters.messages++;
        try {
          const m = JSON.parse(data.toString());
          if (m.op === 'pong' || m.ret_msg === 'pong') { c.pongAt = this.now(); return; }
          if (m.op === 'subscribe') {
            if (m.success !== true) { fail(); return; }
            c.pending.delete(String(m.req_id));
            if (!c.pending.size) c.state = 'live';
            return;
          }
          if (typeof m.topic === 'string' && c.topicSet.has(m.topic)) this.book.apply(c.plan.category, m);
        } catch { this.counters.malformed++; }
      });
    } catch {
      this.disconnected(c, c.ws);
    }
  }
  private disconnected(c: Connection, ws: WebSocket | null): void {
    if (c.stopped || !this.running || c.ws !== ws || c.timer) return;
    c.ws = null; c.state = 'backoff'; c.pending.clear();
    if (c.heartbeat) clearInterval(c.heartbeat); c.heartbeat = null;
    ws?.terminate();
    const topics = new Set(c.plan.topics);
    const ids = new Set([...this.book.instruments.values()].filter(i => categoryOf(i) === c.plan.category && topics.has(`tickers.${i.providerSymbol}`)).map(instrumentKey));
    this.book.stale(ids); this.flush(); this.counters.reconnects++;
    c.timer = setTimeout(() => { c.timer = null; void this.connect(c, true); }, reconnectDelay(c.attempt++, this.options.random));
  }
  flush(): void {
    this.book.stale(undefined, this.options.staleMs ?? 30_000);
    const status = this.connections.length && this.connections.every(c => c.state === 'live') ? 'live' : 'stale';
    const changed = status !== this.feed.status; this.feed.status = status;
    const rows = this.book.drain();
    if (rows.length) { this.feed.publish('delta', rows); this.counters.batches++; this.counters.changedRows += rows.length; }
    else if (changed) this.feed.publish('state');
  }
  diagnostics() {
    return { ...this.counters, activeInstruments: this.book.instruments.size, tickerCount: this.book.rows.size,
      activeAssets: new Set([...this.book.instruments.values()].map(i => i.baseAsset)).size,
      restRequests: this.rest.upstreamRequestCount, status: this.feed.status,
      connections: this.connections.map(c => ({ category: c.plan.category, topics: c.plan.topics.length, argsChars: JSON.stringify(c.plan.topics).length, state: c.state })),
      rejectedUpdates: this.book.rejected, rejectedTimestamp: this.book.rejectedTimestamp, rejectedSequence: this.book.rejectedSequence,
      serializedBookBytes: Buffer.byteLength(JSON.stringify([...this.book.rows.values()])), providerHealth: this.rest.healthSnapshot };
  }
  stop(): void {
    this.running = false; this.generation++;
    for (const timer of [this.batchTimer, this.refreshTimer, this.bootstrapTimer, this.spotTimer]) if (timer) clearInterval(timer);
    this.batchTimer = this.refreshTimer = this.bootstrapTimer = this.spotTimer = null;
    for (const c of this.connections) { c.stopped = true; if (c.timer) clearTimeout(c.timer); if (c.heartbeat) clearInterval(c.heartbeat); c.ws?.terminate(); }
    this.connections = []; this.book.stale(new Set(this.book.rows.keys())); this.flush();
  }
}
