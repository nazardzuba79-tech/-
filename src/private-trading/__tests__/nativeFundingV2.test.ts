import BigNumber from 'bignumber.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder,
  demoPositionView, closeDemoPosition, settleDemoFunding, DemoInstrument, DemoState, NATIVE_DEMO_MODEL } from '../native/engine';
import { accountLedger, positionLedger } from '../native/ledger';
import { fundingModelView, fundingTermsAt, LEGACY_FUNDING_SCHEDULE, LEGACY_FUNDING_TERMS, NATIVE_CURRENT_FUNDING,
  nextFundingBoundaryAfter, scheduleWith, validCashflow } from '../native/fundingModel';
import { NativeInstruction, ReplayBar, replayNativeDemo, replayNativeDemoWithBars } from '../native/replay';
import { pinNativeFundingSchedule } from '../native/store';
import { VOLTEX_FUNDING } from '../../config/voltexFunding';

/**
 * VOLTEX FUNDING V2 ON THE NATIVE DEMO FUTURES ACCOUNT.
 *
 * The owner's standard rates — LONG pays 0.01%, SHORT receives 0.04% of
 * position value per 8h — apply from a start pinned once; every settlement
 * before it keeps the original −0.1% / +0.4%. Every number below is worked
 * by hand from quantity × boundary mark × side rate, so a change that applies
 * leverage, charges a closed slice, pays a boundary twice or re-prices an old
 * settlement fails here.
 */

const T = 1_728_000_000_000; // 2024-10-04T00:00:00Z, an 8h UTC boundary
const H = 3_600_000, M = 60_000, F = 8 * H;
const TAKER = '0.00055';
const instrument: DemoInstrument = {
  rules: { symbol: 'BTCUSDT', tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' },
  profile: { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: TAKER, makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '0', riskTiers: [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }], assumptions: [] },
};
const V2 = scheduleWith(NATIVE_CURRENT_FUNDING, T);

function state(balance = '10000000') {
  const s = emptyDemoState(balance, T);
  registerDemoInstrument(s, instrument);
  markDemoAccount(s, { BTCUSDT: { mark: '50000', last: '50000' } }, T);
  return s;
}
function open(s: DemoState, id: string, side: 'LONG' | 'SHORT', quantity: string, price: string, at: number, extra: { leverage?: string; marginType?: 'CROSS' | 'ISOLATED' } = {}) {
  placeDemoOrder(s, { id, symbol: 'BTCUSDT', side, type: 'MARKET', quantity, leverage: extra.leverage ?? '20', ...(extra.marginType ? { marginType: extra.marginType } : {}) }, at);
  fillDemoOrder(s, id, quantity, price, at, 'SELECTED_POINT');
}
/** Mark at the boundary and settle it, as the replay does. */
function settle(s: DemoState, at: number, mark: string, schedule = V2) {
  markDemoAccount(s, { BTCUSDT: { mark, last: mark } }, at);
  settleDemoFunding(s, at, schedule);
}
const fundingEvents = (s: DemoState) => s.events.filter((e) => e.kind === 'FUNDING');
const flows = (s: DemoState) => fundingEvents(s).map((e) => [e.time, e.quantity, e.price, e.cashflow]);

describe('the rates', () => {
  test('V2 is the owner standard: LONG −0.01%, SHORT +0.04% per 8h — the V1 directions, ten times smaller', () => {
    expect(VOLTEX_FUNDING).toEqual({ version: 'VOLTEX_FIXED_V2', longCashflow: '-0.0001', shortCashflow: '0.0004' });
    expect(NATIVE_CURRENT_FUNDING).toEqual(VOLTEX_FUNDING);
    // V1 is untouched: every settlement before the pinned start is priced by it.
    expect(LEGACY_FUNDING_TERMS).toEqual({ version: 'VOLTEX_CUSTOM_DEMO_V1', longCashflow: '-0.001', shortCashflow: '0.004' });
    expect(NATIVE_DEMO_MODEL.funding).toMatchObject({ longCashflow: '-0.001', shortCashflow: '0.004', intervalMs: F });
    expect(new BigNumber(LEGACY_FUNDING_TERMS.longCashflow).div(10).toFixed()).toBe(VOLTEX_FUNDING.longCashflow);
    expect(new BigNumber(LEGACY_FUNDING_TERMS.shortCashflow).div(10).toFixed()).toBe(VOLTEX_FUNDING.shortCashflow);
  });
});

describe('V2 settles quantity × boundary mark × side rate at 00/08/16 UTC', () => {
  test('a LONG held 24h pays at exactly three settlements', () => {
    // 2 BTC; boundary marks 50 000 / 51 000 / 49 000:
    //   2 × 50 000 × −0.0001 = −10, 2 × 51 000 × −0.0001 = −10.2, 2 × 49 000 × −0.0001 = −9.8
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T + 1000);
    settle(s, T + F, '50000'); settle(s, T + 2 * F, '51000'); settle(s, T + 3 * F, '49000');
    expect(flows(s)).toEqual([[T + F, '2', '50000', '-10'], [T + 2 * F, '2', '51000', '-10.2'], [T + 3 * F, '2', '49000', '-9.8']]);
    expect(fundingEvents(s).every((e) => e.fundingRate === '-0.0001' && e.fundingModel === 'VOLTEX_FIXED_V2')).toBe(true);
    expect(s.positions[0].fundingNet).toBe('-30');
  });

  test('a SHORT held 24h receives 0.04% at each of the three settlements', () => {
    //   2 × 50 000 × 0.0004 = 40, 2 × 51 000 × 0.0004 = 40.8, 2 × 49 000 × 0.0004 = 39.2
    const s = state();
    open(s, 'o1', 'SHORT', '2', '50000', T + 1000);
    settle(s, T + F, '50000'); settle(s, T + 2 * F, '51000'); settle(s, T + 3 * F, '49000');
    expect(flows(s).map((f) => f[3])).toEqual(['40', '40.8', '39.2']);
    expect(fundingEvents(s).every((e) => e.fundingRate === '0.0004')).toBe(true);
    expect(s.positions[0].fundingNet).toBe('120');
  });

  test('opened and closed between two boundaries: no funding at all', () => {
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T + H);
    closeDemoPosition(s, 'o1', undefined, '50000', T + 7 * H);
    settle(s, T + F, '50000');
    expect(fundingEvents(s)).toHaveLength(0);
    expect(s.positions[0].fundingNet).toBe('0');
    expect(accountLedger(s).totals.funding).toBe('0');
  });

  test('a position opened exactly AT a boundary owes nothing for that boundary', () => {
    const s = state();
    markDemoAccount(s, { BTCUSDT: { mark: '50000', last: '50000' } }, T + F);
    open(s, 'o1', 'LONG', '2', '50000', T + F);
    settleDemoFunding(s, T + F, V2);
    expect(fundingEvents(s)).toHaveLength(0);
    settle(s, T + 2 * F, '50000');
    expect(flows(s)).toEqual([[T + 2 * F, '2', '50000', '-10']]);
  });

  test('partly closed before the next boundary: only the remainder settles', () => {
    // 2 opened, 1.5 closed at 7h; 0.5 × 50 000 × −0.0001 = −2.5 at 8h.
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T + 1000);
    closeDemoPosition(s, 'o1', '1.5', '50000', T + 7 * H);
    settle(s, T + F, '50000');
    expect(flows(s)).toEqual([[T + F, '0.5', '50000', '-2.5']]);
  });

  test('the same settlement repeated (restart, second command) is paid once', () => {
    const s = state();
    open(s, 'o1', 'SHORT', '2', '50000', T + 1000);
    settle(s, T + F, '50000');
    const wallet = s.walletBalance;
    settleDemoFunding(s, T + F, V2);
    settleDemoFunding(s, T + F, V2);
    expect(fundingEvents(s)).toHaveLength(1);
    expect(s.walletBalance).toBe(wallet);
  });

  test('leverage never multiplies funding: 1x and 100x settle the same on the same quantity', () => {
    const paid = (leverage: string) => { const s = state(); open(s, 'o1', 'LONG', '2', '50000', T + 1000, { leverage }); settle(s, T + F, '50000'); return flows(s)[0][3]; };
    expect(paid('1')).toBe('-10');
    expect(paid('100')).toBe('-10');
  });

  test('an ISOLATED position settles funding against its own post, not the shared wallet', () => {
    for (const [side, flow] of [['LONG', '-10'], ['SHORT', '40']] as const) {
      const s = state();
      open(s, 'o1', side, '2', '50000', T + 1000, { marginType: 'ISOLATED' });
      const wallet = s.walletBalance, post = s.positions[0].isolatedMargin;
      settle(s, T + F, '50000');
      expect(s.walletBalance).toBe(wallet);
      expect(s.positions[0].isolatedMargin).toBe(new BigNumber(post).plus(flow).toFixed());
      expect(s.positions[0].fundingNet).toBe(flow);
    }
  });
});

describe('net P&L = trading P&L − fees + funding, once, and it is what the wallet moved', () => {
  test('a closed CROSS LONG: Net P&L equals the ledger and the wallet change exactly', () => {
    // BEFORE 10 000 000.
    //   open 2 @ 50 000            fee 2 × 50 000 × 0.00055 = 55
    //   funding 8h  mark 50 000    −10
    //   funding 16h mark 51 000    −10.2
    //   close 2 @ 52 000           gross 4 000, fee 2 × 52 000 × 0.00055 = 57.2
    //   net = 4 000 − 112.2 − 20.2 = 3 867.6
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T + 1000);
    settle(s, T + F, '50000'); settle(s, T + 2 * F, '51000');
    markDemoAccount(s, { BTCUSDT: { mark: '52000', last: '52000' } }, T + 2 * F + 1000);

    const openView = demoPositionView(s, s.positions[0]);
    // Open: only the funding ALREADY settled is in the net.
    expect(openView).toMatchObject({ tradingPnl: '4000', feesPaid: '55', fundingNet: '-20.2', netPnl: '3924.8' });

    closeDemoPosition(s, 'o1', undefined, '52000', T + 2 * F + 2000);
    const view = demoPositionView(s, s.positions[0]);
    expect(view).toMatchObject({ status: 'CLOSED', tradingPnl: '4000', feesPaid: '112.2', fundingNet: '-20.2', netPnl: '3867.6', realizedPnl: '3867.6' });
    expect(new BigNumber(view.tradingPnl).minus(view.feesPaid).plus(view.fundingNet).toFixed()).toBe(view.netPnl);
    expect(new BigNumber(s.walletBalance).minus('10000000').toFixed()).toBe(view.netPnl);
    // Closing settles no extra funding.
    expect(fundingEvents(s)).toHaveLength(2);

    const ledger = accountLedger(s);
    expect(ledger.reconciled).toBe(true);
    expect(ledger.totals).toMatchObject({ realizedPnl: '4000', fees: '112.2', funding: '-20.2', net: '3867.6' });
    expect(ledger.entries.filter((e) => e.source === 'FUNDING').map((e) => [e.amount, e.fundingRate, e.fundingModel]))
      .toEqual([['-10', '-0.0001', 'VOLTEX_FIXED_V2'], ['-10.2', '-0.0001', 'VOLTEX_FIXED_V2']]);
    const lines = positionLedger(s, 'o1');
    expect(lines.reduce((a, l) => a.plus(l.amount), new BigNumber(0)).toFixed()).toBe(view.netPnl);
  });

  test('a SHORT closed at a loss with funding received still reconciles', () => {
    // gross −500, fees 27.5 + 27.775 = 55.275, funding 1 × 50 000 × 0.0004 = +20
    const s = state();
    open(s, 'o1', 'SHORT', '1', '50000', T + 1000);
    settle(s, T + F, '50000');
    closeDemoPosition(s, 'o1', undefined, '50500', T + F + 1000);
    const view = demoPositionView(s, s.positions[0]);
    expect(view).toMatchObject({ tradingPnl: '-500', feesPaid: '55.275', fundingNet: '20', netPnl: '-535.275' });
    expect(new BigNumber(s.walletBalance).minus('10000000').toFixed()).toBe(view.netPnl);
    expect(accountLedger(s).reconciled).toBe(true);
  });
});

describe('replay: restarts and the switch from V1', () => {
  const rules = instrument.rules;
  const bar = (time: number, price: string): ReplayBar => ({ time, intervalMs: M, trade: { timestamp: time, open: price, low: price, high: price, close: price }, mark: { timestamp: time, open: price, low: price, high: price, close: price } });
  /** Minute bars whose price changes at each 8h boundary. */
  const bars = (from: number, to: number, priceAt: (t: number) => string) => { const out: ReplayBar[] = []; for (let t = from; t < to; t += M) out.push(bar(t, priceAt(t))); return out; };
  const price = (t: number) => ['50000', '50000', '51000', '49000', '49000'][Math.floor((t - T) / F)];
  const openAt = (id: string, at: number, side: 'LONG' | 'SHORT' = 'LONG'): NativeInstruction =>
    ({ id, at, kind: 'OPEN', order: { id, symbol: 'BTCUSDT', side, type: 'MARKET', quantity: '2', leverage: '20', historical: true }, instrument: { rules, profile: instrument.profile }, mark: '50000', last: '50000', point: '50000' });
  const closeAt = (id: string, positionId: string, at: number, p: string): NativeInstruction => ({ id, at, kind: 'CLOSE', positionId, price: p });
  const end = T + 3 * F + 2 * M;
  const input = (instructions: NativeInstruction[], funding?: typeof V2) => ({ deposit: '1000000', instructions, bars: { BTCUSDT: bars(T, end + M, price) }, asOf: end, ...(funding ? { funding } : {}) });

  test('a 24h replay settles the three V2 settlements, and replaying again is byte-identical', () => {
    const a = replayNativeDemo(input([openAt('o1', T + M)], V2));
    expect(flows(a)).toEqual([[T + F, '2', '50000', '-10'], [T + 2 * F, '2', '51000', '-10.2'], [T + 3 * F, '2', '49000', '-9.8']]);
    expect(replayNativeDemo(input([openAt('o1', T + M)], V2))).toEqual(a);
  });

  test('continuing from a checkpoint (a restart) settles nothing twice', () => {
    const instructions = [openAt('o1', T + M)];
    const full = replayNativeDemoWithBars(input(instructions, V2));
    const first = replayNativeDemoWithBars({ ...input(instructions, V2), asOf: T + F + 30 * M });
    expect(fundingEvents(first.snapshot)).toHaveLength(1);
    const resumed = replayNativeDemoWithBars({ ...input(instructions, V2), checkpoint: first.checkpoint });
    expect(resumed.snapshot).toEqual(full.snapshot);
    expect(fundingEvents(resumed.snapshot)).toHaveLength(3);
  });

  test('switching to V2 re-prices nothing that settled before the switch', () => {
    // V2 starts at 16h. The 8h settlement stays V1: LONG −0.001 × 2 × 50 000 = −100,
    // with no rate fields on its event; the SHORT closed at 7h owes nothing.
    const switched = scheduleWith(NATIVE_CURRENT_FUNDING, T + 2 * F);
    const instructions = [openAt('o1', T + M), openAt('o2', T + 2 * M, 'SHORT'), closeAt('c2', 'o2', T + 7 * H, '50000')];
    const legacy = replayNativeDemo(input(instructions));
    const after = replayNativeDemo(input(instructions, switched));

    const before = (s: DemoState) => s.events.filter((e) => e.time < T + 2 * F);
    expect(before(after)).toEqual(before(legacy));
    expect(before(after).filter((e) => e.kind === 'FUNDING').map((e) => [e.positionId, e.cashflow])).toEqual([['o1', '-100']]);
    expect(before(after).some((e) => 'fundingRate' in e || 'fundingModel' in e)).toBe(false);
    // A trade closed before the switch is exactly the trade it was.
    expect(after.positions.find((p) => p.id === 'o2')).toEqual(legacy.positions.find((p) => p.id === 'o2'));
    // Later settlements use V2: 2 × 51 000 × −0.0001 and 2 × 49 000 × −0.0001.
    expect(fundingEvents(after).filter((e) => e.time >= T + 2 * F).map((e) => [e.time, e.cashflow, e.fundingRate, e.fundingModel]))
      .toEqual([[T + 2 * F, '-10.2', '-0.0001', 'VOLTEX_FIXED_V2'], [T + 3 * F, '-9.8', '-0.0001', 'VOLTEX_FIXED_V2']]);
    // The position's funding is V1 then V2, each counted once: −100 − 10.2 − 9.8.
    expect(after.positions.find((p) => p.id === 'o1')!.fundingNet).toBe('-120');
    // And an old journal with no schedule replays exactly as the legacy schedule.
    expect(replayNativeDemo(input(instructions, LEGACY_FUNDING_SCHEDULE))).toEqual(legacy);
  });

  test('the SHIPPED version, pinned the way production pins it, re-prices nothing that settled before its start', async () => {
    // The pin a first process would write here: the boundary after T + 15h = T + 16h.
    const rows = new Map<string, { version: string; longCashflow: string; shortCashflow: string; effectiveFrom: Date }>();
    const db = { nativeFundingModel: {
      createMany: async ({ data }: { data: { version: string; longCashflow: string; shortCashflow: string; effectiveFrom: Date }[] }) => { for (const d of data) if (!rows.has(d.version)) rows.set(d.version, d); return { count: data.length }; },
      findUnique: async ({ where }: { where: { version: string } }) => rows.get(where.version) ?? null,
    } } as unknown as Parameters<typeof pinNativeFundingSchedule>[0];
    const shipped = await pinNativeFundingSchedule(db, NATIVE_CURRENT_FUNDING, () => T + 15 * H);
    expect(fundingTermsAt(shipped, T + 2 * F)).toMatchObject({ ...VOLTEX_FUNDING, effectiveFrom: T + 2 * F });
    expect(fundingTermsAt(shipped, T + 2 * F - 1).version).toBe('VOLTEX_CUSTOM_DEMO_V1');

    const instructions = [openAt('o1', T + M), openAt('o2', T + 2 * M, 'SHORT'), openAt('o3', T + 3 * M, 'SHORT'), closeAt('c2', 'o2', T + 7 * H, '50000')];
    const legacy = replayNativeDemo(input(instructions));
    const after = replayNativeDemo(input(instructions, shipped));
    const before = (s: DemoState) => s.events.filter((e) => e.time < T + 2 * F);
    expect(before(after)).toEqual(before(legacy));
    expect(after.positions.find((p) => p.id === 'o2')).toEqual(legacy.positions.find((p) => p.id === 'o2'));
    const later = fundingEvents(after).filter((e) => e.time >= T + 2 * F);
    expect(later.length).toBe(4); // o1 and o3 at 16h and 24h
    for (const e of later) {
      const side = after.positions.find((p) => p.id === e.positionId)!.side;
      const rate = side === 'LONG' ? VOLTEX_FUNDING.longCashflow : VOLTEX_FUNDING.shortCashflow;
      expect(e).toMatchObject({ fundingRate: rate, fundingModel: VOLTEX_FUNDING.version });
      expect(e.cashflow).toBe(new BigNumber(e.quantity).times(e.price!).times(rate).toFixed());
    }
  });
});

describe('the schedule and its one-time pin', () => {
  test('terms are chosen by settlement instant; the view names the current and the next settlement’s terms', () => {
    const s = scheduleWith(NATIVE_CURRENT_FUNDING, T + F);
    expect(fundingTermsAt(s, T).version).toBe('VOLTEX_CUSTOM_DEMO_V1');
    expect(fundingTermsAt(s, T + F)).toMatchObject({ ...VOLTEX_FUNDING, effectiveFrom: T + F });
    expect(fundingModelView(s, T + 1)).toMatchObject({ current: { version: 'VOLTEX_CUSTOM_DEMO_V1' }, next: { ...VOLTEX_FUNDING, settlesAt: T + F }, intervalMs: F });
    expect(fundingModelView(s, T + F)).toMatchObject({ current: VOLTEX_FUNDING, next: { ...VOLTEX_FUNDING, settlesAt: T + 2 * F } });
  });

  test('only plain fractions under 1% are accepted, and a start must be a boundary', () => {
    expect(validCashflow('-0.0001')).toBe('-0.0001');
    expect(validCashflow('0.0004')).toBe('0.0004');
    for (const bad of ['0.01', '-0.02', '1e-4', '0.000000001', '', ' 0.0001', '.0001']) expect(() => validCashflow(bad)).toThrow('INVALID_FUNDING_RATE');
    expect(() => scheduleWith(NATIVE_CURRENT_FUNDING, T + 1)).toThrow('INVALID_EFFECTIVE_FROM');
    expect(() => scheduleWith(LEGACY_FUNDING_TERMS, T)).toThrow('INVALID_FUNDING_VERSION');
    expect(nextFundingBoundaryAfter(T)).toBe(T + F);
    expect(nextFundingBoundaryAfter(T + F - 1)).toBe(T + F);
  });

  function fakeDb() {
    const rows = new Map<string, { version: string; longCashflow: string; shortCashflow: string; effectiveFrom: Date }>();
    const db = { nativeFundingModel: {
      createMany: async ({ data, skipDuplicates }: { data: { version: string; longCashflow: string; shortCashflow: string; effectiveFrom: Date }[]; skipDuplicates: boolean }) => {
        let count = 0;
        for (const d of data) { if (rows.has(d.version)) { if (!skipDuplicates) throw new Error('duplicate'); continue; } rows.set(d.version, { ...d }); count++; }
        return { count };
      },
      findUnique: async ({ where }: { where: { version: string } }) => rows.get(where.version) ?? null,
    } };
    return { rows, db: db as unknown as Parameters<typeof pinNativeFundingSchedule>[0] };
  }

  test('the first start pins the next boundary; every later start reads the same row', async () => {
    const { rows, db } = fakeDb();
    const first = await pinNativeFundingSchedule(db, NATIVE_CURRENT_FUNDING, () => T + 5 * H);
    expect(fundingTermsAt(first, T + F)).toMatchObject({ ...VOLTEX_FUNDING, effectiveFrom: T + F });
    expect(fundingTermsAt(first, T + F - 1).version).toBe('VOLTEX_CUSTOM_DEMO_V1');
    const restarted = await pinNativeFundingSchedule(db, NATIVE_CURRENT_FUNDING, () => T + 30 * H);
    expect(restarted).toEqual(first);
    expect(rows.size).toBe(1);
  });

  test('different rates under a pinned version are refused, never applied', async () => {
    const { db } = fakeDb();
    await pinNativeFundingSchedule(db, NATIVE_CURRENT_FUNDING, () => T);
    await expect(pinNativeFundingSchedule(db, { ...NATIVE_CURRENT_FUNDING, longCashflow: '0.0001' }, () => T)).rejects.toThrow('FUNDING_MODEL_CONFLICT');
    await expect(pinNativeFundingSchedule(db, { ...NATIVE_CURRENT_FUNDING, shortCashflow: '0.0005' }, () => T)).rejects.toThrow('FUNDING_MODEL_CONFLICT');
    await expect(pinNativeFundingSchedule(db, { version: 'V3', longCashflow: '-0.05', shortCashflow: '0.0004' }, () => T)).rejects.toThrow('INVALID_FUNDING_RATE');
  });
});

describe('guards', () => {
  const root = join(__dirname, '..', '..', '..');

  test('the real-account funding service never touches native demo positions, and native never calls it', () => {
    const real = readFileSync(join(root, 'src', 'futures', 'FundingRateService.ts'), 'utf8');
    expect(real).not.toMatch(/native|NativeDemo/i);
    const nativeDir = join(root, 'src', 'private-trading', 'native');
    for (const f of readdirSync(nativeDir).filter((f) => f.endsWith('.ts'))) expect(readFileSync(join(nativeDir, f), 'utf8')).not.toMatch(/FundingRateService/);
    expect(existsSync(join(nativeDir, 'fundingModel.ts'))).toBe(true);
  });

  test('both account kinds read the rates from the one config module', () => {
    expect(readFileSync(join(root, 'src', 'futures', 'FundingRateService.ts'), 'utf8')).toMatch(/config\/voltexFunding/);
    expect(readFileSync(join(root, 'src', 'private-trading', 'native', 'fundingModel.ts'), 'utf8')).toMatch(/config\/voltexFunding/);
  });
});
