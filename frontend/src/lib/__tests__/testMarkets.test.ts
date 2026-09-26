import { readFileSync } from 'fs';
import { resolve } from 'path';
import express from 'express';
import request from 'supertest';
import {
  countdownParts, formatListingTime, formatTestCompact, formatTestPercent, formatTestPrice, formatTestPriceChange, isTestMarketPair, sinceListingPercent,
  matchesTestAssetSearch, parseTestMarkets, testAssetTicker, TEST_ASSET_NOT_TRADABLE_MESSAGE, TEST_ASSET_STATUS_LABEL,
  withoutTestMarkets, withSimulationPreview, withTestMarketTickers, type TestAsset,
} from '../testMarkets';
import { parseChangePercentOrNull } from '../priceChange';
import { testMarketsRouter } from '../../../../src/api/routes/testMarkets';
import { VOLTORA, TEST_ASSET_NOT_TRADABLE_MESSAGE as SERVER_MESSAGE } from '../../../../src/services/testMarkets/testAssetConfig';
import { TEST_ASSET_STATUS_LABEL as SERVER_STATUS } from '../../../../src/services/testMarkets/testMarketService';

const L = VOLTORA.listingAt;
const HOUR = 3_600_000;
const src = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

async function served(now: number) {
  const app = express();
  app.use('/api/v1', testMarketsRouter(() => now, { NODE_ENV: 'production' } as NodeJS.ProcessEnv));
  const res = await request(app).get('/api/v1/market/test-assets');
  return parseTestMarkets(res.body)!;
}

describe('the frontend reads exactly what the server serves', () => {
  test('one wording on both sides', () => {
    expect(TEST_ASSET_NOT_TRADABLE_MESSAGE).toBe(SERVER_MESSAGE);
    expect(TEST_ASSET_NOT_TRADABLE_MESSAGE).toBe('VOLTORA is a test asset and is not available for trading.');
    expect(TEST_ASSET_STATUS_LABEL).toBe(SERVER_STATUS);
  });

  test('pre-listing: listed, not tradable, every figure a dash', async () => {
    const snapshot = await served(L - 5 * HOUR);
    expect(snapshot.assets).toHaveLength(1);
    const [vta] = snapshot.assets;
    expect(vta).toMatchObject({ pair: 'VTA/USDT', name: 'VOLTORA', isTestAsset: true, isTradable: false, status: 'TEST · NOT TRADABLE' });
    expect(vta.state.phase).toBe('pre-listing');
    const ticker = testAssetTicker(vta);
    expect([ticker.lastPrice, ticker.changePercent24h, ticker.quoteVolume24h, ticker.high24h]).toEqual(['', '', '', '']);
    expect(formatListingTime(vta.listingAt)).toBe('27 Sep 2026 · 16:00 UTC');
  });

  test('+48h: the ticker row carries the served figures', async () => {
    const [vta] = (await served(L + 48 * HOUR)).assets;
    expect(vta.state.phase).toBe('live');
    expect(vta.state.lastPrice).toBeCloseTo(0.01 * 1.3 ** 25 * 0.96 ** 6, 6);
    const ticker = testAssetTicker(vta);
    expect(Number(ticker.lastPrice)).toBe(vta.state.lastPrice);
    expect(Number(ticker.changePercent24h)).toBe(vta.state.change24hPercent);
    expect(ticker.isTestAsset).toBe(true);
    expect(sinceListingPercent(vta)).toBeCloseTo((1.3 ** 25 * 0.96 ** 6 - 1) * 100, 3);
  });
});

describe('parsing', () => {
  test('anything but the served shape is refused, never guessed', () => {
    expect(parseTestMarkets(null)).toBeNull();
    expect(parseTestMarkets({ assets: [] })).toBeNull();
    expect(parseTestMarkets({ serverTime: 1, assets: [{ pair: 'BTC/USDT', isTestAsset: true, isTradable: false, listingAt: '2026-09-27T16:00:00Z', state: { phase: 'live' } }] })!.assets).toEqual([]);
    expect(parseTestMarkets({ serverTime: 1, assets: [{ pair: 'VTA/USDT', isTestAsset: true, isTradable: true, listingAt: '2026-09-27T16:00:00Z', state: { phase: 'live' } }] })!.assets).toEqual([]);
  });
  test('an explicit unarmed listing survives parsing as preview-only', () => {
    const parsed = parseTestMarkets({ serverTime: 1, assets: [{
      pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', isTestAsset: true, isTradable: false,
      status: TEST_ASSET_STATUS_LABEL, listingArmed: false, listingAt: '2026-09-27T16:00:00Z', initialPrice: 0.01,
      state: { phase: 'pre-listing', serverTime: 1 },
    }] })!;
    expect(parsed.assets[0].listingArmed).toBe(false);
  });
});

describe('the shared ticker map', () => {
  const vta = { pair: 'VTA/USDT', symbol: 'VTA', name: 'VOLTORA', quote: 'USDT', isTestAsset: true, isTradable: false, status: TEST_ASSET_STATUS_LABEL,
    listingArmed: true, listingAt: '2026-09-27T16:00:00.000Z', initialPrice: 0.01,
    state: { phase: 'live', lastPrice: 5.5, openPrice24h: 0.3, change24hPercent: 1733.33, high24h: 5.7, low24h: 0.3, volume24h: 1, quoteVolume24h: 2, serverTime: 0 } } as TestAsset;
  const btc = { pair: 'BTC/USDT', lastPrice: '1', bidPrice: '1', askPrice: '1', high24h: '1', low24h: '1', volume24h: '1', quoteVolume24h: '1', changePercent24h: '0' };

  test('a feed that is down stays down: no lone simulated row', () => {
    const empty = new Map();
    expect(withTestMarketTickers(empty, [vta])).toBe(empty);
  });
  test('rows are added without touching the venue map', () => {
    const venue = new Map([['BTC/USDT', btc]]);
    const merged = withTestMarketTickers(venue, [vta]);
    expect(venue.size).toBe(1);
    expect([...merged.keys()]).toEqual(['BTC/USDT', 'VTA/USDT']);
    expect(withoutTestMarkets([...merged.values()]).map((row) => row.pair)).toEqual(['BTC/USDT']);
  });
  test('summaries of the real market leave test rows out', () => {
    expect(src('pages/markets-bolt/components.tsx')).toContain('setTickers(withoutTestMarkets(Array.from(tickerMap.values())))');
    expect(src('components/TopGainersTicker.tsx')).toContain('useMarketTickers(15000, { testMarkets: false })');
  });
});

describe('formatting', () => {
  test('huge moves stay readable', () => {
    expect(formatTestPercent(55134.6)).toBe('+55,134.60%');
    expect(formatTestPercent(-4.004)).toBe('-4.00%');
    expect(formatTestPercent(0.001)).toBe('0.00%');
    expect(formatTestPercent(null)).toBe('—');
  });
  test('price precision follows the magnitude', () => {
    expect(formatTestPrice(0.01)).toBe('0.010000');
    expect(formatTestPrice(0.013842967)).toBe('0.013843');
    expect(formatTestPrice(5.5234599)).toBe('5.5235');
    expect(formatTestPrice(1234.5678)).toBe('1,234.57');
    expect(formatTestPrice(null)).toBe('—');
    expect(formatTestPrice(0)).toBe('—');
    expect(formatTestCompact(12_345_678)).toBe('12.35M');
    expect(formatTestPriceChange(0, 0.01)).toBe('0.000000');
    expect(formatTestPriceChange(5.2016, 5.5235)).toBe('+5.2016');
    expect(formatTestPriceChange(-0.0004, 0.0133)).toBe('-0.000400');
  });
  test('countdown', () => {
    expect(countdownParts(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000 + 999)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5, done: false });
    expect(countdownParts(-1)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true });
  });
  test('the 24h anomaly warning does not fire on a test market by design', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseChangePercentOrNull('55134.6', 'VTA/USDT')).toBe(55134.6);
    expect(warn).not.toHaveBeenCalled();
    parseChangePercentOrNull('80', 'BTC/USDT');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('search, identity and the preview clock', () => {
  test('found by ticker, pair or name', () => {
    for (const query of ['vta', 'VTA/USDT', 'vtausdt', 'voltora', 'Volt', '']) expect(matchesTestAssetSearch(VOLTORA, query)).toBe(true);
    expect(matchesTestAssetSearch(VOLTORA, 'btc')).toBe(false);
  });
  test('only the configured pair is a test market', () => {
    expect(isTestMarketPair('VTA/USDT')).toBe(true);
    expect(isTestMarketPair('vta/usdt')).toBe(true);
    expect(isTestMarketPair('BTC/USDT')).toBe(false);
    expect(isTestMarketPair(null)).toBe(false);
  });
  test('the preview clock is appended only when given', () => {
    expect(withSimulationPreview('/a', null)).toBe('/a');
    expect(withSimulationPreview('/a?x=1', '2026-09-28T16:00:00Z')).toBe('/a?x=1&simulationPreviewTime=2026-09-28T16%3A00%3A00Z');
  });
  test('the browser forwards it only from a build made with the preview flag', () => {
    const store = src('lib/testMarketStore.ts');
    expect(store).toContain("import.meta.env.VITE_SIMULATION_PREVIEW !== '1'");
  });
});

describe('the terminal never offers a way to trade a test asset', () => {
  const page = src('pages/TradePage.tsx');
  const panels = src('components/TestMarketTerminal.tsx');
  test('no order form, no book fetch, no TradingView embed for a test pair', () => {
    expect(page).toContain('<TestMarketOrderPanel key={pair} pair={pair} />');
    expect(page).toContain("marketType !== 'spot' || isTestMarketPair(pair) || document.hidden) return;");
    expect(panels).toContain('tradingView={false}');
    expect(panels).not.toMatch(/api\.|placeOrder|fetch\(/);
  });
  test('production preview is visibly frozen until the owner arms it', () => {
    const store = src('lib/testMarketStore.ts');
    expect(panels).toContain('Preview mode · countdown not started');
    expect(panels).toContain("listingArmed ? (parts.done ? '00' : value) : '—'");
    expect(store).toContain('if (armed.length === 0) return;');
  });
  test('every trading control answers with the message', () => {
    expect(panels.match(/onClick=\{refuse\}/g)).toHaveLength(2);
    expect(panels).toContain('aria-disabled="true"');
  });
});
