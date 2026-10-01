/**
 * PRE-IMPLEMENTATION DIAGNOSTIC, not a production-readiness test.
 * Runs unmodified services against a NEW disposable loopback PostgreSQL cluster.
 * Exit 2 means a financial safety blocker was reproduced; exit 1 is harness failure.
 * Does not load .env, accept a database URL, migrate production, or start the app.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const qa = createRequire(path.join(root, 'node_modules/.cache/deposit-qa/package.json'));

function cleanEnvironment() {
  // No inherited database URLs, tokens, provider configuration, or dotenv hooks.
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, NODE_ENV: 'test', PRISMA_HIDE_UPDATE_MESSAGE: 'true', CHECKPOINT_DISABLE: '1' };
}

async function parent() {
  if (!['--verify','--otc','--preservation','--baseline'].includes(process.argv[2])) {
    throw new Error('Choose --verify, --otc or --preservation. --baseline reproduces the OLD implementation and is only valid at diagnostic commit 88d77ea; never run it as a current safety test.');
  }
  const bin = qa(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-otc-safety-'));
  const data = path.join(folder, 'data');
  const env = cleanEnvironment();
  const init = spawnSync(bin.initdb, ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], {
    windowsHide: true, encoding: 'utf8', env,
  });
  if (init.status !== 0) throw new Error(init.stderr || 'Disposable initdb failed');
  const start = spawnSync(bin.pg_ctl, ['-D', data, '-l', path.join(folder, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, 'start', '-w'], {
    windowsHide: true, stdio: 'ignore', env,
  });
  if (start.status !== 0) throw new Error('Disposable PostgreSQL startup failed');
  let sql;
  try {
    const Client = qa('pg').Client;
    sql = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
    await sql.connect();
    const database = process.argv.includes('--preservation') ? 'voltex_nrx_test' : 'voltex_otc_safety_test';
    await sql.query(`CREATE DATABASE ${database}`);
    await sql.end();
    sql = new Client({ host: '127.0.0.1', port, user: 'postgres', database });
    await sql.connect();
    const migrations = path.join(root, 'prisma/migrations');
    for (const name of fs.readdirSync(migrations).sort()) {
      const file = path.join(migrations, name, 'migration.sql');
      if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
    }
    console.log('LOCAL PostgreSQL:', (await sql.query('SHOW server_version')).rows[0].server_version);
    console.log('LOCAL isolation:', (await sql.query('SHOW default_transaction_isolation')).rows[0].default_transaction_isolation);
    // Generate the current schema into a unique cache; never overwrite another worktree's client.
    const cache = fs.mkdtempSync(path.join(root, 'node_modules/.cache/otc-safety-'));
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')
      .replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "./client"');
    fs.writeFileSync(path.join(cache, 'schema.prisma'), schema);
    const url = `postgresql://postgres@127.0.0.1:${port}/${database}`;
    const generated = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'generate', '--schema', path.join(cache, 'schema.prisma')], {
      cwd: cache, env: { ...env, DATABASE_URL: url, DIRECT_URL: url }, windowsHide: true, encoding: 'utf8',
    });
    if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout || 'Isolated Prisma generation failed');
    const entry = process.argv.includes('--preservation') ? path.join(__dirname, 'test-wallet-preservation-postgres.cjs')
      : process.argv.includes('--otc') ? path.join(__dirname, 'test-otc-cash-postgres.cjs')
      : process.argv.includes('--verify') ? path.join(__dirname, 'test-wallet-safety-postgres.cjs') : __filename;
    const child = spawnSync(process.execPath, [entry, '--local-child'], {
      cwd: root, windowsHide: true, stdio: 'inherit', timeout: 180000,
      env: { ...env, OTC_DIAGNOSTIC_URL: url, OTC_DIAGNOSTIC_CLIENT: path.join(cache, 'client'), TS_NODE_PROJECT: path.join(root, 'tsconfig.json') },
    });
    process.exitCode = child.status ?? 1;
  } finally {
    await sql?.end().catch(() => {});
    const stopped = spawnSync(bin.pg_ctl, ['-D', data, 'stop', '-m', 'fast', '-w'], { windowsHide: true, stdio: 'ignore', env });
    if (stopped.status !== 0) throw new Error('Local PostgreSQL shutdown failed');
    console.log('Disposable PostgreSQL stopped. No production access. Temporary evidence retained:', folder);
  }
}

async function child() {
  const watchdog = setTimeout(() => { console.error('LOCAL DIAGNOSTIC TIMEOUT'); process.exit(1); }, 60000);
  const url = new URL(process.env.OTC_DIAGNOSTIC_URL || '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/voltex_otc_safety_test');
  assert.ok(url.port);
  // The child has no provider secrets/config. All fetch attempts are errors, not live API calls.
  global.fetch = async () => { throw new Error('External network forbidden in OTC diagnostic'); };
  require('ts-node/register/transpile-only');
  const { PrismaClient } = require(process.env.OTC_DIAGNOSTIC_CLIENT);
  const { WithdrawalService } = require('../src/services/WithdrawalService');
  const { OrderService } = require('../src/services/OrderService');
  const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
  const BigNumber = require('bignumber.js');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const other = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const priceSource = { getTicker: async () => { throw new Error('External prices forbidden'); } };
  const findings = [];
  const mark = (name, evidence) => { findings.push(name); console.log('BLOCKER REPRODUCED:', name, JSON.stringify(evidence)); };
  const gate = (count = 1) => {
    let arrivedResolve, resumeResolve;
    const arrived = new Promise(resolve => { arrivedResolve = resolve; });
    const resume = new Promise(resolve => { resumeResolve = resolve; });
    return { arrived, release: () => resumeResolve(), wait: async () => { if (--count === 0) arrivedResolve(); await resume; } };
  };
  // Scheduling instrumentation only: every service query executes against real PostgreSQL.
  // No mocked balances, transaction result, ledger, order book, or status values.
  function instrument(hook, options = {}) {
    return new Proxy(db, { get(target, key) {
      if (key !== '$transaction') {
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      }
      return callback => target.$transaction(async tx => callback(new Proxy(tx, { get(t, model) {
        const value = t[model];
        if (['balance', 'order', 'withdrawal', 'trade'].includes(model)) return new Proxy(value, { get(delegate, operation) {
          const fn = delegate[operation];
          if (typeof fn !== 'function') return fn;
          return async args => { const result = await fn.call(delegate, args); await hook(model, operation, args, result); return result; };
        } });
        return typeof value === 'function' ? value.bind(t) : value;
      } })), { maxWait: 10000, timeout: 30000, ...options });
    } });
  }
  async function user(asset = 'USDT', available = '100') {
    const id = randomUUID();
    await db.user.create({ data: { id, email: `${id}@fixture.invalid`, passwordHash: 'NOT_A_REAL_PASSWORD_HASH', referralCode: id } });
    await db.balance.create({ data: { userId: id, asset, available, locked: '0' } });
    return id;
  }
  const balance = async (userId, asset = 'USDT') => {
    const b = await db.balance.findUniqueOrThrow({ where: { userId_asset: { userId, asset } } });
    return { available: b.available.toString(), locked: b.locked.toString() };
  };
  async function reserveFixture(userId, amount = '60') {
    // A hypothetical correct OTC writer: owned hold + guarded atomic debit, same tx.
    // Test-only table, not an implemented OTC API or production migration.
    return other.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Balance" WHERE "userId"=${userId} AND asset='USDT' FOR UPDATE`;
      const n = await tx.$executeRaw`UPDATE "Balance" SET available=available-${amount}::numeric, locked=locked+${amount}::numeric
        WHERE "userId"=${userId} AND asset='USDT' AND available>=${amount}::numeric`;
      assert.equal(n, 1);
      await tx.$executeRaw`INSERT INTO "FixtureOtcReserve" (id,"userId",amount) VALUES (${randomUUID()},${userId},${amount}::numeric)`;
    });
  }
  const buy = (service, userId, amount) => service.placeOrder({ userId, pair: 'BTC/USDT', type: 'LIMIT', side: 'BUY', price: new BigNumber('100'), quantity: new BigNumber(amount).div(100) });
  try {
    await db.$executeRawUnsafe('CREATE TABLE "FixtureOtcReserve" (id text PRIMARY KEY, "userId" text NOT NULL, amount numeric(36,18) NOT NULL)');
    // 1. A held withdrawal overwrites even a committed, explicitly row-locked reserve.
    {
      const id = await user(), pause = gate();
      const service = new WithdrawalService(instrument(async (model, op) => { if (model === 'balance' && op === 'findUnique') await pause.wait(); }));
      const pending = service.requestWithdrawal({ userId: id, asset: 'USDT', network: 'FIXTURE', toAddress: 'NOT_A_REAL_ADDRESS', amount: '80' });
      await pause.arrived;
      await reserveFixture(id);
      assert.deepEqual(await balance(id), { available: '40', locked: '60' });
      pause.release();
      const withdrawal = await pending;
      assert.equal(withdrawal.status, 'PENDING');
      assert.deepEqual(await balance(id), { available: '20', locked: '80' });
      mark('withdrawal overwrites OTC-owned reserve', { initial: '100', reserve: '60', withdrawal: '80', ...await balance(id), obligations: '140' });
    }
    // 2. The real Spot placement has the same stale available/locked overwrite.
    {
      const id = await user(), pause = gate(), engine = new MatchingEngine();
      const service = new OrderService(instrument(async (m, op) => { if (m === 'balance' && op === 'findUnique') await pause.wait(); }), engine, priceSource);
      const pending = buy(service, id, '80');
      await pause.arrived; await reserveFixture(id); pause.release();
      const result = await pending;
      assert.equal(result.order.status, 'OPEN');
      assert.deepEqual(await balance(id), { available: '20', locked: '80' });
      assert.ok(engine.getBook('BTC/USDT').bestBid());
      mark('Spot placement overwrites OTC-owned reserve', { initial: '100', reserve: '60', orderHold: '80', ...await balance(id), obligations: '140' });
    }
    // 3. Merely fixing balance arithmetic does not fix double release from stale order status.
    {
      const id = await user(), engine = new MatchingEngine(), pause = gate(2);
      const original = new OrderService(db, engine, priceSource);
      const placed = await buy(original, id, '30');
      await reserveFixture(id);
      assert.deepEqual(await balance(id), { available: '10', locked: '90' });
      const service = new OrderService(instrument(async (m, op) => { if (m === 'order' && op === 'findUnique') await pause.wait(); }), engine, priceSource);
      const first = service.cancelOrder(id, placed.order.id), second = service.cancelOrder(id, placed.order.id);
      await pause.arrived; pause.release();
      assert.ok((await Promise.all([first, second])).every(Boolean));
      assert.deepEqual(await balance(id), { available: '70', locked: '30' });
      assert.equal((await db.order.findUniqueOrThrow({ where: { id: placed.order.id } })).status, 'CANCELLED');
      mark('two Spot cancellations release another obligation', { initial: '100', reserveStillOwned: '60', singleOrderHold: '30', ...await balance(id) });
    }
    // 4. Withdrawal rejection also lacks a once-only guarded state transition.
    {
      const id = await user(), pauses = [gate(), gate()];
      const original = new WithdrawalService(db);
      const withdrawal = await original.requestWithdrawal({ userId: id, asset: 'USDT', network: 'FIXTURE', toAddress: 'NOT_A_REAL_ADDRESS', amount: '30' });
      await reserveFixture(id);
      const services = pauses.map(pause => new WithdrawalService(instrument(async (m, op) => { if (m === 'withdrawal' && op === 'findUnique') await pause.wait(); })));
      const args = { withdrawalId: withdrawal.id, performedByAdminId: 'fixture-admin' };
      const first = services[0].rejectWithdrawal(args), second = services[1].rejectWithdrawal(args);
      await Promise.all(pauses.map(p => p.arrived));
      // Both saw PENDING, but the second reads Balance only after the first commits.
      pauses[0].release(); await first; pauses[1].release(); await second;
      assert.deepEqual(await balance(id), { available: '70', locked: '30' });
      mark('two withdrawal rejections release another obligation', { reserveStillOwned: '60', singleWithdrawalHold: '30', ...await balance(id) });
    }
    // 5. Counterexample to a tempting narrow fix: SERIALIZABLE only on Spot txs.
    // A real concurrent credit creates a PostgreSQL serialization abort after matching.
    // Source is unchanged; isolation override is applied ONLY to this diagnostic case.
    {
      const buyer = await user(), seller = await user('BTC', '1'), engine = new MatchingEngine(), pause = gate();
      const plain = new OrderService(db, engine, priceSource);
      const maker = await plain.placeOrder({ userId: seller, pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber('80'), quantity: new BigNumber('1') });
      const service = new OrderService(instrument(async (m, op) => { if (m === 'trade' && op === 'create') await pause.wait(); }, { isolationLevel: 'Serializable' }), engine, priceSource);
      const pending = service.placeOrder({ userId: buyer, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('80'), quantity: new BigNumber('1') })
        .then(value => ({ value }), error => ({ error }));
      await pause.arrived;
      await other.balance.update({ where: { userId_asset: { userId: seller, asset: 'BTC' } }, data: { available: { increment: '1' } } });
      pause.release();
      const result = await pending;
      assert.equal(result.error?.code, 'P2034');
      assert.equal(await db.trade.count({ where: { takerUserId: buyer } }), 0);
      assert.equal(await db.order.count({ where: { userId: buyer } }), 0);
      const saved = await db.order.findUniqueOrThrow({ where: { id: maker.order.id } });
      assert.equal(saved.status, 'OPEN'); assert.equal(saved.remainingQuantity.toString(), '1');
      assert.equal(engine.getBook('BTC/USDT').bestAsk(), undefined);
      assert.deepEqual(await balance(buyer), { available: '100', locked: '0' });
      mark('naive Serializable fix diverges Spot book from database', { error: result.error.code, makerDatabaseStatus: saved.status, makerDatabaseRemaining: '1', makerInBook: false, tradeRows: 0, takerRows: 0 });
    }
    console.log(`RESULT: BLOCKED (${findings.length} deterministic reproductions). These are NOT passing safety tests.`);
    process.exitCode = 2;
  } finally {
    await db.$disconnect(); await other.$disconnect();
    clearTimeout(watchdog);
  }
}

(process.argv[2] === '--local-child' ? child() : parent()).catch(error => {
  console.error('LOCAL DIAGNOSTIC FAILURE:', error.stack || error.message); process.exitCode = 1;
});
