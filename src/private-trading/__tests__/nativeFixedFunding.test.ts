import BigNumber from 'bignumber.js';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder,
  demoPositionView, closeDemoPosition, settleDemoFunding, DemoInstrument, DemoState } from '../native/engine';
import { accountLedger, positionLedger } from '../native/ledger';
import { fundingModelView, fundingTermsAt, LEGACY_FUNDING_SCHEDULE, NATIVE_FIXED_FUNDING, nextFundingBoundaryAfter,
  scheduleWithFixedRate, validFixedRate } from '../native/fundingModel';
import { NativeInstruction, ReplayBar, replayNativeDemo, replayNativeDemoWithBars } from '../native/replay';
import { pinNativeFundingSchedule } from '../native/store';

/**
 * ONE FIXED FUNDING RATE FOR THE NATIVE DEMO FUTURES ACCOUNT.
 *
 * Every number below is worked by hand from quantity × boundary mark × rate,
 * so a change that applies leverage, charges a closed slice, pays a boundary
 * twice or re-prices an old settlement fails here.
 */

const T = 1_728_000_000_000; // 2024-10-04T00:00:00Z, an 8h UTC boundary
const H = 3_600_000, M = 60_000, F = 8 * H;
const TAKER = '0.00055';
const instrument: DemoInstrument = {
  rules: { symbol: 'BTCUSDT', tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' },
  profile: { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: TAKER, makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '0', riskTiers: [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }], assumptions: [] },
};
const FIXED = scheduleWithFixedRate('TEST_FIXED_V1', '0.0001', T);
const NEGATIVE = scheduleWithFixedRate('TEST_FIXED_NEG_V1', '-0.0001', T);

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
function settle(s: DemoState, at: number, mark: string, schedule = FIXED) {
  markDemoAccount(s, { BTCUSDT: { mark, last: mark } }, at);
  settleDemoFunding(s, at, schedule);
}
const fundingEvents = (s: DemoState) => s.events.filter((e) => e.kind === 'FUNDING');
const flows = (s: DemoState) => fundingEvents(s).map((e) => [e.time, e.quantity, e.price, e.cashflow]);

describe('fixed-rate funding settles quantity x boundary mark x rate at 00/08/16 UTC', () => {
  test('1. a LONG held 24h pays at exactly three settlements', () => {
    // 2 BTC; boundary marks 50 000 / 51 000 / 49 000; rate +0.0001 per 8h.
    //   -2 x 50 000 x 0.0001 = -10, -2 x 51 000 x 0.0001 = -10.2, -2 x 49 000 x 0.0001 = -9.8
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T + 1000);
    settle(s, T + F, '50000'); settle(s, T + 2 * F, '51000'); settle(s, T + 3 * F, '49000');
    expect(flows(s)).toEqual([[T + F, '2', '50000', '-10'], [T + 2 * F, '2', '51000', '-10.2'], [T + 3 * F, '2', '49000', '-9.8']]);
    expect(fundingEvents(s).every((e) => e.fundingRate === '0.0001' && e.fundingModel === 'TEST_FIXED_V1')).toBe(true);
    expect(s.positions[0].fundingNet).toBe('-30');
  });

  test('2. a SHORT held 24h receives the same three amounts', () => {
    const s = state();
    open(s, 'o1', 'SHORT', '2', '50000', T + 1000);
    settle(s, T + F, '50000'); settle(s, T + 2 * F, '51000'); settle(s, T + 3 * F, '49000');
    expect(flows(s).map((f) => f[3])).toEqual(['10', '10.2', '9.8']);
    expect(s.positions[0].fundingNet).toBe('30');
  });

  test('3. opened and closed between two boundaries: no funding at all', () => {
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
    settleDemoFunding(s, T + F, FIXED);
    expect(fundingEvents(s)).toHaveLength(0);
    settle(s, T + 2 * F, '50000');
    expect(flows(s)).toEqual([[T + 2 * F, '2', '50000', '-10']]);
  });

  test('4. partly closed before the next boundary: only the remainder settles', () => {
    // 2 opened, 1.5 closed at 7h; 0.5 x 50 000 x 0.0001 = 2.5 at 8h.
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T + 1000);
    closeDemoPosition(s, 'o1', '1.5', '50000', T + 7 * H);
    settle(s, T + F, '50000');
    expect(flows(s)).toEqual([[T + F, '0.5', '50000', '-2.5']]);
  });

  test('5. the same settlement repeated (restart, second command) is charged once', () => {
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T + 1000);
    settle(s, T + F, '50000');
    const wallet = s.walletBalance;
    settleDemoFunding(s, T + F, FIXED);
    settleDemoFunding(s, T + F, FIXED);
    expect(fundingEvents(s)).toHaveLength(1);
    expect(s.walletBalance).toBe(wallet);
  });

  test('6. the sign follows the rate: negative rate pays the LONG and charges the SHORT', () => {
    for (const [schedule, side, expected] of [[FIXED, 'LONG', '-10'], [FIXED, 'SHORT', '10'], [NEGATIVE, 'LONG', '10'], [NEGATIVE, 'SHORT', '-10']] as const) {
      const s = state();
      open(s, 'o1', side, '2', '50000', T + 1000);
      settle(s, T + F, '50000', schedule);
      expect(flows(s).map((f) => f[3])).toEqual([expected]);
      expect(fundingEvents(s)[0].fundingRate).toBe(schedule === FIXED ? '0.0001' : '-0.0001');
    }
  });

  test('leverage never multiplies funding: 1x and 100x pay the same on the same quantity', () => {
    const paid = (leverage: string) => { const s = state(); open(s, 'o1', 'LONG', '2', '50000', T + 1000, { leverage }); settle(s, T + F, '50000'); return flows(s)[0][3]; };
    expect(paid('1')).toBe('-10');
    expect(paid('100')).toBe('-10');
  });

  test('an ISOLATED position settles funding against its own post, not the shared wallet', () => {
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T + 1000, { marginType: 'ISOLATED' });
    const wallet = s.walletBalance, post = s.positions[0].isolatedMargin;
    settle(s, T + F, '50000');
    expect(s.walletBalance).toBe(wallet);
    expect(s.positions[0].isolatedMargin).toBe(new BigNumber(post).minus(10).toFixed());
    expect(s.positions[0].fundingNet).toBe('-10');
  });
});

describe('net P&L = trading P&L - fees + funding, and it is what the wallet moved', () => {
  test('7. a closed CROSS trade: Net P&L equals the ledger and wallet change exactly', () => {
    // BEFORE 10 000 000.
    //   open 2 @ 50 000            fee 2 x 50 000 x 0.00055 = 55
    //   funding 8h  mark 50 000    -10
    //   funding 16h mark 51 000    -10.2
    //   close 2 @ 52 000           gross 4 000, fee 2 x 52 000 x 0.00055 = 57.2
    //   net = 4 000 - 112.2 - 20.2 = 3 867.6
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
      .toEqual([['-10', '0.0001', 'TEST_FIXED_V1'], ['-10.2', '0.0001', 'TEST_FIXED_V1']]);
    const lines = positionLedger(s, 'o1');
    expect(lines.reduce((a, l) => a.plus(l.amount), new BigNumber(0)).toFixed()).toBe(view.netPnl);
  });

  test('a SHORT closed at a loss with funding received still reconciles', () => {
    const s = state();
    open(s, 'o1', 'SHORT', '1', '50000', T + 1000);
    settle(s, T + F, '50000');
    closeDemoPosition(s, 'o1', undefined, '50500', T + F + 1000);
    const view = demoPositionView(s, s.positions[0]);
    // gross -500, fees 27.5 + 27.775, funding +5
    expect(view).toMatchObject({ tradingPnl: '-500', feesPaid: '55.275', fundingNet: '5', netPnl: '-550.275' });
    expect(new BigNumber(s.walletBalance).minus('10000000').toFixed()).toBe(view.netPnl);
    expect(accountLedger(s).reconciled).toBe(true);
  });
});

describe('replay: restarts and the switch from the legacy model', () => {
  const rules = instrument.rules;
  const bar = (time: number, price: string): ReplayBar => ({ time, intervalMs: M, trade: { timestamp: time, open: price, low: price, high: price, close: price }, mark: { timestamp: time, open: price, low: price, high: price, close: price } });
  /** Minute bars whose price changes at each 8h boundary. */
  const bars = (from: number, to: number, priceAt: (t: number) => string) => { const out: ReplayBar[] = []; for (let t = from; t < to; t += M) out.push(bar(t, priceAt(t))); return out; };
  const price = (t: number) => ['50000', '50000', '51000', '49000', '49000'][Math.floor((t - T) / F)];
  const openAt = (id: string, at: number, side: 'LONG' | 'SHORT' = 'LONG'): NativeInstruction =>
    ({ id, at, kind: 'OPEN', order: { id, symbol: 'BTCUSDT', side, type: 'MARKET', quantity: '2', leverage: '20', historical: true }, instrument: { rules, profile: instrument.profile }, mark: '50000', last: '50000', point: '50000' });
  const closeAt = (id: string, positionId: string, at: number, p: string): NativeInstruction => ({ id, at, kind: 'CLOSE', positionId, price: p });
  const end = T + 3 * F + 2 * M;
  const input = (instructions: NativeInstruction[], funding?: typeof FIXED) => ({ deposit: '1000000', instructions, bars: { BTCUSDT: bars(T, end + M, price) }, asOf: end, ...(funding ? { funding } : {}) });

  test('a 24h replay charges the three fixed settlements, and replaying again is byte-identical', () => {
    const a = replayNativeDemo(input([openAt('o1', T + M)], FIXED));
    expect(flows(a)).toEqual([[T + F, '2', '50000', '-10'], [T + 2 * F, '2', '51000', '-10.2'], [T + 3 * F, '2', '49000', '-9.8']]);
    expect(replayNativeDemo(input([openAt('o1', T + M)], FIXED))).toEqual(a);
  });

  test('5. continuing from a checkpoint (a restart) settles nothing twice', () => {
    const instructions = [openAt('o1', T + M)];
    const full = replayNativeDemoWithBars(input(instructions, FIXED));
    const first = replayNativeDemoWithBars({ ...input(instructions, FIXED), asOf: T + F + 30 * M });
    expect(fundingEvents(first.snapshot)).toHaveLength(1);
    const resumed = replayNativeDemoWithBars({ ...input(instructions, FIXED), checkpoint: first.checkpoint });
    expect(resumed.snapshot).toEqual(full.snapshot);
    expect(fundingEvents(resumed.snapshot)).toHaveLength(3);
  });

  test('8. switching models re-prices nothing that settled before the switch', () => {
    // The fixed version starts at 16h. The 8h settlement stays VOLTEX_CUSTOM_DEMO_V1:
    // LONG -0.001 x 2 x 50 000 = -100, with no rate fields on its event.
    const switched = scheduleWithFixedRate('TEST_FIXED_V1', '0.0001', T + 2 * F);
    const instructions = [openAt('o1', T + M), openAt('o2', T + 2 * M, 'SHORT'), closeAt('c2', 'o2', T + 7 * H, '50000')];
    const legacy = replayNativeDemo(input(instructions));
    const after = replayNativeDemo(input(instructions, switched));

    const before = (s: DemoState) => s.events.filter((e) => e.time < T + 2 * F);
    expect(before(after)).toEqual(before(legacy));
    expect(before(after).filter((e) => e.kind === 'FUNDING').map((e) => [e.positionId, e.cashflow])).toEqual([['o1', '-100']]);
    expect(before(after).some((e) => 'fundingRate' in e || 'fundingModel' in e)).toBe(false);
    // A trade closed before the switch is exactly the trade it was.
    expect(after.positions.find((p) => p.id === 'o2')).toEqual(legacy.positions.find((p) => p.id === 'o2'));
    // Later settlements use the fixed rate.
    expect(fundingEvents(after).filter((e) => e.time >= T + 2 * F).map((e) => [e.time, e.cashflow, e.fundingRate]))
      .toEqual([[T + 2 * F, '-10.2', '0.0001'], [T + 3 * F, '-9.8', '0.0001']]);
    // And an old journal with no schedule replays exactly as the legacy schedule.
    expect(replayNativeDemo(input(instructions, LEGACY_FUNDING_SCHEDULE))).toEqual(legacy);
  });

  test('the SHIPPED model, pinned the way production pins it, re-prices nothing that settled before its start', async () => {
    // Whatever `NATIVE_FIXED_FUNDING` holds — null today, the Bybit rate once
    // its evidence is committed — goes through the real pin with the start a
    // first process would get here (the boundary after T + 15h = T + 16h).
    const rows = new Map<string, { version: string; rate: string; effectiveFrom: Date; evidenceSha256: string }>();
    const db = { nativeFundingModel: {
      createMany: async ({ data }: { data: { version: string; rate: string; effectiveFrom: Date; evidenceSha256: string }[] }) => { for (const d of data) if (!rows.has(d.version)) rows.set(d.version, d); return { count: data.length }; },
      findUnique: async ({ where }: { where: { version: string } }) => rows.get(where.version) ?? null,
    } } as unknown as Parameters<typeof pinNativeFundingSchedule>[0];
    const shipped = await pinNativeFundingSchedule(db, NATIVE_FIXED_FUNDING, () => T + 15 * H);
    const instructions = [openAt('o1', T + M), openAt('o2', T + 2 * M, 'SHORT'), closeAt('c2', 'o2', T + 7 * H, '50000')];
    const legacy = replayNativeDemo(input(instructions));
    const after = replayNativeDemo(input(instructions, shipped));
    const before = (s: DemoState) => s.events.filter((e) => e.time < T + 2 * F);
    expect(before(after)).toEqual(before(legacy));
    expect(after.positions.find((p) => p.id === 'o2')).toEqual(legacy.positions.find((p) => p.id === 'o2'));
    if (NATIVE_FIXED_FUNDING.rate === null) {
      // Nothing shipped: the account is exactly the account it was.
      expect(shipped).toBe(LEGACY_FUNDING_SCHEDULE);
      expect(after).toEqual(legacy);
      expect(rows.size).toBe(0);
    } else {
      // Shipped: later settlements, and only those, carry the shipped rate.
      expect(fundingTermsAt(shipped, T + 2 * F)).toMatchObject({ version: NATIVE_FIXED_FUNDING.version, rate: NATIVE_FIXED_FUNDING.rate, effectiveFrom: T + 2 * F });
      const later = fundingEvents(after).filter((e) => e.time >= T + 2 * F);
      expect(later.length).toBeGreaterThan(0);
      for (const e of later) {
        expect(e).toMatchObject({ fundingRate: NATIVE_FIXED_FUNDING.rate, fundingModel: NATIVE_FIXED_FUNDING.version });
        expect(e.cashflow).toBe(new BigNumber(e.quantity).times(e.price!).times(NATIVE_FIXED_FUNDING.rate).negated().toFixed());
      }
    }
  });
});

describe('the schedule and its one-time pin', () => {
  test('terms are chosen by settlement instant, and the view names the active and upcoming version', () => {
    const s = scheduleWithFixedRate('V2', '0.00005', T + F);
    expect(fundingTermsAt(s, T).version).toBe('VOLTEX_CUSTOM_DEMO_V1');
    expect(fundingTermsAt(s, T + F)).toMatchObject({ version: 'V2', kind: 'FIXED_RATE', rate: '0.00005' });
    expect(fundingModelView(s, T).upcoming).toMatchObject({ version: 'V2', effectiveFrom: T + F });
    expect(fundingModelView(s, T + F)).toMatchObject({ active: { version: 'V2' }, upcoming: null, intervalMs: F });
  });

  test('only plain rates under 1% are accepted, and a start must be a boundary', () => {
    expect(validFixedRate('0.0001')).toBe('0.0001');
    expect(validFixedRate('-0.00003125')).toBe('-0.00003125');
    for (const bad of ['0.01', '-0.02', '1e-4', '0.000000001', '', ' 0.0001', '.0001']) expect(() => validFixedRate(bad)).toThrow('INVALID_FUNDING_RATE');
    expect(() => scheduleWithFixedRate('V2', '0.0001', T + 1)).toThrow('INVALID_EFFECTIVE_FROM');
    expect(() => scheduleWithFixedRate('VOLTEX_CUSTOM_DEMO_V1', '0.0001', T)).toThrow('INVALID_FUNDING_VERSION');
    expect(nextFundingBoundaryAfter(T)).toBe(T + F);
    expect(nextFundingBoundaryAfter(T + F - 1)).toBe(T + F);
  });

  function fakeDb() {
    const rows = new Map<string, { version: string; rate: string; effectiveFrom: Date; evidenceSha256: string }>();
    const db = { nativeFundingModel: {
      createMany: async ({ data, skipDuplicates }: { data: { version: string; rate: string; effectiveFrom: Date; evidenceSha256: string }[]; skipDuplicates: boolean }) => {
        let count = 0;
        for (const d of data) { if (rows.has(d.version)) { if (!skipDuplicates) throw new Error('duplicate'); continue; } rows.set(d.version, { ...d }); count++; }
        return { count };
      },
      findUnique: async ({ where }: { where: { version: string } }) => rows.get(where.version) ?? null,
    } };
    return { rows, db: db as unknown as Parameters<typeof pinNativeFundingSchedule>[0] };
  }
  const evidence = 'a'.repeat(64);

  test('no rate shipped: the legacy schedule, and nothing is written', async () => {
    const { rows, db } = fakeDb();
    expect(await pinNativeFundingSchedule(db, { version: 'V2', rate: null, evidence: null })).toBe(LEGACY_FUNDING_SCHEDULE);
    expect(rows.size).toBe(0);
  });

  test('the first start pins the next boundary; every later start reads the same row', async () => {
    const { rows, db } = fakeDb();
    const first = await pinNativeFundingSchedule(db, { version: 'V2', rate: '0.0001', evidence }, () => T + 5 * H);
    expect(fundingTermsAt(first, T + F)).toMatchObject({ version: 'V2', rate: '0.0001', effectiveFrom: T + F });
    expect(fundingTermsAt(first, T + F - 1).version).toBe('VOLTEX_CUSTOM_DEMO_V1');
    const restarted = await pinNativeFundingSchedule(db, { version: 'V2', rate: '0.0001', evidence }, () => T + 30 * H);
    expect(restarted).toEqual(first);
    expect(rows.size).toBe(1);
  });

  test('a different rate under a pinned version, or no evidence, is refused', async () => {
    const { db } = fakeDb();
    await pinNativeFundingSchedule(db, { version: 'V2', rate: '0.0001', evidence }, () => T);
    await expect(pinNativeFundingSchedule(db, { version: 'V2', rate: '0.0002', evidence }, () => T)).rejects.toThrow('FUNDING_MODEL_CONFLICT');
    await expect(pinNativeFundingSchedule(db, { version: 'V2', rate: '0.0001', evidence: 'b'.repeat(64) }, () => T)).rejects.toThrow('FUNDING_MODEL_CONFLICT');
    await expect(pinNativeFundingSchedule(db, { version: 'V3', rate: '0.0001', evidence: null }, () => T)).rejects.toThrow('FUNDING_EVIDENCE_MISSING');
    await expect(pinNativeFundingSchedule(db, { version: 'V3', rate: '0.05', evidence }, () => T)).rejects.toThrow('INVALID_FUNDING_RATE');
  });
});

describe('guards', () => {
  const root = join(__dirname, '..', '..', '..');

  test('a shipped rate must be the committed Bybit evidence, never a typed-in number', () => {
    if (NATIVE_FIXED_FUNDING.rate === null) { expect(NATIVE_FIXED_FUNDING.evidence).toBeNull(); return; }
    const dir = join(root, 'docs', 'research');
    const match = readdirSync(dir).filter((f) => /^bybit-funding-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .find((f) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex') === NATIVE_FIXED_FUNDING.evidence);
    expect(match).toBeDefined();
    const summary = JSON.parse(readFileSync(join(dir, match!), 'utf8')).summary;
    expect(summary.usable).toBe(true);
    expect(summary.fixedRate8h).toBe(new BigNumber(NATIVE_FIXED_FUNDING.rate).toFixed(8));
  });

  test('the legacy real-account funding service never touches native demo positions, and native never calls it', () => {
    const legacy = readFileSync(join(root, 'src', 'futures', 'FundingRateService.ts'), 'utf8');
    expect(legacy).not.toMatch(/native|NativeDemo/i);
    const nativeDir = join(root, 'src', 'private-trading', 'native');
    for (const f of readdirSync(nativeDir).filter((f) => f.endsWith('.ts'))) expect(readFileSync(join(nativeDir, f), 'utf8')).not.toMatch(/FundingRateService/);
    expect(existsSync(join(nativeDir, 'fundingModel.ts'))).toBe(true);
  });
});
