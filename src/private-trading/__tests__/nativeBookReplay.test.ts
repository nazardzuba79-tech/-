import { demoAccount } from '../native/engine';
import { NativeDemoService } from '../native/service';
import { setup, actor, key, outcome, M } from '../native/testing/liveFixture';
import type { PrivateTradingMarketData } from '../marketData';

/**
 * THE JOURNAL REPRODUCES THE LIVE PASS — the review round's R11.
 *
 * A live pass values the account on this command's collateral and marks,
 * triggers what those marks trigger, fills (or cancels) what an observed
 * book allows, and runs the risk pass after the fills. Everything it
 * decided on is journaled AHEAD of the book it executed (an OBSERVE with
 * the marks, their provider timestamps and the collateral; then the BOOK),
 * and the BOOK is journaled whenever the book changed anything — a
 * cancellation without a fill included. So another instance continuing the
 * stored checkpoint, the replay through the closed minute, and a replay of
 * the journal alone from the very first instruction all arrive at the
 * same events, orders, positions, wallet and liquidity ledger. `state()`
 * is not such a proof (it reads the stored snapshot); these are replays.
 */
const long = (f: ReturnType<typeof setup>, quantity: string, extra: Record<string, unknown> = {}) =>
  f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity, leverage: '10', idempotencyKey: key(), ...extra });
const restingLong = (f: ReturnType<typeof setup>, quantity: string, price: string) =>
  f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', price, quantity, leverage: '10', idempotencyKey: key() });
const stripTransient = (o: ReturnType<typeof outcome>) => ({ ...o, collateral: null, bookConsumption: {} });

/** Every replay of the stored row agrees with the stored snapshot: from its checkpoint, from nothing, and on another instance. */
async function provesReplay(f: ReturnType<typeof setup>) {
  const stored = outcome(f.repo.row!.snapshot);
  expect(outcome(await f.replay('CHECKPOINT'))).toEqual(stored);
  expect(outcome(await f.replay('FULL'))).toEqual(stored);
  const again = new NativeDemoService(f.repo, f.market as unknown as PrivateTradingMarketData, f.clock.now);
  const view = await again.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
  expect(view.events.map(e => [e.id, e.kind, e.quantity, e.price, e.pricing])).toEqual(stored.events.map(e => [e.id, e.kind, e.quantity, e.price, e.pricing]));
  expect(view.orders.map(o => [o.id, o.status, o.filled])).toEqual(stored.orders.map(o => [o.id, o.status, o.filled]));
  expect([...view.positions, ...view.history].map(p => [p.id, p.status, p.quantity]).sort()).toEqual(stored.positions.map(p => [p.id, p.status, p.quantity]).sort());
  // The minute closes: the canonical replay walks the closed minute on bars and still lands on the live outcome.
  f.clock.t = (Math.floor(f.clock.t / M) + 1) * M + 30_000;
  expect(stripTransient(outcome(await f.replay('CHECKPOINT')))).toEqual(stripTransient(stored));
  expect(stripTransient(outcome(await f.replay('FULL')))).toEqual(stripTransient(stored));
  await f.refresh();
  expect(stripTransient(outcome(f.repo.row!.snapshot))).toEqual(stripTransient(stored));
}

describe('R11 — the BOOK replays with the marks and the collateral it was decided on', () => {
  test('a partial fill: collateral and mark moved between placement and observation; every replay reproduces it', async () => {
    const f = setup(); f.repo.wallet = [{ asset: 'USDT', available: '0', locked: '0' }, { asset: 'ETH', available: '10', locked: '0' }];
    await f.service.initialize(actor, key());
    let v = await restingLong(f, '1', '48000'); const order = v.orders[0];
    expect(order).toMatchObject({ status: 'OPEN' });
    // The market — and with it the collateral valuation of the ETH — moves before the book is observed.
    f.step(); f.market.price = '49000'; await f.refresh();
    f.step(); f.market.price = '47500'; f.market.asks = [{ price: '47500.1', quantity: '0.3' }];
    v = await f.refresh();
    expect(v.orders[0]).toMatchObject({ id: order.id, status: 'PARTIALLY_FILLED', filled: '0.3' });
    const observe = f.journal().find(c => c.kind === 'OBSERVE')!, book = f.journal().find(c => c.kind === 'BOOK')!;
    expect(f.journal().map(c => c.kind)).toEqual(['OPEN', 'OBSERVE', 'BOOK']);
    expect(observe.kind === 'OBSERVE' && observe.marks).toEqual({ BTCUSDT: { mark: '47500', last: '47500' } });
    expect(observe.kind === 'OBSERVE' && observe.observedAt).toEqual({ BTCUSDT: f.clock.t });
    expect(observe.collateral).toMatchObject({ priced: '475000', complete: true });     // 10 ETH at the mark of the observation
    expect(book.kind === 'BOOK' && book.book.asks).toEqual([{ price: '47500.1', quantity: '0.3' }]);
    expect(book.at).toBe(observe.at);
    f.market.asks = [{ price: '49000', quantity: '5' }];   // no depth at or below the order: later observations change nothing
    await provesReplay(f);
  });

  test('a full fill with a stop of another position triggered by the same marks: the trigger, the taker closes and the maker fill replay in order', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    let v = await long(f, '1', { protection: { stopLoss: '49000', triggerBy: 'LAST' } }); const guarded = v.positions[0];
    f.step(); v = await restingLong(f, '0.5', '48000'); const order = v.orders.find(o => o.type === 'LIMIT')!;
    f.step(); f.market.price = '47500'; f.market.bids = [{ price: '47499.9', quantity: '5' }]; f.market.asks = [{ price: '47500.1', quantity: '5' }];
    v = await f.refresh();
    expect(v.events.map(e => e.kind)).toEqual(['OPEN', 'TRIGGER', 'STOP_LOSS', 'OPEN']);
    expect(v.events[2]).toMatchObject({ positionId: guarded.id, quantity: '1', price: '47499.9', pricing: 'OBSERVED_BOOK' });
    expect(v.events[3]).toMatchObject({ orderId: order.id, quantity: '0.5', price: '48000', pricing: 'MAKER_MODEL', sourcePrice: '47500.1' });
    expect(v.positions).toHaveLength(1); expect(v.positions[0]).toMatchObject({ quantity: '0.5', entryPrice: '48000' });
    const book = f.journal().find(c => c.kind === 'BOOK')!;
    expect(book.kind === 'BOOK' && book.book).toEqual({ bids: [{ price: '47499.9', quantity: '5' }], asks: [{ price: '47500.1', quantity: '5' }], timestamp: f.clock.t });
    f.market.bids = null; f.market.asks = [{ price: '49000', quantity: '5' }];
    await provesReplay(f);
  });

  test('a cancellation without a fill: margin sufficed at placement and not at the crossing; the cancel is journaled and survives every replay', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    let v = await long(f, '1');
    f.step(); v = await restingLong(f, '1', '48000'); const order = v.orders.find(o => o.type === 'LIMIT')!;
    expect(order).toMatchObject({ status: 'OPEN' });
    // A large position then a fall: the account is solvent but its available margin is negative.
    // The requested 17 must actually fill; the default fixture depth is only 10.
    f.step(); f.market.asks = [{ price: '50000.1', quantity: '17' }]; v = await long(f, '17');
    expect(v.positions[0].quantity).toBe('18');
    f.step(); f.market.price = '49000'; v = await f.refresh();
    expect(v.account!.liquidatable).toBe(false);
    const projected=structuredClone(f.repo.row!.snapshot);
    projected.marks.BTCUSDT.mark='49000';projected.marks.BTCUSDT.last='49000';
    for(const p of projected.positions){p.markPrice='49000';p.lastPrice='49000';}
    const account=demoAccount(projected);
    expect(Number(account.equity)-Number(account.usedMargin)-Number(account.orderReserve)).toBeLessThan(0);
    expect(v.account!.available).toBe('0'); // customer-facing available is clamped on current main
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'OPEN' });
    // The book crosses the resting order; the fill cannot be margined; the order is cancelled, nothing fills, the BOOK is journaled.
    f.step(); f.market.price = '47500'; f.market.asks = [{ price: '47500.1', quantity: '5' }];
    v = await f.refresh();
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'CANCELLED', filled: '0' });
    expect(v.events.filter(e => e.kind === 'OPEN')).toHaveLength(2);
    expect(v.events.at(-1)).toMatchObject({ kind: 'CANCEL', orderId: order.id });
    expect(f.journal().map(c => c.kind)).toEqual(['OPEN', 'OPEN', 'OPEN', 'OBSERVE', 'BOOK']);
    // The next observation no longer crosses: the cancellation stays.
    f.step(); f.market.price = '49000'; f.market.asks = null; v = await f.refresh();
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'CANCELLED' });
    await provesReplay(f);
  });
});
