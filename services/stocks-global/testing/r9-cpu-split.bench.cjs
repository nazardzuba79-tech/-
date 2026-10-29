'use strict';
// #613 R9 micro-benchmark (report only, never a p95 verdict, never run by CI: the name has no .test.). The release
// chain of identity-load.pg.test.cjs on a disposable PostgreSQL (compiled authority process with the default 240/min
// private quota, release gateway with the synthetic stream market), loaded with the 50+2 Stocks jobs of driver.cjs
// (no crypto API) in separate phases: nothing, the 50 viewers (state every 1 s; one denied order each in the first
// cycle), the 2 traders (state + limit + cancel + buy + replay + sell + replay every 4 s) and both. For each 20 s phase
// it records the CPU time of the gateway, the authority and the PostgreSQL cluster (/proc, every thread and every
// backend), the private requests the authority served by route, and the clients' answers. Phases run in ABBA order.
// Server processes are pinned to CPUs 0,1 and the clients to 2,3 when the host has 4 CPUs.
// Usage: STOCKS_DISPOSABLE_PG_URL=... STOCKS_PG_DISPOSABLE_CONFIRM=... STOCKS_PG_COMPILED_ROUTER=true \
//        R9_BENCH_OUT=<file.json> [R9_BENCH_ROUNDS=2] [R9_KINDS=idle,viewers,traders,both] [R9_COOL_MS=45000]
//        [R9_PROF_DIR=<dir>] node --test <this file>
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto'), fs = require('node:fs'), net = require('node:net'), os = require('node:os'), path = require('node:path');
const { fixture, disposableUrl } = require('./disposable-postgres.cjs');

const here = path.join(__dirname, '..'), root = path.resolve(here, '../..'), authorityEntry = path.join(root, 'dist/stocksAuthority.js');
const counter = path.join(__dirname, 'count-requests.cjs');
const VIEWERS = 50, PHASE_MS = 20000, COOL_MS = Number(process.env.R9_COOL_MS || 45000), TICK = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pinned = os.cpus().length === 4;
const pin = (pid, cpus) => { if (pinned) execFileSync('taskset', ['-a', '-p', '-c', cpus, String(pid)], { stdio: 'ignore' }); };
const freePort = () => new Promise(resolve => {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(STOCKS_|DATABASE_URL$|DIRECT_URL$|NODE_OPTIONS$|JWT_SECRET$|R9_)/.test(key)));
// utime + stime of a process (all its threads) in ms.
const statFields = pid => { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return [s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')), ...s.slice(s.lastIndexOf(')') + 2).split(' ')]; };
const cpuMs = pid => { try { const f = statFields(pid); return (Number(f[12]) + Number(f[13])) * 1000 / TICK; } catch { return 0; } };
// CPU ms per thread name of one process (the JS main thread is named after the process; Prisma's query engine runs
// on its own native threads, libuv's pool on "libuv-worker").
const threadCpuMs = pid => { const out = {}; try { for (const tid of fs.readdirSync(`/proc/${pid}/task`)) { try { const s = fs.readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8'), name = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')), f = s.slice(s.lastIndexOf(')') + 2).split(' ');
  out[name] = (out[name] ?? 0) + (Number(f[11]) + Number(f[12])) * 1000 / TICK; } catch {} } } catch {} return out; };
const diffThreads = (a, b) => Object.fromEntries(Object.keys(b).map(k => [k, Math.round(b[k] - (a[k] ?? 0))]).filter(([, v]) => v > 0));
// Every process of the PostgreSQL cluster serving the disposable URL: the postmaster (the postgres process whose data
// directory's postmaster.pid names this port) and its children. Backends that exit inside a phase are counted through
// the postmaster's cumulative children time.
const procs = () => fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).map(Number);
function pgPids(port) {
  const postmaster = procs().find(pid => { try { const f = statFields(pid); if (f[0] !== 'postgres' || statFields(Number(f[2]))[0] === 'postgres') return false;
    return fs.readFileSync(path.join(fs.readlinkSync(`/proc/${pid}/cwd`), 'postmaster.pid'), 'utf8').split('\n')[3] === String(port); } catch { return false; } });
  assert.ok(postmaster, 'PostgreSQL postmaster for port ' + port);
  const children = procs().filter(pid => { try { return Number(statFields(pid)[2]) === postmaster; } catch { return false; } });
  return { postmaster, children };
}
const pgCpuMs = port => { const { postmaster, children } = pgPids(port), s = statFields(postmaster);
  // utime + stime + cutime + cstime of the postmaster (exited backends) plus the live children.
  return (Number(s[12]) + Number(s[13]) + Number(s[14]) + Number(s[15])) * 1000 / TICK + children.reduce((sum, pid) => sum + cpuMs(pid), 0); };

async function start(t, args, env, ready) {
  const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', stdout = '';
  child.stderr.on('data', data => stderr += data); child.stdout.on('data', data => stdout += data);
  t.after(async () => { if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('START_TIMEOUT ' + stderr)), 8000);
    child.once('exit', code => { clearTimeout(timer); reject(Error('EXIT ' + code + ' ' + stderr)); });
    const check = () => { if (stdout.includes(ready)) { clearTimeout(timer); child.stdout.off('data', check); resolve(); } };
    child.stdout.on('data', check);
  });
  child.output = () => stdout;
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

test('R9 CPU split of the Stocks chain: viewers, traders, both (report only)', {
  timeout: 900000, skip: disposableUrl() ? false : 'NOT_RUN: disposable PostgreSQL required',
}, async t => {
  assert.equal(process.versions.node, '22.23.3');
  assert.equal(process.env.STOCKS_PG_COMPILED_ROUTER, 'true');
  const out = process.env.R9_BENCH_OUT; assert.ok(out, 'R9_BENCH_OUT');
  const rounds = Number(process.env.R9_BENCH_ROUNDS || 2), prof = process.env.R9_PROF_DIR;
  if (pinned) pin(process.pid, '2,3');
  const f = await fixture(t), jwt = require('jsonwebtoken');
  const { CATALOG } = await import(path.join(here, 'catalog.mjs'));
  const instruments = CATALOG.filter(i => i.provider !== 'moex').slice(0, 20).map(i => i.id), stockId = CATALOG.find(i => i.provider === 'binance').id;
  const viewers = [];
  for (let i = 0; i < VIEWERS; i++) {
    const id = `synthetic-stock-viewer-${i}-${crypto.randomUUID()}`;
    await f.other.user.create({ data: { id, email: id + '@example.invalid', passwordHash: 'synthetic-no-password-login', referralCode: crypto.randomBytes(10).toString('hex') } });
    const session = await f.other.session.create({ data: { userId: id } });
    viewers.push({ id, token: jwt.sign({ sub: id, sid: session.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) });
  }
  const env = { ...clean(), NODE_ENV: 'production', DATABASE_URL: f.target.raw, JWT_SECRET: process.env.JWT_SECRET,
    STOCKS_TEST_CASH_ENABLED: 'true', STOCKS_CATALOGUE_ENABLED: 'true', STOCKS_ORDER_EXECUTION_ENABLED: 'true',
    STOCKS_IDENTITY_ISSUER: f.issuer, STOCKS_TRADE_PRINCIPALS: JSON.stringify(f.principals), STOCKS_TEST_CASH_GATEWAY_KEY: f.gatewayKey };
  const profArgs = name => prof ? ['--cpu-prof', '--cpu-prof-dir', path.join(prof, name)] : [];
  const authorityPort = await freePort();
  const authority = await start(t, [...profArgs('authority'), '--require', counter, authorityEntry], { ...env, STOCKS_AUTHORITY_INTERNAL_PORT: String(authorityPort) }, 'STOCKS_AUTHORITY_LISTENING ' + authorityPort);
  // The synthetic market (the exchanges' stand-in) in its own process on the client CPUs, as market-worker.cjs.
  const marketProcess = await start(t, ['--input-type=module', '-e', `const { syntheticPublicMarket } = await import(${JSON.stringify(require('node:url').pathToFileURL(path.join(__dirname, 'synthetic-public-market.mjs')).href)});
    const market = await syntheticPublicMarket(); console.log('MARKET ' + market.origin + ' ' + market.wsUrl + ' READY'); process.on('SIGTERM', () => market.close().finally(() => process.exit()));`], clean(), ' READY');
  const [, marketOrigin, marketWs] = /MARKET (\S+) (\S+) READY/.exec(marketProcess.output());
  const gatewayPort = await freePort();
  const gatewayProcess = await start(t, [...profArgs('gateway'), path.join(__dirname, 'synthetic-release-gateway.mjs'), '--stream-market'], { ...clean(), NODE_ENV: 'production',
    STOCKS_SYNTHETIC_MARKET_ORIGIN: marketOrigin, STOCKS_SYNTHETIC_MARKET_WS: marketWs,
    STOCKS_TEST_CASH_AUTHORITY_URL: `http://127.0.0.1:${authorityPort}/api/v1/stocks-test-cash`,
    STOCKS_IDENTITY_ISSUER: f.issuer, STOCKS_TEST_CASH_GATEWAY_KEY: f.gatewayKey, STOCKS_TRADE_PRINCIPALS: JSON.stringify(f.principals),
    STOCKS_GLOBAL_PORT: String(gatewayPort) }, 'STOCKS_RELEASE_LISTENING ' + gatewayPort);
  const gateway = `http://127.0.0.1:${gatewayPort}/__stocks_global/`, pgPort = new URL(f.target.raw).port || '5432';
  pin(authority.pid, '0,1'); pin(gatewayProcess.pid, '0,1'); pin(marketProcess.pid, '2,3');
  { const { postmaster, children } = pgPids(pgPort); for (const pid of [postmaster, ...children]) pin(pid, '0,1'); }

  const request = async (route, { token, view, body, csrf, expected = 200 }) => {
    const response = await fetch(gateway + route, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(3000),
      headers: { authorization: 'Bearer ' + token, 'x-stocks-view': view, ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-stocks-token': csrf ?? '' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json().catch(() => null);
    if (response.status !== expected) throw Error(`HTTP_${response.status}_${route.split('?')[0]}_${JSON.stringify(value?.error ?? null)}`);
    return value;
  };
  // As driver.cjs and the terminal: a client's first state read gets the full catalogue, every later read names the
  // version it holds. A warm-up read refused by the private quota waits for its Retry-After and is sent again.
  const held = new Map();
  const state = async (id, token, view) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const answer = await request('state?id=' + encodeURIComponent(id) + (held.has(view) ? '&catalogue=' + held.get(view) : ''), { token, view });
        if (Array.isArray(answer?.catalogue) && /^[a-f0-9]{16}$/.test(answer.catalogueVersion ?? '')) held.set(view, answer.catalogueVersion);
        return answer;
      } catch (error) {
        // A warm-up read refused by the quota waits for it; one that failed before any answer (an idle keep-alive
        // socket the server closed after a phase's pause) is sent once more, as a browser does for an idempotent read.
        if (!warming || attempt > 5) throw error;
        if (/^HTTP_429_/.test(error.message)) await sleep(5000); else if (error.name !== 'TypeError' || attempt > 0) throw error;
      }
    }
  };
  let warming = false;
  // Warm-up as api-worker.cjs, before every phase and outside its window: each trader until its quote is ready,
  // one state per viewer (their demand leases lapse during the other phases).
  const warmTraders = async () => { for (const [i, token] of f.tokens.entries()) {
    let ready = false;
    for (const end = Date.now() + 4500; !ready && Date.now() < end;) { const last = await state(stockId, token, 'r9-trader-' + i); ready = last.account?.canTrade === true && Boolean(last.quotes?.[stockId]) && !last.errors?.[stockId]; if (!ready) await sleep(120); }
    assert.ok(ready, 'trader ' + i + ' quote readiness');
  } };
  const warmViewers = async () => { for (const [i, viewer] of viewers.entries()) await state(instruments[i % 20], viewer.token, 'r9-viewer-' + i); };

  let round = 0;
  const viewerJob = async (i, cycle, tag) => {
    const id = instruments[i % 20], view = 'r9-viewer-' + i, answer = await state(id, viewers[i].token, view);
    if (answer.errors?.[id]) throw Error('VIEWER_QUOTE_' + answer.errors[id]);
    if (cycle === 0) await request('orders', { token: viewers[i].token, view, csrf: answer.token, expected: 401,
      body: { id: `r9-viewer-deny-${tag}-${i}`, instrumentId: id, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.01' } });
  };
  const traderJob = async (i, cycle, tag) => {
    const token = f.tokens[i], view = 'r9-trader-' + i, answer = await state(stockId, token, view);
    if (answer.errors?.[stockId]) throw Error('TRADER_QUOTE_' + answer.errors[stockId]);
    const command = (route, body) => request(route, { token, view, csrf: answer.token, body });
    const submit = async (suffix, side, type, extra = {}) => { const order = { id: `r9-${tag}-${i}-${cycle}-${suffix}`, instrumentId: stockId, currency: 'USDT', side, type, quantity: '0.01', ...extra }; await command('orders', order); return order; };
    const limit = await submit('limit', 'BUY', 'LIMIT', { limitPrice: '98' });
    await command('cancel', { id: limit.id });
    const buy = await submit('buy', 'BUY', 'MARKET'); await command('orders', buy);
    const sell = await submit('sell', 'SELL', 'MARKET'); await command('orders', sell);
  };
  async function phase(kind) {
    const tag = kind + '-' + (++round), jobs = [];
    if (kind === 'viewers' || kind === 'both') for (let i = 0; i < VIEWERS; i++) for (let at = i * 20, cycle = 0; at < PHASE_MS; at += 1000, cycle++) jobs.push({ at, kind: 'viewer', fn: () => viewerJob(i, cycle, tag) });
    if (kind === 'traders' || kind === 'both') for (let i = 0; i < 2; i++) for (let at = 500 + i * 2000, cycle = 0; at < PHASE_MS; at += 4000, cycle++) jobs.push({ at, kind: 'trader', fn: () => traderJob(i, cycle, tag) });
    // Between phases the last minute's private requests age out, so no phase starts against a nearly full quota.
    await sleep(COOL_MS);
    warming = true;
    if (kind === 'traders' || kind === 'both') await warmTraders();
    if (kind === 'viewers' || kind === 'both') await warmViewers();
    warming = false;
    await sleep(1000);
    const errors = [], latencies = { viewer: [], trader: [] };
    const before = { gateway: cpuMs(gatewayProcess.pid), authority: cpuMs(authority.pid), postgres: pgCpuMs(pgPort), market: cpuMs(marketProcess.pid), clients: process.cpuUsage(), threads: { gateway: threadCpuMs(gatewayProcess.pid), authority: threadCpuMs(authority.pid) } };
    const startedAt = Date.now(), start = performance.now();
    await Promise.all(jobs.map(job => new Promise(resolve => setTimeout(() => {
      const begun = performance.now();
      job.fn().then(() => latencies[job.kind].push(performance.now() - begun), error => errors.push(job.kind + ' ' + String(error.message ?? error).slice(0, 120))).finally(resolve);
    }, Math.max(0, job.at - (performance.now() - start))))));
    const rest = PHASE_MS - (performance.now() - start); if (rest > 0) await sleep(rest);
    const after = { gateway: cpuMs(gatewayProcess.pid), authority: cpuMs(authority.pid), postgres: pgCpuMs(pgPort), market: cpuMs(marketProcess.pid), clients: process.cpuUsage(before.clients), threads: { gateway: threadCpuMs(gatewayProcess.pid), authority: threadCpuMs(authority.pid) } };
    const log = (await authority.requestLog()).filter(([at]) => at >= startedAt && at < startedAt + PHASE_MS + 2000);
    const routes = log.reduce((count, [, method, url, status]) => { const key = `${method} ${url.replace('/api/v1/stocks-test-cash/', '')} ${status}`; return { ...count, [key]: (count[key] ?? 0) + 1 }; }, {});
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]) : null; };
    const result = { kind, tag, wallMs: Math.round(performance.now() - start), jobs: jobs.length, errors: errors.length, firstErrors: errors.slice(0, 5),
      cpuMs: { gateway: Math.round(after.gateway - before.gateway), authority: Math.round(after.authority - before.authority), postgres: Math.round(after.postgres - before.postgres), market: Math.round(after.market - before.market), clients: Math.round((after.clients.user + after.clients.system) / 1000) },
      threadCpuMs: { gateway: diffThreads(before.threads.gateway, after.threads.gateway), authority: diffThreads(before.threads.authority, after.threads.authority) },
      privateRequests: routes, viewer: { n: latencies.viewer.length, p50: q(latencies.viewer, 0.5), p95: q(latencies.viewer, 0.95) }, trader: { n: latencies.trader.length, p50: q(latencies.trader, 0.5), p95: q(latencies.trader, 0.95) } };
    t.diagnostic('PHASE ' + JSON.stringify(result));
    return result;
  }
  const phases = [];
  for (let r = 0; r < rounds; r++) {
    const kinds = process.env.R9_KINDS ? process.env.R9_KINDS.split(',') : ['idle', 'viewers', 'traders', 'both'];
    const order = r % 2 === 0 ? kinds : [...kinds].reverse();
    for (const kind of order) phases.push(await phase(kind));
  }
  const mean = kind => { const list = phases.filter(p => p.kind === kind), keys = ['gateway', 'authority', 'postgres', 'market', 'clients'];
    return Object.fromEntries(keys.map(k => [k, Math.round(list.reduce((s, p) => s + p.cpuMs[k], 0) / list.length)])); };
  const summary = { pinned, rounds, phaseMs: PHASE_MS, meanCpuMs: Object.fromEntries([...new Set(phases.map(p => p.kind))].map(k => [k, mean(k)])), phases };
  fs.writeFileSync(out, JSON.stringify(summary, null, 1));
  t.diagnostic('MEAN_CPU_MS ' + JSON.stringify(summary.meanCpuMs));
  assert.equal(phases.reduce((s, p) => s + p.errors, 0), 0, 'no client error in any phase');
});
