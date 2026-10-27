import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { KrakenMarketDataService } from './KrakenMarketDataService';
import { isTestAssetPairOrSymbol } from './testMarkets/testAssetConfig';
import { InsufficientWalletBalance, mutateSpotBalance } from './WalletMutation';
import { demoSpotEnabled, demoSpotLedger, demoWithdrawalGuardEnabled } from './demoSpotAccess';
import { demoLiquidityConfig, liquidityAccountRefusal } from './DemoLiquidity';
import { DEMO_SPOT_LEDGER } from './SpotBookTransaction';

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

/**
 * Financial limits (owner review, 2026-10-23). All fail closed:
 * - `maxUsd`: the largest single conversion, valued at the source's market bid;
 * - `dailyUsd`: one account's conversions in any rolling 24 hours, same valuation;
 * - `reserves`: per destination asset, the treasury inventory the operator has
 *   verified and set aside for conversions. A conversion may credit an asset only
 *   while the net amount conversions have created in it (credited minus debited,
 *   all accounts) stays within its reserve. No reserve configured = that asset is
 *   never credited (`RESERVE_UNVERIFIED`), so no unbacked obligation can arise.
 * The reserve figure is the operator's attestation of held funds, not a proof of them.
 */
export interface ConversionLimits { maxUsd: BigNumber; dailyUsd: BigNumber; reserves: Map<string, BigNumber> }
export const DEFAULT_CONVERSION_LIMITS: ConversionLimits = { maxUsd: new Decimal(1000), dailyUsd: new Decimal(5000), reserves: new Map() };
const LIMIT = /^(?:[1-9]\d{0,8})(?:\.\d{1,2})?$/;
export function parseConversionReserves(raw: string, admitted: Map<string, number>): Map<string, BigNumber> | null {
  const out = new Map<string, BigNumber>();
  for (const part of raw.split(',').map(item => item.trim()).filter(Boolean)) {
    const match = /^([A-Z0-9]{2,16}):((?:0|[1-9]\d{0,17})(?:\.\d{1,18})?)$/.exec(part);
    if (!match || out.has(match[1]) || !admitted.has(match[1])) return null;
    const amount = new Decimal(match[2]);
    if (!amount.gt(0) || amount.decimalPlaces()! > admitted.get(match[1])!) return null;
    out.set(match[1], amount);
  }
  return out;
}

/** Both switches must be on, and the asset list and limits valid, for the conversion routes to exist. */
export function walletConversionConfig(env: NodeJS.ProcessEnv): { enabled: boolean; assets: Map<string, number>; limits: ConversionLimits; problem?: string } {
  const off = (problem: string) => ({ enabled: false, assets: new Map<string, number>(), limits: DEFAULT_CONVERSION_LIMITS, problem });
  const assets = parseConversionAssets(env.WALLET_CONVERSION_ASSETS ?? DEFAULT_CONVERSION_ASSETS);
  if (!assets) return off('WALLET_CONVERSION_ASSETS is invalid; conversion stays off');
  const maxUsd = env.WALLET_CONVERSION_MAX_USD ?? '1000', dailyUsd = env.WALLET_CONVERSION_DAILY_USD ?? '5000';
  if (!LIMIT.test(maxUsd) || !LIMIT.test(dailyUsd) || new Decimal(maxUsd).gt(dailyUsd)) return off('WALLET_CONVERSION_MAX_USD / WALLET_CONVERSION_DAILY_USD are invalid; conversion stays off');
  const reserves = parseConversionReserves(env.WALLET_CONVERSION_RESERVES ?? '', assets);
  if (!reserves) return off('WALLET_CONVERSION_RESERVES is invalid; conversion stays off');
  return { enabled: env.WALLET_CONVERSION_ENABLED === 'true', assets, limits: { maxUsd: new Decimal(maxUsd), dailyUsd: new Decimal(dailyUsd), reserves } };
}
/** USD per unit of each asset: `bid` is what the market pays for it, `ask` what it costs. USD is 1 / 1. */
export interface ConversionFeed { fetchedAt: number; bid: Map<string, string>; ask: Map<string, string> }
export interface ConversionPrices {
  read(): Promise<ConversionFeed>;
  /**
   * How much of `asset` the market's book holds within `DEPTH_BAND` of its best
   * bid (`side` 'bid': what selling it can meet) or best ask ('ask': what buying it
   * can meet), in units of the asset; null when unknown or not fresh. USD needs none.
   */
  depth(asset: string, side: 'bid' | 'ask'): Promise<string | null>;
}
/** Book depth counted within 0.5 % of the touch: a conversion the market could not take near the quoted price is refused. */
export const DEPTH_BAND = new Decimal('0.005');

/** Same existing Kraken spot feed, not synthetic listings, CFD or display-only collectors.
 * Best bid and ask, not the last trade: a conversion SELLS the source at the market's bid and
 * BUYS the destination at its ask, so the 0% VOLTEX fee never removes the market spread and a
 * round trip can never return more than it started with. Settlement is VOLTEX internal accounting,
 * not a venue order. Stablecoins use their actual USD book, never a fabricated 1:1 rate.
 */
export class KrakenConversionPrices implements ConversionPrices {
  constructor(private market: Pick<KrakenMarketDataService, 'getTickersWithMeta' | 'getOrderBookWithMeta'>, private now = Date.now) {}
  /** Only direct ASSET/USD books: an inverse fiat pair (USD/JPY) has no depth here, so it fails closed. */
  async depth(asset: string, side: 'bid' | 'ask') {
    if (!ASSET.test(asset) || isTestAssetPairOrSymbol(asset)) return null;
    try {
      const book = await this.market.getOrderBookWithMeta(`${asset}/USD`, 50);
      if (book.stale || !Number.isFinite(book.fetchedAt) || book.fetchedAt > this.now() || this.now() - book.fetchedAt > MAX_AGE) return null;
      const levels = side === 'bid' ? book.value.bids : book.value.asks;
      if (!levels.length || !validPrice(levels[0].price)) return null;
      const touch = new Decimal(levels[0].price);
      const edge = side === 'bid' ? touch.times(new Decimal(1).minus(DEPTH_BAND)) : touch.times(new Decimal(1).plus(DEPTH_BAND));
      let total = new Decimal(0);
      for (const level of levels) {
        if (!validPrice(level.price) || !/^\d+(?:\.\d+)?$/.test(level.quantity)) return null;
        const price = new Decimal(level.price);
        if (side === 'bid' ? price.lt(edge) : price.gt(edge)) break;
        total = total.plus(level.quantity);
      }
      return total.toFixed();
    } catch { return null; }
  }
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

/**
 * Where a conversion settles: the same ledger the Spot terminal trades this account on (demoSpotLedger).
 * - 'spot': `Balance`, backed by the operator-verified reserves above.
 * - 'demo': `DemoBalance` only, as a swap with the Demo Liquidity account's already-credited DemoBalance
 *   (Issue #592). Both sides stay demo: nothing is minted, `Balance` is never read for funds or written,
 *   and value only moves between two demo accounts, so every asset's DemoBalance total is unchanged.
 *   Demo funds stay non-withdrawable: a demo ledger exists only while DEMO_SPOT_ENABLED is on, which
 *   forces the withdrawal guard on (demoWithdrawalGuardEnabled), and withdrawals hold `Balance` only.
 * An account with neither (no ordinary funds, not admitted to demo) stays on 'spot', where it holds nothing.
 */
export type ConversionLedger = 'spot' | 'demo';
/** Committed receipts, one action per ledger; the reserve exposure counts the 'spot' one only. */
const RECEIPT_ACTIONS = ['WALLET_CONVERTED', 'WALLET_DEMO_CONVERTED'];
/** Quotes stored before the demo ledger existed carry no `ledger`; they were Balance quotes. */
const ledgerOf = (quote: { ledger?: unknown }): ConversionLedger => quote.ledger === 'demo' ? 'demo' : 'spot';

/** `fromPriceUsd` is the market's bid for the source, `toPriceUsd` its ask for the destination (USD per unit). */
export interface ConversionQuote {
  quoteId: string; fromAsset: string; toAsset: string; fromAmount: string; toAmount: string;
  fromPriceUsd: string; toPriceUsd: string; fee: '0'; source: 'kraken'; pricing: 'bid-ask'; fetchedAt: number; expiresAt: number;
  ledger: ConversionLedger;
}
export interface ConversionReceipt extends ConversionQuote { status: 'APPLIED'; operationId: string; createdAt: string }

type Db = Pick<PrismaClient, 'user'> | Prisma.TransactionClient;
type Reader = PrismaClient | Prisma.TransactionClient;

export class WalletConversionService {
  constructor(private prisma: PrismaClient, private prices: ConversionPrices, private now = Date.now,
    private admitted: Map<string, number> = parseConversionAssets(DEFAULT_CONVERSION_ASSETS)!,
    private limits: ConversionLimits = DEFAULT_CONVERSION_LIMITS,
    /** Demo Spot, Demo Liquidity and withdrawal-guard settings, read on every call. */
    private env: NodeJS.ProcessEnv = process.env) {}
  /** The source valued at its market bid, in USD. */
  private usd(quote: Pick<ConversionQuote, 'fromAmount' | 'fromPriceUsd'>) { return new Decimal(quote.fromAmount).times(quote.fromPriceUsd); }
  /** Size and backing that do not depend on other conversions: the single limit, a configured reserve ('spot'), market depth. */
  private async admit(quote: Pick<ConversionQuote, 'fromAsset' | 'toAsset' | 'fromAmount' | 'toAmount' | 'fromPriceUsd' | 'ledger'>) {
    if (this.usd(quote).gt(this.limits.maxUsd)) throw new ConversionError('LIMIT_EXCEEDED');
    // A demo conversion is backed by the liquidity account's DemoBalance instead (demoBacking).
    if (quote.ledger === 'spot' && !this.limits.reserves.has(quote.toAsset)) throw new ConversionError('RESERVE_UNVERIFIED');
    for (const [asset, amount, side] of [[quote.fromAsset, quote.fromAmount, 'bid'], [quote.toAsset, quote.toAmount, 'ask']] as const) {
      if (asset === 'USD') continue;
      // A provider failure is unknown depth, never an unexpected error after the receipt check.
      const depth = await this.prices.depth(asset, side).catch(() => null);
      if (depth === null || new Decimal(depth).lt(amount)) throw new ConversionError('INSUFFICIENT_LIQUIDITY');
    }
  }
  private async ledger(db: Reader, userId: string): Promise<ConversionLedger> {
    return await demoSpotLedger(db, userId, demoSpotEnabled(this.env)) === 'demo' ? 'demo' : 'spot';
  }
  /**
   * The Demo Liquidity account that answers a demo conversion. None (fail closed) while Demo Liquidity is
   * off or misconfigured, while the withdrawal guard is off, for that account itself, or while it may not
   * back quotes (blocked, not a USER, a native trading account, holding ordinary Balance). Its per-order
   * cap applies on top of the conversion limits. `lockRows` inside the demo book transaction, as a demo fill.
   */
  private async demoBacking(db: Reader, userId: string, quote: Pick<ConversionQuote, 'fromAmount' | 'fromPriceUsd'>, lockRows: boolean) {
    const { config } = demoLiquidityConfig(this.env);
    if (!config || !demoWithdrawalGuardEnabled(this.env) || config.accountId.toLowerCase() === userId.toLowerCase()) throw new ConversionError('INSUFFICIENT_LIQUIDITY');
    if (this.usd(quote).gt(config.maxOrderQuote)) throw new ConversionError('LIMIT_EXCEEDED');
    if (await liquidityAccountRefusal(db, config.accountId, lockRows, this.env)) throw new ConversionError('INSUFFICIENT_LIQUIDITY');
    return config.accountId;
  }
  /**
   * Committed conversions of this account in the last 24 hours (both ledgers), valued as at their quotes. A typed
   * query, so the time window is compared exactly as Prisma wrote `createdAt` (no session time-zone dependence).
   */
  private async dailyUsed(db: Pick<Prisma.TransactionClient, 'auditLog'>, userId: string) {
    const rows = await db.auditLog.findMany({ where: { userId, action: { in: RECEIPT_ACTIONS }, createdAt: { gt: new Date(this.now() - 86_400_000) } }, select: { metadata: true } });
    return rows.reduce((sum, row) => sum.plus(this.usd(row.metadata as unknown as ConversionQuote)), new Decimal(0));
  }
  /** Net amount of `asset` all Balance conversions have created so far: credited minus debited. */
  private async exposure(db: Pick<Prisma.TransactionClient, '$queryRaw'>, asset: string) {
    const rows = await db.$queryRaw<{ value: string | null }[]>`SELECT (COALESCE(SUM(CASE WHEN metadata->>'toAsset' = ${asset} THEN (metadata->>'toAmount')::numeric END), 0)
      - COALESCE(SUM(CASE WHEN metadata->>'fromAsset' = ${asset} THEN (metadata->>'fromAmount')::numeric END), 0))::text AS value
      FROM "AuditLog" WHERE action = 'WALLET_CONVERTED'`;
    return new Decimal(rows[0]?.value ?? '0');
  }
  /** Daily limit, and for Balance the reserve, against everything already committed (authoritative only under the confirm locks). */
  private async withinTotals(db: Pick<Prisma.TransactionClient, 'auditLog' | '$queryRaw'>, userId: string, quote: ConversionQuote) {
    if ((await this.dailyUsed(db, userId)).plus(this.usd(quote)).gt(this.limits.dailyUsd)) throw new ConversionError('DAILY_LIMIT_EXCEEDED');
    if (quote.ledger === 'spot' && (await this.exposure(db, quote.toAsset)).plus(quote.toAmount).gt(this.limits.reserves.get(quote.toAsset)!)) throw new ConversionError('RESERVE_EXHAUSTED');
  }
  /** The provider's feed. Any provider failure is a definite PRICE_UNAVAILABLE refusal: nothing has been written. */
  private async feed() {
    try { return await this.prices.read(); }
    catch (error) { throw error instanceof ConversionError ? error : new ConversionError('PRICE_UNAVAILABLE'); }
  }
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
  /** Available funds of one ledger only: a demo account sees its DemoBalance, never Balance, and the reverse. */
  private async available(ledger: ConversionLedger, userId: string) {
    const where = { where: { userId }, select: { asset: true, available: true } };
    return ledger === 'demo' ? this.prisma.demoBalance.findMany(where) : this.prisma.balance.findMany(where);
  }
  async assets(userId: string) {
    const feed = await this.feed(); this.fresh(feed);
    const balances = await this.available(await this.ledger(this.prisma, userId), userId);
    return [...feed.bid.keys()].filter(asset => this.supported(asset) && validPrice(feed.bid.get(asset)) && validPrice(feed.ask.get(asset))).sort().map(asset => ({ asset, kind: FIAT.has(asset) ? 'fiat' : 'crypto',
      scale: this.admitted.get(asset)!, available: balances.find(b => b.asset === asset)?.available.toString() ?? '0' }));
  }
  async quote(userId: string, fromAsset: string, toAsset: string, amount: string): Promise<ConversionQuote> {
    if (!ASSET.test(fromAsset) || !ASSET.test(toAsset) || fromAsset === toAsset || !AMOUNT.test(amount) || !new Decimal(amount).isGreaterThan(0)) throw new ConversionError('INVALID_CONVERSION');
    if (!this.supported(fromAsset) || !this.supported(toAsset)) throw new ConversionError('UNSUPPORTED_ASSET');
    // More decimals than the source keeps (e.g. 0.001 USD, 9 BTC decimals) is not an amount of that asset.
    if (new Decimal(amount).decimalPlaces()! > this.admitted.get(fromAsset)!) throw new ConversionError('INVALID_CONVERSION');
    await this.notBlocked(this.prisma, userId);
    const feed = await this.feed(); this.fresh(feed);
    const fromPriceUsd = feed.bid.get(fromAsset), toPriceUsd = feed.ask.get(toAsset);
    if (!fromPriceUsd || !toPriceUsd) throw new ConversionError('UNSUPPORTED_ASSET');
    if (!validPrice(fromPriceUsd) || !validPrice(toPriceUsd)) throw new ConversionError('PRICE_UNAVAILABLE');
    const fromPrice = new Decimal(fromPriceUsd), toPrice = new Decimal(toPriceUsd);
    const fromAmount = new Decimal(amount).toFixed();
    const toAmount = new Decimal(fromAmount).times(fromPrice).div(toPrice).decimalPlaces(this.admitted.get(toAsset)!, Decimal.ROUND_DOWN).toFixed();
    if (!AMOUNT.test(toAmount) || !new Decimal(toAmount).isGreaterThan(0)) throw new ConversionError('INVALID_CONVERSION');
    const ledger = await this.ledger(this.prisma, userId);
    const key = { where: { userId_asset: { userId, asset: fromAsset } } };
    const balance = ledger === 'demo' ? await this.prisma.demoBalance.findUnique(key) : await this.prisma.balance.findUnique(key);
    if (!balance || new Decimal(balance.available.toString()).lt(fromAmount)) throw new ConversionError('INSUFFICIENT_BALANCE');
    const quote: ConversionQuote = { quoteId: randomUUID(), fromAsset, toAsset, fromAmount, toAmount,
      fromPriceUsd, toPriceUsd, fee: '0', source: 'kraken', pricing: 'bid-ask', fetchedAt: feed.fetchedAt, expiresAt: feed.fetchedAt + MAX_AGE, ledger };
    // Refuse early what cannot be confirmed; the confirm re-checks all of it under its locks.
    await this.admit(quote);
    if (ledger === 'demo') {
      const accountId = await this.demoBacking(this.prisma, userId, quote, false);
      const inventory = await this.prisma.demoBalance.findUnique({ where: { userId_asset: { userId: accountId, asset: toAsset } } });
      if (!inventory || new Decimal(inventory.available.toString()).lt(toAmount)) throw new ConversionError('INSUFFICIENT_LIQUIDITY');
    }
    await this.withinTotals(this.prisma, userId, quote);
    // Quote is server-owned and binds user, intent, price and ledger. Does NOT reserve/debit money.
    await this.prisma.auditLog.create({ data: { id: quote.quoteId, userId, action: 'WALLET_CONVERSION_QUOTED', metadata: { ...quote } } });
    return quote;
  }
  private receipt(row: { id: string; createdAt: Date; metadata: Prisma.JsonValue }): ConversionReceipt {
    const quote = row.metadata as unknown as ConversionQuote;
    return { ...quote, ledger: ledgerOf(quote), status: 'APPLIED', operationId: row.id, createdAt: row.createdAt.toISOString() };
  }
  async status(userId: string, quoteId: string): Promise<ConversionReceipt | null> {
    const row = await this.prisma.auditLog.findFirst({ where: { id: `conversion:${quoteId}`, userId, action: { in: RECEIPT_ACTIONS } } });
    return row ? this.receipt(row) : null;
  }
  async confirm(userId: string, quoteId: string): Promise<ConversionReceipt> {
    // Receipt first: a committed operation remains recoverable even if the provider is down.
    const applied = await this.status(userId, quoteId); if (applied) return applied;
    const record = await this.prisma.auditLog.findFirst({ where: { id: quoteId, userId, action: 'WALLET_CONVERSION_QUOTED' } });
    if (!record) throw new ConversionError('QUOTE_NOT_FOUND');
    const stored = record.metadata as unknown as ConversionQuote;
    const quote: ConversionQuote = { ...stored, ledger: ledgerOf(stored) };
    // Fetch outside the transaction, but decide known rejection ONLY after the
    // receipt lock: a concurrent first attempt may still be committing.
    let feed: ConversionFeed | undefined;
    let feedError: unknown;
    try { feed = await this.feed(); } catch (error) { feedError = error; }
    // Market depth is read outside the transaction too; a refusal is decided only after the receipt check.
    let admitError: unknown = null;
    try { await this.admit(quote); } catch (error) { admitError = error; }
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-conversion:${userId}`}, 0))`;
      const previous = await tx.auditLog.findFirst({ where: { id: `conversion:${quoteId}`, userId, action: { in: RECEIPT_ACTIONS } } });
      if (previous) return this.receipt(previous);
      // The final shared lock — over every account's Balance conversions (reserve check), or the demo book — is
      // taken BEFORE the checks below, so a quote that expires, a block or a ledger change set while this waits
      // for it cannot pass. Taken after the account lock, in this order everywhere, so the two cannot deadlock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${quote.ledger === 'demo' ? DEMO_SPOT_LEDGER.lock : 'wallet-conversion:reserves'}, 0))`;
      if (this.now() >= quote.expiresAt) throw new ConversionError('QUOTE_EXPIRED');
      // Re-checked at execution: an admission list changed by a restart, a block set after the quote.
      if (!this.supported(quote.fromAsset) || !this.supported(quote.toAsset)) throw new ConversionError('UNSUPPORTED_ASSET');
      await this.notBlocked(tx, userId);
      // An account funded with Balance, or admitted to demo, after its quote settles nothing on the other ledger.
      if (await this.ledger(tx, userId) !== quote.ledger) throw new ConversionError('QUOTE_CHANGED');
      if (!feed) throw feedError;
      this.fresh(feed);
      if (feed.bid.get(quote.fromAsset) !== quote.fromPriceUsd || feed.ask.get(quote.toAsset) !== quote.toPriceUsd) throw new ConversionError('QUOTE_CHANGED');
      if (admitError) throw admitError;
      if (quote.ledger === 'demo') return this.settleDemo(tx, userId, quoteId, quote);
      // Under the reserve lock taken above: the reserve check and this receipt commit together, so concurrent
      // conversions into one asset can never jointly exceed its reserve.
      await this.withinTotals(tx, userId, quote);
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
  /**
   * The demo swap, inside the confirm transaction, under the account lock and then the demo book lock (both taken
   * by confirm). The demo book lock serializes it with every demo Spot order and liquidity fill (nothing takes
   * these two locks in the reverse order). Each debit is conditional on committed available funds, so neither
   * account can go below zero; the user pays exactly what the liquidity account receives and the reverse, so no
   * DemoBalance total changes.
   */
  private async settleDemo(tx: Prisma.TransactionClient, userId: string, quoteId: string, quote: ConversionQuote) {
    await this.withinTotals(tx, userId, quote);
    const accountId = await this.demoBacking(tx, userId, quote, true);
    const take = async (owner: string, asset: string, amount: string) => (await tx.demoBalance.updateMany({
      where: { userId: owner, asset, available: { gte: amount } }, data: { available: { decrement: amount } } })).count === 1;
    const give = (owner: string, asset: string, amount: string) => tx.demoBalance.upsert({ where: { userId_asset: { userId: owner, asset } },
      create: { userId: owner, asset, available: amount }, update: { available: { increment: amount } } });
    if (!await take(userId, quote.fromAsset, quote.fromAmount)) throw new ConversionError('INSUFFICIENT_BALANCE');
    if (!await take(accountId, quote.toAsset, quote.toAmount)) throw new ConversionError('INSUFFICIENT_LIQUIDITY');
    await give(accountId, quote.fromAsset, quote.fromAmount);
    await give(userId, quote.toAsset, quote.toAmount);
    const receipt = await tx.auditLog.create({ data: { id: `conversion:${quoteId}`, userId, action: 'WALLET_DEMO_CONVERTED', metadata: { ...quote } } });
    return this.receipt(receipt);
  }
}
