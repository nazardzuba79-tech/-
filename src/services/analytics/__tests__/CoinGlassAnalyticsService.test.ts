import { CoinGlassAnalyticsService } from '../CoinGlassAnalyticsService';

function json(data: unknown, code: string | number = '0') {
  return Promise.resolve(new Response(JSON.stringify({ code, msg: 'ok', data }), { status: 200 }));
}

const options = (fetchFn: typeof fetch) => ({ fetchFn, policy: { retries: 0 } });

describe('CoinGlassAnalyticsService', () => {
  test('keeps the API key in a header and normalizes a genuine liquidation heatmap', async () => {
    const fetchFn = jest.fn((url: string | URL | Request, init?: RequestInit) => json({
      y_axis: ['95', '100', '105'],
      liquidation_leverage_data: [[0, 0, '10'], [1, 1, '25'], [2, 2, '0']],
      price_candlesticks: [[1700000000, '99', '101', '98', '100', '5000'], [1700003600, '100', '103', '99', '102', '6000']],
    })) as unknown as typeof fetch;
    const service = new CoinGlassAnalyticsService('secret-key', 'https://example.test', options(fetchFn));

    const result = await service.getLiquidationHeatmap('btc');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.value.symbol).toBe('BTCUSDT');
    expect(result.value.prices).toEqual([95, 100, 105]);
    expect(result.value.cells).toEqual([{ x: 0, y: 0, intensity: 10 }, { x: 1, y: 1, intensity: 25 }, { x: 2, y: 2, intensity: 0 }]);
    expect(result.value.candles[0].time).toBe(1700000000000);
    const [calledUrl, init] = (fetchFn as any).mock.calls[0];
    expect(String(calledUrl)).toContain('/api/futures/liquidation/heatmap/model1?');
    expect(String(calledUrl)).not.toContain('secret-key');
    expect((init.headers as Record<string, string>)['CG-API-KEY']).toBe('secret-key');
  });

  test('normalizes ETF flow history and preserves negative outflows', async () => {
    const fetchFn = jest.fn(() => json([
      { timestamp: 1700000000000, flow_usd: -1250000, price_usd: 60000, etf_flows: [{ etf_ticker: 'AAA', flow_usd: -1000000 }, { etf_ticker: 'BBB', flow_usd: -250000 }] },
      { timestamp: 1700086400000, flow_usd: 500000, price_usd: 61000, etf_flows: [] },
    ])) as unknown as typeof fetch;
    const service = new CoinGlassAnalyticsService('key', 'https://example.test', options(fetchFn));
    const result = await service.getEtfFlows('BTC');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.value.points[0].flowUsd).toBe(-1250000);
    expect(result.value.points[0].funds[0]).toEqual({ ticker: 'AAA', flowUsd: -1000000 });
    expect(result.value.points[1].flowUsd).toBe(500000);
  });

  test('normalizes attributed exchange balances and computes real aggregate changes', async () => {
    const fetchFn = jest.fn(() => json([
      { exchange_name: 'Alpha', total_balance: 100, balance_change_1d: -2, balance_change_percent_1d: -2, balance_change_7d: 3, balance_change_percent_7d: 3, balance_change_30d: 10, balance_change_percent_30d: 10 },
      { exchange_name: 'Beta', total_balance: 50, balance_change_1d: 1, balance_change_percent_1d: 2, balance_change_7d: -1, balance_change_percent_7d: -2, balance_change_30d: null, balance_change_percent_30d: null },
    ])) as unknown as typeof fetch;
    const service = new CoinGlassAnalyticsService('key', 'https://example.test', options(fetchFn));
    const result = await service.getExchangeFlows('ETH');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.value.aggregateChange1d).toBe(-1);
    expect(result.value.aggregateChange7d).toBe(2);
    expect(result.value.aggregateChange30d).toBe(10);
    expect(result.value.rows[0].exchange).toBe('Alpha');
  });

  test('normalizes labelled whale transfers and converts second timestamps to ms', async () => {
    const fetchFn = jest.fn(() => json([
      { transaction_hash: 'hash1', amount_usd: 12000000, asset_quantity: 200, asset_symbol: 'BTC', from: 'from-label', to: 'to-label', blockchain_name: 'Bitcoin', block_timestamp: 1700000000 },
    ])) as unknown as typeof fetch;
    const service = new CoinGlassAnalyticsService('key', 'https://example.test', options(fetchFn));
    const result = await service.getWhaleActivity('BTC');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.value.totalUsd).toBe(12000000);
    expect(result.value.events[0].observedAt).toBe(1700000000000);
    expect(result.value.events[0].from).toBe('from-label');
  });

  test('SOL exchange balances are explicitly unavailable without a provider request', async () => {
    const fetchFn = jest.fn() as unknown as typeof fetch;
    const service = new CoinGlassAnalyticsService('key', 'https://example.test', options(fetchFn));
    const result = await service.getExchangeFlows('SOL');
    expect(result.available).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('unsupported assets and malformed provider data never become fake empty values', async () => {
    const fetchFn = jest.fn(() => json({ y_axis: [], liquidation_leverage_data: [], price_candlesticks: [] })) as unknown as typeof fetch;
    const service = new CoinGlassAnalyticsService('key', 'https://example.test', options(fetchFn));
    expect((await service.getLiquidationHeatmap('DOGE')).available).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await service.getLiquidationHeatmap('BTC')).available).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
