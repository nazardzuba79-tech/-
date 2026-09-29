import { isManagedListingPair, isManagedTradablePair, isTestMarketPair, managedListingLogo, managedListingTime, parseTestMarkets, registerManagedListings } from '../testMarkets';
import { isEdgeMarketPair, isEdgeMarketUrl, nrxPublicUrl } from '../nrxMarket';
import { resolveMarketEdgeBase, MARKET_EDGE_BASE } from '../marketEdge';
import { utcToZonedWallTime, zonedWallTimeToUtc, utcOffsetLabel } from '../../pages/admin/adminListingsTime';

const managed = (extra: Record<string, unknown> = {}) => ({
  pair: 'QAX/USDT', symbol: 'QAX', name: 'QA Example', quote: 'USDT', isTestAsset: true, isTradable: true, status: 'SPOT',
  listingArmed: true, listingAt: '2026-10-01T12:00:00.000Z', initialPrice: 0.25, managed: true, listingId: 'qax-1', version: 1,
  logo: 'data:image/png;base64,AAAA', displayTimeZone: 'Europe/Kyiv',
  state: { phase: 'pre-listing', lastPrice: null, openPrice24h: null, change24hPercent: null, high24h: null, low24h: null, volume24h: null, quoteVolume24h: null, serverTime: 1 },
  ...extra,
});

describe('managed listings in the frontend', () => {
  test('a pair is unknown until the edge catalogue names it; then it is an edge-served test market', () => {
    expect(isTestMarketPair('QBX/USDT')).toBe(false);
    const snapshot = parseTestMarkets({ serverTime: 1, assets: [managed({ pair: 'QBX/USDT', symbol: 'QBX', isTradable: false, logo: null })] })!;
    expect(snapshot.assets).toHaveLength(1);
    registerManagedListings(snapshot.assets);
    expect(isTestMarketPair('QBX/USDT')).toBe(true);
    expect(isManagedListingPair('qbx/usdt')).toBe(true);
    expect(isEdgeMarketPair('QBX/USDT')).toBe(true);
    expect(isManagedTradablePair('QBX/USDT')).toBe(false);
    expect(managedListingLogo('QBX')).toBeNull();
    expect(managedListingLogo('BTC')).toBeUndefined();
  });

  test('parse rules: managed rows need a well-formed USDT pair and may not impersonate VTA/NRX; logos must be image data URLs', () => {
    const body = { serverTime: 1, assets: [
      managed(), managed({ pair: 'VTA/USDT', symbol: 'VTA' }), managed({ pair: 'bad pair' }), managed({ pair: 'QCX/USDT', symbol: 'QCX', logo: 'https://evil.invalid/x.png' }),
    ] };
    const assets = parseTestMarkets(body)!.assets;
    expect(assets.map((a) => a.pair)).toEqual(['QAX/USDT', 'QCX/USDT']);
    expect(assets[0].logo).toBe('data:image/png;base64,AAAA');
    expect(assets[1].logo).toBeNull();
    registerManagedListings(assets);
    expect(isManagedTradablePair('QAX/USDT')).toBe(true);
  });

  test('edge routing: catalogue, NRX and listed pairs go to the edge; ordinary pairs never do', () => {
    registerManagedListings(parseTestMarkets({ serverTime: 1, assets: [managed()] })!.assets);
    expect(isEdgeMarketUrl(`${MARKET_EDGE_BASE}/market/listings`)).toBe(true);
    expect(isEdgeMarketUrl('/api/v1/market/display/spot-book/QAX-USDT')).toBe(true);
    expect(isEdgeMarketUrl('/api/v1/market/test-assets/QAX-USDT/candles?interval=5m')).toBe(true);
    expect(isEdgeMarketUrl('/api/v1/market/test-assets/VTA-USDT')).toBe(false);
    expect(isEdgeMarketUrl('/api/v1/market/display/spot-book/BTC-USDT')).toBe(false);
    expect(nrxPublicUrl('/api/v1/market/external/trades/QAX-USDT')).toBe(`${MARKET_EDGE_BASE}/market/external/trades/QAX-USDT`);
  });

  test('edge base: production default unless a valid https (or loopback) origin is configured', () => {
    expect(MARKET_EDGE_BASE).toBe('https://market.voltextech.net');
    expect(resolveMarketEdgeBase('https://edge.example.test/')).toBe('https://edge.example.test');
    expect(resolveMarketEdgeBase('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(resolveMarketEdgeBase('http://evil.example')).toBe('https://market.voltextech.net');
    expect(resolveMarketEdgeBase('javascript:alert(1)')).toBe('https://market.voltextech.net');
  });

  test('time zones: the admin enters wall-clock time in a zone; the config stores the UTC instant (DST-aware)', () => {
    expect(zonedWallTimeToUtc('2026-10-01T15:00', 'Europe/Kyiv')).toBe('2026-10-01T12:00:00Z'); // summer UTC+3
    expect(zonedWallTimeToUtc('2026-12-01T15:00', 'Europe/Kyiv')).toBe('2026-12-01T13:00:00Z'); // winter UTC+2
    expect(zonedWallTimeToUtc('2026-10-01T15:00', 'UTC')).toBe('2026-10-01T15:00:00Z');
    expect(utcToZonedWallTime('2026-10-01T12:00:00Z', 'Europe/Kyiv')).toBe('2026-10-01T15:00');
    expect(utcOffsetLabel(Date.parse('2026-10-01T12:00:00Z'), 'Europe/Kyiv')).toBe('UTC+3');
    expect(managedListingTime('2026-10-01T12:00:00Z', 'Europe/Kyiv')).toBe('01.10.2026 · 15:00 Europe/Kyiv · 12:00 UTC');
  });
});

describe('test-market list identity', () => {
  test('the merged VTA + NRX + managed list is memoised per store change, never rebuilt per render', () => {
    // A fresh array each render made useMarketTickers rebuild its Map on every render, which kept the
    // Markets page re-rendering and starved React Router transitions (Markets → Trade never committed).
    const source = require('fs').readFileSync(require('path').join(__dirname, '../testMarketStore.ts'), 'utf8') as string;
    expect(source).toMatch(/const assets = useMemo\(\(\) => \[\.\.\.vta\.assets, \.\.\.nrx\.assets, \.\.\.managed\.assets\], \[vta\.assets, nrx\.assets, managed\.assets\]\);/);
    expect(source).not.toMatch(/assets: \[\.\.\.vta\.assets/);
  });
});
