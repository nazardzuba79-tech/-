import { PrivateTradingMarketData } from '../marketData';

const NOW = Date.UTC(2026, 8, 28, 12);
const mark = (age = 100) => ({ symbol: 'ETHUSDT', markPrice: '100', lastPrice: '101',
  markProviderTimestamp: NOW - age, receivedAt: NOW - age, fetchedAt: NOW - age });
const frame = (marks: unknown[] = []) => ({ status: 'live', fetchedAt: NOW, marks });
const response = (body: unknown) => new Response(JSON.stringify(body));
const quote = () => ({ ...mark(), provider: 'bybit', bids: [{ price: '100', quantity: '1' }],
  asks: [{ price: '101', quantity: '1' }], fundingRate: '0.0001', nextFundingTime: NOW + 3_600_000,
  providerTimestamp: NOW - 100, bookGeneratedAt: NOW - 100 });
const api = (request: typeof fetch) => new PrivateTradingMarketData({
  collector: { url: 'https://collector.example', token: 'synthetic-test-only' }, now: () => NOW, request,
});

describe('historical current-price fallback policy (all symbols)', () => {
  afterEach(() => jest.restoreAllMocks());
  test.each([45_000, 45_001, 50_000, 60_000, 60_001])('ticker age %s respects command headroom', async age => {
    const request = jest.fn(async input => {
      const path = new URL(String(input)).pathname;
      return response(path.endsWith('/marks') ? frame() : path.includes('/ticker/') ? mark(age) : quote());
    });
    const result = await api(request).historicalDemoPrices(['ETHUSDT'], undefined, 15_000);
    expect(result.get('ETHUSDT')!.markProviderTimestamp).toBe(NOW - (age <= 45_000 ? age : 100));
    expect(request).toHaveBeenCalledTimes(age <= 45_000 ? 2 : 3);
  });
  test.each(['markProviderTimestamp', 'receivedAt', 'fetchedAt'] as const)('headroom checks ticker %s independently', async field => {
    const request = jest.fn(async input => response(String(input).includes('/marks?') ? frame()
      : String(input).includes('/ticker/') ? { ...mark(), [field]: NOW - 45_001 } : quote()));
    expect((await api(request).historicalDemoPrices(['ETHUSDT'], undefined, 15_000)).get('ETHUSDT')![field]).toBe(NOW - 100);
    expect(request).toHaveBeenCalledTimes(3);
  });
  test('display keeps its existing 60s lifetime and does not request an unnecessary book', async () => {
    const request = jest.fn(async input => response(String(input).includes('/marks?') ? frame() : mark(50_000)));
    expect((await api(request).historicalDemoPrices(['ETHUSDT'])).get('ETHUSDT')).toEqual(mark(50_000));
    expect(request).toHaveBeenCalledTimes(2);
  });
  test('valid frame avoids both fallback requests', async () => {
    const request = jest.fn(async () => response(frame([mark()])));
    expect((await api(request).historicalDemoPrices(['ETHUSDT'], undefined, 15_000)).get('ETHUSDT')).toEqual(mark());
    expect(request).toHaveBeenCalledTimes(1);
  });
  test.each(['http', 'network', 'timeout'])('marks %s outage tries ticker then quote with the same private authentication', async failure => {
    const request = jest.fn(async (input, options) => {
      expect(options).toMatchObject({ headers: { Authorization: 'Bearer synthetic-test-only' }, redirect: 'error' });
      expect(String(input)).toMatch(/^https:\/\/collector\.example\/internal\/v1\/private-trading\//);
      if (String(input).includes('/marks?')) {
        if (failure !== 'http') throw failure === 'timeout' ? new DOMException('timeout', 'TimeoutError') : new TypeError('offline');
        return new Response('{}', { status: 503 });
      }
      return String(input).includes('/ticker/') ? new Response('{}', { status: 503 }) : response(quote());
    });
    expect((await api(request).historicalDemoPrices(['ETHUSDT'], undefined, 15_000)).get('ETHUSDT')!.markPrice).toBe('100');
    expect(request).toHaveBeenCalledTimes(3);
  });
  test.each(['before', 'marks', 'ticker'])('cancellation at %s stops further fallback requests', async stage => {
    const controller = new AbortController();
    if (stage === 'before') controller.abort();
    const request = jest.fn(async input => {
      const isFrame = String(input).includes('/marks?');
      if ((isFrame && stage === 'marks') || (!isFrame && stage === 'ticker')) {
        controller.abort(); throw new TypeError('aborted transport');
      }
      return response(frame());
    });
    await expect(api(request).historicalDemoPrices(['ETHUSDT'], controller.signal, 15_000)).rejects.toMatchObject({ code: 'request_cancelled' });
    expect(request).toHaveBeenCalledTimes(stage === 'before' ? 0 : stage === 'marks' ? 1 : 2);
  });
  test.each([{}, frame([{ ...mark(), symbol: 'BTCUSDT' }]), frame([mark(), mark()])])('malformed or conflicting frame is not hidden by fallback', async body => {
    const request = jest.fn(async () => response(body));
    await expect(api(request).historicalDemoPrices(['ETHUSDT'])).rejects.toMatchObject({ code: 'market_data_invalid' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  test('invalid JSON is not treated as a network outage', async () => {
    const request = jest.fn(async () => new Response('invalid-json'));
    await expect(api(request).historicalDemoPrices(['ETHUSDT'])).rejects.toMatchObject({ name: 'SyntaxError' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  test('a live quote must also satisfy unusually large requested headroom', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const request = jest.fn(async input => response(String(input).includes('/marks?') ? frame() : String(input).includes('/ticker/') ? mark() : quote()));
    expect((await api(request).historicalDemoPrices(['ETHUSDT'], undefined, 59_950)).size).toBe(0);
    expect(request).toHaveBeenCalledTimes(3);
  });
});
