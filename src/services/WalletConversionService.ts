import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { KrakenMarketDataService } from './KrakenMarketDataService';
import { isTestAssetPairOrSymbol } from './testMarkets/testAssetConfig';
import { InsufficientWalletBalance, mutateSpotBalance } from './WalletMutation';

// Isolated decimal context: never change the arithmetic of other services.
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 80, ROUNDING_MODE: BigNumber.ROUND_DOWN });
const MAX_AGE = 15_000;
// A book wider than this, or crossed (bid above ask), is not a market to price a conversion on.
const MAX_SPREAD = new Decimal('1.02');
const FIAT = new Set(['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD']);
const AMOUNT = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const ASSET = /^[A-Z0-9]{2,16}$/;
function validPrice(value: string | undefined): value is string {
  if (!value || value.length > 120 || !/^\d+(?:\.\d+)?$/.test(value)) return false;
  const price = new Decimal(value);
  return price.isFinite() && price.gt(0) && price.gte('0.000000000000000001') && price.lt('1000000000000000000');
}
export class ConversionError extends Error {
  constructor(readonly code: string) { super(code); }
}

/**
 * Server-side admission: the ONLY assets a conversion may debit or credit, each
 * with the decimal places the wallet keeps for it. Amounts with more decimals
 * than the source allows are refused; the result is rounded DOWN once to the
 * destination's places (never up, so rounding can only favour the ledger).
 * A Kraken quote alone does not make an asset convertible: the feed lists
 * hundreds of instruments the wallet does not support.
 * Override with WALLET_CONVERSION_ASSETS="ASSET:places,…" (2–40 entries).
 */
export const DEFAULT_CONVERSION_ASSETS = 'USD:2,EUR:2,USDT:6,USDC:6,BTC:8,ETH:18';
export function parseConversionAssets(raw: string): Map<string, number> | null {
  const out = new Map<string, number>();
  for (const part of raw.split(',').map(item => item.trim()).filter(Boolean)) {
    const match = /^([A-Z0-9]{2,16}):(\d{1,2})$/.exec(part);
    if (!match || Number(match[2]) > 18 || out.has(match[1]) || isTestAssetPairOrSymbol(match[1])) return null;
    out.set(match[1], Number(match[2]));
  }
  return out.size >= 2 && out.size <= 40 ? out : null;
}

/** Both switches must be on, and the asset list valid, for the conversion routes to exist. */
export function walletConversionConfig(env: NodeJS.ProcessEnv): { enabled: boolean; assets: Map<string, number>; problem?: string } {
  const assets = parseConversionAssets(env.WALLET_CONVERSION_ASSETS ?? DEFAULT_CONVERSION_ASSETS);
  if (!assets) return { enabled: false, assets: new Map(), problem: 'WALLET_CONVERSION_ASSETS is invalid; conversion stays off' };
  return { enabled: env.WALLET_CONVERSION_ENABLED === 'true', assets };
}
/** USD per unit of each asset: `bid` is what the market pays for it, `ask` what it costs. USD is 1 / 1. */
export interface ConversionFeed { fetchedAt: number; bid: Map<string, string>; ask: Map<string, string> }
export interface ConversionPrices {
  read(): Promise<ConversionFeed>;
}

/** Same existing Kraken spot feed, not synthetic listings, CFD or display-only collectors.
 * Best bid and ask, not the last trade: a conversion SELLS the source at the market's bid and
 * BUYS the destination at its ask, so the 0% VOLTEX fee never removes the market spread and a
 * round trip can never return more than it started with. Settlement is VOLTEX internal accounting,
 * not a venue order. Stablecoins use their actual USD book, never a fabricated 1:1 rate.
 */
export class KrakenConversionPrices implements ConversionPrices {
  constructor(private market: Pick<KrakenMarketDataService, 'getTickersWithMeta'>, private now = Date.now) {}
  async read() {
    const feed = await this.market.getTickersWithMeta();
    if (feed.stale || !Number.isFinite(feed.fetchedAt) || feed.fetchedAt > this.now() || this.now() - feed.fetchedAt > MAX_AGE) {
      throw new ConversionError('PRICE_UNAVAILABLE');
    }
    const bid = new Map<string, string>([['USD', '1']]), ask = new Map<string, string>([['USD', '1']]);
    for (const ticker of feed.value) {
      const [base, quote] = ticker.pair.split('/');
      if (!validPrice(ticker.bidPrice) || !validPrice(ticker.askPrice)) continue;
      const b = new Decimal(ticker.bidPrice), a = new Decimal(ticker.askPrice);
      if (b.gt(a) || a.div(b).gt(MAX_SPREAD)) continue;
      if (quote === 'USD' && /^[A-Z0-9]{2,16}$/.test(base) && !isTestAssetPairOrSymbol(base)) { bid.set(base, b.toFixed()); ask.set(base, a.toFixed()); }
      // USD/JPY: selling JPY buys USD at the pair's ask, buying JPY sells USD at its bid.
      if (base === 'USD' && FIAT.has(quote)) { bid.set(quote, new Decimal(1).div(a).toFixed()); ask.set(quote, new Decimal(1).div(b).toFixed()); }
    }
    return { fetchedAt: feed.fetchedAt, bid, ask };
  }
}

/** `fromPriceUsd` is the market's bid for the source, `toPriceUsd` its ask for the destination (USD per unit). */
export interface ConversionQuote {
  quoteId: string; fromAsset: string; toAsset: string; fromAmount: string; toAmount: string;
  fromPriceUsd: string; toPriceUsd: string; fee: '0'; source: 'kraken'; pricing: 'bid-ask'; fetchedAt: number; expiresAt: number;
}
export interface ConversionReceipt extends ConversionQuote { status: 'APPLIED'; operationId: string; createdAt: string }

type Db = Pick<PrismaClient, 'user'> | Prisma.TransactionClient;

export class WalletConversionService {
  constructor(private prisma: PrismaClient, private prices: ConversionPrices, private now = Date.now,
    private admitted: Map<string, number> = parseConversionAssets(DEFAULT_CONVERSION_ASSETS)!) {}
  private fresh(feed: { fetchedAt: number }) {
    if (!Number.isFinite(feed.fetchedAt) || feed.fetchedAt > this.now() || this.now() - feed.fetchedAt > MAX_AGE) throw new ConversionError('PRICE_UNAVAILABLE');
  }
  private supported(asset: string) {
    return this.admitted.has(asset) && ASSET.test(asset) && !isTestAssetPairOrSymbol(asset);
  }
  /** An admin block (User.blockedAt) stops conversions at once, also for sessions issued before it. */
  private async notBlocked(db: Db, userId: string) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { blockedAt: true } });
    if (!user || user.blockedAt) throw new ConversionError('ACCOUNT_BLOCKED');
  }
  async assets(userId: string) {
    const feed = await this.prices.read(); this.fresh(feed);
    const balances = await this.prisma.balance.findMany({ where: { userId }, select: { asset: true, available: true } });
    return [...feed.bid.keys()].filter(asset => this.supported(asset) && validPrice(feed.bid.get(asset)) && validPrice(feed.ask.get(asset))).sort().map(asset => ({ asset, kind: FIAT.has(asset) ? 'fiat' : 'crypto',
      scale: this.admitted.get(asset)!, available: balances.find(b => b.asset === asset)?.available.toString() ?? '0' }));
  }
  async quote(userId: string, fromAsset: string, toAsset: string, amount: string): Promise<ConversionQuote> {
    if (!ASSET.test(fromAsset) || !ASSET.test(toAsset) || fromAsset === toAsset || !AMOUNT.test(amount) || !new Decimal(amount).isGreaterThan(0)) throw new ConversionError('INVALID_CONVERSION');
    if (!this.supported(fromAsset) || !this.supported(toAsset)) throw new ConversionError('UNSUPPORTED_ASSET');
    // More decimals than the source keeps (e.g. 0.001 USD, 9 BTC decimals) is not an amount of that asset.
    if (new Decimal(amount).decimalPlaces()! > this.admitted.get(fromAsset)!) throw new ConversionError('INVALID_CONVERSION');
    await this.notBlocked(this.prisma, userId);
    const feed = await this.prices.read(); this.fresh(feed);
    const fromPriceUsd = feed.bid.get(fromAsset), toPriceUsd = feed.ask.get(toAsset);
    if (!fromPriceUsd || !toPriceUsd) throw new ConversionError('UNSUPPORTED_ASSET');
    if (!validPrice(fromPriceUsd) || !validPrice(toPriceUsd)) throw new ConversionError('PRICE_UNAVAILABLE');
    const fromPrice = new Decimal(fromPriceUsd), toPrice = new Decimal(toPriceUsd);
    const fromAmount = new Decimal(amount).toFixed();
    const toAmount = new Decimal(fromAmount).times(fromPrice).div(toPrice).decimalPlaces(this.admitted.get(toAsset)!, Decimal.ROUND_DOWN).toFixed();
    if (!AMOUNT.test(toAmount) || !new Decimal(toAmount).isGreaterThan(0)) throw new ConversionError('INVALID_CONVERSION');
    const balance = await this.prisma.balance.findUnique({ where: { userId_asset: { userId, asset: fromAsset } } });
    if (!balance || new Decimal(balance.available.toString()).lt(fromAmount)) throw new ConversionError('INSUFFICIENT_BALANCE');
    const quote: ConversionQuote = { quoteId: randomUUID(), fromAsset, toAsset, fromAmount, toAmount,
      fromPriceUsd, toPriceUsd, fee: '0', source: 'kraken', pricing: 'bid-ask', fetchedAt: feed.fetchedAt, expiresAt: feed.fetchedAt + MAX_AGE };
    // Quote is server-owned and binds user, intent and price. Does NOT reserve/debit money.
    await this.prisma.auditLog.create({ data: { id: quote.quoteId, userId, action: 'WALLET_CONVERSION_QUOTED', metadata: { ...quote } } });
    return quote;
  }
  private receipt(row: { id: string; createdAt: Date; metadata: Prisma.JsonValue }): ConversionReceipt {
    return { ...(row.metadata as unknown as ConversionQuote), status: 'APPLIED', operationId: row.id, createdAt: row.createdAt.toISOString() };
  }
  async status(userId: string, quoteId: string): Promise<ConversionReceipt | null> {
    const row = await this.prisma.auditLog.findFirst({ where: { id: `conversion:${quoteId}`, userId, action: 'WALLET_CONVERTED' } });
    return row ? this.receipt(row) : null;
  }
  async confirm(userId: string, quoteId: string): Promise<ConversionReceipt> {
    // Receipt first: a committed operation remains recoverable even if the provider is down.
    const applied = await this.status(userId, quoteId); if (applied) return applied;
    const record = await this.prisma.auditLog.findFirst({ where: { id: quoteId, userId, action: 'WALLET_CONVERSION_QUOTED' } });
    if (!record) throw new ConversionError('QUOTE_NOT_FOUND');
    const quote = record.metadata as unknown as ConversionQuote;
    // Fetch outside the transaction, but decide known rejection ONLY after the
    // receipt lock: a concurrent first attempt may still be committing.
    let feed: ConversionFeed | undefined;
    let feedError: unknown;
    try { feed = await this.prices.read(); } catch (error) { feedError = error; }
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-conversion:${userId}`}, 0))`;
      const previous = await tx.auditLog.findFirst({ where: { id: `conversion:${quoteId}`, userId, action: 'WALLET_CONVERTED' } });
      if (previous) return this.receipt(previous);
      if (this.now() >= quote.expiresAt) throw new ConversionError('QUOTE_EXPIRED');
      // Re-checked at execution: an admission list changed by a restart, a block set after the quote.
      if (!this.supported(quote.fromAsset) || !this.supported(quote.toAsset)) throw new ConversionError('UNSUPPORTED_ASSET');
      await this.notBlocked(tx, userId);
      if (!feed) throw feedError || new ConversionError('PRICE_UNAVAILABLE');
      this.fresh(feed);
      if (feed.bid.get(quote.fromAsset) !== quote.fromPriceUsd || feed.ask.get(quote.toAsset) !== quote.toPriceUsd) throw new ConversionError('QUOTE_CHANGED');
      try {
        await mutateSpotBalance(tx, userId, quote.fromAsset, { available: new BigNumber(quote.fromAmount).negated() });
        await mutateSpotBalance(tx, userId, quote.toAsset, { available: new BigNumber(quote.toAmount) });
      } catch (error) {
        if (error instanceof InsufficientWalletBalance) throw new ConversionError('INSUFFICIENT_BALANCE');
        throw error;
      }
      const receipt = await tx.auditLog.create({ data: { id: `conversion:${quoteId}`, userId, action: 'WALLET_CONVERTED', metadata: { ...quote } } });
      return this.receipt(receipt);
    }, { maxWait: 10_000, timeout: 20_000 });
  }
}
