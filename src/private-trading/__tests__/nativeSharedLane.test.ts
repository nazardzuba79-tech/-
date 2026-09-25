import { PrismaClient } from '@prisma/client';
import { NativeDemoService } from '../native/service';
import { PrismaNativeRepository } from '../native/store';
import { NativeLimitPass, NATIVE_LIMIT_PASS_MAX_MS, NATIVE_LIMIT_PASS_MS, nativeLimitPassIntervalMs } from '../native/limitPass';
import { PrivateTradingMarketData } from '../marketData';
import { setup, actor, key, H, H0 } from '../native/testing/liveFixture';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

describe('native executor cadence budget', () => {
  test('keeps the established default and accepts only bounded slower sampling', () => {
    expect(nativeLimitPassIntervalMs(undefined)).toBe(NATIVE_LIMIT_PASS_MS);
    expect(nativeLimitPassIntervalMs('60000')).toBe(60_000);
    expect(nativeLimitPassIntervalMs(String(NATIVE_LIMIT_PASS_MAX_MS))).toBe(NATIVE_LIMIT_PASS_MAX_MS);
    for(const invalid of ['0','9999','300001','1.5','nope',''])expect(nativeLimitPassIntervalMs(invalid)).toBe(NATIVE_LIMIT_PASS_MS);
  });
});

describe('HTTP and executor share the native account command lane', () => {
  beforeEach(() => jest.spyOn(console, 'info').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('production repositories identify the same DB client without sharing their execution cache', () => {
    const db = {} as PrismaClient, config = () => ({ enabled: true, ownerId: actor.userId });
    const http = new PrismaNativeRepository(db, config);
    const worker = new PrismaNativeRepository(db, config, true);
    expect(http.commandLaneScope).toBe(db);
    expect(worker.commandLaneScope).toBe(db);
    expect(new PrismaNativeRepository({} as PrismaClient, config).commandLaneScope).not.toBe(db);
  });

  test('partial CLOSE waits outside the transaction for executor commit, then uses the new revision exactly once', async () => {
    const f = setup({ price: '81000' });
    const market = Object.create(f.market) as PrivateTradingMarketData;
    market.historicalDemoPrices = f.market.marks.bind(f.market);
    market.resolveCandle = async s => ({ symbol: s.symbol, source: 'BYBIT_LINEAR', interval: s.interval, intervalMs: H,
      openTime: s.openTime, closeTime: s.openTime + H, effectiveAt: s.openTime, price: '60000', pricePoint: s.pricePoint,
      candle: { timestamp: s.openTime, open: '60000', high: '60000', low: '60000', close: '60000', volume: '10' },
      fetchedAt: f.clock.now(), verification: 'VERIFIED' });
    const initial = new NativeDemoService(f.repo, market, f.clock.now);
    await initial.initialize(actor, key());
    const opened = await initial.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '0.003', leverage: '10',
      candle: { source: 'BYBIT_LINEAR', interval: '1h', openTime: H0 - H, pricePoint: 'OPEN' }, idempotencyKey: key() });
    const scope = {}, repository = () => new Proxy(f.repo, { get(target, property) {
      if (property === 'commandLaneScope') return scope;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const http = new NativeDemoService(repository(), market, f.clock.now);
    const worker = new NativeDemoService(repository(), market, f.clock.now);
    const entered = deferred(), release = deferred(), commit = f.repo.commit.bind(f.repo);
    let first = true, concurrent = 0, maximum = 0;
    jest.spyOn(f.repo, 'commit').mockImplementation(async (...args) => {
      concurrent++; maximum = Math.max(maximum, concurrent);
      try { if (first) { first = false; entered.resolve(); await release.promise; } return await commit(...args); }
      finally { concurrent--; }
    });
    const refresh = worker.command(actor, { kind: 'REFRESH', idempotencyKey: key() }, { persist: true });
    await entered.promise;
    let close: ReturnType<NativeDemoService['command']> | undefined;
    const draft = { kind: 'CLOSE' as const, positionId: opened.positions[0].id, quantity: '0.001', idempotencyKey: key() };
    try {
      expect(http.queued(actor.userId)).toBe(1);
      close = http.command(actor, draft);
      expect(worker.queued(actor.userId)).toBe(2);
      // The scheduled pass must see HTTP work and skip instead of competing for the row lock.
      const execute = jest.spyOn(worker, 'command');
      await new NativeLimitPass(worker, async () => [actor], f.clock.now).tick();
      expect(execute).not.toHaveBeenCalled();
    } finally { release.resolve(); await refresh; }
    const result = await close!;
    expect(maximum).toBe(1);
    expect(result.positions[0].quantity).toBe('0.002');
    expect(result.positions[0].entryPrice).toBe('60000');
    expect(result.positions[0].markPrice).toBe('81000');
    expect(result.ledger?.reconciled).toBe(true);
    const commits = f.repo.commits;
    const duplicate = await worker.command(actor, draft);
    expect(duplicate.revision).toBe(result.revision);
    expect(f.repo.commits).toBe(commits);
    expect(f.repo.row!.snapshot.events.filter(e => e.kind === 'CLOSE')).toHaveLength(1);
    expect(http.queued(actor.userId)).toBe(0);
    expect(worker.queued(actor.userId)).toBe(0);
  });

  test('shared scheduling does not coalesce responses across service authorization contexts', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    const scope = {}, entered = deferred(), release = deferred();
    const repo = Object.assign(f.repo, { commandLaneScope: scope });
    const first = new NativeDemoService(repo, f.market as unknown as PrivateTradingMarketData, f.clock.now);
    const second = new NativeDemoService(repo, f.market as unknown as PrivateTradingMarketData, f.clock.now);
    const prior = f.repo.prior.bind(f.repo);
    const read = jest.spyOn(f.repo, 'prior').mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return prior(...args);
    });
    const a = first.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
    await entered.promise;
    const b = second.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
    expect(first.queued(actor.userId)).toBe(2);
    release.resolve(); await Promise.all([a, b]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
