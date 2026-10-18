import BigNumber from 'bignumber.js';
import { instrument } from './liveFixture';
import { history20Selection, type History20Choice } from '../history20Prices';
import type { PrivateInstrument } from '../../marketData';
import { buildHistoricalGrowthProgram, historicalGrowthMaxPrice, type HistoricalGrowthSourceRow } from '../../../shared/listingHistoricalGrowth';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { listingSimulationConfig, parseListingConfig, type ListingConfig } from '../../../services/listings/listingConfig';
import type { AdminListing } from '../../../services/listings/store';
import { simulationFor, TestMarketSimulation } from '../../../services/testMarkets/testMarketSimulation';

/**
 * A SYNTHETIC History20 window (a deterministic walk, not market data) and
 * a test-only model contract, shared by the History20 native suites.
 */
export const DAY = 86_400_000, M = 60_000;
export const LISTING_AT = '2026-09-13T00:00:00.000Z', FROM = Date.parse(LISTING_AT);
function walk(days: number): HistoricalGrowthSourceRow[] {
  let x = 7, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    const open = d ? price * (1 + (random() - .5) * .006) : 100, close = open * Math.exp(Math.log(80) / days + (random() - .5) * .12);
    price = close;
    return { date, open, high: Math.max(open, close) * (1 + random() * .04), low: Math.min(open, close) * (1 - random() * .04), close };
  });
}
export const growth = buildHistoricalGrowthProgram({ scenarioId: 'VHX-03-SOL', targetPeakGrowthPercent: '9348', rows: walk(40),
  source: { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'b'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } });
export const windowConfig = (overrides: Partial<ListingConfig> = {}): ListingConfig => parseListingConfig({
  schemaVersion: 1, symbol: 'VHXT', name: 'VOLTEX History Test', logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'UTC',
  ownerAllocation: '0', seedMode: 'manual', seed: 'vhxt-native-20260913-synthetic', tradable: false,
  simulationProgram: { ...defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
    historicalGrowth: growth, maxPrice: historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
  ...overrides,
});
export const adminListing = (id: string, draft: ListingConfig, activeVersion: number | null = null): AdminListing => ({
  id, symbol: draft.symbol, draft, draftRevision: 3, draftUpdatedAt: LISTING_AT, draftUpdatedBy: 'fixture-admin', activeVersion, active: activeVersion ? draft : null, versions: [],
});
export const CHOICE: History20Choice = history20Selection(adminListing('vhxt', windowConfig()));
export const CONTRACT = CHOICE.selection.contract;
/** A TEST-ONLY contract so the engine can run on the model; no model contract is defined for production. */
export const MODEL_CONTRACT: PrivateInstrument = { ...instrument(CONTRACT), parameterVersion: 'TEST_ONLY_HISTORY20_CONTRACT', fundingIntervalMinutes: 480,
  filters: { tickSize: '0.00000001', minPrice: '0.00000001', maxPrice: '1000000', qtyStep: '0.1', minOrderQty: '0.1', maxOrderQty: '1000000', maxMarketOrderQty: '1000000', minNotionalValue: '5' },
  leverage: { min: '1', max: '10', step: '1' },
  riskTiers: [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.05', initialMarginRate: '0.1', maintenanceDeduction: '0', maxLeverage: '10' }] };
export const model = (): TestMarketSimulation => simulationFor(listingSimulationConfig(CHOICE.config));
export const modelPrice = (t: number) => new BigNumber(model().priceAt(t)!);
/** The first 10-second model tick after `from` where `hit` holds. */
export function firstTick(from: number, hit: (price: BigNumber) => boolean, within = 3 * DAY) {
  for (let t = Math.ceil((from + 1) / 10_000) * 10_000; t <= from + within; t += 10_000) if (hit(modelPrice(t))) return t;
  throw new Error('fixture: the model never reaches the level');
}
