import { futuresReferenceRows, referenceNumber } from '../futuresReference';
import type { LiveQuote, LiveState } from '../liveMarketTypes';

function quote(overrides: Partial<LiveQuote> = {}): LiveQuote {
  return { id: 'linear_perpetual:1000PEPEUSDT', pair: '1000PEPE/USDT', symbol: '1000PEPE/USDT',
    providerSymbol: '1000PEPEUSDT', provider: 'bybit', marketType: 'linear_perpetual',
    baseAsset: '1000PEPE', quoteAsset: 'USDT', settleAsset: 'USDT', lastPrice: 0.01,
    changePercent24h: 0, quoteVolume24h: 0, stale: false, ...overrides } as LiveQuote;
}
function select(rows: LiveQuote[], status: LiveState['status'] = 'live') {
  return futuresReferenceRows({ status, revision: 1, rows: new Map(rows.map(row => [row.id, row])) });
}
test('exact scaled perpetual retains its provider price, with real zero change and turnover', () => {
  const selected = select([quote()]);
  expect(selected.get('1000PEPE/USDT')).toMatchObject({ lastPrice: 0.01, changePercent24h: 0, quoteVolume24h: 0 });
  expect(selected.has('PEPE/USDT')).toBe(false);
});
test.each([
  { marketType: 'spot', id: 'spot:1000PEPEUSDT' }, { marketType: 'linear_futures' },
  { stale: true }, { lastPrice: 0 }, { lastPrice: null }, { lastPrice: NaN },
  { pair: 'PEPE/USDT' }, { providerSymbol: 'PEPEUSDT' }, { settleAsset: 'USDC' },
] as Partial<LiveQuote>[])('rejects incompatible or unavailable quote %j', change => {
  expect(select([quote(change)]).size).toBe(0);
});
test.each(['disabled','connecting','stale'] as const)('a %s transport cannot publish fresh prices', status => {
  expect(select([quote()], status).size).toBe(0);
});
test('unknown reference numbers remain unknown while actual zero remains zero', () => {
  for (const value of [undefined, null, NaN, Infinity]) expect(referenceNumber(value)).toBeNull();
  expect(referenceNumber(0)).toBe(0);
  expect(referenceNumber(-1.2)).toBe(-1.2);
});
