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
async function syntheticViewers(f, jwt) {
  const viewers = [];
  for (let i = 0; i < VIEWERS; i++) {
    const id = `synthetic-stock-viewer-${i}-${crypto.randomUUID()}`;
    await f.other.user.create({ data: { id, email: id + '@example.invalid', passwordHash: 'synthetic-no-password-login', referralCode: crypto.randomBytes(10).toString('hex') } });
    const session = await f.other.session.create({ data: { userId: id } });
    viewers.push({ id, session: session.id, email: id + '@example.invalid', token: jwt.sign({ sub: id, sid: session.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) });
  }
  return viewers;
}
// The compiled authority (default private quota: nothing is raised for these tests) and the release gateway
// (testing/synthetic-release-gateway.mjs: release-entrypoint.mjs with a synthetic market, so the traders' commands
// run without any outbound request).
async function releaseChain(t, f, gatewayArgs = []) {
  const env = { ...clean(), NODE_ENV: 'production', DATABASE_URL: f.target.raw, JWT_SECRET: process.env.JWT_SECRET,
    STOCKS_TEST_CASH_ENABLED: 'true', STOCKS_CATALOGUE_ENABLED: 'true', STOCKS_ORDER_EXECUTION_ENABLED: 'true',
    STOCKS_IDENTITY_ISSUER: f.issuer, STOCKS_TRADE_PRINCIPALS: JSON.stringify(f.principals), STOCKS_TEST_CASH_GATEWAY_KEY: f.gatewayKey };
  const authorityPort = await freePort();
  const authority = await start(t, ['--require', counter, authorityEntry], { ...env, STOCKS_AUTHORITY_INTERNAL_PORT: String(authorityPort) }, 'STOCKS_AUTHORITY_LISTENING ' + authorityPort);
  const gatewayPort = await freePort();
  await start(t, [path.join(__dirname, 'testing/synthetic-release-gateway.mjs'), ...gatewayArgs], { ...clean(), NODE_ENV: 'production',
    STOCKS_TEST_CASH_AUTHORITY_URL: `http://127.0.0.1:${authorityPort}/api/v1/stocks-test-cash`,
    STOCKS_IDENTITY_ISSUER: f.issuer, STOCKS_TEST_CASH_GATEWAY_KEY: f.gatewayKey, STOCKS_TRADE_PRINCIPALS: JSON.stringify(f.principals),
    STOCKS_GLOBAL_PORT: String(gatewayPort) }, 'STOCKS_RELEASE_LISTENING ' + gatewayPort);
  return { authority, gateway: `http://127.0.0.1:${gatewayPort}/__stocks_global/` };
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
  const viewers = await syntheticViewers(f, jwt);
  const { authority, gateway } = await releaseChain(t, f);
  const state = async token => {
    const response = await fetch(gateway + 'state?id=' + encodeURIComponent(f.ID), { headers: { Authorization: 'Bearer ' + token } });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  // Every scan of the Session table, as PostgreSQL counts it (a tiny table may be read by index or sequentially).
  // PostgreSQL's own counters for the Session table: reads (scans) and the rows they examined. An identity
  // batch reads all of its sessions in one query, so it is one scan that examines at least one row per bearer.
  const sessionReads = async () => { const [row] = await f.other.$queryRawUnsafe(`SELECT (coalesce(seq_scan, 0) + coalesce(idx_scan, 0))::int AS scans, (coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0))::int AS rows FROM pg_stat_user_tables WHERE relname = 'Session'`); return row; };

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
  let reads = { scans: 0, rows: 0 };
  for (let i = 0; i < 60 && (reads.rows < gatewayRequests || reads.scans < load.length); i++) { const now = await sessionReads(); reads = { scans: now.scans - readsBefore.scans, rows: now.rows - readsBefore.rows }; if (reads.rows < gatewayRequests || reads.scans < load.length) await sleep(250); }
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
  // Multiplexing, not caching: every private request (identity batch or command) read the Session table live,
  // and the rows examined cover at least one live Session row per gateway request.
  assert.ok(reads.scans >= load.length, `session reads ${reads.scans} for ${load.length} private requests`);
  assert.ok(reads.rows >= gatewayRequests, `session rows read ${reads.rows} for ${gatewayRequests} requests`);

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

// #613: the 50+2 harness schedule (scripts/qa/stocks-rc-50plus2/api-worker.cjs warm-up, driver.cjs PLAN and jobs) on
// the same release chain through the real private ingress, with the synthetic Binance stream market in the gateway
// process (demand leases and stream freshness, as the harness's separated gateway). Run 40726294118 stopped at the
// first measured polls with QUOTE_UNAVAILABLE (viewers) and QUOTE_STALE (trader 0): the warm-up's identity checks
// outran the gateway's identity budget, the warm-up outlasted the market's demand leases, and the first polls found
// their symbols cold again. Every job here must finish without an unexpected error, a timeout or a late start.
// The trader cadence is the harness's original one: a state read and the whole order cycle (limit, cancel, buy,
// replay, sell, replay) every 4 s, seven private commands per trader; the private quota stays at 240/min. Before
// #613 R5 this failed: both traders got 429 AUTH_RATE_LIMIT at their fifth cycle (warm-up 123 + measured 119
// private requests in one 60 s window), because every trader request also took its own identity check, so the
// warm-up's sequential trader reads alone spent about 36 identity batches. Now a trader's command is its live
// identity judgement (authority-adapter.mjs "Trader requests"), and identity batches never take the last minute
// past Q - Q/16. The order cycle every 8 s is a separately labelled diagnostic in the 50+2 harness, not this test.
test('the original 50+2 harness schedule (order cycle every 4 s) on the release chain: warm-up and every measured job finish inside the private quota', {
  timeout: 180000, skip: disposableUrl() ? false : 'NOT_RUN: disposable PostgreSQL required',
}, async t => {
  assert.equal(process.versions.node, '22.23.3');
  assert.equal(process.env.STOCKS_PG_COMPILED_ROUTER, 'true');
  const f = await fixture(t), jwt = require('jsonwebtoken');
  const { CATALOG } = await import(path.join(__dirname, 'catalog.mjs'));
  const instruments = CATALOG.filter(i => i.provider !== 'moex').slice(0, 20).map(i => i.id), stockId = CATALOG.find(i => i.provider === 'binance').id;
  const viewers = await syntheticViewers(f, jwt), viewerRows = async () => f.other.demoBalance.count({ where: { userId: { in: viewers.map(v => v.id) } } });
  const { authority, gateway } = await releaseChain(t, f, ['--stream-market']);
  const PLAN = { measureMs: 20000, timeoutMs: 3000, maxJitterMs: 250, maxInflight: 80 };
  const request = async (route, { token, view, body, csrf, expected = 200 }) => {
    const response = await fetch(gateway + route, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(PLAN.timeoutMs),
      headers: { authorization: 'Bearer ' + token, 'x-stocks-view': view, ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-stocks-token': csrf ?? '' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json().catch(() => null);
    if (response.status !== expected) throw Error(`HTTP_${response.status}_${route.split('?')[0]}_${JSON.stringify(value?.error ?? null)}`);
    return value;
  };
  const state = (id, token, view) => request('state?id=' + encodeURIComponent(id), { token, view });

  // Warm-up as api-worker.cjs: each trader until its quote is ready (4.5 s at most), then one state per viewer.
  const warmStart = performance.now();
  for (const [i, token] of f.tokens.entries()) {
    let last, ready = false;
    for (const end = Date.now() + 4500; !ready && Date.now() < end;) {
      last = await state(stockId, token, 'diag-trader-' + i);
      ready = last.account?.canTrade === true && Boolean(last.quotes?.[stockId]) && !last.errors?.[stockId];
      if (!ready) await sleep(120);
    }
    assert.ok(ready, `trader ${i} quote readiness: ${JSON.stringify(last?.errors ?? null)}`);
  }
  for (const [i, viewer] of viewers.entries()) assert.equal((await state(instruments[i % 20], viewer.token, 'diag-viewer-' + i)).account.canTrade, false);
  const warmMs = Math.round(performance.now() - warmStart);
  await sleep(5000); // the harness's crypto-only warm-up window between this and the measured window

  // The measured window, exactly driver.cjs's Stocks jobs (no crypto jobs: this is about the Stocks chain).
  const errors = [], latencies = [], placed = [[], []];
  let missed = 0, inflight = 0, maxJitter = 0, denials = 0;
  const viewerJob = async (i, cycle) => {
    const id = instruments[i % 20], view = 'diag-viewer-' + i, answer = await state(id, viewers[i].token, view);
    assert.equal(answer.account.canTrade, false);
    if (answer.errors?.[id]) throw Error('VIEWER_QUOTE_' + answer.errors[id]);
    if (cycle === 0) {
      const denied = await request('orders', { token: viewers[i].token, view, csrf: answer.token, expected: 401,
        body: { id: 'rc50-viewer-deny-' + i, instrumentId: id, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.01' } });
      assert.equal(denied.error, 'AUTH_REQUIRED'); denials++;
    }
  };
  const traderJob = async (i, cycle) => {
    const token = f.tokens[i], view = 'diag-trader-' + i, answer = await state(stockId, token, view);
    assert.equal(answer.account.canTrade, true);
    if (answer.errors?.[stockId]) throw Error('TRADER_QUOTE_' + answer.errors[stockId]);
    const command = (route, body) => request(route, { token, view, csrf: answer.token, body });
    const submit = async (suffix, side, type, extra = {}) => {
      const order = { id: `rc50-mixed-${i}-${cycle}-${suffix}`, // the harness's ids (at least 16 characters)
         instrumentId: stockId, currency: 'USDT', side, type, quantity: '0.01', ...extra };
      await command('orders', order); placed[i].push({ id: order.id, status: type === 'LIMIT' ? 'CANCELLED' : 'FILLED' });
      return order;
    };
    const limit = await submit('limit', 'BUY', 'LIMIT', { limitPrice: '98' });
    await command('cancel', { id: limit.id });
    const buy = await submit('buy', 'BUY', 'MARKET'); await command('orders', buy);
    const sell = await submit('sell', 'SELL', 'MARKET'); await command('orders', sell);
  };
  const jobs = [];
  for (let i = 0; i < VIEWERS; i++) for (let at = i * 20, cycle = 0; at < PLAN.measureMs; at += 1000, cycle++) jobs.push({ at, label: `viewer-${i}-${cycle}`, fn: () => viewerJob(i, cycle) });
  for (let i = 0; i < 2; i++) for (let at = 500 + i * 2000, cycle = 0; at < PLAN.measureMs; at += 4000, cycle++) jobs.push({ at, label: `trader-${i}-${cycle}`, fn: () => traderJob(i, cycle) });
  const startedAt = Date.now(), start = performance.now();
  await Promise.all(jobs.map(job => new Promise(resolve => setTimeout(() => {
    const jitter = performance.now() - start - job.at; maxJitter = Math.max(maxJitter, jitter);
    if (jitter > PLAN.maxJitterMs || inflight >= PLAN.maxInflight) { missed++; resolve(); return; }
    inflight++; const begun = performance.now();
    job.fn().then(() => latencies.push(performance.now() - begun), error => errors.push(job.label + ' ' + String(error.message ?? error).slice(0, 160)))
      .finally(() => { inflight--; resolve(); });
  }, Math.max(0, job.at - (performance.now() - start))))));
  const log = await authority.requestLog(), load = log.filter(([at]) => at >= startedAt);
  const kinds = rows => rows.reduce((count, [, method, url, status]) => { const key = `${method} ${url.replace('/api/v1/stocks-test-cash/', '')} ${status}`; return { ...count, [key]: (count[key] ?? 0) + 1 }; }, {});
  t.diagnostic('PRIVATE_REQUESTS ' + JSON.stringify({ warmUp: kinds(log.filter(([at]) => at < startedAt)), measured: kinds(load) }));
  const summary = { warmMs, jobs: jobs.length, errors: errors.length, firstErrors: errors.slice(0, 8), missed, maxJitterMs: Math.round(maxJitter),
    p50: Math.round(quantile(latencies, 0.5)), p95: Math.round(quantile(latencies, 0.95)), warmUpRequests: log.length - load.length, authorityRequests: load.length, busiestMinute: busiestMinute(log),
    busiestIdentityMinute: busiestMinute(load.filter(([, method, url]) => method === 'POST' && url.endsWith('/identities'))),
    busiestCommandMinute: busiestMinute(load.filter(([, method, url]) => method === 'POST' && url.endsWith('/command'))) };
  t.diagnostic('HARNESS_SCHEDULE ' + JSON.stringify(summary));
  assert.deepEqual(errors, [], 'no unexpected error (QUOTE_UNAVAILABLE, QUOTE_STALE, AUTH_RATE_LIMIT, timeouts included)');
  assert.equal(missed, 0, 'every job started on time and under the in-flight bound');
  assert.equal(denials, VIEWERS);
  assert.equal(log.filter(([, , , status]) => status === 429).length, 0, 'the private quota never refused the gateway');
  assert.ok(summary.busiestMinute <= QUOTA, `busiest minute (warm-up included) ${summary.busiestMinute} of ${QUOTA}`);
  // Exactly the intended orders: each LIMIT cancelled, each MARKET filled once despite its replay; nothing for viewers.
  const accounts = await f.rows(), cycles = i => jobs.filter(job => job.label.startsWith(`trader-${i}-`)).length;
  assert.deepEqual([cycles(0), cycles(1)], [5, 5]);
  for (const [i, expected] of placed.entries()) {
    assert.equal(expected.length, 3 * cycles(i));
    const orders = Object.fromEntries(accounts.accounts.find(a => a.userId === f.users[i]).ledger.orders.filter(o => o.id.startsWith('rc50-mixed-')).map(o => [o.id, o.status]));
    assert.deepEqual(orders, Object.fromEntries(expected.map(o => [o.id, o.status])));
  }
  assert.equal(await viewerRows(), 0, 'viewers hold no balance');
});

// #613, the deliberate over-limit scenario, kept apart from the normal load above. The two traders loop back to back
// with 20 ms between requests (a state read, five limit orders each cancelled, then buy, its replay, sell, its
// replay), far over the 240/min private quota, while the 50 viewers keep polling. A market order without a fresh
// stream trade is refused QUOTE_STALE by the market-data rule; that is a business refusal, not the quota. The ingress must refuse the excess with 429 and nothing else may go wrong: no server error, no order or
// receipt for a refused intent, no fill twice, no row for a viewer, no other account's data. Once the 60 s quota
// window has passed the same processes serve again, and a sign-out or a forged token is still refused.
test('over the private quota: the excess is refused with 429, nothing refused is written, money stays consistent and service returns', {
  timeout: 240000, skip: disposableUrl() ? false : 'NOT_RUN: disposable PostgreSQL required',
}, async t => {
  assert.equal(process.versions.node, '22.23.3');
  assert.equal(process.env.STOCKS_PG_COMPILED_ROUTER, 'true');
  const f = await fixture(t), jwt = require('jsonwebtoken');
  const viewers = await syntheticViewers(f, jwt), viewerIds = viewers.map(v => v.id);
  // The stream market of the harness gateway (as the schedule test above): the traders' order cycles work on it.
  const { CATALOG } = await import(path.join(__dirname, 'catalog.mjs')), stockId = CATALOG.find(i => i.provider === 'binance').id;
  const { authority, gateway } = await releaseChain(t, f, ['--stream-market']);
  const call = async (route, token, body, csrf) => {
    const begun = performance.now();
    const response = await fetch(gateway + route, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10000),
      headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json', 'x-stocks-token': csrf ?? '' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => null), ms: performance.now() - begun };
  };
  const state = token => call('state?id=' + encodeURIComponent(stockId), token);
  // Every gateway request is identity-checked first (batched, paced), so the loops slow to about one request per
  // batch interval once the burst is spent; the storm runs until the quota refuses commands (3 s more), at most 45 s.
  const startedAt = Date.now(), outcomes = [], viewerStatus = {};
  let until = startedAt + 45000;
  const storm = async i => {
    for (let n = 0; Date.now() < until; n++) {
      const read = await state(f.tokens[i]);
      outcomes.push({ trader: i, route: 'state', intent: null, status: read.status, error: read.body?.error ?? null, retryAfterMs: read.body?.retryAfterMs ?? null, ms: read.ms });
      if (read.status !== 200 || read.body.errors?.[stockId]) { await sleep(120); continue; }
      const order = (suffix, side, type, extra = {}) => ({ id: `rc50-storm-${i}-${n}-${suffix}`, instrumentId: stockId, currency: 'USDT', side, type, quantity: '0.01', ...extra });
      const steps = [...[1, 2, 3, 4, 5].flatMap(k => [['orders', order('limit' + k, 'BUY', 'LIMIT', { limitPrice: '98' })], ['cancel', { id: `rc50-storm-${i}-${n}-limit${k}` }]]),
        ['orders', order('buy', 'BUY', 'MARKET')], ['orders', order('buy', 'BUY', 'MARKET')], ['orders', order('sell', 'SELL', 'MARKET')], ['orders', order('sell', 'SELL', 'MARKET')]];
      for (const [route, body] of steps) {
        const r = await call(route, f.tokens[i], body, read.body.token);
        outcomes.push({ trader: i, route, intent: body.id, status: r.status, error: r.body?.error ?? null, retryAfterMs: r.body?.retryAfterMs ?? null, ms: r.ms });
        if (r.status === 429) until = Math.min(until, Date.now() + 3000);
        await sleep(20);
      }
    }
  };
  const watch = async viewer => { while (Date.now() < until) { const r = await state(viewer.token); viewerStatus[r.status] = (viewerStatus[r.status] ?? 0) + 1;
    if (r.status === 200) { assert.equal(r.body.account.canTrade, false); assert.deepEqual([r.body.orders, r.body.fills], [[], []]); } await sleep(1000); } };
  await Promise.all([storm(0), storm(1), ...viewers.map((viewer, i) => sleep(i * 20).then(() => watch(viewer)))]);
  const log = (await authority.requestLog()).filter(([at]) => at >= startedAt);
  const refused = outcomes.filter(o => o.status === 429), statuses = outcomes.reduce((m, o) => ({ ...m, [o.status + ' ' + (o.error ?? '')]: (m[o.status + ' ' + (o.error ?? '')] ?? 0) + 1 }), {});
  const commands = log.filter(([, method, url]) => method === 'POST' && url.endsWith('/command'));
  t.diagnostic('OVER_LIMIT ' + JSON.stringify({ stormMs: until - startedAt, traderRequests: outcomes.length, traderStateReads: outcomes.filter(o => o.route === 'state').length, statuses, viewerStatus, privateRequests: log.length, private429: log.filter(([, , , s]) => s === 429).length, privateCommands: commands.length, privateCommand429: commands.filter(([, , , s]) => s === 429).length }));
  // Refused with 429 by the transport quota, and nothing but 200 or 429 anywhere.
  assert.ok(refused.length > 0 && log.some(([, , , s]) => s === 429), 'the quota was actually exceeded');
  assert.deepEqual(Object.keys(statuses).filter(k => !['200 ', '429 AUTH_RATE_LIMIT', '422 QUOTE_STALE'].includes(k)), [], 'traders: only 200, 429 AUTH_RATE_LIMIT or the market-data refusal');
  assert.ok(outcomes.filter(o => o.status === 429 && o.route !== 'state').length > 0, 'commands themselves were refused by the quota');
  for (const o of refused) assert.ok(Number.isInteger(o.retryAfterMs) && o.retryAfterMs >= 1000 && o.retryAfterMs <= 60000);
  assert.deepEqual(Object.keys(viewerStatus).filter(k => !['200', '429'].includes(k)), [], 'viewers: only 200 or 429');
  // The gateway never retries a refused command on its own: each command the quota refused is one trader request
  // answered 429, and no request sends more than its own commands (a state read: its observation and, when that
  // fails, the failure record; each trader's account binding once). A trader's request carries no separate
  // identity check, so before #613 R5 the identity batches' 429s used to hide those last ones in this count.
  assert.ok(commands.filter(([, , , s]) => s === 429).length <= refused.length, 'no refused command was sent again');
  assert.ok(commands.length <= outcomes.length + outcomes.filter(o => o.route === 'state').length + 2, `${commands.length} commands for ${outcomes.length} trader requests`);

  // Service returns after the quota window, on the same processes.
  let back;
  for (const end = Date.now() + 75000; Date.now() < end; await sleep(2000)) { back = await state(f.tokens[0]); if (back.status === 200) break; }
  t.diagnostic('SERVED_AGAIN_AFTER_MS ' + (Date.now() - until));
  assert.equal(back.status, 200, 'served again after the window');
  assert.equal((await state(f.tokens[1])).status, 200);
  // Money and orders: exactly the intents some request had accepted, each order once, each market order filled once.
  const rows = await f.rows();
  for (let i = 0; i < 2; i++) {
    const ledger = rows.accounts.find(a => a.userId === f.users[i]).ledger, ids = ledger.orders.map(o => o.id).filter(id => id.startsWith('rc50-storm-'));
    const accepted = new Set(outcomes.filter(o => o.trader === i && o.route === 'orders' && o.status === 200).map(o => o.intent));
    assert.equal(new Set(ids).size, ids.length, 'no order twice');
    assert.deepEqual([...ids].sort(), [...accepted].sort(), 'an order exists exactly when a submit (or its replay) was accepted');
    const fills = ledger.fills.reduce((m, x) => ({ ...m, [x.orderId]: (m[x.orderId] ?? 0) + 1 }), {});
    for (const id of ids.filter(id => !/-limit\d$/.test(id))) assert.equal(fills[id], 1, 'each accepted market order filled exactly once: ' + id);
    for (const id of ids.filter(id => /-limit\d$/.test(id))) {
      const cancelled = outcomes.some(o => o.trader === i && o.route === 'cancel' && o.intent === id && o.status === 200);
      assert.equal(ledger.orders.find(o => o.id === id).status, cancelled ? 'CANCELLED' : 'OPEN', 'a limit is cancelled exactly when its cancel was accepted: ' + id);
      assert.equal(fills[id], undefined);
    }
    // The authority's own projection still matches the DemoBalance row (a mismatch refuses every read).
    const view = (await state(f.tokens[i])).body;
    assert.equal(view.account.canTrade, true);
    const cash = rows.cash.find(c => c.userId === f.users[i]);
    assert.ok(cash.available.gte(0) && cash.locked.gte(0));
  }
  const receipts = rows.receipts.map(r => r.principalHash + '|' + r.intentId);
  assert.equal(new Set(receipts).size, receipts.length, 'no receipt twice');
  assert.equal(rows.audit.length, rows.receipts.length, 'one audit row per receipt');
  for (const o of outcomes.filter(o => o.route === 'orders' && o.status !== 200)) if (!outcomes.some(x => x.intent === o.intent && x.route === 'orders' && x.status === 200))
    assert.ok(!rows.receipts.some(r => r.intentId === o.intent), 'no receipt for a refused intent: ' + o.intent);
  assert.equal(await f.other.demoBalance.count({ where: { userId: { in: viewerIds } } }), 0, 'viewers hold no balance');
  assert.equal(await f.other.stocksTestAccount.count({ where: { userId: { in: viewerIds } } }), 0, 'viewers hold no account');
  // Security still holds after the storm: forged and signed-out tokens are refused at once.
  assert.equal((await state(jwt.sign({ sub: f.users[0], sid: f.sessions[0] }, 'another-synthetic-signing-key', { expiresIn: '1h' }))).status, 401);
  await f.other.session.update({ where: { id: f.sessions[1] }, data: { revokedAt: new Date() } });
  assert.equal((await state(f.tokens[1])).status, 401, 'signed out: refused at the next request');
});
