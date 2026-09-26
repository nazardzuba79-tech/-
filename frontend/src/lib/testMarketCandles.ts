import { API_BASE } from './api';
import type { ChartCandleLoader } from './chartTrading';
import type { Candle } from './indicators';
import { fetchTestMarketJson } from './testMarketStore';
import { testMarketSlug } from './testMarkets';

/**
 * The chart's candle source for a test pair: the server's simulation,
 * nothing else. Kept apart from lib/testMarketStore so that only the
 * terminal, which draws the chart, depends on the chart's types.
 */

const validCandle = (c: any): c is Candle =>
  c && [c.time, c.open, c.high, c.low, c.close, c.volume].every((v) => typeof v === 'number' && Number.isFinite(v))
  && c.open > 0 && c.low > 0 && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close);

export const testMarketCandleLoader: ChartCandleLoader = async (pair, interval, limit, signal) => {
  const body = await fetchTestMarketJson(
    `${API_BASE}/market/test-assets/${testMarketSlug(pair)}/candles?interval=${encodeURIComponent(interval)}&limit=${limit}`,
    signal,
  ) as { candles?: unknown };
  if (!Array.isArray(body?.candles)) throw new Error('test_market_candles_shape');
  return { candles: body.candles.filter(validCandle) };
};
