// Invoked ONLY by diagnose-otc-balance-safety.cjs --verify in its NEW local cluster.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
async function run() {
  assert.equal(process.argv[2], '--local-child');
  const url = new URL(process.env.OTC_DIAGNOSTIC_URL || '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/voltex_otc_safety_test'); assert.ok(url.port);
  global.fetch = async () => { throw new Error('External network forbidden'); };
  require('ts-node/register/transpile-only');
  const { PrismaClient } = require('./fixtures/isolated-prisma.cjs')(process.env.OTC_DIAGNOSTIC_CLIENT);
  const { WithdrawalService } = require('../src/services/WithdrawalService');
  const { OrderService } = require('../src/services/OrderService');
  const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
  const { mutateSpotBalance, mutateFuturesBalance } = require('../src/services/WalletMutation');
  const { transferWalletBalance } = require('../src/services/WalletTransferService');
  const { BalanceAdjustmentService } = require('../src/services/BalanceAdjustmentService');
  const { PurchaseService } = require('../src/services/PurchaseService');
  const { BankingService } = require('../src/banking/service');
  const { FuturesPositionService } = require('../src/futures/FuturesPositionService');
  const { MarkPriceService } = require('../src/futures/MarkPriceService');
  const { CfdPositionService } = require('../src/cfd/CfdPositionService');
  const { CfdLiquidationEngine } = require('../src/cfd/CfdLiquidationEngine');
  const BigNumber = require('bignumber.js');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const other = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const source = { getTicker: async () => ({ lastPrice: '100' }) };
  const watchdog = setTimeout(() => { console.error('WALLET SAFETY TIMEOUT'); process.exit(1); }, 150000);
  let passed = 0;
  const test = async (name, action) => {
    // Disposable cluster only: separate each case's executable liquidity.
    await db.trade.deleteMany(); await db.order.deleteMany();
    await action(); ++passed; console.log('PASS:', name);
  };
  const bn = x => new BigNumber(x);
  async function user(asset = 'USDT', available = '100') {
    const id = randomUUID();
    await db.user.create({ data: { id, email: `${id}@fixture.invalid`, passwordHash: 'NOT_A_REAL_PASSWORD_HASH', referralCode: id, createdAt: new Date('2020-01-01') } });
    await db.balance.create({ data: { userId: id, asset, available, locked: '0' } });
    return id;
  }
  async function balance(id, asset = 'USDT', model = 'balance') {
    const row = await db[model].findUnique({ where: { userId_asset: { userId: id, asset } } });
    return { available: row?.available.toString() ?? '0', locked: row?.locked.toString() ?? '0' };
  }
  const reserve = (id, q = '60') => other.$transaction(async tx => {
    await mutateSpotBalance(tx, id, 'USDT', { available: bn(q).negated(), locked: bn(q) });
    await tx.$executeRaw`INSERT INTO "FixtureOtcReserve" (id,"userId",amount) VALUES (${randomUUID()},${id},${q}::numeric)`;
  });
  const buy = (service, id, amount) => service.placeOrder({ userId: id, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: bn(100), quantity: bn(amount).div(100) });
  const withdraw = (id, amount, service = new WithdrawalService(db)) => service.requestWithdrawal({ userId: id, amount, asset: 'USDT', network: 'FIXTURE', toAddress: 'NOT_A_REAL_ADDRESS' });
  function gate() {
    let arrive, resume;
    const arrived = new Promise(r => { arrive = r; }), wait = new Promise(r => { resume = r; });
    return { arrived, release: () => resume(), pause: async () => { arrive(); await wait; } };
  }
  function instrument({ hook = async () => {}, isolation, lostAck = false, unknown = false } = {}) {
    return new Proxy(db, { get(target, key) {
      if (key === '$queryRaw' && unknown) return async () => { throw new Error('FIXTURE outcome read unavailable'); };
      if (key !== '$transaction') { const v = target[key]; return typeof v === 'function' ? v.bind(target) : v; }
      return async (callback, options) => {
        const value = await target.$transaction(async tx => callback(new Proxy(tx, { get(t, model) {
          const v = t[model];
          if (['balance', 'futuresBalance', 'order', 'withdrawal', 'trade', 'auditLog'].includes(model)) return new Proxy(v, { get(delegate, op) {
            const fn = delegate[op]; if (typeof fn !== 'function') return fn;
            return async args => { const result = await fn.call(delegate, args); await hook(model, op, args, result, tx); return result; };
          } });
          return typeof v === 'function' ? v.bind(t) : v;
        } })), { ...options, maxWait: 10000, timeout: 30000, ...(isolation ? { isolationLevel: isolation } : {}) });
        if (lostAck) throw new Error('FIXTURE lost commit acknowledgement');
        return value;
      };
    } });
  }
  try {
    await db.$executeRawUnsafe('CREATE TABLE "FixtureOtcReserve" (id text PRIMARY KEY, "userId" text NOT NULL, amount numeric(36,18) NOT NULL)');
    await test('concurrent withdrawal and reserve cannot claim 140 from 100', async () => {
      const id = await user();
      const outcomes = await Promise.allSettled([withdraw(id, '80'), reserve(id)]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      const b = await balance(id); assert.equal(bn(b.available).plus(b.locked).toFixed(), '100');
      const w = await db.withdrawal.aggregate({ where: { userId: id }, _sum: { amount: true } });
      const [r] = await db.$queryRaw`SELECT COALESCE(SUM(amount),0)::text AS q FROM "FixtureOtcReserve" WHERE "userId"=${id}`;
      assert.equal(b.locked, bn(w._sum.amount?.toString() || 0).plus(r.q).toFixed());
    });
    await test('product purchase competes with reserve without lost debit', async () => {
      const id = await user();
      const product = await db.product.create({ data: { name: 'FIXTURE ONLY', description: 'No delivery', priceAmount: '80', priceAsset: 'USDT' } });
      const outcomes = await Promise.allSettled([reserve(id), new PurchaseService(db).purchaseProduct(id, product.id)]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      const purchases = await db.purchase.count({ where: { userId: id } });
      assert.deepEqual(await balance(id), purchases ? { available: '20', locked: '0' } : { available: '40', locked: '60' });
    });
    await test('Banking placement competes with reserve on real Balance', async () => {
      const id = await user('USDT', '4000');
      const service = new BankingService(db, { prices: async () => ({ USDT: '1' }) });
      const outcomes = await Promise.allSettled([reserve(id, '2000'), service.createPlacement(id,
        { programId: 'MONTHLY_17_24M', asset: 'USDT', amount: '2500', idempotencyKey: randomUUID() })]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      const [placed] = await db.$queryRaw`SELECT COUNT(*)::int AS n FROM banking_placements WHERE user_id=${id}`;
      assert.deepEqual(await balance(id), placed.n ? { available: '1500', locked: '0' } : { available: '2000', locked: '2000' });
    });
    await test('actual Futures order and transfer cannot use the same free collateral', async () => {
      const id = await user('USDT', '0');
      await db.futuresBalance.create({ data: { userId: id, asset: 'USDT', available: '100', locked: '0' } });
      const service = new FuturesPositionService(db, new MatchingEngine(), new MarkPriceService(source));
      const outcomes = await Promise.allSettled([
        service.placeOrder({ userId: id, symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: bn(100), quantity: bn(8), leverage: 10, marginType: 'ISOLATED' }),
        transferWalletBalance(other, id, 'USDT', bn(60), 'TO_SPOT'),
      ]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      const f = await balance(id, 'USDT', 'futuresBalance'), s = await balance(id);
      assert.equal(bn(f.available).plus(f.locked).plus(s.available).toFixed(), '100');
    });
    await test('actual CFD open competes with transfer; two closes release margin once', async () => {
      const quote = () => ({ provider: 'fixture', symbol: 'XAUUSD', providerSymbol: 'XAUUSD', last: 100, bid: null, ask: null, mid: null,
        providerTimestamp: Date.now(), fetchedAt: Date.now(), stale: false, status: 'live', entitlementVerified: true, executionAllowed: true });
      const quotes = { isConfigured: () => true, maxQuoteAgeMs: 5000, getFreshQuote: async () => quote(), getQuotes: async () => [quote()] };
      const id = await user('USDT', '0');
      await db.futuresBalance.create({ data: { userId: id, asset: 'USDT', available: '100', locked: '0' } });
      const service = new CfdPositionService(db, quotes);
      const results = await Promise.allSettled([service.open({ userId: id, symbol: 'XAUUSD', side: 'BUY', quantity: bn(8), leverage: 10 }),
        transferWalletBalance(other, id, 'USDT', bn(60), 'TO_SPOT')]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const f = await balance(id, 'USDT', 'futuresBalance'), s = await balance(id);
      assert.equal(bn(f.available).plus(f.locked).plus(s.available).toFixed(), '100');
      const holder = await user('USDT', '0');
      await db.futuresBalance.create({ data: { userId: holder, asset: 'USDT', available: '100', locked: '60' } });
      const opened = await service.open({ userId: holder, symbol: 'XAUUSD', side: 'BUY', quantity: bn(3), leverage: 10 });
      const close = { userId: holder, positionId: opened.id };
      const closed = await Promise.allSettled([service.close(close), new CfdPositionService(other, quotes).close(close)]);
      assert.equal(closed.filter(r => r.status === 'fulfilled').length, 1);
      assert.deepEqual(await balance(holder, 'USDT', 'futuresBalance'), { available: '100', locked: '60' });
    });
    await test('CFD liquidation versus close cannot consume another obligation', async () => {
      const id = await user('USDT', '0');
      await db.futuresBalance.create({ data: { userId: id, asset: 'USDT', available: '100', locked: '80' } });
      const position = await db.cfdPosition.create({ data: { userId: id, symbol: 'XAUUSD', side: 'LONG', size: '1', entryPrice: '200',
        leverage: 10, initialMargin: '20', liquidationPrice: '181', status: 'OPEN' } });
      const quote = { provider: 'fixture', symbol: 'XAUUSD', last: 180, providerTimestamp: Date.now(), fetchedAt: Date.now(), stale: false,
        status: 'live', entitlementVerified: true, executionAllowed: true };
      const quotes = { isConfigured: () => true, maxQuoteAgeMs: 5000, getFreshQuote: async () => quote, getQuotes: async () => [quote] };
      await Promise.allSettled([new CfdPositionService(db, quotes).close({ userId: id, positionId: position.id }),
        new CfdLiquidationEngine(other, quotes).liquidatePosition(position.id, quote)]);
      assert.deepEqual(await balance(id, 'USDT', 'futuresBalance'), { available: '100', locked: '60' });
      assert.notEqual((await db.cfdPosition.findUniqueOrThrow({ where: { id: position.id } })).status, 'OPEN');
    });
    await test('deferred COMMIT abort does not publish a prepared Spot match', async () => {
      const buyer = await user(), seller = await user('BTC', '1'), engine = new MatchingEngine();
      const service = new OrderService(db, engine, source);
      const maker = await service.placeOrder({ userId: seller, pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: bn(80), quantity: bn(1) });
      await db.$executeRawUnsafe('CREATE TABLE "CommitAbortFixture" (id int, parent int, UNIQUE(id), FOREIGN KEY(parent) REFERENCES "CommitAbortFixture"(id) DEFERRABLE INITIALLY DEFERRED)');
      const failing = new OrderService(instrument({ hook: async (model, op, _a, _r, tx) => {
        if (model === 'trade' && op === 'create') await tx.$executeRawUnsafe('INSERT INTO "CommitAbortFixture" VALUES (1,999)');
      } }), engine, source);
      await assert.rejects(() => buy(failing, buyer, '80'));
      assert.equal(await db.trade.count(), 0); assert.equal(await db.order.count({ where: { userId: buyer } }), 0);
      assert.equal(engine.getBook('BTC/USDT').bestAsk().id, maker.order.id);
      assert.equal(engine.getBook('BTC/USDT').bestAsk().remainingQuantity.toFixed(), '1');
      assert.deepEqual(await balance(buyer), { available: '100', locked: '0' });
      assert.equal((await buy(service, buyer, '80')).trades.length, 1);
    });
    await test('concurrent Spot placement and reserve cannot double spend', async () => {
      const id = await user(), engine = new MatchingEngine();
      const service = new OrderService(db, engine, source);
      const outcomes = await Promise.allSettled([buy(service, id, '80'), reserve(id)]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      const b = await balance(id); assert.equal(bn(b.available).plus(b.locked).toFixed(), '100');
      const orders = await db.order.findMany({ where: { userId: id } });
      assert.equal(b.locked, orders.length ? '80' : '60');
    });
    await test('two Spot cancellations leave the other owned 60 hold intact', async () => {
      const id = await user(), engine = new MatchingEngine(), service = new OrderService(db, engine, source);
      const placed = await buy(service, id, '30'); await reserve(id);
      const results = await Promise.all([service.cancelOrder(id, placed.order.id), service.cancelOrder(id, placed.order.id)]);
      assert.equal(results.filter(Boolean).length, 1); assert.deepEqual(await balance(id), { available: '40', locked: '60' });
    });
    await test('two withdrawal rejections refund once and preserve unrelated hold', async () => {
      const id = await user(), service = new WithdrawalService(db), w = await withdraw(id, '30'); await reserve(id);
      const p = { withdrawalId: w.id, performedByAdminId: 'fixture-admin' };
      const results = await Promise.allSettled([service.rejectWithdrawal(p), service.rejectWithdrawal(p)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.deepEqual(await balance(id), { available: '40', locked: '60' });
      assert.equal(await db.auditLog.count({ where: { userId: id, action: 'WITHDRAWAL_REJECTED' } }), 1);
    });
    await test('withdrawal sent versus rejected has exactly one financial effect', async () => {
      const id = await user(), service = new WithdrawalService(db), w = await withdraw(id, '30'); await reserve(id);
      const p = { withdrawalId: w.id, performedByAdminId: 'fixture-admin' }; await service.approveWithdrawal(p);
      const results = await Promise.allSettled([service.markSent({ ...p, txHash: 'fixture-not-a-chain-transaction' }), service.rejectWithdrawal(p)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const row = await db.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
      assert.deepEqual(await balance(id), { available: row.status === 'SENT' ? '10' : '40', locked: '60' });
    });
    await test('Spot serialization rollback leaves book, orders, balances intact; next match succeeds', async () => {
      const buyer = await user(), seller = await user('BTC', '1'), engine = new MatchingEngine();
      const service = new OrderService(db, engine, source), pause = gate();
      const maker = await service.placeOrder({ userId: seller, pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: bn(80), quantity: bn(1) });
      const fault = new OrderService(instrument({ isolation: 'Serializable', hook: async (m, op) => { if (m === 'trade' && op === 'create') await pause.pause(); } }), engine, source);
      const pending = fault.placeOrder({ userId: buyer, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: bn(80), quantity: bn(1) }).then(value => ({ value }), error => ({ error }));
      await pause.arrived;
      await other.balance.update({ where: { userId_asset: { userId: seller, asset: 'BTC' } }, data: { available: { increment: '1' } } });
      pause.release(); const result = await pending; assert.equal(result.error?.code, 'P2034');
      assert.equal(await db.trade.count({ where: { takerUserId: buyer } }), 0);
      assert.equal(await db.order.count({ where: { userId: buyer } }), 0);
      assert.deepEqual(await balance(buyer), { available: '100', locked: '0' });
      assert.equal(engine.getBook('BTC/USDT').bestAsk().id, maker.order.id);
      assert.equal(engine.getBook('BTC/USDT').bestAsk().remainingQuantity.toFixed(), '1');
      const valid = await service.placeOrder({ userId: buyer, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: bn(80), quantity: bn(1) });
      assert.equal(valid.trades.length, 1);
      const saved = await db.order.findUniqueOrThrow({ where: { id: maker.order.id } });
      assert.equal(saved.status, 'FILLED'); assert.equal(saved.remainingQuantity.toString(), '0');
    });
    await test('partial maker state persists and restart only loads remaining quantity', async () => {
      const seller = await user('BTC', '1'), buyer = await user(), engine = new MatchingEngine(), service = new OrderService(db, engine, source);
      const maker = await service.placeOrder({ userId: seller, pair: 'ETH/USDT', side: 'BUY', type: 'LIMIT', price: bn(1), quantity: bn(1) }).catch(() => null);
      assert.equal(maker, null); // unrelated asset cannot borrow a BTC balance
      const ask = await service.placeOrder({ userId: seller, pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: bn(90), quantity: bn(1) });
      await service.placeOrder({ userId: buyer, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: bn(90), quantity: bn('0.4') });
      const saved = await db.order.findUniqueOrThrow({ where: { id: ask.order.id } });
      assert.equal(saved.status, 'PARTIALLY_FILLED'); assert.equal(saved.remainingQuantity.toString(), '0.6');
      const restarted = new OrderService(db, new MatchingEngine(), source);
      await restarted.cancelOrder(seller, ask.order.id);
      assert.deepEqual(await balance(seller, 'BTC'), { available: '0.6', locked: '0' });
    });
    await test('lost COMMIT acknowledgement is reconciled without duplicate order', async () => {
      const id = await user(), engine = new MatchingEngine(), service = new OrderService(instrument({ lostAck: true }), engine, source);
      const result = await buy(service, id, '10');
      assert.equal(await db.order.count({ where: { userId: id } }), 1);
      assert.ok(engine.getBook('BTC/USDT').getBook('BUY').some(row => row.id === result.order.id));
      assert.deepEqual(await balance(id), { available: '90', locked: '10' });
    });
    await test('unknown COMMIT result halts that engine; no automatic retry', async () => {
      const id = await user(), engine = new MatchingEngine(), service = new OrderService(instrument({ unknown: true }), engine, source);
      await assert.rejects(() => buy(service, id, '10'), /commit outcome unknown/);
      assert.equal(await db.order.count({ where: { userId: id } }), 1);
      await assert.rejects(() => buy(new OrderService(db, engine, source), id, '10'), /commit outcome unknown/);
      assert.equal(await db.order.count({ where: { userId: id } }), 1);
    });
    await test('OCO edit decreases BOTH shared hold records; cancelling either returns exactly once', async () => {
      const id = await user(), service = new OrderService(db, new MatchingEngine(), source);
      const oco = await service.placeOcoOrder({ userId: id, pair: 'BTC/USDT', side: 'BUY', quantity: bn('0.2'), takeProfitPrice: bn(80), stopTriggerPrice: bn(120), stopLimitPrice: bn(121) });
      await reserve(id);
      await service.updateConditionalOrder(id, oco.stopOrderId, { triggerPrice: bn(110), price: bn(111) });
      const rows = await db.order.findMany({ where: { ocoGroupId: oco.ocoGroupId } });
      assert.deepEqual(rows.map(r => r.lockedAmount.toString()), ['22.2', '22.2']);
      await Promise.all([service.cancelOrder(id, oco.takeProfitOrderId), service.cancelOrder(id, oco.stopOrderId)]);
      assert.deepEqual(await balance(id), { available: '40', locked: '60' });
    });
    await test('Spot-to-Futures transfer competes safely with reserve', async () => {
      const id = await user();
      const outcomes = await Promise.allSettled([reserve(id), transferWalletBalance(db, id, 'USDT', bn(80), 'TO_FUTURES')]);
      assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
      const spot = await balance(id), futures = await balance(id, 'USDT', 'futuresBalance');
      assert.equal(bn(spot.available).plus(spot.locked).plus(futures.available).toFixed(), '100');
    });
    await test('Futures collateral admission competes safely with transfer to Spot', async () => {
      const id = await user('USDT', '0');
      await db.futuresBalance.create({ data: { userId: id, asset: 'USDT', available: '100', locked: '0' } });
      const outcomes = await Promise.allSettled([
        other.$transaction(tx => mutateFuturesBalance(tx, id, 'USDT', { available: bn(-60), locked: bn(60) }, true)),
        transferWalletBalance(db, id, 'USDT', bn(80), 'TO_SPOT'),
      ]);
      assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
      const spot = await balance(id), futures = await balance(id, 'USDT', 'futuresBalance');
      assert.equal(bn(spot.available).plus(futures.locked).plus(futures.available).toFixed(), '100');
    });
    await test('simultaneous adjustment credits do not overwrite a reserve', async () => {
      const id = await user(), service = new BalanceAdjustmentService(db);
      await Promise.all([reserve(id), ...['10', '20'].map(amount => service.adjust({ userId: id, asset: 'USDT', amount, performedByAdminId: 'fixture-admin', reason: 'fixture' }))]);
      assert.deepEqual(await balance(id), { available: '70', locked: '60' });
    });
    await test('audit failure rolls back withdrawal and balance together', async () => {
      const id = await user();
      const faulty = new WithdrawalService(instrument({ hook: async (m, op, _a, _r, tx) => { if (m === 'auditLog' && op === 'create') await tx.$queryRawUnsafe('SELECT 1/0'); } }));
      await assert.rejects(() => withdraw(id, '30', faulty));
      assert.deepEqual(await balance(id), { available: '100', locked: '0' });
      assert.equal(await db.withdrawal.count({ where: { userId: id } }), 0);
    });
    console.log(`WALLET SAFETY: ${passed} scenarios passed; no production access.`);
  } finally { await db.$disconnect(); await other.$disconnect(); clearTimeout(watchdog); }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
