/**
 * Issue #617 P0 (found by the independent #620 verification, 27.10): the owner/test-account
 * Spot "simulation sale" (MARKET SELL against the synthetic maker `simulation:<base>`) credited
 * the quote asset to the ordinary Spot ledger at the MODEL price. That USDT was then withdrawable
 * like a deposit (and could reach ordinary users through the real book). These checks run the real
 * OrderService, allocation and WithdrawalService on a disposable PostgreSQL: a simulated asset
 * (NRX here; managed listings in managedListingSimulationSale.pg.test.ts) is never turned into
 * Spot USDT, and the USDT supply never changes through a synthetic sale.
 *
 * Synthetic users and amounts only; no venue order, no production data.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { allocateNrxOwner } from '../testMarkets/nrxAllocation';
import { NEURIX } from '../testMarkets/neurix';
import { OrderService } from '../OrderService';
import { WithdrawalService } from '../WithdrawalService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';

const url = process.env.VOLTEX_NRX_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_nrx_test') throw new Error('Mint-fence tests require disposable loopback voltex_nrx_test database');
}
const pg = url ? describe : describe.skip;

pg('a synthetic Spot sale never mints withdrawable USDT from a simulated asset (Issue #617 P0)', () => {
  const users: string[] = [];
  let db: PrismaClient, owner: string, tester: string, engine: MatchingEngine, service: OrderService;
  const source = { getTicker: jest.fn().mockRejectedValue(new Error('No external price for NRX')) };
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };
  // Every USDT unit in the Spot ledger, all users: only deposits and admin credits may change it.
  const usdtSupply = async () => {
    const sum = await db.balance.aggregate({ where: { asset: 'USDT', userId: { in: users } }, _sum: { available: true, locked: true } });
    return new BigNumber(sum._sum.available?.toString() ?? '0').plus(sum._sum.locked?.toString() ?? '0').toFixed();
  };
  const sell = (userId: string, quantity: string) => service.placeOrder({ userId, pair: NEURIX.pair, side: 'SELL', type: 'MARKET', quantity: new BigNumber(quantity) });
  const synthetic = async (userId: string) => ({
    trades: await db.trade.count({ where: { takerUserId: userId, makerUserId: 'simulation:NRX' } }),
    audits: await db.auditLog.count({ where: { userId, action: { in: ['NRX_SIMULATION_SOLD', 'TEAM_SPOT_SIMULATION_SOLD'] } } }),
  });

  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NEURIX.listingAt + 60_000);
    owner = randomUUID(); tester = randomUUID(); users.push(owner, tester);
    process.env.PRIVATE_TRADING_TEST_USER_IDS = tester;
    await db.user.createMany({ data: ([[owner, 'ADMIN'], [tester, 'USER']] as const).map(([id, role]) => ({ id, email: `${id}@mint.invalid`, referralCode: id, passwordHash: 'fixture', role })) });
    await db.balance.createMany({ data: [{ userId: owner, asset: 'USDT', available: '1000' }, { userId: tester, asset: 'USDT', available: '10' }] });
    engine = new MatchingEngine(); service = new OrderService(db, engine, source);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    delete process.env.SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED;
    delete process.env.PRIVATE_TRADING_TEST_USER_IDS;
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    // The opt-in sales credit DemoBalance; nrxSpot.pg shares this database and expects no DemoBalance row at all.
    await db.demoBalance.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => { await db.$disconnect(); }); // whole disposable cluster is removed by the runner

  test('the owner (ADMIN): allocated NRX cannot be sold to the simulation; no USDT appears, nothing more becomes withdrawable', async () => {
    expect(await allocateNrxOwner(db, owner)).toMatchObject({ applied: true, quantity: '6250' });
    const supply = await usdtSupply();
    await expect(sell(owner, '6000')).rejects.toThrow('NRX is no longer available');
    expect(await balance(owner, 'NRX')).toEqual(['6250', '0']);
    expect(await balance(owner, 'USDT')).toEqual(['1000', '0']);
    expect(await synthetic(owner)).toEqual({ trades: 0, audits: 0 });
    expect(await db.order.count({ where: { userId: owner } })).toBe(0);
    expect(await usdtSupply()).toBe(supply);
    // Only the real 1000 USDT can be requested.
    const withdrawals = new WithdrawalService(db);
    await expect(withdrawals.requestWithdrawal({ userId: owner, asset: 'USDT', network: 'TRC20', toAddress: 'Tmint0000000000000000000000000000', amount: '1000.01' })).rejects.toThrow('Insufficient USDT balance');
    expect(await db.withdrawal.count({ where: { userId: owner } })).toBe(0);
  });


  test('a tester cannot obtain NRX via new orders, even with available ordinary USDT', async () => {
    await allocateNrxOwner(db, owner);
    const supply = await usdtSupply();
    await expect(service.placeOrder({ userId: tester, pair: NEURIX.pair, side: 'BUY', type: 'LIMIT',
      price: new BigNumber('0.01'), quantity: new BigNumber('100') }))
      .rejects.toThrow('NRX is no longer available');
    expect(await balance(tester, 'NRX')).toBeNull();
    expect(await balance(tester, 'USDT')).toEqual(['10', '0']);
    expect(await synthetic(tester)).toEqual({ trades: 0, audits: 0 });
    expect(await usdtSupply()).toBe(supply);
  });

  test('retirement wins even with synthetic settlement enabled or simultaneous requests', async () => {
    process.env.SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED = 'true';
    await allocateNrxOwner(db, owner);
    const supply = await usdtSupply();
    const result = await Promise.allSettled([sell(owner, '1'), sell(owner, '2'), sell(owner, '3')]);
    expect(result.every(value => value.status === 'rejected'
      && String(value.reason).includes('NRX is no longer available'))).toBe(true);
    service = new OrderService(db, new MatchingEngine(), source);
    await expect(sell(owner, '1')).rejects.toThrow('NRX is no longer available');
    expect(await balance(owner, 'NRX')).toEqual(['6250', '0']);
    expect(await balance(owner, 'USDT')).toEqual(['1000', '0']);
    expect(await db.demoBalance.count({ where: { userId: owner } })).toBe(0);
    expect(await synthetic(owner)).toEqual({ trades: 0, audits: 0 });
    expect(await usdtSupply()).toBe(supply);
  });
});
