import catalog from '../../../shared/history20Regimes.json';
import {
  History20MinuteReplay,
  REGIME_MINUTES,
  type RegimeInterval,
} from '../../../shared/history20MinuteReplay';
import {
  checkPublishable,
  listingSimulationConfig,
  listingPreviewAssetConfig,
  parseListingConfig,
  withStableProfile,
} from '../listingConfig';
import { testMarketCandles } from '../../testMarkets/testMarketService';
import { VOLTORA } from '../../testMarkets/testAssetConfig';

const start = Date.UTC(2026, 10, 15, 13, 7);
const raw = new Float64Array([1, 1.2, 1, 1.2, 2, 1.19, 1.19, 0.9, 0.9, 3, 0.92, 1, 0.85, 0.92, 9]);
const make = () => new History20MinuteReplay(raw.slice());
const cfg = parseListingConfig({
  schemaVersion: 1,
  symbol: 'QA705',
  name: 'Draft test',
  logo: null,
  initialPrice: '2',
  listingAt: new Date(start).toISOString(),
  displayTimeZone: 'UTC',
  ownerAllocation: '0',
  tradable: false,
  seedMode: 'manual',
  seed: 'qa-regime-seed',
});
test('20 checksum-pinned minute sources; ordinal selection never modifies an existing ID', () => {
  expect(new Set(catalog.records.map((r) => r.sha256)).size).toBe(20);
  for (const [i, r] of catalog.records.entries()) {
    expect(r.sources.length).toBeGreaterThanOrEqual(2);
    expect(r.rows).toBe((Date.parse(r.endExclusive) - Date.parse(r.start)) / 60000);
    expect(r.minute.singleWick).toBeGreaterThan(0);
    expect(r.minute.unequalTwoWicks).toBeGreaterThan(0);
    expect(r.minute.relativeVolume[0]).toBeLessThan(r.minute.relativeVolume[2]);
    const draft = withStableProfile({ ...cfg, history20Regime: { version: 2, id: 'AUTO' } }, null, i + 20);
    expect(draft.history20Regime).toEqual({ version: 2, id: r.id, sha256: r.sha256 });
    expect(withStableProfile(cfg, draft, null)).toEqual(draft);
    expect(() => withStableProfile(draft, cfg, null)).toThrow();
    expect(() => withStableProfile({ ...cfg, tradable: true }, draft, null)).toThrow();
    expect(() =>
      withStableProfile({ ...draft, history20Regime: { version: 2, id: 'AUTO' } }, draft, null),
    ).toThrow();
    expect(() => checkPublishable(draft, null, 0)).toThrow(
      expect.objectContaining({ code: 'HISTORICAL_RIGHTS_UNVERIFIED' }),
    );
    expect(() => listingSimulationConfig(draft)).toThrow(expect.objectContaining({ code: 'HISTORICAL_RIGHTS_UNVERIFIED' }));
    expect(() => testMarketCandles(listingPreviewAssetConfig(draft), '1m', start)).toThrow('HISTORICAL_RIGHTS_UNVERIFIED');
  }
});
test('gaps between source close and next open, zero wicks, relative volume and endpoint survive mapping', () => {
  const bars = make().candles(start, 2, 'one', '1m', start + 180000);
  expect(bars.map((b) => [b.open, b.high, b.low, b.close, b.volume])).toEqual([
    [2, 2.4, 2, 2.4, 2],
    [2.38, 2.38, 1.8, 1.8, 3],
    [1.84, 2, 1.7, 1.84, 9],
  ]);
  expect(make().candles(start, 2, 'one', '1m', start - 1)).toEqual([]);
  expect(make().candles(start, 2, 'one', '1m', start + 999999)).toEqual(bars);
  expect(() => new History20MinuteReplay(new Float64Array([1, 0.9, 1, 1, 1]))).toThrow();
});
test('UTC bucket parity, arbitrary launch minute, no next-bar leakage and fresh instance determinism', () => {
  for (const frame of Object.keys(REGIME_MINUTES) as RegimeInterval[]) {
    for (const elapsed of [0, 7139, 20000, 39999, 59999, 60000, 74444, 119999, 120000, 180000]) {
      const fine = make().candles(start, 2, 'seed', '1m', start + elapsed);
      const coarse = make().candles(start, 2, 'seed', frame, start + elapsed);
      const expected = new Map<number, typeof fine>();
      const seconds = REGIME_MINUTES[frame] * 60;
      for (const minute of fine) {
        const t = Math.floor(minute.time / seconds) * seconds;
        expected.set(t, [...(expected.get(t) ?? []), minute]);
      }
      expect(coarse).toEqual(
        [...expected].map(([time, ms]) => ({
          time,
          open: ms[0].open,
          high: Math.max(...ms.map((m) => m.high)),
          low: Math.min(...ms.map((m) => m.low)),
          close: ms[ms.length - 1].close,
          volume: ms.reduce((a, m) => a + m.volume, 0),
        })),
      );
      const changed = raw.slice();
      changed.set([2, 3, 1, 2, 300], 10);
      if (elapsed < 120000)
        expect(new History20MinuteReplay(changed).candles(start, 2, 'seed', frame, start + elapsed)).toEqual(
          coarse,
        );
      expect(make().candles(start, 2, 'seed', frame, start + elapsed)).toEqual(coarse);
    }
  }
  expect(make().candles(start, 2, 'one', '1m', start)[0]).toMatchObject({
    open: 2,
    high: 2,
    low: 2,
    close: 2,
    volume: 0,
  });
  expect(() => testMarketCandles({ ...VOLTORA, history20Regime: 'R01' }, '1m', start)).toThrow(
    'HISTORICAL_RIGHTS_UNVERIFIED',
  );
});

test('source buffers cannot repaint closed candles after verification', () => {
  const source = raw.slice();
  const replay = new History20MinuteReplay(source);
  const history = replay.candles(start, 2, 'immutable', '1m', start + 180000);
  source.fill(0);
  expect(replay.candles(start, 2, 'immutable', '1m', start + 180000)).toEqual(history);
});
