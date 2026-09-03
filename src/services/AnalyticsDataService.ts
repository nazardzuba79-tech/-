import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { CoinGeckoService } from './CoinGeckoService';
import { FearGreedService } from './FearGreedService';
import { MarkPriceService } from '../futures/MarkPriceService';
import { FuturesMarketRegistry } from '../futures/FuturesMarketRegistry';
import { FUNDING_INTERVAL_HOURS } from '../config/futuresConfig';
import { msUntilNextFundingBoundary } from '../futures/FundingRateService';
import { providerHealthRegistry } from './marketData/ProviderHealth';

/**
 * The data foundation under /analytics — NOT the analytics UI.
 *
 * Every section this returns is either genuinely backed by a source this
 * exchange already has, or explicitly marked unavailable with a reason. The
 * point of the shape is that a future UI cannot accidentally render a
 * fabricated number: there is no field that carries a "0" standing in for
 * "we don't know". A section is either `available: true` with real values,
 * or `available: false` with a machine-readable reason and nothing else.
 *
 * What is real here, and where it comes from:
 *
 *   marketOverview — CoinGecko /global: total market cap, total 24h volume,
 *     BTC and ETH dominance, 24h market-cap change. The same call the
 *     Markets page headline already uses.
 *   sentiment      — alternative.me's published Fear & Greed Index.
 *   funding        — this exchange's OWN settled FundingRateRecord rows,
 *     plus the next settlement boundary derived from the real configured
 *     interval. Not a third-party funding feed.
 *   openInterest   — this exchange's OWN open positions, aggregated. An
 *     exchange is the only authoritative source for its own open interest;
 *     it is deliberately labelled as venue-scoped rather than market-wide.
 *   markPrices     — the real mark/index prices the futures engine prices
 *     PnL and liquidation off.
 *
 * What is deliberately NOT here, because no source in this system supports
 * it: liquidations and liquidation heatmaps, long/short ratio, market-wide
 * (cross-venue) open interest or funding, ETF flows, exchange
 * inflow/outflow, and whale activity. Each is reported as an explicitly
 * unsupported section with a reason, so the gap is visible in the API
 * instead of being quietly filled with a plausible number.
 */

export type UnavailableReason =
  | 'provider_unavailable'
  | 'provider_not_configured'
  | 'unsupported_metric'
  | 'no_data';

interface Unavailable {
  available: false;
  reason: UnavailableReason;
  /** Short, non-sensitive explanation — safe to show an operator. */
  detail?: string;
}

type Section<T> = ({ available: true } & T) | Unavailable;

export interface MarketOverviewSection {
  totalMarketCapUsd: number;
  totalVolume24hUsd: number;
  btcDominancePercent: number | null;
  ethDominancePercent: number | null;
  marketCapChangePercent24h: number | null;
  source: 'coingecko';
}

export interface SentimentSection {
  value: number;
  classification: string;
  updatedAt: number;
  source: 'alternative.me';
}

export interface FundingSection {
  intervalHours: number;
  nextSettlementAt: number;
  /** Latest settled rate per listed contract. A contract that has never
   *  settled is simply absent — never a zero. */
  latest: { symbol: string; rate: string; markPrice: string; indexPrice: string; appliedAt: number }[];
  source: 'voltex_futures';
}

export interface OpenInterestSection {
  /** Explicitly this venue's own book, not a market-wide figure. */
  scope: 'venue';
  contracts: { symbol: string; openInterestBase: string; openInterestUsd: string | null }[];
  source: 'voltex_futures';
}

export interface MarkPriceSection {
  contracts: { symbol: string; markPrice: string; indexPrice: string }[];
  source: 'voltex_futures';
}

export interface AnalyticsSnapshot {
  generatedAt: number;
  sections: {
    marketOverview: Section<MarketOverviewSection>;
    sentiment: Section<SentimentSection>;
    funding: Section<FundingSection>;
    openInterest: Section<OpenInterestSection>;
    markPrices: Section<MarkPriceSection>;
    liquidations: Unavailable;
    longShortRatio: Unavailable;
    marketWideOpenInterest: Unavailable;
    etfFlows: Unavailable;
    exchangeFlows: Unavailable;
    whaleActivity: Unavailable;
  };
  /** Operational state of the upstream providers. Admin-only, like the rest
   *  of this payload — it says whether a section is missing because a
   *  provider is down rather than because the metric doesn't exist. */
  providers: { provider: string; state: string; healthy: boolean; lastSuccessAt: number | null; rateLimitHits: number }[];
}

/** Metrics with no legitimate source in this system. Stated once, here, so
 *  the reason a section is empty is code rather than a comment. */
const UNSUPPORTED: Record<string, string> = {
  liquidations: 'No liquidation feed is available: this venue records its own liquidations only, and no cross-venue provider is configured.',
  longShortRatio: 'Long/short ratio requires per-venue account positioning data that no configured provider exposes.',
  marketWideOpenInterest: 'Cross-venue open interest requires a derivatives aggregator; only this venue\'s own open interest is available.',
  etfFlows: 'ETF creation/redemption flows require a dedicated data vendor; none is configured.',
  exchangeFlows: 'Exchange inflow/outflow requires on-chain attribution data; no provider is configured.',
  whaleActivity: 'Whale tracking requires labelled on-chain address data; no provider is configured.',
};

function unsupported(key: keyof typeof UNSUPPORTED): Unavailable {
  return { available: false, reason: 'unsupported_metric', detail: UNSUPPORTED[key] };
}

export class AnalyticsDataService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly coinGecko: CoinGeckoService,
    private readonly fearGreed: FearGreedService,
    private readonly markPriceService: MarkPriceService,
    private readonly marketRegistry: FuturesMarketRegistry
  ) {}

  /**
   * One snapshot of everything currently supported. Sections are gathered
   * independently — one provider being down degrades exactly one section
   * rather than failing the whole payload.
   */
  async getSnapshot(): Promise<AnalyticsSnapshot> {
    const symbols = this.marketRegistry.list();
    const [marketOverview, sentiment, funding, openInterest, markPrices] = await Promise.all([
      this.marketOverview(),
      this.sentiment(),
      this.funding(symbols),
      this.openInterest(symbols),
      this.markPrices(symbols),
    ]);

    return {
      generatedAt: Date.now(),
      sections: {
        marketOverview,
        sentiment,
        funding,
        openInterest,
        markPrices,
        liquidations: unsupported('liquidations'),
        longShortRatio: unsupported('longShortRatio'),
        marketWideOpenInterest: unsupported('marketWideOpenInterest'),
        etfFlows: unsupported('etfFlows'),
        exchangeFlows: unsupported('exchangeFlows'),
        whaleActivity: unsupported('whaleActivity'),
      },
      providers: providerHealthRegistry.snapshot().map((p) => ({
        provider: p.provider,
        state: p.state,
        healthy: p.healthy,
        lastSuccessAt: p.lastSuccessAt,
        rateLimitHits: p.rateLimitHits,
      })),
    };
  }

  private async marketOverview(): Promise<Section<MarketOverviewSection>> {
    try {
      const global = await this.coinGecko.getGlobalMarket();
      return {
        available: true,
        totalMarketCapUsd: global.totalMarketCapUsd,
        totalVolume24hUsd: global.totalVolume24hUsd,
        btcDominancePercent: global.btcDominancePercent,
        ethDominancePercent: global.ethDominancePercent,
        marketCapChangePercent24h: global.marketCapChangePercent24h,
        source: 'coingecko',
      };
    } catch {
      // Deliberately no numbers at all rather than nulls that a chart might
      // plot as zero.
      return { available: false, reason: 'provider_unavailable', detail: 'CoinGecko global market data is unavailable.' };
    }
  }

  private async sentiment(): Promise<Section<SentimentSection>> {
    try {
      const reading = await this.fearGreed.getIndex();
      return { available: true, ...reading, source: 'alternative.me' };
    } catch {
      return { available: false, reason: 'provider_unavailable', detail: 'The Fear & Greed index is unavailable.' };
    }
  }

  private async funding(symbols: string[]): Promise<Section<FundingSection>> {
    if (symbols.length === 0) return { available: false, reason: 'no_data', detail: 'No perpetual contracts are listed.' };
    try {
      // One row per symbol: the most recent settled interval. A symbol that
      // has never settled contributes nothing rather than a zero rate.
      const latest = await Promise.all(
        symbols.map(async (symbol) => {
          const record = await this.prisma.fundingRateRecord.findFirst({ where: { symbol }, orderBy: { appliedAt: 'desc' } });
          return record
            ? {
                symbol,
                rate: record.rate.toString(),
                markPrice: record.markPrice.toString(),
                indexPrice: record.indexPrice.toString(),
                appliedAt: record.appliedAt.getTime(),
              }
            : null;
        })
      );
      const settled = latest.filter((r): r is NonNullable<typeof r> => r !== null);
      if (settled.length === 0) {
        return { available: false, reason: 'no_data', detail: 'No funding interval has settled yet.' };
      }
      return {
        available: true,
        intervalHours: FUNDING_INTERVAL_HOURS,
        nextSettlementAt: Date.now() + msUntilNextFundingBoundary(),
        latest: settled,
        source: 'voltex_futures',
      };
    } catch {
      return { available: false, reason: 'no_data', detail: 'Funding history could not be read.' };
    }
  }

  private async openInterest(symbols: string[]): Promise<Section<OpenInterestSection>> {
    if (symbols.length === 0) return { available: false, reason: 'no_data', detail: 'No perpetual contracts are listed.' };
    try {
      const contracts = await Promise.all(
        symbols.map(async (symbol) => {
          const aggregate = await this.prisma.futuresPosition.aggregate({
            where: { symbol, status: 'OPEN' },
            _sum: { size: true },
          });
          const size = new BigNumber(aggregate._sum.size?.toString() ?? '0');
          const markPrice = await this.markPriceService.getMarkPrice(symbol);
          return {
            symbol,
            openInterestBase: size.toString(),
            // null, never a stand-in, when there is no mark price to value it.
            openInterestUsd: markPrice ? size.times(markPrice).toString() : null,
          };
        })
      );
      return { available: true, scope: 'venue', contracts, source: 'voltex_futures' };
    } catch {
      return { available: false, reason: 'no_data', detail: 'Open interest could not be computed.' };
    }
  }

  private async markPrices(symbols: string[]): Promise<Section<MarkPriceSection>> {
    if (symbols.length === 0) return { available: false, reason: 'no_data', detail: 'No perpetual contracts are listed.' };
    const contracts: MarkPriceSection['contracts'] = [];
    for (const symbol of symbols) {
      const [markPrice, indexPrice] = await Promise.all([
        this.markPriceService.getMarkPrice(symbol),
        this.markPriceService.getIndexPrice(symbol),
      ]);
      // A contract whose index price is unavailable is omitted — the
      // alternative would be publishing a mark price of zero.
      if (markPrice && indexPrice) {
        contracts.push({ symbol, markPrice: markPrice.toString(), indexPrice: indexPrice.toString() });
      }
    }
    if (contracts.length === 0) {
      return { available: false, reason: 'provider_unavailable', detail: 'No index price is currently available.' };
    }
    return { available: true, contracts, source: 'voltex_futures' };
  }
}
