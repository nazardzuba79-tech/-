import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { HttpProviderClient, ProviderHealth, providerHealthRegistry } from '../ProviderHealth';
import { LiveFeed, reconnectDelay, type LiveFrame } from './contract';
import { parseLiveFrame } from './validation';

/** One connector per backend process. This object is never injected into
 * an execution service, and never calls the provider from the API region. */
export class MarketDataCollectorClient {
  readonly feed = new LiveFeed(randomUUID());
  readonly counters = { connections: 0, reconnects: 0, frames: 0, rejected: 0, propagationMs: 0 };
  private socket: WebSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private abort: AbortController | null = null;
  private running = false;
  private attempt = 0;
  private generation = 0;
  private lastMessage = 0;
  private epoch: string | null = null;
  private revision = -1;
  private readonly http: HttpProviderClient;
  constructor(private url: string, private token: string, fetchFn?: typeof fetch) {
    const parsed = new URL(url);
    if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Invalid collector URL');
    if (parsed.protocol === 'http:' && !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)) throw new Error('Collector requires TLS outside loopback');
    this.url = url.replace(/\/+$/, '');
    this.http = new HttpProviderClient('market-data-collector', { fetchFn,
      health: providerHealthRegistry.register(new ProviderHealth('market-data-collector')), retries: 0,
      wrapError: () => new Error('Collector unavailable') });
  }
  start(): void { if (!this.running) { this.running = true; this.generation++; void this.connect(); } }
  private async connect(): Promise<void> {
    const generation = this.generation;
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort?.abort(), 10_000);
    try {
      const data = await this.http.getJson(`${this.url}/internal/v1/snapshot`, {
        headers: { Authorization: `Bearer ${this.token}` }, signal: this.abort.signal, redirect: 'error',
      });
      if (!this.running || generation !== this.generation) return;
      const initial = parseLiveFrame(data);
      if (initial.type !== 'snapshot') throw new Error('Snapshot required');
      this.apply(initial, true);
      const ws = new WebSocket(`${this.url.replace(/^http/, 'ws')}/internal/v1/stream`, {
        headers: { Authorization: `Bearer ${this.token}` }, handshakeTimeout: 10_000,
        maxPayload: 16_000_000, followRedirects: false, perMessageDeflate: false,
      });
      this.socket = ws; this.counters.connections++; this.lastMessage = Date.now();
      const connectedAt = Date.now();
      const fail = () => { if (this.socket === ws) this.disconnect(); };
      ws.on('error', fail); ws.on('close', fail);
      let initialized = false;
      ws.on('message', raw => {
        if (this.socket !== ws) return;
        try {
          const frame = parseLiveFrame(JSON.parse(raw.toString()));
          if (!initialized && frame.type !== 'snapshot') throw new Error('Snapshot required');
          this.apply(frame, !initialized); initialized = true;
          this.lastMessage = Date.now(); if (Date.now() - connectedAt >= 60_000) this.attempt = 0;
        } catch { this.counters.rejected++; fail(); }
      });
      this.watchdog = setInterval(() => { if (Date.now() - this.lastMessage > 40_000) fail(); }, 10_000);
    } catch { if (this.running && generation === this.generation) this.disconnect(); }
    finally { clearTimeout(timeout); }
  }
  private apply(frame: LiveFrame, initial: boolean): void {
    if (!initial && (frame.epoch !== this.epoch || frame.revision < this.revision ||
        (frame.type === 'delta' && frame.revision !== this.revision + 1))) throw new Error('Stream discontinuity');
    this.epoch = frame.epoch; this.revision = frame.revision;
    this.counters.frames++; this.counters.propagationMs = Math.max(0, Date.now() - frame.sentAt);
    this.feed.status = frame.status;
    this.feed.publish(frame.type, frame.rows);
  }
  private disconnect(): void {
    const socket = this.socket; this.socket = null; socket?.terminate();
    if (this.watchdog) clearInterval(this.watchdog); this.watchdog = null;
    this.feed.status = 'stale';
    this.feed.publish('delta', [...this.feed.rows.values()].map(row => ({ ...row, stale: true })));
    this.feed.publish('state');
    if (this.running && !this.timer) {
      this.counters.reconnects++;
      this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, reconnectDelay(this.attempt++));
    }
  }
  stop(): void {
    this.running = false; this.generation++; this.abort?.abort();
    if (this.timer) clearTimeout(this.timer); this.timer = null; this.disconnect();
  }
}

export function collectorFromEnv(env: NodeJS.ProcessEnv = process.env): MarketDataCollectorClient | null {
  if (!env.MARKET_DATA_COLLECTOR_URL?.trim() || !env.MARKET_DATA_COLLECTOR_TOKEN?.trim()) return null;
  try { return new MarketDataCollectorClient(env.MARKET_DATA_COLLECTOR_URL, env.MARKET_DATA_COLLECTOR_TOKEN); }
  catch { console.warn('[marketData] Collector configuration invalid; live reference disabled'); return null; }
}
