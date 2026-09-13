import { z } from 'zod';
import type { CfdQuote } from './CfdQuote';
import { CFD_REFERENCE_CATALOG } from './catalog';
import { CFD_OHLC_INTERVALS, type CfdOhlcInterval, type CfdOhlcSnapshot } from './BiquoteCfdOhlcSource';

const AVAILABILITY = ['live','reference_only','stale','unavailable','entitlement_required','market_closed','malformed'] as const;
const REFERENCE = ['available','stale','unavailable','market_closed'] as const;
const quoteSchema = z.object({
  provider: z.string().min(1).max(80),
  symbol: z.string().min(1).max(24),
  providerSymbol: z.string().min(1).max(80),
  bid: z.number().finite().nullable(),
  ask: z.number().finite().nullable(),
  last: z.number().finite().nullable(),
  mid: z.number().finite().nullable(),
  lastDecimal: z.string().max(80).optional(),
  providerTimestamp: z.number().finite().nullable(),
  fetchedAt: z.number().finite().nullable(),
  stale: z.boolean(),
  status: z.enum(AVAILABILITY),
  referenceStatus: z.enum(REFERENCE).optional(),
  entitlementVerified: z.boolean(),
  executionAllowed: z.boolean(),
  changePercent24h: z.string().max(80).optional(),
});
const payloadSchema = z.object({ quotes: z.array(quoteSchema).max(32) });
const barSchema=z.object({openTime:z.number().finite().positive(),open:z.number().finite().positive(),high:z.number().finite().positive(),low:z.number().finite().positive(),close:z.number().finite().positive(),volume:z.number().finite().nonnegative().nullable(),tickVolume:z.number().finite().nonnegative().nullable(),isOpen:z.boolean()});
const ohlcSchema=z.object({symbol:z.string().min(1).max(24),providerSymbol:z.string().min(1).max(80),interval:z.enum(CFD_OHLC_INTERVALS),fetchedAt:z.number().finite().positive(),bars:z.array(barSchema).min(2).max(500),source:z.literal('biquote')});
const canonical = new Set(CFD_REFERENCE_CATALOG.map(row => row.symbol));

/**
 * Read-only bridge to the Frankfurt market-data collector.
 *
 * Public CFD display sources are collected there because the exchange API
 * runs in another region. The collector is already the single upstream owner
 * for live reference data; using it here avoids making every API process (or
 * every browser) establish its own public-provider connections.
 *
 * This adapter is intentionally NOT a CfdQuoteSource. It cannot be injected
 * into open/close/PnL/liquidation code and every remote row is stripped of
 * execution/entitlement permission before being returned.
 */
export class CollectorCfdDisplaySource {
  private readonly baseUrl: string;
  private cache: { rows: CfdQuote[]; at: number } | null = null;
  private inFlight: Promise<CfdQuote[]> | null = null;
  private ohlcCache=new Map<string,{at:number;value:CfdOhlcSnapshot}>();
  private ohlcInFlight=new Map<string,Promise<CfdOhlcSnapshot>>();

  constructor(
    url: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 3_000,
    private readonly cacheMs = 1_000,
  ) {
    const parsed = new URL(url);
    if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
      throw new Error('Invalid collector URL');
    }
    if (parsed.protocol === 'http:' && !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)) {
      throw new Error('Collector requires TLS outside loopback');
    }
    if (!token.trim()) throw new Error('Collector token required');
    this.baseUrl = url.replace(/\/+$/, '');
  }

  async getQuotes(): Promise<CfdQuote[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at <= this.cacheMs) return this.cache.rows.map(row => ({ ...row }));
    if (this.inFlight) return this.inFlight.then(rows => rows.map(row => ({ ...row })));

    const load = (async () => {
      const response = await this.fetchFn(`${this.baseUrl}/internal/v1/cfd/tickers`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(Math.max(500, Math.min(8_000, this.timeoutMs))),
      });
      if (!response.ok) throw new Error('Collector CFD display unavailable');
      const parsed = payloadSchema.parse(await response.json());
      const seen = new Set<string>();
      const rows: CfdQuote[] = [];
      for (const raw of parsed.quotes) {
        if (!canonical.has(raw.symbol) || seen.has(raw.symbol)) continue;
        seen.add(raw.symbol);
        const last = raw.last !== null && raw.last > 0 ? raw.last : null;
        rows.push({
          ...raw,
          last,
          bid: raw.bid !== null && raw.bid > 0 ? raw.bid : null,
          ask: raw.ask !== null && raw.ask > 0 ? raw.ask : null,
          mid: raw.mid !== null && raw.mid > 0 ? raw.mid : null,
          entitlementVerified: false,
          executionAllowed: false,
        } as CfdQuote);
      }
      this.cache = { rows: rows.map(row => ({ ...row })), at: Date.now() };
      return rows;
    })().finally(() => { this.inFlight = null; });

    this.inFlight = load;
    return load.then(rows => rows.map(row => ({ ...row })));
  }

  async getOhlc(symbol:string,interval:CfdOhlcInterval='15m',limit=240):Promise<CfdOhlcSnapshot>{
    if(!canonical.has(symbol)||!CFD_OHLC_INTERVALS.includes(interval))throw new Error('invalid_cfd_ohlc_request');
    const boundedLimit=Math.max(20,Math.min(500,Math.trunc(limit)||240)),key=`${symbol}:${interval}:${boundedLimit}`,now=Date.now(),cached=this.ohlcCache.get(key);
    if(cached&&now-cached.at<=5_000)return{...cached.value,bars:cached.value.bars.map(bar=>({...bar}))};
    const pending=this.ohlcInFlight.get(key);if(pending)return pending.then(value=>({...value,bars:value.bars.map(bar=>({...bar}))}));
    const load=(async()=>{
      const url=new URL(`${this.baseUrl}/internal/v1/cfd/ohlc/${encodeURIComponent(symbol)}`);url.searchParams.set('interval',interval);url.searchParams.set('limit',String(boundedLimit));
      const response=await this.fetchFn(url.toString(),{headers:{Authorization:`Bearer ${this.token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(Math.max(1_000,Math.min(10_000,this.timeoutMs+2_000)))});
      if(!response.ok)throw new Error('Collector CFD OHLC unavailable');const parsed=ohlcSchema.parse(await response.json());
      if(parsed.symbol!==symbol||parsed.interval!==interval)throw new Error('Collector CFD OHLC identity mismatch');
      const value=parsed as CfdOhlcSnapshot;this.ohlcCache.set(key,{at:Date.now(),value});return value;
    })().finally(()=>this.ohlcInFlight.delete(key));
    this.ohlcInFlight.set(key,load);return load.then(value=>({...value,bars:value.bars.map(bar=>({...bar}))}));
  }

  diagnostics() {
    return {
      provider: 'market-data-collector-cfd-display',
      cachedAt: this.cache?.at ?? null,
      cachedRows: this.cache?.rows.length ?? 0,
      ohlcSeries:this.ohlcCache.size,
    };
  }
}
