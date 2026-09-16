import {
  emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder,
  demoAccount, demoPositionView, closeDemoPosition, setDemoLeverage, evaluateDemoRiskAndProtection,
  settleDemoFunding, migrateDemoState, DemoInstrument, DemoState, DemoEngineError,
} from '../native/engine';
import { crossAccount } from '../native/accountModel';

/**
 * ISOLATED IS A DIFFERENT PLACE FOR THE MONEY, NOT A DIFFERENT LABEL.
 *
 * The native engine used to be Cross by construction: one shared balance,
 * one account-wide maintenance figure, one liquidation that swept every
 * position at once. Offering a trader an Isolated switch against that
 * would have been a lie told by the interface, so what this file pins is
 * that the switch now changes where the collateral IS.
 *
 * The property that matters most is the last one: an isolated position
 * cannot cost the account more than the margin posted against it. Every
 * other difference follows from that one.
 */

const T = 1_728_000_000_000;
const instrument: DemoInstrument = {
  rules: { symbol:'BTCUSDT', tickSize:'0.1', qtyStep:'0.001', minOrderQty:'0.001', maxOrderQty:'1000',
    maxMarketOrderQty:'1000', minNotionalValue:'5', minLeverage:'1', maxLeverage:'100', leverageStep:'1' },
  profile: { pricingModelVersion:'fixture', feeModelVersion:'fixture', riskModelVersion:'fixture',
    takerFeeRate:'0.00055', makerFeeRate:'0.0002', liquidationFeeRate:'0', slippageBps:'0',
    riskTiers:[{ maxNotional:'1000000000', maintenanceRate:'0.005', deduction:'0', maxLeverage:'100' }], assumptions:[] },
};
const stand = (balance = '100000') => {
  const s = emptyDemoState(balance, T);
  registerDemoInstrument(s, instrument);
  markDemoAccount(s, { BTCUSDT: { mark:'50000', last:'50000' } }, T);
  return s;
};
function open(s: DemoState, marginType: 'CROSS'|'ISOLATED', id = 'o1', quantity = '0.1', leverage = '10', side: 'LONG'|'SHORT' = 'LONG') {
  placeDemoOrder(s, { id, symbol:'BTCUSDT', side, type:'MARKET', quantity, leverage, marginType }, T);
  fillDemoOrder(s, id, quantity, '50000', T, 'SELECTED_POINT');
  return s.positions.find((p) => p.id === id)!;
}

describe('isolated margin leaves the shared account', () => {
  it('posts the requirement out of the wallet, where cross leaves it in', () => {
    const cross = stand(); open(cross, 'CROSS');
    const iso = stand(); open(iso, 'ISOLATED');
    const c = demoAccount(cross), i = demoAccount(iso);

    // Cross: the margin is still in the wallet, counted as used.
    expect(c.walletBalance).toBe('99997.25');
    expect(c.isolatedMargin).toBe('0');
    expect(Number(c.usedMargin)).toBeGreaterThan(0);

    // Isolated: 0.1 x 50000 / 10 = 500 has physically left the balance.
    expect(i.walletBalance).toBe('99497.25');
    expect(i.isolatedMargin).toBe('500');
    // And it is NOT also counted as cross initial margin. That would be
    // the same 500 held against the account twice.
    expect(i.usedMargin).toBe('0');
  });

  it('keeps an isolated position out of the account it is not backed by', () => {
    const s = stand(); open(s, 'ISOLATED');
    markDemoAccount(s, { BTCUSDT: { mark:'55000', last:'55000' } }, T + 1);
    const a = demoAccount(s);
    // The gain is real and reported, but it is not cross equity and it is
    // not spendable on a new position.
    expect(a.isolatedUnrealizedPnl).toBe('500');
    expect(a.unrealizedPnl).toBe('0');
    expect(a.equity).toBe(a.walletBalance);
  });

  it('never reports the account as liquidatable because of an isolated position', () => {
    const s = stand('600'); open(s, 'ISOLATED');
    markDemoAccount(s, { BTCUSDT: { mark:'46000', last:'46000' } }, T + 1);
    // The position is deeply under water, but the account holds no cross
    // position, so the account-level verdict must stay false.
    expect(demoAccount(s).liquidatable).toBe(false);
  });
});

describe('the two modes answer different liquidation questions', () => {
  it('an isolated position liquidates nearer than the same cross one', () => {
    const cross = stand(); const cp = open(cross, 'CROSS');
    const iso = stand(); const ip = open(iso, 'ISOLATED');
    const crossLiq = demoPositionView(cross, cp).liquidationPrice;
    const isoLiq = demoPositionView(iso, ip).liquidationPrice;

    // The cross position is held up by a 100k account, so on this size it
    // is not reachable at all. The isolated one stands on 500.
    expect(crossLiq).toBeNull();
    expect(isoLiq).not.toBeNull();
    expect(Number(isoLiq)).toBeGreaterThan(44000);
    expect(Number(isoLiq)).toBeLessThan(50000);
  });

  it('names the basis it used, so the two are not mistaken for each other', () => {
    const s = stand();
    const c = open(s, 'CROSS', 'c1');
    const i = open(s, 'ISOLATED', 'i1');
    expect(demoPositionView(s, c).liquidationStatus).toBe('ACCOUNT_CROSS_ESTIMATE');
    expect(demoPositionView(s, i).liquidationStatus).toBe('ISOLATED_POSITION_ESTIMATE');
    expect(demoPositionView(s, i).marginMode).toBe('ISOLATED');
  });
});

describe('an isolated loss is bounded by what was posted', () => {
  it('a gapped mark cannot bill the account beyond the post', () => {
    const s = stand();
    open(s, 'ISOLATED');
    const before = demoAccount(s).walletBalance;
    // 50000 -> 30000 in one observation: far past the liquidation price,
    // which is exactly the case that used to leak into the account.
    markDemoAccount(s, { BTCUSDT: { mark:'30000', last:'30000' } }, T + 1);
    evaluateDemoRiskAndProtection(s, T + 1);
    const after = demoAccount(s).walletBalance;
    expect(s.positions[0].status).toBe('LIQUIDATED');

    // The 500 post is gone — it was consumed by the loss — and the ACCOUNT
    // paid only the closing fee on top of it. Without the bankruptcy bound
    // this figure was 1501.65 against a 500 post.
    const accountPaid = Number(before) - Number(after);
    expect(accountPaid).toBeLessThan(5);
    expect(accountPaid).toBeGreaterThan(0);
  });

  it('the same move on a cross position is absorbed by the account instead', () => {
    const s = stand();
    open(s, 'CROSS');
    markDemoAccount(s, { BTCUSDT: { mark:'30000', last:'30000' } }, T + 1);
    evaluateDemoRiskAndProtection(s, T + 1);
    // A 100k account carries a 2 000 drawdown without being liquidated.
    expect(s.positions[0].status).toBe('OPEN');
    expect(Number(demoAccount(s).unrealizedPnl)).toBe(-2000);
  });

  it('liquidating one isolated position leaves the other alone', () => {
    // Two separate isolated positions. Same symbol and side would be ONE
    // position by design — the engine merges them — so the pair that
    // actually tests independence is a long and a short.
    const s = stand();
    open(s, 'ISOLATED', 'doomed', '0.1', '10', 'LONG');
    open(s, 'ISOLATED', 'other', '0.1', '10', 'SHORT');
    // 45 000 is past the long's own liquidation price (~45 251): its 500
    // post no longer covers the 500 loss plus maintenance.
    markDemoAccount(s, { BTCUSDT: { mark:'45000', last:'45000' } }, T + 1);
    evaluateDemoRiskAndProtection(s, T + 1);
    // The long's post is gone. The short is up on the same move and
    // is neither closed to fund the long nor touched by its liquidation.
    expect(s.positions.find((p) => p.id === 'doomed')!.status).toBe('LIQUIDATED');
    const other = s.positions.find((p) => p.id === 'other')!;
    expect(other.status).toBe('OPEN');
    expect(other.isolatedMargin).toBe('500');
  });
});

describe('the post is returned, and follows the leverage', () => {
  it('closing an isolated position hands the margin back', () => {
    const s = stand();
    open(s, 'ISOLATED');
    expect(demoAccount(s).isolatedMargin).toBe('500');
    closeDemoPosition(s, 'o1', undefined, '50000', T + 1);
    expect(demoAccount(s).isolatedMargin).toBe('0');
    // Opened and closed at the same price: only the two fees are gone.
    expect(Number(demoAccount(s).walletBalance)).toBeCloseTo(100000 - 2.75 - 2.75, 6);
  });

  it('a partial close returns the margin in proportion', () => {
    const s = stand();
    open(s, 'ISOLATED', 'o1', '0.1');
    closeDemoPosition(s, 'o1', '0.04', '50000', T + 1);
    // 40% of the quantity left, so 40% of the post came home.
    expect(demoAccount(s).isolatedMargin).toBe('300');
  });

  it('changing leverage re-sizes the post rather than leaving a stale one', () => {
    const s = stand();
    open(s, 'ISOLATED', 'o1', '0.1', '10');
    expect(demoAccount(s).isolatedMargin).toBe('500');
    setDemoLeverage(s, 'o1', '5', T + 1);
    // Half the leverage needs twice the margin, taken from the wallet.
    expect(demoAccount(s).isolatedMargin).toBe('1000');
    expect(Number(demoAccount(s).walletBalance)).toBeCloseTo(99997.25 - 1000, 6);
  });
});

describe('funding reaches the post it belongs to', () => {
  it('an isolated position funds itself, not the account', () => {
    const boundary = Math.floor(T / 28_800_000) * 28_800_000 + 28_800_000;
    const s = stand();
    open(s, 'ISOLATED');
    markDemoAccount(s, { BTCUSDT: { mark:'50000', last:'50000' } }, boundary);
    const walletBefore = demoAccount(s).walletBalance;
    settleDemoFunding(s, boundary);
    // A long pays -0.001 of position value: 5 out of its own post.
    expect(demoAccount(s).isolatedMargin).toBe('495');
    expect(demoAccount(s).walletBalance).toBe(walletBefore);
  });
});

describe('the Wallet still sees everything the owner owns', () => {
  const valuation = { priced: '0', unpriced: [] as string[], complete: true, asOf: null, lines: [] } as never;

  it('ring fencing a position does not shrink the account total', () => {
    const cross = stand(); open(cross, 'CROSS');
    const iso = stand(); open(iso, 'ISOLATED');
    const c = crossAccount(demoAccount(cross), valuation, true);
    const i = crossAccount(demoAccount(iso), valuation, true);
    // Same fee, same size, same price — so the same equity. The isolated
    // post is inside settleBalance, not missing from it.
    expect(i.equity).toBe(c.equity);
    expect(i.settleBalance).toBe(c.settleBalance);
    // And it is reported as margin in use, because that is what it is.
    expect(Number(i.initialMargin)).toBeGreaterThanOrEqual(500);
  });

  it('an isolated gain is not offered as collateral for a new position', () => {
    const s = stand(); open(s, 'ISOLATED');
    markDemoAccount(s, { BTCUSDT: { mark:'55000', last:'55000' } }, T + 1);
    const a = crossAccount(demoAccount(s), valuation, true);
    expect(a.unrealizedPnl).toBe('500');
    // Equity counts it; available does not, until the position is closed.
    expect(Number(a.equity) - Number(a.available)).toBeGreaterThanOrEqual(500);
  });
});

describe('orders stay inside their own bucket', () => {
  it('refuses to reduce an isolated position with a cross order', () => {
    const s = stand();
    open(s, 'ISOLATED', 'iso');
    expect(() => placeDemoOrder(s, {
      id:'r1', symbol:'BTCUSDT', side:'SHORT', type:'MARKET', quantity:'0.05', leverage:'10',
      reduceOnly:true, positionId:'iso', marginType:'CROSS',
    }, T + 1)).toThrow(DemoEngineError);
  });

  it('a cross and an isolated position on the same contract stay separate', () => {
    const s = stand();
    open(s, 'CROSS', 'c1', '0.1');
    open(s, 'ISOLATED', 'i1', '0.1');
    expect(s.positions).toHaveLength(2);
    expect(s.positions.map((p) => p.marginType).sort()).toEqual(['CROSS', 'ISOLATED']);
  });
});

describe('a state written before margin mode existed reads forward', () => {
  it('is Cross with nothing posted, because that is what it was', () => {
    const s = stand();
    open(s, 'CROSS');
    // Strip the fields back off, as a version-1 row on disk would be.
    const legacy = JSON.parse(JSON.stringify({
      ...s, version: 1,
      positions: s.positions.map(({ marginType: _m, isolatedMargin: _i, ...rest }) => rest),
      orders: s.orders.map(({ marginType: _m, ...rest }) => rest),
    }));

    const forward = migrateDemoState(legacy);
    expect(forward.version).toBe(2);
    expect(forward.positions[0].marginType).toBe('CROSS');
    expect(forward.positions[0].isolatedMargin).toBe('0');
    expect(forward.orders[0].marginType).toBe('CROSS');
    // And the account it reports is the one it reported before.
    expect(demoAccount(forward)).toEqual(demoAccount(s));
  });
});
