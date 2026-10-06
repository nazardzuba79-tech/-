/** Bounded, on-demand windows over the same canonical simulation as publication. */
import { exactPriceFromGain } from '../../shared/listingScenarioControls';
import { listingSimulationConfig, ListingValidationError, type ListingConfig } from './listingConfig';
import { SIM_INTERVALS, SIM_INTERVAL_OFFSETS } from '../testMarkets/testMarketSimulation';
import { testMarketCandles, UnsupportedTestIntervalError } from '../testMarkets/testMarketService';

export const LISTING_PREVIEW_CANDLE_LIMIT = 360;
export const LISTING_PREVIEW_HORIZONS = ['first24h', 'growth', 'afterGrowth'] as const;
export type ListingPreviewHorizon = typeof LISTING_PREVIEW_HORIZONS[number];
const HOUR = 3_600_000;

export function listingScenarioPreview(config: ListingConfig, interval: string, horizon: string) {
  const program = config.simulationProgram;
  if (program?.kind !== 'scenario-controls-v2' || !LISTING_PREVIEW_HORIZONS.includes(horizon as ListingPreviewHorizon)) {
    throw new ListingValidationError('INVALID_PREVIEW_HORIZON', 'Выберите доступный период предпросмотра');
  }
  const size = SIM_INTERVALS[interval];
  if (!size) throw new UnsupportedTestIntervalError('Unsupported interval');
  const start = Date.parse(config.listingAt);
  const end = start + program.stages.reduce((hours, stage) => hours + stage.durationHours, 0) * HOUR;
  const from = horizon === 'afterGrowth' ? end : start;
  const to = horizon === 'first24h' ? start + 24 * HOUR : horizon === 'growth' ? end : end + 24 * HOUR;
  const offset = SIM_INTERVAL_OFFSETS[interval] ?? 0;
  const count = Math.floor((to - offset) / size) - Math.floor((from - offset) / size) + 1;
  // Reject BEFORE touching the generator, rather than computing a full history
  // and discarding most of it. The frontend offers a coarser interval.
  if (count > LISTING_PREVIEW_CANDLE_LIMIT) {
    throw new ListingValidationError('PREVIEW_INTERVAL_TOO_FINE', 'Для этого периода выберите более крупный интервал свечей');
  }
  const candles = testMarketCandles(listingSimulationConfig(config), interval, to, count);
  return {
    candles,
    scenarioSummary: {
      horizon: horizon as ListingPreviewHorizon, interval, from, to,
      initialPrice: config.initialPrice,
      first24hPrice: exactPriceFromGain(config.initialPrice, program.first24hGainPercent),
      maxPrice: program.maxPrice,
      observedHigh: Math.max(...candles.map((candle) => candle.high)),
      candleLimit: LISTING_PREVIEW_CANDLE_LIMIT,
    },
  };
}
