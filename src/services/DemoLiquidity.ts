import BigNumber from 'bignumber.js';
import { v5 as uuidv5 } from 'uuid';
import { isTestAssetPairOrSymbol } from './testMarkets/testAssetConfig';

/**
 * Internal demo liquidity (Issue #592, CTO review 6361475787): one designated
 * account's already-credited DemoBalance answers demo Spot takers at the
 * current server-owned market reference plus a spread, so a MARKET order (or a
 * crossing LIMIT) has a counterparty on an otherwise empty demo book.
 *
 * Nothing is created or emitted. The counterparty is a DemoBalance an admin
 * credited through demo top-up; a fill moves value between two demo accounts
 * (conservation holds exactly, the demo ledger has no fees) and never touches
 * Balance, an external venue, a transfer or a withdrawal. A quote exists only
 * inside one demo book transaction — it never rests, so it can never be filled
 * at a price that has since gone stale — and is sized by the account's
 * available funds and a per-order cap. With a missing, stale, crossed or too
 * wide reference there is no quote (fail closed): the order meets only the
 * resting demo book, exactly as without this module.
 *
 * OFF unless DEMO_LIQUIDITY_ENABLED=true and the whole configuration parses;
 * a malformed value keeps it off rather than partially enabling a typo.
 */
export interface DemoLiquidityConfig {
  /** The account whose DemoBalance backs every quote. */
  accountId: string;
  /** Pairs it quotes (each must also be listed by the real market feed). */
  pairs: ReadonlySet<string>;
  /** Added to the reference ask / taken off the reference bid, in basis points. */
  spreadBps: number;
  /** Largest value one taker order can trade with it, in the quote asset. */
  maxOrderQuote: BigNumber;
  /** Oldest reference it quotes from. */
  maxQuoteAgeMs: number;
  /** Widest reference bid/ask it quotes from, in basis points of the mid. */
  maxReferenceSpreadBps: number;
}

/** A server-owned market reference with the time it was actually fetched. */
export interface DemoReferenceQuote { bid: string; ask: string; fetchedAt: number; stale: boolean }
export type DemoReferenceSource = (pair: string) => Promise<DemoReferenceQuote | null>;
export interface DemoLiquidity { config: DemoLiquidityConfig; reference: DemoReferenceSource }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAIR = /^[A-Z0-9]+\/[A-Z0-9]+$/;
/** Quantities are rounded down to this many places, so a quote never exceeds its funds. */
export const LIQUIDITY_QUANTITY_DP = 8;
/** Quote prices keep this many significant digits, rounded away from the taker. */
export const LIQUIDITY_PRICE_SD = 8;

function integer(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return value >= min && value <= max ? value : null;
}

export function demoLiquidityConfig(env: NodeJS.ProcessEnv = process.env): { config: DemoLiquidityConfig | null; problem?: string } {
  if (env.DEMO_LIQUIDITY_ENABLED !== 'true') return { config: null };
  const off = (problem: string) => ({ config: null, problem });
  const accountId = env.DEMO_LIQUIDITY_ACCOUNT_ID?.trim() ?? '';
  if (!UUID.test(accountId)) return off('DEMO_LIQUIDITY_ACCOUNT_ID must be an account UUID');
  // A native Cross wallet is valued from DemoBalance; its funds must not double as inventory.
  const nativeIds = [env.PRIVATE_TRADING_OWNER_ID ?? '', ...(env.PRIVATE_TRADING_TEST_USER_IDS ?? '').split(',')].map(id => id.trim().toLowerCase());
  if (nativeIds.includes(accountId.toLowerCase())) return off('DEMO_LIQUIDITY_ACCOUNT_ID must not be a native trading account');
  const pairs = (env.DEMO_LIQUIDITY_PAIRS ?? '').split(',').map(pair => pair.trim().toUpperCase()).filter(Boolean);
  if (!pairs.length || pairs.length > 50) return off('DEMO_LIQUIDITY_PAIRS must list 1-50 pairs');
  const refused = pairs.find(pair => !PAIR.test(pair) || isTestAssetPairOrSymbol(pair) || pair.split('/').includes('VTA'));
  if (refused) return off(`DEMO_LIQUIDITY_PAIRS cannot include ${refused}`);
  const spreadBps = integer(env.DEMO_LIQUIDITY_SPREAD_BPS, 10, 1, 500);
  if (spreadBps === null) return off('DEMO_LIQUIDITY_SPREAD_BPS must be 1-500');
  const maxQuoteAgeMs = integer(env.DEMO_LIQUIDITY_MAX_QUOTE_AGE_MS, 10_000, 1_000, 60_000);
  if (maxQuoteAgeMs === null) return off('DEMO_LIQUIDITY_MAX_QUOTE_AGE_MS must be 1000-60000');
  const maxReferenceSpreadBps = integer(env.DEMO_LIQUIDITY_MAX_REFERENCE_SPREAD_BPS, 100, 1, 1000);
  if (maxReferenceSpreadBps === null) return off('DEMO_LIQUIDITY_MAX_REFERENCE_SPREAD_BPS must be 1-1000');
  const rawCap = env.DEMO_LIQUIDITY_MAX_ORDER_QUOTE?.trim() || '1000';
  const maxOrderQuote = /^\d+(\.\d+)?$/.test(rawCap) ? new BigNumber(rawCap) : new BigNumber(NaN);
  if (!maxOrderQuote.isFinite() || maxOrderQuote.lte(0) || maxOrderQuote.gt(1_000_000_000)) return off('DEMO_LIQUIDITY_MAX_ORDER_QUOTE must be a positive amount');
  return { config: { accountId, pairs: new Set(pairs), spreadBps, maxOrderQuote, maxQuoteAgeMs, maxReferenceSpreadBps } };
}

/** The order ID of the quote that answered one taker order: one per taker, so a replay never adds another. */
export const liquidityOrderId = (takerOrderId: string) => uuidv5(`voltex:demo-liquidity:${takerOrderId}`, uuidv5.URL);

export type ReferenceRefusal = 'MISSING' | 'STALE' | 'INVALID' | 'CROSSED' | 'TOO_WIDE';

/** Whether a reference may be quoted from now; never throws. */
export function checkReference(config: DemoLiquidityConfig, reference: DemoReferenceQuote | null, now = Date.now()):
  { ok: true; bid: BigNumber; ask: BigNumber; ageMs: number } | { ok: false; reason: ReferenceRefusal } {
  if (!reference) return { ok: false, reason: 'MISSING' };
  const ageMs = now - reference.fetchedAt;
  if (reference.stale || !Number.isFinite(ageMs) || ageMs > config.maxQuoteAgeMs || ageMs < -1_000) return { ok: false, reason: 'STALE' };
  const bid = new BigNumber(reference.bid), ask = new BigNumber(reference.ask);
  if (!bid.isFinite() || !ask.isFinite() || bid.lte(0) || ask.lte(0)) return { ok: false, reason: 'INVALID' };
  if (bid.gte(ask)) return { ok: false, reason: 'CROSSED' };
  if (ask.minus(bid).div(ask.plus(bid).div(2)).times(10_000).gt(config.maxReferenceSpreadBps)) return { ok: false, reason: 'TOO_WIDE' };
  return { ok: true, bid, ask, ageMs };
}

export interface LiquidityQuote {
  /** The liquidity account's side: SELL answers a BUY taker, BUY answers a SELL taker. */
  side: 'BUY' | 'SELL';
  price: BigNumber;
  quantity: BigNumber;
}

/**
 * The single quote the account offers one taker: the reference ask plus the
 * spread for a buyer (rounded up), the reference bid minus it for a seller
 * (rounded down), to 8 significant digits — never better than the market it
 * is priced from. Sized by
 * what the account holds available and by the per-order cap; null when either
 * leaves nothing or the reference may not be used.
 */
export function liquidityQuote(config: DemoLiquidityConfig, reference: DemoReferenceQuote | null, takerSide: 'BUY' | 'SELL',
  inventory: { base: BigNumber; quote: BigNumber }, now = Date.now()): LiquidityQuote | null {
  const checked = checkReference(config, reference, now);
  if (!checked.ok) return null;
  const spread = new BigNumber(config.spreadBps).div(10_000);
  if (takerSide === 'BUY') {
    const price = checked.ask.times(spread.plus(1)).precision(LIQUIDITY_PRICE_SD, BigNumber.ROUND_UP);
    const quantity = BigNumber.minimum(inventory.base, config.maxOrderQuote.div(price)).decimalPlaces(LIQUIDITY_QUANTITY_DP, BigNumber.ROUND_DOWN);
    return quantity.gt(0) ? { side: 'SELL', price, quantity } : null;
  }
  const price = checked.bid.times(new BigNumber(1).minus(spread)).precision(LIQUIDITY_PRICE_SD, BigNumber.ROUND_DOWN);
  if (!price.gt(0)) return null;
  const quantity = BigNumber.minimum(inventory.quote, config.maxOrderQuote).div(price).decimalPlaces(LIQUIDITY_QUANTITY_DP, BigNumber.ROUND_DOWN);
  return quantity.gt(0) ? { side: 'BUY', price, quantity } : null;
}

/** The reference from the market-data cache: bid/ask with the time the provider actually answered. */
export const marketReference = (marketData: { getTickerWithMeta(pair: string): Promise<{ value: { bidPrice: string; askPrice: string } | null; fetchedAt: number; stale: boolean }> }): DemoReferenceSource =>
  async pair => {
    const cached = await marketData.getTickerWithMeta(pair);
    return cached.value ? { bid: cached.value.bidPrice, ask: cached.value.askPrice, fetchedAt: cached.fetchedAt, stale: cached.stale } : null;
  };
