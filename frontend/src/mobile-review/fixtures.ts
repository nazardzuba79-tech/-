import type { ChartCandleLoader } from '../lib/chartTrading';
import type { MarketTicker } from '../lib/api';

// Explicit synthetic review inputs, not prices or performance claims.
export const markets: MarketTicker[] = [
  { pair: 'BTC/USDT', lastPrice: '64000', bidPrice: '63999', askPrice: '64001', quoteVolume24h: '64000000', changePercent24h: '1.27', volume24h: '1000', high24h: '65000', low24h: '63000' },
  { pair: 'ETH/USDT', lastPrice: '3200', bidPrice: '3199', askPrice: '3201', quoteVolume24h: '25600000', changePercent24h: '-0.74', volume24h: '8000', high24h: '3300', low24h: '3100' },
  { pair: 'SOL/USDT', lastPrice: '150', bidPrice: '149', askPrice: '151', quoteVolume24h: '3600000', changePercent24h: '2.04', volume24h: '24000', high24h: '155', low24h: '145' },
];
export const fixtureMetrics = { candleReads: 0 };
export const fixtureCandles: ChartCandleLoader = async (pair, interval, limit, signal) => {
  if (signal?.aborted || document.hidden) throw new DOMException('Inactive', 'AbortError');
  fixtureMetrics.candleReads++;
  const price = Number(markets.find(item => item.pair === pair)?.lastPrice || 64000);
  const seconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
  const step = seconds[interval] || 3600;
  return { candles: Array.from({ length: Math.min(limit, 160) }, (_, i) => {
    const open = price * (0.975 + i * 0.00012 + Math.sin(i / 6) * 0.003);
    const close = open + Math.sin(i * 1.3) * price * 0.0018;
    return { time: 1750000000 - (160 - i) * step, open, close, high: Math.max(open, close) + price * 0.001, low: Math.min(open, close) - price * 0.001, volume: 10 + i % 12 };
  }) };
};
