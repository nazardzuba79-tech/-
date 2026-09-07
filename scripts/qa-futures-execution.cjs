/** Isolated SQL integration regression; NEVER accepts or reads a database URL.
 * Build backend first. Install test tools only under node_modules/.cache/futures-sql:
 * pnpm --dir node_modules/.cache/futures-sql add @electric-sql/pglite@0.5.8 @electric-sql/pglite-socket@0.2.11 --ignore-scripts
 * node scripts/qa-futures-execution.cjs
 * Real compiled services + MatchingEngine + generated Prisma + PostgreSQL/WASM.
 * On Windows, also install @embedded-postgres/windows-x64@18.4.0-beta.17 and pg@8.23.0
 * in that ignored directory, then pass --native for actual multi-backend PostgreSQL.
 * PGlite has one SQL backend; only --native runs the contention/SSI regression.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const BigNumber = require('bignumber.js');
const { PrismaClient } = require('@prisma/client');
const { MatchingEngine } = require('../dist/matching-engine/MatchingEngine');
const { FuturesPositionService } = require('../dist/futures/FuturesPositionService');
const { recoverFuturesOrderBook } = require('../dist/futures/FuturesOrderBookRecovery');
const { auditActiveFuturesOrders } = require('../dist/futures/auditActiveOrders');
const testRequire = createRequire(path.resolve(__dirname, '../node_modules/.cache/futures-sql/package.json'));
const { PGlite } = testRequire('@electric-sql/pglite');
const { PGLiteSocketServer } = testRequire('@electric-sql/pglite-socket');

async function main() {
  const native = process.argv.includes('--native');
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let db, server;
  if (native) {
    const { initdb, postgres, pg_ctl } = testRequire('@embedded-postgres/windows-x64');
    const dataDir = fs.mkdtempSync(path.resolve(__dirname, '../node_modules/.cache/futures-sql/cluster-'));
    const init = spawnSync(initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], { windowsHide: true, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const process = spawn(postgres, ['-D', dataDir, '-h', '127.0.0.1', '-p', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      process.once('error', reject);
      process.once('exit', code => reject(new Error(`Test PostgreSQL exited ${code}`)));
      process.stderr.on('data', chunk => { if (chunk.toString().includes('ready to accept connections')) resolve(); });
    });
    const { Client } = testRequire('pg');
    const client = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
    await client.connect();
    db = { query: sql => client.query(sql), exec: sql => client.query(sql), close: async () => {} };
    server = { stop: async () => {
      await client.end();
      const stop = spawnSync(pg_ctl, ['-D', dataDir, 'stop', '-m', 'fast', '-w'], { windowsHide: true, encoding: 'utf8' });
      assert.equal(stop.status, 0, stop.stderr);
    } };
  } else {
    db = await PGlite.create();
    server = new PGLiteSocketServer({ db, host: '127.0.0.1', port });
    await server.start();
  }
  const migrations = path.resolve(__dirname, '../prisma/migrations');
  for (const dir of fs.readdirSync(migrations).sort()) {
    const sql = path.join(migrations, dir, 'migration.sql');
    if (fs.existsSync(sql)) await db.exec(fs.readFileSync(sql, 'utf8'));
  }
  const prisma = new PrismaClient({ datasources: { db: {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=${native ? 5 : 1}`,
  } } });
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
  const bn = value => new BigNumber(value);
  const serial = value => JSON.parse(JSON.stringify(value));
  const snapshot = async () => serial({
    orders: await prisma.futuresOrder.findMany({ orderBy: { id: 'asc' } }),
    positions: await prisma.futuresPosition.findMany({ orderBy: { id: 'asc' } }),
    balances: await prisma.futuresBalance.findMany({ orderBy: { id: 'asc' } }),
    trades: await prisma.trade.findMany({ orderBy: { id: 'asc' } }),
  });
  const bookState = engine => serial(['BUY', 'SELL'].map(side => engine.getBook('BTC/USDT').getBook(side)));
  async function setup(side = 'LONG', mode = 'ISOLATED', size = '1', leverage = 10) {
    // Only this newly created, in-memory database can be reached by this script.
    await prisma.$executeRawUnsafe('TRUNCATE "Trade", "FuturesOrder", "FuturesPosition", "FuturesBalance", "User" CASCADE');
    for (const id of ['owner', 'counter', 'third']) {
      await prisma.user.create({ data: { id, email: `${id}@futures.invalid`, passwordHash: 'not-a-login', referralCode: id } });
      await prisma.futuresBalance.create({ data: { userId: id, asset: 'USDT', available: '1000000',
        locked: id === 'owner' ? bn(size).times(10000).div(leverage).toString() : '0' } });
    }
    await prisma.futuresPosition.create({ data: { id: 'position', userId: 'owner', symbol: 'BTC/USDT', side,
      size, entryPrice: '10000', leverage, marginType: mode, initialMargin: bn(size).times(10000).div(leverage).toString(),
      liquidationPrice: '9040', status: 'OPEN' } });
    const engine = new MatchingEngine();
    const prints = [];
    const mark = { recordFuturesTrade: (...args) => prints.push(args) };
    const service = new FuturesPositionService(prisma, engine, mark);
    const close = side === 'LONG' ? 'SELL' : 'BUY';
    const open = side === 'LONG' ? 'BUY' : 'SELL';
    const place = (userId, orderSide, quantity, reduceOnly = false, orderLeverage = leverage, price = 10000, type = 'LIMIT') =>
      service.placeOrder({ userId, symbol: 'BTC/USDT', side: orderSide, quantity: bn(quantity), reduceOnly,
        leverage: orderLeverage, price: type === 'LIMIT' ? bn(price) : undefined, type, marginType: mode });
    return { engine, service, prints, place, close, open, mode };
  }
  async function assertBookMatchesDatabase(engine) {
    const rows = await prisma.futuresOrder.findMany({ where: { symbol: 'BTC/USDT', status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } });
    const actual = ['BUY', 'SELL'].flatMap(side => engine.getBook('BTC/USDT').getBook(side))
      .map(o => [o.id, o.status, o.remainingQuantity.toString()]).sort();
    assert.deepEqual(actual, rows.map(o => [o.id, o.status, o.remainingQuantity.toString()]).sort());
  }
  async function assertClosed() {
    assert.equal(await prisma.futuresPosition.count({ where: { userId: 'owner', status: 'OPEN' } }), 0);
    const balance = await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'owner', asset: 'USDT' } } });
    assert.equal(balance.locked.toString(), '0');
    assert.equal(balance.available.toString(), '1001000');
  }
  try {
    console.log((await db.query('SELECT version()')).rows[0].version);
    for (const side of ['LONG', 'SHORT']) for (const mode of ['ISOLATED', 'CROSS']) {
      await test(`${side}/${mode}: two resting RO makers, partial fills, sibling cancellation, no phantom/excess margin`, async () => {
        const s = await setup(side, mode);
        const first = await s.place('owner', s.close, '1', true, 100);
        const second = await s.place('owner', s.close, '1', true, 20);
        const partial = await s.place('counter', s.open, '0.4');
        assert.deepEqual(partial.trades.map(t => t.quantity.toString()), ['0.4']);
        assert.equal((await prisma.futuresOrder.findUnique({ where: { id: first.order.id } })).remainingQuantity.toString(), '0.6');
        assert.equal((await prisma.futuresOrder.findUnique({ where: { id: second.order.id } })).status, 'CANCELLED');
        const final = await s.place('counter', s.open, '1');
        assert.deepEqual(final.trades.map(t => t.quantity.toString()), ['0.6']);
        assert.equal(final.order.remainingQuantity.toString(), '0.4');
        assert.equal(await prisma.trade.count(), 2);
        await assertClosed();
        await assertBookMatchesDatabase(s.engine);
      });
      await test(`${side}/${mode}: legacy RO maker exceeds current position; cap before trade generation`, async () => {
        const s = await setup(side, mode);
        const resting = await s.place('owner', s.close, '1', true);
        await prisma.futuresPosition.update({ where: { id: 'position' }, data: { size: '0.25', initialMargin: '250' } });
        await prisma.futuresBalance.update({ where: { userId_asset: { userId: 'owner', asset: 'USDT' } }, data: { available: '1000750', locked: '250' } });
        const result = await s.place('counter', s.open, '1');
        assert.deepEqual(result.trades.map(t => t.quantity.toString()), ['0.25']);
        const row = await prisma.futuresOrder.findUnique({ where: { id: resting.order.id } });
        assert.equal(row.status, 'CANCELLED'); assert.equal(row.remainingQuantity.toString(), '0.75');
        assert.equal(await prisma.trade.count(), 1);
        await assertClosed();
        await assertBookMatchesDatabase(s.engine);
      });
      await test(`${side}/${mode}: partial RO taker then resting remainder executes safely`, async () => {
        const s = await setup(side, mode);
        await s.place('counter', s.open, '0.4');
        const result = await s.place('owner', s.close, '1', true, 100);
        assert.equal(result.order.status, 'PARTIALLY_FILLED');
        assert.equal(result.order.remainingQuantity.toString(), '0.6');
        const balance = await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'owner', asset: 'USDT' } } });
        assert.equal(balance.locked.toString(), '600');
        await s.place('counter', s.open, '0.6');
        await assertClosed(); await assertBookMatchesDatabase(s.engine);
      });
      await test(`${side}/${mode}: same-direction legacy RO order cancels with zero Trade rows`, async () => {
        const s = await setup(side, mode);
        const resting = await s.place('owner', s.close, '1', true);
        await prisma.futuresPosition.update({ where: { id: 'position' }, data: { side: side === 'LONG' ? 'SHORT' : 'LONG' } });
        const before = serial(await prisma.futuresPosition.findMany());
        assert.equal((await s.place('counter', s.open, '1')).trades.length, 0);
        assert.equal(await prisma.trade.count(), 0);
        assert.deepEqual(serial(await prisma.futuresPosition.findMany()), before);
        assert.equal((await prisma.futuresOrder.findUnique({ where: { id: resting.order.id } })).status, 'CANCELLED');
        await assertBookMatchesDatabase(s.engine);
      });
    }
    await test('legacy RO maker with no open position is cancelled, never opens a position or creates a Trade', async () => {
      const s = await setup();
      const resting = await s.place('owner', 'SELL', '1', true);
      await prisma.futuresPosition.update({ where: { id: 'position' }, data: { status: 'CLOSED', size: '0' } });
      await prisma.futuresBalance.update({ where: { userId_asset: { userId: 'owner', asset: 'USDT' } }, data: { available: '1001000', locked: '0' } });
      const result = await s.place('counter', 'BUY', '1');
      assert.equal(result.trades.length, 0); assert.equal(await prisma.trade.count(), 0);
      assert.equal((await prisma.futuresOrder.findUnique({ where: { id: resting.order.id } })).status, 'CANCELLED');
      await assertClosed(); await assertBookMatchesDatabase(s.engine);
    });
    await test('reduce-only MARKET taker requires full liquidity before any fill or margin change', async () => {
      const s = await setup();
      await s.place('counter', 'BUY', '0.4');
      const before = await snapshot(), originalBook = bookState(s.engine);
      await assert.rejects(s.place('owner', 'SELL', '1', true, 100, 10000, 'MARKET'), /Insufficient market liquidity for requested quantity/);
      assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
      const balance = await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'owner', asset: 'USDT' } } });
      assert.equal(balance.locked.toString(), '1000'); assert.equal(balance.available.toString(), '1000000');
      await assertBookMatchesDatabase(s.engine);
    });
    await test('both counterparties reduce-only: one genuine trade closes both without locking margin', async () => {
      const s = await setup();
      await prisma.futuresPosition.create({ data: { userId: 'counter', symbol: 'BTC/USDT', side: 'SHORT', size: '1',
        entryPrice: '10000', leverage: 10, marginType: 'CROSS', initialMargin: '1000', liquidationPrice: '10960' } });
      await prisma.futuresBalance.update({ where: { userId_asset: { userId: 'counter', asset: 'USDT' } }, data: { locked: '1000' } });
      await s.place('owner', 'SELL', '1', true, 100);
      const result = await s.service.placeOrder({ userId: 'counter', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT',
        price: bn(10000), quantity: bn(1), reduceOnly: true, leverage: 50, marginType: 'CROSS' });
      assert.equal(result.trades.length, 1); assert.equal(await prisma.futuresPosition.count({ where: { status: 'OPEN' } }), 0);
      assert((await prisma.futuresBalance.findMany()).every(b => b.locked.toString() === '0'));
      await assertBookMatchesDatabase(s.engine);
    });
    await test('legacy incompatible maker: REAL SQL rollback preserves every row and original live book', async () => {
      const s = await setup();
      const resting = await s.place('owner', 'BUY', '1');
      await prisma.futuresOrder.update({ where: { id: resting.order.id }, data: { leverage: 50 } });
      const before = await snapshot(), originalBook = bookState(s.engine);
      await assert.rejects(s.place('counter', 'SELL', '1'), /requires 10x/);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(bookState(s.engine), originalBook);
      assert.equal(s.prints.length, 0);
      await s.place('counter', 'SELL', '1', false, 10, 11000);
      assert.equal(s.engine.getBook('BTC/USDT').bestBid().remainingQuantity.toString(), '1');
      await assertBookMatchesDatabase(s.engine);
      // Owner cancellation is the supported repair; no hidden re-margin.
      await s.service.cancelOrder('owner', resting.order.id);
      await s.place('owner', 'BUY', '1', false, 10, 11000);
      assert.equal(await prisma.trade.count(), 1);
      await assertBookMatchesDatabase(s.engine);
    });
    await test('later incompatible maker rolls back an earlier valid fill; next valid taker sees original quantities', async () => {
      const s = await setup();
      await s.place('third', 'BUY', '0.5', false, 10, 10001);
      const legacy = await s.place('owner', 'BUY', '0.5');
      await prisma.futuresOrder.update({ where: { id: legacy.order.id }, data: { leverage: 50 } });
      const before = await snapshot(), originalBook = bookState(s.engine);
      await assert.rejects(s.place('counter', 'SELL', '1'), /requires 10x/);
      assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
      assert.equal(s.prints.length, 0);
      const valid = await s.place('counter', 'SELL', '0.5', false, 10, 10001);
      assert.deepEqual(valid.trades.map(t => t.quantity.toString()), ['0.5']);
      assert.equal(s.engine.getBook('BTC/USDT').bestBid().id, legacy.order.id);
      assert.equal(s.engine.getBook('BTC/USDT').bestBid().remainingQuantity.toString(), '0.5');
      await assertBookMatchesDatabase(s.engine);
    });
    for (const deferred of [false, true]) {
      await test(`SQL-triggered ${deferred ? 'COMMIT' : 'Trade INSERT'} failure discards staging and mark prints`, async () => {
        const s = await setup();
        await s.place('counter', 'BUY', '1');
        const before = await snapshot(), originalBook = bookState(s.engine);
        await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fail_futures_qa() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional futures QA rollback'; END $$`);
        await prisma.$executeRawUnsafe(deferred
          ? `CREATE CONSTRAINT TRIGGER fail_futures_qa AFTER INSERT ON "Trade" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_futures_qa()`
          : `CREATE TRIGGER fail_futures_qa BEFORE INSERT ON "Trade" FOR EACH ROW EXECUTE FUNCTION fail_futures_qa()`);
        await assert.rejects(s.place('owner', 'SELL', '1', true));
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(bookState(s.engine), originalBook);
        assert.equal(s.prints.length, 0);
        await prisma.$executeRawUnsafe('DROP TRIGGER fail_futures_qa ON "Trade"');
        await s.place('owner', 'SELL', '1', true);
        assert.equal(await prisma.trade.count(), 1);
        await assertClosed(); await assertBookMatchesDatabase(s.engine);
      });
    }
    await test('SQL-triggered cancellation failure leaves maker and its reserved margin untouched', async () => {
      const s = await setup();
      const resting = await s.place('counter', 'BUY', '1');
      const before = await snapshot(), originalBook = bookState(s.engine);
      await prisma.$executeRawUnsafe('CREATE TRIGGER fail_futures_qa BEFORE UPDATE ON "FuturesOrder" FOR EACH ROW EXECUTE FUNCTION fail_futures_qa()');
      await assert.rejects(s.service.cancelOrder('counter', resting.order.id));
      assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_futures_qa ON "FuturesOrder"');
      assert.equal((await s.service.cancelOrder('counter', resting.order.id)).status, 'CANCELLED');
      await assertBookMatchesDatabase(s.engine);
      assert.equal((await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'counter', asset: 'USDT' } } })).locked.toString(), '0');
    });
    await test('lost COMMIT acknowledgement resolves from PostgreSQL commit record without replay or duplicate trades', async () => {
      const s = await setup();
      await s.place('counter', 'BUY', '1');
      const ackLoss = {
        $queryRaw: (...args) => prisma.$queryRaw(...args),
        $transaction: async (fn, options) => {
          await prisma.$transaction(fn, options);
          throw new Error('test transport lost acknowledgement AFTER real COMMIT');
        },
      };
      const service = new FuturesPositionService(ackLoss, s.engine, { recordFuturesTrade() {} });
      const result = await service.placeOrder({ userId: 'owner', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT',
        price: bn(10000), quantity: bn(1), reduceOnly: true, leverage: 100, marginType: 'ISOLATED' });
      assert.equal(result.trades.length, 1); assert.equal(await prisma.trade.count(), 1);
      await assertClosed(); await assertBookMatchesDatabase(s.engine);
    });
    await test('two concurrent callers share commit/publication queue; only one consumes a RO maker', async () => {
      const s = await setup();
      await s.place('owner', 'SELL', '1', true);
      const results = await Promise.all([s.place('counter', 'BUY', '1'), s.place('third', 'BUY', '1')]);
      assert.equal(results.reduce((sum, r) => sum + r.trades.length, 0), 1);
      assert.equal(await prisma.trade.count(), 1);
      await assertClosed(); await assertBookMatchesDatabase(s.engine);
    });
    if (native) await test('independent engines/connections contend on advisory lock; stale SERIALIZABLE matcher aborts safely', async () => {
      const s = await setup();
      await s.place('owner', 'SELL', '1', true);
      const otherEngine = new MatchingEngine();
      await recoverFuturesOrderBook(prisma, otherEngine);
      let release, staged;
      const gate = new Promise(resolve => { release = resolve; });
      const stagedReady = new Promise(resolve => { staged = resolve; });
      const heldPrisma = {
        $queryRaw: (...args) => prisma.$queryRaw(...args),
        $transaction: (fn, options) => prisma.$transaction(async tx => {
          const result = await fn(tx); staged(); await gate; return result;
        }, options),
      };
      const held = new FuturesPositionService(heldPrisma, s.engine, { recordFuturesTrade() {} });
      const other = new FuturesPositionService(prisma, otherEngine, { recordFuturesTrade() {} });
      const params = userId => ({ userId, symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT',
        price: bn(10000), quantity: bn(1), leverage: 10, marginType: 'ISOLATED' });
      const first = held.placeOrder(params('counter'));
      await stagedReady;
      const staleBook = bookState(otherEngine);
      const second = other.placeOrder(params('third')).then(result => ({ result }), error => ({ error }));
      let blocked = false;
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          const locks = await prisma.$queryRawUnsafe("SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
          if (locks[0].waiting > 0) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } finally { release(); }
      assert(blocked, 'Second native backend must actually wait on the Futures advisory lock');
      await first;
      const outcome = await second;
      assert(outcome.error, 'Stale serializable transaction must abort, not consume the maker twice');
      assert.deepEqual(bookState(otherEngine), staleBook);
      assert.equal(await prisma.trade.count(), 1);
      await assertClosed();
      // Explicit next request reloads committed DB state, never the stale cache.
      const retry = await other.placeOrder(params('third'));
      assert.equal(retry.trades.length, 0);
      assert.equal(retry.order.remainingQuantity.toString(), '1');
      await assertBookMatchesDatabase(otherEngine);
    });
    if (native) await test('concurrent external position reduction invalidates execution snapshot and rolls back matching safely', async () => {
      const s = await setup();
      await s.place('owner', 'SELL', '1', true);
      let release, read;
      const gate = new Promise(resolve => { release = resolve; });
      const capacityRead = new Promise(resolve => { read = resolve; });
      let intercepted = false;
      const controlled = {
        $queryRaw: (...args) => prisma.$queryRaw(...args),
        $transaction: (fn, options) => prisma.$transaction(tx => fn(new Proxy(tx, { get(target, key) {
          if (key !== 'futuresPosition') return target[key];
          return new Proxy(target.futuresPosition, { get(delegate, method) {
            if (method !== 'findFirst') return delegate[method];
            return async args => {
              const position = await delegate.findFirst(args);
              if (!intercepted && args.where.userId === 'owner') { intercepted = true; read(); await gate; }
              return position;
            };
          } });
        } })), options),
      };
      const service = new FuturesPositionService(controlled, s.engine, { recordFuturesTrade() {} });
      const originalBook = bookState(s.engine);
      const attempt = service.placeOrder({ userId: 'counter', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT',
        price: bn(10000), quantity: bn(1), leverage: 10, marginType: 'ISOLATED' }).then(result => ({ result }), error => ({ error }));
      await capacityRead;
      try {
        await prisma.$transaction(async tx => {
          await tx.futuresPosition.update({ where: { id: 'position' }, data: { size: '0.25', initialMargin: '250' } });
          await tx.futuresBalance.update({ where: { userId_asset: { userId: 'owner', asset: 'USDT' } }, data: { available: '1000750', locked: '250' } });
        });
      } finally { release(); }
      assert((await attempt).error, 'Concurrent position write must abort stale execution');
      assert.deepEqual(bookState(s.engine), originalBook);
      assert.equal(await prisma.trade.count(), 0);
      assert.equal((await prisma.futuresPosition.findUnique({ where: { id: 'position' } })).size.toString(), '0.25');
      const next = await s.place('counter', 'BUY', '1');
      assert.deepEqual(next.trades.map(t => t.quantity.toString()), ['0.25']);
      await assertClosed(); await assertBookMatchesDatabase(s.engine);
    });
    await test('restart recovery is exactly the committed book after partial maker fill', async () => {
      const s = await setup();
      await s.place('owner', 'SELL', '1', true);
      await s.place('counter', 'BUY', '0.4');
      const recovered = new MatchingEngine();
      assert.equal(await recoverFuturesOrderBook(prisma, recovered), 1);
      await assertBookMatchesDatabase(recovered);
      const next = new FuturesPositionService(prisma, recovered, { recordFuturesTrade() {} });
      await next.placeOrder({ userId: 'counter', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT',
        price: bn(10000), quantity: bn('0.6'), leverage: 10, marginType: 'ISOLATED' });
      await assertClosed(); await assertBookMatchesDatabase(recovered);
    });
    await test('aggregate 25k + 25k is accepted; next cent fails with original book/DB unchanged', async () => {
      const s = await setup();
      await s.place('counter', 'BUY', '1', false, 100, 25000);
      await s.place('counter', 'BUY', '1', false, 100, 25000);
      const before = await snapshot(), originalBook = bookState(s.engine);
      await assert.rejects(s.place('counter', 'BUY', '1', false, 100, '0.01'), /resulting exposure is 50x/);
      assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
    });
    await test('pre-release audit detects legacy position/pending mismatches and is SQL-enforced read-only', async () => {
      const s = await setup();
      const first = await s.place('owner', 'BUY', '1');
      await s.place('owner', 'BUY', '1');
      await prisma.futuresOrder.update({ where: { id: first.order.id }, data: { leverage: 50 } });
      const before = await snapshot();
      const issues = await auditActiveFuturesOrders(prisma);
      assert(issues.some(i => i.reason === 'Leverage incompatible with existing position'));
      assert.equal(issues.filter(i => i.reason === 'Incompatible same-side pending leverage').length, 2);
      assert.deepEqual(await snapshot(), before);
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.futuresOrder.update({ where: { id: first.order.id }, data: { leverage: 10 } });
      }));
      assert.deepEqual(await snapshot(), before);
    });
    for (const side of ['BUY', 'SELL']) for (const mode of ['ISOLATED', 'CROSS']) {
      await test(`${side}/${mode}: MARKET sweeps 50k/100k levels with exact 75k notional and 1500 collateral`, async () => {
        const s = await setup('LONG', mode);
        const opposite = side === 'BUY' ? 'SELL' : 'BUY';
        await s.place('owner', opposite, '0.5', false, 10, 50000);
        await s.place('third', opposite, '0.5', false, 10, 100000);
        const result = await s.place('counter', side, '1', false, 50, undefined, 'MARKET');
        assert.equal(result.order.status, 'FILLED'); assert.equal(result.order.remainingQuantity.toString(), '0');
        assert.deepEqual(result.trades.map(t => t.price.toString()), side === 'BUY' ? ['50000', '100000'] : ['100000', '50000']);
        assert.equal(result.trades.reduce((sum, t) => sum.plus(t.quantity.times(t.price)), bn(0)).toString(), '75000');
        const position = await prisma.futuresPosition.findFirst({ where: { userId: 'counter', status: 'OPEN' } });
        const balance = await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'counter', asset: 'USDT' } } });
        assert.equal(position.size.toString(), '1'); assert.equal(position.entryPrice.toString(), '75000');
        assert.equal(position.initialMargin.toString(), '1500'); assert.equal(balance.locked.toString(), '1500');
        assert.equal(balance.available.toString(), '998500');
        await assertBookMatchesDatabase(s.engine);
      });
    }
    await test('MARKET 75k sweep rejects 100x, while best ask alone would allow it; zero persisted changes', async () => {
      const s = await setup();
      await s.place('owner', 'SELL', '0.5', false, 10, 50000);
      await s.place('third', 'SELL', '0.5', false, 10, 100000);
      const before = await snapshot(), originalBook = bookState(s.engine);
      await assert.rejects(s.place('counter', 'BUY', '1', false, 100, undefined, 'MARKET'), /75000.00 USDT resulting exposure is 50x/);
      assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
    });
    await test('MARKET rejects insufficient complete liquidity and insufficient full-depth collateral without writes', async () => {
      const s = await setup();
      await s.place('owner', 'SELL', '0.5', false, 10, 50000);
      let before = await snapshot(), originalBook = bookState(s.engine);
      await assert.rejects(s.place('counter', 'BUY', '1', false, 50, undefined, 'MARKET'), /Insufficient market liquidity/);
      assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
      await s.place('third', 'SELL', '0.5', false, 10, 100000);
      await prisma.futuresBalance.update({ where: { userId_asset: { userId: 'counter', asset: 'USDT' } }, data: { available: '1000' } });
      before = await snapshot(); originalBook = bookState(s.engine);
      await assert.rejects(s.place('counter', 'BUY', '1', false, 50, undefined, 'MARKET'), /Insufficient USDT margin balance/);
      assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
    });
    for (const secondPrice of ['15000', '15000.02']) {
      await test(`existing 40k plus multi-level MARKET increase checks exact 50k boundary (${secondPrice})`, async () => {
        const s = await setup('LONG', 'ISOLATED', '4', 100);
        await s.place('third', 'SELL', '0.5', false, 20, 5000);
        await s.place('counter', 'SELL', '0.5', false, 20, secondPrice);
        const before = await snapshot(), originalBook = bookState(s.engine);
        if (secondPrice === '15000') {
          await s.place('owner', 'BUY', '1', false, 100, undefined, 'MARKET');
          const position = await prisma.futuresPosition.findUnique({ where: { id: 'position' } });
          const balance = await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'owner', asset: 'USDT' } } });
          assert.equal(position.size.toString(), '5'); assert.equal(position.initialMargin.toString(), '500');
          assert.equal(balance.locked.toString(), '500');
        } else {
          await assert.rejects(s.place('owner', 'BUY', '1', false, 100, undefined, 'MARKET'), /50000.01 USDT resulting exposure is 50x/);
          assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
        }
        await assertBookMatchesDatabase(s.engine);
      });
    }
    await test('MARKET flip validates expensive opposite remainder, not blended average price', async () => {
      const s = await setup('SHORT', 'ISOLATED', '0.5', 10);
      await s.place('third', 'SELL', '0.5', false, 20, 10000);
      await s.place('counter', 'SELL', '0.5', false, 20, 120000);
      const before = await snapshot(), originalBook = bookState(s.engine);
      await assert.rejects(s.place('owner', 'BUY', '1', false, 100, undefined, 'MARKET'), /60000.00 USDT resulting exposure is 50x/);
      assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
      await s.place('owner', 'BUY', '1', false, 50, undefined, 'MARKET');
      const position = await prisma.futuresPosition.findFirst({ where: { userId: 'owner', status: 'OPEN' } });
      const balance = await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'owner', asset: 'USDT' } } });
      assert.equal(position.side, 'LONG'); assert.equal(position.size.toString(), '0.5');
      assert.equal(position.initialMargin.toString(), '1200'); assert.equal(balance.locked.toString(), '1200');
    });
    await test('MARKET estimator shares reduce-only sibling capacity and skips stale makers without phantom liquidity', async () => {
      const s = await setup();
      await s.place('owner', 'SELL', '1', true, 100, 50000);
      const sibling = await s.place('owner', 'SELL', '1', true, 100, 60000);
      const before = await snapshot(), originalBook = bookState(s.engine);
      await assert.rejects(s.place('counter', 'BUY', '2', false, 20, undefined, 'MARKET'), /Insufficient market liquidity/);
      assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
      await s.place('third', 'SELL', '1', false, 20, 100000);
      const result = await s.place('counter', 'BUY', '2', false, 20, undefined, 'MARKET');
      assert.deepEqual(result.trades.map(t => t.price.toString()), ['50000', '100000']);
      assert.equal(result.trades.reduce((sum, t) => sum.plus(t.quantity.times(t.price)), bn(0)).toString(), '150000');
      assert.equal((await prisma.futuresOrder.findUnique({ where: { id: sibling.order.id } })).status, 'CANCELLED');
      assert.equal((await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'counter', asset: 'USDT' } } })).locked.toString(), '7500');
      await assertBookMatchesDatabase(s.engine);
    });
    await test('reduce-only MARKET fully closes over two prices with existing leverage and zero new margin', async () => {
      const s = await setup();
      await s.place('third', 'BUY', '0.5', false, 20, 10000);
      await s.place('counter', 'BUY', '0.5', false, 20, 12000);
      const result = await s.place('owner', 'SELL', '1', true, 100, undefined, 'MARKET');
      assert.equal(result.trades.length, 2); assert.equal(result.order.status, 'FILLED');
      assert.equal(await prisma.futuresPosition.count({ where: { userId: 'owner', status: 'OPEN' } }), 0);
      assert.equal((await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'owner', asset: 'USDT' } } })).locked.toString(), '0');
      await assertBookMatchesDatabase(s.engine);
    });
    await test('MARKET storage rounding across multiple fills never exceeds locked collateral', async () => {
      const s = await setup();
      await s.place('owner', 'SELL', '1', false, 10, '0.01');
      await s.place('third', 'SELL', '1', false, 10, '0.01');
      await s.place('counter', 'BUY', '2', false, 6, undefined, 'MARKET');
      const position = await prisma.futuresPosition.findFirst({ where: { userId: 'counter', status: 'OPEN' } });
      const balance = await prisma.futuresBalance.findUnique({ where: { userId_asset: { userId: 'counter', asset: 'USDT' } } });
      assert.equal(position.initialMargin.toString(), '0.003333333333333334');
      assert.equal(balance.locked.toString(), position.initialMargin.toString());
      assert.equal(bn(balance.available.toString()).plus(balance.locked.toString()).toString(), '1000000');
    });
    for (const deferred of [false, true]) {
      await test(`MARKET sweep SQL ${deferred ? 'COMMIT' : 'order INSERT'} failure preserves original DB/book`, async () => {
        const s = await setup();
        await s.place('owner', 'SELL', '0.5', false, 10, 50000);
        await s.place('third', 'SELL', '0.5', false, 10, 100000);
        const before = await snapshot(), originalBook = bookState(s.engine);
        await prisma.$executeRawUnsafe(deferred
          ? `CREATE CONSTRAINT TRIGGER fail_market_qa AFTER INSERT ON "Trade" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_futures_qa()`
          : `CREATE TRIGGER fail_market_qa BEFORE INSERT ON "FuturesOrder" FOR EACH ROW EXECUTE FUNCTION fail_futures_qa()`);
        await assert.rejects(s.place('counter', 'BUY', '1', false, 50, undefined, 'MARKET'));
        assert.deepEqual(await snapshot(), before); assert.deepEqual(bookState(s.engine), originalBook);
        assert.equal(s.prints.length, 0);
        await prisma.$executeRawUnsafe(`DROP TRIGGER fail_market_qa ON "${deferred ? 'Trade' : 'FuturesOrder'}"`);
        assert.equal((await s.place('counter', 'BUY', '1', false, 50, undefined, 'MARKET')).trades.length, 2);
        await assertBookMatchesDatabase(s.engine);
      });
    }
    console.log(`Futures SQL integration: ${passed} cases PASS`);
  } finally {
    await prisma.$disconnect(); await server.stop(); await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
