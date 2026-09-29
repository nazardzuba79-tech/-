import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fetchNrxPublic, nrxListingTime, nrxPublicUrl } from '../nrxMarket';
import { getSpotPublicCandles } from '../spotPublicMarket';
import { parseTestMarkets } from '../testMarkets';
import { NEURIX } from '../../../../src/services/testMarkets/neurix';
import { publicTestAsset } from '../../../../src/services/testMarkets/testMarketService';
import { WalletPortfolioService } from '../../../../src/services/WalletPortfolioService';

// Preserve the fixed NRX transport fixture with the optional factory disabled.
// Factory-enabled transport is covered by managedListings and workerd browser QA.
jest.mock('../managedListings', () => ({ isManagedPair: () => false, fetchManagedPublic: jest.fn() }));

test('metadata parses, listing time states UTC and Moscow exactly', () => {
  expect(nrxListingTime(new Date(NEURIX.listingAt).toISOString())).toBe('03.10.2026 · 13:00 UTC / 16:00 МСК');
  expect(parseTestMarkets({ serverTime: NEURIX.listingAt, assets: [publicTestAsset(NEURIX, NEURIX.listingAt)] })!.assets[0].symbol).toBe('NRX');
});
test('every public NRX path resolves to Cloudflare without account credentials or outage fallback', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ candles: [] })));
  try {
    expect(nrxPublicUrl('https://render.invalid/api/v1/market/test-assets/NRX-USDT/candles?interval=5m'))
      .toBe('https://market.voltextech.net/market/test-assets/NRX-USDT/candles?interval=5m');
    await getSpotPublicCandles('NRX/USDT', '5m', 20, undefined, Date.now());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('https://market.voltextech.net/'), expect.objectContaining({ credentials: 'omit' }));
    fetch.mockRejectedValue(new Error('edge unavailable'));
    await expect(fetchNrxPublic('/market/nrx')).rejects.toThrow('edge unavailable');
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { fetch.mockRestore(); }
});
test('ordinary form/account submission is retained; only VTA uses restricted private sale', () => {
  const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
  const form = read('components/OrderForm.tsx');
  expect(form).toContain("const privateVta = pair.toUpperCase() === 'VTA/USDT'");
  expect(form).toContain("pair.toUpperCase() !== 'NRX/USDT'");
  expect(form).toContain('api.placeOrder(');
  expect(form).toContain('api.placeOcoOrder(');
  expect(form).not.toMatch(/NRX.{0,20}(?:disabled|unavailable)/);
  expect(read('components/CryptoIcon.tsx')).toContain('NRX: neurixLogo');
  expect(read('lib/testMarketStore.ts')).toContain('new TestMarketStore(`${NRX_EDGE_BASE}/market/nrx`)');
});
test('seeded Spot inventory values at $25,000 before listing; live value canonical, never venue NRX', async () => {
  const feed = { getTickers: jest.fn().mockResolvedValue([{ pair: 'NRX/USDT', lastPrice: '999' }]) };
  const portfolio = new WalletPortfolioService({} as any, feed as any, { isConfigured: () => false } as any);
  const now = jest.spyOn(Date, 'now').mockReturnValue(NEURIX.listingAt - 1);
  try {
    expect((await portfolio.pricesFor(['NRX'])).get('NRX')! * 31250).toBe(25000);
    now.mockReturnValue(NEURIX.listingAt + 120000);
    expect((await portfolio.pricesFor(['NRX'])).get('NRX')).toBe(publicTestAsset(NEURIX, Date.now()).state.lastPrice);
  } finally { now.mockRestore(); }
});
