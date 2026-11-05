/**
 * Owner-only Cross demo-wallet conversion acceptance on DISPOSABLE PostgreSQL.
 * No venue, treasury wallet, production URL, blockchain or Copy Trading.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { emptyDemoState } from '../../private-trading/native/engine';
import { compact, inflate, type NativeAccount } from '../../private-trading/native/store';
import { replayNativeDemoAsync } from '../../private-trading/native/replay';
import { accountLedger } from '../../private-trading/native/ledger';
import { WalletConversionService, parseConversionAssets, DEFAULT_CONVERSION_ASSETS } from '../WalletConversionService';

const url = process.env.VOLTEX_CROSS_CONVERSION_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_cross_conversion_test') {
    throw new Error('Cross conversion tests must use disposable loopback voltex_cross_conversion_test');
  }
}
const pg = url ? describe : describe.skip;
pg('Cross wallet conversion: one native debit + two demo asset legs in one DB transaction', () => {
  let db: PrismaClient, owner: string, other: string, inventory: string, session: string;
  let service: WalletConversionService;
  let env: NodeJS.ProcessEnv;
  const original = new Map<string, string | undefined>();
  const flagKeys = ['PRIVATE_TRADING_ENABLED', 'PRIVATE_TRADING_OWNER_ID', 'PRIVATE_TRADING_TEST_USER_IDS'] as const;
  const prices = {
    read: async () => ({ fetchedAt: Date.now(),
      bid: new Map([['USD', '1'], ['USDT', '1'], ['EUR', '1.2'], ['BTC', '60000']]),
      ask: new Map([['USD', '1'], ['USDT', '1'], ['EUR', '1.2'], ['BTC', '60000']]) }),
    depth: async () => '1000000000',
  };
  const bal = async (userId: string, asset: string) => {
    const b = await db.demoBalance.findUnique({ where: { userId_asset: { userId, asset } } });
    return b?.available.toString() ?? '0';
  };
  const native = async () => {
    const row = await db.nativeDemoAccount.findUniqueOrThrow({ where: { userId: owner } });
    return inflate(row.payload as unknown as NativeAccount);
  };
  const user = async (role: 'USER' | 'ADMIN') => {
    const id = randomUUID();
    await db.user.create({ data: { id, email: id + '@cross-qa.invalid', passwordHash: 'fixture',
      referralCode: id, role, kycStatus: 'APPROVED' } });
    return id;
  };
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  beforeEach(async () => {
    for (const key of flagKeys) original.set(key, process.env[key]);
    owner = await user('ADMIN'); other = await user('USER'); inventory = await user('USER');
    session = (await db.session.create({ data: { userId: owner } })).id;
    const t = Date.now() - 5_000;
    const init: NativeAccount = { revision: 1, deposit: '1000000', commands: [],
      snapshot: emptyDemoState('1000000', t), createdAt: t, source: 'DEMO_BALANCE' };
    await db.nativeDemoAccount.create({ data: { userId: owner, revision: 1, payload: compact(init) as never } });
    await db.demoBalance.createMany({ data: [
      { userId: inventory, asset: 'EUR', available: '1000000' },
      { userId: inventory, asset: 'USDT', available: '0' },
    ] });
    // Simulate an unrelated actual Balance holding: NEVER used in this paper exchange.
    await db.balance.create({ data: { userId: owner, asset: 'USDT', available: '7' } });
    env = { PRIVATE_TRADING_ENABLED: 'true', PRIVATE_TRADING_OWNER_ID: owner,
      PRIVATE_TRADING_TEST_USER_IDS: '', WALLET_CONVERSION_ENABLED: 'true',
      WALLET_CROSS_DEMO_CONVERSION_ENABLED: 'true', WALLET_CROSS_DEMO_MAX_USD: '1000000',
      DEMO_LIQUIDITY_ENABLED: 'false', DEMO_LIQUIDITY_ACCOUNT_ID: inventory,
      DEMO_LIQUIDITY_PAIRS: 'BTC/USDT,EUR/USDT',
      DEMO_LIQUIDITY_MAX_ORDER_QUOTE: '1000',
      DEMO_WITHDRAWAL_GUARD_ENABLED: 'true',
    };
    for (const key of flagKeys) process.env[key] = env[key];
    service = new WalletConversionService(db, prices, Date.now,
      parseConversionAssets(DEFAULT_CONVERSION_ASSETS)!,
      { maxUsd: new BigNumber('1000'), dailyUsd: new BigNumber('5000'), reserves: new Map() }, env);
  });
  afterEach(() => {
    for (const key of flagKeys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  afterAll(async () => { await db.$disconnect(); });

  test('owner converts 100000 test USDT to EUR despite real $1000 limit; immutable native replay survives restart', async () => {
    const availability = await service.availability(owner);
    expect(availability).toMatchObject({ convertible: true, ledger: 'cross' });
    const assets = await service.assets(owner);
    expect(assets.find(a => a.asset === 'USDT')?.available).toBe('1000000');
    const q = await service.quote(owner, 'USDT', 'EUR', '100000');
    expect(q).toMatchObject({ ledger: 'cross', fromAmount: '100000', fee: '0', toAsset: 'EUR' });
    const before = await native();
    expect(before.snapshot.walletBalance).toBe('1000000');
    const authority = { sessionId: session, expiresAt: Date.now() + 60_000 };
    const receipt = await service.confirm(owner, q.quoteId, authority);
    expect(receipt).toMatchObject({ status: 'APPLIED', ledger: 'cross', quoteId: q.quoteId });
    expect(await service.confirm(owner, q.quoteId, authority)).toEqual(receipt);
    expect(await service.status(owner, q.quoteId)).toEqual(receipt);
    const after = await native();
    expect(after.revision).toBe(2);
    expect(after.snapshot.walletBalance).toBe('900000');
    expect(accountLedger(after.snapshot).reconciled).toBe(true);
    expect(accountLedger(after.snapshot).totals.net).toBe('0');
    const restarted = await replayNativeDemoAsync({ deposit: after.deposit, instructions: after.commands,
      asOf: after.snapshot.time, checkpoint: after.checkpoint }, async () => []);
    expect(restarted.snapshot.walletBalance).toBe('900000');
    const full = await replayNativeDemoAsync({ deposit: after.deposit, instructions: after.commands,
      asOf: after.snapshot.time }, async () => []);
    expect(full.snapshot.walletBalance).toBe('900000');
    expect(await bal(owner, 'EUR')).toBe(q.toAmount);
    // The simulated conversion creates the destination denomination inside
    // this same user only. The separately funded liquidity account is untouched.
    expect(await bal(inventory, 'EUR')).toBe('1000000');
    expect(await bal(inventory, 'USDT')).toBe('0');
    expect((await db.balance.findUniqueOrThrow({ where: { userId_asset: { userId: owner, asset: 'USDT' } } })).available.toString()).toBe('7');
    expect(await db.auditLog.count({ where: { userId: owner, action: 'WALLET_CROSS_CONVERTED' } })).toBe(1);
    expect(await db.nativeDemoRevision.count({ where: { userId: owner, revision: 2 } })).toBe(1);
    const activity = await db.auditLog.findFirstOrThrow({ where: { userId: owner, action: 'WALLET_CROSS_CONVERTED' } });
    expect((activity.metadata as Record<string, unknown>).toAsset).toBe('EUR');
  }, 30_000);

  test('demo-only native USDT swap is independent of unrelated demo liquidity or external reserves', async () => {
    const q = await service.quote(owner, 'USDT', 'EUR', '100000');
    const before = await native();
    const initialInventory = await bal(inventory, 'EUR');
    expect(await bal(owner, 'EUR')).toBe('0');
    await db.demoBalance.update({ where: { userId_asset: { userId: inventory, asset: 'EUR' } },
      data: { available: '0' } });
    const receipt = await service.confirm(owner, q.quoteId, { sessionId: session, expiresAt: Date.now() + 60_000 });
    expect(receipt).toMatchObject({ status: 'APPLIED', ledger: 'cross' });
    const after = await native();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.snapshot.walletBalance).toBe(new BigNumber(before.snapshot.walletBalance).minus('100000').toFixed());
    expect(await bal(owner, 'EUR')).toBe(q.toAmount);
    expect(await bal(inventory, 'USDT')).toBe('0');
    expect(await bal(inventory, 'EUR')).toBe('0');
    expect(await db.auditLog.count({ where: { userId: owner, action: 'WALLET_CROSS_CONVERTED' } })).toBe(1);
    expect(await db.nativeDemoRevision.count({ where: { userId: owner, revision: 2 } })).toBe(1);
    // Return the fixture inventory for repeatability (no production ledger touched).
    await db.demoBalance.update({ where: { userId_asset: { userId: inventory, asset: 'EUR' } },
      data: { available: initialInventory } });
  });

  test('off switch and other users cannot spend native demo capital; live position refuses safely', async () => {
    expect((await service.availability(other)).ledger).not.toBe('cross');
    await expect(service.confirm(other, randomUUID(), { sessionId: session, expiresAt: Date.now() + 60_000 }))
      .rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
    env.WALLET_CROSS_DEMO_CONVERSION_ENABLED = 'false';
    expect((await service.availability(owner)).ledger).not.toBe('cross');
    env.WALLET_CROSS_DEMO_CONVERSION_ENABLED = 'true';
    const q = await service.quote(owner, 'USDT', 'EUR', '100');
    const stored = await db.nativeDemoAccount.findUniqueOrThrow({ where: { userId: owner } });
    const value = inflate(stored.payload as unknown as NativeAccount);
    value.snapshot.orders.push({ status: 'OPEN' } as typeof value.snapshot.orders[number]);
    await db.nativeDemoAccount.update({ where: { userId: owner }, data: { payload: compact(value) as never } });
    await expect(service.confirm(owner, q.quoteId, { sessionId: session, expiresAt: Date.now() + 60_000 }))
      .rejects.toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
    expect(await bal(owner, 'EUR')).toBe('0');
    expect(await db.auditLog.count({ where: { userId: owner, action: 'WALLET_CROSS_CONVERTED' } })).toBe(0);
  });
});
