/**
 * History20 → native Futures TEST account, through the review seam
 * (`withHistory20Prices`): the existing engine, service, journal and replay,
 * an in-memory repository, a fake venue. The window and the model contract
 * are synthetic fixtures (no market data, no defined contract): the contract
 * here exists only so the engine can be driven on the model price.
 */
import BigNumber from 'bignumber.js';
import { actor, setup, key, instrument, outcome, H } from '../native/testing/liveFixture';
import { NativeCommand, NativeDemoService } from '../native/service';
import { demoAccount, DemoState } from '../native/engine';
import { checkCoverage, replayNativeDemoAsync, BarRequest, ReplayBar } from '../native/replay';
import { nativeHistoryCache } from '../native/historyCache';
import { assertHistoricalDemoCurrentPrice, PrivateInstrument, PrivateTradingMarketData } from '../marketData';
import {
  HISTORY20_PRICE_SOURCE, History20PriceSource, history20Selection, loadHistory20Selection, withHistory20Prices, type History20Choice,
} from '../native/history20Prices';
import { buildHistoricalGrowthProgram, historicalGrowthMaxPrice, type HistoricalGrowthSourceRow } from '../../shared/listingHistoricalGrowth';
import { defaultScenarioControls } from '../../shared/listingScenarioControls';
import { listingSimulationConfig, parseListingConfig, type ListingConfig } from '../../services/listings/listingConfig';
import type { AdminListing } from '../../services/listings/store';
import { simulationFor, TestMarketSimulation } from '../../services/testMarkets/testMarketSimulation';

const DAY = 86_400_000, M = 60_000;
const LISTING_AT = '2026-09-13T00:00:00.000Z', FROM = Date.parse(LISTING_AT);
function walk(days: number): HistoricalGrowthSourceRow[] {
  let x = 7, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    const open = d ? price * (1 + (random() - .5) * .006) : 100, close = open * Math.exp(Math.log(80) / days + (random() - .5) * .12);
    price = close;
    return { date, open, high: Math.max(open, close) * (1 + random() * .04), low: Math.min(open, close) * (1 - random() * .04), close };
  });
}
const growth = buildHistoricalGrowthProgram({ scenarioId: 'VHX-03-SOL', targetPeakGrowthPercent: '9348', rows: walk(40),
  source: { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'b'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } });
const windowConfig = (overrides: Partial<ListingConfig> = {}): ListingConfig => parseListingConfig({
  schemaVersion: 1, symbol: 'VHXT', name: 'VOLTEX History Test', logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'UTC',
  ownerAllocation: '0', seedMode: 'manual', seed: 'vhxt-native-20260913-synthetic', tradable: false,
  simulationProgram: { ...defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
    historicalGrowth: growth, maxPrice: historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
  ...overrides,
});
const adminListing = (id: string, draft: ListingConfig, activeVersion: number | null = null): AdminListing => ({
  id, symbol: draft.symbol, draft, draftRevision: 3, draftUpdatedAt: LISTING_AT, draftUpdatedBy: 'fixture-admin', activeVersion, active: activeVersion ? draft : null, versions: [],
});
const CHOICE: History20Choice = history20Selection(adminListing('vhxt', windowConfig()));
const CONTRACT = CHOICE.selection.contract;
/** A TEST-ONLY contract so the engine can run on the model; no model contract is defined for production. */
const MODEL_CONTRACT: PrivateInstrument = { ...instrument(CONTRACT), parameterVersion: 'TEST_ONLY_HISTORY20_CONTRACT', fundingIntervalMinutes: 480,
  filters: { tickSize: '0.00000001', minPrice: '0.00000001', maxPrice: '1000000', qtyStep: '0.1', minOrderQty: '0.1', maxOrderQty: '1000000', maxMarketOrderQty: '1000000', minNotionalValue: '5' },
  leverage: { min: '1', max: '10', step: '1' },
  riskTiers: [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.05', initialMarginRate: '0.1', maintenanceDeduction: '0', maxLeverage: '10' }] };
const model = (): TestMarketSimulation => simulationFor(listingSimulationConfig(CHOICE.config));
const modelPrice = (t: number) => new BigNumber(model().priceAt(t)!);
/** The first 10-second model tick after `from` where `hit` holds. */
function firstTick(from: number, hit: (price: BigNumber) => boolean, within = 3 * DAY) {
  for (let t = Math.ceil((from + 1) / 10_000) * 10_000; t <= from + within; t += 10_000) if (hit(modelPrice(t))) return t;
  throw new Error('fixture: the model never reaches the level');
}

/** The fixture venue, recording every symbol the seam lets through. */
function engine(deposit = '1000', withContract = true) {
  const f = setup({ deposit });
  // The fixture venue samples HISTORICAL_DEMO prices from its live frame, as nativeHistoricalCurrent.test.ts does.
  Object.assign(f.market, { historicalDemoPrices: f.market.marks.bind(f.market) });
  const venueSymbols: string[] = [];
  const venue = new Proxy(f.market, { get(target, prop) {
    const value = Reflect.get(target, prop, target);
    if (typeof value !== 'function') return value;
    return (...args: any[]) => {
      const first = args[0];
      if (typeof first === 'string') venueSymbols.push(first);
      else if (Array.isArray(first)) venueSymbols.push(...first);
      else if (first?.symbol) venueSymbols.push(first.symbol);
      return value.apply(target, args);
    };
  } }) as unknown as PrivateTradingMarketData;
  const source = new History20PriceSource(CHOICE, f.clock.now);
  const market = withHistory20Prices(venue, { sources: [source], ...(withContract ? { contract: () => MODEL_CONTRACT } : {}) });
  const service = new NativeDemoService(f.repo, market, f.clock.now);
  const command = (c: Omit<NativeCommand, 'idempotencyKey'>, idempotencyKey = key()) => service.command(actor, { ...c, idempotencyKey } as NativeCommand);
  const open = (extra: object) => command({ kind: 'OPEN', symbol: CONTRACT, side: 'LONG', type: 'LIMIT', leverage: '10', marginType: 'CROSS', executionMode: 'HISTORICAL_DEMO', ...extra } as NativeCommand);
  const bars = (svc: NativeDemoService) => (r: BarRequest): Promise<ReplayBar[]> => (svc as unknown as { bars(r: BarRequest): Promise<ReplayBar[]> }).bars(r);
  const replay = async (svc = service) => {
    const row = f.repo.row!;
    return (await replayNativeDemoAsync({ deposit: row.deposit, instructions: row.commands, asOf: f.clock.now() }, bars(svc))).snapshot;
  };
  return { ...f, venue, venueSymbols, source, market, service, command, open, replay, bars };
}
const account = (s: DemoState) => demoAccount(s);
const tick = (p: BigNumber) => p.decimalPlaces(8, BigNumber.ROUND_DOWN).toFixed();

describe('History20 price-source selection (existing listing store, read only)', () => {
  test('a saved window draft is selected with its version, source label and rights; anything else is refused by name', async () => {
    const list = jest.fn(async () => ({ revision: 'r1', serverTime: FROM, listings: [
      adminListing('plain', parseListingConfig({ schemaVersion: 1, symbol: 'PLN', name: 'Plain draft', logo: null, initialPrice: '1', listingAt: LISTING_AT, displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'manual', seed: 'plain-fixture-seed', tradable: true })),
      adminListing('vhxt', windowConfig()),
      adminListing('released', windowConfig({ symbol: 'VHXR' }), 1),
      adminListing('unaligned', windowConfig({ symbol: 'VHXU', listingAt: '2026-09-13T00:00:10.000Z' })),
    ] }));
    const { selection } = await loadHistory20Selection({ list }, 'vhxt');
    expect(selection).toEqual({ listingId: 'vhxt', draftRevision: 3, contract: 'VHXTSIMUSDT', source: HISTORY20_PRICE_SOURCE, scenarioId: 'VHX-03-SOL',
      intrabar: 'SEEDED_BRIDGE_OHLC_V2', logsSha256: growth.logsSha256, rights: 'HISTORICAL_RIGHTS_UNVERIFIED', listingAt: FROM });
    await expect(loadHistory20Selection({ list }, 'plain')).rejects.toMatchObject({ code: 'history20_not_a_window' });
    await expect(loadHistory20Selection({ list }, 'released')).rejects.toMatchObject({ code: 'history20_published' });
    await expect(loadHistory20Selection({ list }, 'unaligned')).rejects.toMatchObject({ code: 'history20_unaligned' });
    await expect(loadHistory20Selection({ list }, 'missing')).rejects.toMatchObject({ code: 'history20_unknown', status: 404 });
    // The stored logs are checked against their checksum before any price is read.
    const tampered = structuredClone(windowConfig()) as any;
    tampered.simulationProgram.historicalGrowth.logs[5][0] += 1;
    expect(() => history20Selection(adminListing('tampered', tampered))).toThrow();
  });
});

describe('History20 model price as the engine reads it', () => {
  test('the mark is the Admin-preview price of the last completed tick, never ahead of now, and passes the HISTORICAL_DEMO price check', () => {
    let now = FROM - 1;
    const source = new History20PriceSource(CHOICE, () => now);
    expect(source.mark()).toBeNull();
    for (const t of [FROM, FROM + 9_999, FROM + 10_000, FROM + DAY + 12_345, FROM + 7 * DAY + 5 * H + 59_999, FROM + 30 * DAY]) {
      now = t;
      const mark = source.mark()!;
      expect(mark.markPrice).toBe(modelPrice(t).toFixed());
      expect(mark.lastPrice).toBe(mark.markPrice);
      expect(mark.markProviderTimestamp).toBeLessThanOrEqual(t);
      expect(t - mark.markProviderTimestamp).toBeLessThan(10_000);
      expect(assertHistoricalDemoCurrentPrice(mark, CONTRACT, t)).toEqual(mark);
    }
  });

  test('closed bars only, equal to the model candles, the same after restart and days later (no retroactive rewrite)', async () => {
    let now = FROM + 2 * DAY + 5 * H + 7 * M + 31_000;
    const source = new History20PriceSource(CHOICE, () => now);
    const hour = Math.floor(now / H) * H - H, request = { symbol: CONTRACT, startTime: hour, endTime: hour + H, intervalMinutes: 1 as const, omitProviderFunding: true };
    const minutes = source.history(request, MODEL_CONTRACT);
    expect(minutes.complete).toBe(true);
    expect(minutes.tradeCandles).toHaveLength(60);
    expect(minutes.markCandles).toEqual(minutes.tradeCandles);
    expect(minutes.fundingEvents).toEqual([]);
    const direct = new TestMarketSimulation(listingSimulationConfig(CHOICE.config)).candles1m(hour + H, hour).filter(c => c.openTime < hour + H);
    expect(minutes.tradeCandles.map(c => [c.timestamp, c.open, c.high, c.low, c.close])).toEqual(direct.map(c => [c.openTime, ...[c.open, c.high, c.low, c.close].map(v => new BigNumber(v).toFixed())]));
    const hourly = source.history({ ...request, intervalMinutes: 60 }, MODEL_CONTRACT).tradeCandles;
    expect(hourly).toEqual([{ timestamp: hour, open: minutes.tradeCandles[0].open, close: minutes.tradeCandles[59].close,
      high: BigNumber.max(...minutes.tradeCandles.map(c => c.high)).toFixed(), low: BigNumber.min(...minutes.tradeCandles.map(c => c.low)).toFixed() }]);
    // The forming minute is not a bar yet.
    expect(() => source.history({ ...request, startTime: hour + H, endTime: Math.floor(now / M) * M + M }, MODEL_CONTRACT)).toThrow('history20_not_closed');
    // The bars the engine's own history cache accepts.
    const market = withHistory20Prices(setup().market as unknown as PrivateTradingMarketData, { sources: [source], contract: () => MODEL_CONTRACT });
    const bars = await nativeHistoryCache(market, () => now).load({ symbol: CONTRACT, start: hour, end: hour + H, intervalMs: M });
    expect(checkCoverage(bars, { symbol: CONTRACT, start: hour, end: hour + H, intervalMs: M })).toHaveLength(60);
    // A restarted instance, three days later, serves the same closed hour.
    now += 3 * DAY;
    expect(new History20PriceSource(CHOICE, () => now).history(request, MODEL_CONTRACT).tradeCandles).toEqual(minutes.tradeCandles);
  });
});

describe('the seam around the existing market', () => {
  test('no selected window: the market is the original object; a model symbol never reaches the venue; what the model cannot answer is refused by name', async () => {
    const f = engine('1000', false), base = setup().market as unknown as PrivateTradingMarketData;
    expect(withHistory20Prices(base, { sources: [] })).toBe(base);
    await expect(f.market.instrument(CONTRACT)).rejects.toMatchObject({ code: 'history20_contract_undefined' });
    await expect(f.market.freshQuote(CONTRACT)).rejects.toMatchObject({ code: 'history20_no_book' });
    await expect(f.market.resolveCandle({ symbol: CONTRACT, source: 'BYBIT_LINEAR', interval: '1h', openTime: FROM, pricePoint: 'OPEN' })).rejects.toMatchObject({ code: 'history20_candle_source_unsupported' });
    await expect(f.market.chartCandles({ symbol: CONTRACT, interval: '1h' })).rejects.toMatchObject({ code: 'history20_chart_source_unsupported' });
    await expect(f.market.funding(CONTRACT, FROM, FROM + H)).rejects.toMatchObject({ code: 'history20_no_venue_funding' });
    await f.service.initialize(actor, key());
    const initialized = f.repo.commits;
    await expect(f.open({ price: '1', quantity: '10' })).rejects.toMatchObject({ code: 'history20_contract_undefined' });
    expect(f.repo.commits).toBe(initialized);
    const prices = await f.market.historicalDemoPrices([CONTRACT, 'BTCUSDT']);
    expect(prices.get(CONTRACT)!.markPrice).toBe(modelPrice(f.clock.now()).toFixed());
    expect(prices.get('BTCUSDT')).toEqual((await (f.venue as any).marks(['BTCUSDT'])).get('BTCUSDT'));
    expect(await f.market.instrument('BTCUSDT')).toEqual(instrument('BTCUSDT'));
    expect(f.venueSymbols).not.toContain(CONTRACT);
  });
});

describe('the existing native Futures TEST engine on the History20 model price', () => {
  test('marketable LIMIT fills at the model price; demo margin and fees as for any contract; insufficient demo margin refused before a write', async () => {
    const f = engine('1000');
    await f.service.initialize(actor, key());
    const p0 = modelPrice(f.clock.now());
    const before = structuredClone(f.repo.row), commits = f.repo.commits;
    // 20 000 notional at 10x needs 2 000 of margin; the account holds 1 000 demo USDT.
    await expect(f.open({ price: tick(p0.times(1.01)), quantity: new BigNumber(20_000).div(p0).decimalPlaces(1).toFixed() })).rejects.toMatchObject({ code: 'INSUFFICIENT_DEMO_MARGIN' });
    expect(f.repo.row).toEqual(before);
    expect(f.repo.commits).toBe(commits);

    await f.open({ price: tick(p0.times(1.01)), quantity: '100' });
    const s = f.repo.row!.snapshot, p = s.positions[0], fill = s.events.find(e => e.kind === 'OPEN')!;
    expect(p.status).toBe('OPEN');
    expect(p.entryPrice).toBe(p0.toFixed());
    expect(fill.pricing).toBe('NEAR_LIVE_DEMO');
    expect(s.marks[CONTRACT].mark).toBe(p0.toFixed());
    expect(new BigNumber(p.openingFees).gt(0)).toBe(true);
    expect(s.walletBalance).toBe(new BigNumber('1000').minus(p.openingFees).toFixed());
    const a = account(s);
    expect(new BigNumber(a.usedMargin).gt(p0.times(100).times('0.1').minus('0.000001'))).toBe(true);
    expect(a.available).toBe(new BigNumber(a.equity).minus(a.usedMargin).minus(a.orderReserve).toFixed());
    expect(f.repo.row!.source).toBe('DEMO_BALANCE');
    expect(f.venueSymbols).not.toContain(CONTRACT);
    expect((f.venue as unknown as { calls: { quote: number } }).calls.quote).toBe(0);
  });

  test('a resting LIMIT reserves demo margin, cancel releases it, and a later one fills when the model price reaches it', async () => {
    const f = engine('1000');
    await f.service.initialize(actor, key());
    const p0 = modelPrice(f.clock.now()), free = account(f.repo.row!.snapshot).available;
    await f.open({ price: tick(p0.times(0.5)), quantity: '100' });
    let s = f.repo.row!.snapshot, order = s.orders[0];
    expect(order.status).toBe('OPEN');
    expect(account(s).orderReserve).toBe(order.reserved);
    expect(new BigNumber(order.reserved).gt(0)).toBe(true);
    await f.command({ kind: 'CANCEL', orderId: order.id } as NativeCommand);
    s = f.repo.row!.snapshot;
    expect(s.orders[0].status).toBe('CANCELLED');
    expect(account(s).orderReserve).toBe('0');
    expect(account(s).available).toBe(free);

    const level = p0.times(0.995), at = firstTick(f.clock.now(), price => price.lte(level));
    await f.open({ price: tick(level), quantity: '100' });
    expect(f.repo.row!.snapshot.orders[1].status).toBe('OPEN');
    f.clock.t = at + 2_000;
    await f.command({ kind: 'REFRESH' } as NativeCommand);
    s = f.repo.row!.snapshot;
    const filled = s.orders[1], position = s.positions.find(p => p.status === 'OPEN')!;
    expect(filled.status).toBe('FILLED');
    expect(position.entryPrice).toBe(modelPrice(at).toFixed());
    expect(new BigNumber(position.entryPrice).lte(tick(level))).toBe(true);
    expect(f.venueSymbols).not.toContain(CONTRACT);
  });

  test('take-profit and stop-loss fire on the model mark; a retried command is not applied twice; a restarted service replays to the same account', async () => {
    const f = engine('1000');
    await f.service.initialize(actor, key());
    const p0 = modelPrice(f.clock.now());
    await f.open({ price: tick(p0.times(1.01)), quantity: '100' });
    const position = f.repo.row!.snapshot.positions[0];
    const up = new BigNumber(position.entryPrice).times(1.004), down = new BigNumber(position.entryPrice).times(0.996);
    const upAt = firstTick(f.clock.now(), price => price.gte(up)), downAt = firstTick(f.clock.now(), price => price.lte(down));
    const protection = { kind: 'PROTECTION', positionId: position.id, protection: { takeProfit: tick(up), stopLoss: tick(down) } } as NativeCommand;
    const retryKey = key();
    const set = await f.command(protection, retryKey), commits = f.repo.commits;
    // The same request again (a retry after a lost response) returns the first result; nothing is applied twice.
    expect((await f.command(protection, retryKey)).revision).toBe(set.revision);
    expect(f.repo.commits).toBe(commits);
    await expect(f.command({ ...protection, protection: { takeProfit: tick(up.times(1.01)) } } as NativeCommand, retryKey)).rejects.toMatchObject({ code: 'idempotency_conflict' });

    const firesAt = Math.min(upAt, downAt);
    f.clock.t = firesAt + 2_000;
    await f.command({ kind: 'REFRESH' } as NativeCommand);
    const s = f.repo.row!.snapshot, closed = s.positions[0], exit = s.events.find(e => e.kind === (upAt < downAt ? 'TAKE_PROFIT' : 'STOP_LOSS'))!;
    expect(closed.status).toBe('CLOSED');
    expect(exit.price).toBe(modelPrice(firesAt).toFixed());
    const gross = new BigNumber(exit.price!).minus(position.entryPrice).times(position.quantity);
    expect(closed.realizedGross).toBe(gross.toFixed());
    expect(gross.gt(0)).toBe(upAt < downAt);

    // Restart: a new price source and service on the same stored account.
    const source = new History20PriceSource(CHOICE, f.clock.now), market = withHistory20Prices(f.venue, { sources: [source], contract: () => MODEL_CONTRACT });
    const restarted = new NativeDemoService(f.repo, market, f.clock.now);
    const view = await restarted.state(actor);
    expect(view.revision).toBe(f.repo.row!.revision);
    expect(view.positions.filter(p => p.status === 'OPEN')).toEqual([]);
    expect(outcome(await f.replay(restarted))).toEqual(outcome(s));
    expect(f.venueSymbols).not.toContain(CONTRACT);
  });

  test('a held position settles funding on the model mark at the boundary, from closed model bars; replay agrees', async () => {
    const f = engine('1000');
    await f.service.initialize(actor, key());
    await f.open({ price: tick(modelPrice(f.clock.now()).times(1.01)), quantity: '100' });
    const boundary = Math.ceil(f.clock.now() / (8 * H)) * 8 * H;
    f.clock.t = boundary + 2 * M + 1_000;
    await f.command({ kind: 'REFRESH' } as NativeCommand);
    const s = f.repo.row!.snapshot, funding = s.events.filter(e => e.kind === 'FUNDING');
    expect(funding.map(e => [e.time, e.price, e.pricing])).toEqual([[boundary, modelPrice(boundary).toFixed(), 'MARK_SETTLEMENT']]);
    expect(new BigNumber(funding[0].cashflow).isZero()).toBe(false);
    expect(outcome(await f.replay())).toEqual(outcome(s));
    expect(f.venueSymbols).not.toContain(CONTRACT);
  });

  test('an existing venue contract behaves exactly as without the seam', async () => {
    const run = async (seam: boolean) => {
      const f = setup({ deposit: '1000', price: '50000' });
      Object.assign(f.market, { historicalDemoPrices: f.market.marks.bind(f.market) });
      const market = seam ? withHistory20Prices(f.market as unknown as PrivateTradingMarketData, { sources: [new History20PriceSource(CHOICE, f.clock.now)], contract: () => MODEL_CONTRACT })
        : f.market as unknown as PrivateTradingMarketData;
      const service = new NativeDemoService(f.repo, market, f.clock.now);
      await service.initialize(actor, key());
      const open = (extra: object) => service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', leverage: '10', marginType: 'CROSS', executionMode: 'HISTORICAL_DEMO', idempotencyKey: key(), ...extra } as NativeCommand);
      await open({ price: '50100', quantity: '0.01' });
      await open({ price: '49000', quantity: '0.01' });
      f.clock.t += 61_000; f.market.price = '48900';
      await service.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
      const s = f.repo.row!.snapshot;
      return { calls: f.market.calls, wallet: s.walletBalance, account: account(s),
        positions: s.positions.map(p => [p.side, p.status, p.quantity, p.entryPrice, p.openingFees]),
        events: s.events.map(e => [e.kind, e.time, e.quantity, e.price, e.fee, e.cashflow, e.pricing]),
        orders: s.orders.map(o => [o.status, o.price, o.filled, o.reserved]) };
    };
    expect(await run(true)).toEqual(await run(false));
  });
});
