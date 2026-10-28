import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fetchNrxPublic, nrxListingTime, nrxPublicUrl } from '../nrxMarket';
import { parseTestMarkets, isRetiredMarketPair } from '../testMarkets';
import { NEURIX } from '../../../../src/services/testMarkets/neurix';
import { publicTestAsset } from '../../../../src/services/testMarkets/testMarketService';
import { WalletPortfolioService } from '../../../../src/services/WalletPortfolioService';

test('NRX retains historical time/identity but does not appear in the public markets catalogue', () => {
  expect(nrxListingTime(new Date(NEURIX.listingAt).toISOString())).toBe('03.10.2026 · 13:00 UTC / 16:00 МСК');
  const body = parseTestMarkets({ serverTime: NEURIX.listingAt, assets: [publicTestAsset(NEURIX, NEURIX.listingAt)] });
  expect(body?.assets.some(item => item.symbol === 'NRX')).toBe(false);
  for (const alias of ['NRX/USDT', 'NRX/BTC', 'BTC/NRX', 'NRXSIMUSDT']) expect(isRetiredMarketPair(alias)).toBe(true);
});

test('deprecated NRX edge fetch has no account credential or venue fallback on a 410 response', async () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error:'market_retired',symbol:'NRX' }), { status:410 }));
  try {
    expect(nrxPublicUrl('https://render.invalid/api/v1/market/test-assets/NRX-USDT/candles?interval=5m'))
      .toBe('https://market.voltextech.net/market/test-assets/NRX-USDT/candles?interval=5m');
    await expect(fetchNrxPublic('/market/nrx')).rejects.toThrow('market_http_410');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('https://market.voltextech.net/'), expect.objectContaining({ credentials: 'omit' }));
  } finally { fetchSpy.mockRestore(); }
});

test('retirement is a UI-route guard, not deletion of historic balance/audit records', () => {
  const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
  expect(read('pages/TradePage.tsx')).toContain('function RetiredMarketTradeRoute()');
  expect(read('lib/demoSpot.ts')).toContain('!isRetiredMarketPair(pair)');
  expect(read('components/CryptoIcon.tsx')).toContain('NRX: neurixLogo');
  expect(read('lib/testMarketStore.ts')).toContain('new TestMarketStore(`${NRX_EDGE_BASE}/market/nrx`)');
});

test('historic NRX holdings can be valued without creating a new order or using the venue', async () => {
  const feed = { getTickers: jest.fn().mockResolvedValue([{ pair: 'NRX/USDT', lastPrice: '999' }]) };
  const portfolio = new WalletPortfolioService({} as any, feed as any, { isConfigured: () => false } as any);
  const now = jest.spyOn(Date, 'now').mockReturnValue(NEURIX.listingAt - 1);
  try {
    expect((await portfolio.pricesFor(['NRX'])).get('NRX')! * 6250).toBe(5000);
    now.mockReturnValue(NEURIX.listingAt + 120000);
    expect((await portfolio.pricesFor(['NRX'])).get('NRX')).toBe(publicTestAsset(NEURIX, Date.now()).state.lastPrice);
  } finally { now.mockRestore(); }
});
