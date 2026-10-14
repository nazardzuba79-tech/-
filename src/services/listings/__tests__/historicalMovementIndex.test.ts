import { createHash } from 'node:crypto';
import { freezeHistoricalMoveProgram, historicalReplayHour, validateHistoricalMoveProgram,
  type HistoricalMoveProgram, type HistoricalMoveBar, type HistoricalMoveSource } from '../../../shared/listingHistoricalReplay';
import { controlledScenarioHour, type ControlledScenarioConfig } from '../../testMarkets/simulationScenarioControls';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { listingSimulationConfig, parseListingConfig, checkPublishable } from '../listingConfig';
import { HISTORICAL_PRESETS } from '../../../../frontend/src/pages/admin/historicalArchiveStore';

/** Mathematical test vectors, NOT real BTC/ETH/SOL market history. */
function fixture(lengths: number[]): HistoricalMoveProgram {
  let offset = 0;
  const sources: HistoricalMoveSource[] = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
  return { version: 1, clips: lengths.map((length, i) => ({
    source: sources[i], sourceStart: '2021-01-01T00:00:00.000Z',
    resolution: '1h', provenance: 'USER_SUPPLIED_UNVERIFIED',
    bars: Array.from({ length }, (): HistoricalMoveBar => [2400, -2200, (offset++ * 7919 % 1801) - 900]),
  })) };
}
function config(program: HistoricalMoveProgram, anchor = 10): ControlledScenarioConfig {
  return { mode: 'scenario-controls-v2', version: 2, from: Date.parse('2026-11-01T00:00:00Z'), initialPrice: '2',
    controls: { ...defaultScenarioControls('2', 'CALM'), afterGrowth: 'historical', historical: program,
      stages: [{ type: 'growth', durationHours: 24, targetPrice: String(anchor) }] } };
}

// Pinned with the exact pre-optimization 9f0d2601 shared and runtime sources.
// Source blobs: cb90f0b89538324bb0212a14f8a28552221b9312 / 0f3331e3c56bf478052fad90984b4f2b41d067a7.
const GOLDENS: [number[], string][] = [
  [[2160], 'acc81a5ce4d3b17449df358f0135a6c238af17bc9d08fb1e79352a0d24f11fbd'],
  [[2400, 2400], 'b7eeb8100aa1b9db5b83dd6c2702e0a0e63275bba3919b764f12ac12f4138168'],
  [[1600, 1600, 1600], '35efd62b8fafb5816189b8e47b632fc1dd61ce670b88186f096c0c9668c399bb'],
];

describe('historical movement bounded immutable open-price index', () => {
  test.each(GOLDENS)('all hours and every tick keep exact baseline hash for %j', (lengths, golden) => {
    const mutable = fixture(lengths), immutable = freezeHistoricalMoveProgram(mutable);
    const runtimeConfig = config(immutable), total = lengths.reduce((a, b) => a + b, 0);
    const referenceHash = createHash('sha256'), indexedHash = createHash('sha256'), runtimeHash = createHash('sha256');
    // Includes both the first post-history hour and the following permanent-range hour.
    for (let hour = 0; hour <= total + 1; hour++) {
      referenceHash.update(JSON.stringify(historicalReplayHour(mutable, 10, hour, 'qa-seed')));
      indexedHash.update(JSON.stringify(historicalReplayHour(immutable, 10, hour, 'qa-seed')));
      runtimeHash.update(JSON.stringify(controlledScenarioHour(runtimeConfig, 'qa-seed', hour + 24)));
    }
    expect(referenceHash.digest('hex')).toBe(golden);
    expect(indexedHash.digest('hex')).toBe(golden);
    expect(runtimeHash.digest('hex')).toBe(golden);
  }, 120_000);

  test('random order, anchors, seeds, eviction and reconstructed configurations are independent', () => {
    const mutable = fixture([1600, 1600, 1600]), frozen = freezeHistoricalMoveProgram(mutable);
    for (let i = 0; i < 40; i++) {
      const hour = i * 7919 % 4800, anchor = i % 2 ? 0.0000001 : 12345.6789, seed = 'seed-' + i % 5;
      const expected = historicalReplayHour(mutable, anchor, hour, seed);
      expect(historicalReplayHour(frozen, anchor, hour, seed)).toEqual(expected);
      expect(controlledScenarioHour(config(frozen, anchor), seed, hour + 24)).toEqual(expected);
    }
    const before = historicalReplayHour(frozen, 10, 4799, 'reopen');
    for (let i = 0; i < 10; i++) {
      const other = freezeHistoricalMoveProgram(fixture([24]));
      historicalReplayHour(other, i + 1, 0, 'other');
      controlledScenarioHour(config(other, i + 1), 'other', 24);
    }
    expect(historicalReplayHour(frozen, 10, 4799, 'reopen')).toEqual(before);
    expect(controlledScenarioHour(config(frozen), 'reopen', 4823)).toEqual(before);
    expect(historicalReplayHour(freezeHistoricalMoveProgram(JSON.parse(JSON.stringify(mutable))), 10, 4799, 'reopen')).toEqual(before);
  });

  test('snapshot ownership and shallow-freeze fallback prevent stale-price caching', () => {
    const mutable = fixture([24]), frozen = freezeHistoricalMoveProgram(mutable);
    expect(JSON.stringify(frozen)).toBe(JSON.stringify(mutable));
    expect(Object.isFrozen(mutable)).toBe(false);
    expect(Object.isFrozen(mutable.clips[0].bars[0])).toBe(false);
    expect(Object.isFrozen(frozen.clips[0].bars[0])).toBe(true);
    const old = historicalReplayHour(frozen, 10, 23, 'qa');
    mutable.clips[0].bars[0][2] += 100;
    expect(historicalReplayHour(frozen, 10, 23, 'qa')).toEqual(old);
    expect(historicalReplayHour(mutable, 10, 23, 'qa')).not.toEqual(old);
    const shallow = Object.freeze(fixture([24]));
    historicalReplayHour(shallow, 10, 23, 'qa');
    shallow.clips[0].bars[0][2] += 100;
    expect(historicalReplayHour(shallow, 10, 23, 'qa')).toEqual(historicalReplayHour(mutable, 10, 23, 'qa'));
    mutable.clips[0].bars[0][0] = -1;
    expect(() => historicalReplayHour(mutable, 10, 23, 'qa')).toThrow();
    expect(() => freezeHistoricalMoveProgram(mutable)).toThrow();
  });

  test('a warm lookup does not revisit prior candle arrays', () => {
    let reads = 0;
    const mutable = fixture([2400, 2400]);
    const clips = mutable.clips.map(clip => {
      clip.bars.forEach(bar => Object.freeze(bar));
      Object.freeze(clip.bars);
      const bars = new Proxy(clip.bars, { get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      } });
      return Object.freeze({ ...clip, bars });
    });
    Object.freeze(clips);
    const frozen = Object.freeze({ version: 1 as const, clips });
    historicalReplayHour(frozen, 10, 4799, 'qa');
    const runtimeConfig = config(frozen);
    controlledScenarioHour(runtimeConfig, 'qa', 4823);
    expect(reads).toBeGreaterThan(4800);
    reads = 0;
    for (const hour of [4799, 0, 2400, 10, 1600, 4800, 9000]) {
      historicalReplayHour(frozen, 10, hour, 'qa');
      controlledScenarioHour(runtimeConfig, 'qa', hour + 24);
    }
    expect(reads).toBe(0);
  });

  test('server simulation mapping owns the snapshot but keeps the publication gate', () => {
    const controls = defaultScenarioControls('2', 'CALM');
    const original = { ...controls, afterGrowth: 'historical' as const, historical: fixture([24]),
      stages: [...controls.stages, { type: 'pullback' as const, durationHours: 24, targetPrice: '10' }] };
    const parsed = parseListingConfig({ schemaVersion: 1, symbol: 'QAX', name: 'Index review', logo: null,
      initialPrice: '2', listingAt: '2026-11-01T00:00:00Z', displayTimeZone: 'UTC', ownerAllocation: '0',
      seedMode: 'manual', seed: 'review-seed-123', tradable: false, simulationProgram: original });
    const mapped = listingSimulationConfig(parsed).scheduledScenario;
    if (mapped?.mode !== 'scenario-controls-v2') throw new Error('Expected controlled scenario');
    expect(Object.isFrozen(mapped.controls.historical)).toBe(true);
    expect(Object.isFrozen(original.historical)).toBe(false);
    expect(mapped.controls.historical).toEqual(original.historical);
    expect(() => checkPublishable(parsed, null, Date.parse('2026-10-31T00:00:00Z'))).toThrow(/Историческое движение/);
    expect(() => parseListingConfig({ ...parsed, tradable: true })).toThrow(/DEMO|demo/i);
  });

  test('hour, clip and total-size limits are not relaxed', () => {
    const frozen = freezeHistoricalMoveProgram(fixture([24]));
    for (const hour of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => historicalReplayHour(frozen, 10, hour, 'qa')).toThrow();
    }
    expect(() => validateHistoricalMoveProgram(fixture([2401]))).toThrow();
    expect(() => validateHistoricalMoveProgram(fixture([2400, 2400, 24]))).toThrow();
  });

  test('every preset explicitly promises 90 days from its actual UTC start, not a calendar quarter', () => {
    for (const preset of HISTORICAL_PRESETS) {
      expect(preset.hours).toBe(90 * 24);
      expect(preset.label).toContain(`90 дней с ${preset.startDateUtc} (UTC)`);
      expect(preset.label).not.toMatch(/январь—март|апрель—июнь|октябрь—декабрь/);
    }
    const april = HISTORICAL_PRESETS.find(p => p.id === 'btc-2018-apr')!;
    const end = new Date(Date.parse(april.startDateUtc + 'T00:00:00.000Z') + april.hours * 3_600_000);
    expect(end.toISOString()).toBe('2018-06-30T00:00:00.000Z'); // exclusive: June 30 is not claimed.
  });
});
