import { CollectorUniverseProvider, MarketDataCollectorClient } from '../MarketDataCollectorClient';
import type { NormalizedInstrument } from '../../bybit/types';

const filters = {
  tickSize: 0.1,
  qtyStep: 0.001,
  minOrderQty: 0.001,
  maxOrderQty: 100,
  minNotional: 5,
  maxNotional: null,
  pricePrecision: 1,
  qtyPrecision: 3,
};

function instrument(marketType: NormalizedInstrument['marketType'], providerSymbol: string): NormalizedInstrument {
  const inverse = marketType.startsWith('inverse');
  const spot = marketType === 'spot';
  return {
    symbol: spot ? 'BTC/USDT' : inverse ? 'BTC/USD' : 'ETH/USDT',
    providerSymbol,
    provider: 'bybit',
    marketType,
    baseAsset: spot || inverse ? 'BTC' : 'ETH',
    quoteAsset: inverse ? 'USD' : 'USDT',
    settleAsset: spot ? null : inverse ? 'BTC' : 'USDT',
    status: 'Trading',
    launchTime: 1,
    deliveryTime: null,
    filters,
    providerMaxLeverage: spot ? null : 100,
    fundingIntervalMinutes: spot ? null : 480,
  };
}

describe('collector-backed market universe', () => {
  it('coalesces one authenticated collector read and never needs direct Bybit HTTP', async () => {
    const snapshot = {
      instruments: [
        instrument('spot', 'BTCUSDT'),
        instrument('linear_perpetual', 'ETHUSDT'),
        instrument('inverse_perpetual', 'BTCUSD'),
      ],
      refreshedAt: 123456,
      stale: false,
      loaded: true,
    };
    let calls = 0;
    const fetchFn: typeof fetch = async (input, init) => {
      calls += 1;
      expect(String(input)).toBe('https://collector.example/internal/v1/universe');
      expect((init?.headers as Record<string,string>).Authorization).toBe('Bearer secret');
      return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new MarketDataCollectorClient('https://collector.example', 'secret', fetchFn);
    const provider = new CollectorUniverseProvider(client);

    const [spot, linear, inverse] = await Promise.all([
      provider.listSpotInstruments(),
      provider.listLinearInstruments(),
      provider.listInverseInstruments(),
    ]);

    expect(calls).toBe(1);
    expect(spot.value.map(x => x.providerSymbol)).toEqual(['BTCUSDT']);
    expect(linear.value.map(x => x.providerSymbol)).toEqual(['ETHUSDT']);
    expect(inverse.value.map(x => x.providerSymbol)).toEqual(['BTCUSD']);
    expect(spot.fetchedAt).toBe(123456);
    expect(linear.stale).toBe(false);
  });
});
