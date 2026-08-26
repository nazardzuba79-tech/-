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
        'WTI/USD': { symbol: 'WTI/USD', close: '81.205', percent_change: '-0.52' },
      })
    );
    const service = new CfdMarketDataService('test-key', fetchFn);

    const tickers = await service.getTickers();

    const gold = tickers.find((t) => t.symbol === 'XAUUSD');
    expect(gold).toEqual({ symbol: 'XAUUSD', name: 'Gold US Dollar', price: '4628.20', changePercent24h: '0.05' });
    const oil = tickers.find((t) => t.symbol === 'USOUSD');
    expect(oil).toEqual({ symbol: 'USOUSD', name: 'WTI Crude Oil Cash', price: '81.205', changePercent24h: '-0.52' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('skips an instrument Twelve Data returned an error for instead of failing the whole batch', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        'XAU/USD': { symbol: 'XAU/USD', close: '4628.20', percent_change: '0.05' },
        NDX: { status: 'error', message: 'not available on this plan' },
      })
    );
    const service = new CfdMarketDataService('test-key', fetchFn);

    const tickers = await service.getTickers();

    expect(tickers.find((t) => t.symbol === 'XAUUSD')).toBeDefined();
    expect(tickers.find((t) => t.symbol === 'NAS100')).toBeUndefined();
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

  describe('getCandles', () => {
    it('fetches and normalizes ascending-order candles into unix-second time values', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        jsonResponse({
          status: 'ok',
          values: [
            { datetime: '2026-08-26 10:00:00', open: '4620.1', high: '4625.0', low: '4618.0', close: '4622.5' },
            { datetime: '2026-08-26 11:00:00', open: '4622.5', high: '4630.0', low: '4620.0', close: '4628.2' },
          ],
        })
      );
      const service = new CfdMarketDataService('test-key', fetchFn);

      const candles = await service.getCandles('XAUUSD', '1h');

      expect(candles).toEqual([
        { time: Date.parse('2026-08-26T10:00:00Z') / 1000, open: 4620.1, high: 4625.0, low: 4618.0, close: 4622.5 },
        { time: Date.parse('2026-08-26T11:00:00Z') / 1000, open: 4622.5, high: 4630.0, low: 4620.0, close: 4628.2 },
      ]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const url = fetchFn.mock.calls[0][0] as string;
      expect(url).toContain('interval=1h');
      expect(url).toContain('order=ASC');
      expect(url).toContain('symbol=XAU%2FUSD');
    });

    it('caches candles per symbol:interval and does not refetch within the TTL', async () => {
      const fetchFn = jest.fn().mockResolvedValue(
        jsonResponse({ status: 'ok', values: [{ datetime: '2026-08-26 10:00:00', open: '1', high: '1', low: '1', close: '1' }] })
      );
      const service = new CfdMarketDataService('test-key', fetchFn);

      await service.getCandles('XAUUSD', '1h');
      await service.getCandles('XAUUSD', '1h');

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown symbol without making a request', async () => {
      const fetchFn = jest.fn();
      const service = new CfdMarketDataService('test-key', fetchFn);

      await expect(service.getCandles('DOESNOTEXIST', '1h')).rejects.toThrow(ExternalCfdDataError);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('rejects an unsupported interval without making a request', async () => {
      const fetchFn = jest.fn();
      const service = new CfdMarketDataService('test-key', fetchFn);

      await expect(service.getCandles('XAUUSD', '1m')).rejects.toThrow(ExternalCfdDataError);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('throws ExternalCfdDataError when Twelve Data returns an error status', async () => {
      const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ status: 'error', message: 'not available on this plan' }));
      const service = new CfdMarketDataService('test-key', fetchFn);

      await expect(service.getCandles('NAS100', '1h')).rejects.toThrow('not available on this plan');
    });

    it('throws ExternalCfdDataError when no API key is configured', async () => {
      const service = new CfdMarketDataService(undefined);

      await expect(service.getCandles('XAUUSD', '1h')).rejects.toThrow(ExternalCfdDataError);
    });
  });
});
