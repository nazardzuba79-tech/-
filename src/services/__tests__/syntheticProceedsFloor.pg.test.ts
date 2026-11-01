/**
 * Issue #617 residual paths after #620/#625: USDT that an earlier simulated Spot sale already credited to
 * `Balance` (the live API before #625 wrote it exactly as `legacySale` below does) must not leave the account
 * as real value — not by withdrawal (new, or filed before the fence), not through the real book at an extreme
 * price in either direction — while the account's genuine funds above it, and every ordinary account, stay free.
 * Also: a minted listing token stays restricted while the in-memory listing registry is cold.
 *
 * Real OrderService and WithdrawalService on a disposable PostgreSQL; synthetic users and amounts only.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { NEURIX } from '../testMarkets/neurix';
import { OrderService } from '../OrderService';
import { WithdrawalService } from '../WithdrawalService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { setManagedListingAssets } from '../listings/managedSnapshot';
import { recordProvenanceDecision } from '../syntheticProceedsFloor';

const url = process.env.VOLTEX_NRX_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_nrx_test') throw new Error('Floor tests require disposable loopback voltex_nrx_test database');
}
const pg = url ? describe : describe.skip;
const LOCKED = { code: 'SYNTHETIC_PROCEEDS_LOCKED' };
const MARKS: Record<string, string> = { 'BTC/USDT': '60000', 'ETH/USDT': '3000', 'USDC/USDT': '1' };
const ADDRESS = 'Tfloor000000000000000000000000000';

pg('legacy simulated-sale proceeds cannot leave the account; genuine funds and ordinary accounts stay free (Issue #617)', () => {
  const users: string[] = [];
  let db: PrismaClient, owner: string, honest: string, accomplice: string, service: OrderService, withdrawals: WithdrawalService;
  let pricesDown = false;
  const source = { getTicker: jest.fn(async (pair: string) => {
    if (pricesDown) throw new Error('venue down');
    if (pair === 'TYVN/USDT') return { lastPrice: '5' }; // a venue that happens to list the same ticker
    if (pair === 'FLOORX/USDT') return { lastPrice: '0.01' }; // unvalued synthetic fixture, NRX stays retired
    return MARKS[pair] ? { lastPrice: MARKS[pair] } : null;
  }) };
  const give = async (userId: string, asset: string, amount: string) => {
    await db.balance.upsert({ where: { userId_asset: { userId, asset } }, create: { userId, asset, available: amount }, update: { available: { increment: amount } } });
  };
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };
  // Exactly what the pre-#625 API committed for a house-bought sale of a simulated asset.
  const legacySale = async (userId: string, quantity: string, price: string, settlementLedger?: 'DemoBalance') => {
    const orderId = randomUUID(), tradeId = randomUUID(), proceeds = new BigNumber(quantity).times(price).toFixed();
    if (!settlementLedger) await give(userId, 'USDT', proceeds);
    await db.order.create({ data: { id: orderId, userId, pair: NEURIX.pair, side: 'SELL', type: 'MARKET', originalQuantity: quantity, remainingQuantity: '0', status: 'FILLED' } });
    await db.trade.create({ data: { id: tradeId, pair: NEURIX.pair, takerOrderId: orderId, makerOrderId: 'simulation:NRX', takerUserId: userId, makerUserId: 'simulation:NRX', price, quantity, side: 'SELL' } });
    await db.auditLog.create({ data: { userId, action: 'NRX_SIMULATION_SOLD', metadata: { pair: NEURIX.pair, orderId, tradeId, quantity, price, proceeds, counterparty: 'simulation:NRX',
      ...(settlementLedger ? { settlementLedger, withdrawableProceeds: false } : {}) } } });
    // These cases cover the floor rule, i.e. an account whose provenance review released it to the floor
    // (the quarantine that applies before any review is covered by syntheticProvenanceQuarantine.pg.test.ts).
    if (!settlementLedger) await recordProvenanceDecision(db, { userId, adminId: 'fixture-admin', decision: 'RELEASE_TO_FLOOR', reason: 'fixture: provenance adjudicated', requestId: 'rel-' + randomUUID() });
  };
  const request = (userId: string, asset: string, amount: string) => withdrawals.requestWithdrawal({ userId, asset, network: 'TRC20', toAddress: ADDRESS, amount });
  const limit = (userId: string, pair: string, side: 'BUY' | 'SELL', price: string, quantity: string) =>
    service.placeOrder({ userId, pair, side, type: 'LIMIT', price: new BigNumber(price), quantity: new BigNumber(quantity) });

  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NEURIX.listingAt + 60_000);
    pricesDown = false; source.getTicker.mockClear();
    owner = randomUUID(); honest = randomUUID(); accomplice = randomUUID(); users.push(owner, honest, accomplice);
    await db.user.createMany({ data: ([[owner, 'ADMIN'], [honest, 'USER'], [accomplice, 'USER']] as const).map(([id, role]) => ({ id, email: `${id}@floor.invalid`, referralCode: id, passwordHash: 'fixture', role })) });
    // Genuine: 1000 USDT. Synthetic: 6000 NRX sold to the house at a model price of 6897.454 = 41 384 724 USDT.
    await give(owner, 'USDT', '1000');
    await legacySale(owner, '6000', '6897.454');
    service = new OrderService(db, new MatchingEngine(), source);
    withdrawals = new (WithdrawalService as unknown as new (...args: unknown[]) => WithdrawalService)(db, source);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    setManagedListingAssets([]);
    // Other suites share this database and its committed books: leave no resting order behind.
    await db.order.updateMany({ where: { userId: { in: users }, status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] } }, data: { status: 'CANCELLED' } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => { await db.$disconnect(); });

  test('withdrawal: the synthetic USDT is refused, the genuine 1000 USDT is not, and nothing is written on a refusal', async () => {
    await expect(request(owner, 'USDT', '1000000')).rejects.toMatchObject(LOCKED);
    expect(await db.withdrawal.count({ where: { userId: owner } })).toBe(0);
    expect(await balance(owner, 'USDT')).toEqual(['41385724', '0']);
    await expect(request(owner, 'USDT', '1000')).resolves.toMatchObject({ status: 'PENDING' });
    await expect(request(owner, 'USDT', '0.01')).rejects.toMatchObject(LOCKED);
    expect(await db.withdrawal.count({ where: { userId: owner } })).toBe(1);
    // Without a price source (old wiring) such an account withdraws nothing; an ordinary account is unaffected.
    const unpriced = new WithdrawalService(db);
    await expect(unpriced.requestWithdrawal({ userId: owner, asset: 'USDT', network: 'TRC20', toAddress: ADDRESS, amount: '1' })).rejects.toMatchObject(LOCKED);
    await give(honest, 'USDT', '50');
    await expect(unpriced.requestWithdrawal({ userId: honest, asset: 'USDT', network: 'TRC20', toAddress: ADDRESS, amount: '50' })).resolves.toMatchObject({ status: 'PENDING' });
  });

  test('a request filed before the fence cannot be approved or sent; it can still be rejected, returning the hold', async () => {
    // As the live API filed it: hold, then the row.
    await db.balance.update({ where: { userId_asset: { userId: owner, asset: 'USDT' } }, data: { available: { decrement: '1000000' }, locked: { increment: '1000000' } } });
    const pending = await db.withdrawal.create({ data: { userId: owner, asset: 'USDT', network: 'TRC20', toAddress: ADDRESS, amount: '1000000', status: 'PENDING' } });
    await expect(withdrawals.approveWithdrawal({ withdrawalId: pending.id, performedByAdminId: honest })).rejects.toMatchObject(LOCKED);
    const approved = await db.withdrawal.create({ data: { userId: owner, asset: 'USDT', network: 'TRC20', toAddress: ADDRESS, amount: '0', status: 'APPROVED' } });
    await db.withdrawal.update({ where: { id: approved.id }, data: { amount: '500' } });
    await db.balance.update({ where: { userId_asset: { userId: owner, asset: 'USDT' } }, data: { available: { decrement: '500' }, locked: { increment: '500' } } });
    await expect(withdrawals.markSent({ withdrawalId: approved.id, performedByAdminId: honest, txHash: '0xfloor' })).rejects.toMatchObject(LOCKED);
    expect((await db.withdrawal.findMany({ where: { userId: owner }, orderBy: { createdAt: 'asc' } })).map(w => w.status)).toEqual(['PENDING', 'APPROVED']);
    await expect(withdrawals.rejectWithdrawal({ withdrawalId: pending.id, performedByAdminId: honest })).resolves.toMatchObject({ status: 'REJECTED' });
    await expect(withdrawals.rejectWithdrawal({ withdrawalId: approved.id, performedByAdminId: honest })).resolves.toMatchObject({ status: 'REJECTED' });
    expect(await balance(owner, 'USDT')).toEqual(['41385724', '0']);
  });

  test('the real book, buying: an extreme bid for a simulated asset cannot pay the synthetic USDT to a user', async () => {
    await give(honest, 'FLOORX', '1');
    await expect(limit(owner, 'FLOORX/USDT', 'BUY', '40000', '1')).rejects.toMatchObject(LOCKED);
    expect(await db.order.count({ where: { userId: owner, status: 'OPEN' } })).toBe(0);
    expect(await balance(owner, 'USDT')).toEqual(['41385724', '0']);
    const sold = await limit(honest, 'FLOORX/USDT', 'SELL', '40000', '1');
    expect(sold.trades).toHaveLength(0);
    expect(await balance(honest, 'USDT')).toBeNull();
  });

  test('the real book, the other direction: real BTC bought at the market cannot be sold to an accomplice for nothing, nor withdrawn', async () => {
    await give(honest, 'BTC', '1');
    await limit(honest, 'BTC/USDT', 'SELL', '60000', '1');
    // A fair purchase moves no value: allowed, though paid with floor-bound USDT.
    expect((await limit(owner, 'BTC/USDT', 'BUY', '60000', '1')).trades).toHaveLength(1);
    expect(await balance(owner, 'BTC')).toEqual(['1', '0']);
    await give(accomplice, 'USDT', '1');
    await limit(accomplice, 'BTC/USDT', 'BUY', '1', '1');
    await expect(limit(owner, 'BTC/USDT', 'SELL', '1', '1')).rejects.toMatchObject(LOCKED);
    expect(await balance(owner, 'BTC')).toEqual(['1', '0']);
    expect(await balance(accomplice, 'BTC')).toBeNull();
    // That BTC is floor-bound value too.
    await expect(request(owner, 'BTC', '1')).rejects.toMatchObject(LOCKED);
  });

  test('a MARKET BUY into an accomplice\'s extreme ask is rolled back with its fills; the ask stays', async () => {
    await give(accomplice, 'BTC', '1');
    const ask = await limit(accomplice, 'BTC/USDT', 'SELL', '1000000', '1');
    await expect(service.placeOrder({ userId: owner, pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber('1') })).rejects.toMatchObject(LOCKED);
    expect(await db.trade.count({ where: { makerOrderId: ask.order.id } })).toBe(0);
    expect((await db.order.findUnique({ where: { id: ask.order.id } }))?.status).toBe('OPEN');
    expect(await balance(owner, 'USDT')).toEqual(['41385724', '0']);
    expect(await balance(accomplice, 'USDT')).toBeNull();
  });

  test('under its floor (price fell), the account may still sell a listing allocation for real USDT or trade at the market, never below it', async () => {
    await give(honest, 'BTC', '1');
    await limit(honest, 'BTC/USDT', 'SELL', '60000', '1');
    await limit(owner, 'BTC/USDT', 'BUY', '60000', '1');
    MARKS['BTC/USDT'] = '30000';
    try {
      await give(owner, 'FLOORX', '100');
      await give(honest, 'USDT', '1');
      await limit(honest, 'FLOORX/USDT', 'BUY', '0.01', '100');
      expect((await limit(owner, 'FLOORX/USDT', 'SELL', '0.01', '100')).trades).toHaveLength(1);
      // At the mark nothing moves; one unit above it would hand value to the seller.
      await expect(limit(owner, 'BTC/USDT', 'BUY', '30000', '0.001')).resolves.toMatchObject({ order: { status: 'OPEN' } });
      await expect(limit(owner, 'BTC/USDT', 'BUY', '30001', '0.001')).rejects.toMatchObject(LOCKED);
    } finally { MARKS['BTC/USDT'] = '60000'; }
  });

  test('concurrent withdrawals cannot jointly take more than the genuine funds', async () => {
    const results = await Promise.allSettled([request(owner, 'USDT', '800'), request(owner, 'USDT', '800')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason.code)).toEqual(['SYNTHETIC_PROCEEDS_LOCKED']);
    expect(await db.withdrawal.count({ where: { userId: owner } })).toBe(1);
  });

  test('prices down: the floor-bound account moves nothing; an ordinary account is never priced', async () => {
    pricesDown = true;
    await expect(request(owner, 'USDT', '1')).rejects.toMatchObject(LOCKED);
    await expect(limit(owner, 'BTC/USDT', 'BUY', '1', '1')).rejects.toMatchObject(LOCKED);
    source.getTicker.mockClear();
    await give(honest, 'USDT', '200'); await give(accomplice, 'BTC', '1');
    await limit(accomplice, 'BTC/USDT', 'SELL', '1000000', '0.0001');
    expect((await limit(honest, 'BTC/USDT', 'BUY', '1000000', '0.0001')).trades).toHaveLength(1);
    await expect(request(honest, 'USDT', '0.0001')).resolves.toMatchObject({ status: 'PENDING' });
    expect(source.getTicker).not.toHaveBeenCalled();
  });

  test('a sale settled into DemoBalance (#625 opt-in) puts nothing under the floor', async () => {
    const tester = randomUUID(); users.push(tester);
    await db.user.create({ data: { id: tester, email: `${tester}@floor.invalid`, referralCode: tester, passwordHash: 'fixture', role: 'USER' } });
    await give(tester, 'USDT', '25');
    await legacySale(tester, '10', '7', 'DemoBalance');
    await expect(request(tester, 'USDT', '25')).resolves.toMatchObject({ status: 'PENDING' });
  });

  const coldAllocation = async () => {
    setManagedListingAssets([]); // as after an API restart before the first Cloudflare read, or while that read fails
    await give(owner, 'TYVN', '1000');
    await db.auditLog.create({ data: { userId: owner, action: 'LISTING_OWNER_ALLOCATION', metadata: { listingId: 'tyvn-fixture', version: 1, asset: 'TYVN', quantity: '1000', usdtDebit: '0', usdtCredit: '0' } } });
  };
  test('cold listing registry: a minted listing token cannot be requested for withdrawal', async () => {
    await coldAllocation();
    await expect(request(owner, 'TYVN', '10')).rejects.toThrow('is a test asset');
    expect(await db.withdrawal.count({ where: { userId: owner } })).toBe(0);
  });

  test('cold listing registry: the owner cannot sell a minted listing token to the house at a venue price for real USDT', async () => {
    await coldAllocation();
    const usdt = await balance(owner, 'USDT');
    await expect(service.placeOrder({ userId: owner, pair: 'TYVN/USDT', side: 'SELL', type: 'MARKET', quantity: new BigNumber('100') })).rejects.toThrow('Simulation Spot sale is not available');
    expect(await balance(owner, 'USDT')).toEqual(usdt);
    expect(await balance(owner, 'TYVN')).toEqual(['1000', '0']);
    expect(await db.trade.count({ where: { takerUserId: owner, makerUserId: 'simulation:TYVN' } })).toBe(0);
  });
});
