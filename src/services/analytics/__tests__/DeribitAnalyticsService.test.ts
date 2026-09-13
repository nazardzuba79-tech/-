import { DeribitAnalyticsService } from '../DeribitAnalyticsService';

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('DeribitAnalyticsService', () => {
  test('parses BTC volatility index without turning missing data into zero', async () => {
    const fetchFn = jest.fn(async () => json({
      jsonrpc: '2.0',
      result: {
        data: [
          [1, 50, 55, 48, 52],
          [2, 52, 58, 51, 57],
        ],
      },
    })) as unknown as typeof fetch;

    const service = new DeribitAnalyticsService('https://example.test/api/v2', fetchFn, { retries: 0 });
    const result = await service.getImpliedVolatility('BTC');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.value.current).toBe(57);
    expect(result.value.open24h).toBe(50);
    expect(result.value.high24h).toBe(58);
    expect(result.value.low24h).toBe(48);
    expect(result.value.change24hPercent).toBeCloseTo(14);
  });

  test('derives SOL ATM implied volatility only from real nearest-expiry option mark IVs', async () => {
    const now = Date.now();
    const fetchFn = jest.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('get_instruments')) return json({ jsonrpc: '2.0', result: [
        { instrument_name: 'SOL-A', kind: 'option', is_active: true, base_currency: 'SOL', strike: 98, expiration_timestamp: now + 86400000 },
        { instrument_name: 'SOL-B', kind: 'option', is_active: true, base_currency: 'SOL', strike: 102, expiration_timestamp: now + 86400000 },
        { instrument_name: 'SOL-C', kind: 'option', is_active: true, base_currency: 'SOL', strike: 150, expiration_timestamp: now + 86400000 },
        { instrument_name: 'XRP-A', kind: 'option', is_active: true, base_currency: 'XRP', strike: 1, expiration_timestamp: now + 86400000 },
      ] });
      return json({ jsonrpc: '2.0', result: [
        { instrument_name: 'SOL-A', base_currency: 'SOL', underlying_price: 100, mark_iv: 61 },
        { instrument_name: 'SOL-B', base_currency: 'SOL', underlying_price: 100, mark_iv: 63 },
        { instrument_name: 'SOL-C', base_currency: 'SOL', underlying_price: 100, mark_iv: 99 },
        { instrument_name: 'XRP-A', base_currency: 'XRP', underlying_price: 1, mark_iv: 88 },
      ] });
    }) as unknown as typeof fetch;

    const service = new DeribitAnalyticsService('https://example.test/api/v2', fetchFn, { retries: 0 });
    const result = await service.getImpliedVolatility('SOL');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.value.current).toBe(63);
    expect(result.value.open24h).toBeNull();
    expect(result.value.change24hPercent).toBeNull();
    expect(result.value.points).toBe(3);
  });

  test('marks inverse futures open interest as USD and linear futures as base units', async () => {
    const now = Date.now();
    const fetchFn = jest.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('get_instruments')) {
        return json({
          jsonrpc: '2.0',
          result: [
            {
              instrument_name: 'BTC-TEST1',
              kind: 'future',
              is_active: true,
              settlement_period: 'month',
              instrument_type: 'reversed',
              expiration_timestamp: now + 30 * 24 * 60 * 60 * 1000,
            },
            {
              instrument_name: 'BTC-TEST2',
              kind: 'future',
              is_active: true,
              settlement_period: 'month',
              instrument_type: 'linear',
              expiration_timestamp: now + 60 * 24 * 60 * 60 * 1000,
            },
          ],
        });
      }
      return json({
        jsonrpc: '2.0',
        result: [
          { instrument_name: 'BTC-PERPETUAL', estimated_delivery_price: 100, mark_price: 100 },
          { instrument_name: 'BTC-TEST1', estimated_delivery_price: 100, mark_price: 110, open_interest: 500000 },
          { instrument_name: 'BTC-TEST2', estimated_delivery_price: 100, mark_price: 120, open_interest: 12.5 },
        ],
      });
    }) as unknown as typeof fetch;

    const service = new DeribitAnalyticsService('https://example.test/api/v2', fetchFn, { retries: 0 });
    const result = await service.getFuturesTermStructure('BTC');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.value.points).toHaveLength(2);
    expect(result.value.points[0].openInterestUnit).toBe('USD');
    expect(result.value.points[1].openInterestUnit).toBe('BASE');
  });

  test('filters the USDC instrument universe to XRP for dated futures', async () => {
    const now = Date.now();
    const fetchFn = jest.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('get_instruments')) return json({ jsonrpc: '2.0', result: [
        { instrument_name: 'XRP_USDC-TEST', kind: 'future', is_active: true, base_currency: 'XRP', settlement_period: 'month', instrument_type: 'linear', expiration_timestamp: now + 30 * 86400000 },
        { instrument_name: 'SOL_USDC-TEST', kind: 'future', is_active: true, base_currency: 'SOL', settlement_period: 'month', instrument_type: 'linear', expiration_timestamp: now + 30 * 86400000 },
      ] });
      return json({ jsonrpc: '2.0', result: [
        { instrument_name: 'XRP_USDC-PERPETUAL', base_currency: 'XRP', estimated_delivery_price: 1.2, mark_price: 1.2 },
        { instrument_name: 'XRP_USDC-TEST', base_currency: 'XRP', estimated_delivery_price: 1.2, mark_price: 1.25, open_interest: 250000 },
        { instrument_name: 'SOL_USDC-TEST', base_currency: 'SOL', estimated_delivery_price: 100, mark_price: 110, open_interest: 10 },
      ] });
    }) as unknown as typeof fetch;

    const service = new DeribitAnalyticsService('https://example.test/api/v2', fetchFn, { retries: 0 });
    const result = await service.getFuturesTermStructure('XRP');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.value.points).toHaveLength(1);
    expect(result.value.points[0].instrument).toBe('XRP_USDC-TEST');
    expect(result.value.points[0].openInterestUnit).toBe('BASE');
  });

  test('unsupported assets stay unavailable and do not call the provider', async () => {
    const fetchFn = jest.fn() as unknown as typeof fetch;
    const service = new DeribitAnalyticsService('https://example.test/api/v2', fetchFn, { retries: 0 });
    const iv = await service.getImpliedVolatility('DOGE');
    const curve = await service.getFuturesTermStructure('DOGE');
    expect(iv.available).toBe(false);
    expect(curve.available).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
