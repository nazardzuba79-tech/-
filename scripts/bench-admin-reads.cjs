/* Real HTTP + Prisma + disposable loopback PostgreSQL. No production URL is read. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output/admin-practicality');
fs.mkdirSync(out, { recursive: true });
const qa = createRequire(path.resolve(process.env.QA_MODULES_DIR || path.join(root, 'node_modules/.cache/deposit-qa'), 'package.json'));
const bin = qa(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
const { Client } = qa('pg');
process.env.JWT_SECRET = 'isolated-admin-benchmark-fixture-no-production';
delete process.env.PRIVATE_TRADING_OWNER_ID;
process.env.EMAIL_VERIFICATION_SECRET = 'isolated-admin-benchmark-fixture-no-production';
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const express = require('express');
const jwt = require('jsonwebtoken');
const { adminUsersRouter } = require('../src/api/routes/adminUsers');
const { adminRouter } = require('../src/api/routes/admin');
const { adminAuditLogRouter } = require('../src/api/routes/adminAuditLog');
const { adminDepositsRouter } = require('../src/api/routes/adminDeposits');
const { adminWithdrawalsRouter } = require('../src/api/routes/adminWithdrawals');
const selectedScenarios = process.env.ADMIN_BENCH_SCENARIOS?.split(',').filter(Boolean);
const reportName = process.env.ADMIN_BENCH_REPORT || (selectedScenarios ? 'admin-read-benchmark-supplement.json' : 'admin-read-benchmark.json');
assert.match(reportName, /^[a-z0-9-]+\.json$/, 'Report must be a simple filename within output/admin-practicality');
const repetitions = Number(process.env.ADMIN_BENCH_REPETITIONS || 30);
assert.ok(Number.isInteger(repetitions) && repetitions >= 30, 'At least 30 repetitions are required');
const sizes = [40, 1000, 10000];
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * q) - 1)];
const stats = xs => ({ median: quantile(xs, 0.5), p95: quantile(xs, 0.95), min: Math.min(...xs), max: Math.max(...xs) });
const command = (exe, args, options = {}) => {
  const r = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8', ...options });
  if (r.status !== 0) throw new Error(r.stderr || `Local command failed (${r.status})`);
  return r;
};
async function read(port, route, auth) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/api/v1' + route, headers: { Authorization: auth }, agent: false }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const bytes = Buffer.concat(chunks); let body;
        try { body = JSON.parse(bytes.toString()); } catch { return reject(new Error('Non-JSON fixture response')); }
        if (res.statusCode !== 200) return reject(new Error(`Fixture ${route} returned ${res.statusCode}: ${JSON.stringify(body)}`));
        resolve({ bytes: bytes.length, body });
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('Fixture HTTP timeout'))); req.on('error', reject);
  });
}
async function seed(sql, count) {
  await sql.query('TRUNCATE "User", "AuditLog" CASCADE');
  await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") VALUES ('fixture-admin','admin@example.invalid','fixture-only','fixture-admin','ADMIN','APPROVED',now(),now())`);
  await sql.query(`INSERT INTO "User" (id,email,"passwordHash","referralCode",role,"kycStatus","createdAt","updatedAt") SELECT 'u'||lpad(i::text,5,'0'),'user'||i||'@example.invalid','fixture-only','fixture-'||i,'USER',CASE WHEN i%4=0 THEN 'PENDING'::"KycStatus" ELSE 'APPROVED'::"KycStatus" END,now()-i*interval '1 minute',now() FROM generate_series(1,$1::int) i`, [count]);
  await sql.query(`INSERT INTO "Balance" (id,"userId",asset,available,locked,"updatedAt") SELECT u.id||'-b-'||a,u.id,a,1000.123456789123456789,12.125,now() FROM "User" u CROSS JOIN unnest(ARRAY['USDT','BTC','ETH']) a WHERE u.role='USER'`);
  await sql.query(`INSERT INTO "Session" (id,"userId","createdAt","lastSeenAt") SELECT u.id||'-s-'||s,u.id,now()-s*interval '1 hour',now() FROM "User" u CROSS JOIN generate_series(1,5) s WHERE u.role='USER'`);
  await sql.query(`INSERT INTO "KycSubmission" (id,"userId",country,"fullName","dateOfBirth","documentType",status,"createdAt") SELECT u.id||'-k-'||k,u.id,'UA','Fixture person',date '1990-01-01','PASSPORT',CASE WHEN k=3 THEN u."kycStatus"::text ELSE 'REJECTED' END,now()-(4-k)*interval '1 day' FROM "User" u CROSS JOIN generate_series(1,3) k WHERE u.role='USER'`);
  await sql.query(`INSERT INTO "Order" (id,"userId",pair,side,type,price,"originalQuantity","remainingQuantity",status,"createdAt","updatedAt") SELECT u.id||'-o-'||o,u.id,'BTC/USDT','BUY','LIMIT',85000,0.01,0,'FILLED',now()-o*interval '1 minute',now() FROM "User" u CROSS JOIN generate_series(1,20) o WHERE u.role='USER'`);
  await sql.query(`INSERT INTO "FuturesOrder" (id,"userId",symbol,side,type,price,"originalQuantity","remainingQuantity",status,leverage,"marginType","createdAt","updatedAt") SELECT u.id||'-fo-'||o,u.id,'BTC/USDT','BUY','LIMIT',85000,0.01,0,'FILLED',10,'CROSS',now()-o*interval '1 minute',now() FROM "User" u CROSS JOIN generate_series(1,3) o WHERE u.role='USER'`);
  await sql.query(`INSERT INTO "FuturesPosition" (id,"userId",symbol,side,size,"entryPrice",leverage,"marginType","initialMargin","liquidationPrice",status,"realizedPnl","openedAt","updatedAt") SELECT u.id||'-fp-'||p,u.id,'BTC/USDT','LONG',0.01,85000,10,'CROSS',85,76500,CASE WHEN p=1 THEN 'OPEN' ELSE 'CLOSED' END,0,now()-p*interval '1 minute',now() FROM "User" u CROSS JOIN generate_series(1,3) p WHERE u.role='USER'`);
  await sql.query(`INSERT INTO "CfdPosition" (id,"userId",symbol,side,size,"entryPrice",leverage,"initialMargin","liquidationPrice",status,"realizedPnl","openedAt","updatedAt") SELECT u.id||'-cp-'||p,u.id,'XAUUSD','LONG',1,2500,10,250,2250,CASE WHEN p=1 THEN 'OPEN' ELSE 'CLOSED' END,0,now()-p*interval '1 minute',now() FROM "User" u CROSS JOIN generate_series(1,3) p WHERE u.role='USER'`);
  await sql.query(`INSERT INTO "Deposit" (id,"userId",chain,asset,"txHash",amount,status,"createdAt") SELECT u.id||'-d-'||d,u.id,'tron','USDT',u.id||'-tx-'||d,500,'CREDITED',now()-d*interval '1 day' FROM "User" u CROSS JOIN generate_series(1,5) d WHERE u.role='USER'`);
  await sql.query(`INSERT INTO "Withdrawal" (id,"userId",asset,network,"toAddress",amount,status,"createdAt","updatedAt") SELECT u.id||'-w-'||w,u.id,'USDT','tron','fixture-address',20,'SENT',now()-w*interval '1 day',now() FROM "User" u CROSS JOIN generate_series(1,5) w WHERE u.role='USER'`);
  await sql.query(`INSERT INTO "AuditLog" (id,"userId",action,metadata,"createdAt") SELECT u.id||'-a-'||a,u.id,'FIXTURE_HISTORY','{"performedByAdminId":"fixture-admin","delta":"1.25"}'::jsonb,now()-a*interval '1 minute' FROM "User" u CROSS JOIN generate_series(1,20) a WHERE u.role='USER'`);
  // A large single history proves access beyond the legacy hard cap.
  await sql.query(`INSERT INTO "Deposit" (id,"userId",chain,asset,"txHash",amount,status,"createdAt") SELECT 'history-'||i,'u00001','tron','USDT','history-tx-'||i,1,'CREDITED',now()-i*interval '1 hour' FROM generate_series(1,120) i`);
  await sql.query(`INSERT INTO "Deposit" (id,"userId",chain,asset,"txHash",amount,status,confirmations,"verifiedAt",finalized,"createdAt") SELECT 'pending-'||u.id,u.id,'tron','USDT','pending-tx-'||u.id,500,'PENDING',30,now(),true,now() FROM "User" u WHERE u.role='USER' AND substring(u.id from 2)::int%50=0`);
  await sql.query('ANALYZE');
}
async function integrity(sql) {
  return (await sql.query(`SELECT (SELECT count(*)::int FROM "User") users,(SELECT count(*)::int FROM "Order") orders,(SELECT count(*)::int FROM "Deposit") deposits,(SELECT sum(available)::text FROM "Balance") available,(SELECT sum(locked)::text FROM "Balance") locked,(SELECT sum(amount)::text FROM "Deposit") deposit_amount,(SELECT sum(amount)::text FROM "Withdrawal") withdrawal_amount,(SELECT count(*)::int FROM "AuditLog") audit,(SELECT count(*)::int FROM "FuturesOrder") futures_orders,(SELECT count(*)::int FROM "FuturesPosition") futures_positions,(SELECT count(*)::int FROM "CfdPosition") cfd_positions,(SELECT sum("realizedPnl")::text FROM "FuturesPosition") futures_pnl,(SELECT sum("realizedPnl")::text FROM "CfdPosition") cfd_pnl`)).rows[0];
}
async function main() {
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening'); const dbPort = probe.address().port; await new Promise(r => probe.close(r));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-admin-read-bench-')), data = path.join(folder, 'data');
  let sql, prisma, server;
  const report = { generatedAt: new Date().toISOString(), postgres: '18.4 (embedded, independently verified)', repetitions, sizes,
    boundary: 'Disposable 127.0.0.1 PostgreSQL with synthetic records only; no production URLs, users or financial writes.',
    modes: { cold: 'Prisma connection disconnected before each measured HTTP request; database/OS cache is NOT flushed.', warm: 'Same Prisma connection, one unmeasured warm-up before 30 requests.' },
    metrics: { httpMs: 'End-to-end localhost HTTP including auth and JSON serialization, no frontend render', sqlMs: 'Sum of Prisma query duration events (millisecond resolution)', bytes: 'Uncompressed JSON bytes', rows: 'Response items; DOM/React measurements are separate browser QA' }, results: [], integrity: [] };
  command(bin.initdb, ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  command(bin.pg_ctl, ['-D', data, '-l', path.join(folder, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${dbPort}`, 'start', '-w'], { stdio: 'ignore' });
  try {
    sql = new Client({ host: '127.0.0.1', port: dbPort, user: 'postgres', database: 'postgres' }); await sql.connect();
    await sql.query('CREATE DATABASE voltex_admin_read_bench'); await sql.end();
    sql = new Client({ host: '127.0.0.1', port: dbPort, user: 'postgres', database: 'voltex_admin_read_bench' }); await sql.connect();
    for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
      const file = path.join(root, 'prisma/migrations', name, 'migration.sql'); if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
    }
    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:${dbPort}/voltex_admin_read_bench?connection_limit=1&sslmode=disable` } }, log: [{ emit: 'event', level: 'query' }] });
    let queryEvents = []; prisma.$on('query', e => queryEvents.push({ duration: e.duration }));
    const app = express();
    app.use((req, res, next) => req.method === 'GET' ? next() : res.status(405).end());
    const prices = { getTicker: async pair => ({ pair, lastPrice: pair.startsWith('BTC') ? '85000' : '1' }) };
    app.use('/api/v1', adminUsersRouter(prisma, {}), adminRouter(prisma), adminAuditLogRouter(prisma), adminDepositsRouter(prisma, prices), adminWithdrawalsRouter(prisma));
    app.use((err, _req, res, _next) => res.status(503).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
    const auth = `Bearer ${jwt.sign({ sub: 'fixture-admin' }, process.env.JWT_SECRET)}`;
    const allScenarios = [
      ['users-before', '/admin/users'], ['users-after', '/admin/users/page'],
      ['users-last-login', '/admin/users/page?sort=lastLoginAt'],
      ['detail-before', '/admin/users/u00001'], ['profile-after', '/admin/users/u00001/profile'],
      ['history-after', '/admin/users/u00001/history?kind=deposits&page=6'],
      ['kyc-before', '/admin/clients'], ['kyc-after', '/admin/clients/page'],
      ['kyc-date-after', '/admin/clients/page?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z'],
      ['audit-before', '/admin/audit-log'], ['audit-after', '/admin/audit-log/page'],
      ['audit-email-after', '/admin/audit-log/page?search=user1%40example.invalid'],
      ['activity-before', '/admin/user-activity'], ['summary-after', '/admin/work-summary'],
      ['withdrawals-before', '/admin/withdrawals'], ['withdrawals-after', '/admin/withdrawals/page'],
      ['futures-orders-after', '/admin/users/u00001/history?kind=futuresOrders'],
      ['futures-positions-after', '/admin/users/u00001/history?kind=futuresPositions'],
      ['cfd-positions-after', '/admin/users/u00001/history?kind=cfdPositions'],
    ];
    assert.ok(!selectedScenarios || selectedScenarios.every(name => allScenarios.some(([scenario]) => scenario === name)), 'Unknown selected benchmark scenario');
    const scenarios = selectedScenarios ? allScenarios.filter(([name]) => selectedScenarios.includes(name)) : allScenarios;
    for (const size of sizes) {
      await seed(sql, size); const before = await integrity(sql);
      assert.equal((await read(port, '/admin/audit-log/page?search=user1%40example.invalid', auth)).body.total, 20, 'Audit search must find the target email');
      assert.equal((await read(port, '/admin/audit-log/page?search=admin%40example.invalid', auth)).body.total, size * 20, 'Audit search must find the acting admin email');
      assert.equal((await read(port, '/admin/audit-log/page?search=%25', auth)).body.total, 0, 'Audit search treats percent as a literal');
      const boundary = new Date(Date.now() - 36 * 3_600_000).toISOString();
      assert.equal((await read(port, '/admin/clients/page?from=2000-01-01T00:00:00Z&to=' + encodeURIComponent(boundary), auth)).body.total, 0, 'Older KYC submissions must not match the latest-submission date filter');
      assert.equal((await read(port, '/admin/clients/page?from=' + encodeURIComponent(boundary), auth)).body.total, size, 'Latest KYC submission filter omitted customers');
      for (const sort of ['createdAt', 'lastLoginAt']) assert.equal((await read(port, '/admin/users/page?search=%25&sort=' + sort, auth)).body.total, 0, 'Search wildcard must remain literal');
      for (const [scenario, route] of scenarios) for (const mode of ['cold', 'warm']) {
        const runs = []; if (mode === 'warm') await read(port, route, auth);
        for (let i = 0; i < repetitions; i++) {
          if (mode === 'cold') await prisma.$disconnect(); queryEvents = [];
          const start = performance.now(); const r = await read(port, route, auth); const ms = performance.now() - start;
          const rows = Array.isArray(r.body) ? r.body.length : Array.isArray(r.body.items) ? r.body.items.length : null;
          if (route.includes('/page') || scenario === 'history-after') assert.ok(rows <= 20, 'Paged response exceeded 20 rows');
          if (scenario === 'history-after') assert.equal(r.body.total, 125);
          if (scenario === 'profile-after') assert.equal(r.body.deposits, undefined);
          if (scenario === 'summary-after') assert.equal(r.body.widgets.totalUsers.value, size);
          runs.push({ httpMs: ms, sqlMs: queryEvents.reduce((s, q) => s + q.duration, 0), sqlCount: queryEvents.length, bytes: r.bytes, rows });
        }
        const result = { size, scenario, mode, n: runs.length, httpMs: stats(runs.map(x => x.httpMs)), sqlMs: stats(runs.map(x => x.sqlMs)), sqlCount: stats(runs.map(x => x.sqlCount)), bytes: stats(runs.map(x => x.bytes)), rows: runs[0].rows };
        report.results.push(result); fs.writeFileSync(path.join(out, reportName), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ size, scenario, mode, n: runs.length, httpMedianMs: result.httpMs.median.toFixed(2), httpP95Ms: result.httpMs.p95.toFixed(2), queries: result.sqlCount.median, bytes: result.bytes.median, rows: result.rows }));
      }
      const after = await integrity(sql); assert.deepEqual(after, before, 'Read benchmark changed financial/history data'); report.integrity.push({ size, unchanged: true, totals: after });
    }
    report.completedAt = new Date().toISOString(); report.totalRequests = report.results.reduce((s, x) => s + x.n, 0);
    fs.writeFileSync(path.join(out, reportName), JSON.stringify(report, null, 2));
    console.log(`COMPLETE: ${report.totalRequests} measured real HTTP requests; all fixture balances/history unchanged.`);
  } finally {
    if (server) await new Promise(r => server.close(r)); await prisma?.$disconnect(); await sql?.end().catch(() => {});
    command(bin.pg_ctl, ['-D', data, 'stop', '-m', 'fast', '-w'], { stdio: 'ignore' });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
