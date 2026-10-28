import BigNumber from 'bignumber.js';
import { assertFloor, floorValue, prepareFloor, syntheticProceeds } from '../syntheticProceedsFloor';

const receipt = (metadata: unknown) => ({ metadata });
const database = (rows: unknown[] = []) => ({
  auditLog: { findMany: jest.fn(async () => rows) },
  balance: { findMany: jest.fn(async () => [{ asset: 'USDT', available: '110', locked: '0' }]) },
  withdrawal: { findMany: jest.fn(async () => []) },
  otcCashReservation: { findMany: jest.fn(async () => []) },
  order: { findMany: jest.fn(async () => []) },
});
const marks = new Map([['USDT', new BigNumber(1)], ['BTC', new BigNumber(60000)]]);

describe('synthetic floor fail-closed accounting', () => {
  test.each([undefined, null, 'NaN', 'Infinity', '-1'])('unreadable/negative simulation proceeds %s never erase the floor', async amount => {
    const db = database([receipt({ pair: 'QVTR/USDT', proceeds: amount })]);
    await expect(syntheticProceeds(db as any, 'fixture')).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
  });
  test.each([null, {}, { proceeds: '100' }, { pair: 'QVTR/USDT/EXTRA', proceeds: '100' }])('malformed audited simulation receipt fails closed: %j', async metadata => {
    await expect(syntheticProceeds(database([receipt(metadata)]) as any, 'fixture')).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
  });
  test('explicit DemoBalance receipts never taint ordinary funds', async () => {
    expect((await syntheticProceeds(database([receipt({ settlementLedger: 'DemoBalance' })]) as any, 'fixture')).toFixed()).toBe('0');
  });
  test('ordinary accounts never fetch a valuation', async () => {
    const prices = { getTicker: jest.fn() };
    expect(await prepareFloor(database() as any, 'fixture', prices)).toBeNull();
    expect(prices.getTicker).not.toHaveBeenCalled();
  });
  test('held withdrawals and OTC reserves consume the same real-value budget', async () => {
    const db = database([receipt({ pair: 'QVTR/USDT', proceeds: '100' })]);
    db.withdrawal.findMany.mockResolvedValue([{ asset: 'USDT', amount: '6' }] as any);
    db.otcCashReservation.findMany.mockResolvedValue([{ asset: 'USDT', quantity: '5' }] as any);
    await expect(assertFloor(db as any, 'fixture', marks)).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
  });
  test('an executing legacy order is not a loss that has already happened', async () => {
    const db = database();
    db.order.findMany.mockResolvedValue([{ id: 'legacy', pair: 'BTC/USDT', side: 'BUY', price: '100000', remainingQuantity: '0.001', ocoGroupId: null }] as any);
    expect((await floorValue(db as any, 'fixture', marks)).toFixed()).toBe('70');
    expect((await (floorValue as any)(db, 'fixture', marks, new Set(['legacy']))).toFixed()).toBe('110');
  });
  test('NaN wallet quantities never pass comparison as false', async () => {
    const db = database();
    db.balance.findMany.mockResolvedValue([{ asset: 'USDT', available: 'NaN', locked: '0' }]);
    await expect(floorValue(db as any, 'fixture', marks)).rejects.toMatchObject({ code: 'SYNTHETIC_PROCEEDS_LOCKED' });
  });
  test('OCO worst leg counts once', async () => {
    const db = database();
    db.order.findMany.mockResolvedValue([100000, 90000].map(price => ({ id: String(price), pair: 'BTC/USDT', side: 'BUY', price: String(price), remainingQuantity: '0.001', ocoGroupId: 'oco' })) as any);
    expect((await floorValue(db as any, 'fixture', marks)).toFixed()).toBe('70');
  });
});
