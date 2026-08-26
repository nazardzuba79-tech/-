import { CfdMarketDataService, ExternalCfdDataError } from '../CfdMarketDataService';

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe('CfdMarketDataService', () => {
  it('reports unconfigured and returns no tickers when no API key is set', async () => {
    const service = new CfdMarketDataService(undefined);
    expect(service.isConfigured()).toBe(false);
    expect(await service.getTickers()).toEqual([]);
  });

  it('fetches and normalizes tickers keyed by symbol from a batched quote', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        'XAU/USD': { symbol: 'XAU/USD', close: '4628.20', percent_change: '0.05' },
        'EUR/USD': { symbol: 'EUR/USD', close: '1.16636', percent_change: '-0.10' },
      })
    );
    const service = new CfdMarketDataService('test-key', fetchFn);

    const tickers = await service.getTickers();

    const gold = tickers.find((t) => t.symbol === 'XAUUSD');
    expect(gold).toEqual({ symbol: 'XAUUSD', name: 'Gold US Dollar', price: '4628.20', changePercent24h: '0.05' });
    const eur = tickers.find((t) => t.symbol === 'EURUSD');
    expect(eur).toEqual({ symbol: 'EURUSD', name: 'Euro vs US Dollar', price: '1.16636', changePercent24h: '-0.10' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('skips an instrument Twelve Data returned an error for instead of failing the whole batch', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        'XAU/USD': { symbol: 'XAU/USD', close: '4628.20', percent_change: '0.05' },
        'GBP/USD': { status: 'error', message: 'run out of API credits' },
      })
    );
    const service = new CfdMarketDataService('test-key', fetchFn);

    const tickers = await service.getTickers();

    expect(tickers.find((t) => t.symbol === 'XAUUSD')).toBeDefined();
    expect(tickers.find((t) => t.symbol === 'GBPUSD')).toBeUndefined();
  });

  it('normalizes a single-symbol response (flat object, no per-symbol wrapper)', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ symbol: 'XAU/USD', close: '4628.20', percent_change: '0.05' }));
    const service = new CfdMarketDataService('test-key', fetchFn);

    const tickers = await service.getTickers();

    expect(tickers.find((t) => t.symbol === 'XAUUSD')).toBeDefined();
  });

  it('caches tickers and does not refetch within the TTL', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ 'XAU/USD': { close: '4628.20', percent_change: '0.05' } }));
    const service = new CfdMarketDataService('test-key', fetchFn);

    await service.getTickers();
    await service.getTickers();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws ExternalCfdDataError on a non-ok HTTP response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const service = new CfdMarketDataService('test-key', fetchFn);

    await expect(service.getTickers()).rejects.toThrow(ExternalCfdDataError);
  });

  it('throws ExternalCfdDataError when the network request fails', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('network down'));
    const service = new CfdMarketDataService('test-key', fetchFn);

    await expect(service.getTickers()).rejects.toThrow(ExternalCfdDataError);
  });
});
