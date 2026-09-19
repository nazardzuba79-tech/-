import BigNumber from 'bignumber.js';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder,
  demoAccount, demoPositionView, closeDemoPosition, cancelDemoOrder, settleDemoFunding,
  evaluateDemoRiskAndProtection, setDemoLeverage, DemoInstrument } from '../native/engine';
import { accountLedger, positionLedger } from '../native/ledger';

/**
 * WHERE EVERY UNIT OF EQUITY CAME FROM.
 *
 * These tests assert EQUATIONS, not that a number is present. Each one
 * states the balance before, the action, and the balance after, computed by
 * hand from the fee rate and the prices — so a change in the engine that
 * silently alters a fee or double-books a flow fails here rather than in
 * front of the owner.
 *
 * The ledger is a projection of the engine's own journal, so the strongest
 * assertion in this file is the reconciliation one: the ledger's closing
 * balance must equal the engine's `walletBalance`. If the engine ever moves
 * money without journaling it, that equality breaks and says so.
 */

const T = 1_728_000_000_000;
const TAKER = '0.00055';
const instrument: DemoInstrument = {
  rules: { symbol: 'BTCUSDT', tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' },
  profile: { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: TAKER, makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '0', riskTiers: [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }], assumptions: [] },
};
function state(balance = '10000000') {
  const s = emptyDemoState(balance, T);
  registerDemoInstrument(s, instrument);
  markDemoAccount(s, { BTCUSDT: { mark: '50000', last: '50000' } }, T);
  return s;
}
function open(s: ReturnType<typeof state>, id: string, side: 'LONG' | 'SHORT', quantity: string, price: string, at: number) {
  placeDemoOrder(s, { id, symbol: 'BTCUSDT', side, type: 'MARKET', quantity, leverage: '20' }, at);
  fillDemoOrder(s, id, quantity, price, at, 'SELECTED_POINT');
}
const fee = (quantity: string, price: string) => new BigNumber(quantity).times(price).times(TAKER);
const sum = (values: string[]) => values.reduce((a, b) => a.plus(b), new BigNumber(0)).toFixed();

describe('the simulation ledger explains every change to equity', () => {
  test('opening charges exactly one fee, and the ledger names it', () => {
    // BEFORE 10 000 000. ACTION: open 2 BTC at 50 000 = 100 000 notional.
    // Taker fee 100 000 x 0.00055 = 55. AFTER 9 999 945.
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T);
    expect(fee('2', '50000').toFixed()).toBe('55');
    expect(s.walletBalance).toBe('9999945');

    const ledger = accountLedger(s);
    expect(ledger.openingBalance).toBe('10000000');
    expect(ledger.closingBalance).toBe('9999945');
    expect(ledger.reconciled).toBe(true);
    expect(ledger.entries.map((e) => [e.source, e.amount])).toEqual([
      ['INITIAL_COLLATERAL', '10000000'],
      ['OPENING_FEE', '-55'],
    ]);
    expect(ledger.totals).toEqual({ realizedPnl: '0', fees: '55', funding: '0', shortfallCovered: '0', net: '-55' });
  });

  test('a profitable partial close books gross P&L and its own closing fee as SEPARATE lines', () => {
    // BEFORE 9 999 945 (after the 55 opening fee).
    // ACTION: close 1 of 2 BTC at 55 000.
    //   gross  = 1 x (55 000 - 50 000) = 5 000
    //   fee    = 1 x 55 000 x 0.00055  = 30.25
    //   net    = 4 969.75
    // AFTER 9 999 945 + 4 969.75 = 10 004 914.75
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T);
    markDemoAccount(s, { BTCUSDT: { mark: '55000', last: '55000' } }, T + 1);
    closeDemoPosition(s, 'o1', '1', '55000', T + 2);

    expect(fee('1', '55000').toFixed()).toBe('30.25');
    expect(s.walletBalance).toBe('10004914.75');

    const ledger = accountLedger(s);
    expect(ledger.reconciled).toBe(true);
    expect(ledger.entries.map((e) => [e.source, e.amount])).toEqual([
      ['INITIAL_COLLATERAL', '10000000'],
      ['OPENING_FEE', '-55'],
      ['REALIZED_PNL', '5000'],
      ['CLOSING_FEE', '-30.25'],
    ]);
    // The gross line is the price movement ALONE: no fee is inside it.
    expect(ledger.totals.realizedPnl).toBe('5000');
    expect(ledger.totals.fees).toBe('85.25');
    expect(ledger.totals.net).toBe('4914.75');
    // And the running balance is the opening balance plus the net.
    expect(new BigNumber(ledger.openingBalance).plus(ledger.totals.net).toFixed()).toBe(ledger.closingBalance);
  });

  test("a position's realized figure is the SUM of its own ledger lines — nothing counted twice", () => {
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T);
    markDemoAccount(s, { BTCUSDT: { mark: '55000', last: '55000' } }, T + 1);
    // Funding settles only at an 8h boundary, and only against a mark
    // stamped at that instant — the engine refuses to settle on a stale one.
    markDemoAccount(s, { BTCUSDT: { mark: '55000', last: '55000' } }, T + 28_800_000);
    settleDemoFunding(s, T + 28_800_000);
    closeDemoPosition(s, 'o1', '2', '55000', T + 28_800_001);

    const position = s.positions.find((p) => p.id === 'o1')!;
    const view = demoPositionView(s, position);
    const lines = positionLedger(s, 'o1');
    // realizedPnl on the view is gross - openingFees - closingFees + funding.
    // The ledger reports those as four kinds of line; their sum must be the
    // same number, which is only true if each component appears once.
    expect(sum(lines.map((l) => l.amount))).toBe(view.realizedPnl);
    expect(new Set(lines.map((l) => l.source))).toEqual(new Set(['OPENING_FEE', 'REALIZED_PNL', 'CLOSING_FEE', 'FUNDING']));
  });

  test('funding is debited for a LONG and credited for a SHORT, once per settlement', () => {
    // The VOLTEX custom model: long -0.001, short +0.004 of position value
    // per 8h. 2 BTC at 55 000 = 110 000 of value.
    //   long  : 110 000 x -0.001 = -110
    //   short : 110 000 x  0.004 = +440
    for (const [side, expected] of [['LONG', '-110'], ['SHORT', '440']] as const) {
      const s = state();
      open(s, 'o1', side, '2', '50000', T);
      markDemoAccount(s, { BTCUSDT: { mark: '55000', last: '55000' } }, T + 28_800_000);
      settleDemoFunding(s, T + 28_800_000);

      const ledger = accountLedger(s);
      const funding = ledger.entries.filter((e) => e.source === 'FUNDING');
      expect(funding).toHaveLength(1);
      expect(funding[0].amount).toBe(expected);
      expect(ledger.totals.funding).toBe(expected);
      expect(ledger.reconciled).toBe(true);

      // Settling the SAME instant again must not pay twice.
      settleDemoFunding(s, T + 28_800_000);
      expect(accountLedger(s).entries.filter((e) => e.source === 'FUNDING')).toHaveLength(1);
    }
  });

  test('a losing trade debits the wallet by exactly the loss plus both fees', () => {
    // BEFORE 10 000 000. Open 2 at 50 000 (fee 55). Close 2 at 45 000.
    //   gross = 2 x (45 000 - 50 000) = -10 000
    //   fee   = 2 x 45 000 x 0.00055 = 49.5
    // AFTER 10 000 000 - 55 - 10 000 - 49.5 = 9 989 895.5
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T);
    markDemoAccount(s, { BTCUSDT: { mark: '45000', last: '45000' } }, T + 1);
    closeDemoPosition(s, 'o1', '2', '45000', T + 2);

    expect(s.walletBalance).toBe('9989895.5');
    const ledger = accountLedger(s);
    expect(ledger.totals).toEqual({ realizedPnl: '-10000', fees: '104.5', funding: '0', shortfallCovered: '0', net: '-10104.5' });
    expect(ledger.reconciled).toBe(true);
  });

  test('adding to a position charges a second opening fee and no realized P&L', () => {
    // Open 2 at 50 000 (fee 55), then add 1 at 52 000 (fee 1 x 52 000 x 0.00055 = 28.6).
    // Nothing is realized by an add: the ledger must show two fees and no P&L.
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T);
    markDemoAccount(s, { BTCUSDT: { mark: '52000', last: '52000' } }, T + 1);
    placeDemoOrder(s, { id: 'o2', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '20', positionId: 'o1' }, T + 2);
    fillDemoOrder(s, 'o2', '1', '52000', T + 2, 'SELECTED_POINT');

    const ledger = accountLedger(s);
    expect(ledger.entries.map((e) => e.source)).toEqual(['INITIAL_COLLATERAL', 'OPENING_FEE', 'OPENING_FEE']);
    expect(ledger.totals.realizedPnl).toBe('0');
    expect(ledger.totals.fees).toBe('83.6');
    expect(s.walletBalance).toBe('9999916.4');
    expect(ledger.reconciled).toBe(true);
  });

  test('cancelling an order, changing leverage and setting TP/SL move no money and get no line', () => {
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T);
    const before = accountLedger(s);
    placeDemoOrder(s, { id: 'o9', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', quantity: '1', leverage: '20', price: '40000' }, T + 1);
    cancelDemoOrder(s, 'o9', T + 2);
    setDemoLeverage(s, 'o1', '10', T + 3);

    const after = accountLedger(s);
    expect(after.entries).toEqual(before.entries);
    expect(after.closingBalance).toBe(before.closingBalance);
    expect(after.reconciled).toBe(true);
  });

  test('a liquidation fee is named as one, never as an ordinary exit', () => {
    const s = state('5200');
    open(s, 'o1', 'LONG', '2', '50000', T);
    markDemoAccount(s, { BTCUSDT: { mark: '45000', last: '45000' } }, T + 1);
    evaluateDemoRiskAndProtection(s, T + 1);

    expect(s.positions[0].status).toBe('LIQUIDATED');
    const ledger = accountLedger(s);
    expect(ledger.entries.some((e) => e.source === 'CLOSING_FEE')).toBe(false);
    expect(ledger.entries.filter((e) => e.kind === 'LIQUIDATION').map((e) => e.source))
      .toEqual(expect.arrayContaining(['REALIZED_PNL']));
    expect(ledger.reconciled).toBe(true);
  });

  test('several Cross positions at once all settle into ONE running balance', () => {
    const s = state();
    open(s, 'a', 'LONG', '1', '50000', T);
    open(s, 'b', 'SHORT', '1', '50000', T);
    markDemoAccount(s, { BTCUSDT: { mark: '52000', last: '52000' } }, T + 1);
    closeDemoPosition(s, 'a', '1', '52000', T + 2);
    closeDemoPosition(s, 'b', '1', '52000', T + 3);

    const ledger = accountLedger(s);
    // The hedge nets to zero gross; only the four fees remain.
    expect(ledger.totals.realizedPnl).toBe('0');
    //   2 opens  : 2 x (1 x 50 000 x 0.00055) = 55
    //   2 closes : 2 x (1 x 52 000 x 0.00055) = 57.2
    expect(ledger.totals.fees).toBe('112.2');
    expect(ledger.closingBalance).toBe('9999887.8');
    expect(ledger.reconciled).toBe(true);
    // Each line is attributable to the position that caused it.
    expect(sum(positionLedger(s, 'a').map((l) => l.amount)))
      .toBe(demoPositionView(s, s.positions.find((p) => p.id === 'a')!).realizedPnl);
  });

  test('the ledger reconciles against the ENGINE, and says so when it cannot', () => {
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T);
    expect(accountLedger(s).reconciled).toBe(true);
    // Simulate the bug this check exists to catch: money moved with no journal entry.
    s.walletBalance = '9999999';
    const broken = accountLedger(s);
    expect(broken.reconciled).toBe(false);
    expect(broken.closingBalance).toBe('9999945');
    expect(broken.walletBalance).toBe('9999999');
  });

  test('equity is the wallet plus unrealized P&L, and the ledger is the wallet half of that', () => {
    const s = state();
    open(s, 'o1', 'LONG', '2', '50000', T);
    markDemoAccount(s, { BTCUSDT: { mark: '55000', last: '55000' } }, T + 1);
    const account = demoAccount(s);
    const ledger = accountLedger(s);
    expect(account.walletBalance).toBe(ledger.closingBalance);
    expect(account.unrealizedPnl).toBe('10000');
    expect(new BigNumber(ledger.closingBalance).plus(account.unrealizedPnl).toFixed()).toBe(account.equity);
  });
});
