import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { MarkPriceService } from '../futures/MarkPriceService';
import { FuturesMarketRegistry } from '../futures/FuturesMarketRegistry';
import { FUNDING_INTERVAL_HOURS } from '../config/futuresConfig';
import { msUntilNextFundingBoundary } from '../futures/FundingRateService';
import { MarketDataGateway } from './marketData/MarketDataGateway';
import { providerHealthRegistry, type ProviderHealthSnapshot } from './marketData/ProviderHealth';
import { available, unavailable, type Availability, type Unavailable } from './marketData/types';
import type { CoinGeckoService } from './CoinGeckoService';
import {
  ExternalDerivativesService,
  TRACKED_ASSETS,
  type BasisComparison,
  type FundingComparison,
  type PositioningValue,
} from './marketData/derivatives/ExternalDerivativesService';
import type { TrackedVenueOpenInterest, VenueAttribution } from './marketData/derivatives/types';
import type {
  CorrelationsValue,
  DerivedAnalyticsService,
  RealizedVolatilityValue,
  SectorRotationValue,
} from './analytics/DerivedAnalyticsService';
import type {
  DeribitAnalyticsService,
  FuturesTermStructureValue,
  ImpliedVolatilityValue,
} from './analytics/DeribitAnalyticsService';
import type { LiquidationStreamService, LiquidationsValue } from './analytics/LiquidationStreamService';

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

export interface DerivativeContract {
  symbol: string;
  markPrice: string | null;
  indexPrice: string | null;
  openInterestBase: string | null;
  openInterestUsd: string | null;
  fundingRate: string | null;
  fundingAppliedAt: number | null;
}

export interface DerivativesValue {
  scope: 'venue';
  intervalHours: number;
  nextSettlementAt: number;
  contracts: DerivativeContract[];
}

/** Modules for which no truthful public/free source is currently wired. */
const UNSUPPORTED: Record<string, string> = {
  liquidationHeatmap:
    'A latent liquidity heatmap needs aggregated position or liquidation-map data. Observed liquidation events are shown separately and are not extrapolated into hidden liquidity.',
  etfFlows: 'ETF creation/redemption flows require a dedicated data source; none is configured.',
  exchangeFlows: 'Exchange inflow/outflow requires on-chain attribution data; no provider is configured. Trading volume is not used as a proxy.',
  whaleActivity:
    'Whale tracking requires labelled on-chain address data; no provider is configured. Large exchange trades are not substituted for it.',
};

export type UnsupportedModule = keyof typeof UNSUPPORTED;
const NO_EXTERNAL = 'No external derivatives venue is wired in this environment.';
const NO_DERIVED = 'Derived analytics are not wired in this environment.';

export type MultiVenueSection<T> = Availability<T> & { venues?: VenueAttribution[] };

export interface AnalyticsSnapshot {
  generatedAt: number;
  contracts: string[];
  trackedAssets: string[];
  selectedAsset: string | null;
  sections: {
    marketOverview: Availability<MarketOverviewValue>;
    sentiment: Availability<SentimentValue>;
    derivatives: Availability<DerivativesValue>;
    externalOpenInterest: MultiVenueSection<TrackedVenueOpenInterest>;
    externalFunding: MultiVenueSection<FundingComparison>;
    perpetualBasis: MultiVenueSection<BasisComparison>;
    longShortPositioning: Availability<PositioningValue>;
    realizedVolatility: Availability<RealizedVolatilityValue>;
    cryptoCorrelations: Availability<CorrelationsValue>;
    sectorRotation: Availability<SectorRotationValue>;
    /** Observed public Binance USD-M forced-liquidation snapshots. */
    liquidations: Availability<LiquidationsValue>;
    /** Deribit volatility index. This is implied/forward-looking volatility, not realized vol. */
    impliedVolatility: Availability<ImpliedVolatilityValue>;
    /** Real dated Deribit futures marks versus their reported reference price. */
    futuresTermStructure: Availability<FuturesTermStructureValue>;
  };
  unsupported: Record<string, Unavailable>;
}

export interface AnalyticsDiagnostics {
  providers: ProviderHealthSnapshot[];
}

export class AnalyticsDataService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: MarketDataGateway,
    private readonly markPriceService: MarkPriceService,
    private readonly marketRegistry: FuturesMarketRegistry,
    private readonly externalDerivatives: ExternalDerivativesService | null = null,
    private readonly derived: DerivedAnalyticsService | null = null,
    private readonly coinGecko: CoinGeckoService | null = null,
    private readonly deribit: DeribitAnalyticsService | null = null,
    private readonly liquidationStream: LiquidationStreamService | null = null
  ) {}

  async getSnapshot(asset?: string): Promise<AnalyticsSnapshot> {
    const contracts = this.marketRegistry.list();
    const trackedAssets = [...TRACKED_ASSETS];
    const requested = asset?.toUpperCase();
    const selectedAsset = requested && trackedAssets.includes(requested as never) ? requested : trackedAssets[0] ?? null;

    const [
      marketOverview,
      sentiment,
      derivatives,
      externalOpenInterest,
      externalFunding,
      perpetualBasis,
      longShortPositioning,
      realizedVolatility,
      cryptoCorrelations,
      sectorRotation,
      impliedVolatility,
      futuresTermStructure,
    ] = await Promise.all([
      this.gateway.getMarketOverview(),
      this.gateway.getSentiment(),
      this.derivatives(contracts),
      this.externalOpenInterest(selectedAsset),
      this.externalFunding(selectedAsset),
      this.perpetualBasis(selectedAsset),
      this.positioning(selectedAsset),
      this.volatility(selectedAsset),
      this.correlations(),
      this.sectors(),
      this.impliedVolatility(selectedAsset),
      this.futuresTermStructure(selectedAsset),
    ]);

    const liquidations = this.liquidations(selectedAsset);
    const unsupported: Record<string, Unavailable> = {};
    for (const key of Object.keys(UNSUPPORTED)) {
      unsupported[key] = unavailable('unsupported_metric', UNSUPPORTED[key]);
    }

    return {
      generatedAt: Date.now(),
      contracts,
      trackedAssets,
      selectedAsset,
      sections: {
        marketOverview,
        sentiment,
        derivatives,
        externalOpenInterest,
        externalFunding,
        perpetualBasis,
        longShortPositioning,
        realizedVolatility,
        cryptoCorrelations,
        sectorRotation,
        liquidations,
        impliedVolatility,
        futuresTermStructure,
      },
      unsupported,
    };
  }

  private async externalOpenInterest(asset: string | null): Promise<MultiVenueSection<TrackedVenueOpenInterest>> {
    if (!this.externalDerivatives || asset === null) return unavailable('provider_not_configured', NO_EXTERNAL);
    try {
      const section = await this.externalDerivatives.getTrackedOpenInterest(asset);
      return section.available ? { ...section, venues: ExternalDerivativesService.attributionOf(section.value.venues) } : section;
    } catch {
      return unavailable('provider_unavailable', 'Tracked-venue open interest could not be read.');
    }
  }

  private async externalFunding(asset: string | null): Promise<MultiVenueSection<FundingComparison>> {
    if (!this.externalDerivatives || asset === null) return unavailable('provider_not_configured', NO_EXTERNAL);
    try {
      const section = await this.externalDerivatives.getFundingComparison(asset);
      return section.available ? { ...section, venues: ExternalDerivativesService.attributionOf(section.value.venues) } : section;
    } catch {
      return unavailable('provider_unavailable', 'External funding could not be read.');
    }
  }

  private async perpetualBasis(asset: string | null): Promise<MultiVenueSection<BasisComparison>> {
    if (!this.externalDerivatives || asset === null) return unavailable('provider_not_configured', NO_EXTERNAL);
    try {
      const section = await this.externalDerivatives.getBasisComparison(asset);
      return section.available ? { ...section, venues: ExternalDerivativesService.attributionOf(section.value.venues) } : section;
    } catch {
      return unavailable('provider_unavailable', 'Perpetual premium could not be read.');
    }
  }

  private async positioning(asset: string | null): Promise<Availability<PositioningValue>> {
    if (!this.externalDerivatives || asset === null) return unavailable('provider_not_configured', NO_EXTERNAL);
    try {
      return await this.externalDerivatives.getPositioning(asset);
    } catch {
      return unavailable('provider_unavailable', 'Positioning statistics could not be read.');
    }
  }

  private liquidations(asset: string | null): Availability<LiquidationsValue> {
    if (!this.liquidationStream || asset === null) {
      return unavailable('provider_not_configured', 'Public liquidation stream is not wired in this environment.');
    }
    return this.liquidationStream.snapshot(asset);
  }

  private async impliedVolatility(asset: string | null): Promise<Availability<ImpliedVolatilityValue>> {
    if (!this.deribit || asset === null) {
      return unavailable('provider_not_configured', 'Deribit volatility data is not wired in this environment.');
    }
    return this.deribit.getImpliedVolatility(asset);
  }

  private async futuresTermStructure(asset: string | null): Promise<Availability<FuturesTermStructureValue>> {
    if (!this.deribit || asset === null) {
      return unavailable('provider_not_configured', 'Deribit futures data is not wired in this environment.');
    }
    return this.deribit.getFuturesTermStructure(asset);
  }

  private async volatility(asset: string | null): Promise<Availability<RealizedVolatilityValue>> {
    if (!this.derived || asset === null) return unavailable('provider_not_configured', NO_DERIVED);
    try {
      return await this.derived.getRealizedVolatility(`${asset}/USDT`);
    } catch {
      return unavailable('no_data', 'Realized volatility could not be computed.');
    }
  }

  private async correlations(): Promise<Availability<CorrelationsValue>> {
    if (!this.derived) return unavailable('provider_not_configured', NO_DERIVED);
    try {
      return await this.derived.getCorrelations(TRACKED_ASSETS.map((a) => `${a}/USDT`));
    } catch {
      return unavailable('no_data', 'Correlations could not be computed.');
    }
  }

  private async sectors(): Promise<Availability<SectorRotationValue>> {
    if (!this.derived || !this.coinGecko) return unavailable('provider_not_configured', NO_DERIVED);
    try {
      return await this.derived.getSectorRotation(await this.coinGecko.getRankingsWithMeta());
    } catch {
      return unavailable('provider_unavailable', 'The asset catalogue could not be read.');
    }
  }

  getDiagnostics(): AnalyticsDiagnostics {
    return { providers: providerHealthRegistry.snapshot() };
  }

  private async derivatives(symbols: string[]): Promise<Availability<DerivativesValue>> {
    if (symbols.length === 0) return unavailable('no_data', 'No perpetual contracts are listed.');
    try {
      const contracts = await Promise.all(symbols.map((symbol) => this.contract(symbol)));
      const anyData = contracts.some(
        (contract) => contract.markPrice !== null || contract.openInterestBase !== null || contract.fundingRate !== null
      );
      if (!anyData) {
        return unavailable('no_data', 'No mark price, open interest or settled funding is available yet.');
      }
      return available({
        value: {
          scope: 'venue',
          intervalHours: FUNDING_INTERVAL_HOURS,
          nextSettlementAt: Date.now() + msUntilNextFundingBoundary(),
          contracts,
        },
        source: 'voltex',
        fetchedAt: Date.now(),
        stale: false,
      });
    } catch {
      return unavailable('no_data', 'Contract data could not be read.');
    }
  }

  private async contract(symbol: string): Promise<DerivativeContract> {
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
      openInterestUsd: openInterest && markPrice ? openInterest.times(markPrice).toString() : null,
      fundingRate: funding ? funding.rate : null,
      fundingAppliedAt: funding ? funding.appliedAt : null,
    };
  }

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
