import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { KrakenMarketDataService } from './KrakenMarketDataService';
import { CfdMarketDataService } from './CfdMarketDataService';
import {
  PerformancePeriod,
  PerformancePoint,
  RawEquityDay,
  buildAdjustedSeries,
  computeAllPeriods,
  seriesAgeDays,
  utcDayKey,
} from './PortfolioPerformanceEngine';

/**
 * What the Wallet page reads: a valuation of what an account holds, and the
 * performance of that value over time.
 *
 * ONE LEDGER, ONE ANSWER. Balance and FuturesBalance are what the account
 * can spend, trade, margin and withdraw, and they are the only thing this
 * file reports. There used to be a second, display-only set of holdings
 * written into the source for one operator account; it is gone, because a
 * balance that lives in code is a balance that disagrees with the ledger
 * the moment anything moves. Nothing here writes to the ledger, and every
 * other part of the exchange keeps reading it directly.
 *
 * The owner's simulation account is NOT served from here at all. Its
 * authoritative figures come from the native account model
 * (`crossAccount()`), which the Futures terminal already reads — see
 * `NativeDemoService.wallet()`. Two derivations of one equity are two
 * equities, so there is only one.
 */

/** A quote for one asset, or an honest null when none is available. */
export type PriceMap = Map<string, number | null>;

/** Fiat and stable assets the exchange already treats as ~1 USD. */
const USD_PEGGED = new Set(['USDT', 'USDC', 'USD', 'DAI', 'TUSD']);

/**
 * A real ledger balance, valued with the same quote the totals are summed
 * from. Carrying the price here is what keeps the Wallet's asset rows and
 * its portfolio total in agreement: one feed, one number, no chance of the
 * header saying $25,000 while the row underneath it says "-".
 */
export interface RealBalance {
  asset: string;
  available: string;
  locked: string;
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface ValuedHolding {
  asset: string;
  quantity: string;
  /** Null when no live quote exists — the UI shows "—", never a zero. */
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface WalletOverview {
  /** The real, spendable ledger. Always present, always authoritative. */
  real: {
    spot: RealBalance[];
    futures: RealBalance[];
    spotValueUsd: number;
    futuresValueUsd: number;
    totalValueUsd: number;
  };
  /**
   * False when the account holds an asset no quote could be obtained for.
   *
   * An unpriced holding is LEFT OUT of the totals above — it is never
   * summed as zero, because "we do not know what this is worth" and "this
   * is worth nothing" are different claims and only one of them is true.
   * The consequence is that an incomplete valuation is a FLOOR, not the
   * portfolio, and a caller that shows the total must show this too.
   */
  valuationComplete: boolean;
  /** The assets behind a `false` above, so the interface can name them. */
  unpricedAssets: string[];
  btcPriceUsd: number | null;
}

export interface WalletPerformance {
  /** True when the figures come from the presentation profile. */
  periods: Record<PerformancePeriod, ReturnType<typeof computeAllPeriods>[PerformancePeriod]>;
  ageDays: number;
  /** Day the series begins, or null when there is no series at all. */
  startedOn: string | null;
}

export class WalletPortfolioService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly marketData: KrakenMarketDataService,
    private readonly cfdData: CfdMarketDataService
  ) {}

  /**
   * Live USD quotes for a set of assets.
   *
   * Crypto comes from the exchange's own Kraken-mirrored ticker feed — the
   * same numbers the terminal trades on. Stables are pegged, following the
   * valuation the rest of the app already uses. EUR reuses the existing CFD
   * provider's EURUSD instrument rather than adding a market-data provider
   * for one currency; when that provider is not configured, EUR simply has
   * no price and the UI says so.
   */
  async pricesFor(assets: string[]): Promise<PriceMap> {
    const wanted = new Set(assets.map((a) => a.toUpperCase()));
    const out: PriceMap = new Map();

    let tickers: { pair: string; lastPrice: string }[] = [];
    try {
      tickers = await this.marketData.getTickers();
    } catch {
      // Upstream down: every crypto asset ends up null rather than zero.
    }
    const byBase = new Map<string, number>();
    for (const t of tickers) {
      const [base, quote] = t.pair.split('/');
      if (quote !== 'USDT') continue;
      const price = Number(t.lastPrice);
      if (Number.isFinite(price) && price > 0) byBase.set(base, price);
    }

    let eurUsd: number | null = null;
    if (wanted.has('EUR') && this.cfdData.isConfigured()) {
      try {
        const cfd = await this.cfdData.getTickers();
        const eur = cfd.find((c) => c.symbol === 'EURUSD');
        const parsed = eur ? Number(eur.price) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) eurUsd = parsed;
      } catch {
        eurUsd = null;
      }
    }

    for (const asset of wanted) {
      if (USD_PEGGED.has(asset)) out.set(asset, 1);
      else if (asset === 'EUR') out.set(asset, eurUsd);
      else out.set(asset, byBase.get(asset) ?? null);
    }
    return out;
  }

  private static valueOf(quantity: string, price: number | null): number | null {
    if (price === null) return null;
    const q = new BigNumber(quantity);
    if (!q.isFinite()) return null;
    return q.times(price).toNumber();
  }

  async overview(user: { id: string; role: string; email: string }): Promise<WalletOverview> {
    const [spot, futures] = await Promise.all([
      this.prisma.balance.findMany({ where: { userId: user.id } }),
      this.prisma.futuresBalance.findMany({ where: { userId: user.id } }),
    ]);

    const assets = new Set<string>([
      ...spot.map((b) => b.asset),
      ...futures.map((b) => b.asset),
      'BTC',
    ]);

    const prices = await this.pricesFor([...assets]);

    /**
     * An asset the account actually holds but nobody could price.
     *
     * Collected once across both wallets and reported on the response, so
     * the total above can be read for what it is. A zero quantity is not
     * an unknown — there is no value to miss — which is why it does not
     * land here.
     */
    const unpriced = new Set<string>();
    const noteUnpriced = (rows: { asset: string; available: unknown; locked: unknown }[]) => {
      for (const b of rows) {
        if (prices.get(b.asset.toUpperCase()) !== null && prices.get(b.asset.toUpperCase()) !== undefined) continue;
        if (new BigNumber(String(b.available)).plus(String(b.locked)).isGreaterThan(0)) unpriced.add(b.asset);
      }
    };
    noteUnpriced(spot);
    noteUnpriced(futures);

    // Unpriced rows are skipped rather than added as 0 — see
    // `valuationComplete`, which is what tells a reader that happened.
    const sum = (rows: { asset: string; available: unknown; locked: unknown }[]) =>
      rows.reduce((acc, b) => {
        const price = prices.get(b.asset.toUpperCase()) ?? null;
        if (price === null) return acc;
        const qty = new BigNumber(String(b.available)).plus(String(b.locked));
        return acc + qty.times(price).toNumber();
      }, 0);

    const spotValueUsd = sum(spot);
    const futuresValueUsd = sum(futures);

    const valued = (rows: { asset: string; available: unknown; locked: unknown }[]): RealBalance[] =>
      rows.map((b) => {
        const available = String(b.available);
        const locked = String(b.locked);
        const priceUsd = prices.get(b.asset.toUpperCase()) ?? null;
        const total = new BigNumber(available).plus(locked);
        return {
          asset: b.asset,
          available,
          locked,
          priceUsd,
          valueUsd: WalletPortfolioService.valueOf(total.toString(), priceUsd),
        };
      });

    return {
      real: {
        spot: valued(spot),
        futures: valued(futures),
        spotValueUsd,
        futuresValueUsd,
        totalValueUsd: spotValueUsd + futuresValueUsd,
      },
      valuationComplete: unpriced.size === 0,
      unpricedAssets: [...unpriced].sort(),
      btcPriceUsd: prices.get('BTC') ?? null,
    };
  }

  /**
   * The account's canonical equity series, then every period measured off
   * it. One series, five windows — never five separate calculations.
   *
   * The series is built from the stored daily PortfolioSnapshot values with
   * that day's external flows removed, so a deposit raises the balance
   * without registering as a gain. Every account is measured this way,
   * including the owner's: a generated curve used to stand in for one
   * account's history, and a generated return is not a return.
   */
  async performance(user: { id: string; role: string; email: string }, now = new Date()): Promise<WalletPerformance> {
    const series = await this.realSeries(user.id, now);
    return {
      periods: computeAllPeriods(series, now),
      ageDays: seriesAgeDays(series),
      startedOn: series.length > 0 ? series[0].date : null,
    };
  }

  /**
   * A real account's cash-flow-adjusted daily series.
   *
   * Snapshots give the raw daily total. Deposits and withdrawals give the
   * external flow that must be removed before a day counts as performance.
   * Internal Spot <-> Futures transfers are absent by construction: they
   * move value between two wallets the snapshot already spans, so they
   * never change the total and can never affect the return.
   *
   * Flows are valued at today's price for the asset, which is exact for the
   * stablecoins most deposits arrive in and an approximation otherwise —
   * this deployment stores no historical price series to value them at the
   * time they happened. Documented in docs/AI_HANDOFF.md.
   */
  private async realSeries(userId: string, now: Date): Promise<PerformancePoint[]> {
    const [snapshots, deposits, withdrawals] = await Promise.all([
      this.prisma.portfolioSnapshot.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.deposit.findMany({ where: { userId, status: 'CREDITED' } }),
      // Only money that has actually left: PENDING/APPROVED withdrawals are
      // still locked in the account, so they are not a flow out yet.
      this.prisma.withdrawal.findMany({ where: { userId, status: 'SENT' } }),
    ]);
    if (snapshots.length < 2) return [];

    const flowAssets = new Set<string>([
      ...deposits.map((d) => d.asset),
      ...withdrawals.map((w) => w.asset),
    ]);
    const prices = flowAssets.size > 0 ? await this.pricesFor([...flowAssets]) : new Map();

    const flowByDay = new Map<string, number>();
    const addFlow = (at: Date, asset: string, amount: unknown, sign: 1 | -1) => {
      const price = prices.get(asset.toUpperCase()) ?? null;
      if (price === null) return;
      const usd = new BigNumber(String(amount)).times(price).toNumber();
      if (!Number.isFinite(usd)) return;
      const key = utcDayKey(at);
      flowByDay.set(key, (flowByDay.get(key) ?? 0) + sign * usd);
    };
    for (const d of deposits) addFlow(d.createdAt, d.asset, d.amount, 1);
    for (const w of withdrawals) addFlow(w.createdAt, w.asset, w.amount, -1);

    const days: RawEquityDay[] = snapshots.map((s) => {
      const date = utcDayKey(s.createdAt);
      return {
        date,
        totalValueUsd: Number(s.totalValueUsd.toString()),
        netFlowUsd: flowByDay.get(date) ?? 0,
      };
    });

    return buildAdjustedSeries(days);
  }
}
