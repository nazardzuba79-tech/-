import { isRetiredMarketPair, isTestMarketPair, parseTestMarkets, withTestMarketTickers, withoutTestMarkets, matchesTestAssetSearch, type TestAsset } from '../testMarkets';
const nrx = { pair: 'NRX/USDT', symbol: 'NRX', name: 'NEURIX', quote: 'USDT', isTestAsset: true, isTradable: true, listingArmed: true, initialPrice: 0.01, listingAt: '2026-10-01T13:00:00Z', state: { phase: 'live', lastPrice: 1 } } as TestAsset;
const btc = { pair: 'BTC/USDT', lastPrice: '42' } as any;
test.each(['NRX/USDT', 'NRX-USDT', 'nrx_usdt', 'NRXUSDT', 'NRX'])('retired aliases stay classified %s', pair => expect(isRetiredMarketPair(pair)).toBe(true));
test('stale venue and synthetic metadata cannot reintroduce NRX; other pairs remain', () => {
  const venue = new Map([['NRX/USDT', {...btc, pair:'NRX/USDT'}], ['BTC/USDT', btc]]);
  expect([...withTestMarketTickers(venue, [nrx]).keys()]).toEqual(['BTC/USDT']);
  expect([...withTestMarketTickers(venue, []).keys()]).toEqual(['BTC/USDT']);
  expect(venue.has('NRX/USDT')).toBe(true);
  expect(withoutTestMarkets([nrx, btc])).toEqual([btc]);
  expect(matchesTestAssetSearch(nrx, '')).toBe(false);
  expect(matchesTestAssetSearch(nrx, 'NRX')).toBe(false);
  expect(isTestMarketPair('NRX/USDT')).toBe(false);
  expect(isTestMarketPair('VTA/USDT')).toBe(true);
  for (const raw of [nrx, {...nrx, managed:true, version:1}]) expect(parseTestMarkets({serverTime:1,assets:[raw]})!.assets).toEqual([]);
});
test('cold/down feed does not become a synthetic market', () => {
  const empty=new Map();expect(withTestMarketTickers(empty,[nrx])).toBe(empty);
  expect(isRetiredMarketPair('ECLV/USDT')).toBe(false);expect(isRetiredMarketPair('QVTR/USDT')).toBe(false);
});
