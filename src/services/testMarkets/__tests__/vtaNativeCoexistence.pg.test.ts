import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { VtaDemoSales } from '../VtaDemoSales';
import { VOLTORA } from '../testAssetConfig';
import { NativeDemoService } from '../../../private-trading/native/service';
import { PrismaNativeRepository } from '../../../private-trading/native/store';
import { Clock, FakeMarket } from '../../../private-trading/native/testing/liveFixture';
import type { PrivateTradingMarketData } from '../../../private-trading/marketData';

const url = process.env.VOLTEX_PG_TEST_URL;
(url ? describe : describe.skip)('VTA Spot and native Futures share the actual disposable database', () => {
  if (url && new URL(url).hostname !== '127.0.0.1') throw new Error('Disposable localhost PostgreSQL required');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const allocated = new BigNumber(50000).div('0.011').decimalPlaces(8, BigNumber.ROUND_DOWN).toFixed();
  let actor: {userId: string; sessionId: string; expiresAt: number};
  let native: NativeDemoService, repo: PrismaNativeRepository, sales: VtaDemoSales;
  let requested: string[], clock: Clock, market: FakeMarket;
  beforeEach(async () => {
    actor = { userId: randomUUID(), sessionId: randomUUID(), expiresAt: Number.MAX_SAFE_INTEGER };
    await db.user.create({ data: { id: actor.userId, email: `${actor.userId}@vta-native.invalid`, referralCode: actor.userId, role: 'ADMIN', passwordHash: 'TEST_ONLY' } });
    await db.session.create({ data: { id: actor.sessionId, userId: actor.userId } });
    // Existing holdings: this test does not call allocation/top-up code.
    await db.demoBalance.createMany({ data: [{ asset: 'USDT', available: '100000' }, { asset: 'VTA', available: allocated }, { asset: 'ETH', available: '1' }].map(b => ({ ...b, userId: actor.userId })) });
    await db.balance.create({ data: { userId: actor.userId, asset: 'USDT', available: '50000' } });
    clock = new Clock(VOLTORA.listingAt + 60000); market = new FakeMarket(clock); requested = [];
    const marks = market.marks.bind(market), quote = market.freshQuote.bind(market);
    market.marks = async symbols => { requested.push(...symbols); return marks(symbols); };
    market.freshQuote = async symbol => { requested.push(symbol); return quote(symbol); };
    repo = new PrismaNativeRepository(db, () => ({ enabled: true, ownerId: actor.userId }));
    native = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now);
    sales = new VtaDemoSales(db, clock.now);
  });
  // Append-only native journals are intentionally retained in this disposable DB.
  afterAll(() => db.$disconnect());

  test('Spot projection values VTA and cash in its own scope without changing real funds', async () => {
    const result = await sales.sell({ userId: actor.userId, requestId: randomUUID(), quantity: '100.12345678' });
    const view = await sales.snapshot(actor.userId) as any;
    expect(allocated).toBe('4545454.54545454');
    expect(view.account).toMatchObject({ id: actor.userId, scope: 'SIMULATION_SPOT', cashPolicy: 'SHARED_DEMO_BALANCE' });
    expect(view.balances.find((b: any) => b.asset === 'VTA')).toMatchObject({ available: new BigNumber(allocated).minus(result.quantity).toFixed(), priceUsd: result.price });
    expect(view.balances.find((b: any) => b.asset === 'USDT').available).toBe(new BigNumber(100000).plus(result.proceeds).toFixed());
    expect(new BigNumber(view.totalValueUsd).eq(view.balances.reduce((sum: BigNumber, b: any) => sum.plus(b.valueUsd), new BigNumber(0)))).toBe(true);
    expect(view.sales[0]).toMatchObject(result);
    expect((await db.balance.findFirstOrThrow({ where: { userId: actor.userId } })).available.toString()).toBe('50000');
    expect(await db.withdrawal.count({ where: { userId: actor.userId } })).toBe(0);
    expect(await db.order.count({ where: { userId: actor.userId } })).toBe(0);
  });

  test('VTA never reaches external collateral prices; ordinary ETH and native open/close still work', async () => {
    await native.initialize(actor, randomUUID());
    const wallet = await native.wallet(actor);
    expect(requested).not.toContain('VTAUSDT');
    expect(requested).toContain('ETHUSDT');
    expect(wallet!.collateral.lines.map(b => b.asset)).not.toContain('VTA');
    expect(wallet!.collateral.lines.find(b => b.asset === 'ETH')).toMatchObject({ price: '50000', collateralEnabled: true });
    await native.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '0.1', leverage: '10', idempotencyKey: randomUUID() });
    const position = (await repo.read(actor))!.snapshot.positions.find(p => p.status === 'OPEN')!;
    await native.command(actor, { kind: 'CLOSE', positionId: position.id, idempotencyKey: randomUUID() });
    expect((await repo.read(actor))!.snapshot.positions.filter(p => p.status === 'OPEN')).toHaveLength(0);
    expect(requested).not.toContain('VTAUSDT');
    expect((await sales.snapshot(actor.userId)).balances.find(b => b.asset === 'VTA')!.available).toBe(allocated);
  });

  test('sale USDT follows existing native cash policy once, including initialization and restart', async () => {
    const first = await sales.sell({ userId: actor.userId, requestId: randomUUID(), quantity: '100' });
    const initialCash = new BigNumber(100000).plus(first.proceeds);
    await native.initialize(actor, randomUUID());
    expect((await sales.snapshot(actor.userId)).balances.find(b => b.asset === 'USDT')!.available).toBe('0');
    expect((await repo.read(actor))!.deposit).toBe(initialCash.toFixed());
    const second = await sales.sell({ userId: actor.userId, requestId: randomUUID(), quantity: '200' });
    const restarted = new NativeDemoService(new PrismaNativeRepository(db, () => ({ enabled: true, ownerId: actor.userId })), market as unknown as PrivateTradingMarketData, clock.now);
    const wallet = (await restarted.wallet(actor))!;
    expect(wallet.assetsValue).toBe(initialCash.plus(second.proceeds).plus(50000).toFixed());
    expect(wallet.collateral.lines.find(b => b.asset === 'USDT')!.available).toBe(second.proceeds);
    expect(wallet.collateral.lines.map(b => b.asset)).not.toContain('VTA');
    expect(requested).not.toContain('VTAUSDT');
    await expect(native.setCollateralPreference(actor, 'VTA', true, randomUUID())).rejects.toMatchObject({ code: 'collateral_asset_ineligible' });
    // An unsupported ordinary asset stays unpriced; no broad completeness bypass.
    await db.demoBalance.create({ data: { userId: actor.userId, asset: 'UNKNOWN', available: '1' } });
    market.frame = ['ETHUSDT'];
    const quote = market.freshQuote.bind(market);
    market.freshQuote = async symbol => { if (symbol === 'UNKNOWNUSDT') throw new Error('fixture unavailable'); return quote(symbol); };
    const incomplete = await restarted.collateral(actor);
    expect(incomplete.complete).toBe(false);
    expect(incomplete.unpriced).toContain('UNKNOWN');
  });

  test('prelisting value is unavailable; read-only receipt recovery is account-scoped and persists', async () => {
    const before = await new VtaDemoSales(db, () => VOLTORA.listingAt - 1).snapshot(actor.userId);
    expect(before.totalValueUsd).toBeNull();
    expect(before.balances.find(b => b.asset === 'VTA')!.valueUsd).toBeNull();
    const requestId = randomUUID();
    const result = await sales.sell({ userId: actor.userId, requestId, quantity: '100' });
    const restarted = new VtaDemoSales(db, clock.now);
    expect((await restarted.operation(actor.userId, requestId)).receipt).toMatchObject(result);
    expect((await restarted.operation(actor.userId, randomUUID())).receipt).toBeNull();
    const other = randomUUID();
    await db.user.create({ data: { id: other, email: `${other}@vta-native.invalid`, referralCode: other, role: 'ADMIN', passwordHash: 'TEST_ONLY' } });
    expect((await restarted.operation(other, requestId)).receipt).toBeNull();
    await db.user.update({ where: { id: other }, data: { role: 'USER' } });
    await expect(restarted.snapshot(other)).rejects.toMatchObject({ status: 403 });
    await expect(restarted.operation(other, requestId)).rejects.toMatchObject({ status: 403 });
    expect(await db.demoOrder.count({ where: { userId: actor.userId } })).toBe(1);
  });
});
