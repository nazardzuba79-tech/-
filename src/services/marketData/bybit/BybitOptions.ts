import { z } from 'zod';
import { randomUUID } from 'crypto';
import { ProviderCache } from '../ProviderCache';
import { finite } from '../numbers';
import type { BybitMarketDataService } from './BybitMarketDataService';

const number = z.number().finite().nullable();
const text = z.string().min(1).max(160);
const expiryDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === s;
}, 'Invalid expiry date');
export const optionInstrumentSchema = z.object({
  provider: z.literal('bybit'), marketType: z.literal('option'), executable: z.literal(false),
  providerSymbol: text, baseAsset: text, quoteAsset: text, settleAsset: text,
  status: text, optionType: z.enum(['Call', 'Put']), strike: z.number().finite().positive(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), deliveryTime: z.number().finite().positive(), launchTime: number,
  filters: z.object({ tickSize: number, minPrice: number, maxPrice: number, qtyStep: number, minOrderQty: number, maxOrderQty: number }),
});
export type OptionInstrument = z.infer<typeof optionInstrumentSchema>;
export const optionTickerSchema = z.object({
  provider: z.literal('bybit'), marketType: z.literal('option'), executable: z.literal(false), providerSymbol: text,
  bid: number, ask: number, bidSize: number, askSize: number, last: number, mark: number, index: number,
  bidIv: number, askIv: number, markIv: number, underlyingPrice: number,
  delta: number, gamma: number, theta: number, vega: number, openInterest: number,
  volume24h: number, turnover24h: number, totalVolume: number, totalTurnover: number,
  high24h: number, low24h: number, change24h: number, predictedDeliveryPrice: number,
  providerEventAt: number,
});
export type OptionTicker = z.infer<typeof optionTickerSchema>;
export const optionQuerySchema = z.object({
  baseCoin: z.string().regex(/^[A-Z0-9]{1,16}$/).optional(),
  expiry: expiryDate.optional(),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
}).strict();
export type OptionQuery = z.infer<typeof optionQuerySchema>;
const pageFields = {
  provider: z.literal('bybit'), mode: z.literal('rest_snapshot'), executable: z.literal(false),
  fetchedAt: z.number().finite().positive(), stale: z.boolean(), revision: text,
  nextCursor: z.string().max(512).nullable(), total: z.number().int().min(0).max(40_000),
};
export const optionInstrumentPageSchema = z.object({ ...pageFields, items: z.array(optionInstrumentSchema).max(500) });
export const optionTickerPageSchema = z.object({ ...pageFields, items: z.array(optionTickerSchema).max(500) });
export class OptionsRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
/** Official symbol formats: ETH-3JAN23-1250-P and BTC-27MAR26-70000-P-USDT.
 * Metadata owns currencies/type/delivery; symbol parsing supplies only the
 * separately unpublished strike and cross-checks the date/type/base. */
export function normalizeOptionInstrument(value: unknown): OptionInstrument | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, any>;
  const m = typeof r.symbol === 'string' && /^([A-Z0-9]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-(C|P)(?:-([A-Z0-9]+))?$/.exec(r.symbol);
  const delivery = finite(r.deliveryTime);
  if (!m || !delivery || delivery <= 0 || delivery > 8.64e15 || m[1] !== r.baseCoin
    || (m[6] === 'C' ? 'Call' : 'Put') !== r.optionsType || (m[7] && m[7] !== r.settleCoin)) return null;
  const date = new Date(delivery);
  if (date.getUTCDate() !== Number(m[2]) || months[date.getUTCMonth()] !== m[3] || date.getUTCFullYear() !== 2000 + Number(m[4])) return null;
  const positive = (v: unknown) => { const n = finite(v); return n !== null && n > 0 ? n : null; };
  const parsed = optionInstrumentSchema.safeParse({
    provider: 'bybit', marketType: 'option', executable: false, providerSymbol: r.symbol,
    baseAsset: r.baseCoin, quoteAsset: r.quoteCoin, settleAsset: r.settleCoin, status: r.status,
    optionType: r.optionsType, strike: finite(m[5]), expiry: date.toISOString().slice(0,10),
    deliveryTime: delivery, launchTime: positive(r.launchTime),
    filters: { tickSize: positive(r.priceFilter?.tickSize), minPrice: positive(r.priceFilter?.minPrice), maxPrice: positive(r.priceFilter?.maxPrice),
      qtyStep: positive(r.lotSizeFilter?.qtyStep), minOrderQty: positive(r.lotSizeFilter?.minOrderQty), maxOrderQty: positive(r.lotSizeFilter?.maxOrderQty) },
  });
  return parsed.success ? parsed.data : null;
}
export function normalizeOptionTicker(value: unknown, eventAt: number | null): OptionTicker | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const mapping = { bid:'bid1Price', ask:'ask1Price', bidSize:'bid1Size', askSize:'ask1Size', last:'lastPrice', mark:'markPrice', index:'indexPrice',
    bidIv:'bid1Iv', askIv:'ask1Iv', markIv:'markIv', underlyingPrice:'underlyingPrice', delta:'delta', gamma:'gamma', theta:'theta', vega:'vega',
    openInterest:'openInterest', volume24h:'volume24h', turnover24h:'turnover24h', totalVolume:'totalVolume', totalTurnover:'totalTurnover',
    high24h:'highPrice24h', low24h:'lowPrice24h', change24h:'change24h', predictedDeliveryPrice:'predictedDeliveryPrice' };
  const parsed = optionTickerSchema.safeParse({ provider:'bybit', marketType:'option', executable:false,
    providerSymbol:r.symbol, providerEventAt:eventAt, ...Object.fromEntries(Object.entries(mapping).map(([key, field]) => [key, finite(r[field])])) });
  return parsed.success ? parsed.data : null;
}

/** One full universe and one shared batch per discovered base, irrespective of
 * filters/pages/client count. No option row ever enters LiveFeed. The interface
 * can later serve a ref-counted source without changing the public contract. */
export class BybitOptions {
  private universe: ProviderCache<OptionInstrument[]>;
  private tickers: ProviderCache<OptionTicker[]>;
  private readonly epoch = randomUUID();
  private lastProviderAt = new Map<string, number>();
  private counts = { contracts: null as number | null, bases: null as number | null, rejectedInstruments: 0 };
  constructor(private rest: BybitMarketDataService, private now = Date.now) {
    this.universe = new ProviderCache({ ttlMs:900_000, maxStaleMs:3_600_000, maxEntries:1, now });
    this.tickers = new ProviderCache({ ttlMs:5_000, maxStaleMs:30_000, maxEntries:32, now });
  }
  async loadUniverse() {
    return this.universe.fetch('all', async () => {
      const found = new Map<string, OptionInstrument>(), seen = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 40; page++) {
        const result = await this.rest.optionInstrumentsPage(cursor);
        for (const row of result.list) {
          const i = normalizeOptionInstrument(row);
          if (i) found.set(i.providerSymbol, i);
          else { this.counts.rejectedInstruments++; throw new Error('Options instrument schema changed'); }
        }
        const next = result.nextPageCursor;
        if (!next) {
          if (!found.size) throw new Error('Options universe unavailable');
          const bases = new Set([...found.values()].map(i => i.baseAsset)).size;
          if (bases > 32) throw new Error('Options base cap exceeded');
          this.counts.contracts = found.size; this.counts.bases = bases;
          return [...found.values()].sort((a,b) => a.providerSymbol.localeCompare(b.providerSymbol));
        }
        if (!result.list.length || seen.has(next)) throw new Error('Invalid options pagination');
        seen.add(next); cursor = next;
      }
      throw new Error('Options universe page cap exceeded');
    });
  }
  private page<T extends { providerSymbol: string }>(rows: T[], query: OptionQuery, fetchedAt: number, stale: boolean, universeAt?: number) {
    const revision = `${this.epoch}:${fetchedAt}:${universeAt ?? fetchedAt}`;
    const filter = `${query.baseCoin ?? ''}:${query.expiry ?? ''}`;
    let offset = 0;
    if (query.cursor) {
      let c: any;
      try { c = JSON.parse(Buffer.from(query.cursor, 'base64url').toString()); } catch { throw new OptionsRequestError(400,'invalid_cursor'); }
      if (c?.revision !== revision || c?.filter !== filter) throw new OptionsRequestError(409,'snapshot_changed');
      if (!Number.isSafeInteger(c.offset) || c.offset < 0 || c.offset > rows.length) throw new OptionsRequestError(400,'invalid_cursor');
      offset = c.offset;
    }
    const end = offset + query.limit;
    return { provider:'bybit' as const, mode:'rest_snapshot' as const, executable:false as const, fetchedAt, stale, revision,
      total:rows.length, items:rows.slice(offset,end), nextCursor:end < rows.length ? Buffer.from(JSON.stringify({revision,filter,offset:end})).toString('base64url') : null };
  }
  async instruments(query: OptionQuery) {
    const data = await this.loadUniverse();
    return this.page(data.value.filter(i => (!query.baseCoin || i.baseAsset === query.baseCoin) && (!query.expiry || i.expiry === query.expiry)), query, data.fetchedAt, data.stale);
  }
  async quotes(query: OptionQuery) {
    if (!query.baseCoin) throw new OptionsRequestError(400,'baseCoin_required');
    const universe = await this.loadUniverse();
    const base = query.baseCoin;
    const contracts = universe.value.filter(i => i.baseAsset === base);
    if (!contracts.length) throw new OptionsRequestError(400,'unknown_baseCoin');
    const data = await this.tickers.fetch(base, async () => {
      const result = await this.rest.optionTickerBatch(base);
      if (result.eventAt === null || result.eventAt < (this.lastProviderAt.get(base) ?? 0)
        || result.eventAt > this.now() + 5_000 || this.now() - result.eventAt > 30_000) throw new Error('Options snapshot timestamp invalid');
      const known = new Set(contracts.map(i => i.providerSymbol));
      const rows = result.list.map(r => normalizeOptionTicker(r,result.eventAt)).filter((r): r is OptionTicker => !!r && known.has(r.providerSymbol));
      if (!rows.length) throw new Error('Options quotes unavailable');
      this.lastProviderAt.set(base,result.eventAt);
      return [...new Map(rows.map(r => [r.providerSymbol,r])).values()].sort((a,b) => a.providerSymbol.localeCompare(b.providerSymbol));
    });
    const selected = new Set(contracts.filter(i => !query.expiry || i.expiry === query.expiry).map(i => i.providerSymbol));
    const stale = data.stale || universe.stale || data.value.some(i => i.providerEventAt === null || this.now()-i.providerEventAt > 5_000);
    return this.page(data.value.filter(i => selected.has(i.providerSymbol)), query, data.fetchedAt, stale, universe.fetchedAt);
  }
  diagnostics() { return { ...this.counts, mode:'rest_snapshot', globalSubscriptions:0, tickerCacheKeys:this.tickers.size, universeTtlMs:900_000, tickerTtlMs:5_000 }; }
}
