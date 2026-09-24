import { runCfdDisplaySelfTest } from '../../services/marketData/cfd/CfdDisplaySelfTest';

describe('CFD display startup self-test', () => {
  it('waits for warm-up, retries transient failures, and stops probing successful legs', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    const log = jest.fn();
    const getQuotes = jest.fn()
      .mockResolvedValueOnce([{ last: null }, { last: null }])
      .mockResolvedValueOnce([{ last: 123.45 }, { last: null }]);
    const getOhlc = jest.fn(async (symbol: string) => {
      if (symbol === 'WTIUSD') return { bars: [{}, {}] };
      if (getOhlc.mock.calls.filter(call => call[0] === 'XAUUSD').length === 1) throw new TypeError('temporary');
      return { bars: [{}, {}, {}] };
    });

    const result = await runCfdDisplaySelfTest({
      getQuotes,
      getOhlc,
      retryDelaysMs: [10, 20, 30],
      sleep,
      log,
    });

    expect(result.passed).toBe(true);
    expect(result.attempt).toBe(2);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([10, 20]);
    expect(getQuotes).toHaveBeenCalledTimes(2);
    expect(getOhlc.mock.calls.filter(call => call[0] === 'WTIUSD')).toHaveLength(1);
    expect(getOhlc.mock.calls.filter(call => call[0] === 'XAUUSD')).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatchObject({
      passed: false,
      final: false,
      quotesOk: false,
      xauOhlcOk: false,
      wtiOhlcOk: true,
      errors: { quotes: 'unpriced', xauOhlc: 'TypeError', wtiOhlc: null },
    });
    expect(log.mock.calls[1][0]).toMatchObject({
      passed: true,
      final: true,
      pricedRows: 1,
      xauOhlcBars: 3,
      wtiOhlcBars: 2,
      errors: { quotes: null, xauOhlc: null, wtiOhlc: null },
    });
  });

  it('does not throw or poll forever when an upstream remains unavailable', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    const log = jest.fn();
    const getQuotes = jest.fn(async () => [{ last: null }]);
    const getOhlc = jest.fn(async () => { throw new Error('down'); });

    const result = await runCfdDisplaySelfTest({
      getQuotes,
      getOhlc,
      retryDelaysMs: [0, 0, 0],
      sleep,
      log,
    });

    expect(result).toMatchObject({
      attempt: 3,
      final: true,
      passed: false,
      quotesOk: false,
      xauOhlcOk: false,
      wtiOhlcOk: false,
      errors: { quotes: 'unpriced', xauOhlc: 'Error', wtiOhlc: 'Error' },
    });
    expect(getQuotes).toHaveBeenCalledTimes(3);
    expect(getOhlc).toHaveBeenCalledTimes(6);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('accepts the first healthy probe and performs no retries', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    const getQuotes = jest.fn(async () => [{ last: 1 }]);
    const getOhlc = jest.fn(async () => ({ bars: [{}, {}] }));

    const result = await runCfdDisplaySelfTest({
      getQuotes,
      getOhlc,
      retryDelaysMs: [0, 0, 0],
      sleep,
    });

    expect(result.passed).toBe(true);
    expect(result.attempt).toBe(1);
    expect(getQuotes).toHaveBeenCalledTimes(1);
    expect(getOhlc).toHaveBeenCalledTimes(2);
  });
});
