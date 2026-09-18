import { setup, actor, key, bn, MAKER, TAKER } from '../native/testing/liveFixture';
import { NATIVE_DEMO_MODEL } from '../native/engine';

/**
 * ONE OBSERVED BOOK, EVERYTHING WORKING ON THE CONTRACT — the review round's
 * R10 and R12.
 *
 * R10: a pass over the resting orders used to iterate a list taken once; a
 * full close cancels the position's other orders, and the next iteration
 * then filled a CANCELLED order and threw ORDER_NOT_OPEN out of the whole
 * refresh, so even the correct close before it was never committed. And a
 * reduce-only fill recorded the quantity it ASKED the book for in the
 * liquidity ledger, not the quantity the position could still give.
 *
 * R12: a resting limit order's fill is booked at its OWN price as maker —
 * that is a declared model (`MAKER_MODEL`), named as such, with the level
 * the liquidity came from kept on the fill. A live take-profit or stop-loss
 * TRIGGERS on the observed price and CLOSES on an observed book, as taker,
 * for the depth there is; nothing closes at a trigger price the book did
 * not show, and the same snapshot never closes twice. A liquidation stays a
 * declared settlement, never an observed fill.
 */
const long = (f: ReturnType<typeof setup>, quantity: string, extra: Record<string, unknown> = {}) =>
  f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity, leverage: '10', idempotencyKey: key(), ...extra });
const reduceLimit = (f: ReturnType<typeof setup>, positionId: string, quantity: string, price: string) =>
  f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'LIMIT', price, quantity, leverage: '10', reduceOnly: true, positionId, idempotencyKey: key() });

describe('R10 — the pass reads every order again at every step', () => {
  test('two exact reduce-only limits on one position: the first closes it, the second is cancelled, the refresh commits, nothing throws', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    let v = await long(f, '1'); const p = v.positions[0];
    f.step(); v = await reduceLimit(f, p.id, '1', '55000'); const first = v.orders.find(o => o.reduceOnly)!;
    f.step(); v = await reduceLimit(f, p.id, '1', '55000'); const second = v.orders.filter(o => o.reduceOnly).find(o => o.id !== first.id)!;
    expect(v.orders.filter(o => o.reduceOnly && o.status === 'OPEN')).toHaveLength(2);
    // A book that could serve both — and a position that can serve one.
    f.step(); f.market.price = '56000'; f.market.bids = [{ price: '55999.9', quantity: '2' }];
    const revisionBefore = v.revision;
    v = await f.refresh();
    expect(v.revision).toBe(revisionBefore + 1);
    expect(v.orders.find(o => o.id === first.id)).toMatchObject({ status: 'FILLED', filled: '1', averagePrice: '55000' });
    expect(v.orders.find(o => o.id === second.id)).toMatchObject({ status: 'CANCELLED', filled: '0' });
    expect(v.positions).toHaveLength(0); expect(v.history[0]).toMatchObject({ id: p.id, status: 'CLOSED' });
    const closes = v.events.filter(e => e.kind === 'CLOSE');
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ orderId: first.id, quantity: '1', price: '55000', pricing: 'MAKER_MODEL', sourcePrice: '55999.9' });
    expect(v.events.filter(e => e.kind === 'CANCEL').map(e => e.orderId)).toEqual([second.id]);
    // The liquidity ledger holds what was filled: 1 of the 2 on the bid, not 2.
    const consumed = Object.values(f.repo.row!.snapshot.bookConsumption).find(c => c.bids['55999.9'] !== undefined)!;
    expect(consumed.bids['55999.9']).toBe('1');
    expect(f.journal().map(c => c.kind)).toEqual(['OPEN', 'OPEN', 'OPEN', 'OBSERVE', 'BOOK']);
    expect(v.ledger!.reconciled).toBe(true);
  });

  test('a reduce-only limit larger than what the position has left fills and consumes exactly the remainder; a second level does not throw', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    let v = await long(f, '1'); const p = v.positions[0];
    f.step(); v = await reduceLimit(f, p.id, '1', '55000'); const order = v.orders.find(o => o.reduceOnly)!;
    // A separate action leaves 0.4 of the position; the order still names 1.
    f.step(); v = await f.service.command(actor, { kind: 'CLOSE', positionId: p.id, quantity: '0.6', idempotencyKey: key() });
    expect(v.positions[0]).toMatchObject({ id: p.id, quantity: '0.4' });
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'OPEN', remaining: '1' });
    f.step(); f.market.price = '56000'; f.market.bids = [{ price: '55999.9', quantity: '0.5' }, { price: '55999.8', quantity: '5' }];
    v = await f.refresh();
    const fill = v.events.find(e => e.kind === 'CLOSE' && e.orderId === order.id)!;
    expect(fill).toMatchObject({ quantity: '0.4', price: '55000', pricing: 'MAKER_MODEL', sourcePrice: '55999.9' });
    expect(v.events.filter(e => e.kind === 'CLOSE' && e.orderId === order.id)).toHaveLength(1);
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'CANCELLED', filled: '0.4', remaining: '0.6' });
    expect(v.positions).toHaveLength(0);
    const consumed = Object.values(f.repo.row!.snapshot.bookConsumption).find(c => c.bids['55999.9'] !== undefined)!;
    expect(consumed.bids['55999.9']).toBe('0.4');
    expect(consumed.bids['55999.8']).toBeUndefined();
    expect(v.ledger!.reconciled).toBe(true);
  });
});

describe('R12 — a live stop triggers on the price and closes on the book', () => {
  test('trigger reached at last 100 with a single bid of 0.2 at 99: 0.2 closes at 99, 0.8 keeps working, the same snapshot closes nothing more, the next book finishes it', async () => {
    const f = setup({ price: '101' }); await f.service.initialize(actor, key());
    let v = await long(f, '1', { protection: { stopLoss: '100', triggerBy: 'LAST' } });
    const p = v.positions[0]; expect(p).toMatchObject({ entryPrice: '101.1', protection: { stopLoss: '100' } });
    f.step(); f.market.price = '100'; f.market.bids = [{ price: '99', quantity: '0.2' }];
    v = await f.refresh();
    const trigger = v.events.find(e => e.kind === 'TRIGGER')!;
    expect(trigger).toMatchObject({ positionId: p.id, quantity: '1', price: '100', fee: '0', cashflow: '0', pricing: 'LIVE_QUOTE_MODEL' });
    const first = v.events.filter(e => e.kind === 'STOP_LOSS');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ quantity: '0.2', price: '99', pricing: 'OBSERVED_BOOK', actionId: trigger.actionId });
    expect(bn(first[0].fee).toFixed()).toBe(bn('0.2').times(99).times(TAKER).toFixed());
    expect(v.positions[0]).toMatchObject({ id: p.id, quantity: '0.8', pendingClose: { reason: 'STOP_LOSS', quantity: '0.8', triggerPrice: '100' }, protection: { stopLoss: null, takeProfit: null } });
    expect(v.events.some(e => ['STOP_LOSS', 'CLOSE'].includes(e.kind) && e.price === '100')).toBe(false);   // nothing closed at the trigger price
    expect(f.journal().map(c => c.kind)).toEqual(['OPEN', 'OBSERVE', 'BOOK']);
    // The same snapshot again: no new liquidity, nothing more closes, nothing more is journaled.
    v = await f.refresh();
    expect(v.positions[0]).toMatchObject({ quantity: '0.8' });
    expect(v.events.filter(e => e.kind === 'STOP_LOSS')).toHaveLength(1);
    expect(f.journal().map(c => c.kind)).toEqual(['OPEN', 'OBSERVE', 'BOOK']);
    // A new snapshot with depth at 98: the remainder closes there, as taker, under the same action.
    f.step(); f.market.bids = [{ price: '98', quantity: '5' }];
    v = await f.refresh();
    const fills = v.events.filter(e => e.kind === 'STOP_LOSS');
    expect(fills.map(e => [e.quantity, e.price, e.pricing])).toEqual([['0.2', '99', 'OBSERVED_BOOK'], ['0.8', '98', 'OBSERVED_BOOK']]);
    expect(new Set(fills.map(e => e.actionId))).toEqual(new Set([trigger.actionId]));
    expect(v.positions).toHaveLength(0);
    expect(v.history[0]).toMatchObject({ id: p.id, status: 'CLOSED', pendingClose: null });
    expect(v.events.filter(e => e.kind === 'TRIGGER')).toHaveLength(1);
    expect(v.ledger!.reconciled).toBe(true);
    expect(f.market.calls.history).toBe(0);
  });

  test('the model names its prices: a resting limit is a maker model with the source level kept, a liquidation is a declared settlement', () => {
    expect(NATIVE_DEMO_MODEL.restingLimitExecution).toBe('OWN_PRICE_AS_MAKER_FOR_OBSERVED_DEPTH_AT_OR_BETTER_SOURCE_PRICE_KEPT');
    expect(NATIVE_DEMO_MODEL.liveProtection).toBe('TRIGGER_ON_OBSERVED_MARK_OR_LAST_CLOSE_ON_OBSERVED_BOOK_AS_TAKER_REMAINDER_KEEPS_WORKING');
    expect(NATIVE_DEMO_MODEL.liquidationSettlement).toBe('DECLARED_MODEL_PRICE_NOT_AN_OBSERVED_FILL');
    expect(MAKER).not.toBe(TAKER);
  });
});
