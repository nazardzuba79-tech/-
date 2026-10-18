import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { KrakenMarketDataService } from './KrakenMarketDataService';
import { isTestAssetPairOrSymbol } from './testMarkets/testAssetConfig';
import { InsufficientWalletBalance, mutateSpotBalance } from './WalletMutation';

// Isolated decimal context: never change the arithmetic of other services.
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 80, ROUNDING_MODE: BigNumber.ROUND_DOWN });
const MAX_AGE = 15_000;
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
export interface ConversionPrices {
  read(): Promise<{ fetchedAt: number; values: Map<string, string> }>;
}

/** Same existing Kraken spot feed, not synthetic listings, CFD or display-only collectors.
 * Last-trade prices, not executable venue orders. Settlement is VOLTEX internal accounting.
 * Stablecoins use their actual USD ticker, never a fabricated 1:1 conversion rate.
 */
export class KrakenConversionPrices implements ConversionPrices {
  constructor(private market: Pick<KrakenMarketDataService, 'getTickersWithMeta'>, private now = Date.now) {}
  async read() {
    const feed = await this.market.getTickersWithMeta();
    if (feed.stale || !Number.isFinite(feed.fetchedAt) || feed.fetchedAt > this.now() || this.now() - feed.fetchedAt > MAX_AGE) {
      throw new ConversionError('PRICE_UNAVAILABLE');
    }
    const values = new Map<string, string>([['USD', '1']]);
    for (const ticker of feed.value) {
      const [base, quote] = ticker.pair.split('/');
      if (!validPrice(ticker.lastPrice)) continue;
      const price = new Decimal(ticker.lastPrice);
      if (quote === 'USD' && /^[A-Z0-9]{2,16}$/.test(base) && !isTestAssetPairOrSymbol(base)) values.set(base, price.toFixed());
      if (base === 'USD' && FIAT.has(quote)) values.set(quote, new Decimal(1).div(price).toFixed());
    }
    return { fetchedAt: feed.fetchedAt, values };
  }
}

export interface ConversionQuote {
  quoteId: string; fromAsset: string; toAsset: string; fromAmount: string; toAmount: string;
  fromPriceUsd: string; toPriceUsd: string; fee: '0'; source: 'kraken'; fetchedAt: number; expiresAt: number;
}
export interface ConversionReceipt extends ConversionQuote { status: 'APPLIED'; operationId: string; createdAt: string }

export class WalletConversionService {
  constructor(private prisma: PrismaClient, private prices: ConversionPrices, private now = Date.now) {}
  private fresh(feed: { fetchedAt: number }) {
    if (!Number.isFinite(feed.fetchedAt) || feed.fetchedAt > this.now() || this.now() - feed.fetchedAt > MAX_AGE) throw new ConversionError('PRICE_UNAVAILABLE');
  }
  async assets(userId: string) {
    const feed = await this.prices.read(); this.fresh(feed);
    const balances = await this.prisma.balance.findMany({ where: { userId }, select: { asset: true, available: true } });
    return [...feed.values.keys()].filter(asset => ASSET.test(asset) && !isTestAssetPairOrSymbol(asset) && validPrice(feed.values.get(asset))).sort().map(asset => ({ asset, kind: FIAT.has(asset) ? 'fiat' : 'crypto',
      available: balances.find(b => b.asset === asset)?.available.toString() ?? '0' }));
  }
  async quote(userId: string, fromAsset: string, toAsset: string, amount: string): Promise<ConversionQuote> {
    if (!ASSET.test(fromAsset) || !ASSET.test(toAsset) || fromAsset === toAsset || !AMOUNT.test(amount) || !new Decimal(amount).isGreaterThan(0)) throw new ConversionError('INVALID_CONVERSION');
    if (isTestAssetPairOrSymbol(fromAsset) || isTestAssetPairOrSymbol(toAsset)) throw new ConversionError('UNSUPPORTED_ASSET');
    const feed = await this.prices.read(); this.fresh(feed);
    const fromPriceUsd = feed.values.get(fromAsset), toPriceUsd = feed.values.get(toAsset);
    if (!fromPriceUsd || !toPriceUsd) throw new ConversionError('UNSUPPORTED_ASSET');
    if (!validPrice(fromPriceUsd) || !validPrice(toPriceUsd)) throw new ConversionError('PRICE_UNAVAILABLE');
    const fromPrice = new Decimal(fromPriceUsd), toPrice = new Decimal(toPriceUsd);
    const fromAmount = new Decimal(amount).toFixed();
    const toAmount = new Decimal(fromAmount).times(fromPrice).div(toPrice).decimalPlaces(18, Decimal.ROUND_DOWN).toFixed();
    if (!AMOUNT.test(toAmount) || !new Decimal(toAmount).isGreaterThan(0)) throw new ConversionError('INVALID_CONVERSION');
    const balance = await this.prisma.balance.findUnique({ where: { userId_asset: { userId, asset: fromAsset } } });
    if (!balance || new Decimal(balance.available.toString()).lt(fromAmount)) throw new ConversionError('INSUFFICIENT_BALANCE');
    const quote: ConversionQuote = { quoteId: randomUUID(), fromAsset, toAsset, fromAmount, toAmount,
      fromPriceUsd, toPriceUsd, fee: '0', source: 'kraken', fetchedAt: feed.fetchedAt, expiresAt: feed.fetchedAt + MAX_AGE };
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
    let feed: Awaited<ReturnType<ConversionPrices['read']>> | undefined;
    let feedError: unknown;
    try { feed = await this.prices.read(); } catch (error) { feedError = error; }
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-conversion:${userId}`}, 0))`;
      const previous = await tx.auditLog.findFirst({ where: { id: `conversion:${quoteId}`, userId, action: 'WALLET_CONVERTED' } });
      if (previous) return this.receipt(previous);
      if (this.now() >= quote.expiresAt) throw new ConversionError('QUOTE_EXPIRED');
      if (!feed) throw feedError || new ConversionError('PRICE_UNAVAILABLE');
      this.fresh(feed);
      if (feed.values.get(quote.fromAsset) !== quote.fromPriceUsd || feed.values.get(quote.toAsset) !== quote.toPriceUsd) throw new ConversionError('QUOTE_CHANGED');
      if (isTestAssetPairOrSymbol(quote.fromAsset) || isTestAssetPairOrSymbol(quote.toAsset)) throw new ConversionError('UNSUPPORTED_ASSET');
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
