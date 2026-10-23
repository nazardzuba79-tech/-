'use strict';
// One authorized GitHub Linux run. This file cannot target an existing database.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { verifySource } = require('./source-guard.cjs');
const { createDiagnostics } = require('./diagnostics.cjs');
const APP = '98c577d4241ce527f7bfca3b78dd7bb78255e300';
const NODE = 'node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392';
const PG = 'postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336';
const BRANCH = 'codex/stocks-pg-tls-smoke-98c577d4-20261020';
const BASE = 'codex/stocks-build-only-f97b7f9c-20261020';
const receipt = { applicationSha: APP, result: 'NOT_RUN', realProductionBootstrap: 'NOT_RUN',
  marketData: 'CI-only fictional transport; unchanged application parsers/accounting',
  productionAccess: false, images: {}, stages: [] };
const secretValues = [];
const names = [];
let work, network;
const { command, docker, dockerLogs, redact, captureContainer, waitFor } =
  createDiagnostics({ secrets: secretValues });
function stage(name, data = {}) {
  receipt.stages.push({ name, result: 'PASS', ...data });
  console.log(JSON.stringify({ stage: name, result: 'PASS', ...data }));
}
function envFile(name, data) {
  const target = path.join(work, name + '.env');
  for (const value of Object.values(data)) assert.ok(!/[\r\n]/.test(String(value)));
  fs.writeFileSync(target, Object.entries(data).map(([k, v]) => k + '=' + v).join('\n') + '\n', { mode: 0o600 });
  return target;
}
function containerName(suffix) {
  const name = 'stocks-smoke-' + process.env.GITHUB_RUN_ID + '-' + suffix;
  names.push(name); return name;
}
function runNode(name, image, env, args = []) {
  return docker(['run', '-d', '--name', name, '--network', 'container:' + names[0],
    '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '128', '--memory', '768m',
    '--mount', `type=bind,src=${path.join(work, 'fixture')},dst=/smoke,readonly`,
    '--mount', `type=bind,src=${path.join(work, 'private')},dst=/smoke-private,readonly`,
    ...(env ? ['--env-file', env] : []), image, ...args]);
}
function inspect(name) { return JSON.parse(docker(['inspect', name]))[0]; }
async function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.versions.node, '22.23.3');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_OS, 'Linux');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.env.ImageOS, 'ubuntu24');
  assert.equal(process.env.GITHUB_REPOSITORY, 'nazardzuba79-tech/-');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1', 'reruns not authorized');
  assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'remote Docker prohibited');
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  assert.equal(event.action, 'labeled');
  assert.equal(event.label.name, 'stocks-positive-pg-tls-approved');
  assert.equal(event.repository.private, false, 'only public-repository standard free runner authorized');
  assert.equal(event.pull_request.head.repo.full_name, 'nazardzuba79-tech/-');
  assert.equal(event.pull_request.head.ref, BRANCH);
  assert.equal(event.pull_request.base.ref, BASE);
  assert.equal(event.pull_request.base.sha, APP);
  assert.equal(event.pull_request.draft, true);
  const source = path.resolve(process.argv[2]);
  const harness = path.resolve(__dirname, '../..');
  const { sourceHead, harnessHead, changed } = verifySource({
    command, source, harness, app: APP, expectedHead: event.pull_request.head.sha,
  });
  receipt.harnessSha = harnessHead;
  receipt.runId = process.env.GITHUB_RUN_ID;
  receipt.runAttempt = process.env.GITHUB_RUN_ATTEMPT;
  receipt.node = process.version;
  receipt.docker = docker(['version', '--format', '{{.Server.Version}}']);
  receipt.runner = 'ubuntu-24.04 (standard public-repository runner)';
  assert.equal(docker(['context', 'show']), 'default');
  stage('source-harness-and-runner-guards', { sourceHead, harnessHead, changed });
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-positive-pg-tls-'));
  fs.mkdirSync(path.join(work, 'fixture'));
  fs.mkdirSync(path.join(work, 'private'));
  // Docker non-root process can traverse only this run's new fixture directories.
  fs.chmodSync(work, 0o755);
  fs.copyFileSync(path.join(__dirname, 'fixture.cjs'), path.join(work, 'fixture', 'fixture.cjs'));
  fs.copyFileSync(path.join(__dirname, 'auth-trace.cjs'), path.join(work, 'fixture', 'auth-trace.cjs'));
  fs.writeFileSync(path.join(work, 'fixture', 'base-schema.prisma'),
    command('git', ['show', '58540f49aed5d47a4458ab11270e0cb3aa7d26ce:prisma/schema.prisma'], { cwd: source }));
  const { prepare } = require(path.join(source, 'scripts/qa/stocks-build-only-prepare.cjs'));
  const prepared = prepare(source, path.join(work, 'build'), APP);
  const context = prepared.context || path.join(work, 'build', 'context');
  assert.ok(fs.existsSync(path.join(context, 'stocks-release-migrations')), 'verified SQL package missing');
  receipt.sql = JSON.parse(fs.readFileSync(path.join(work, 'build', 'sql-byte-receipt.json'), 'utf8'));
  stage('immutable-44-plus-2-SQL-packaging');
  const original = fs.readFileSync(path.join(context, 'services/stocks-global/Dockerfile.release'), 'utf8');
  assert.equal((original.match(/FROM node:22\.23\.3-bookworm-slim/g) || []).length, 2);
  const pinned = original.replaceAll('node:22.23.3-bookworm-slim', NODE);
  const recipe = path.join(work, 'Dockerfile.release.pinned');
  fs.writeFileSync(recipe, pinned);
  receipt.recipe = {
    sourceSha256: crypto.createHash('sha256').update(original).digest('hex'),
    buildSha256: crypto.createHash('sha256').update(pinned).digest('hex'),
    substitutionOnly: NODE,
  };
  for (const target of ['api', 'gateway']) {
    const tag = 'stocks-positive-' + target + ':' + process.env.GITHUB_RUN_ID;
    const iid = path.join(work, target + '.iid');
    const out = docker(['build', '--builder', 'default', '--target', target, '--iidfile', iid,
      '--label', 'org.opencontainers.image.revision=' + APP, '--tag', tag,
      '--file', recipe, context], { timeout: 900000 });
    console.log(redact(out.slice(-1800)));
    const id = fs.readFileSync(iid, 'utf8').trim();
    assert.match(id, /^sha256:[0-9a-f]{64}$/);
    const image = JSON.parse(docker(['image', 'inspect', tag]))[0];
    assert.equal(image.Id, id);
    assert.equal(image.Config.Labels['org.opencontainers.image.revision'], APP);
    assert.deepEqual(image.Config.Cmd, target === 'api' ? ['node', 'dist/index.js'] :
      ['node', 'services/stocks-global/release-entrypoint.mjs']);
    assert.deepEqual(image.Config.Entrypoint, ['docker-entrypoint.sh']);
    assert.equal(image.Config.User, 'node');
    receipt.images[target] = { id, tag, command: image.Config.Cmd, entrypoint: image.Config.Entrypoint };
    stage(target + '-image-built', receipt.images[target]);
  }
  docker(['pull', PG], { timeout: 120000 });
  receipt.images.postgres = { reference: PG, id: JSON.parse(docker(['image', 'inspect', PG]))[0].Id };
  stage('all-images-available-before-isolated-smoke');
  // All credentials are created in this job, never read from repository secrets/.env.
  const random = () => crypto.randomBytes(32).toString('hex');
  const password = random(), pgPassword = random(), jwt = random(), gatewayKey = random();
  const apiEncryptionSecret = random();
  secretValues.push(password, pgPassword, jwt, gatewayKey, apiEncryptionSecret);
  const databaseName = 'stocks_disposable_pg_tls_' + process.env.GITHUB_RUN_ID;
  const databaseUrl = `postgresql://stocks_fixture:${pgPassword}@127.0.0.1:5432/${databaseName}?sslmode=require&sslaccept=strict&sslcert=/smoke-private/cert.pem`;
  secretValues.push(databaseUrl);
  const issuer = 'stocks-isolated-smoke';
  const principals = ['stocks-smoke-trader-a', 'stocks-smoke-trader-b'].map(subject => ({ issuer, subject }));
  fs.writeFileSync(path.join(work, 'private', 'config.json'),
    JSON.stringify({ password, databaseUrl, gatewayKey, issuer, principals, jwtSecret: jwt }), { mode: 0o444 });
  command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', path.join(work, 'private', 'key.pem'), '-out', path.join(work, 'private', 'cert.pem'),
    '-subj', '/CN=stocks.fixture.invalid',
    '-addext', 'subjectAltName=DNS:stocks.fixture.invalid,DNS:localhost,IP:127.0.0.1,DNS:api.bybit.com,DNS:api.binance.com,DNS:iss.moex.com,DNS:www.cbr.ru,DNS:api.kraken.com']);
  fs.chmodSync(path.join(work, 'private', 'key.pem'), 0o444);
  const common = { NODE_EXTRA_CA_CERTS: '/smoke-private/cert.pem' };
  const trace = { NODE_OPTIONS: '--require=/smoke/auth-trace.cjs',
    STOCKS_SMOKE_TRACE: 'isolated-v1', STOCKS_SMOKE_TRACE_APP: APP };
  const shared = { ...common, NODE_ENV: 'production', JWT_SECRET: jwt,
    API_KEY_ENCRYPTION_SECRET: apiEncryptionSecret,
    DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, GIT_COMMIT: APP,
    STOCKS_CATALOGUE_ENABLED: 'true', STOCKS_TEST_CASH_ENABLED: 'true',
    STOCKS_IDENTITY_ISSUER: issuer, STOCKS_TEST_CASH_GATEWAY_KEY: gatewayKey,
    STOCKS_TRADE_PRINCIPALS: JSON.stringify(principals), ALLOWED_ORIGINS: 'https://stocks.fixture.invalid:4443' };
  const apiEnv = envFile('api', { ...shared, ...trace, STOCKS_SMOKE_TRACE_ROLE: 'api', PORT: '3000' });
  const disabledEnv = envFile('disabled', { ...shared, ...trace, STOCKS_SMOKE_TRACE_ROLE: 'finance-off',
    PORT: '3001', STOCKS_TEST_CASH_ENABLED: 'false' });
  const gatewayEnv = envFile('gateway', { ...common, ...trace, STOCKS_SMOKE_TRACE_ROLE: 'gateway', STOCKS_IDENTITY_ISSUER: issuer,
    STOCKS_TEST_CASH_GATEWAY_KEY: gatewayKey, STOCKS_TRADE_PRINCIPALS: JSON.stringify(principals),
    STOCKS_TEST_CASH_AUTHORITY_URL: 'http://127.0.0.1:3000/api/v1/stocks-test-cash',
    STOCKS_MARKET_DATA_ENABLED: 'true', STOCKS_BINANCE_WS_ENABLED: 'false',
    STOCKS_GLOBAL_PORT: '4437', STOCKS_INGRESS_PORT: '4438',
    STOCKS_PUBLIC_ORIGIN: 'https://stocks.fixture.invalid:4443' });
  const pgEnv = envFile('postgres', { POSTGRES_USER: 'stocks_fixture', POSTGRES_PASSWORD: pgPassword,
    POSTGRES_DB: databaseName });
  network = 'stocks-positive-' + process.env.GITHUB_RUN_ID;
  docker(['network', 'create', '--internal', network]);
  const net = JSON.parse(docker(['network', 'inspect', network]))[0];
  assert.equal(net.Internal, true);
  const anchor = containerName('namespace');
  docker(['run', '-d', '--name', anchor, '--network', network, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--sysctl', 'net.ipv4.ip_unprivileged_port_start=0',
    '--pids-limit', '32', '--memory', '64m',
    ...['api.bybit.com', 'api.binance.com', 'iss.moex.com', 'www.cbr.ru', 'api.kraken.com', 'stocks.fixture.invalid']
      .flatMap(host => ['--add-host', host + ':127.0.0.1']),
    receipt.images.api.tag, 'node', '-e', 'setInterval(()=>{},60000)']);
  assert.ok(!inspect(anchor).HostConfig.PortBindings || !Object.keys(inspect(anchor).HostConfig.PortBindings).length);
  stage('isolation-confirmed-before-start', { internalNetwork: true, publishedPorts: 0,
    productionSecrets: false, fabricatedUsers: true, databaseName,
    externalProviderTransport: 'blocked; private TLS fixtures only' });
  const pg = containerName('postgres');
  docker(['run', '-d', '--name', pg, '--network', 'container:' + anchor,
    '--env-file', pgEnv, '--tmpfs', '/var/lib/postgresql:rw,nosuid,nodev,size=512m',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m', '--memory', '768m',
    '--mount', `type=bind,src=${path.join(work, 'private')},dst=/smoke-private,readonly`,
    PG, 'sh', '-ec',
    'cp /smoke-private/key.pem /tmp/pg.key; cp /smoke-private/cert.pem /tmp/pg.crt; chown postgres:postgres /tmp/pg.key /tmp/pg.crt; chmod 600 /tmp/pg.key; exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/pg.crt -c ssl_key_file=/tmp/pg.key']);
  await waitFor(pg, () => {
    try { docker(['exec', pg, 'pg_isready', '-U', 'stocks_fixture', '-d', databaseName, '-h', '127.0.0.1']); return true; }
    catch { return false; }
  });
  receipt.postgresVersion = docker(['exec', pg, 'postgres', '--version']);
  assert.match(receipt.postgresVersion, /18\.6\b/);
  const setup = containerName('setup');
  runNode(setup, receipt.images.api.tag, envFile('fixture', common), ['node', '/smoke/fixture.cjs', 'setup']);
  const setupExit = docker(['wait', setup], { timeout: 120000 });
  dockerLogs(setup, 'schema-setup-exit');
  assert.equal(setupExit, '0', 'disposable schema/bindings setup failed');
  stage('disposable-schema-and-identities-created');
  const transport = containerName('transport');
  runNode(transport, receipt.images.api.tag, envFile('transport', common), ['node', '/smoke/fixture.cjs', 'transport']);
  await waitFor(transport, () => dockerLogs(transport, 'transport-readiness').includes('local-tls-proxy-listening'));
  const api = containerName('api');
  runNode(api, receipt.images.api.tag, apiEnv); // image's unchanged default CMD
  await waitFor(api, () => {
    try { docker(['exec', transport, 'node', '/smoke/fixture.cjs', 'ready']); return true; }
    catch { return false; }
  });
  const disabled = containerName('financial-off');
  runNode(disabled, receipt.images.api.tag, disabledEnv);
  await waitFor(disabled, () => {
    try {
      docker(['exec', disabled, 'node', '-e',
        "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]);
      return true;
    } catch { return false; }
  });
  const gateway = containerName('gateway');
  runNode(gateway, receipt.images.gateway.tag, gatewayEnv); // unchanged PG-only default CMD
  await waitFor(gateway, () => dockerLogs(gateway, 'gateway-readiness').includes('STOCKS_RELEASE_LISTENING'));
  for (const name of [api, disabled, gateway]) {
    const current = inspect(name);
    assert.equal(current.State.Running, true);
    assert.ok(['container:' + anchor, 'container:' + inspect(anchor).Id].includes(current.HostConfig.NetworkMode));
    assert.ok(!current.HostConfig.PortBindings || !Object.keys(current.HostConfig.PortBindings).length);
    const hosts = docker(['exec', name, 'node', '-e',
      "process.stdout.write(require('fs').readFileSync('/etc/hosts','utf8'))"]);
    for (const host of ['api.bybit.com', 'api.binance.com', 'iss.moex.com']) {
      assert.ok(hosts.split('\n').some(line => line.trim().split(/\s+/)[0] === '127.0.0.1' &&
        line.trim().split(/\s+/).includes(host)), 'fixture hostname mapping missing: ' + host);
    }
  }
  stage('actual-default-api-and-pg-only-gateway-running');
  const driver = containerName('checks');
  runNode(driver, receipt.images.api.tag, envFile('checks', common), ['node', '/smoke/fixture.cjs', 'check']);
  const result = docker(['wait', driver], { timeout: 240000 });
  dockerLogs(driver, 'financial-checks-exit');
  assert.equal(result, '0', 'positive HTTP/PG/TLS smoke failed; rerun not authorized');
  receipt.result = 'PASS';
}
main().catch(error => {
  receipt.result = 'FAIL';
  receipt.error = redact(error.stack || error.message);
  if (Object.hasOwn(error, 'status')) receipt.commandFailure = {
    exitCode: error.status, signal: error.signal, errorCode: error.errorCode,
  };
  console.error(receipt.error);
  process.exitCode = 1;
}).finally(() => {
  // Logs and partial receipts are printed even when a build/start/check fails.
  for (const name of names) {
    captureContainer(name, 'finalize-before-removal');
  }
  console.log('STOCKS_POSITIVE_SMOKE_RECEIPT\n' + JSON.stringify(receipt, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## Isolated Stocks PG/TLS smoke\n```json\n' + JSON.stringify(receipt, null, 2) + '\n```\n');
  for (const name of [...names].reverse()) {
    try { docker(['rm', '-f', '-v', name]); } catch { /* per-container diagnostics already retained */ }
  }
  if (network) { try { docker(['network', 'rm', network]); } catch { /* runner is disposable */ } }
  // Only newly generated CI fixture files; never any repository/workspace path.
  if (work && path.dirname(work) === os.tmpdir() && path.basename(work).startsWith('stocks-positive-pg-tls-'))
    fs.rmSync(work, { recursive: true, force: true });
});
