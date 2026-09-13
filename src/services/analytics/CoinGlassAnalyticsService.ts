import { ProviderCache } from '../marketData/ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  logCircuitTransition,
  providerHealthRegistry,
  type ProviderRequestPolicy,
} from '../marketData/ProviderHealth';
import { available, unavailable, type Availability } from '../marketData/types';

const DEFAULT_BASE_URL = 'https://open-api-v4.coinglass.com';
const TRACKED = new Set(['BTC', 'ETH', 'SOL', 'XRP']);
const ETF_PATH: Record<string, string> = {
  BTC: '/api/etf/bitcoin/flow-history',
  ETH: '/api/etf/ethereum/flow-history',
  SOL: '/api/etf/solana/flow-history',
  XRP: '/api/etf/xrp/flow-history',
};
const EXCHANGE_BALANCE_SUPPORTED = new Set(['BTC', 'ETH', 'XRP']);

export interface LiquidationHeatmapCell {
  x: number;
  y: number;
  intensity: number;
}
export interface LiquidationHeatmapCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}
export interface LiquidationHeatmapValue {
  baseAsset: string;
  exchange: string;
  symbol: string;
  range: '3d';
  prices: number[];
  cells: LiquidationHeatmapCell[];
  candles: LiquidationHeatmapCandle[];
}

export interface EtfFlowPoint {
  timestamp: number;
  flowUsd: number;
  priceUsd: number | null;
  funds: { ticker: string; flowUsd: number }[];
}
export interface EtfFlowsValue {
  baseAsset: string;
  points: EtfFlowPoint[];
}

export interface ExchangeBalanceRow {
  exchange: string;
  totalBalance: number;
  change1d: number | null;
  changePercent1d: number | null;
  change7d: number | null;
  changePercent7d: number | null;
  change30d: number | null;
  changePercent30d: number | null;
}
export interface ExchangeFlowsValue {
  baseAsset: string;
  rows: ExchangeBalanceRow[];
  aggregateChange1d: number | null;
  aggregateChange7d: number | null;
  aggregateChange30d: number | null;
}

export interface WhaleTransferEvent {
  transactionHash: string;
  amountUsd: number;
  assetQuantity: number | null;
  assetSymbol: string;
  from: string;
  to: string;
  blockchain: string;
  observedAt: number;
}
export interface WhaleActivityValue {
  baseAsset: string;
  windowHours: 24;
  eventCount: number;
  totalUsd: number;
  events: WhaleTransferEvent[];
}

type Envelope<T> = { code?: string | number; msg?: string; data?: T };

/**
 * Optional commercial Analytics feed. It is instantiated only when a
 * server-side COINGLASS_API_KEY is configured. The key never crosses the API
 * boundary and this service never participates in matching or execution.
 */
export class CoinGlassAnalyticsService {
  readonly health: ProviderHealth;
  private readonly http: HttpProviderClient;
  private readonly heatmapCache: ProviderCache<LiquidationHeatmapValue>;
  private readonly etfCache: ProviderCache<EtfFlowsValue>;
  private readonly exchangeCache: ProviderCache<ExchangeFlowsValue>;
  private readonly whaleCache: ProviderCache<WhaleActivityValue>;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = DEFAULT_BASE_URL,
    options: { fetchFn?: typeof fetch; policy?: ProviderRequestPolicy; now?: () => number } = {}
  ) {
    if (!apiKey.trim()) throw new Error('CoinGlass API key is required');
    this.health = providerHealthRegistry.register(
      new ProviderHealth('coinglass-analytics', { onStateChange: logCircuitTransition, now: options.now })
    );
    this.http = new HttpProviderClient('CoinGlass Analytics', {
      health: this.health,
      fetchFn: options.fetchFn,
      now: options.now,
      retries: options.policy?.retries,
      baseDelayMs: options.policy?.baseDelayMs,
      maxDelayMs: options.policy?.maxDelayMs,
      sleep: options.policy?.sleep,
    });
    const cache = <T>(ttlMs: number, maxStaleMs: number) => new ProviderCache<T>({
      ttlMs, maxStaleMs, maxEntries: 4, now: options.now,
    });
    this.heatmapCache = cache(30_000, 5 * 60_000);
    this.etfCache = cache(30 * 60_000, 6 * 60 * 60_000);
    this.exchangeCache = cache(30 * 60_000, 6 * 60 * 60_000);
    this.whaleCache = cache(60_000, 10 * 60_000);
  }

  async getLiquidationHeatmap(baseAsset: string): Promise<Availability<LiquidationHeatmapValue>> {
    const asset = this.asset(baseAsset);
    if (!asset) return unavailable('unsupported_metric', 'Liquidation heatmap is not available for this asset.');
    try {
      const cached = await this.heatmapCache.fetch(asset, () => this.fetchHeatmap(asset));
      return available({ value: cached.value, source: 'coinglass', fetchedAt: cached.fetchedAt, stale: cached.stale });
    } catch {
      return unavailable('provider_unavailable', 'Liquidation heatmap could not be read.');
    }
  }

  async getEtfFlows(baseAsset: string): Promise<Availability<EtfFlowsValue>> {
    const asset = this.asset(baseAsset);
    if (!asset) return unavailable('unsupported_metric', 'ETF flows are not available for this asset.');
    try {
      const cached = await this.etfCache.fetch(asset, () => this.fetchEtfFlows(asset));
      return available({ value: cached.value, source: 'coinglass', fetchedAt: cached.fetchedAt, stale: cached.stale });
    } catch {
      return unavailable('provider_unavailable', 'ETF flows could not be read.');
    }
  }

  async getExchangeFlows(baseAsset: string): Promise<Availability<ExchangeFlowsValue>> {
    const asset = this.asset(baseAsset);
    if (!asset || !EXCHANGE_BALANCE_SUPPORTED.has(asset)) {
      return unavailable('unsupported_metric', 'Attributed exchange balance changes are not available for this asset.');
    }
    try {
      const cached = await this.exchangeCache.fetch(asset, () => this.fetchExchangeFlows(asset));
      return available({ value: cached.value, source: 'coinglass', fetchedAt: cached.fetchedAt, stale: cached.stale });
    } catch {
      return unavailable('provider_unavailable', 'Exchange balance changes could not be read.');
    }
  }

  async getWhaleActivity(baseAsset: string): Promise<Availability<WhaleActivityValue>> {
    const asset = this.asset(baseAsset);
    if (!asset) return unavailable('unsupported_metric', 'Whale transfers are not available for this asset.');
    try {
      const cached = await this.whaleCache.fetch(asset, () => this.fetchWhaleActivity(asset));
      return available({ value: cached.value, source: 'coinglass', fetchedAt: cached.fetchedAt, stale: cached.stale });
    } catch {
      return unavailable('provider_unavailable', 'Whale transfers could not be read.');
    }
  }

  private asset(value: string): string | null {
    const asset = value.toUpperCase();
    return TRACKED.has(asset) ? asset : null;
  }

  private async fetchHeatmap(asset: string): Promise<LiquidationHeatmapValue> {
    const symbol = `${asset}USDT`;
    const data = await this.get<unknown>('/api/futures/liquidation/heatmap/model1', {
      exchange: 'Binance', symbol, range: '3d',
    });
    if (!data || typeof data !== 'object') throw new Error('Invalid heatmap data');
    const raw = data as Record<string, unknown>;
    const prices = Array.isArray(raw.y_axis) ? raw.y_axis.map(number).filter(nonNull) : [];
    const cells = Array.isArray(raw.liquidation_leverage_data)
      ? raw.liquidation_leverage_data.map((row) => {
          if (!Array.isArray(row) || row.length < 3) return null;
          const x = integer(row[0]), y = integer(row[1]), intensity = number(row[2]);
          if (x === null || y === null || intensity === null || intensity < 0 || y >= prices.length) return null;
          return { x, y, intensity };
        }).filter(nonNull)
      : [];
    const candles = Array.isArray(raw.price_candlesticks)
      ? raw.price_candlesticks.map((row) => {
          if (!Array.isArray(row) || row.length < 6) return null;
          const time = number(row[0]), open = number(row[1]), high = number(row[2]), low = number(row[3]), close = number(row[4]), volumeUsd = number(row[5]);
          if ([time, open, high, low, close, volumeUsd].some((v) => v === null) || time! <= 0 || low! <= 0 || high! < low!) return null;
          return { time: time! < 1e12 ? time! * 1000 : time!, open: open!, high: high!, low: low!, close: close!, volumeUsd: volumeUsd! };
        }).filter(nonNull)
      : [];
    if (prices.length < 2 || cells.length === 0 || candles.length < 2) throw new Error('Heatmap response has no usable data');
    return { baseAsset: asset, exchange: 'Binance', symbol, range: '3d', prices, cells: cells.slice(0, 12_000), candles };
  }

  private async fetchEtfFlows(asset: string): Promise<EtfFlowsValue> {
    const data = await this.get<unknown>(ETF_PATH[asset]);
    if (!Array.isArray(data)) throw new Error('ETF flow response is not an array');
    const points = data.map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const timestamp = number(r.timestamp), flowUsd = number(r.flow_usd), priceUsd = number(r.price_usd);
      if (timestamp === null || timestamp <= 0 || flowUsd === null) return null;
      const funds = Array.isArray(r.etf_flows) ? r.etf_flows.map((fund) => {
        if (!fund || typeof fund !== 'object') return null;
        const f = fund as Record<string, unknown>;
        const ticker = typeof f.etf_ticker === 'string' ? f.etf_ticker.slice(0, 32) : '';
        const value = number(f.flow_usd);
        return ticker && value !== null ? { ticker, flowUsd: value } : null;
      }).filter(nonNull) : [];
      return { timestamp, flowUsd, priceUsd, funds };
    }).filter(nonNull).sort((a, b) => a.timestamp - b.timestamp).slice(-90);
    if (points.length === 0) throw new Error('ETF flow response has no usable points');
    return { baseAsset: asset, points };
  }

  private async fetchExchangeFlows(asset: string): Promise<ExchangeFlowsValue> {
    const data = await this.get<unknown>('/api/exchange/balance/list', { symbol: asset });
    if (!Array.isArray(data)) throw new Error('Exchange balance response is not an array');
    const rows = data.map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const exchange = typeof r.exchange_name === 'string' ? r.exchange_name.slice(0, 80) : '';
      const totalBalance = number(r.total_balance);
      if (!exchange || totalBalance === null || totalBalance < 0) return null;
      return {
        exchange,
        totalBalance,
        change1d: number(r.balance_change_1d),
        changePercent1d: number(r.balance_change_percent_1d),
        change7d: number(r.balance_change_7d),
        changePercent7d: number(r.balance_change_percent_7d),
        change30d: number(r.balance_change_30d),
        changePercent30d: number(r.balance_change_percent_30d),
      };
    }).filter(nonNull).sort((a, b) => b.totalBalance - a.totalBalance);
    if (rows.length === 0) throw new Error('Exchange balance response has no usable rows');
    const aggregate = (key: 'change1d' | 'change7d' | 'change30d') => {
      const values = rows.map((row) => row[key]).filter((v): v is number => v !== null);
      return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    return {
      baseAsset: asset,
      rows: rows.slice(0, 20),
      aggregateChange1d: aggregate('change1d'),
      aggregateChange7d: aggregate('change7d'),
      aggregateChange30d: aggregate('change30d'),
    };
  }

  private async fetchWhaleActivity(asset: string): Promise<WhaleActivityValue> {
    const end = Date.now();
    const start = end - 24 * 60 * 60_000;
    const data = await this.get<unknown>('/api/chain/v2/whale-transfer', {
      symbol: asset, start_time: start, end_time: end,
    });
    if (!Array.isArray(data)) throw new Error('Whale transfer response is not an array');
    const events = data.map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const transactionHash = typeof r.transaction_hash === 'string' ? r.transaction_hash.slice(0, 160) : '';
      const amountUsd = number(r.amount_usd);
      const observed = number(r.block_timestamp);
      if (!transactionHash || amountUsd === null || amountUsd < 0 || observed === null || observed <= 0) return null;
      return {
        transactionHash,
        amountUsd,
        assetQuantity: number(r.asset_quantity),
        assetSymbol: typeof r.asset_symbol === 'string' ? r.asset_symbol.slice(0, 24) : asset,
        from: typeof r.from === 'string' ? r.from.slice(0, 160) : '—',
        to: typeof r.to === 'string' ? r.to.slice(0, 160) : '—',
        blockchain: typeof r.blockchain_name === 'string' ? r.blockchain_name.slice(0, 80) : '—',
        observedAt: observed < 1e12 ? observed * 1000 : observed,
      };
    }).filter(nonNull).sort((a, b) => b.observedAt - a.observedAt).slice(0, 100);
    return {
      baseAsset: asset,
      windowHours: 24,
      eventCount: events.length,
      totalUsd: events.reduce((sum, event) => sum + event.amountUsd, 0),
      events,
    };
  }

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    const url = `${this.baseUrl}${path}${query.size ? `?${query}` : ''}`;
    const raw = await this.http.getJson(url, { headers: { 'CG-API-KEY': this.apiKey } }) as Envelope<T>;
    if (String(raw?.code ?? '') !== '0' || raw.data === undefined) {
      throw new Error('CoinGlass returned an unsuccessful response');
    }
    return raw.data;
  }
}

function number(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function integer(value: unknown): number | null {
  const n = number(value);
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function nonNull<T>(value: T | null): value is T { return value !== null; }
