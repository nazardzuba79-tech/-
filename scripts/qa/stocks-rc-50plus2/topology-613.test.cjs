'use strict';
// #613 topology contract, no workload: both pins run the same runtime, one as a single process and one as
// the separated release layout; the workers refuse unknown topologies, roles and malformed shared material.
const test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), fs = require('node:fs');
const before = require('./policy-613.cjs'), after = require('./policy-613-after.cjs');

test('both pins name the same runtime commit; only the process topology differs', () => {
  assert.match(before.RC, /^[0-9a-f]{40}$/);
  assert.equal(after.RC, before.RC, 'exact-head comparison: same runtime in both kinds');
  assert.equal(before.TOPOLOGY, 'single-process');
  assert.equal(after.TOPOLOGY, 'separated');
  const runner = fs.readFileSync(path.join(__dirname, 'diagnostic-run-613.cjs'), 'utf8');
  assert.match(runner, /require\(AFTER\?'\.\/policy-613-after\.cjs':'\.\/policy-613\.cjs'\)/);
  assert.match(runner, /TOPOLOGY_MISMATCH_/);
});

function ask(file, messages) {
  return new Promise((resolve, reject) => {
    const child = cp.fork(path.join(__dirname, file), [], {stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--require', path.join(__dirname, 'network-guard.cjs')]});
    const replies = [];let next = 0;
    const timer = setTimeout(() => { child.kill(); reject(Error('NO_REPLY')); }, 10000);
    child.on('message', m => { replies.push(m.error ?? m.value); if (replies.length === messages.length) { clearTimeout(timer); child.kill(); resolve(replies); } else child.send({id: ++next, ...messages[next - 1]}); });
    child.send({id: ++next, ...messages[0]});
  });
}
const db = 'stocks_disposable_rc50_abcdef123456_mixed', dbUrl = 'postgresql://stocks_fixture@127.0.0.1:32101/' + db;

test('the API worker refuses an unknown topology or arm before loading any runtime', async () => {
  const replies = await ask('api-worker.cjs', [{command: 'init', value: {dbUrl, dbName: db, topology: 'shared-cpu', arm: 'mixed'}}]);
  assert.deepEqual(replies, ['TOPOLOGY_OR_ARM_UNKNOWN']);
  assert.deepEqual(await ask('api-worker.cjs', [{command: 'init', value: {dbUrl, dbName: db, topology: 'separated', arm: 'warmup'}}]), ['TOPOLOGY_OR_ARM_UNKNOWN']);
});

test('a Stocks worker takes one known role, loopback-only endpoints and complete shared material', async () => {
  const shared = {issuer: 'rc50', principals: [{issuer: 'rc50', subject: 'a'}, {issuer: 'rc50', subject: 'b'}], gatewayKey: 'k'.repeat(32)};
  assert.deepEqual(await ask('stocks-worker.cjs', [{command: 'init', value: {role: 'ledger'}}, {command: 'init', value: {role: 'gateway'}}]), ['STOCKS_PROCESS_ROLE_UNKNOWN', 'STOCKS_PROCESS_SINGLE_INIT']);
  assert.deepEqual(await ask('stocks-worker.cjs', [{command: 'init', value: {role: 'gateway', shared: {...shared, gatewayKey: 'short'}, endpoint: 'http://127.0.0.1:32100/api/v1/stocks-test-cash'}}]), ['STOCKS_PROCESS_SHARED_INVALID']);
  assert.deepEqual(await ask('stocks-worker.cjs', [{command: 'init', value: {role: 'gateway', shared, endpoint: 'https://example.com/api/v1/stocks-test-cash'}}]), ['EXPLICIT_EPHEMERAL_LOOPBACK_REQUIRED']);
  assert.deepEqual(await ask('stocks-worker.cjs', [{command: 'init', value: {role: 'authority', shared, dbUrl, dbName: db}}]), ['STOCKS_PROCESS_SHARED_INVALID'], 'the authority needs the API worker\'s secret');
  assert.deepEqual(await ask('stocks-worker.cjs', [{command: 'init', value: {role: 'authority', shared: {...shared, secret: 's'.repeat(40)}, dbUrl: 'postgresql://root@example.com:5432/' + db, dbName: db}}]), ['OWN_FRESH_SYNTHETIC_DATABASE_REQUIRED']);
});
