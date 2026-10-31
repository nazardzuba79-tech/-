// Disposable loopback benchmark for #658 Track A.4: does running Copy Trading
// (50 signed-in readers polling copy state + 2 leaders trading with the copy
// worker on) slow an ordinary crypto request? Measures p95 of GET
// /demo/orders/open for an unrelated probe user, alternating BASELINE and LOAD
// phases so drift affects both equally. Never a production load test.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { randomUUID } = require('node:crypto');
const url = process.env.COPY_INTEGRATION_TEST_DATABASE_URL;
assert(url && /^\/copy_demo_[a-z0-9_]+$/.test(new URL(url).pathname) && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'disposable loopback copy_demo_* database only');
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: 'bench-fixture-only', EMAIL_VERIFICATION_SECRET: 'bench-fixture',
  COPY_DEMO_ENABLED: 'true', COPY_DEMO_ISOLATED_REVIEW: 'true', DEMO_SPOT_ENABLED: 'true' });
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const express = require('express'), jwt = require('jsonwebtoken');
const { MatchingEngine } = require('../src/matching-engine/MatchingEngine');
const { DemoTradingService } = require('../src/services/DemoTradingService');
const { CopyDemoService, copyDemoEnabled } = require('../src/services/copyTrading/CopyDemoService');
const { startCopyDemoWorker } = require('../src/services/copyTrading/copyDemoWorker');
const { copyDemoRouter } = require('../src/api/routes/copyDemo');
const { demoTradingRouter } = require('../src/api/routes/demoTrading');
const db = new PrismaClient({ datasources: { db: { url } } });
const engine = new MatchingEngine(); let copy;
const demo = new DemoTradingService(db, engine, { orderLifecycle: (t, i, e) => copy.orderLifecycle(t, i, e), tradeLifecycle: (t, i) => copy.captureFills(t, i) });
copy = new CopyDemoService(db, engine, demo);
const app = express(); app.use(express.json());
app.use('/api/v1', demoTradingRouter(db, demo, undefined, { enabled: () => true, isSpotPair: async () => true }));
app.use('/api/v1', copyDemoRouter(db, copy));
const PHASE_MS = Number(process.env.BENCH_PHASE_MS || 20000), ROUNDS = Number(process.env.BENCH_ROUNDS || 3);
let port; const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
function call(token, method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null, t0 = process.hrtime.bigint();
    const req = http.request({ host: '127.0.0.1', port, method, path: '/api/v1' + route, agent,
      headers: { Authorization: 'Bearer ' + token, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const p = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
async function main() {
  assert.equal(await db.user.count(), 0, 'empty fixture database only');
  const users = [], tokens = {};
  const make = async (role = 'USER') => {
    const id = randomUUID();
    await db.user.create({ data: { id, email: id + '@example.invalid', passwordHash: 'x', role, referralCode: id.replaceAll('-', '').slice(0, 16) } });
    await db.auditLog.create({ data: { userId: id, action: 'DEMO_BALANCE_ADJUSTED', metadata: { fixture: true } } });
    for (const asset of ['USDT', 'BTC']) await db.demoBalance.create({ data: { userId: id, asset, available: asset === 'USDT' ? '1000000' : '1000' } });
    const s = await db.session.create({ data: { userId: id } });
    tokens[id] = jwt.sign({ sub: id, sid: s.id }, process.env.JWT_SECRET, { expiresIn: '2h' }); users.push(id); return id;
  };
  const leaders = [await make('ADMIN'), await make('ADMIN')], probe = await make();
  for (const [i, traderId] of ['VX-001', 'VX-KSENIA'].entries())
    await db.copyStrategyOwner.upsert({ where: { traderId }, create: { traderId, publicName: 'Fixture', ownerUserId: leaders[i] }, update: { ownerUserId: leaders[i] } });
  const readers = [];
  for (let i = 0; i < 50; i++) readers.push(await make());
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); port = server.address().port;
  for (const [i, r] of readers.entries()) assert.equal((await call(tokens[r], 'PUT', '/copy-trading/demo/subscription',
    { traderId: i % 2 ? 'VX-KSENIA' : 'VX-001', ratio: '0.1', maxOrderUsdt: '100000', maxExposureUsdt: '1000000' })).status, 200);
  const workerErrors = [];
  const stopWorker = startCopyDemoWorker(copy, copyDemoEnabled, e => { workerErrors.push({ at: new Date().toISOString(), code: e?.code ?? String(e).slice(0, 80) }); console.error(e?.code, e?.message?.slice(0, 160)); });
  const probeLoop = async (until, out) => { while (Date.now() < until) { const r = await call(tokens[probe], 'GET', '/demo/orders/open'); assert.equal(r.status, 200); out.push(r.ms); await new Promise(x => setTimeout(x, 50)); } };
  const load = async until => {
    const tasks = readers.map(async (r, i) => { await new Promise(x => setTimeout(x, (i * 60) % 3000));
      while (Date.now() < until) { await call(tokens[r], 'GET', '/copy-trading/demo'); await new Promise(x => setTimeout(x, 3000)); } });
    tasks.push(...leaders.map(async (l, i) => { let n = 0; await new Promise(x => setTimeout(x, i * 2000));
      while (Date.now() < until) {
        const res = await call(tokens[l], 'POST', '/demo/orders', { pair: 'BTC/USDT', side: n++ % 2 ? 'SELL' : 'BUY', type: 'LIMIT', quantity: '0.01', price: n % 2 ? '100' : '101', requestId: randomUUID() });
        assert.ok([200, 201].includes(res.status), 'leader order ' + res.status);
        await new Promise(x => setTimeout(x, 4000)); } }));
    await Promise.all(tasks);
  };
  const result = { baseline: [], load: [] };
  for (let round = 0; round < ROUNDS; round++) {
    for (const phase of round % 2 ? ['load', 'baseline'] : ['baseline', 'load']) {
      const until = Date.now() + PHASE_MS, samples = [];
      await Promise.all([probeLoop(until, samples), phase === 'load' ? load(until) : Promise.resolve()]);
      result[phase].push(...samples);
      console.log(round, phase, 'n', samples.length, 'p50', p(samples, .5).toFixed(2), 'p95', p(samples, .95).toFixed(2));
    }
  }
  // Let the copy worker finish the source orders already placed, then stop it.
  const settleUntil = Date.now() + 60000;
  while (Date.now() < settleUntil && await db.copyDemoExecution.count({ where: { status: 'PENDING' } })) await new Promise(x => setTimeout(x, 500));
  stopWorker(); await new Promise(x => setTimeout(x, 3000)); server.close(); agent.destroy();
  const pending = await db.copyDemoExecution.count({ where: { status: 'PENDING' } });
  const executed = await db.copyDemoExecution.count({ where: { status: 'EXECUTED' } });
  const b95 = p(result.baseline, .95), l95 = p(result.load, .95);
  const report = { probe: 'GET /demo/orders/open', phaseMs: PHASE_MS, rounds: ROUNDS, samples: { baseline: result.baseline.length, load: result.load.length },
    p95ms: { baseline: +b95.toFixed(2), load: +l95.toFixed(2) }, p50ms: { baseline: +p(result.baseline, .5).toFixed(2), load: +p(result.load, .5).toFixed(2) },
    deltaP95Percent: +(100 * (l95 - b95) / b95).toFixed(1), copiedOrdersExecuted: executed, pendingAfterSettle: pending, workerErrors, readers: 50, traders: 2,
    note: 'single-process loopback API and local PostgreSQL; not representative of production hardware' };
  const out = path.resolve('output/copy-integration-658'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'bench.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
