import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { listingSimulationConfig, parseListingConfig } from '../../listings/listingConfig';
import { NEURIX } from '../neurix';
import { VOLTORA } from '../testAssetConfig';
import { HOUR_MS, TestMarketSimulation } from '../testMarketSimulation';

const { projectLegacySources } = require('../../../../scripts/nrx-legacy-source.cjs');
const { TRAJECTORY_FILES } = require('../../../../scripts/check-nrx-scenario-release.cjs');

// Independently derived with git show and the unmodified simulation from the
// serving production commit 6afe21b0a278d4b01605cf945eaed651f864cd69.
// These expectations do not require Git history in CI and must never be
// regenerated from the candidate implementation to make a release pass.
const PRODUCTION_SOURCE_HASHES: Record<string, string> = {
  'testMarketSimulation.ts': 'a0e96c1b5fc9b49ca594acd9ffc7c917f2d563d966bcceca582b243ad242097a',
  'simulationSchedule.ts': '58b6aaf49bfbf931bb00033c626e75481930cd67c8d80f2d250c0874ae649d7d',
  'simulationRandom.ts': '78350ed31778b038f185dbb7fd484c7ec8364c4e805e78dcdb315f764618787a',
  'simulationWaves.ts': 'd767ef4554f05025537d28f6201856bee87cab9eb92634bc50d60df9b496beb5',
  'simulationRealism.ts': 'b5056e33a34bb99ba52a69c82ba4dca06e6392b37ffaa2ed463ba0d6ce4fe0a7',
  'simulationCycles.ts': '4b5493b220b54622c8cd7f0972dc4293fb115fae1b86686204f533f098df5f29',
  'simulationAccumulation.ts': 'e1719dab320c7a7ea603d689f2185669b38ae3a8f623fb5e9b0eb5f93cdd4ccc',
  'simulationNaturalWicks.ts': 'ca9a1a8ba7288b9210fad80abfc6ee8ab435c6e5fd249f3921561ac73e4db329',
};
const PRODUCTION_HISTORY_HASHES: Record<string, string> = {
  VTA: '2b09f7addfb5efddc24b504ce488b3789370dbbc3625a3e3b7a893187b9560c7',
  NRX: 'a98d2d120c3a671efb4dcd1e8a200ee5fa8fac50de8f5344d22884ece25c82b2',
  AITH: '1f0b0221e7f25ce8ce913c9c800e654bb31038079ebe41ff95a68132fd4303c0',
};
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const hash = (value: unknown) => sha256(JSON.stringify(value));
const readSource = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const aith = parseListingConfig(JSON.parse(readFileSync(resolve(__dirname, '../../../../config/test-markets/aith.draft.json'), 'utf8')));

test('legacy projection reconstructs every exact production source byte after LF normalization', () => {
  const sources = Object.fromEntries(TRAJECTORY_FILES.map((file: string) => [file, readSource(file)]));
  const projected = projectLegacySources(sources, readSource);
  expect(Object.keys(projected).sort()).toEqual(Object.keys(PRODUCTION_SOURCE_HASHES).sort());
  for (const [file, expected] of Object.entries(PRODUCTION_SOURCE_HASHES)) {
    expect({ file, sha256: sha256(projected[file]) }).toEqual({ file, sha256: expected });
  }
});

test.each([VOLTORA, NEURIX, listingSimulationConfig(aith)])(
  '$symbol preserves production candles, prices and completed ticks from launch through day fourteen',
  (asset) => {
    const sim = new TestMarketSimulation(asset);
    const values = [0, 1, 23, 24, 48, 72, 80, 168, 336].map(h => ({
      h,
      c: sim.candles5m(asset.listingAt + h * HOUR_MS, asset.listingAt + h * HOUR_MS - HOUR_MS),
      p: sim.priceAt(asset.listingAt + h * HOUR_MS),
      t: sim.recentTrades(asset.listingAt + h * HOUR_MS, 2),
    }));
    expect(hash(values)).toBe(PRODUCTION_HISTORY_HASHES[asset.symbol]);
  },
);

test('NRX production history is identical immediately before, at and after every active schedule boundary', () => {
  expect(NEURIX.scheduledScenario).toMatchObject({
    mode: 'range-selloff-range', version: 5,
    from: 1791306000000, rangeEndAt: 1791307800000, selloffEndAt: 1791329400000,
  });
  const sim = new TestMarketSimulation(NEURIX);
  const times = [1791306000000, 1791307800000, 1791329400000]
    .flatMap(at => [at - 10_000, at, at + 10_000]);
  const values = times.map(at => ({
    at, candles: sim.candles5m(at, at - HOUR_MS),
    price: sim.priceAt(at), trades: sim.recentTrades(at, 6),
  }));
  expect(hash(values)).toBe('6bd522ac621c625bf8b572e2757c5d284e76e66c2bc533411f5f14e63c812a3f');
});

test('AITH remains the existing capped v1 demo with its original launch and no prelaunch candles or ticks', () => {
  expect(aith).toMatchObject({
    symbol: 'AITH', name: 'Aitheron AI', initialPrice: '0.80',
    listingAt: '2026-10-11T15:00:00Z', tradable: false,
    simulationProgram: {
      kind: 'capped-growth-range-v1', first24hGainPercent: 1725,
      maxGainPercent: 9247, peakAfterHours: 168, rangeFraction: 0.12,
    },
  });
  const asset = listingSimulationConfig(aith);
  expect(asset.isTradable).toBe(false);
  expect(asset.scheduledScenario?.mode).toBe('capped-growth-range');
  const sim = new TestMarketSimulation(asset);
  expect(sim.candles5m(asset.listingAt - 1, asset.listingAt - HOUR_MS)).toEqual([]);
  expect(sim.recentTrades(asset.listingAt - 1, 10)).toEqual([]);
  expect(sim.priceAt(asset.listingAt + 24 * HOUR_MS)).toBe(14.6);
  const cap = asset.initialPrice * (1 + 9247 / 100);
  expect(cap).toBe(74.776);
  for (const hours of [24, 72, 168, 336]) {
    const at = asset.listingAt + hours * HOUR_MS;
    for (const candle of sim.candles5m(at, at - HOUR_MS)) {
      expect(Math.max(candle.open, candle.high, candle.close, candle.low)).toBeLessThanOrEqual(cap);
    }
    for (const trade of sim.recentTrades(at, 6)) expect(Number(trade.price)).toBeLessThanOrEqual(cap);
  }
});
