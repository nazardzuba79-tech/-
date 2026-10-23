'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { verifySource } = require('./source-guard.cjs');
const { createDiagnostics } = require('./diagnostics.cjs');

const APP = '98c577d4241ce527f7bfca3b78dd7bb78255e300';
const source = process.env.STOCKS_SMOKE_TEST_SOURCE;
assert.ok(source, 'STOCKS_SMOKE_TEST_SOURCE must point to the existing immutable checkout');
const command = (bin, args, options) => cp.execFileSync(bin, args, {
  ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
assert.equal(command('git', ['rev-parse', 'HEAD'], { cwd: source }).trim(), APP);
const ts = createRequire(path.join(source, 'package.json'))('typescript');
const apiKeySource = fs.readFileSync(path.join(source, 'src/services/ApiKeyService.ts'), 'utf8');
assert.equal(apiKeySource.replace(/\r\n/g, '\n'),
  command('git', ['show', APP + ':src/services/ApiKeyService.ts'], { cwd: source }).replace(/\r\n/g, '\n'));
const compiled = ts.transpileModule(apiKeySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
}).outputText;
function importApiKeyModule(env) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, process: { env }, Buffer,
    require(name) { assert.equal(name, 'crypto', 'no DB or application dependency may execute'); return crypto; },
  }, { filename: 'immutable-ApiKeyService.js', timeout: 1000 });
  return exports;
}

// Execute the actual runner's credential generation and env construction, without
// running main(), Docker, a server, DB, or any external request.
function runnerEnvironment() {
  const runner = fs.readFileSync(path.join(__dirname, 'run.cjs'), 'utf8');
  const credentials = runner.slice(runner.indexOf('  const random ='), runner.indexOf('  const issuer ='));
  const identityStart = runner.indexOf('  const issuer =');
  const identity = runner.slice(identityStart, runner.indexOf('  fs.writeFileSync', identityStart));
  const environments = runner.slice(runner.indexOf('  const common ='), runner.indexOf("  network = 'stocks-positive-'"));
  assert.ok(credentials.includes('crypto.randomBytes(32)'));
  assert.ok(environments.includes("envFile('postgres'"));
  const secretValues = [], files = {};
  vm.runInNewContext(credentials + '\n' + identity + '\n' + environments, {
    crypto, secretValues, APP, process: { env: { GITHUB_RUN_ID: 'local_fixture_only' } },
    envFile(name, env) { files[name] = { ...env }; return name; },
  }, { timeout: 1000 });
  return { files, secretValues };
}

test('unchanged API module rejects missing encryption key', () => {
  assert.throws(() => importApiKeyModule({}), /API_KEY_ENCRYPTION_SECRET env var is required/);
});
test('runner supplies existing JWT, PG/TLS and two-principal authority prerequisites in both API modes', () => {
  const { files } = runnerEnvironment();
  for (const name of ['api', 'disabled']) {
    const env = files[name];
    assert.equal(env.NODE_ENV, 'production');
    assert.match(env.JWT_SECRET, /^[0-9a-f]{64}$/);
    assert.equal(env.DATABASE_URL, env.DIRECT_URL);
    const database = new URL(env.DATABASE_URL);
    assert.equal(database.hostname, '127.0.0.1');
    assert.equal(database.pathname, '/stocks_disposable_pg_tls_local_fixture_only');
    assert.equal(database.searchParams.get('sslmode'), 'require');
    assert.equal(database.searchParams.get('sslaccept'), 'strict');
    assert.equal(database.searchParams.get('sslcert'), '/smoke-private/cert.pem');
    assert.equal(env.NODE_EXTRA_CA_CERTS, '/smoke-private/cert.pem');
    assert.equal(env.STOCKS_IDENTITY_ISSUER, 'stocks-isolated-smoke');
    assert.match(env.STOCKS_TEST_CASH_GATEWAY_KEY, /^[0-9a-f]{64}$/);
    const principals = JSON.parse(env.STOCKS_TRADE_PRINCIPALS);
    assert.equal(principals.length, 2);
    assert.equal(new Set(principals.map(p => p.subject)).size, 2);
    assert.ok(principals.every(p => p.issuer === env.STOCKS_IDENTITY_ISSUER));
    assert.equal(env.GIT_COMMIT, APP);
  }
});
test('unchanged API module rejects malformed encryption keys', () => {
  for (const value of ['not-hex', 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64)]) {
    assert.throws(() => importApiKeyModule({ API_KEY_ENCRYPTION_SECRET: value }), /64-character hex string/);
  }
});
test('actual runner generates fresh 32-byte key and unchanged API module imports', () => {
  const first = runnerEnvironment(), second = runnerEnvironment();
  const key = first.files.api.API_KEY_ENCRYPTION_SECRET;
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.notEqual(key, second.files.api.API_KEY_ENCRYPTION_SECRET);
  assert.equal(typeof importApiKeyModule({ API_KEY_ENCRYPTION_SECRET: key }).ApiKeyService, 'function');
});
test('key reaches both API modes only and is redacted from stdout/stderr diagnostics', () => {
  const { files, secretValues } = runnerEnvironment();
  const key = files.api.API_KEY_ENCRYPTION_SECRET;
  assert.equal(files.disabled.API_KEY_ENCRYPTION_SECRET, key);
  assert.equal(files.disabled.STOCKS_TEST_CASH_ENABLED, 'false');
  assert.equal(files.api.STOCKS_TEST_CASH_ENABLED, 'true');
  for (const name of ['gateway', 'postgres']) assert.ok(!Object.hasOwn(files[name], 'API_KEY_ENCRYPTION_SECRET'));
  assert.ok(secretValues.includes(key));
  const messages = [], diagnostics = createDiagnostics({ secrets: secretValues, write: message => messages.push(message) });
  assert.throws(() => diagnostics.command(process.execPath,
    ['-e', 'process.stdout.write(process.env.FIXTURE_KEY);process.stderr.write(encodeURIComponent(process.env.FIXTURE_KEY));process.exit(7)'],
    { env: { ...process.env, FIXTURE_KEY: key } }), /exit=7/);
  const outputs = messages.map(message => JSON.parse(message));
  assert.deepEqual(outputs.map(output => output.stream), ['stdout', 'stderr']);
  for (const output of outputs) {
    assert.equal(output.status, 7);
    assert.equal(output.text, '[CI-secret-redacted]');
    assert.ok(!JSON.stringify(output).includes(key));
  }
});

function gitFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-source-guard-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('stocks-source-guard-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const harness = path.join(root, 'review'), source = path.join(root, 'source');
  fs.mkdirSync(harness);
  const git = (...args) => command('git', args, { cwd: harness }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Local fixture');
  git('config', 'user.email', 'fixture@invalid.test');
  git('config', 'core.autocrlf', 'false');
  function commit(file, value) {
    const target = path.join(harness, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    git('add', '--all');
    git('commit', '--quiet', '-m', 'local fixture');
    return git('rev-parse', 'HEAD');
  }
  const app = commit('src/index.ts', 'immutable application\n');
  command('git', ['clone', '--quiet', '--no-hardlinks', harness, source], { cwd: root });
  commit('review/stocks-pg-tls-98c577d4/run.cjs', 'first harness commit\n');
  commit('review/stocks-pg-tls-98c577d4/diagnostics.cjs', 'second harness commit\n');
  const options = () => ({ command, source, harness, app, expectedHead: git('rev-parse', 'HEAD') });
  return { git, commit, options, source, harness, app };
}
test('multiple harness-only commits pass ancestry, exact source/head and path guards', t => {
  const f = gitFixture(t);
  assert.notEqual(f.git('rev-parse', 'HEAD^'), f.app);
  assert.equal(verifySource(f.options()).changed.length, 2);
});
test('protected application mutation is rejected', t => {
  const f = gitFixture(t);
  f.commit('src/index.ts', 'changed financial application\n');
  assert.throws(() => verifySource(f.options()), /protected application path changed: src\/index.ts/);
});
test('moving protected code into the allowed directory is rejected', t => {
  const f = gitFixture(t);
  f.git('mv', 'src/index.ts', 'review/stocks-pg-tls-98c577d4/moved.ts');
  f.git('commit', '--quiet', '-m', 'rename fixture');
  assert.throws(() => verifySource(f.options()), /protected application path changed: src\/index.ts/);
});
test('unrelated history is rejected even when the net diff is harness-only', t => {
  const f = gitFixture(t);
  const tree = f.git('rev-parse', 'HEAD^{tree}');
  const orphan = f.git('commit-tree', tree, '-m', 'unrelated root');
  f.git('reset', '--quiet', '--hard', orphan);
  assert.throws(() => verifySource(f.options()), /merge-base/);
});
test('incorrect PR event head and source checkout are rejected', t => {
  const f = gitFixture(t);
  assert.throws(() => verifySource({ ...f.options(), expectedHead: f.app }), /exact PR event head/);
  assert.throws(() => verifySource({ ...f.options(), source: f.harness }), /exact APP/);
});
test('dirty source or harness fails closed', t => {
  const f = gitFixture(t);
  for (const cwd of [f.source, f.harness]) {
    const file = path.join(cwd, 'untracked-fixture.txt');
    fs.writeFileSync(file, 'dirty\n');
    assert.throws(() => verifySource(f.options()), /must be clean/);
    fs.unlinkSync(file);
  }
});
