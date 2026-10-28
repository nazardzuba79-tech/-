const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto'), net = require('node:net'), path = require('node:path');
const { fixture, disposableUrl } = require('./testing/disposable-postgres.cjs');

// #613 P1, the real release chain on PostgreSQL: the compiled authority process (dist/stocksAuthority.js,
// default private quota 240/min) and the release gateway, 50 synthetic viewers at one request per
// second and the 2 synthetic traders every 4 s (the 50+2 cadence) for a full minute. Every gateway request is
// still identity-checked live (one Session read per request), yet the private ingress sees a bounded number of
// requests and never answers 429. Afterwards, on the same running processes: a forged token, a sign-out, a
// contact block, an admin block and an account switch each take effect on the very next request.
const root = path.resolve(__dirname, '../..'), authorityEntry = path.join(root, 'dist/stocksAuthority.js');
const counter = path.join(__dirname, 'testing/count-requests.cjs');
const VIEWERS = 50, LOAD_MS = 61000, QUOTA = 240;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(STOCKS_|DATABASE_URL$|DIRECT_URL$|NODE_OPTIONS$|JWT_SECRET$)/.test(key)));
async function start(t, args, env, ready) {
  const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', stdout = '';
  child.stderr.on('data', data => stderr += data); child.stdout.on('data', data => stdout += data);
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('START_TIMEOUT ' + stderr)), 8000);
    child.once('exit', code => { clearTimeout(timer); reject(Error('EXIT ' + code + ' ' + stderr)); });
    const check = () => { if (stdout.includes(ready)) { clearTimeout(timer); child.stdout.off('data', check); resolve(); } };
    child.stdout.on('data', check);
  });
  // The private listener's own record of every request it served (testing/count-requests.cjs).
  child.requestLog = async () => {
    const from = stdout.length; child.kill('SIGUSR2');
    for (let i = 0; i < 200; i++) {
      const line = stdout.slice(from).split('\n').find(row => row.startsWith('REQUEST_LOG ') && stdout.slice(from).includes(row + '\n'));
      if (line) return JSON.parse(line.slice('REQUEST_LOG '.length));
      await sleep(25);
    }
    throw Error('REQUEST_LOG_TIMEOUT');
  };
  return child;
}
const quantile = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : null; };
const busiestMinute = log => { let best = 0; for (let i = 0, j = 0; j < log.length; j++) { while (log[j][0] - log[i][0] >= 60000) i++; best = Math.max(best, j - i + 1); } return best; };

test('50 viewers and 2 traders for a full minute stay inside the private authority quota; sign-out, block and account switch apply at the next request', {
  timeout: 180000, skip: disposableUrl() ? false : 'NOT_RUN: disposable PostgreSQL required',
}, async t => {
  assert.equal(process.versions.node, '22.23.3');
  assert.equal(process.env.STOCKS_PG_COMPILED_ROUTER, 'true');
  const f = await fixture(t), jwt = require('jsonwebtoken');
  const before = await f.rows();
  const viewers = [];
  for (let i = 0; i < VIEWERS; i++) {
    const id = `synthetic-stock-viewer-${i}-${crypto.randomUUID()}`;
    await f.other.user.create({ data: { id, email: id + '@example.invalid', passwordHash: 'synthetic-no-password-login', referralCode: crypto.randomBytes(10).toString('hex') } });
    const session = await f.other.session.create({ data: { userId: id } });
    viewers.push({ id, session: session.id, email: id + '@example.invalid', token: jwt.sign({ sub: id, sid: session.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) });
  }
  const env = { ...clean(), NODE_ENV: 'production', DATABASE_URL: f.target.raw, JWT_SECRET: process.env.JWT_SECRET,
    STOCKS_TEST_CASH_ENABLED: 'true', STOCKS_CATALOGUE_ENABLED: 'true', STOCKS_ORDER_EXECUTION_ENABLED: 'true',
    STOCKS_IDENTITY_ISSUER: f.issuer, STOCKS_TRADE_PRINCIPALS: JSON.stringify(f.principals), STOCKS_TEST_CASH_GATEWAY_KEY: f.gatewayKey };
  // The default private quota (no STOCKS_AUTHORITY_REQUESTS_PER_MINUTE): nothing is raised for this test.
  const authorityPort = await freePort();
  const authority = await start(t, ['--require', counter, authorityEntry], { ...env, STOCKS_AUTHORITY_INTERNAL_PORT: String(authorityPort) }, 'STOCKS_AUTHORITY_LISTENING ' + authorityPort);
  const endpoint = `http://127.0.0.1:${authorityPort}/api/v1/stocks-test-cash`;
  const gatewayPort = await freePort();
  // The release gateway (testing/synthetic-release-gateway.mjs: release-entrypoint.mjs with a synthetic market, so
  // the traders' commands run without any outbound request).
  await start(t, [path.join(__dirname, 'testing/synthetic-release-gateway.mjs')], { ...clean(), NODE_ENV: 'production', STOCKS_TEST_CASH_AUTHORITY_URL: endpoint,
    STOCKS_IDENTITY_ISSUER: f.issuer, STOCKS_TEST_CASH_GATEWAY_KEY: f.gatewayKey, STOCKS_TRADE_PRINCIPALS: JSON.stringify(f.principals),
    STOCKS_GLOBAL_PORT: String(gatewayPort) }, 'STOCKS_RELEASE_LISTENING ' + gatewayPort);
  const gateway = `http://127.0.0.1:${gatewayPort}/__stocks_global/`;
  const state = async token => {
    const response = await fetch(gateway + 'state?id=' + encodeURIComponent(f.ID), { headers: { Authorization: 'Bearer ' + token } });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  // Every scan of the Session table, as PostgreSQL counts it (a tiny table may be read by index or sequentially).
  const sessionReads = async () => Number((await f.other.$queryRawUnsafe(`SELECT coalesce(seq_scan, 0) + coalesce(idx_scan, 0) AS scans FROM pg_stat_user_tables WHERE relname = 'Session'`))[0].scans);

  // Load: the 50+2 cadence for a full minute.
  const readsBefore = await sessionReads(), startedAt = Date.now(), deadline = performance.now() + LOAD_MS;
  const results = { viewer: [], trader: [] };
  const poll = async (token, period, sink) => {
    let next = performance.now();
    while (next < deadline) {
      const begun = performance.now();
      try { const response = await fetch(gateway + 'state?id=' + encodeURIComponent(f.ID), { headers: { Authorization: 'Bearer ' + token } }); await response.arrayBuffer(); sink.push([response.status, performance.now() - begun]); }
      catch { sink.push([0, performance.now() - begun]); }
      next += period; if (next > performance.now()) await sleep(next - performance.now());
    }
  };
  await Promise.all([
    ...viewers.map((viewer, i) => sleep(i * 20).then(() => poll(viewer.token, 1000, results.viewer))),
    ...f.tokens.map(token => poll(token, 4000, results.trader)),
  ]);
  const load = (await authority.requestLog()).filter(([at]) => at >= startedAt);
  const statuses = list => list.reduce((count, [status]) => ({ ...count, [status]: (count[status] ?? 0) + 1 }), {});
  const kinds = load.reduce((count, [, method, url]) => { const key = method + ' ' + url.replace('/api/v1/stocks-test-cash/', ''); return { ...count, [key]: (count[key] ?? 0) + 1 }; }, {});
  const gatewayRequests = results.viewer.length + results.trader.length;
  // Session reads are counted by PostgreSQL itself; its statistics reach the view within ~10 s.
  let reads = 0;
  for (let i = 0; i < 60 && reads < gatewayRequests; i++) { reads = await sessionReads() - readsBefore; if (reads < gatewayRequests) await sleep(250); }
  const summary = {
    gatewayRequests, viewerStatus: statuses(results.viewer), traderStatus: statuses(results.trader),
    viewerP50: Math.round(quantile(results.viewer.map(r => r[1]), 0.5)), viewerP95: Math.round(quantile(results.viewer.map(r => r[1]), 0.95)),
    authorityRequests: load.length, authorityKinds: kinds, authorityStatus: statuses(load.map(([, , , status]) => [status])),
    busiestMinute: busiestMinute(load), busiestIdentityMinute: busiestMinute(load.filter(([, method, url]) => method === 'POST' && url.endsWith('/identities'))), sessionReads: reads,
  };
  t.diagnostic('LOAD ' + JSON.stringify(summary));
  assert.ok(results.viewer.length >= VIEWERS * 55, 'every viewer kept polling');
  assert.deepEqual(summary.viewerStatus, { 200: results.viewer.length });
  assert.deepEqual(summary.traderStatus, { 200: results.trader.length });
  assert.equal(summary.authorityStatus[429], undefined, 'the private quota never refused the gateway');
  assert.equal(kinds['GET identity'], undefined, 'no per-request identity hop');
  // The gateway's identity budget is 3/4 of the quota per minute (authority-adapter.mjs); commands keep the rest.
  assert.ok(summary.busiestIdentityMinute <= QUOTA * 0.75, `identity batches in the busiest minute ${summary.busiestIdentityMinute} of ${QUOTA}`);
  assert.ok(summary.busiestMinute <= QUOTA, `busiest minute ${summary.busiestMinute} of ${QUOTA}`);
  // Multiplexing, not caching: at least one live Session read per gateway request.
  assert.ok(reads >= gatewayRequests, `session reads ${reads} for ${gatewayRequests} requests`);

  // Same running processes. Each change is followed immediately by the next request; nothing waits for a cache.
  const forged = [jwt.sign({ sub: viewers[0].id, sid: viewers[0].session }, 'another-synthetic-signing-key', { expiresIn: '1h' }),
    jwt.sign({ sub: viewers[0].id, sid: viewers[0].session, exp: Math.floor(Date.now() / 1000) - 1 }, process.env.JWT_SECRET),
    jwt.sign({ sub: viewers[0].id, sid: viewers[0].session, purpose: '2fa' }, process.env.JWT_SECRET, { expiresIn: '1h' }),
    jwt.sign({ sub: viewers[1].id, sid: viewers[0].session }, process.env.JWT_SECRET, { expiresIn: '1h' }), 'not-a-signed-token-at-all'];
  for (const token of forged) assert.equal((await state(token)).status, 401);
  // Sign-out of one device.
  assert.equal((await state(viewers[0].token)).status, 200);
  await f.other.session.update({ where: { id: viewers[0].session }, data: { revokedAt: new Date() } });
  assert.equal((await state(viewers[0].token)).status, 401, 'signed out: refused at the next request');
  assert.equal((await state(viewers[2].token)).status, 200, 'other sessions unaffected');
  // Contact block (the admin spam-email policy), read live: no session revoke needed for the refusal.
  await f.other.auditLog.create({ data: { action: 'CONTACT_EMAIL_BLOCKED', metadata: { email: viewers[3].email, emailHash: crypto.createHash('sha256').update(viewers[3].email).digest('hex') } } });
  assert.equal((await state(viewers[3].token)).status, 401, 'blocked contact: refused at the next request');
  // Account switch on one device: each request is answered for the account of its own bearer only.
  const trader = await state(f.tokens[0]);
  assert.equal(trader.status, 200); assert.equal(trader.body.account.canTrade, true);
  const switched = await state(viewers[4].token);
  assert.equal(switched.status, 200); assert.equal(switched.body.account.canTrade, false); assert.equal(switched.body.account.mode, 'viewer');
  assert.notEqual(switched.body.account.id, trader.body.account.id);
  // The viewer gets the market-only shape (trader-policy.mjs marketOnlyState): nothing of the previous account.
  const empty = { cash: '0.00000000', reserved: '0.00000000', available: '0.00000000' };
  assert.deepEqual(switched.body.wallets, { USDT: empty, USDC: empty });
  assert.deepEqual([switched.body.orders, switched.body.fills, switched.body.positions], [[], [], {}]);
  assert.notDeepEqual(trader.body.wallets.USDT, empty, 'the trader saw its own funded account');
  await f.other.session.update({ where: { id: f.sessions[0] }, data: { revokedAt: new Date() } });
  assert.equal((await state(f.tokens[0])).status, 401, 'previous account signed out: its token is refused at once');
  assert.equal((await state(viewers[4].token)).status, 200);
  // Admin block of a trader (User.blockedAt): the PostgreSQL authority refuses its account inside the command.
  assert.equal((await state(f.tokens[1])).status, 200);
  await f.other.user.update({ where: { id: f.users[1] }, data: { blockedAt: new Date() } });
  const blocked = await state(f.tokens[1]);
  assert.equal(blocked.status, 401, 'blocked trader: refused at the next request');
  const all = await authority.requestLog();
  assert.equal(all.filter(([, , , status]) => status === 429).length, 0);
  assert.deepEqual(await f.rows(), before, 'no cash, account, receipt or audit change');
});
