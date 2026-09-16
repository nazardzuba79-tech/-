import { crossAccount, type EngineAccount } from '../native/accountModel';
import { valueCollateral } from '../native/collateral';

/**
 * Cross equity is the WHOLE account, and an account that cannot be fully
 * valued does not get liquidated on the part we happen to know.
 */

const engine = (extra: Partial<EngineAccount> = {}): EngineAccount => ({
  walletBalance: '10000', unrealizedPnl: '0', usedMargin: '0', orderReserve: '0', maintenanceMargin: '0', ...extra,
});
const wallet = (holdings: [string, string][], prices: [string, string | null][]) => valueCollateral(
  holdings.map(([asset, available]) => ({ asset, available })),
  prices.map(([asset, price]) => ({ asset, price, source: 'test', asOf: 1_000 })),
);

describe('the authoritative Cross account', () => {
  it('backs the account with the simulation ledger AND the rest of the wallet', () => {
    // 10 000 in the ledger + 2 BTC at 50 000 + 500 USDT still in the wallet.
    const a = crossAccount(engine(), wallet([['BTC', '2'], ['USDT', '500']], [['BTC', '50000']]), false);
    expect(a.settleBalance).toBe('10000');
    expect(a.walletCollateral).toBe('100500');
    expect(a.collateral).toBe('110500');
    expect(a.equity).toBe('110500');
    expect(a.collateralComplete).toBe(true);
  });

  it('adds unrealized P&L to equity, and subtracts margin and reserve from available', () => {
    const a = crossAccount(
      engine({ unrealizedPnl: '2500', usedMargin: '5000', orderReserve: '1500', maintenanceMargin: '600' }),
      wallet([['BTC', '1']], [['BTC', '40000']]),
      true,
    );
    // collateral 10 000 + 40 000 = 50 000; equity 52 500
    expect(a.equity).toBe('52500');
    // available 52 500 - 5 000 - 1 500 = 46 000
    expect(a.available).toBe('46000');
    // ratio 600 / 52 500
    expect(a.maintenanceRatio).toBe('0.011428571428571428571428571428571429');
    expect(a.liquidatable).toBe(false);
  });

  it('a loss larger than equity floors available at zero rather than reporting a negative', () => {
    const a = crossAccount(engine({ unrealizedPnl: '-90000', usedMargin: '5000' }), wallet([], []), true);
    expect(a.equity).toBe('-80000');
    expect(a.available).toBe('0');
    expect(a.maintenanceRatio).toBeNull();
  });

  it('liquidates on ACCOUNT EQUITY, not on the settle row alone', () => {
    // The ledger row is nearly empty, but 3 BTC of wallet collateral backs it.
    const engineNearlyBroke = engine({ walletBalance: '100', unrealizedPnl: '-4000', maintenanceMargin: '500' });
    const withBtc = crossAccount(engineNearlyBroke, wallet([['BTC', '3']], [['BTC', '50000']]), true);
    expect(withBtc.equity).toBe('146100');
    expect(withBtc.liquidatable).toBe(false);

    // Same position, no other collateral: now it really is under water.
    const without = crossAccount(engineNearlyBroke, wallet([], []), true);
    expect(without.equity).toBe('-3900');
    expect(without.liquidatable).toBe(true);
  });

  it('REFUSES to answer the liquidation question while any held asset is unpriced', () => {
    // Equity looks fatal on the priced part alone — which is exactly when a
    // wrong answer costs the owner the position.
    const a = crossAccount(
      engine({ walletBalance: '100', unrealizedPnl: '-4000', maintenanceMargin: '500' }),
      wallet([['BTC', '3'], ['XYZ', '1000']], [['BTC', null]]),
      true,
    );
    expect(a.collateralComplete).toBe(false);
    expect(a.unpricedAssets).toEqual(['BTC', 'XYZ']);
    expect(a.liquidatable).toBeNull();
    // The figure is still reported — as a floor, with the gap named.
    expect(a.walletCollateral).toBe('0');
    expect(a.equity).toBe('-3900');
  });

  it('answers the liquidation question again as soon as the wallet is fully valued', () => {
    const holdings = [['BTC', '3'], ['XYZ', '1000']] as [string, string][];
    const unknown = crossAccount(engine(), wallet(holdings, [['BTC', '50000']]), true);
    const known = crossAccount(engine(), wallet(holdings, [['BTC', '50000'], ['XYZ', '2']]), true);
    expect(unknown.liquidatable).toBeNull();
    expect(known.liquidatable).toBe(false);
    expect(known.walletCollateral).toBe('152000');
  });

  it('an account with no open position is never liquidatable, however small the equity', () => {
    const a = crossAccount(engine({ walletBalance: '0', maintenanceMargin: '0' }), wallet([], []), false);
    expect(a.equity).toBe('0');
    expect(a.liquidatable).toBe(false);
  });

  it('carries the stalest collateral price through, so the caller can judge freshness', () => {
    const valuation = valueCollateral(
      [{ asset: 'BTC', available: '1' }, { asset: 'ETH', available: '1' }],
      [{ asset: 'BTC', price: '50000', source: 't', asOf: 9_000 }, { asset: 'ETH', price: '3000', source: 't', asOf: 4_000 }],
    );
    expect(crossAccount(engine(), valuation, false).collateralAsOf).toBe(4_000);
  });

  it('is exact on a wallet large enough to lose cents in a double', () => {
    const a = crossAccount(
      engine({ walletBalance: '0.000000000007' }),
      wallet([['USDT', '58454972.529999999999']], []),
      false,
    );
    expect(a.equity).toBe('58454972.530000000006');
    // The same sum in doubles loses the tail entirely.
    expect(String(58454972.529999999999 + 0.000000000007)).not.toBe(a.equity);
  });
});
