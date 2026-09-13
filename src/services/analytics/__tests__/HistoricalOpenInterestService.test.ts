import { HistoricalOpenInterestService } from '../HistoricalOpenInterestService';

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('HistoricalOpenInterestService', () => {
  test('returns real ordered base and USD open-interest points without coercing missing USD to zero', async () => {
    const fetchFn = jest.fn(() => ok([
      { symbol: 'BTCUSDT', sumOpenInterest: '12.5', sumOpenInterestValue: '1000000', timestamp: '2000' },
      { symbol: 'BTCUSDT', sumOpenInterest: '10', sumOpenInterestValue: '', timestamp: '1000' },
      { symbol: 'BTCUSDT', sumOpenInterest: 'bad', sumOpenInterestValue: '7', timestamp: '3000' },
    ])) as unknown as typeof fetch;
    const service = new HistoricalOpenInterestService('https://example.test', { fetchFn, policy: { retries: 0 } });

    const result = await service.getHistory('btc');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.value.baseAsset).toBe('BTC');
    expect(result.value.contract).toBe('BTCUSDT');
    expect(result.value.points).toEqual([
      { observedAt: 1000, openInterestBase: 10, openInterestUsd: null },
      { observedAt: 2000, openInterestBase: 12.5, openInterestUsd: 1000000 },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.test/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=168'
    );
  });

  test('unsupported assets do not make a provider request', async () => {
    const fetchFn = jest.fn() as unknown as typeof fetch;
    const service = new HistoricalOpenInterestService('https://example.test', { fetchFn });
    const result = await service.getHistory('DOGE');
    expect(result.available).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('malformed or insufficient history is unavailable, never an empty zero series', async () => {
    const fetchFn = jest.fn(() => ok([{ sumOpenInterest: '1', sumOpenInterestValue: '2', timestamp: '1000' }])) as unknown as typeof fetch;
    const service = new HistoricalOpenInterestService('https://example.test', { fetchFn, policy: { retries: 0 } });
    const result = await service.getHistory('ETH');
    expect(result.available).toBe(false);
  });
});
