/**
 * History20 wired into the native Futures TEST account: server pins, the
 * registry that loads them from the listing store, the test-only model
 * contract on the existing engine, the labelled model chart, the draft-edit
 * guard and the withdrawal hold on model-generated gains. Synthetic fixtures,
 * an in-memory repository and a fake venue only.
 */
import BigNumber from 'bignumber.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { actor, setup, key } from '../native/testing/liveFixture';
import { CHOICE, CONTRACT, DAY, FROM, M, adminListing, firstTick, growth, modelPrice, windowConfig } from '../native/testing/history20Fixture';
import { NativeCommand, NativeDemoService } from '../native/service';
import { nativeDemoRoutes } from '../native/routes';
import { withdrawableRows, history20Gains } from '../native/withdrawable';
import {
  HISTORY20_PRICE_SOURCE, History20PriceSource, History20Registry, guardHistory20Listings, history20Market, history20PinsFromEnvironment,
  history20Models, history20TestContract, isHistory20Contract, type History20Pin,
} from '../native/history20Prices';
import { PrivateTradingService } from '../service';
import type { PrivateTradingMarketData } from '../marketData';
import { ListingStoreError, type ListingStore } from '../../services/listings/store';
import { listingSimulationConfig } from '../../services/listings/listingConfig';
import { testMarketCandles } from '../../services/testMarkets/testMarketService';
import { adminListingsRouter } from '../../api/routes/adminListings';

const H = 3_600_000;
const PIN: History20Pin = { listingId: 'vhxt', symbol: 'VHXT', draftRevision: 3, logsSha256: growth.logsSha256, listingAt: '2026-09-13T00:00:00.000Z', intrabar: 'SEEDED_BRIDGE_OHLC_V2' };
const listings = (revision = 3) => ({ revision: 'r', serverTime: FROM, listings: [{ ...adminListing('vhxt', windowConfig()), draftRevision: revision }] });
const tick = (p: BigNumber) => p.decimalPlaces(8, BigNumber.ROUND_DOWN).toFixed();

/** The production market as `index.ts` builds it, over the fixture venue. */
function wired(store: Pick<ListingStore, 'list'> = { list: async () => listings() }, pins: History20Pin[] = [PIN], deposit = '1000') {
  const f = setup({ deposit });
  Object.assign(f.market, { historicalDemoPrices: f.market.marks.bind(f.market) });
  const venueSymbols: string[] = [];
  const venue = new Proxy(f.market, { get(target, prop) {
    const value = Reflect.get(target, prop, target);
    if (typeof value !== 'function') return value;
    return (...args: any[]) => { const a = args[0]; venueSymbols.push(...(Array.isArray(a) ? a : [typeof a === 'string' ? a : a?.symbol])); return value.apply(target, args); };
  } }) as unknown as PrivateTradingMarketData;
  const market = history20Market(venue, store, pins, f.clock.now);
  const service = new NativeDemoService(f.repo, market, f.clock.now);
  const command = (c: Omit<NativeCommand, 'idempotencyKey'>) => service.command(actor, { ...c, idempotencyKey: key() } as NativeCommand);
  const open = (extra: object) => command({ kind: 'OPEN', symbol: CONTRACT, side: 'LONG', type: 'LIMIT', leverage: '10', marginType: 'CROSS', executionMode: 'HISTORICAL_DEMO', ...extra } as NativeCommand);
  return { ...f, venue, venueSymbols, market, service, command, open };
}
const settle = async (f: ReturnType<typeof wired>) => {
  const wallet = (await f.service.wallet(actor))!;
  return { wallet, withdrawable: withdrawableRows(wallet, history20Gains(f.repo.row!.snapshot)).find(r => r.asset === 'USDT')!.available };
};

describe('server pins', () => {
  test('unset is none; a valid list is taken as given; anything invalid is none, logged by name only', () => {
    const log = jest.fn();
    expect(history20PinsFromEnvironment({}, log)).toEqual([]);
    expect(history20PinsFromEnvironment({ NATIVE_HISTORY20_PINS: JSON.stringify([PIN]) }, log)).toEqual([PIN]);
    for (const raw of ['{', JSON.stringify([{ ...PIN, draftRevision: 0 }]), JSON.stringify([PIN, PIN]), JSON.stringify([{ ...PIN, extra: 1 }])]) {
      expect(history20PinsFromEnvironment({ NATIVE_HISTORY20_PINS: raw }, log)).toEqual([]);
    }
    expect(log.mock.calls.every(([line]) => line === '[history20] NATIVE_HISTORY20_PINS ignored: invalid')).toBe(true);
  });

  test('no pin: the server market is the collector market itself', () => {
    const base = setup().market as unknown as PrivateTradingMarketData;
    expect(history20Market(base, { list: jest.fn() }, [])).toBe(base);
  });

  test('a pinned window is served only while the stored draft is exactly the pinned one; never another path, never the venue', async () => {
    let resolve!: (v: ReturnType<typeof listings>) => void;
    const list = jest.fn(() => new Promise<ReturnType<typeof listings>>(r => { resolve = r; }));
    const f = wired({ list });
    // Before the store answered: refused, and not asked of the venue.
    await expect(f.market.historicalDemoPrices([CONTRACT])).resolves.toEqual(new Map());
    await expect(f.market.instrument(CONTRACT)).rejects.toMatchObject({ code: 'history20_unavailable', status: 503 });
    resolve(listings());
    await new Promise(r => setImmediate(r));
    expect((await f.market.historicalDemoPrices([CONTRACT])).get(CONTRACT)!.markPrice).toBe(modelPrice(f.clock.now()).toFixed());
    const contract = await f.market.instrument(CONTRACT);
    expect(contract).toMatchObject({ provider: 'voltex-model', parameterModel: 'VOLTEX_HISTORY20_TEST_CONTRACT_V1', symbol: CONTRACT, launchTime: FROM,
      parameterVersion: `history20-test-v1:VHX-03-SOL:SEEDED_BRIDGE_OHLC_V2:${growth.logsSha256.slice(0, 16)}:r3:${FROM}` });
    expect(f.venueSymbols).not.toContain(CONTRACT);

    // The stored draft moved on (revision 4): the pin no longer matches and its contract stops, by name.
    const log = jest.fn(), stale = new History20Registry([PIN], { list: async () => listings(4) }, f.clock.now, log);
    await stale.load();
    expect(stale.sources()).toEqual([]);
    expect(log).toHaveBeenCalledWith('[history20] pin vhxt not served: history20_pin_mismatch');
    const other = new History20Registry([{ ...PIN, logsSha256: 'f'.repeat(64) }], { list: async () => listings() }, f.clock.now, log);
    await other.load();
    expect(other.sources()).toEqual([]);
  });
});

describe('the existing native engine on the pinned window, with the test-only model contract', () => {
  test('manual Buy then Sell (close): demo debit and credit by the normal rules; the journal records the pinned path; the venue is never asked', async () => {
    const f = wired();
    await f.market.instrument('BTCUSDT');
    await new Promise(r => setImmediate(r));
    await f.service.initialize(actor, key());
    const before = await settle(f), p0 = modelPrice(f.clock.now());
    await f.open({ price: tick(p0.times(1.01)), quantity: '50' });
    const opened = f.repo.row!.snapshot, position = opened.positions[0], entry = f.repo.row!.commands.find(c => c.kind === 'OPEN')!;
    expect(position.entryPrice).toBe(p0.toFixed());
    expect((entry as any).instrument.profile.riskModelVersion).toBe(`NATIVE_MARGIN_V3:history20-test-v1:VHX-03-SOL:SEEDED_BRIDGE_OHLC_V2:${growth.logsSha256.slice(0, 16)}:r3:${FROM}`);
    expect(opened.walletBalance).toBe(new BigNumber('1000').minus(position.openingFees).toFixed());
    // Margin is reserved from the existing demo USDT.
    expect(new BigNumber((await settle(f)).withdrawable).lt(before.withdrawable)).toBe(true);
    // Sell: close at the model price some minutes later.
    f.clock.t += 7 * M + 3_000;
    await f.command({ kind: 'CLOSE', positionId: position.id } as NativeCommand);
    const s = f.repo.row!.snapshot, exit = s.events.find(e => e.kind === 'CLOSE')!;
    expect(exit.price).toBe(modelPrice(f.clock.now()).toFixed());
    expect(exit.pricing).toBe('NEAR_LIVE_DEMO');
    const gross = new BigNumber(exit.price!).minus(position.entryPrice).times(position.quantity);
    expect(s.positions[0].realizedGross).toBe(gross.toFixed());
    expect(s.walletBalance).toBe(new BigNumber('1000').plus(gross).minus(s.positions[0].openingFees).minus(s.positions[0].closingFees).toFixed());
    expect(f.venueSymbols).not.toContain(CONTRACT);
    expect((f.venue as unknown as { calls: { quote: number } }).calls.quote).toBe(0);
  });

  test('the test-only contract is synthetic, on the native rule structure, and rejects what it does not allow', async () => {
    const f = wired();
    await f.market.instrument('BTCUSDT');
    await new Promise(r => setImmediate(r));
    await f.service.initialize(actor, key());
    const p0 = modelPrice(f.clock.now());
    await expect(f.open({ price: tick(p0.times(1.01)), quantity: '50', leverage: '20' })).rejects.toThrow('INVALID_LEVERAGE');
    await expect(f.open({ price: tick(p0.times(1.01)), quantity: '0.005' })).rejects.toThrow();
    expect(f.repo.row!.snapshot.positions).toEqual([]);
    const contract = history20TestContract(new History20PriceSource(CHOICE, f.clock.now), f.clock.now);
    expect(contract.filters).toEqual({ tickSize: '0.00000001', minPrice: '0.00000001', maxPrice: '10000000', qtyStep: '0.01', minOrderQty: '0.01',
      maxOrderQty: '1000000', maxMarketOrderQty: '1000000', minNotionalValue: '5' });
    expect(contract.leverage).toEqual({ min: '1', max: '10', step: '1' });
    expect(isHistory20Contract(CONTRACT)).toBe(true);
    expect(isHistory20Contract('BTCUSDT')).toBe(false);
    expect(isHistory20Contract('SIMUSDT')).toBe(false);
    expect(isHistory20Contract('VHXTSIM/USDT')).toBe(true);
  });
});

describe('Buy/Sell from the existing order form, over the existing HTTP route', () => {
  const app = (f: ReturnType<typeof wired>) => express().use(express.json())
    .use('/native', nativeDemoRoutes(f.service, () => actor, () => {}, null, () => history20Models(f.market)))
    .use((e: any, _req: any, res: any, _next: any) => res.status(e.status ?? 400).json({ error: e.code ?? e.message }));
  test('MARKET Buy on a model contract fills at the model price now (no candle, no book); MARKET Sell closes it; the mode is set by the server', async () => {
    const f = wired();
    await f.market.instrument('BTCUSDT');
    await new Promise(r => setImmediate(r));
    await f.service.initialize(actor, key());
    const server = app(f);
    const models = await request(server).get('/native/models');
    expect(models.status).toBe(200);
    expect(models.body.models).toEqual([expect.objectContaining({ symbol: CONTRACT, pair: 'VHXTSIM/USDT', source: HISTORY20_PRICE_SOURCE, rights: 'HISTORICAL_RIGHTS_UNVERIFIED',
      scenarioId: 'VHX-03-SOL', draftRevision: 3, logsSha256: growth.logsSha256, mark: expect.objectContaining({ markPrice: modelPrice(f.clock.now()).toFixed() }) })]);
    // The terminal sends what it sends for any contract: no candle, no execution mode.
    const buy = await request(server).post('/native/commands').send({ kind: 'OPEN', symbol: CONTRACT, side: 'LONG', type: 'MARKET', quantity: '20', leverage: '5', marginType: 'CROSS', idempotencyKey: `http-${key()}` });
    expect(buy.status).toBe(200);
    let s = f.repo.row!.snapshot;
    const position = s.positions[0], open = f.repo.row!.commands.find(c => c.kind === 'OPEN')! as any;
    expect(f.repo.row!.executionMode).toBe('HISTORICAL_DEMO');
    expect([position.status, position.entryPrice, position.quantity]).toEqual(['OPEN', modelPrice(f.clock.now()).toFixed(), '20']);
    expect([open.order.type, open.point, open.candle]).toEqual(['MARKET', modelPrice(f.clock.now()).toFixed(), undefined]);
    expect(s.events.find(e => e.kind === 'OPEN')!.pricing).toBe('SELECTED_POINT');
    f.clock.t += 3 * M + 7_000;
    const sell = await request(server).post('/native/commands').send({ kind: 'CLOSE', positionId: position.id, idempotencyKey: `http-${key()}` });
    expect(sell.status).toBe(200);
    s = f.repo.row!.snapshot;
    expect(s.positions[0].status).toBe('CLOSED');
    expect(s.events.find(e => e.kind === 'CLOSE')!.price).toBe(modelPrice(f.clock.now()).toFixed());
    expect(f.venueSymbols).not.toContain(CONTRACT);
  });

  test('a venue contract still needs its selected candle for a HISTORICAL_DEMO MARKET entry; a model MARKET needs a quantity', async () => {
    const f = wired();
    await f.market.instrument('BTCUSDT');
    await new Promise(r => setImmediate(r));
    await f.service.initialize(actor, key());
    await expect(f.command({ kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '0.01', leverage: '5', executionMode: 'HISTORICAL_DEMO' } as NativeCommand))
      .rejects.toMatchObject({ code: 'HISTORICAL_ENTRY_REQUIRED' });
    await expect(f.command({ kind: 'OPEN', symbol: CONTRACT, side: 'LONG', type: 'MARKET', margin: '50', leverage: '5', executionMode: 'HISTORICAL_DEMO' } as NativeCommand))
      .rejects.toMatchObject({ code: 'QUANTITY_REQUIRED' });
    expect(f.repo.row!.snapshot.positions).toEqual([]);
  });

  test('no pin: /models is empty and nothing about any contract changes', async () => {
    const f = wired({ list: async () => listings() }, []);
    await f.service.initialize(actor, key());
    const res = await request(app(f)).get('/native/models');
    expect(res.body).toEqual({ models: [] });
    expect(history20Models(f.market)).toEqual([]);
  });
});

describe('the model chart', () => {
  test('is the listing chart\'s own series, labelled as the model, with nothing after now; older pages end at the requested time', async () => {
    const f = wired();
    await f.market.instrument('BTCUSDT');
    await new Promise(r => setImmediate(r));
    f.clock.t = FROM + 3 * DAY + 4 * H + 17 * M + 41_000;
    for (const interval of ['1m', '5m', '1h', '4h', '1d'] as const) {
      const page = await f.market.chartCandles({ symbol: CONTRACT, interval, limit: 120, source: HISTORY20_PRICE_SOURCE });
      expect(page.source).toBe(HISTORY20_PRICE_SOURCE);
      expect(page.symbol).toBe(CONTRACT);
      const listing = testMarketCandles(listingSimulationConfig(CHOICE.config), interval, f.clock.now(), 120);
      expect(page.candles).toEqual(listing);
      expect(page.candles.every(c => c.time * 1000 <= f.clock.now())).toBe(true);
    }
    const latest = await f.market.chartCandles({ symbol: CONTRACT, interval: '1h', limit: 10, source: HISTORY20_PRICE_SOURCE });
    const older = await f.market.chartCandles({ symbol: CONTRACT, interval: '1h', limit: 10, endTime: latest.candles[0].time * 1000 - 1, source: HISTORY20_PRICE_SOURCE });
    expect(older.candles.at(-1)!.time).toBe(latest.candles[0].time - 3600);
    expect(older.candles.map(c => c.time)).toEqual(Array.from({ length: 10 }, (_, i) => latest.candles[0].time - (10 - i) * 3600));
    await expect(f.market.chartCandles({ symbol: CONTRACT, interval: '1h', endTime: f.clock.now() + 60_000, source: HISTORY20_PRICE_SOURCE })).rejects.toMatchObject({ code: 'invalid_chart_range' });
    expect(f.venueSymbols).not.toContain(CONTRACT);
  });

  test('the private chart route refuses a label that does not match the data', async () => {
    const venue = { chartCandles: async (r: { interval: string }) => ({ source: 'BYBIT_LINEAR', symbol: 'BTCUSDT', interval: r.interval, candles: [] }) } as unknown as PrivateTradingMarketData;
    const service = new PrivateTradingService({ authorized: async () => undefined } as any, history20Market(venue, { list: async () => listings() }, []));
    await expect(service.getChartCandles(actor, { symbol: 'BTCUSDT', source: 'BYBIT_LINEAR', interval: '1h' })).resolves.toMatchObject({ source: 'BYBIT_LINEAR' });
    await expect(service.getChartCandles(actor, { symbol: 'BTCUSDT', source: 'VOLTEX_HISTORY20_MODEL', interval: '1h' })).rejects.toMatchObject({ code: 'chart_source_mismatch' });
  });
});

describe('a pinned price path cannot change under trades that used it', () => {
  const pins = [PIN];
  const store = () => {
    const calls: string[] = [];
    const base: ListingStore = {
      list: async () => listings(), published: async () => ({ revision: 'r', listings: [] }),
      saveDraft: async (id, config, ifMatch) => { calls.push(`save:${id}`); return { id, draftRevision: ifMatch + 1, draft: config }; },
      publish: async id => { calls.push(`publish:${id}`); return { id, version: 1, replayed: false, publishedAt: '' }; },
    };
    return { base, calls };
  };
  test('save and publish of the pinned listing are refused while a journal mentions its contract; other listings and an unreferenced pin pass', async () => {
    const { base, calls } = store(), referenced = jest.fn(async (contract: string) => contract === CONTRACT);
    const guarded = guardHistory20Listings(base, pins, referenced);
    await expect(guarded.saveDraft('vhxt', windowConfig(), 3, 'admin')).rejects.toMatchObject({ status: 409, code: 'HISTORY20_PRICE_PATH_IN_USE' });
    await expect(guarded.publish('vhxt', 3, 'k'.repeat(16), 'admin')).rejects.toBeInstanceOf(ListingStoreError);
    await expect(guarded.saveDraft('other', windowConfig(), 1, 'admin')).resolves.toMatchObject({ draftRevision: 2 });
    expect(calls).toEqual(['save:other']);
    const free = guardHistory20Listings(base, pins, async () => false);
    await expect(free.saveDraft('vhxt', windowConfig(), 3, 'admin')).resolves.toMatchObject({ draftRevision: 4 });
    expect(guardHistory20Listings(base, [], referenced)).toBe(base);
  });

  test('through the Admin → Listings route: 409 with the reason, nothing saved', async () => {
    process.env.JWT_SECRET ||= 'history20-wiring-fixture-secret';
    const { base, calls } = store();
    const server = express().use(express.json({ limit: '200kb' })).use('/api/v1', adminListingsRouter({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) } } as any,
      guardHistory20Listings(base, pins, async () => true), null, { invalidate: jest.fn(), ensureFresh: jest.fn() } as any, () => FROM));
    const res = await request(server).put('/api/v1/admin/listings/vhxt/draft').set('Authorization', `Bearer ${jwt.sign({ sub: 'admin-1' }, process.env.JWT_SECRET!)}`)
      .set('If-Match', '3').send({ config: { ...windowConfig(), seedMode: 'manual' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('HISTORY20_PRICE_PATH_IN_USE');
    expect(calls).toEqual([]);
  });
});

describe('withdrawal gate: model-generated gains never become withdrawable', () => {
  test('existing behaviour kept: a venue-contract gain raises what can be withdrawn, exactly as before', async () => {
    const f = setup({ deposit: '1000', price: '50000' });
    Object.assign(f.market, { historicalDemoPrices: f.market.marks.bind(f.market) });
    const service = new NativeDemoService(f.repo, f.market as unknown as PrivateTradingMarketData, f.clock.now);
    await service.initialize(actor, key());
    const command = (c: object) => service.command(actor, { idempotencyKey: key(), ...c } as NativeCommand);
    await command({ kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', price: '50100', quantity: '0.01', leverage: '10', marginType: 'CROSS', executionMode: 'HISTORICAL_DEMO' });
    f.clock.t += 61_000; f.market.price = '52000';
    await command({ kind: 'CLOSE', positionId: f.repo.row!.snapshot.positions[0].id });
    const wallet = (await service.wallet(actor))!, s = f.repo.row!.snapshot;
    expect(history20Gains(s)).toBe('0');
    expect(withdrawableRows(wallet, history20Gains(s))).toEqual(withdrawableRows(wallet));
    expect(new BigNumber(withdrawableRows(wallet)[0].available).gt(1000)).toBe(true);
  });

  test('a History20 gain is held back; a History20 loss still reduces what can be withdrawn', async () => {
    for (const direction of ['gain', 'loss'] as const) {
      const f = wired();
      await f.market.instrument('BTCUSDT');
      await new Promise(r => setImmediate(r));
      await f.service.initialize(actor, key());
      const p0 = modelPrice(f.clock.now());
      await f.open({ price: tick(p0.times(1.01)), quantity: '50' });
      const position = f.repo.row!.snapshot.positions[0], entry = new BigNumber(position.entryPrice);
      f.clock.t = firstTick(f.clock.now(), price => direction === 'gain' ? price.gt(entry.times(1.003)) : price.lt(entry.times(0.997)), 3 * DAY) + 1_000;
      await f.command({ kind: 'CLOSE', positionId: position.id } as NativeCommand);
      const s = f.repo.row!.snapshot, closed = s.positions[0], { wallet, withdrawable } = await settle(f);
      const net = new BigNumber(closed.realizedGross).minus(closed.openingFees).minus(closed.closingFees).plus(closed.fundingNet);
      expect(net.gt(0)).toBe(direction === 'gain');
      expect(history20Gains(s)).toBe(BigNumber.max(net, 0).toFixed());
      const unheld = withdrawableRows(wallet)[0].available;
      expect(withdrawable).toBe(direction === 'gain' ? new BigNumber(unheld).minus(net).toFixed() : unheld);
      // Never above what the account could withdraw before the model trade.
      expect(new BigNumber(withdrawable).lte('1000')).toBe(true);
    }
  });
});
