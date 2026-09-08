import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { MarkPriceService } from '../futures/MarkPriceService';
import { FuturesMarketRegistry } from '../futures/FuturesMarketRegistry';
import { FUNDING_INTERVAL_HOURS } from '../config/futuresConfig';
import { msUntilNextFundingBoundary } from '../futures/FundingRateService';
import { MarketDataGateway } from './marketData/MarketDataGateway';
import { providerHealthRegistry, type ProviderHealthSnapshot } from './marketData/ProviderHealth';
import { available, unavailable, type Availability, type Unavailable } from './marketData/types';

/**
 * The data behind /analytics.
 *
 * Two rules shape every line of this file.
 *
 * **1. It orchestrates; it does not fetch.** Market-wide figures and
 * sentiment come from `MarketDataGateway`, which owns the providers, the
 * caches, the circuits and the freshness metadata. Analytics adds no
 * CoinGecko client, no Fear & Greed client and no polling of its own — a
 * user opening this page costs the same upstream requests as one already
 * on the Markets page, because it is literally the same cached read.
 *
 * **2. A number is either real or absent.** Every section is
 * `Availability<T>`: `available: true` with a value, a `source` and a
 * `fetchedAt`, or `available: false` with a reason and *no value-carrying
 * fields at all*. There is no `?? 0` in this file. A provider outage
 * cannot reach a chart as a zero because there is no zero to reach it
 * with — and a genuine zero (an untraded contract's open interest) stays
 * a genuine zero.
 *
 * ── The boundary that matters most ──────────────────────────────────
 *
 * `derivatives` is **VOLTEX's own book**, and it says so in the payload:
 * `scope: 'venue'`, `source: 'voltex'`. Open interest is this exchange's
 * open positions. Funding is this exchange's settled `FundingRateRecord`.
 * Mark price is what the futures engine prices PnL and liquidation off.
 *
 * None of it is market-wide, and none of it may ever be presented as
 * Binance's, Bybit's or OKX's. The inverse holds too: no external venue's
 * derivatives metric may stand in for these. `UNSUPPORTED` below is where
 * cross-venue metrics live, and they live there precisely because no
 * legitimate source for them is configured.
 *
 * ── Access ──────────────────────────────────────────────────────────
 *
 * `getSnapshot()` is ordinary exchange market information: safe for any
 * signed-in user, and it deliberately carries no operational detail.
 * Provider circuit state, cooldowns and rate-limit counters live in
 * `getDiagnostics()`, which the route gates to admins.
 */

export interface MarketOverviewValue {
  totalMarketCapUsd: number;
  totalVolume24hUsd: number;
  btcDominancePercent: number | null;
  ethDominancePercent: number | null;
  marketCapChangePercent24h: number | null;
}

export interface SentimentValue {
  value: number;
  classification: string;
  updatedAt: number;
}

/**
 * One listed contract. Every field is independently nullable: a contract
 * that has never settled funding has `fundingRate: null`, which the UI
 * renders as a dash. It does NOT have `fundingRate: 0`, which would read
 * as "funding is flat" — a different and false claim.
 */
export interface DerivativeContract {
  symbol: string;
  markPrice: string | null;
  indexPrice: string | null;
  /** This venue's open positions, in base units. A real 0 is a real 0. */
  openInterestBase: string | null;
  /** Null when there is no mark price to value the position in USD. */
  openInterestUsd: string | null;
  fundingRate: string | null;
  fundingAppliedAt: number | null;
}

export interface DerivativesValue {
  /** Never market-wide. This exchange's own book, and labelled as such. */
  scope: 'venue';
  intervalHours: number;
  nextSettlementAt: number;
  contracts: DerivativeContract[];
}

/**
 * Analytics modules with no legitimate source in this system.
 *
 * Each is a designed, laid-out slot in the UI that renders a compact
 * "no source connected" state. None of them can render a number, because
 * the payload gives them nothing to render — that is the whole point of
 * listing them here rather than omitting them: the gap is visible in the
 * API instead of being quietly filled with something plausible.
 */
const UNSUPPORTED: Record<string, string> = {
  liquidations:
    'No cross-venue liquidation feed is configured. This venue records its own liquidations only.',
  liquidationHeatmap:
    'A liquidation heatmap needs cross-venue liquidation observations; no provider supplies them.',
  marketWideOpenInterest:
    "Cross-venue open interest requires a derivatives aggregator; only this venue's own open interest is available.",
  longShortRatio:
    'Long/short ratio requires per-venue account positioning data that no configured provider exposes.',
  etfFlows: 'ETF creation/redemption flows require a dedicated data vendor; none is configured.',
  exchangeFlows: 'Exchange inflow/outflow requires on-chain attribution data; no provider is configured.',
  whaleActivity: 'Whale tracking requires labelled on-chain address data; no provider is configured.',
  volatility: 'Realized/implied volatility needs a historical series this system does not yet retain.',
  futuresBasis: 'Basis and term structure need dated futures quotes; this venue lists perpetuals only.',
  correlations: 'Cross-market correlation needs equity and commodity series from a vendor; none is configured.',
  sectorRotation: 'Sector performance needs a sector-classified index series; no provider is configured.',
};

export type UnsupportedModule = keyof typeof UNSUPPORTED;

export interface AnalyticsSnapshot {
  generatedAt: number;
  /** Contracts this exchange actually lists. The UI's asset selector is
   *  built from this, never from a hardcoded list — an asset VOLTEX does
   *  not carry must not be offered as a choice. */
  contracts: string[];
  sections: {
    marketOverview: Availability<MarketOverviewValue>;
    sentiment: Availability<SentimentValue>;
    derivatives: Availability<DerivativesValue>;
  };
  /** Designed-but-unsourced modules, each value-free. */
  unsupported: Record<string, Unavailable>;
}

/** Operational detail. Admin-only — see the route. */
export interface AnalyticsDiagnostics {
  providers: ProviderHealthSnapshot[];
}

export class AnalyticsDataService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: MarketDataGateway,
    private readonly markPriceService: MarkPriceService,
    private readonly marketRegistry: FuturesMarketRegistry
  ) {}

  /**
   * One snapshot. Sections are gathered independently, so one provider
   * being down degrades exactly one section rather than failing the page.
   */
  async getSnapshot(): Promise<AnalyticsSnapshot> {
    const contracts = this.marketRegistry.list();
    const [marketOverview, sentiment, derivatives] = await Promise.all([
      // Straight through the gateway: same cache, same circuit, same
      // freshness metadata every other market surface reads.
      this.gateway.getMarketOverview(),
      this.gateway.getSentiment(),
      this.derivatives(contracts),
    ]);

    const unsupported: Record<string, Unavailable> = {};
    for (const key of Object.keys(UNSUPPORTED)) {
      unsupported[key] = unavailable('unsupported_metric', UNSUPPORTED[key]);
    }

    return { generatedAt: Date.now(), contracts, sections: { marketOverview, sentiment, derivatives }, unsupported };
  }

  /** Provider circuit state, cooldowns and rate-limit counters. Says
   *  whether a section is missing because a provider is down rather than
   *  because the metric does not exist. Never part of the user payload. */
  getDiagnostics(): AnalyticsDiagnostics {
    return { providers: providerHealthRegistry.snapshot() };
  }

  /**
   * This venue's own derivatives state, per listed contract.
   *
   * Deliberately not routed through the gateway: the gateway serves
   * REFERENCE market data about the outside world, and these are VOLTEX
   * financial values read from the futures services and this exchange's
   * own tables. Keeping them on separate paths is what stops an external
   * venue's number ever standing in for one of ours.
   */
  private async derivatives(symbols: string[]): Promise<Availability<DerivativesValue>> {
    if (symbols.length === 0) {
      return unavailable('no_data', 'No perpetual contracts are listed.');
    }
    try {
      const contracts = await Promise.all(symbols.map((symbol) => this.contract(symbol)));
      // Every field of every contract being null means there is genuinely
      // nothing to show — an empty table would be indistinguishable from a
      // working one with no rows.
      const anyData = contracts.some(
        (c) => c.markPrice !== null || c.openInterestBase !== null || c.fundingRate !== null
      );
      if (!anyData) {
        return unavailable('no_data', 'No mark price, open interest or settled funding is available yet.');
      }
      return available({
        value: { scope: 'venue', intervalHours: FUNDING_INTERVAL_HOURS, nextSettlementAt: Date.now() + msUntilNextFundingBoundary(), contracts },
        source: 'voltex',
        fetchedAt: Date.now(),
        stale: false,
      });
    } catch {
      return unavailable('no_data', 'Contract data could not be read.');
    }
  }

  private async contract(symbol: string): Promise<DerivativeContract> {
    // Each read is independent and each failure is local: a missing mark
    // price must not erase a real open-interest figure, and vice versa.
    const [markPrice, indexPrice, openInterest, funding] = await Promise.all([
      this.markPriceService.getMarkPrice(symbol).catch(() => null),
      this.markPriceService.getIndexPrice(symbol).catch(() => null),
      this.openInterestFor(symbol),
      this.fundingFor(symbol),
    ]);

    return {
      symbol,
      markPrice: markPrice ? markPrice.toString() : null,
      indexPrice: indexPrice ? indexPrice.toString() : null,
      openInterestBase: openInterest ? openInterest.toString() : null,
      // Null, never a stand-in, when there is no mark price to value it.
      openInterestUsd: openInterest && markPrice ? openInterest.times(markPrice).toString() : null,
      fundingRate: funding ? funding.rate : null,
      fundingAppliedAt: funding ? funding.appliedAt : null,
    };
  }

  /** This venue's open positions. Returns a real BigNumber zero for a
   *  listed-but-untraded contract, and `null` only when the read itself
   *  failed — the two must not collapse into the same answer. */
  private async openInterestFor(symbol: string): Promise<BigNumber | null> {
    try {
      const aggregate = await this.prisma.futuresPosition.aggregate({
        where: { symbol, status: 'OPEN' },
        _sum: { size: true },
      });
      return new BigNumber(aggregate._sum.size?.toString() ?? '0');
    } catch {
      return null;
    }
  }

  /** The most recent SETTLED interval. A contract that has never settled
   *  contributes nothing rather than a zero rate. */
  private async fundingFor(symbol: string): Promise<{ rate: string; appliedAt: number } | null> {
    try {
      const record = await this.prisma.fundingRateRecord.findFirst({
        where: { symbol },
        orderBy: { appliedAt: 'desc' },
      });
      return record ? { rate: record.rate.toString(), appliedAt: record.appliedAt.getTime() } : null;
    } catch {
      return null;
    }
  }
}
