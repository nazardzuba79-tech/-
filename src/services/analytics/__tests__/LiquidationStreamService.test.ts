import { LiquidationStreamService, buildObservedBuckets, normalizeLiquidation } from '../LiquidationStreamService';

function frame(time: number, side: 'BUY' | 'SELL' = 'SELL', st: number | undefined = 1, symbol = 'BTCUSDT') {
  return {
    e: 'forceOrder',
    E: time,
    ...(st === undefined ? {} : { st }),
    o: {
      s: symbol,
      S: side,
      q: '1',
      z: '1',
      p: '100',
      ap: '100',
      T: time,
    },
  };
}

describe('LiquidationStreamService', () => {
  const now = 1_800_000_000_000;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('normalizes USD-M liquidation direction and rejects non USD-M stream types', () => {
    expect(normalizeLiquidation(frame(now, 'SELL'))?.side).toBe('LONG');
    expect(normalizeLiquidation(frame(now, 'BUY'))?.side).toBe('SHORT');
    expect(normalizeLiquidation(frame(now, 'SELL', 2))).toBeNull();
  });

  test('accepts raw and combined-stream payloads and rejects malformed data', () => {
    expect(normalizeLiquidation({ data: frame(now, 'SELL') })?.symbol).toBe('BTCUSDT');
    expect(normalizeLiquidation({ e: 'forceOrder', o: { s: 'BTCUSDT' } })).toBeNull();
    expect(normalizeLiquidation(frame(now, 'SELL', 1, 'NOTREALUSDT'))).toBeNull();
  });

  test('deduplicates events and aggregates 4h, 12h and 24h windows without fake values', () => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const service = new LiquidationStreamService();
    const state = service as any;
    state.streamStartedAt = now - 30 * 60 * 60 * 1000;
    state.connected = true;
    state.coverageFloorAt = now - 30 * 60 * 60 * 1000;

    const recent = frame(now - 60 * 60 * 1000, 'SELL');
    expect(service.ingest(recent)).not.toBeNull();
    expect(service.ingest(recent)).toBeNull();
    service.ingest(frame(now - 6 * 60 * 60 * 1000, 'BUY'));
    service.ingest(frame(now - 20 * 60 * 60 * 1000, 'SELL'));

    const snapshot = service.snapshot('BTC');
    expect(snapshot.available).toBe(true);
    if (!snapshot.available) return;

    const counts = Object.fromEntries(snapshot.value.windows.map((window) => [window.hours, window.eventCount]));
    expect(counts[4]).toBe(1);
    expect(counts[12]).toBe(2);
    expect(counts[24]).toBe(3);
    expect(snapshot.value.windows.every((window) => window.coverageComplete)).toBe(true);
  });

  test('does not claim a full rolling window after a reconnect gap', () => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const service = new LiquidationStreamService();
    const state = service as any;
    state.streamStartedAt = now - 30 * 60 * 60 * 1000;
    state.connected = true;
    state.coverageFloorAt = now - 2 * 60 * 60 * 1000;
    service.ingest(frame(now - 60 * 60 * 1000));

    const snapshot = service.snapshot('BTC');
    expect(snapshot.available).toBe(true);
    if (!snapshot.available) return;
    expect(snapshot.value.windows.every((window) => window.coverageComplete === false)).toBe(true);
  });

  test('builds observed price buckets only from real events', () => {
    const events = [
      normalizeLiquidation(frame(now - 1, 'SELL'))!,
      normalizeLiquidation({ ...frame(now, 'BUY'), o: { ...frame(now, 'BUY').o, ap: '200', p: '200' } })!,
    ];
    const buckets = buildObservedBuckets(events);
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.reduce((sum, bucket) => sum + bucket.eventCount, 0)).toBe(2);
  });
});
