import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { KrakenMarketDataService } from './KrakenMarketDataService';
import { CfdMarketDataService } from './CfdMarketDataService';
import {
  ADMIN_PROFILE_HOLDINGS,
  PROFILE_START_DAY,
  adminPerformanceSeries,
  hasAdminPortfolioProfile,
} from './AdminPortfolioProfile';
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
 * Two things are deliberately kept apart in here.
 *
 * The *ledger* — Balance and FuturesBalance — is what the account can spend,
 * trade, margin and withdraw. Nothing in this file writes to it, and every
 * other part of the exchange keeps reading it directly.
 *
 * The *presentation* holdings, which exist for exactly one operator account
 * (see AdminPortfolioProfile), are display-only. They are attached to the
 * response the Wallet page renders and to nothing else, and they are
 * reported separately from the real balances so no caller can mistake one
 * for the other.
 */

/** A quote for one asset, or an honest null when none is available. */
export type PriceMap = Map<string, number | null>;

/** Fiat and stable assets the exchange already treats as ~1 USD. */
const USD_PEGGED = new Set(['USDT', 'USDC', 'USD', 'DAI', 'TUSD']);

/**
 * How the presentation profile's total is shown split between the two
 * account views. PRESENTATION ONLY — see the header comment: these are
 * fractions of a display number, never balances. Nothing is written
 * anywhere, nothing becomes spendable, and the real ledger keeps deciding
 * every actual operation. They are fractions rather than fixed amounts so
 * the split tracks live prices: when the holdings revalue, so do both
 * figures, and they always still sum to the total.
 */
const PRESENTATION_SPOT_SHARE = 0.8;
const PRESENTATION_FUTURES_SHARE = 0.2;

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
   * Display-only holdings for the one account that has the profile, absent
   * for everyone else. Never spendable; see AdminPortfolioProfile.
   */
  presentation: {
    holdings: ValuedHolding[];
    totalValueUsd: number;
    startedOn: string;
  } | null;
  /**
   * What the Wallet page shows as the portfolio total, and how that total
   * splits across the two account views.
   *
   * For an ordinary account these are simply the real ledger's own numbers,
   * so the page keeps showing exactly what the account holds. For the one
   * presentation profile they are derived from the presentation total, which
   * is what keeps the header and the Spot/Futures figures under it telling
   * the same story instead of mixing a presentation total with real ledger
   * subtotals.
   *
   * Computed here, once, rather than in the frontend: the page renders these
   * verbatim and never needs to know which kind of account it is looking at.
   * `displaySpotUsd + displayFuturesUsd === displayTotalUsd` always holds.
   */
  displayTotalUsd: number;
  displaySpotUsd: number;
  displayFuturesUsd: number;
  btcPriceUsd: number | null;
}

export interface WalletPerformance {
  /** True when the figures come from the presentation profile. */
  periods: Record<PerformancePeriod, ReturnType<typeof computeAllPeriods>[PerformancePeriod]>;
  ageDays: number;
  /** Day the series begins, or null when there is no series at all. */
  startedOn: string | null;
}

/**
 * The three display figures, kept together so they cannot drift apart.
 *
 * An ordinary account shows its real ledger, untouched. The presentation
 * profile shows its presentation total split 80/20 — the futures share is
 * taken as the remainder rather than computed independently, so the two
 * always add back to exactly the total with no rounding gap.
 */
function displaySplit(
  total: number,
  ctx: { presentation: boolean; realSpotUsd: number; realFuturesUsd: number }
): { displayTotalUsd: number; displaySpotUsd: number; displayFuturesUsd: number } {
  if (!ctx.presentation) {
    return {
      displayTotalUsd: total,
      displaySpotUsd: ctx.realSpotUsd,
      displayFuturesUsd: ctx.realFuturesUsd,
    };
  }
  const spot = total * PRESENTATION_SPOT_SHARE;
  return { displayTotalUsd: total, displaySpotUsd: spot, displayFuturesUsd: total - spot };
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

    const profile = hasAdminPortfolioProfile(user);
    const assets = new Set<string>([
      ...spot.map((b) => b.asset),
      ...futures.map((b) => b.asset),
      'BTC',
    ]);
    if (profile) for (const h of ADMIN_PROFILE_HOLDINGS) assets.add(h.asset);

    const prices = await this.pricesFor([...assets]);

    const sum = (rows: { asset: string; available: unknown; locked: unknown }[]) =>
      rows.reduce((acc, b) => {
        const price = prices.get(b.asset.toUpperCase()) ?? null;
        if (price === null) return acc;
        const qty = new BigNumber(String(b.available)).plus(String(b.locked));
        return acc + qty.times(price).toNumber();
      }, 0);

    const spotValueUsd = sum(spot);
    const futuresValueUsd = sum(futures);
    const realTotal = spotValueUsd + futuresValueUsd;

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

    let presentation: WalletOverview['presentation'] = null;
    if (profile) {
      const holdings: ValuedHolding[] = ADMIN_PROFILE_HOLDINGS.map((h) => {
        const priceUsd = prices.get(h.asset.toUpperCase()) ?? null;
        return {
          asset: h.asset,
          quantity: h.quantity,
          priceUsd,
          valueUsd: WalletPortfolioService.valueOf(h.quantity, priceUsd),
        };
      });
      presentation = {
        holdings,
        totalValueUsd: holdings.reduce((acc, h) => acc + (h.valueUsd ?? 0), 0),
        startedOn: PROFILE_START_DAY,
      };
    }

    return {
      real: {
        spot: valued(spot),
        futures: valued(futures),
        spotValueUsd,
        futuresValueUsd,
        totalValueUsd: realTotal,
      },
      presentation,
      ...displaySplit(presentation ? presentation.totalValueUsd : realTotal, {
        presentation: Boolean(presentation),
        realSpotUsd: spotValueUsd,
        realFuturesUsd: futuresValueUsd,
      }),
      btcPriceUsd: prices.get('BTC') ?? null,
    };
  }

  /**
   * The account's canonical equity series, then every period measured off
   * it. One series, five windows — never five separate calculations.
   *
   * For a normal account the series is built from the stored daily
   * PortfolioSnapshot values with that day's external flows removed, so a
   * deposit raises the balance without registering as a gain. For the
   * profile account it is the generated series, run through exactly the
   * same period mathematics.
   */
  async performance(user: { id: string; role: string; email: string }, now = new Date()): Promise<WalletPerformance> {
    let series: PerformancePoint[];

    if (hasAdminPortfolioProfile(user)) {
      const overview = await this.overview(user);
      series = adminPerformanceSeries(overview.displayTotalUsd, now);
    } else {
      series = await this.realSeries(user.id, now);
    }

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
