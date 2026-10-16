// Finite, offline LOCAL integration rehearsal; never a capacity/deployment test.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { FIXTURE_SECRET, ID, ISSUER } = require('./qa-stocks-local-stage-fixture.cjs');
const root = path.resolve(__dirname, '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const PREFIX = '/__stocks_global/';
const CASES = [
  'actual /me authority, policy/session rejection and bounded maximum avatar',
  'owner full trading cycle and exact P&L/reservation with viewer isolation',
  'lost HTTP acknowledgement, restart, same-ID retry and conflict',
  'feature-off rejects cached credentials and CSRF without upstream work',
  'quiesced FULL SQLite backup, distinct-path restore and exact ledger reconciliation',
];
function privateJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }

function sourceInputs() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push({ path: path.relative(root, file).replaceAll('\\', '/'), sha256: sha(fs.readFileSync(file)) });
      else assert.ok(entry.isFile(), 'no special source files');
    }
  }
  walk(path.join(root, 'src')); return files.sort((a, b) => a.path.localeCompare(b.path));
}

function freshBuild(output) {
  const configPath = path.join(root, 'tsconfig.json'), configBytes = fs.readFileSync(configPath), config = JSON.parse(configBytes);
  assert.equal(config.extends, undefined); assert.equal(config.compilerOptions.outDir, './dist'); assert.equal(config.compilerOptions.rootDir, './src');
  assert.ok(!config.compilerOptions.noEmit && !config.compilerOptions.emitDeclarationOnly && !config.compilerOptions.incremental);
  assert.deepEqual(config.include, ['src/**/*.ts']); assert.deepEqual(config.exclude, ['node_modules', 'dist', '**/*.test.ts']);
  const compilerRoot = path.join(root, 'node_modules/typescript'), compiler = path.join(compilerRoot, 'bin/tsc');
  const compilerFiles = ['package.json', 'bin/tsc', 'lib/tsc.js', 'lib/_tsc.js'].filter(file => fs.existsSync(path.join(compilerRoot, file)))
    .map(file => ({ file, sha256: sha(fs.readFileSync(path.join(compilerRoot, file))) }));
  const before = sourceInputs(), startedAt = new Date().toISOString();
  const env = { TEMP: output, TMP: output, HOME: output, USERPROFILE: output };
  if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot || 'C:\\Windows';
  const args = [compiler, '--project', configPath];
  const result = spawnSync(process.execPath, args, { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const log = (result.stdout || '') + (result.stderr || '') + (result.error ? '\nBUILD_PROCESS_ERROR:' + result.error.message : '');
  fs.writeFileSync(path.join(output, 'build.log'), log, { flag: 'wx', mode: 0o600 });
  const after = sourceInputs();
  const outputs = before.filter(row => !row.path.endsWith('.d.ts')).map(row => {
    const file = row.path.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
    return { path: file, sha256: fs.existsSync(path.join(root, file)) ? sha(fs.readFileSync(path.join(root, file))) : null };
  });
  const proof = { command: { executable: process.execPath, args, cwd: root }, startedAt, endedAt: new Date().toISOString(),
    exitCode: result.status, signal: result.signal, compilerVersion: JSON.parse(fs.readFileSync(path.join(compilerRoot, 'package.json'), 'utf8')).version,
    compilerFiles, node: process.version, tsconfig: { path: 'tsconfig.json', sha256: sha(configBytes) },
    packageLockSha256: sha(fs.readFileSync(path.join(root, 'package-lock.json'))), logSha256: sha(Buffer.from(log)), sourcesBefore: before, outputs,
    sourcesAfterHash: sha(JSON.stringify(after)), sourcesUnchanged: JSON.stringify(before) === JSON.stringify(after) && sha(fs.readFileSync(configPath)) === sha(configBytes) };
  privateJson(path.join(output, 'build-provenance.json'), proof);
  assert.equal(result.status, 0, 'fresh TypeScript build must succeed'); assert.equal(result.error, undefined); assert.equal(proof.sourcesUnchanged, true, 'source/tsconfig changed during compilation');
  return { ...proof, proofSha256: sha(fs.readFileSync(path.join(output, 'build-provenance.json'))) };
}

function stockRuntimeSources() {
  const files = fs.readdirSync(path.join(root, 'services/stocks-global'))
    .filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs') && name !== 'probe.mjs')
    .map(name => 'services/stocks-global/' + name).sort();
  assert.ok(files.includes('services/stocks-global/trader-policy.mjs'), 'two-trader policy must belong to the local fixture runtime');
  return files;
}

function packageFixture(destination, build) {
  fs.mkdirSync(destination, { mode: 0o700 });
  const files = new Map(), externals = new Set();
  function copy(relative) {
    relative = relative.replaceAll('\\', '/');
    assert.ok(/^(scripts\/qa-stocks-local-stage-fixture\.cjs|services\/(stocks-global|stocks-simulator)\/[a-z-]+\.mjs|dist\/[A-Za-z0-9_/-]+\.js|src\/[A-Za-z0-9_/-]+\.ts)$/.test(relative), relative);
    assert.ok(!relative.includes('..') && !/\.(test|spec)\./.test(relative));
    if (files.has(relative)) return;
    const source = path.join(root, relative), content = fs.readFileSync(source);
    const target = path.join(destination, relative); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
    files.set(relative, { path: relative, bytes: content.length, sha256: sha(content) });
    if (relative.startsWith('dist/')) {
      assert.equal(sha(content), build.outputs.find(row => row.path === relative)?.sha256, 'copied compiled authority matches fresh build output');
      for (const match of content.toString().matchAll(/require\(["']([^"']+)["']\)/g)) {
        if (match[1].startsWith('.')) copy(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])) + '.js');
        else if (!match[1].startsWith('node:')) externals.add(match[1]);
      }
      const sourcePath = relative.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      assert.ok(fs.existsSync(path.join(root, sourcePath)), 'source for actual compiled authority exists');
      assert.equal(sha(fs.readFileSync(path.join(root, sourcePath))), build.sourcesBefore.find(row => row.path === sourcePath)?.sha256, 'copied authority source matches fresh build input'); copy(sourcePath);
    }
  }
  copy('scripts/qa-stocks-local-stage-fixture.cjs');
  for (const relative of stockRuntimeSources()) copy(relative);
  copy('services/stocks-simulator/engine.mjs');
  copy('dist/api/routes/account.js');
  assert.ok(fs.readFileSync(path.join(destination, 'services/stocks-global/accounts.mjs'), 'utf8').includes('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;'), 'packaged worker uses unchanged FULL configuration');
  const manifest = { fixtureOnly: true, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeChanges: execFileSync('git', ['status', '--short', '--', 'services/stocks-global', 'scripts/qa-stocks-local-stage-fixture.cjs', 'scripts/qa-stocks-local-stage-recovery.cjs'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    packageEntry: 'scripts/qa-stocks-local-stage-fixture.cjs', accountEntry: 'dist/api/routes/account.js', buildProvenanceSha256: build.proofSha256,
    migration: 'NOT_USED', productionEntrypoint: 'NOT_USED', nodeModulesCopied: false,
    dependencies: { mode: 'existing workspace node_modules via explicit child NODE_PATH; not a standalone deployment image', names: [...externals].sort(), packageLockSha256: sha(fs.readFileSync(path.join(root, 'package-lock.json'))) },
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) };
  privateJson(path.join(destination, 'manifest.json'), manifest); return manifest;
}

function fixtureProcess(packageRoot, dataRoot, report) {
  const env = { STOCKS_LOCAL_STAGE_FIXTURE: 'true', JWT_SECRET: FIXTURE_SECRET,
    NODE_PATH: path.join(root, 'node_modules'), TEMP: path.dirname(packageRoot), TMP: path.dirname(packageRoot), HOME: path.dirname(packageRoot), USERPROFILE: path.dirname(packageRoot) };
  if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot || 'C:\\Windows';
  const child = spawn(process.execPath, [path.join(packageRoot, 'scripts/qa-stocks-local-stage-fixture.cjs')],
    { cwd: packageRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let id = 0, outputBytes = 0; const pending = new Map();
  const logs = [];
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    outputBytes += chunk.length;
    if (outputBytes > 256 * 1024) { child.kill(); return; }
    logs.push(chunk.toString());
  });
  child.on('message', message => {
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(Error(message.error.message), { stack: message.error.stack })); else request.resolve(message.result);
  });
  const exited = new Promise(resolve => child.once('close', (code, signal) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('FIXTURE_CHILD_EXIT')); }
    pending.clear(); report.child = { code, signal, outputBytes }; resolve({ code, signal });
  }));
  child.on('error', error => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); });
  function command(command, input = {}) {
    return new Promise((resolve, reject) => {
      const key = ++id, timer = setTimeout(() => { pending.delete(key); child.kill(); reject(Error('FIXTURE_COMMAND_TIMEOUT:' + command)); }, 12000);
      if (!child.connected) { clearTimeout(timer); reject(Error('FIXTURE_IPC_CLOSED')); return; }
      pending.set(key, { resolve, reject, timer }); child.send({ id: key, command, input });
    });
  }
  async function waitForExit(timeoutMs = 5000) {
    let timer;
    try { return await Promise.race([exited, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('FIXTURE_EXIT_TIMEOUT')), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  async function terminate() {
    // Only the exact child we spawned; its SQLite worker is a thread, not a separate process.
    if (child.exitCode !== null || child.signalCode !== null) return waitForExit(2000);
    child.kill('SIGTERM');
    try { return await waitForExit(2000); }
    catch { child.kill('SIGKILL'); return waitForExit(2000); }
  }
  return { child, waitForExit, terminate, logs, command, ready: () => command('init', { dataRoot }) };
}

function request(origin, route, token, body, csrf, methodOverride) {
  const url = new URL(route, origin); assert.equal(url.origin, origin); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.protocol, 'http:');
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(url, { method: methodOverride || (payload ? 'POST' : 'GET'),
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(csrf ? { 'X-Stocks-Token': csrf } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 1200 * 1024) req.destroy(Error('FIXTURE_RESPONSE_BOUND')); else chunks.push(chunk); });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()), bytes: size }); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.setTimeout(8000, () => req.destroy(Error('FIXTURE_HTTP_TIMEOUT'))); req.on('error', reject);
    if (payload) req.write(payload); req.end();
  });
}

function inspectClosedDb(file, dataRoot) {
  assert.equal(path.dirname(file), dataRoot); assert.ok(['primary.sqlite', 'restored.sqlite'].includes(path.basename(file)));
  assert.ok(fs.lstatSync(file).isFile()); assert.equal(fs.lstatSync(file).nlink, 1);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dataRoot).mode & 0o777, 0o700);
  }
  assert.ok(!fs.existsSync(file + '-journal'), 'quiesced DELETE journal must be absent');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all(); assert.deepEqual(integrity.map(x => x.integrity_check), ['ok']);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    const rows = db.prepare('SELECT id, ledger FROM paper_accounts ORDER BY id').all().map(row => ({ id: row.id, ledger: JSON.parse(row.ledger) }));
    // The fixture admits exactly one trader. Bob remains an authenticated
    // market-data viewer and must never acquire a funded SQLite account.
    assert.deepEqual(rows.map(row => row.id), [sha(JSON.stringify([ISSUER, 'alice']))], 'only the fixture owner has a persisted account');
    for (const row of rows) assert.equal(row.ledger.schema, 2);
    return { rows, bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file)), integrity: 'ok', journal: 'delete' };
  } finally { db.close(); }
}

async function main(output) {
  assert.ok(path.isAbsolute(output), '--output must be absolute');
  assert.ok(!fs.existsSync(output), 'refuse existing output or fixture data');
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.mkdirSync(output, { mode: 0o700 }); // Exclusive admission: concurrent same-output run fails EEXIST.
  const report = { fixtureOnly: true, productionAccess: false, capacityClaim: false, browserClaim: false, runtime: { node: process.version, platform: process.platform, arch: process.arch }, startedAt: new Date().toISOString(),
    cases: CASES.map(name => ({ name, status: 'NOT_RUN' })), calls: [], limitations: ['Local actual /me contract with fixture Prisma is not production DB/auth capacity.',
      'No browser/UI/translation or actual-provider data claim; existing separate browser suites remain required.',
      'Backup is quiesced fixture-only; no live database, cloud backup, deployment image or old-binary compatibility claim.',
      'Windows POSIX UID/mode guarantees are not claimed.'] };
  let fixture, ready;
  const packageRoot = path.join(output, 'package'), dataRoot = path.join(output, 'data');
  const check = (condition, label) => { assert.ok(condition, label); report.assertions = (report.assertions || 0) + 1; };
  async function test(name, run) {
    const item = report.cases.find(x => x.name === name); assert.ok(item); assert.equal(item.status, 'NOT_RUN'); item.status = 'RUNNING';
    try { await run(); item.status = 'PASS'; } catch (error) { item.status = 'FAIL'; item.error = error.message; throw error; }
  }
  const call = async (user, route, body, csrf, method) => {
    try {
      const result = await request(ready.gatewayOrigin, PREFIX + route, ready.tokens[user], body, csrf, method);
      report.calls.push({ user, route: route.split('?')[0], status: result.status, error: result.body.error || null }); return result;
    } catch (error) { report.calls.push({ user, route: route.split('?')[0], status: null, error: error.code || error.message }); throw error; }
  };
  let alice, bob;
  const order = (name, extra = {}) => ({ id: 'local-stage-order-' + name.padEnd(18, '0'), instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.4', ...extra });
  const state = user => call(user, 'state');
  const refresh = async () => { const r = await call('alice', 'refresh', { id: ID }, alice.body.token); check(r.status === 200, 'fixture refresh'); };
  const viewer = (result, label) => {
    check(result.status === 200 && result.body.account?.mode === 'viewer' && result.body.account.canTrade === false, label + ': authenticated market-only response');
    check(['USDT', 'USDC'].every(currency => ['cash', 'reserved', 'available'].every(field => result.body.wallets?.[currency]?.[field] === '0.00000000')), label + ': no funded or reserved viewer cash');
    check(result.body.orders.length === 0 && result.body.fills.length === 0 && Object.keys(result.body.positions).length === 0 && result.body.adjustments.length === 0, label + ': no financial history or positions');
  };
  try {
    const build = freshBuild(output);
    report.build = { command: build.command, compilerVersion: build.compilerVersion, exitCode: build.exitCode, proofSha256: build.proofSha256, logSha256: build.logSha256 };
    report.manifest = packageFixture(packageRoot, build); report.manifestSha256 = sha(fs.readFileSync(path.join(packageRoot, 'manifest.json')));
    fixture = fixtureProcess(packageRoot, dataRoot, report); ready = await fixture.ready();
    await test('actual /me authority, policy/session rejection and bounded maximum avatar', async () => {
      const me = token => request(ready.authorityOrigin, '/api/v1/me', token);
      check((await me(ready.tokens.alice)).body.id === 'alice', 'actual owner subject');
      check((await me(ready.tokens.pending)).status === 401, 'pending 2FA rejected');
      check((await me(ready.tokens.mismatch)).status === 401, 'session subject mismatch rejected');
      check((await me()).status === 401, 'missing bearer rejected');
      check((await request(ready.authorityOrigin, '/api/v1/me', ready.tokens.alice, {}, undefined, 'POST')).status === 403, 'all non-me authority operations denied');
      check((await request(ready.authorityOrigin, '/api/v1/balances', ready.tokens.alice)).status === 403, 'financial authority route denied');
      await fixture.command('session', { id: 'alice', staleTouch: true });
      check((await me(ready.tokens.alice)).status === 200, 'stale lastSeen accepts valid fixture session');
      check((await fixture.command('audit')).prisma.sessionTouches === 1, 'actual auth touches only fixture session');
      await fixture.command('avatar', { value: true });
      alice = await state('alice'); check(alice.status === 200 && alice.body.account.canTrade === true, 'actual maximum avatar passes identity adapter');
      await fixture.command('avatar', { value: false });
      for (const [command, input, undo] of [
        ['session', { id: 'alice', revoked: true }, { id: 'alice', revoked: false }],
        ['session', { id: 'alice', expired: true }, { id: 'alice', expired: false }],
        ['policy', { id: 'alice', blocked: true }, { id: 'alice', blocked: false }],
        ['userDeleted', { id: 'bob', value: true }, { id: 'bob', value: false }],
      ]) {
        await fixture.command(command, input);
        check((await state(input.id)).status === 401, command + ' fails closed through Stocks');
        await fixture.command(command, undo); check((await state(input.id)).status === 200, command + ' fresh restoration is not cached');
      }
      await fixture.command('networkProbe'); check((await fixture.command('audit')).deniedNetwork === 1, 'external transport denied before connection');
      alice = await state('alice'); bob = await state('bob');
    });
    await test('owner full trading cycle and exact P&L/reservation with viewer isolation', async () => {
      viewer(bob, 'Bob initial view');
      // Measure viewer-only work in a fresh worker between actual quiescent
      // snapshots. Do not infer no writes from the displayed zero balance.
      const beforeViewer = await fixture.command('quiesce');
      check(beforeViewer.closed === true, 'viewer baseline worker fully quiesced');
      const viewerBaseline = inspectClosedDb(beforeViewer.path, dataRoot);
      await fixture.command('restart');
      bob = await state('bob'); viewer(bob, 'Bob fresh-worker view');
      check((await call('bob', 'orders', order('bob'), bob.body.token)).status === 401, 'Bob order denied');
      const afterViewer = await fixture.command('quiesce');
      check(afterViewer.closed === true, 'viewer-only worker fully quiesced');
      const viewerMetrics = afterViewer.accountMetrics;
      check(viewerMetrics?.queue.accepted === 0 && viewerMetrics.queue.dispatched === 0 && viewerMetrics.queue.active === 0 && viewerMetrics.queue.pending === 0, 'viewer read and denied order admit no account-worker commands');
      check(viewerMetrics?.sqlWriteCalls === 0 && viewerMetrics.transactionExecCalls === 0, 'viewer read and denied order perform no ledger writes or transactions');
      const viewerAfter = inspectClosedDb(afterViewer.path, dataRoot);
      check(viewerAfter.sha256 === viewerBaseline.sha256 && JSON.stringify(viewerAfter.rows) === JSON.stringify(viewerBaseline.rows), 'viewer operations preserve every persisted ledger byte and never create Bob');
      report.viewerIsolation = { responseMode: 'viewer', fundedBalance: false, persistedAccounts: viewerAfter.rows.length, viewerAccountCreated: false,
        accountCommands: viewerMetrics.queue.accepted, sqlWrites: viewerMetrics.sqlWriteCalls, transactions: viewerMetrics.transactionExecCalls, databaseByteIdentical: true };
      await fixture.command('restart'); alice = await state('alice'); bob = await state('bob');
      check(alice.status === 200 && alice.body.account.canTrade === true, 'owner restored after viewer-only proof');
      viewer(bob, 'Bob post-restart view');
      // The additional restart must obey the existing observation recovery
      // fence (reopened account epoch + 2s), not bypass it or backdate quotes.
      await new Promise(resolve => setTimeout(resolve, 2100));
      check((await call('alice', 'orders', order('csrf'), 'wrong-token')).status === 422, 'forged CSRF denied');
      const selector = await call('alice', 'state?accountId=bob');
      check(selector.status === 400 && selector.body.error === 'QUERY_NOT_ALLOWED', 'account selector denied at gateway');
      const moex = await call('alice', 'history?id=MOEX%3ATQBR%3ASBER&interval=1m');
      check(moex.status === 422 && moex.body.error === 'MOEX_UNVERIFIED', 'MOEX/SBER remains blocked');
      await refresh();
      const bought = await call('alice', 'orders', order('buy'), alice.body.token);
      check(bought.status === 200 && bought.body.wallets.USDT.cash === '9960.00000000', 'buy debits exactly 40');
      check(bought.body.positions[ID + '|USDT'].quantity === '0.40000000', 'fractional shares');
      await fixture.command('price', { value: '110' });
      // Wait only the existing native observation TTL; never rewrite freshness.
      await new Promise(resolve => setTimeout(resolve, 3100)); await refresh();
      const partial = await call('alice', 'orders', order('partial', { side: 'SELL', quantity: '0.1' }), alice.body.token);
      check(partial.status === 200 && partial.body.positions[ID + '|USDT'].quantity === '0.30000000', 'partial close');
      check(partial.body.realized.USDT === '1.00000000', 'partial realized gain');
      const closed = await call('alice', 'orders', order('full', { side: 'SELL', quantity: '0.3' }), alice.body.token);
      check(closed.status === 200 && closed.body.positions[ID + '|USDT'].quantity === '0.00000000', 'full close');
      check(closed.body.realized.USDT === '4.00000000' && closed.body.wallets.USDT.cash === '10004.00000000', 'full realized and balance reconcile');
      const limitOrder = order('limit', { type: 'LIMIT', quantity: '0.2', limitPrice: '50' });
      const limit = await call('alice', 'orders', limitOrder, alice.body.token);
      check(limit.status === 200 && limit.body.wallets.USDT.reserved === '10.00000000', 'Limit reserves exactly 10');
      check((await call('bob', 'cancel', { id: limitOrder.id }, bob.body.token)).status === 401, 'Bob cannot cancel owner order');
      const cancelled = await call('alice', 'cancel', { id: limitOrder.id }, alice.body.token);
      check(cancelled.status === 200 && cancelled.body.wallets.USDT.reserved === '0.00000000', 'cancel releases reserve');
      const oversell = await call('alice', 'orders', order('oversell', { side: 'SELL', quantity: '1' }), alice.body.token);
      check(oversell.status === 422 && oversell.body.error === 'INSUFFICIENT_SHARES', 'oversell denied');
      const usdc = await call('alice', 'orders', order('usdc', { currency: 'USDC' }), alice.body.token);
      check(usdc.status === 422 && usdc.body.error === 'INVALID_ORDER', 'owner USDT-only policy retained');
      const other = await state('bob'); viewer(other, 'Bob after owner trading');
      report.financialCheckpoint = { cash: closed.body.wallets.USDT.cash, realized: closed.body.realized.USDT, shares: '0.00000000', fills: closed.body.fills.length };
    });
    const lostOrder = order('lost-ack', { quantity: '0.2' });
    await test('lost HTTP acknowledgement, restart, same-ID retry and conflict', async () => {
      await fixture.command('dropAck');
      let lost = false; try { await call('alice', 'orders', lostOrder, alice.body.token); } catch (error) { check(error.code === 'ECONNRESET', 'lost ACK is a transport reset'); lost = true; }
      check(lost, 'client receives no successful order acknowledgement');
      check((await fixture.command('audit')).droppedAcknowledgements === 1, 'gateway retained committed upstream response before dropping ACK');
      await fixture.command('restart'); alice = await state('alice');
      const retried = await call('alice', 'orders', lostOrder, alice.body.token);
      check(retried.status === 200 && retried.body.fills.filter(x => x.orderId === lostOrder.id).length === 1, 'same ID filled only once');
      check(retried.body.wallets.USDT.cash === '9982.00000000' && retried.body.positions[ID + '|USDT'].quantity === '0.20000000', 'one debit after unknown outcome');
      const conflict = await call('alice', 'orders', { ...lostOrder, quantity: '0.3' }, alice.body.token);
      check(conflict.status === 422 && conflict.body.error === 'IDEMPOTENCY_CONFLICT', 'changed payload with same ID rejected');
    });
    await test('feature-off rejects cached credentials and CSRF without upstream work', async () => {
      const before = await fixture.command('audit'); await fixture.command('enabled', { value: false });
      for (const [route, body] of [['state'], ['portfolio'], ['history?id=' + encodeURIComponent(ID) + '&interval=15m'], ['orders', order('cached')], ['cancel', { id: lostOrder.id }]]) {
        const r = await call('alice', route, body, alice.body.token);
        check(r.status === 503 && r.body.error === 'LOCAL_STOCKS_UNAVAILABLE', 'cached client denied: ' + route.split('?')[0]);
      }
      const after = await fixture.command('audit');
      check(after.forwarded === before.forwarded && after.identityRequests === before.identityRequests && after.quotes === before.quotes, 'feature-off forwards no auth/market/ledger work');
    });
    await test('quiesced FULL SQLite backup, distinct-path restore and exact ledger reconciliation', async () => {
      const stopped = await fixture.command('quiesce'); check(stopped.closed === true, 'HTTP and account worker drained');
      report.quiescedAccountMetrics = stopped.accountMetrics;
      check(stopped.accountMetrics?.queue.active === 0 && stopped.accountMetrics?.queue.pending === 0, 'no accepted transaction remains at backup admission boundary');
      const original = inspectClosedDb(stopped.path, dataRoot);
      const restoredPath = path.join(dataRoot, 'restored.sqlite');
      fs.copyFileSync(stopped.path, restoredPath, fs.constants.COPYFILE_EXCL);
      if (process.platform !== 'win32') fs.chmodSync(restoredPath, 0o600);
      const copy = inspectClosedDb(restoredPath, dataRoot);
      check(copy.sha256 === original.sha256, 'backup bytes match'); check(JSON.stringify(copy.rows) === JSON.stringify(original.rows), 'every account/revision/order/fill/reservation matches');
      privateJson(path.join(output, 'backup-manifest.json'), { issuer: ISSUER, owner: 'alice', schema: 2, journal: 'DELETE', synchronous: 'FULL (runtime source; not inferred from a new read-only connection)',
        original: { path: stopped.path, sha256: original.sha256, bytes: original.bytes }, restored: { path: restoredPath, sha256: copy.sha256, bytes: copy.bytes }, integrity: 'ok', accounts: original.rows.map(x => ({ id: x.id, ledgerSha256: sha(JSON.stringify(x.ledger)) })) });
      await fixture.command('restore', { path: restoredPath }); alice = await state('alice'); bob = await state('bob');
      check(alice.body.positions[ID + '|USDT'].quantity === '0.20000000' && alice.body.wallets.USDT.cash === '9982.00000000', 'restored owner financial state');
      viewer(bob, 'Bob after exact backup restore');
      const retry = await call('alice', 'orders', lostOrder, alice.body.token);
      check(retry.status === 200 && retry.body.fills.filter(x => x.orderId === lostOrder.id).length === 1, 'restored idempotency retained');
      await fixture.command('quiesce');
      check(inspectClosedDb(restoredPath, dataRoot).rows.length === 1, 'restored viewer reads and owner retry never create a viewer account');
      check(inspectClosedDb(stopped.path, dataRoot).sha256 === original.sha256, 'original retained DB untouched by restored service');
      report.backup = { integrity: 'PASS', exactCopy: true, differentPath: true, originalRetained: true };
    });
    report.audit = await fixture.command('stop');
    const exit = await fixture.waitForExit(); check(exit.code === 0 && exit.signal === null, 'fixture child exited cleanly');
    check(report.audit.prisma.unexpected === 0, 'no unapproved Prisma operation');
    check(report.audit.deniedNetwork === 1, 'only intentional denied-network proof occurred');
    check(report.cases.length === CASES.length && report.cases.every(x => x.status === 'PASS'), 'every planned case executed');
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.failure = { message: error.message, stack: error.stack }; }
  finally {
    if (fixture && fixture.child.exitCode === null && fixture.child.signalCode === null) {
      try { await fixture.command('stop'); await fixture.waitForExit(); }
      catch (error) {
        report.status = 'FAIL'; report.cleanupError = error.message;
        try { await fixture.terminate(); } catch (terminationError) { report.terminationError = terminationError.message; }
      }
    }
    if (fixture) fs.writeFileSync(path.join(output, 'child.log'), fixture.logs.join(''), { flag: 'wx', mode: 0o600 });
    report.completedAt = new Date().toISOString(); privateJson(path.join(output, 'report.json'), report);
  }
  console.log(JSON.stringify({ status: report.status, cases: report.cases.map(x => ({ name: x.name, status: x.status })), assertions: report.assertions || 0, output, failure: report.failure || null }));
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (require.main === module) {
  assert.equal(process.argv[2], '--output'); assert.equal(process.argv.length, 4);
  assert.ok(path.isAbsolute(process.argv[3]), '--output must be absolute');
  main(path.resolve(process.argv[3])).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { fixtureProcess, main, stockRuntimeSources };
