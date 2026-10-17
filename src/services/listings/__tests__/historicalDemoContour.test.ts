/**
 * The historical demo contour (simulationContour.ts): a historical
 * simulation has no identity in the real ledger, even if it ever reached
 * the published catalogue, and its market behaves as one continuous,
 * restart-proof model. Synthetic fixtures only; no database, no network.
 */
import { importHistoricalHourlyCsv } from '../../../shared/listingHistoricalReplay';
import { defaultScenarioControls, type ScenarioControlsProgram } from '../../../shared/listingScenarioControls';
import { checkPublishable, listingSimulationConfig, parseListingConfig, type ListingConfig, type PublishedListing } from '../listingConfig';
import { setManagedListingAssets } from '../managedSnapshot';
import { allocateListingOwner } from '../ownerAllocation';
import { HISTORICAL_DEMO_MESSAGE, isHistoricalDemoAsset, isHistoricalDemoConfig } from '../simulationContour';
import { assertSpotListing, spotPriceSource } from '../../testMarkets/nrxSpot';
import { isTestAssetPairOrSymbol } from '../../testMarkets/testAssetConfig';
import { simulationFor } from '../../testMarkets/testMarketSimulation';
import { collateralMarket } from '../../../private-trading/native/service';
import { WalletPortfolioService } from '../../WalletPortfolioService';

const HOUR = 3_600_000;
const LISTING_AT = '2026-11-01T00:00:00.000Z';
const FROM = Date.parse(LISTING_AT);

/** Synthetic hourly OHLC (not market data): +1.5%, −0.9%, +0.2% repeating. */
function csv(hours: number, start = '2018-01-01T00:00:00Z'): string {
  let price = 100;
  return Array.from({ length: hours }, (_, i) => {
    const open = price, close = open * (1 + (i % 3 === 0 ? .015 : i % 3 === 1 ? -.009 : .002));
    price = close;
    return [Date.parse(start) / 1000 + i * 3600, open, Math.max(open, close) * 1.004, Math.min(open, close) * .996, close, 500, 12].join(',');
  }).join('\n');
}
const BTC = importHistoricalHourlyCsv(csv(72), 'BTC/USDT');
const ETH = importHistoricalHourlyCsv(csv(48, '2021-01-01T00:00:00Z'), 'ETH/USDT');

function program(afterGrowth: 'range' | 'historical' = 'historical'): ScenarioControlsProgram {
  const base = defaultScenarioControls('2', 'CALM');
  const stages = [...base.stages, { type: 'pullback' as const, durationHours: 24, targetPrice: '10' }];
  return afterGrowth === 'historical'
    ? { ...base, stages, afterGrowth, historical: { version: 1, clips: [BTC, ETH] } }
    : { ...base, stages, afterGrowth };
}
const STAGES_END = program().stages.reduce((hours, stage) => hours + stage.durationHours, 0);
const REPLAY_HOURS = BTC.bars.length + ETH.bars.length;

const config = (extra: Partial<ListingConfig> = {}): ListingConfig => parseListingConfig({
  schemaVersion: 1, symbol: 'HSX', name: 'Historical demo', logo: null, initialPrice: '2', listingAt: LISTING_AT,
  displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'manual', seed: 'hsx-20261101-synthetic', tradable: false,
  simulationProgram: program(), ...extra,
});
/** As if the catalogue ever carried it: the gates below must not depend on publication being refused. */
const published = (cfg: ListingConfig): PublishedListing => ({ id: 'hsx-1', version: 1, publishedAt: '2026-10-31T00:00:00Z', config: cfg });

afterEach(() => { setManagedListingAssets([]); jest.restoreAllMocks(); });

describe('historical demo contour: no real-ledger identity', () => {
  test('the contour is exactly the historical continuation, never another program', () => {
    expect(isHistoricalDemoConfig(config())).toBe(true);
    expect(isHistoricalDemoAsset(listingSimulationConfig(config()))).toBe(true);
    const range = config({ simulationProgram: program('range') });
    expect(isHistoricalDemoConfig(range)).toBe(false);
    expect(isHistoricalDemoAsset(listingSimulationConfig(range))).toBe(false);
    expect(isHistoricalDemoAsset(null)).toBe(false);
  });

  test('a historical listing holds no inventory, is never tradable and is never published', () => {
    expect(() => config({ ownerAllocation: '5' })).toThrow(expect.objectContaining({ code: 'HISTORICAL_DEMO_NO_LEDGER' }));
    expect(() => config({ tradable: true })).toThrow(expect.objectContaining({ code: 'DEMO_ONLY' }));
    expect(() => checkPublishable(config(), null, FROM - 7 * 24 * HOUR)).toThrow(expect.objectContaining({ code: 'HISTORICAL_RIGHTS_UNVERIFIED' }));
    // Unchanged elsewhere: an ordinary bounded scenario keeps its allocation field.
    expect(config({ simulationProgram: program('range'), ownerAllocation: '5' }).ownerAllocation).toBe('5');
  });

  test('if it ever reached the catalogue, every real-money path still refuses it', () => {
    setManagedListingAssets([listingSimulationConfig(config())]);
    // Restricted asset: deposits, withdrawals, adjustments and demo orders refuse it (isTestAssetPairOrSymbol).
    expect(isTestAssetPairOrSymbol('HSX')).toBe(true);
    expect(isTestAssetPairOrSymbol('HSX/USDT')).toBe(true);
    expect(collateralMarket('HSX')).toBeNull();
    // Spot: refused before, during and long after its listing time.
    for (const at of [FROM - HOUR, FROM, FROM + (STAGES_END + 1) * HOUR, FROM + 400 * 24 * HOUR]) {
      expect(() => assertSpotListing('HSX/USDT', at)).toThrow(HISTORICAL_DEMO_MESSAGE);
    }
  });

  test('its model price never triggers a conditional order, and the venue is not asked either', async () => {
    setManagedListingAssets([listingSimulationConfig(config())]);
    const venue = { getTicker: jest.fn(async () => ({ lastPrice: '999' })) };
    const at = FROM + (STAGES_END + 3) * HOUR;
    expect(await spotPriceSource(venue, () => at).getTicker('HSX/USDT')).toBeNull();
    expect(venue.getTicker).not.toHaveBeenCalled();
  });

  test('it is never valued in a wallet, while an ordinary managed listing keeps its canonical price', async () => {
    const ordinary = listingSimulationConfig(config({ symbol: 'RNG', seed: 'rng-20261101-synthetic', simulationProgram: program('range') }));
    setManagedListingAssets([listingSimulationConfig(config()), ordinary]);
    const now = FROM + (STAGES_END + 5) * HOUR;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    // Even a venue ticker under the same base does not value it.
    const marketData = { getTickers: jest.fn(async () => [{ pair: 'HSX/USDT', lastPrice: '777' }, { pair: 'BTC/USDT', lastPrice: '100000' }]) } as any;
    const service = new WalletPortfolioService({} as any, marketData, { isConfigured: () => false } as any);
    const prices = await service.pricesFor(['HSX', 'RNG', 'BTC', 'USDT']);
    expect(prices.get('HSX')).toBeNull();
    expect(prices.get('RNG')).toBe(simulationFor(ordinary).priceAt(now));
    expect(prices.get('BTC')).toBe(100000);
    expect(prices.get('USDT')).toBe(1);
  });

  test('no owner allocation is ever credited, before any database call', async () => {
    const tx = jest.fn();
    const db = { $transaction: tx } as any;
    // Even a malformed catalogue entry that slipped past parseListingConfig.
    const listing = published({ ...config(), ownerAllocation: '1000' });
    await expect(allocateListingOwner(db, listing, 'admin-id')).rejects.toThrow('historical simulation');
    expect(tx).not.toHaveBeenCalled();
  });
});

describe('historical demo contour: one continuous, restart-proof model', () => {
  const asset = () => listingSimulationConfig(config());

  test('phases run in order: planned stages end on their targets, then each source hour, then neutral motion', () => {
    const sim = simulationFor(asset());
    const stages = program().stages;
    let at = FROM;
    for (const stage of stages) {
      at += stage.durationHours * HOUR;
      // Stage boundaries are exact: the noise envelope is zero there.
      expect(sim.priceAt(at)).toBeCloseTo(Number(stage.targetPrice), 5);
    }
    // Historical hour k ends at anchor × Π(1 + close_i); BTC first, then ETH from BTC's last close.
    let expected = Number(stages[stages.length - 1].targetPrice);
    [...BTC.bars, ...ETH.bars].forEach(([, , close], k) => {
      expected *= 1 + close / 1_000_000;
      if (k % 13 === 0 || k === BTC.bars.length - 1 || k === REPLAY_HOURS - 1) {
        expect(sim.priceAt(FROM + (STAGES_END + k + 1) * HOUR)).toBeCloseTo(expected, 4);
      }
    });
    // After the last clip the model stays near its last close: no return to a start price, no new trend.
    const tail = Array.from({ length: 48 }, (_, h) => sim.priceAt(FROM + (STAGES_END + REPLAY_HOURS + h + 1) * HOUR)!);
    for (const price of tail) expect(Math.abs(price / expected - 1)).toBeLessThan(.01);
  });

  test('no price jump at any seam: final fall → BTC → ETH → neutral motion', () => {
    const sim = simulationFor(asset());
    const seams = [STAGES_END, STAGES_END + BTC.bars.length, STAGES_END + REPLAY_HOURS];
    for (const hour of seams) {
      const seam = FROM + hour * HOUR;
      const before = sim.priceAt(seam - 10_000)!, at = sim.priceAt(seam)!, after = sim.priceAt(seam + 10_000)!;
      expect(Math.abs(at / before - 1)).toBeLessThan(.005);
      expect(Math.abs(after / at - 1)).toBeLessThan(.005);
    }
  });

  test('every ten-second model event exists once: unique ids, one per tick, identical when recomputed', () => {
    const now = FROM + (STAGES_END + BTC.bars.length) * HOUR + 30 * 60_000;
    const first = simulationFor(asset()).recentTrades(now, 500);
    expect(first).toHaveLength(500);
    expect(new Set(first.map(trade => trade.id)).size).toBe(500);
    first.slice(1).forEach((trade, i) => expect(first[i].timestamp - trade.timestamp).toBe(10_000));
    expect(simulationFor(asset()).recentTrades(now, 500)).toEqual(first);
    // Minute candles across the BTC → ETH seam: one per minute, none repeated.
    const candles = simulationFor(asset()).candles1m(now, now - 2 * HOUR);
    candles.slice(1).forEach((candle, i) => expect(candle.openTime - candles[i].openTime).toBe(60_000));
  });

  test('a restart (fresh process, configuration re-read from storage) continues the same market', () => {
    const warm = simulationFor(asset());
    const times = [FROM + 30 * 60_000, FROM + (STAGES_END - 1) * HOUR, FROM + (STAGES_END + 7) * HOUR + 40_000,
      FROM + (STAGES_END + BTC.bars.length + 2) * HOUR, FROM + (STAGES_END + REPLAY_HOURS + 30) * HOUR];
    const warmPrices = times.map(t => warm.priceAt(t));
    const warmCandles = warm.candles1m(times[2], times[2] - HOUR);
    const stored = JSON.stringify(config());
    let cold: { prices: (number | null)[]; candles: unknown } | undefined;
    jest.isolateModules(() => {
      // New module instances: empty simulation caches and indexes, exactly as after a restart.
      const listing = require('../listingConfig') as typeof import('../listingConfig');
      const simulation = require('../../testMarkets/testMarketSimulation') as typeof import('../../testMarkets/testMarketSimulation');
      const fresh = simulation.simulationFor(listing.listingSimulationConfig(listing.parseListingConfig(JSON.parse(stored))));
      cold = { prices: times.map(t => fresh.priceAt(t)), candles: fresh.candles1m(times[2], times[2] - HOUR) };
    });
    expect(cold!.prices).toEqual(warmPrices);
    expect(cold!.candles).toEqual(warmCandles);
  });
});
