'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { target, originalSql, snapshot } = require('./stocks613-migration-rehearsal.cjs');
const { healthcheck } = require('../../services/stocks-global/healthcheck.cjs');
test('migration rehearsal refuses missing, remote, production and unconfirmed destinations', () => {
  const previous = { ...process.env };
  try {
    delete process.env.STOCKS_DISPOSABLE_PG_URL;
    process.env.DATABASE_URL = 'postgresql://ignored@127.0.0.1/voltex_stage';
    assert.throws(target, /EXPLICIT_DISPOSABLE_PG_REQUIRED/);
    for (const raw of ['postgresql://x@db/stocks_disposable_infra', 'postgresql://x@127.0.0.1/voltex_stage', 'postgresql://x@127.0.0.1/stocks_disposable_infra']) {
      process.env.STOCKS_DISPOSABLE_PG_URL = raw;
      delete process.env.STOCKS_PG_DISPOSABLE_CONFIRM;
      assert.throws(target, /DISPOSABLE_LOCAL_PG_REQUIRED/);
    }
    process.env.STOCKS_PG_DISPOSABLE_CONFIRM = 'stocks_disposable_infra';
    assert.equal(target().name, 'stocks_disposable_infra');
  } finally { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); }
});
test('only the two original hash-pinned SQL files are accepted', () => {
  for (const name of ['20261016000000_stocks_test_cash_authority', '20261016170000_native_funding_model']) assert.ok(originalSql(name).length > 100);
  assert.throws(() => originalSql('../../unapproved'), /UNAPPROVED_MIGRATION/);
});
test('snapshot detects changed value even with identical row count', async () => {
  let value = '1'; const db = { $queryRawUnsafe: async () => [{ row: value }] };
  const before = await snapshot(db, ['DemoBalance']); value = '2';
  const after = await snapshot(db, ['DemoBalance']);
  assert.equal(before.DemoBalance.count, after.DemoBalance.count);
  assert.notEqual(before.DemoBalance.sha256, after.DemoBalance.sha256);
});
for (const [name, status, body, passes] of [
  ['expected release liveness response', 200, {ok:true,version:2,accounts:true}, true],
  ['dead account worker', 503, {ok:false,version:2,accounts:true}, false],
  ['local ledger process', 200, {ok:true,version:2,accounts:false}, false],
  ['HTML fallback', 200, '<html/>', false],
  ['oversized response', 200, 'x'.repeat(5000), false],
]) test('healthcheck: ' + name, async t => {
  const server = http.createServer((req,res) => { assert.equal(req.url, '/__stocks_global/health'); res.writeHead(status); res.end(typeof body === 'string' ? body : JSON.stringify(body)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  if (passes) await healthcheck(server.address().port); else await assert.rejects(healthcheck(server.address().port));
});
test('healthcheck validates port and bounds time', async t => {
  await assert.rejects(healthcheck(0), /INVALID_PORT/);
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await assert.rejects(healthcheck(server.address().port), /HEALTH_TIMEOUT/);
});
