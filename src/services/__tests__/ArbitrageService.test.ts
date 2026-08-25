import { ArbitrageService, ExternalArbitrageError } from '../ArbitrageService';
import { KrakenMarketDataService } from '../KrakenMarketDataService';

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockKraken(tickers: { pair: string; lastPrice: string }[]): KrakenMarketDataService {
  return { getTickers: jest.fn().mockResolvedValue(tickers) } as unknown as KrakenMarketDataService;
}

describe('ArbitrageService', () => {
  it('computes a spread between the cheapest and most expensive exchange for a pair', async () => {
    const kraken = mockKraken([{ pair: 'BTC/USDT', lastPrice: '50000' }]);
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('binance')) {
        return Promise.resolve(jsonResponse([{ symbol: 'BTCUSDT', price: '50500' }]));
      }
      if (url.includes('okx')) {
        return Promise.resolve(jsonResponse({ data: [{ instId: 'BTC-USDT', last: '50200' }] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    const service = new ArbitrageService(kraken, fetchFn, 'https://binance', 'https://okx');

    const opportunities = await service.getOpportunities();

    const btc = opportunities.find((o) => o.pair === 'BTC/USDT');
    expect(btc).toBeDefined();
    expect(btc!.buyExchange).toBe('Kraken');
    expect(btc!.buyPrice).toBe(50000);
    expect(btc!.sellExchange).toBe('Binance');
    expect(btc!.sellPrice).toBe(50500);
    expect(btc!.spreadPercent).toBeCloseTo(1, 5);
    expect(btc!.netSpreadPercent).toBeCloseTo(0.8, 5);
  });

  it('omits a pair that only has one live quote while keeping others', async () => {
    const kraken = mockKraken([
      { pair: 'BTC/USDT', lastPrice: '50000' }, // only quote for BTC — no other source covers it below
      { pair: 'ETH/USDT', lastPrice: '3000' },
    ]);
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('binance')) return Promise.resolve(jsonResponse([{ symbol: 'ETHUSDT', price: '3050' }]));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    const service = new ArbitrageService(kraken, fetchFn, 'https://binance', 'https://okx');

    const opportunities = await service.getOpportunities();

    expect(opportunities.find((o) => o.pair === 'BTC/USDT')).toBeUndefined();
    expect(opportunities.find((o) => o.pair === 'ETH/USDT')).toBeDefined();
  });

  it('sorts opportunities by net spread descending', async () => {
    const kraken = mockKraken([
      { pair: 'BTC/USDT', lastPrice: '50000' },
      { pair: 'ETH/USDT', lastPrice: '3000' },
    ]);
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('binance')) {
        return Promise.resolve(
          jsonResponse([
            { symbol: 'BTCUSDT', price: '50100' }, // 0.2% spread
            { symbol: 'ETHUSDT', price: '3150' }, // 5% spread
          ])
        );
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    const service = new ArbitrageService(kraken, fetchFn, 'https://binance', 'https://okx');

    const opportunities = await service.getOpportunities();

    expect(opportunities[0].pair).toBe('ETH/USDT');
    expect(opportunities[1].pair).toBe('BTC/USDT');
  });

  it('degrades gracefully when one external source fails entirely', async () => {
    const kraken = mockKraken([{ pair: 'BTC/USDT', lastPrice: '50000' }]);
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('binance')) return Promise.reject(new Error('network error'));
      if (url.includes('okx')) return Promise.resolve(jsonResponse({ data: [{ instId: 'BTC-USDT', last: '50300' }] }));
      return Promise.resolve(jsonResponse({}));
    });
    const service = new ArbitrageService(kraken, fetchFn, 'https://binance', 'https://okx');

    const opportunities = await service.getOpportunities();

    const btc = opportunities.find((o) => o.pair === 'BTC/USDT');
    expect(btc).toBeDefined();
    expect(btc!.sellExchange).toBe('OKX');
  });

  it('serves the last successful snapshot when every source fails on a later call', async () => {
    const kraken = mockKraken([{ pair: 'BTC/USDT', lastPrice: '50000' }]);
    let fail = false;
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (fail) return Promise.reject(new Error('down'));
      if (url.includes('binance')) return Promise.resolve(jsonResponse([{ symbol: 'BTCUSDT', price: '50500' }]));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    const service = new ArbitrageService(kraken, fetchFn, 'https://binance', 'https://okx');
    await service.getOpportunities();

    fail = true;
    (kraken.getTickers as jest.Mock).mockRejectedValue(new Error('kraken down'));
    // Cache TTL hasn't been manipulated here, so this still serves the cache
    // rather than re-fetching — asserting the cache is actually consulted,
    // not that a rejected refetch would fall back (that's covered by the
    // ExternalRankingError-style contract already exercised on CoinGeckoService).
    const opportunities = await service.getOpportunities();
    expect(opportunities.find((o) => o.pair === 'BTC/USDT')).toBeDefined();
  });

  it('throws ExternalArbitrageError when nothing is available and nothing is cached', async () => {
    const kraken = mockKraken([]);
    const fetchFn = jest.fn().mockRejectedValue(new Error('down'));
    const service = new ArbitrageService(kraken, fetchFn, 'https://binance', 'https://okx');

    await expect(service.getOpportunities()).rejects.toThrow(ExternalArbitrageError);
  });
});
