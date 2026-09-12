import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { HttpProviderClient, ProviderHealth, providerHealthRegistry } from '../ProviderHealth';
import type { CachedValue } from '../ProviderCache';
import { BybitMarketDataService } from '../bybit/BybitMarketDataService';
import type { MarketUniverseSnapshot } from '../bybit/MarketUniverse';
import type { NormalizedInstrument } from '../bybit/types';
import { LiveFeed, reconnectDelay, type LiveFrame } from './contract';
import { parseLiveFrame } from './validation';
import { optionQuerySchema, optionInstrumentPageSchema, optionTickerPageSchema, OptionsRequestError, type OptionQuery } from '../bybit/BybitOptions';

const finiteNullable = z.number().finite().nullable();
const nonEmpty = z.string().min(1).max(160);
const instrumentSchema = z.object({
  symbol: nonEmpty,
  providerSymbol: nonEmpty,
  provider: z.literal('bybit'),
  marketType: z.enum(['spot','linear_perpetual','linear_futures','inverse','inverse_perpetual','inverse_futures']),
  baseAsset: nonEmpty,
  quoteAsset: nonEmpty,
  settleAsset: nonEmpty.nullable(),
  status: z.enum(['Trading','PreLaunch','Delivering','Closed','Settling','Unknown']),
  launchTime: finiteNullable,
  deliveryTime: finiteNullable,
  filters: z.object({
    tickSize: finiteNullable,
    qtyStep: finiteNullable,
    minOrderQty: finiteNullable,
    maxOrderQty: finiteNullable,
    minNotional: finiteNullable,
    maxNotional: finiteNullable,
    pricePrecision: finiteNullable,
    qtyPrecision: finiteNullable,
  }),
  providerMaxLeverage: finiteNullable,
  fundingIntervalMinutes: finiteNullable,
});
const universeSnapshotSchema = z.object({
  instruments: z.array(instrumentSchema).max(20_000),
  refreshedAt: finiteNullable,
  stale: z.boolean(),
  loaded: z.boolean(),
});

/** One connector per backend process. This object never calls the provider
 * from the API region. All Bybit reads are made by the configured collector. */
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
  private universeCache: { value: MarketUniverseSnapshot; cachedAt: number } | null = null;
  private universeInFlight: Promise<MarketUniverseSnapshot> | null = null;
  constructor(private url: string, private token: string, private fetchFn: typeof fetch = fetch) {
    const parsed = new URL(url);
    if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Invalid collector URL');
    if (parsed.protocol === 'http:' && !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)) throw new Error('Collector requires TLS outside loopback');
    this.url = url.replace(/\/+$/, '');
    this.http = new HttpProviderClient('market-data-collector', { fetchFn,
      health: providerHealthRegistry.register(new ProviderHealth('market-data-collector')), retries: 0,
      wrapError: () => new Error('Collector unavailable') });
  }
  async optionsSnapshot(kind: 'instruments' | 'tickers', input: OptionQuery) {
    const query = optionQuerySchema.parse(input);
    const params = new URLSearchParams(Object.entries(query).filter(([,v]) => v !== undefined).map(([k,v]): [string,string] => [k,String(v)]));
    // Only the configured collector receives this credential. Redirects are
    // forbidden, and upstream bodies/errors cannot leak into the public API.
    const response = await this.fetchFn(`${this.url}/internal/v1/options/${kind}?${params}`, {
      headers:{Authorization:`Bearer ${this.token}`}, redirect:'error', signal:AbortSignal.timeout(10_000),
    });
    if ([400,409].includes(response.status)) throw new OptionsRequestError(response.status, response.status === 409 ? 'snapshot_changed' : 'invalid_options_query');
    if (!response.ok) throw new Error('Options collector unavailable');
    const body = await response.json();
    return kind === 'instruments' ? optionInstrumentPageSchema.parse(body) : optionTickerPageSchema.parse(body);
  }
  async universeSnapshot(): Promise<MarketUniverseSnapshot> {
    const now = Date.now();
    if (this.universeCache && now - this.universeCache.cachedAt <= 1_000) return this.universeCache.value;
    if (this.universeInFlight) return this.universeInFlight;
    const load = (async () => {
      const response = await this.fetchFn(`${this.url}/internal/v1/universe`, {
        headers:{Authorization:`Bearer ${this.token}`}, redirect:'error', signal:AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Collector universe unavailable');
      const value = universeSnapshotSchema.parse(await response.json()) as MarketUniverseSnapshot;
      this.universeCache = { value, cachedAt: Date.now() };
      return value;
    })().finally(() => { this.universeInFlight = null; });
    this.universeInFlight = load;
    return load;
  }
  start(): void { if (!this.running) { this.running = true; this.generation++; void this.connect(); } }
  private async connect(): Promise<void> {
    const generation = this.generation;
    const abort = new AbortController(); this.abort = abort;
    const timeout = setTimeout(() => abort.abort(), 10_000);
    try {
      const data = await this.http.getJson(`${this.url}/internal/v1/snapshot`, {
        headers: { Authorization: `Bearer ${this.token}` }, signal: abort.signal, redirect: 'error',
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
    // Reconnecting does not make a rollback within the same epoch valid.
    if (frame.epoch === this.epoch && frame.revision < this.revision) throw new Error('Snapshot rollback');
    if (!initial && (frame.epoch !== this.epoch || frame.revision < this.revision ||
        (frame.type === 'delta' && frame.revision !== this.revision + 1))) throw new Error('Stream discontinuity');
    this.epoch = frame.epoch; this.revision = frame.revision;
    this.counters.frames++; this.counters.propagationMs = Math.max(0, Date.now() - frame.sentAt);
    this.feed.status = frame.status;
    const rows = frame.rows.map(row => {
      const previous = this.feed.rows.get(row.id);
      // A restarted collector may bootstrap an older cached observation.
      // Its snapshot still owns membership; retain only newer matching rows,
      // explicitly stale until the provider catches up.
      return previous && (row.providerEventAt ?? row.fetchedAt) < (previous.providerEventAt ?? previous.fetchedAt)
        ? { ...previous, stale: true } : row;
    });
    this.feed.publish(frame.type, rows);
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

/** MarketUniverse-compatible provider backed only by the remote collector.
 * The superclass transport is intentionally disabled, so constructing this
 * adapter in Oregon cannot fall back to a direct Bybit request. */
export class CollectorUniverseProvider extends BybitMarketDataService {
  constructor(private readonly collector: Pick<MarketDataCollectorClient,'universeSnapshot'>) {
    super({
      baseUrl: 'http://127.0.0.1',
      fetchFn: async () => { throw new Error('Direct Bybit access disabled in API region'); },
    });
  }
  private async instruments(kind: 'spot' | 'linear' | 'inverse'): Promise<CachedValue<NormalizedInstrument[]>> {
    const snapshot = await this.collector.universeSnapshot();
    if (!snapshot.loaded || snapshot.refreshedAt === null) throw new Error('Collector universe unavailable');
    const value = snapshot.instruments.filter((instrument) =>
      kind === 'spot'
        ? instrument.marketType === 'spot'
        : kind === 'linear'
          ? instrument.marketType.startsWith('linear_')
          : instrument.marketType === 'inverse' || instrument.marketType.startsWith('inverse_')
    );
    return { value, fetchedAt: snapshot.refreshedAt, stale: snapshot.stale };
  }
  override listSpotInstruments(): Promise<CachedValue<NormalizedInstrument[]>> { return this.instruments('spot'); }
  override listLinearInstruments(): Promise<CachedValue<NormalizedInstrument[]>> { return this.instruments('linear'); }
  override listInverseInstruments(): Promise<CachedValue<NormalizedInstrument[]>> { return this.instruments('inverse'); }
}

export function collectorFromEnv(env: NodeJS.ProcessEnv = process.env): MarketDataCollectorClient | null {
  if (!env.MARKET_DATA_COLLECTOR_URL?.trim() || !env.MARKET_DATA_COLLECTOR_TOKEN?.trim()) return null;
  try { return new MarketDataCollectorClient(env.MARKET_DATA_COLLECTOR_URL, env.MARKET_DATA_COLLECTOR_TOKEN); }
  catch { console.warn('[marketData] Collector configuration invalid; live reference disabled'); return null; }
}
