import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseConfig, principalsDigest } from './release-config.mjs';

const issuer = 'synthetic-release-fixture';
const principals = ['synthetic-a', 'synthetic-b'].map(subject => ({ issuer, subject }));
const base = {
  STOCKS_IDENTITY_ISSUER: issuer,
  STOCKS_TEST_CASH_GATEWAY_KEY: 'synthetic-release-key-never-used-outside-tests',
  STOCKS_TRADE_PRINCIPALS: JSON.stringify(principals),
};
const root = fileURLToPath(new URL('../../', import.meta.url));
async function port() {
  const s = net.createServer();
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  const p = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return p;
}
async function launch(t, changes, expected, script = 'release-entrypoint.mjs') {
  assert.equal(process.versions.node, '22.23.3');
  const dir = await mkdtemp(join(tmpdir(), 'stocks-release-'));
  t.after(() => rmdir(dir));
  const p = await port();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(STOCKS_|DATABASE_URL$|DIRECT_URL$|NODE_OPTIONS$|JWT_SECRET$)/.test(key)));
  Object.assign(env, base, { NODE_ENV: 'production', STOCKS_GLOBAL_PORT: String(p) }, changes(dir));
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const child = spawn(process.execPath, [join(root, 'services/stocks-global', script)], { env, cwd: dir, windowsHide: true });
  let out = '', err = '';
  child.stdout.on('data', data => out += data);
  child.stderr.on('data', data => err += data);
  t.after(() => child.kill());
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('STARTUP_DID_NOT_FAIL_CLOSED')); }, 10000);
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.notEqual(result, 0);
  assert.match(err, expected);
  assert.doesNotMatch(out, /LISTENING|local preview/);
  assert.ok(!err.includes(base.STOCKS_TEST_CASH_GATEWAY_KEY));
  assert.deepEqual(await readdir(dir), [], 'no SQLite, JSON ledger or other files created');
  await new Promise((resolve, reject) => {
    const socket = net.connect(p, '127.0.0.1');
    socket.on('connect', () => { socket.destroy(); reject(Error('RELEASE_PORT_OPEN')); });
    socket.on('error', resolve);
  });
}
test('release rejects wrong Node and duplicate/foreign principals', () => {
  const env = { ...base, STOCKS_TEST_CASH_AUTHORITY_URL: 'http://127.0.0.1:1/api/v1/stocks-test-cash' };
  assert.throws(() => releaseConfig(env, '24.22.0'), /NODE_VERSION/);
  for (const p of [[principals[0],principals[0]], [principals[0], {...principals[1],issuer:'other'}]]) {
    assert.throws(() => releaseConfig({...env,STOCKS_TRADE_PRINCIPALS:JSON.stringify(p)},'22.23.3'), /PRINCIPALS_INVALID/);
  }
});
for (const [name, changes, error] of [
  ['missing authority', () => ({}), /AUTHORITY_REQUIRED/],
  ['malformed authority', () => ({STOCKS_TEST_CASH_AUTHORITY_URL:'not-a-url'}), /AUTHORITY_REQUIRED/],
  ['credentialed authority', () => ({STOCKS_TEST_CASH_AUTHORITY_URL:'https://user:secret@example.invalid/api/v1/stocks-test-cash'}), /AUTHORITY_INVALID/],
  ['SQLite only', dir => ({STOCKS_ACCOUNTS_DATA:join(dir,'ledger.sqlite')}), /LEGACY_FORBIDDEN/],
  ['JSON only', dir => ({STOCKS_GLOBAL_DATA:join(dir,'ledger.json')}), /LEGACY_FORBIDDEN/],
  ['mixed PG and SQLite', dir => ({STOCKS_TEST_CASH_AUTHORITY_URL:'http://127.0.0.1:1/api/v1/stocks-test-cash',STOCKS_ACCOUNTS_DATA:join(dir,'ledger.sqlite')}), /LEGACY_FORBIDDEN/],
  ['legacy opt-in', () => ({STOCKS_LEGACY_SINGLE_OWNER_REVIEW:'false'}), /LEGACY_FORBIDDEN/],
  ['unavailable authority', () => ({STOCKS_TEST_CASH_AUTHORITY_URL:'http://127.0.0.1:1/api/v1/stocks-test-cash'}), /AUTHORITY_UNREADY/],
]) test(name + ' fails before listening or ledger creation', t => launch(t, changes, error));

for (const [name, status, body] of [
  ['404/default-off authority',404,{error:'NOT_FOUND'}],
  ['SQLite capability',200,{version:1,authority:'sqlite',issuer,principalsDigest:principalsDigest(principals)}],
  ['different principal binding',200,{version:1,authority:'postgres',issuer,principalsDigest:'0'.repeat(64)}],
]) test(name + ' is rejected by real subprocess', async t => {
  let calls = 0;
  const server = http.createServer((req,res) => {
    calls++;
    assert.equal(req.url, '/api/v1/stocks-test-cash/readiness');
    assert.equal(req.method, 'GET');
    res.writeHead(status, {'Content-Type':'application/json'}).end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => {server.closeAllConnections();server.close();});
  await launch(t, () => ({STOCKS_TEST_CASH_AUTHORITY_URL:`http://127.0.0.1:${server.address().port}/api/v1/stocks-test-cash`}), /AUTHORITY_UNREADY/);
  assert.equal(calls, 1, 'no retry storm or fallback');
});
test('legacy executable cannot be a production entrypoint', t => launch(t,
  dir => ({STOCKS_GLOBAL_DATA:join(dir,'ledger.json'),STOCKS_LEGACY_SINGLE_OWNER_REVIEW:'true'}),
  /STOCKS_RELEASE_ENTRYPOINT_REQUIRED/, 'server.mjs'));
