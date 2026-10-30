'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {parseLog, statementKind, profile, markdown} = require('./pg-profile-613.cjs');

// Lines exactly as PostgreSQL 16 wrote them with diagnostic-run-613.cjs --pg-profile's settings (local capture:
// a Stocks-named session holds the DemoBalance row FOR UPDATE, a crypto-named UPDATE waits for it).
const LOG = `2026-10-28 17:33:35.296 UTC [7291] [unknown] LOG:  connection authorized: user=stocks_fixture database=stocks_disposable_rc50_abcdef123456_mixed application_name=rc50_stocks_authority
2026-10-28 17:33:35.316 UTC [7293] [unknown] LOG:  connection authorized: user=stocks_fixture database=stocks_disposable_rc50_abcdef123456_mixed application_name=rc50_crypto_api
2026-10-28 17:33:35.318 UTC [7293] rc50_crypto_api LOG:  process 7293 still waiting for ShareLock on transaction 732 after 1.069 ms
2026-10-28 17:33:35.318 UTC [7293] rc50_crypto_api DETAIL:  Process holding the lock: 7291. Wait queue: 7293.
2026-10-28 17:33:35.318 UTC [7293] rc50_crypto_api CONTEXT:  while updating tuple (0,1) in relation "DemoBalance"
2026-10-28 17:33:35.318 UTC [7293] rc50_crypto_api STATEMENT:  UPDATE "DemoBalance" SET v=v+1 WHERE id=1;
2026-10-28 17:33:35.358 UTC [7291] rc50_stocks_authority LOG:  duration: 60.355 ms  statement: SELECT pg_sleep(0.06)
2026-10-28 17:33:35.359 UTC [7293] rc50_crypto_api LOG:  process 7293 acquired ShareLock on transaction 732 after 41.782 ms
2026-10-28 17:33:35.359 UTC [7293] rc50_crypto_api CONTEXT:  while updating tuple (0,1) in relation "DemoBalance"
2026-10-28 17:33:35.359 UTC [7293] rc50_crypto_api STATEMENT:  UPDATE "DemoBalance" SET v=v+1 WHERE id=1;
2026-10-28 17:33:35.360 UTC [7293] rc50_crypto_api LOG:  duration: 42.817 ms  statement: UPDATE "DemoBalance" SET v=v+1 WHERE id=1;
2026-10-28 17:33:36.100 UTC [7293] rc50_crypto_api LOG:  duration: 3.000 ms  statement: COMMIT
`;

test('parses connections, a lock wait with its holder and relation, and statement durations', () => {
  const log = parseLog(LOG);
  assert.deepEqual(log.pids.get(7293), {database: 'stocks_disposable_rc50_abcdef123456_mixed', app: 'crypto'});
  assert.deepEqual(log.pids.get(7291).app, 'stocks');
  assert.equal(log.waits.length, 1);
  const w = log.waits[0];
  assert.deepEqual([w.pid, w.mode, w.holders, w.relation, w.ms], [7293, 'ShareLock', [7291], 'DemoBalance', 41.782]);
  assert.ok(Math.abs(w.end - w.start - 41.782) < 1e-3);
  assert.deepEqual(log.statements.map(s => [s.pid, s.ms, s.kind]), [[7291, 60.355, 'SELECT'], [7293, 42.817, 'UPDATE DemoBalance'], [7293, 3, 'COMMIT']]);
  assert.equal(statementKind('SELECT "id" FROM "DemoBalance" WHERE "userId"=$1 FOR UPDATE'), 'SELECT DemoBalance FOR UPDATE');
  assert.equal(statementKind('INSERT INTO "public"."DemoOrder" ("id") VALUES ($1)'), 'INSERT DemoOrder');
  assert.throws(() => parseLog(LOG.replaceAll(' UTC ', ' CET ')), /PG_LOG_TIMEZONE_NOT_UTC/);
});

test('attributes the slow crypto request to the lock held by the Stocks process', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-profile-')), out = path.join(dir, 'after-1', 'out');
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'postgres-profile.log'), LOG);
  const startedAt = '2026-10-28T17:33:35.300Z';
  // 19 crypto requests (the slowest is the p95): one spans the wait (17:33:35.310-.362), the rest are fast and later.
  const samples = [{requestId: 'm-1', kind: 'crypto', op: 'place-limit', index: null, status: 201, ms: 52, at: 10}];
  for (let i = 0; i < 18; i++) samples.push({requestId: 'm-' + (i + 2), kind: 'crypto', op: 'open', index: null, status: 200, ms: 2, at: 2000 + i * 100});
  samples.push({requestId: 't-1', kind: 'trader', op: 'submit-buy', index: 0, status: 200, ms: 30, at: 0});
  fs.writeFileSync(path.join(out, 'mixed-result.json'), JSON.stringify({startedAt, samples}));
  fs.writeFileSync(path.join(out, 'mixed-pg-stats.json'), JSON.stringify({before: {wal: {wal_sync: 10, wal_sync_time: 5}, database: {xact_commit: 1}}, after: {wal: {wal_sync: 15, wal_sync_time: 9.5}, database: {xact_commit: 4}}}));
  const [run] = profile([out]), mixed = run.arms.mixed;
  assert.equal(run.arms.baseline, null);
  assert.equal(mixed.slowRequests, 1);
  assert.deepEqual(mixed.rates.slowest5, {lockWait: 100, lockWaitOnStocks: 100, slowStatement: 100, slowCommit: 0, stocksStatement: 100, checkpointOrVacuum: 0, trader0: 100, trader0Command: 100});
  assert.equal(mixed.rates.all.lockWaitOnStocks, 5.3);
  assert.deepEqual([mixed.cryptoLockWaits.count, mixed.cryptoLockWaits.onStocksHolder, mixed.cryptoLockWaits.relations], [1, 1, ['DemoBalance']]);
  assert.deepEqual([mixed.wal.syncs, mixed.wal.syncMs, mixed.wal.commits], [5, 4.5, 3]);
  assert.ok(mixed.pgTimeShareOfSlowRequests > 99);
  assert.match(markdown([run]), /\| mixed \| 52 \| 5\.3 \/ 100 \| 5\.3 \/ 100 \|/);
});
