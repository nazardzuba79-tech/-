/** Real HTTP/Prisma transaction tests against a newly initialized loopback PostgreSQL.
 * No production URL is read. Does not modify a shared generated Prisma client.
 */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net'), http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const qa = createRequire(path.resolve(root, process.env.ADMIN_QA_DEPS || '../admin-deletion-qa-deps/package.json'));
const out = path.join(root, 'output/admin-practicality'); fs.mkdirSync(out, { recursive: true });
process.env.JWT_SECRET = 'isolated-admin-balance-adjustment-test-only';
process.env.EMAIL_VERIFICATION_SECRET = 'isolated-admin-balance-adjustment-fixture-only';
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { adminBalanceAdjustmentsRouter } = require('../src/api/routes/adminBalanceAdjustments');
const express = require('express'), jwt = require('jsonwebtoken');
const checks = [];
const run = (file, args, stdio) => spawnSync(file, args, { windowsHide: true, encoding: 'utf8', stdio });
async function port() { const server = net.createServer().listen(0, '127.0.0.1'); await once(server, 'listening'); const value = server.address().port; await new Promise(r => server.close(r)); return value; }
const body = key => ({ asset: 'USDT', amount: '10', reason: 'Изолированная проверка корректировки', idempotencyKey: key });
let origin;
function api(route, payload, actor = 'qa-admin-1', drop = false) {
  return new Promise((resolve, reject) => {
    const data = payload === undefined ? undefined : JSON.stringify(payload);
    const req = http.request(`${origin}${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(actor ? { Authorization: `Bearer ${jwt.sign({ sub: actor }, process.env.JWT_SECRET)}` } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(drop ? { 'X-Fixture-Drop-Response': 'yes' } : {}) } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => { let result; try { result = JSON.parse(Buffer.concat(chunks).toString()); } catch { return reject(new Error('Non-JSON test response')); } resolve({ status: res.statusCode, body: result }); });
    });
    req.setTimeout(15000, () => req.destroy(new Error('Local test request timeout'))); req.on('error', reject); if (data) req.write(data); req.end();
  });
}
async function main() {
  const bin = qa(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-admin-adjustment-qa-')), 'data');
  const dbPort = await port(); const init = run(bin.initdb, ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']); assert.equal(init.status, 0, init.stderr);
  const fd = fs.openSync(path.join(out, 'balance-postgres-control.log'), 'w'); let start;
  try { start = run(bin.pg_ctl, ['-D', dir, '-l', path.join(out, 'balance-postgres.log'), '-o', `-h 127.0.0.1 -p ${dbPort}`, 'start', '-w'], ['ignore', fd, fd]); } finally { fs.closeSync(fd); }
  assert.equal(start.status, 0);
  let sql, prisma, server;
  try {
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port: dbPort, user: 'postgres', database: 'postgres' }); await sql.connect(); await sql.query('CREATE DATABASE voltex_admin_adjustment_test'); await sql.end();
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port: dbPort, user: 'postgres', database: 'voltex_admin_adjustment_test' }); await sql.connect();
    for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) { const file = path.join(root, 'prisma/migrations', name, 'migration.sql'); if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8')); }
    await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") VALUES ('qa-admin-1','admin1@example.invalid','fixture-only','qa-admin-1','ADMIN','APPROVED',now(),now()),('qa-admin-2','admin2@example.invalid','fixture-only','qa-admin-2','ADMIN','APPROVED',now(),now()),('qa-user-1','user1@example.invalid','fixture-only','qa-user-1','USER','APPROVED',now(),now()),('qa-user-2','user2@example.invalid','fixture-only','qa-user-2','USER','APPROVED',now(),now())`);
    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${dbPort}/voltex_admin_adjustment_test?connection_limit=12&sslmode=disable` } } });
    await prisma.balance.create({ data: { userId: 'qa-user-1', asset: 'USDT', available: '100', locked: '7' } });
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { if (req.headers['x-fixture-drop-response'] === 'yes') res.json = () => { res.socket.destroy(); return res; }; next(); });
    app.get('/health', (_, res) => res.json({ ok: true }));
    app.use('/api/v1', adminBalanceAdjustmentsRouter(prisma));
    app.use((error, req, res, next) => res.status(500).json({ error: 'Synthetic server error' }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); origin = `http://127.0.0.1:${server.address().port}`;
    const route = '/api/v1/admin/users/qa-user-1/balance-adjustments';
    const balance = async () => { const row = await prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: 'qa-user-1', asset: 'USDT' } } }); return { available: row.available.toString(), locked: row.locked.toString() }; };
    async function check(name, fn) { await fn(); checks.push({ name, passed: true }); }
    await check('401 and 403 refuse writes', async () => { assert.equal((await api(route, body(randomUUID()), null)).status, 401); assert.equal((await api(route, body(randomUUID()), 'qa-user-1')).status, 403); assert.equal(await prisma.auditLog.count(), 0); });
    const firstKey = randomUUID(); let firstReceipt;
    await check('20 concurrent duplicate requests produce one delta and one receipt', async () => { const results = await Promise.all(Array.from({ length: 20 }, () => api(route, body(firstKey)))); results.forEach(r => assert.equal(r.status, 200)); firstReceipt = results[0].body; results.forEach(r => assert.deepEqual(r.body, firstReceipt)); assert.deepEqual(await balance(), { available: '110', locked: '7' }); assert.equal(await prisma.auditLog.count({ where: { id: firstKey } }), 1); assert.equal(firstReceipt.availableBefore, '100'); });
    await check('different keys on same wallet serialize atomic increments', async () => { const results = await Promise.all(Array.from({ length: 8 }, () => api(route, { ...body(randomUUID()), amount: '1.125' }))); results.forEach(r => assert.equal(r.status, 200)); assert.deepEqual(await balance(), { available: '119', locked: '7' }); });
    await check('same key after later changes returns original before/after receipt', async () => { const result = await api(route, { ...body(firstKey), amount: '+10.0000' }); assert.equal(result.status, 200); assert.deepEqual(result.body, firstReceipt); assert.deepEqual(await balance(), { available: '119', locked: '7' }); });
    await check('changed amount/reason/asset/actor/target with same key returns 409 without mutation', async () => { for (const extra of [{ amount: '11' }, { reason: 'Different reason' }, { asset: 'ETH' }]) assert.equal((await api(route, { ...body(firstKey), ...extra })).status, 409); assert.equal((await api(route, body(firstKey), 'qa-admin-2')).status, 409); assert.equal((await api(route.replace('qa-user-1', 'qa-user-2'), body(firstKey))).status, 409); assert.deepEqual(await balance(), { available: '119', locked: '7' }); assert.equal(await prisma.balance.count({ where: { userId: 'qa-user-2' } }), 0); });
    await check('GET receipt is bound to administrator and target', async () => { const found = await api(`${route}/${firstKey}`); assert.equal(found.status, 200); assert.deepEqual(found.body, firstReceipt); assert.equal((await api(`${route}/${firstKey}`, undefined, 'qa-admin-2')).status, 404); assert.equal((await api(`${route.replace('qa-user-1', 'qa-user-2')}/${firstKey}`)).status, 404); assert.equal((await api(`${route}/${firstKey}`, undefined, 'qa-user-1')).status, 403); });
    await check('lost HTTP response after commit recovers with original key without second delta', async () => { const key = randomUUID(); await assert.rejects(api(route, body(key), 'qa-admin-1', true)); const receipt = await api(`${route}/${key}`); assert.equal(receipt.status, 200); assert.equal(receipt.body.available, '129'); const retried = await api(route, body(key)); assert.deepEqual(retried.body, receipt.body); assert.deepEqual(await balance(), { available: '129', locked: '7' }); assert.equal(await prisma.auditLog.count({ where: { id: key } }), 1); });
    await check('signed debit preserves locked and records exact before/after', async () => { const result = await api(route, { ...body(randomUUID()), amount: '-9.125' }); assert.equal(result.status, 200); assert.equal(result.body.availableBefore, '129'); assert.deepEqual(await balance(), { available: '119.875', locked: '7' }); });
    await check('insufficient funds, excess precision, zero, malformed UUID, test asset reject without receipt', async () => { const count = await prisma.auditLog.count(); for (const change of [{ amount: '-1000' }, { amount: '0.0000000000000000001' }, { amount: '0' }, { idempotencyKey: 'not-uuid' }, { asset: 'VTA' }]) assert.equal((await api(route, { ...body(randomUUID()), ...change })).status, 400); assert.equal(await prisma.auditLog.count(), count); assert.deepEqual(await balance(), { available: '119.875', locked: '7' }); });
    await check('failed audit insertion rolls back delta; process remains healthy', async () => { const key = randomUUID(); await sql.query(`CREATE FUNCTION qa_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${key}' THEN RAISE EXCEPTION 'isolated receipt failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_reject_receipt_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION qa_reject_receipt()`); assert.equal((await api(route, body(key))).status, 500); assert.deepEqual(await balance(), { available: '119.875', locked: '7' }); assert.equal(await prisma.auditLog.count({ where: { id: key } }), 0); assert.equal((await api('/health')).status, 200); await sql.query('DROP TRIGGER qa_reject_receipt_trigger ON "AuditLog"; DROP FUNCTION qa_reject_receipt()'); const replay = await api(route, body(key)); assert.equal(replay.status, 200); assert.deepEqual(await balance(), { available: '129.875', locked: '7' }); });
    const report = { database: 'disposable loopback PostgreSQL', checks: checks.length, passed: checks, finalBalance: await balance(), receipts: await prisma.auditLog.count(), stoppedAfter: true };
    fs.writeFileSync(path.join(out, 'balance-adjustment-postgres.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); await prisma?.$disconnect(); await sql?.end().catch(() => {});
    const stop = run(bin.pg_ctl, ['-D', dir, 'stop', '-m', 'fast', '-w']); assert.equal(stop.status, 0, stop.stderr);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
