import { nativeAccountState, nativeBalances } from '../nativeFuturesAdapter';
import type { NativeState } from '../nativeDemoApi';

/**
 * The `0.00 USDT` bug, and the contract that replaces it.
 *
 * The owner's terminal showed a confident `Доступная маржа: 0.00 USDT`
 * over a wallet the server had just said held ten million in demo funds.
 * The account was simply not open yet — and `nativeBalances` answered that
 * with a literal zero row instead of saying so.
 */

const base = {
  revision: 0, source: 'DEMO_BALANCE' as const, asOf: 1,
  model: { version: 'v1', funding: { longCashflow: '0', shortCashflow: '0', unit: 'USDT', intervalMs: 1 } },
  positions: [], history: [], orders: [], events: [], entries: [],
  account: null, ledger: null,
};
const uninitialized = (demoAvailable: string | null): NativeState =>
  ({ ...base, initialized: false, demoAvailable } as unknown as NativeState);
const opened = (): NativeState => ({
  ...base, initialized: true, revision: 1, demoAvailable: null,
  account: {
    settleBalance: '10000000', walletCollateral: '150000', collateral: '10150000',
    equity: '10150000', unrealizedPnl: '0', initialMargin: '0', maintenanceMargin: '0',
    orderReserve: '0', available: '10150000', maintenanceRatio: null, liquidatable: null,
    collateralComplete: true, unpricedAssets: [], collateralAsOf: 1,
  },
} as unknown as NativeState);

const flags = { loading: false, failed: false, fetchedAt: 10 };

test('an account that has not been opened reports NO balance, not a zero one', () => {
  expect(nativeBalances(uninitialized('10000000'))).toBeNull();
  const state = nativeAccountState(uninitialized('10000000'), flags);
  // This is the whole fix. `data: null` renders as a dash; a row of '0'
  // rendered as `0.00 USDT`, which is a claim about the account.
  expect(state.balances.data).toBeNull();
  expect(state.balances.failed).toBe(false);
  expect(state.positions.data).toBeNull();
  expect(state.orders.data).toBeNull();
});

test('an opened account reports the server figures, unchanged', () => {
  const rows = nativeBalances(opened());
  expect(rows).toEqual([{ asset: 'USDT', available: '10150000', locked: '0' }]);
  const state = nativeAccountState(opened(), flags);
  expect(state.balances.data).toEqual(rows);
  expect(state.balances.loaded).toBe(true);
});

test('locked margin is used margin plus the order reserve, summed exactly', () => {
  const state = opened();
  (state.account as any).initialMargin = '1234.56';
  (state.account as any).orderReserve = '765.44';
  expect(nativeBalances(state)![0].locked).toBe('2000');
});

/**
 * When the activation control may exist at all.
 *
 * It is derived from the server's own answer rather than from a rule of
 * the card's: `demoAvailable` is non-null only while there is no ledger,
 * so the window is the server's to define and the client cannot widen it.
 */
describe('the activation window', () => {
  const activation = (state: NativeState) => {
    const waiting = state && !state.initialized ? state.demoAvailable ?? null : null;
    return waiting !== null && Number(waiting) > 0 ? { available: waiting } : null;
  };

  it('offers the action while funds are waiting', () => {
    expect(activation(uninitialized('10000000'))).toEqual({ available: '10000000' });
  });

  it('passes the server string through without reformatting it', () => {
    expect(activation(uninitialized('58454972.52'))!.available).toBe('58454972.52');
  });

  it('does not offer an action that would move nothing', () => {
    expect(activation(uninitialized('0'))).toBeNull();
    expect(activation(uninitialized('0.00'))).toBeNull();
  });

  it('does not invent an offer when the balance is unknown', () => {
    expect(activation(uninitialized(null))).toBeNull();
  });

  it('withdraws the action the moment the account exists', () => {
    expect(activation(opened())).toBeNull();
  });
});

/**
 * No financial total is written into the source.
 *
 * The owner's ~$58.45M is a figure to CHECK against, never one to ship;
 * the total has to come from balances times marks plus the trading ledger.
 */
test('no account total is hardcoded anywhere in the terminal source', () => {
  const { readFileSync, readdirSync, statSync } = require('fs') as typeof import('fs');
  const { resolve, join } = require('path') as typeof import('path');
  const root = resolve(__dirname, '../..');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { if (entry !== '__tests__') walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const text = readFileSync(full, 'utf8');
      if (/58[,_ ]?454[,_ ]?972/.test(text) || /58454972\.52/.test(text)) offenders.push(full);
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});
