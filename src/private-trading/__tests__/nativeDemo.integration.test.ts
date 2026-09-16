/** Explicitly opted-in, real transactions on the dedicated disposable TEST PostgreSQL (see private-trading workflow). */
import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { randomUUID } from 'crypto';
import { NativeDemoService } from '../native/service';
import { NativeAccount, PrismaNativeRepository } from '../native/store';
import type { OwnerSession } from '../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateHistoryRequest } from '../marketData';

const enabled = process.env.PRIVATE_TRADING_DB_TESTS === '1';
if (enabled) {
  require('dotenv').config();
  const hostname = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1'].includes(hostname)) throw new Error('Native demo DB tests run only against a disposable loopback TEST database');
}
const dbDescribe = enabled ? describe : describe.skip;
const M = 60_000;
const instrument = (symbol: string): PrivateInstrument => ({ provider: 'bybit', symbol, baseAsset: 'BTC', quoteAsset: 'USDT', settleAsset: 'USDT', contractType: 'LinearPerpetual', status: 'Trading', launchTime: 1_577_836_800_000, fetchedAt: Date.now(), fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5' }, leverage: { min: '1', max: '100', step: '1' },
  riskTiers: [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }], parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'DB_TEST_FIXTURE' });
class FixtureMarket {
  price = '50000';
  async instrument(symbol: string) { return instrument(symbol); }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    const t = Date.now(), p = new BigNumber(this.price);
    return { provider: 'bybit', symbol, bids: [{ price: p.minus('0.1').toFixed(), quantity: '10' }], asks: [{ price: p.plus('0.1').toFixed(), quantity: '10' }], markPrice: this.price, lastPrice: this.price, fundingRate: '0', nextFundingTime: t + 3_600_000, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  async history(r: PrivateHistoryRequest) {
    const candles = []; for (let t = r.startTime; t < r.endTime; t += M) candles.push({ timestamp: t, open: this.price, high: this.price, low: this.price, close: this.price });
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: M, complete: true, issues: [], fetchedAt: Date.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1' as const, instrument: instrument(r.symbol) };
  }
}
dbDescribe('native demo real TEST PostgreSQL persistence', () => {
  let db: PrismaClient;
  beforeAll(async () => { db = new PrismaClient(); await db.$connect(); }, 20000);
  afterAll(async () => { await db?.$disconnect(); });
  async function fixture(demo = '10000000') {
    const tag = randomUUID().replace(/-/g, '');
    const user = await db.user.create({ data: { email: `qa-native-${tag}@example.test`, passwordHash: 'TEST_FIXTURE_NO_LOGIN', referralCode: `nd${tag}`, role: 'ADMIN' } });
    const session = await db.session.create({ data: { userId: user.id, userAgent: 'PRIVATE_TRADING_DB_TESTS_ONLY' } });
    await db.demoBalance.create({ data: { userId: user.id, asset: 'USDT', available: demo } });
    await db.balance.create({ data: { userId: user.id, asset: 'USDT', available: '123.45', locked: '1' } });
    await db.futuresBalance.create({ data: { userId: user.id, asset: 'USDT', available: '678.9', locked: '2' } });
    const actor: OwnerSession = { userId: user.id, sessionId: session.id, expiresAt: Date.now() + 3_600_000 };
    const config = { enabled: true, ownerId: user.id };
    const market = new FixtureMarket();
    const make = () => { const repository = new PrismaNativeRepository(db, () => config); return { repository, service: new NativeDemoService(repository, market as unknown as PrivateTradingMarketData) }; };
    return { user, session, actor, config, market, make, ...make() };
  }
  const realState = async (userId: string) => JSON.parse(JSON.stringify({
    balances: await db.balance.findMany({ where: { userId }, select: { asset: true, available: true, locked: true } }),
    futures: await db.futuresBalance.findMany({ where: { userId }, select: { asset: true, available: true, locked: true } }),
    orders: await db.order.count({ where: { userId } }), futuresOrders: await db.futuresOrder.count({ where: { userId } }),
    futuresPositions: await db.futuresPosition.count({ where: { userId } }), demoOrders: await db.demoOrder.count({ where: { userId } }),
    privateAccount: await db.privateTradingAccount.count({ where: { userId } }),
  }));

  /**
   * BEFORE -> INITIALIZE -> AFTER, as the trader actually meets it.
   *
   * This is the flow the `0.00 USDT` blocker lived in. The terminal read
   * the wallet's demo funds as an account balance of zero, and the only
   * control that could open the account had been removed from the page, so
   * the owner had funds in the Wallet, `Доступная маржа: 0.00 USDT` in
   * Futures, and no way across. The server contract below is what the
   * account panel now renders, and what makes the crossing possible.
   */
  test('BEFORE the account exists the server offers the demo balance, and AFTER it is collateral exactly once', async () => {
    const f = await fixture('10000000');

    // ---- BEFORE ----------------------------------------------------
    const before = await f.service.state(f.actor);
    expect(before.initialized).toBe(false);
    // The funds are REPORTED, so the panel has something true to show.
    expect(before.demoAvailable).toBe('10000000');
    // And there is no account yet — which is the unknown the panel renders
    // as a dash. A zero here is what the client used to fabricate.
    expect(before.account).toBeNull();
    expect(before.ledger).toBeNull();
    // The wallet still holds it: initialization has not happened.
    expect((await db.demoBalance.findUnique({ where: { userId_asset: { userId: f.user.id, asset: 'USDT' } } }))!.available.toString()).toBe('10000000');

    // ---- INITIALIZE ------------------------------------------------
    const after = await f.service.initialize(f.actor, `init-${randomUUID()}`);
    expect(after.initialized).toBe(true);
    expect(after.revision).toBe(1);

    // ---- AFTER -----------------------------------------------------
    // The offer is withdrawn the moment the account exists, so the button
    // cannot be pressed a second time by a client that simply re-reads.
    const reloaded = await f.service.state(f.actor);
    expect(reloaded.demoAvailable).toBeNull();
    expect(reloaded.initialized).toBe(true);

    // NO DOUBLE COUNTING. The demo row was debited into the ledger, so the
    // settle balance carries the whole amount and the wallet side carries
    // none of it. Collateral is their sum, and it is the original figure,
    // not twice it.
    expect(reloaded.account?.settleBalance).toBe('10000000');
    expect(reloaded.account?.walletCollateral).toBe('0');
    expect(reloaded.account?.collateral).toBe('10000000');
    expect(reloaded.account?.equity).toBe('10000000');
    expect(reloaded.account?.available).toBe('10000000');
    expect(reloaded.ledger?.reconciled).toBe(true);
    expect((await db.demoBalance.findUnique({ where: { userId_asset: { userId: f.user.id, asset: 'USDT' } } }))!.available.toString()).toBe('0');

    // ---- RELOAD DOES NOT RE-TRANSFER -------------------------------
    // A fresh process, as a page reload is. Reading state must not move
    // anything, and initializing again must not move anything either.
    const second = f.make().service;
    await second.state(f.actor);
    const repeat = await second.initialize(f.actor, `init-${randomUUID()}`);
    expect(repeat.revision).toBe(1);
    expect(repeat.account?.collateral).toBe('10000000');
    expect((await db.demoBalance.findUnique({ where: { userId_asset: { userId: f.user.id, asset: 'USDT' } } }))!.available.toString()).toBe('0');
    expect(await db.nativeDemoRevision.count({ where: { userId: f.user.id } })).toBe(1);
  });

  /**
   * The rest of the wallet is collateral too, and is counted ONCE.
   *
   * The owner's total is balances times marks plus the trading ledger —
   * never a number written into the source. This proves the two parts are
   * added rather than either being double counted or dropped.
   */
  test('a non-settle holding is valued at mark and added once, never twice', async () => {
    const f = await fixture('1000000');
    await db.demoBalance.create({ data: { userId: f.user.id, asset: 'BTC', available: '2', locked: '0.5' } });

    const before = await f.service.state(f.actor);
    // The offer names the SETTLE funds the account opens with, not the
    // whole wallet: BTC is collateral, but it is not what is transferred.
    expect(before.demoAvailable).toBe('1000000');

    await f.service.initialize(f.actor, `init-${randomUUID()}`);
    const after = await f.service.state(f.actor);

    // 2.5 BTC at the fixture's 50 000 mark = 125 000, held apart from the
    // 1 000 000 that moved into the ledger. Locked quantity counts: it is
    // still the owner's, and it is still collateral.
    expect(after.account?.settleBalance).toBe('1000000');
    expect(after.account?.walletCollateral).toBe('125000');
    expect(after.account?.collateral).toBe('1125000');
    expect(after.account?.equity).toBe('1125000');
    expect(after.account?.collateralComplete).toBe(true);
    expect(after.account?.unpricedAssets).toEqual([]);

    // The valuation MOVES with the price — it is not a stored total.
    f.market.price = '60000';
    const revalued = await f.service.state(f.actor);
    expect(revalued.account?.walletCollateral).toBe('150000');
    expect(revalued.account?.collateral).toBe('1150000');
    // ...while the ledger side is untouched by a price change.
    expect(revalued.account?.settleBalance).toBe('1000000');
  });

  test('a wallet with no demo funds is offered nothing to open an account with', async () => {
    const f = await fixture('0');
    const before = await f.service.state(f.actor);
    expect(before.initialized).toBe(false);
    // '0' is a real answer, and the client refuses to offer a button that
    // would move nothing — it is not rendered as an opportunity.
    expect(before.demoAvailable).toBe('0');
    expect(before.account).toBeNull();
  });

  test('first use moves the existing demo balance once, even from two tabs at the same time', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.service.initialize(f.actor, `init-${randomUUID()}`), f.make().service.initialize(f.actor, `init-${randomUUID()}`)]);
    expect(a.revision).toBe(1); expect(b.revision).toBe(1);

    // `walletBalance` was renamed to `settleBalance` when the account model
    // started counting the wallet's OTHER assets as Cross collateral: one
    // name was being used for two different quantities. Same figure, and
    // the assertion is still that the balance moved in full.
    expect(a.account?.settleBalance).toBe('10000000');

    // THE EQUIVALENT FINANCIAL MAGNITUDE, and the double-counting check.
    // The demo row was DEBITED into the simulation ledger, so it must now
    // be counted once and only once: the wallet side contributes nothing,
    // and the whole collateral base is exactly the amount that moved.
    expect(a.account?.walletCollateral).toBe('0');
    expect(a.account?.collateral).toBe('10000000');
    // No position yet, so equity is that collateral and all of it is free.
    expect(a.account?.unrealizedPnl).toBe('0');
    expect(a.account?.equity).toBe('10000000');
    expect(a.account?.available).toBe('10000000');
    // And the ledger agrees with the engine it was projected from.
    expect(a.ledger?.openingBalance).toBe('10000000');
    expect(a.ledger?.closingBalance).toBe('10000000');
    expect(a.ledger?.reconciled).toBe(true);
    expect(a.ledger?.totals).toEqual({ realizedPnl: '0', fees: '0', funding: '0', net: '0' });

    // The concurrency assertion is unchanged: the balance moved ONCE, and
    // the two tabs produced one revision between them.
    expect((await db.demoBalance.findUnique({ where: { userId_asset: { userId: f.user.id, asset: 'USDT' } } }))!.available.toString()).toBe('0');
    expect(await db.nativeDemoRevision.count({ where: { userId: f.user.id } })).toBe(1);
  });

  test('lifecycle persists across a restart and never touches real balances, orders or positions', async () => {
    const f = await fixture();
    const before = await realState(f.user.id);
    await f.service.initialize(f.actor, `init-${randomUUID()}`);
    let v = await f.service.command(f.actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', margin: '5000', leverage: '20', protection: { takeProfit: '60000' }, idempotencyKey: randomUUID() });
    const id = v.positions[0].id;
    await new Promise(r => setTimeout(r, 20));
    f.market.price = '51000';
    v = await f.service.command(f.actor, { kind: 'CLOSE', positionId: id, quantity: '0.5', idempotencyKey: randomUUID() });
    expect(v.positions[0].quantity).toBe('1.5');
    const restarted = f.make();
    const reloaded = await restarted.service.state(f.actor);
    expect(reloaded.revision).toBe(v.revision);
    expect(reloaded.positions).toEqual(v.positions);
    expect(reloaded.events).toEqual(v.events);
    const row = await db.nativeDemoAccount.findUnique({ where: { userId: f.user.id } });
    const payload = row!.payload as unknown as NativeAccount;
    expect(payload.checkpoint?.state).toBeDefined();
    const revision = await db.nativeDemoRevision.findUnique({ where: { userId_revision: { userId: f.user.id, revision: v.revision } } });
    expect((revision!.payload as unknown as NativeAccount).checkpoint).toBeUndefined();
    const card = await restarted.service.card(f.actor, id);
    expect(await restarted.service.card(f.actor, id, card.revision)).toEqual(card);
    expect(await realState(f.user.id)).toEqual(before);
  });

  test('two server processes cannot both commit on the same revision; the same key never executes twice', async () => {
    const f = await fixture();
    await f.service.initialize(f.actor, `init-${randomUUID()}`);
    const other = f.make();
    let waiting = 0, release!: () => void; const gate = new Promise<void>(r => { release = r; });
    for (const repository of [f.repository, other.repository]) {
      const commit = repository.commit.bind(repository);
      repository.commit = async (...args) => { if (++waiting === 2) release(); await gate; return commit(...args); };
    }
    const open = (key: string) => ({ kind: 'OPEN' as const, symbol: 'BTCUSDT', side: 'LONG' as const, type: 'MARKET' as const, margin: '1000', leverage: '10', idempotencyKey: key });
    const results = await Promise.allSettled([f.service.command(f.actor, open(randomUUID())), other.service.command(f.actor, open(randomUUID()))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'account_changed' } });
    const key = randomUUID(), fresh = f.make();
    const same = await Promise.allSettled([fresh.service.command(f.actor, open(key)), f.make().service.command(f.actor, open(key))]);
    const ok = same.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<NativeDemoService['command']>>> => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const state = await fresh.service.state(f.actor);
    expect(state.positions).toHaveLength(1);
    expect(new BigNumber(state.positions[0].quantity).toFixed()).toBe('0.4');
    await expect(fresh.service.command(f.actor, { ...open(key), margin: '2000' })).rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' });
    expect(await db.nativeDemoRevision.count({ where: { userId: f.user.id, requestKey: key } })).toBe(1);
  });

  test('revisions are append-only evidence', async () => {
    const f = await fixture();
    await f.service.initialize(f.actor, `init-${randomUUID()}`);
    await expect(db.$executeRaw`UPDATE "NativeDemoRevision" SET "revision" = 99 WHERE "userId" = ${f.user.id}`).rejects.toThrow(/immutable/);
    await expect(db.$executeRaw`DELETE FROM "NativeDemoRevision" WHERE "userId" = ${f.user.id}`).rejects.toThrow(/immutable/);
  });

  test('every repository read/write re-checks owner, ADMIN role, live session and the server flag', async () => {
    const f = await fixture();
    await f.service.initialize(f.actor, `init-${randomUUID()}`);
    const intruder = await fixture();
    await expect(f.service.state(intruder.actor)).rejects.toMatchObject({ status: 403 });
    f.config.enabled = false;
    await expect(f.service.state(f.actor)).rejects.toMatchObject({ status: 403 });
    f.config.enabled = true;
    await db.user.update({ where: { id: f.user.id }, data: { role: 'USER' } });
    await expect(f.service.command(f.actor, { kind: 'REFRESH', idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 403 });
    await db.user.update({ where: { id: f.user.id }, data: { role: 'ADMIN' } });
    await db.session.update({ where: { id: f.session.id }, data: { revokedAt: new Date() } });
    await expect(f.service.card(f.actor, 'native-anything')).rejects.toMatchObject({ status: 403 });
    expect(await db.nativeDemoRevision.count({ where: { userId: f.user.id } })).toBe(1);
  });
});
