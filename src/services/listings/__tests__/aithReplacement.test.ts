import { readFileSync } from 'fs';
import { resolve } from 'path';
import BigNumber from 'bignumber.js';
import { aithReplacementConfig } from '../aithReplacement';
import { parseListingConfig, listingSimulationConfig, checkPublishable, type PublishedListing } from '../listingConfig';
import { AITH_PUBLICATION_PROTOCOL, aithLeaseDeadline, validAithLease } from '../../../shared/aithPublication';
import { ManagedListingRegistry } from '../registry';
import { type ListingStore } from '../store';
import { setManagedListingAssets } from '../managedSnapshot';
import { assertSpotListing, spotPriceSource } from '../../testMarkets/nrxSpot';
import { isTestAssetPairOrSymbol } from '../../testMarkets/testAssetConfig';
import { TestMarketSimulation, DAY_MS, simulationFor } from '../../testMarkets/testMarketSimulation';
import { testMarketCandles } from '../../testMarkets/testMarketService';
import { publishedListings, resetPublishedCache } from '../../../../workers/market-edge/src/listingsStore';

const next = parseListingConfig(JSON.parse(readFileSync(resolve(__dirname, '../../../../config/test-markets/aith.draft.json'), 'utf8')));
const old = parseListingConfig({ ...next, initialPrice: '0.80', simulationProfile: 'CALM_TREND' });
const start = Date.parse(next.listingAt);
const now = start - DAY_MS;
const lease = (at = now, version = 1) => ({ protocol: AITH_PUBLICATION_PROTOCOL, generation: version, issuedAt: at, expiresAt: at + 45_000 } as const);
const publication = (at = now): PublishedListing => ({ id: 'aith-existing', version: 1, publishedAt: new Date(now - DAY_MS).toISOString(), config: old, readLease: lease(at) });

afterEach(() => { setManagedListingAssets([]); resetPublishedCache(); jest.restoreAllMocks(); });

test('Worker drops expired AITH on authority outage and never extends a delayed old publication', async () => {
  let clock = now, fail = false;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  const other = { ...publication(), id: 'other', config: { ...old, symbol: 'QAX' } };
  const stub = { fetch: jest.fn(async () => {
    if (fail) throw new Error('authority unavailable');
    return new Response(JSON.stringify({ revision: '1', listings: [publication(), other] }));
  }) };
  const env = { LISTINGS: { idFromName: () => 'test', get: () => stub } } as any;
  expect((await publishedListings(env))!.listings).toHaveLength(2);
  fail = true; clock += 46_000;
  expect((await publishedListings(env))!.listings.map(x => x.id)).toEqual(['other']);
  resetPublishedCache(); fail = false;
  stub.fetch.mockImplementation(async () => {
    clock += 46_000;
    return new Response(JSON.stringify({ revision: '1', listings: [publication()] }));
  });
  expect((await publishedListings(env))!.listings).toEqual([]);
});

test('new immutable AITH config changes only price and requested profile; normal history lock stays closed', () => {
  expect(aithReplacementConfig(old, next, now)).toEqual(next);
  expect(old.initialPrice).toBe('0.80');
  expect(() => checkPublishable(next, old, now)).toThrow();
  for (const mutation of [
    { listingAt: '2026-10-12T15:00:00Z' }, { seed: 'different-seed' }, { name: 'Other' }, { logo: 'data:image/png;base64,AAAA' },
    { ownerAllocation: '1' }, { tradable: true }, { initialPrice: '3' }, { simulationProfile: 'CALM_TREND' },
    { simulationProgram: { ...next.simulationProgram!, maxGainPercent: 9248 } },
  ]) expect(() => aithReplacementConfig(old, { ...next, ...mutation }, now)).toThrow();
  for (const at of [start - 60_000, start, start + DAY_MS]) expect(() => aithReplacementConfig(old, next, at)).toThrow();
  expect(() => aithReplacementConfig({ ...old, symbol: 'QAX' }, { ...next, symbol: 'QAX' }, now)).toThrow();
});

test('lease generation, deadline and delayed-response checks cannot extend old authority', () => {
  expect(validAithLease(lease(), 1, now)).toBe(true);
  expect(validAithLease(lease(), 2, now)).toBe(false);
  expect(validAithLease(lease(), 1, now + 44_000)).toBe(false);
  expect(validAithLease(undefined, 1, now)).toBe(false);
  expect(aithLeaseDeadline(lease(), 100, now + 30_000)).toBe(14_100);
});

test('API drops expired or unavailable AITH while retaining other listings; late reads cannot revive a drained lease', async () => {
  let clock = now;
  let fail = false;
  const other = { ...publication(), id: 'other', config: { ...old, symbol: 'QAX' } };
  const store = { published: jest.fn(async () => { if (fail) throw new Error('unavailable'); return { revision: '1', listings: [publication(), other] }; }) } as unknown as ListingStore;
  const registry = new ManagedListingRegistry(store, () => clock);
  await registry.authoritative();
  expect(registry.snapshot()).toHaveLength(2);
  clock += 44_000;
  expect(registry.snapshot().map(x => x.id)).toEqual(['other']);
  fail = true;
  await registry.authoritative();
  expect(registry.snapshot().map(x => x.id)).toEqual(['other']);
  const slow = new ManagedListingRegistry({ published: async () => { clock += 46_000; return { revision: '1', listings: [publication()] }; } } as ListingStore, () => clock);
  await slow.authoritative();
  expect(slow.snapshot()).toEqual([]);
});

test('AITH Spot/Futures classification remains blocked with no registry and no venue price fallback', async () => {
  setManagedListingAssets([]);
  for (const pair of ['AITH', 'AITH/USDT', 'AITH-USDT']) {
    expect(isTestAssetPairOrSymbol(pair)).toBe(true);
    expect(() => assertSpotListing(pair, start + DAY_MS)).toThrow();
  }
  const venue = { getTicker: jest.fn(async () => ({ lastPrice: '123' })) };
  expect(await spotPriceSource(venue).getTicker('AITH/USDT')).toBeNull();
  expect(venue.getTicker).not.toHaveBeenCalled();
});

test('real AITH generator, preview, every OHLC component and tick respect the recalculated hard maximum', () => {
  const program = next.simulationProgram! as { first24hGainPercent: number; maxGainPercent: number };
  const target = new BigNumber(next.initialPrice).times(new BigNumber(program.first24hGainPercent).div(100).plus(1));
  const cap = new BigNumber(next.initialPrice).times(new BigNumber(program.maxGainPercent).div(100).plus(1));
  expect(target.toFixed(2)).toBe('36.50');
  expect(cap.toFixed(2)).toBe('186.94');
  const asset = listingSimulationConfig(next), sim = new TestMarketSimulation(asset);
  expect(sim.priceAt(start)).toBe(2);
  expect(sim.priceAt(start + DAY_MS)).toBeCloseTo(target.toNumber(), 8);
  expect(sim.candles5m(start - 1)).toEqual([]);
  expect(sim.recentTrades(start - 1, 10)).toEqual([]);
  // The existing legacy Admin preview uses this canonical service, while v2 has a separate horizon API.
  const preview = testMarketCandles(asset, '1h', start + 7 * DAY_MS, 168);
  expect(preview.length).toBeGreaterThan(100);
  for (const c of [...sim.candles5m(start + 14 * DAY_MS), ...preview]) {
    for (const price of [c.open, c.high, c.low, c.close]) { expect(price).toBeGreaterThan(0); expect(price).toBeLessThanOrEqual(cap.toNumber()); }
  }
  for (const days of [1, 7, 14, 30, 365]) {
    const at = start + days * DAY_MS;
    expect(sim.priceAt(at)).toBeLessThanOrEqual(cap.toNumber());
    for (const tick of sim.recentTrades(at, 100)) expect(Number(tick.price)).toBeLessThanOrEqual(cap.toNumber());
  }
  expect(simulationFor(asset)).not.toBe(simulationFor(listingSimulationConfig(old)));
});
