/** Real services and transactions, only disposable loopback PostgreSQL and synthetic users. */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { OrderService } from '../OrderService';
import { WithdrawalService } from '../WithdrawalService';
import { transferWalletBalance } from '../WalletTransferService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { OtcCashService } from '../../otc/OtcCashService';
import { BankingService } from '../../banking/service';
import { setManagedListingAssets } from '../listings/managedSnapshot';

const url = process.env.VOLTEX_NRX_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_nrx_test') throw Error('Disposable loopback voltex_nrx_test required');
}
const pg = url ? describe : describe.skip;
const locked = { code: 'SYNTHETIC_PROCEEDS_LOCKED' };
const marks: Record<string, string> = { 'BTC/USDT': '60000', 'ETH/USDT': '3000', 'USDC/USDT': '1' };
const prices = { getTicker: async (pair: string) => marks[pair] ? { lastPrice: marks[pair] } : null };
pg('floor is shared by every ordinary-ledger outflow (review #630)', () => {
  let db: PrismaClient;
  let userId: string, other: string, sessionId: string, service: OrderService, otc: OtcCashService;
  const balance = async (id = userId, asset = 'USDT') => {
    const b = await db.balance.findUnique({ where: { userId_asset: { userId: id, asset } } });
    return b ? [b.available.toFixed(), b.locked.toFixed()] : ['0', '0'];
  };
  const request = (amount: string, id = userId) => new WithdrawalService(db, prices).requestWithdrawal({ userId: id, asset: 'USDT', network: 'FIXTURE', toAddress: 'NO_REAL_ADDRESS', amount });
  const order = (id: string, side: 'BUY' | 'SELL', price: string, requestId?: string) => service.placeOrder({ userId: id, pair: 'BTC/USDT', side, type: 'LIMIT', price: new BigNumber(price), quantity: new BigNumber(1), requestId });
  const payload = () => ({ country: 'RU', cityId: 'geonames-524901', asset: 'USDT' as const, fiat: 'USD' as const, tier: 'otc-convert' as const, quantity: '20000', idempotencyKey: randomUUID() });
  beforeAll(() => {
    db = new PrismaClient({ datasources: { db: { url } } });
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('External network forbidden in financial fixtures'));
  });
  beforeEach(async () => {
    userId = randomUUID(); other = randomUUID();
    await db.user.createMany({ data: [userId, other].map(id => ({ id, email: `${id}@synthetic-floor.invalid`, passwordHash: 'fixture', referralCode: id, role: 'USER', kycStatus: 'APPROVED' })) });
    sessionId = (await db.session.create({ data: { userId } })).id;
    await db.balance.createMany({ data: [{ userId, asset: 'USDT', available: '110000' }, { userId: other, asset: 'USDT', available: '200000' }, { userId: other, asset: 'BTC', available: '2' }] });
    await db.auditLog.create({ data: { userId, action: 'TEAM_SPOT_SIMULATION_SOLD', metadata: { pair: 'QVTR/USDT', proceeds: '100000', counterparty: 'simulation:QVTR' } } });
    service = new OrderService(db, new MatchingEngine(), prices);
    otc = new OtcCashService(db, prices, { version: 'isolated-fixture', enabled: true, approvedUserIds: [userId], maxActive: 3,
      routes: [{ country: 'RU', cityId: 'geonames-524901', asset: 'USDT', fiat: 'USD', cashPrecision: 2 }] });
  });
  afterEach(async () => {
    // Do not leave resting fixtures in the database shared with other suites.
    await db.order.updateMany({ where: { userId: { in: [userId, other] }, status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] } }, data: { status: 'CANCELLED' } });
    setManagedListingAssets([]);
  });
  afterAll(async () => { await db.$disconnect(); jest.restoreAllMocks(); });

  test('ordinary USER allowed into OTC still cannot reserve synthetic principal', async () => {
    await expect(otc.create({ userId, sessionId }, payload())).rejects.toMatchObject(locked);
    expect(await balance()).toEqual(['110000', '0']);
    expect(await db.otcCashRequest.count({ where: { userId } })).toBe(0);
    expect(await db.otcCashLedger.count({ where: { request: { userId } } })).toBe(0);
  });
  test('genuine OTC excess reserves once across concurrent replay and preserves the floor', async () => {
    const input = { ...payload(), quantity: '10000' };
    const [a, b] = await Promise.all([otc.create({ userId, sessionId }, input), otc.create({ userId, sessionId }, input)]);
    expect(a.id).toBe(b.id);
    expect(await balance()).toEqual(['100000', '10000']);
    expect(await db.otcCashLedger.count({ where: { requestId: a.id, kind: 'RESERVE' } })).toBe(1);
    await expect(request('1')).rejects.toMatchObject(locked);
    await expect(otc.create({ userId, sessionId }, { ...input, quantity: '10001' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  });
  test('synthetic principal cannot become ordinary Futures collateral', async () => {
    await expect(transferWalletBalance(db, userId, 'USDT', new BigNumber(20000), 'TO_FUTURES', prices)).rejects.toMatchObject(locked);
    expect(await balance()).toEqual(['110000', '0']);
    expect(await db.futuresBalance.count({ where: { userId } })).toBe(0);
  });
  test('genuine Futures excess transfers and returns without duplicating either ledger', async () => {
    await transferWalletBalance(db, userId, 'USDT', new BigNumber(10000), 'TO_FUTURES', prices);
    await expect(transferWalletBalance(db, userId, 'USDT', new BigNumber(1), 'TO_FUTURES', prices)).rejects.toMatchObject(locked);
    await transferWalletBalance(db, userId, 'USDT', new BigNumber(10000), 'TO_SPOT', prices);
    expect(await balance()).toEqual(['110000', '0']);
    expect((await db.futuresBalance.findUniqueOrThrow({ where: { userId_asset: { userId, asset: 'USDT' } } })).available.toFixed()).toBe('0');
  });
  test('withdrawal and Futures transfer racing share the same excess budget', async () => {
    const results = await Promise.allSettled([request('8000'), transferWalletBalance(db, userId, 'USDT', new BigNumber(8000), 'TO_FUTURES', prices)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe(locked.code);
    expect(new BigNumber((await balance())[0]).gte(100000)).toBe(true);
  });
  test('Banking cannot earn ordinary interest/referral rewards on legacy synthetic principal', async () => {
    const banking = new BankingService(db, { prices: async () => ({ USDT: '1', USDC: '1', BTC: '60000', ETH: '3000' }) } as any);
    await expect(banking.createPlacement(userId, { programId: 'MONTHLY_17_24M', asset: 'USDT', amount: '20000', idempotencyKey: randomUUID() })).rejects.toMatchObject(locked);
    expect(await balance()).toEqual(['110000', '0']);
    const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM banking_placements WHERE user_id=${userId}`;
    expect(Number(rows[0].n)).toBe(0);
  });
  test('an existing adverse resting maker cannot pay an ordinary taker synthetic value', async () => {
    await db.balance.update({ where: { userId_asset: { userId, asset: 'USDT' } }, data: { available: '50000' } });
    await db.balance.create({ data: { userId, asset: 'BTC', available: '0', locked: '1' } });
    const legacy = await db.order.create({ data: { userId, pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: '1', originalQuantity: '1', remainingQuantity: '1', status: 'OPEN' } });
    await expect(order(other, 'BUY', '1')).rejects.toMatchObject(locked);
    expect((await db.order.findUniqueOrThrow({ where: { id: legacy.id } })).status).toBe('OPEN');
    expect(await balance()).toEqual(['50000', '0']);
    expect(await db.trade.count({ where: { makerOrderId: legacy.id } })).toBe(0);
  });
  test('legacy STOP_MARKET trigger cannot escape its old hold at an adverse fill', async () => {
    await db.balance.update({ where: { userId_asset: { userId, asset: 'USDT' } }, data: { available: '31000', locked: '70000' } });
    const legacy = await db.order.create({ data: { userId, pair: 'BTC/USDT', side: 'BUY', type: 'STOP_MARKET', triggerPrice: '65000', originalQuantity: '1', remainingQuantity: '1', status: 'PENDING_TRIGGER', lockedAmount: '70000', lockedAsset: 'USDT' } });
    await order(other, 'SELL', '65000');
    await expect(service.triggerOrder(legacy.id)).rejects.toMatchObject(locked);
    expect((await db.order.findUniqueOrThrow({ where: { id: legacy.id } })).status).toBe('PENDING_TRIGGER');
    expect(await balance()).toEqual(['31000', '70000']);
    expect(await db.trade.count({ where: { takerOrderId: legacy.id } })).toBe(0);
  });
  test('idempotent fair Spot order fills once and cannot reserve twice', async () => {
    await order(other, 'SELL', '60000');
    const requestId = randomUUID();
    const [a, b] = await Promise.all([order(userId, 'BUY', '60000', requestId), order(userId, 'BUY', '60000', requestId)]);
    expect(a.order.id).toBe(b.order.id);
    expect(await db.trade.count({ where: { takerOrderId: a.order.id } })).toBe(1);
    expect(await balance()).toEqual(['50000', '0']);
    expect(await balance(userId, 'BTC')).toEqual(['1', '0']);
    await expect(new WithdrawalService(db, prices).requestWithdrawal({ userId, asset: 'BTC', network: 'FIXTURE', toAddress: 'NONE', amount: '1' })).rejects.toMatchObject(locked);
  });
  test.each(['SIMUSDT', 'VHX01'])('even a pre-existing held %s withdrawal cannot be approved or sent', async asset => {
    await db.balance.create({ data: { userId: other, asset, available: '0', locked: '10' } });
    const w = await db.withdrawal.create({ data: { userId: other, asset, network: 'FIXTURE', toAddress: 'NONE', amount: '10', status: 'PENDING', balanceHeld: true } });
    const withdrawals = new WithdrawalService(db, prices);
    await expect(withdrawals.approveWithdrawal({ withdrawalId: w.id, performedByAdminId: userId })).rejects.toThrow('test asset');
    await db.withdrawal.update({ where: { id: w.id }, data: { status: 'APPROVED' } });
    await expect(withdrawals.markSent({ withdrawalId: w.id, performedByAdminId: userId, txHash: 'SYNTHETIC-NO-CHAIN' })).rejects.toThrow('test asset');
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id: w.id } })).status).toBe('APPROVED');
    await expect(withdrawals.rejectWithdrawal({ withdrawalId: w.id, performedByAdminId: userId })).resolves.toMatchObject({ status: 'REJECTED' });
  });
  test('DemoBalance alone never funds ordinary withdrawal or Futures transfer', async () => {
    await db.balance.update({ where: { userId_asset: { userId: other, asset: 'USDT' } }, data: { available: '0' } });
    await db.demoBalance.create({ data: { userId: other, asset: 'USDT', available: '1000000' } });
    await expect(request('1', other)).rejects.toThrow('Insufficient');
    await expect(transferWalletBalance(db, other, 'USDT', new BigNumber(1), 'TO_FUTURES', prices)).rejects.toThrow('Insufficient');
    expect((await db.demoBalance.findUniqueOrThrow({ where: { userId_asset: { userId: other, asset: 'USDT' } } })).available.toFixed()).toBe('1000000');
  });
});
