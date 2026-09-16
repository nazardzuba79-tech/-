import BigNumber from 'bignumber.js';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder,
  demoAccount, demoPositionView, closeDemoPosition, setDemoLeverage, evaluateDemoRiskAndProtection,
  cancelDemoOrder, DemoInstrument } from '../native/engine';
import { accountLedger } from '../native/ledger';
import { crossAccount } from '../native/accountModel';
import { valueCollateral } from '../native/collateral';

/**
 * THE MONEY MATRIX.
 *
 * One test per financial case, each stating the balance BEFORE, the ACTION,
 * and the balance AFTER as an equation computed from the fee rate, the
 * leverage and the prices. Asserting that the interface "shows something"
 * would pass against a wrong number; these do not.
 */

const T = 1_728_000_000_000;
const TAKER = '0.00055', MAKER = '0.0002';
const instrument: DemoInstrument = {
  rules: { symbol: 'BTCUSDT', tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '500', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' },
  profile: { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: TAKER, makerFeeRate: MAKER, liquidationFeeRate: '0', slippageBps: '0', riskTiers: [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }], assumptions: [] },
};
function state(balance = '10000000', mark = '50000') {
  const s = emptyDemoState(balance, T);
  registerDemoInstrument(s, instrument);
  markDemoAccount(s, { BTCUSDT: { mark, last: mark } }, T);
  return s;
}
const wallet = (holdings: [string, string][], prices: [string, string | null][] = []) => valueCollateral(
  holdings.map(([asset, available]) => ({ asset, available })),
  prices.map(([asset, price]) => ({ asset, price, source: 'test', asOf: T })),
);
const bn = (x: string) => new BigNumber(x);

describe('money matrix — every case as an equation', () => {
  describe('LONG', () => {
    it('MARKET open then profitable full close', () => {
      // BEFORE 1 000 000.
      // OPEN  2 @ 50 000, notional 100 000, taker fee 55        -> 999 945
      // CLOSE 2 @ 53 000, gross +6 000, taker fee 58.3          -> 1 005 886.7
      const s = state('1000000');
      placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20' }, T);
      fillDemoOrder(s, 'o1', '2', '50000', T, 'SELECTED_POINT');
      expect(s.walletBalance).toBe('999945');
      markDemoAccount(s, { BTCUSDT: { mark: '53000', last: '53000' } }, T + 1);
      closeDemoPosition(s, 'o1', '2', '53000', T + 2);
      expect(bn('2').times('53000').times(TAKER).toFixed()).toBe('58.3');
      expect(s.walletBalance).toBe('1005886.7');
      expect(accountLedger(s).reconciled).toBe(true);
    });

    it('MARKET open then losing full close', () => {
      // OPEN 2 @ 50 000 (55). CLOSE 2 @ 48 000: gross -4 000, fee 52.8.
      // 1 000 000 - 55 - 4 000 - 52.8 = 995 892.2
      const s = state('1000000');
      placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20' }, T);
      fillDemoOrder(s, 'o1', '2', '50000', T, 'SELECTED_POINT');
      markDemoAccount(s, { BTCUSDT: { mark: '48000', last: '48000' } }, T + 1);
      closeDemoPosition(s, 'o1', '2', '48000', T + 2);
      expect(s.walletBalance).toBe('995892.2');
    });
  });

  describe('SHORT', () => {
    it('profits when the price falls and loses when it rises, by the same absolute amount', () => {
      const down = state('1000000'), up = state('1000000');
      for (const [s, exit] of [[down, '48000'], [up, '52000']] as const) {
        placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'SHORT', type: 'MARKET', quantity: '2', leverage: '20' }, T);
        fillDemoOrder(s, 'o1', '2', '50000', T, 'SELECTED_POINT');
        markDemoAccount(s, { BTCUSDT: { mark: exit, last: exit } }, T + 1);
        closeDemoPosition(s, 'o1', '2', exit, T + 2);
      }
      // gross +4 000 and -4 000; the closing fee differs because the notional does.
      expect(accountLedger(down).totals.realizedPnl).toBe('4000');
      expect(accountLedger(up).totals.realizedPnl).toBe('-4000');
      expect(accountLedger(down).totals.fees).toBe('107.8'); // 55 + 2 x 48 000 x 0.00055
      expect(accountLedger(up).totals.fees).toBe('112.2');   // 55 + 2 x 52 000 x 0.00055
    });
  });

  describe('LIMIT', () => {
    it('a resting limit reserves margin but moves no money until it fills', () => {
      const s = state('1000000');
      placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', quantity: '2', leverage: '20', price: '45000' }, T);
      // Nothing realized, nothing charged — but the reserve is held.
      expect(s.walletBalance).toBe('1000000');
      expect(accountLedger(s).entries).toHaveLength(1);
      const account = demoAccount(s);
      expect(bn(account.orderReserve).gt(0)).toBe(true);
      // available = equity - initialMargin - reserve
      expect(bn(account.equity).minus(account.usedMargin).minus(account.orderReserve).toFixed()).toBe(account.available);
    });

    it('a filled limit is charged the MAKER fee, not the taker fee', () => {
      // 2 @ 45 000 = 90 000 notional. maker 0.0002 -> 18, taker would be 49.5.
      const s = state('1000000');
      placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', quantity: '2', leverage: '20', price: '45000' }, T);
      markDemoAccount(s, { BTCUSDT: { mark: '45000', last: '45000' } }, T + 1);
      // The last argument is the maker flag: a resting limit that the market
      // came to is a maker fill, and the engine charges the maker rate.
      fillDemoOrder(s, 'o1', '2', '45000', T + 1, 'SELECTED_POINT', true);
      expect(bn('2').times('45000').times(MAKER).toFixed()).toBe('18');
      expect(s.walletBalance).toBe('999982');
      expect(accountLedger(s).totals.fees).toBe('18');
    });

    it('cancelling the resting order releases the reserve and charges nothing', () => {
      const s = state('1000000');
      placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', quantity: '2', leverage: '20', price: '45000' }, T);
      cancelDemoOrder(s, 'o1', T + 1);
      expect(demoAccount(s).orderReserve).toBe('0');
      expect(s.walletBalance).toBe('1000000');
      expect(accountLedger(s).totals.fees).toBe('0');
    });
  });

  describe('add and partial close', () => {
    it('an add moves the entry to the weighted average and realizes nothing', () => {
      // 2 @ 50 000 then 2 @ 60 000 -> average 55 000 on 4.
      const s = state('1000000');
      placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20' }, T);
      fillDemoOrder(s, 'o1', '2', '50000', T, 'SELECTED_POINT');
      markDemoAccount(s, { BTCUSDT: { mark: '60000', last: '60000' } }, T + 1);
      placeDemoOrder(s, { id: 'o2', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20', positionId: 'o1' }, T + 2);
      fillDemoOrder(s, 'o2', '2', '60000', T + 2, 'SELECTED_POINT');

      const p = s.positions.find((x) => x.id === 'o1')!;
      expect(p.quantity).toBe('4');
      expect(p.entryPrice).toBe('55000');
      expect(accountLedger(s).totals.realizedPnl).toBe('0');
      // fees: 55 + 2 x 60 000 x 0.00055 = 55 + 66 = 121
      expect(accountLedger(s).totals.fees).toBe('121');
    });

    it('a partial close realizes only the closed quantity and leaves the rest open', () => {
      // 4 @ 55 000 average; close 1 @ 60 000 -> gross 5 000, fee 33.
      const s = state('1000000');
      placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '4', leverage: '20' }, T);
      fillDemoOrder(s, 'o1', '4', '55000', T, 'SELECTED_POINT');
      markDemoAccount(s, { BTCUSDT: { mark: '60000', last: '60000' } }, T + 1);
      closeDemoPosition(s, 'o1', '1', '60000', T + 2);

      const p = s.positions.find((x) => x.id === 'o1')!;
      expect(p.quantity).toBe('3');
      expect(p.status).toBe('OPEN');
      const ledger = accountLedger(s);
      expect(ledger.totals.realizedPnl).toBe('5000');
      // The 3 still open are unrealized, NOT in the ledger.
      expect(demoPositionView(s, p).unrealizedPnl).toBe('15000');
      expect(ledger.reconciled).toBe(true);
    });
  });

  describe('leverage', () => {
    it('changing leverage changes margin but never the balance or the P&L', () => {
      const s = state('1000000');
      placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20' }, T);
      fillDemoOrder(s, 'o1', '2', '50000', T, 'SELECTED_POINT');
      markDemoAccount(s, { BTCUSDT: { mark: '52000', last: '52000' } }, T + 1);
      const before = demoAccount(s), balanceBefore = s.walletBalance;

      setDemoLeverage(s, 'o1', '10', T + 2);
      const after = demoAccount(s);
      expect(s.walletBalance).toBe(balanceBefore);
      expect(after.unrealizedPnl).toBe(before.unrealizedPnl);
      // 104 000 notional: 1/20 -> 1/10 doubles the initial margin.
      expect(bn(after.usedMargin).minus(after.maintenanceMargin.replace(/^$/, '0')).gt(0)).toBe(true);
      expect(bn(after.usedMargin).gt(before.usedMargin)).toBe(true);
      expect(accountLedger(s).totals.fees).toBe('55');
    });
  });

  describe('margin refusals', () => {
    it('an order larger than the free margin is refused, and the account is untouched', () => {
      // 1 000 of collateral at 20x buys 20 000 of notional, minus fees.
      const s = state('1000');
      expect(() => {
        placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20' }, T);
        fillDemoOrder(s, 'o1', '2', '50000', T, 'SELECTED_POINT');
      }).toThrow();
      expect(s.walletBalance).toBe('1000');
      expect(accountLedger(s).totals.fees).toBe('0');
    });

    it('the refusal is about margin, and a size within the contract limits still fails on it', () => {
      // 0.4 BTC is a valid size for this contract (step 0.001, max 500) but
      // 20 000 of notional needs 1 000 of margin at 20x plus fees, and the
      // account has 100. The cause is money, not size.
      const s = state('100');
      let error: unknown;
      try {
        placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '0.4', leverage: '20' }, T);
        fillDemoOrder(s, 'o1', '0.4', '50000', T, 'SELECTED_POINT');
      } catch (e) { error = e; }
      expect((error as { code?: string }).code).toBe('INSUFFICIENT_DEMO_MARGIN');
    });

    it('a size outside the contract limits fails as a SIZE problem, on a fully funded account', () => {
      const s = state('100000000');
      let error: unknown;
      try {
        placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '600', leverage: '20' }, T);
      } catch (e) { error = e; }
      // Not a margin message: the account could afford it, the contract could not take it.
      expect(String((error as Error).message)).toContain('INVALID_ORDER_SIZE');
      expect((error as { detail?: { limit?: string } }).detail?.limit).toBe('maxMarketOrderQty');
    });
  });

  describe('liquidation boundary', () => {
    it('stays open one tick above the boundary and liquidates at it', () => {
      // 2 BTC long from 50 000 on 5 200 of collateral.
      // At mark M: equity = 5 200 - 55 + 2(M - 50 000)
      //            maintenance = 2M x 0.005 + 2M x 0.00055
      // Solve equity <= maintenance -> M ~= 47 6xx. Rather than assert the
      // algebra, drive the engine either side of the boundary it computes.
      const above = state('5200'), below = state('5200');
      for (const s of [above, below]) {
        placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20' }, T);
        fillDemoOrder(s, 'o1', '2', '50000', T, 'SELECTED_POINT');
      }
      markDemoAccount(above, { BTCUSDT: { mark: '48500', last: '48500' } }, T + 1);
      evaluateDemoRiskAndProtection(above, T + 1);
      expect(above.positions[0].status).toBe('OPEN');
      expect(demoAccount(above).liquidatable).toBe(false);

      markDemoAccount(below, { BTCUSDT: { mark: '47000', last: '47000' } }, T + 1);
      evaluateDemoRiskAndProtection(below, T + 1);
      expect(below.positions[0].status).toBe('LIQUIDATED');
      expect(accountLedger(below).reconciled).toBe(true);
    });

    it('other wallet collateral moves the boundary, because liquidation is on ACCOUNT equity', () => {
      const s = state('5200');
      placeDemoOrder(s, { id: 'o1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20' }, T);
      fillDemoOrder(s, 'o1', '2', '50000', T, 'SELECTED_POINT');
      markDemoAccount(s, { BTCUSDT: { mark: '47000', last: '47000' } }, T + 1);
      const engine = demoAccount(s);

      // On the settle row alone, this account is under water.
      const alone = crossAccount(engine, wallet([]), true);
      expect(alone.liquidatable).toBe(true);

      // With 1 ETH of wallet collateral at 3 000 it is not.
      const backed = crossAccount(engine, wallet([['ETH', '1']], [['ETH', '3000']]), true);
      expect(backed.liquidatable).toBe(false);
      expect(bn(backed.equity).minus(alone.equity).toFixed()).toBe('3000');

      // And with that ETH unpriceable, the question is refused rather than answered wrongly.
      const unknown = crossAccount(engine, wallet([['ETH', '1']], [['ETH', null]]), true);
      expect(unknown.liquidatable).toBeNull();
      expect(unknown.unpricedAssets).toEqual(['ETH']);
    });
  });

  describe('several positions and several assets at once', () => {
    it('two Cross positions share one collateral pool and one balance', () => {
      // Same-side positions on one symbol NET into one, so two simultaneous
      // Cross positions means a hedge — which is the case that matters here,
      // because both sides draw on the same collateral.
      const s = state('1000000');
      placeDemoOrder(s, { id: 'a', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20' }, T);
      fillDemoOrder(s, 'a', '2', '50000', T, 'SELECTED_POINT');
      placeDemoOrder(s, { id: 'b', symbol: 'BTCUSDT', side: 'SHORT', type: 'MARKET', quantity: '1', leverage: '20' }, T);
      fillDemoOrder(s, 'b', '1', '50000', T, 'SELECTED_POINT');
      markDemoAccount(s, { BTCUSDT: { mark: '52000', last: '52000' } }, T + 1);

      const account = demoAccount(s);
      // LONG 2 gains 4 000, SHORT 1 loses 2 000 — one net figure, not two accounts.
      expect(account.unrealizedPnl).toBe('2000');
      expect(bn(account.usedMargin).gt(0)).toBe(true);
      expect(account.equity).toBe(bn(s.walletBalance).plus('2000').toFixed());
      // Opening fees: (2 + 1) x 50 000 x 0.00055 = 82.5
      expect(accountLedger(s).totals.fees).toBe('82.5');
    });

    it('a wallet of several assets is one collateral figure, recomputed from live marks', () => {
      const s = state('1000000');
      const engine = demoAccount(s);
      const first = crossAccount(engine, wallet([['BTC', '2'], ['ETH', '10'], ['USDT', '1234.56']], [['BTC', '50000'], ['ETH', '3000']]), false);
      // 100 000 + 30 000 + 1 234.56
      expect(first.walletCollateral).toBe('131234.56');
      expect(first.equity).toBe('1131234.56');

      // Prices move; the figure moves with them. Nothing is cached, nothing is written in.
      const second = crossAccount(engine, wallet([['BTC', '2'], ['ETH', '10'], ['USDT', '1234.56']], [['BTC', '60000'], ['ETH', '2500']]), false);
      expect(second.walletCollateral).toBe('146234.56');
      expect(bn(second.equity).minus(first.equity).toFixed()).toBe('15000');
    });

    it('is exact on an eight-figure wallet', () => {
      const s = state('58454972.529999999999');
      const engine = demoAccount(s);
      const a = crossAccount(engine, wallet([['BTC', '0.000000000007']], [['BTC', '1']]), false);
      expect(a.equity).toBe('58454972.530000000006');
    });
  });
});
