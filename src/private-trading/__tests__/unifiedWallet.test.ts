import { valueCollateral, type CollateralHolding, type CollateralPrice } from '../native/collateral';
import { crossAccount, type EngineAccount } from '../native/accountModel';
import { unifiedWalletRows } from '../native/walletRows';

/**
 * THE WALLET'S ROWS MUST ADD UP TO THE ACCOUNT ABOVE THEM.
 *
 * `unifiedWalletRows` is a projection, not a second calculation: it takes
 * the authoritative `CrossAccount` and the valuation it was built from and
 * lays them out per asset. These tests pin the three properties that make
 * that safe to read:
 *
 *   1. nothing is counted twice — the wallet row and the trading ledger are
 *      disjoint, and the settle row shows their sum without inflating it;
 *   2. an unpriced asset stays unknown, never zero;
 *   3. the rows' values sum to the account's collateral.
 */

const hold = (asset: string, available: string, locked = '0'): CollateralHolding => ({ asset, available, locked });
const at = (asset: string, price: string | null): CollateralPrice => ({ asset, price, source: 'bybit', asOf: 1_700_000_000_000 });

const engine = (over: Partial<EngineAccount> = {}): EngineAccount => ({
  walletBalance: '0',
  unrealizedPnl: '0',
  usedMargin: '0',
  orderReserve: '0',
  maintenanceMargin: '0',
  ...over,
});

describe('the unified wallet rows', () => {
  it('folds the trading balance into the settle row and nowhere else', () => {
    // 1,000 USDT still in the wallet; 4,000 already moved into the ledger.
    const valuation = valueCollateral([hold('USDT', '1000'), hold('BTC', '2')], [at('BTC', '100000')]);
    const account = crossAccount(engine({ walletBalance: '4000' }), valuation, false);
    const rows = unifiedWalletRows(account, valuation);

    const usdt = rows.find((r) => r.asset === 'USDT')!;
    expect(usdt.walletQuantity).toBe('1000');
    expect(usdt.tradingBalance).toBe('4000');
    expect(usdt.total).toBe('5000');

    // Every other asset's trading balance is zero: the ledger is
    // settle-denominated and has no BTC in it to attribute.
    const btc = rows.find((r) => r.asset === 'BTC')!;
    expect(btc.tradingBalance).toBe('0');
    expect(btc.total).toBe('2');
  });

  it('adds up to the account: rows never total more than the collateral', () => {
    const valuation = valueCollateral([hold('USDT', '1000'), hold('BTC', '2'), hold('ETH', '10')],
      [at('BTC', '100000'), at('ETH', '3000')]);
    const account = crossAccount(engine({ walletBalance: '4000' }), valuation, false);
    const rows = unifiedWalletRows(account, valuation);

    const summed = rows.reduce((total, r) => total + Number(r.value ?? 0), 0);
    // 5,000 USDT + 200,000 BTC + 30,000 ETH
    expect(summed).toBeCloseTo(235000, 6);
    expect(Number(account.collateral)).toBeCloseTo(summed, 6);
  });

  it('is NOT double counting: the initialization debit is what makes the sum safe', () => {
    // The same 5,000 USDT, before and after it moves into the ledger. The
    // account's collateral is identical either way, because initialization
    // DEBITS the wallet row it credits. If the debit were ever dropped, this
    // test fails with 10,000.
    const before = valueCollateral([hold('USDT', '5000')], []);
    const after = valueCollateral([hold('USDT', '0')], []);

    const idle = crossAccount(engine({ walletBalance: '0' }), before, false);
    const opened = crossAccount(engine({ walletBalance: '5000' }), after, false);

    expect(idle.collateral).toBe('5000');
    expect(opened.collateral).toBe('5000');
    expect(unifiedWalletRows(opened, after).find((r) => r.asset === 'USDT')!.total).toBe('5000');
  });

  it('gives the trading balance a row even when the wallet row is gone entirely', () => {
    // Initialization takes the WHOLE settle row when it takes it, so the
    // valuation can come back with no USDT line at all. The balance is still
    // the account's money and still has to be visible.
    const valuation = valueCollateral([hold('BTC', '1')], [at('BTC', '90000')]);
    const account = crossAccount(engine({ walletBalance: '2500' }), valuation, false);
    const rows = unifiedWalletRows(account, valuation);

    const usdt = rows.find((r) => r.asset === 'USDT')!;
    expect(usdt).toBeDefined();
    expect(usdt.walletQuantity).toBe('0');
    expect(usdt.total).toBe('2500');
    expect(usdt.status).toBe('SETTLE');
  });

  it('leaves an unpriced asset without a value — never a value of zero', () => {
    const valuation = valueCollateral([hold('USDT', '100'), hold('WTF', '7')], [at('WTF', null)]);
    const account = crossAccount(engine(), valuation, false);
    const row = unifiedWalletRows(account, valuation).find((r) => r.asset === 'WTF')!;

    expect(row.status).toBe('UNPRICED');
    expect(row.price).toBeNull();
    // The distinction this whole model exists to keep: `null`, not '0'.
    expect(row.value).toBeNull();
    // The quantity is still known. Only what it is worth is not.
    expect(row.total).toBe('7');
    expect(account.collateralComplete).toBe(false);
    expect(account.unpricedAssets).toEqual(['WTF']);
  });

  it('reports committed margin against the settle asset and leaves the rest free', () => {
    const valuation = valueCollateral([hold('USDT', '1000', '50'), hold('BTC', '2')], [at('BTC', '100000')]);
    const account = crossAccount(
      engine({ walletBalance: '4000', usedMargin: '600', orderReserve: '150' }),
      valuation,
      true,
    );
    const rows = unifiedWalletRows(account, valuation);

    const usdt = rows.find((r) => r.asset === 'USDT')!;
    // 50 locked in the wallet row + 600 initial margin + 150 order reserve.
    expect(usdt.inUse).toBe('800');
    // 1,050 wallet + 4,000 ledger - 800 committed.
    expect(usdt.total).toBe('5050');
    expect(usdt.available).toBe('4250');

    // Cross margin is not attributed per asset, so BTC carries none of it.
    const btc = rows.find((r) => r.asset === 'BTC')!;
    expect(btc.inUse).toBe('0');
    expect(btc.available).toBe('2');
  });

  it('floors a row at zero rather than reporting a negative available balance', () => {
    // Cross margin can exceed the settle row, because other collateral backs
    // it. A row cannot go negative; the account-level `available` stays the
    // authoritative spendable figure.
    const valuation = valueCollateral([hold('USDT', '10'), hold('BTC', '2')], [at('BTC', '100000')]);
    const account = crossAccount(engine({ usedMargin: '5000' }), valuation, true);
    const usdt = unifiedWalletRows(account, valuation).find((r) => r.asset === 'USDT')!;

    expect(usdt.inUse).toBe('5000');
    expect(usdt.available).toBe('0');
    expect(Number(account.available)).toBeGreaterThan(0);
  });

  it('writes no total into the source: every figure moves with the quotes', () => {
    const holdings = [hold('USDT', '1000'), hold('BTC', '2')];
    const cheap = valueCollateral(holdings, [at('BTC', '50000')]);
    const dear = valueCollateral(holdings, [at('BTC', '100000')]);

    const cheapRow = unifiedWalletRows(crossAccount(engine(), cheap, false), cheap).find((r) => r.asset === 'BTC')!;
    const dearRow = unifiedWalletRows(crossAccount(engine(), dear, false), dear).find((r) => r.asset === 'BTC')!;

    expect(cheapRow.value).toBe('100000');
    expect(dearRow.value).toBe('200000');
  });
});
