'use strict';
// One authorized GitHub Linux run. This file cannot target an existing database.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { verifySource } = require('./source-guard.cjs');
const { createDiagnostics } = require('../stocks-pg-tls-98c577d4/diagnostics.cjs');
const APP = '133cb85a95003c229829b1ecef3d8d0e6308db95';
const NODE = 'node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392';
const PG = 'postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336';
const BRANCH = 'codex/stocks-private-topology-133cb85a-20261021';
const BASE = 'codex/stocks-pg-tls-smoke-98c577d4-20261020';
const BASE_SHA = '086a25a360caac261666c2d36148188294e99d74';
const receipt = { applicationSha: APP, result: 'NOT_RUN', realProductionBootstrap: 'NOT_RUN',
  marketData: 'CI-only fictional transport; unchanged application parsers/accounting',
  productionAccess: false, images: {}, stages: [] };
const secretValues = [];
const names = [];
let work, composeFile, project, apiId;
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
  assert.equal(event.label.name, 'stocks-private-pg-tls-133cb85a-approved');
  assert.equal(event.repository.private, false, 'only public-repository standard free runner authorized');
  assert.equal(event.pull_request.head.repo.full_name, 'nazardzuba79-tech/-');
  assert.equal(event.pull_request.head.ref, BRANCH);
  assert.equal(event.pull_request.base.ref, BASE);
  assert.equal(event.pull_request.base.sha, BASE_SHA);
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
  for (const folder of ['ca','tls','checks','socket']) fs.mkdirSync(path.join(work, folder));
  // Hosted runner is not UID0. Only initialize this newly created temporary
  // directory; never chmod/chown a host production path or loosen to world access.
  command('sudo',['install','-d','-o','10001','-g','10002','-m','0710',path.join(work,'socket')]);
  // Docker non-root process can traverse only this run's new fixture directories.
  fs.chmodSync(work, 0o755);
  fs.copyFileSync(path.join(__dirname, 'fixture.cjs'), path.join(work, 'fixture', 'fixture.cjs'));
  for(const file of ['unix-proxy.cjs','boundary.cjs','quota-trace.cjs']) fs.copyFileSync(path.join(__dirname,file),path.join(work,'fixture',file));
  fs.writeFileSync(path.join(work, 'fixture', 'base-schema.prisma'),
    command('git', ['show', '58540f49aed5d47a4458ab11270e0cb3aa7d26ce:prisma/schema.prisma'], { cwd: source }));
  const { prepare } = require(path.join(source, 'scripts/qa/stocks-build-only-prepare.cjs'));
  const prepared = prepare(source, path.join(work, 'build'), APP);
  const preparedContext = prepared.context || path.join(work, 'build', 'context');
  const context = path.join(work,'image-context');
  const packagedFiles = require('./image-context.cjs').stage(preparedContext,context);
  receipt.packagedSource = { fileCount:Object.keys(packagedFiles).length, manifestSha256:crypto.createHash('sha256').update(JSON.stringify(packagedFiles)).digest('hex'), reviewOrTestsIncluded:false };
  fs.writeFileSync(path.join(work,'packaged-source.json'),JSON.stringify(packagedFiles,null,2));
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
  const random = () => crypto.randomBytes(32).toString('hex');
  const password = random(), pgPassword = random(), jwt = random(), gatewayKey = random(), encryption = random();
  secretValues.push(password, pgPassword, jwt, gatewayKey, encryption);
  const databaseName = 'stocks_disposable_pg_tls_' + process.env.GITHUB_RUN_ID;
  const databaseUrl = `postgresql://stocks_fixture:${pgPassword}@postgres:5432/${databaseName}?sslmode=require&sslaccept=strict&sslcert=/smoke-private/cert.pem`;
  secretValues.push(databaseUrl);
  const issuer = 'stocks-isolated-smoke';
  const principals = ['stocks-smoke-trader-a','stocks-smoke-trader-b'].map(subject => ({ issuer, subject }));
  fs.writeFileSync(path.join(work,'checks/config.json'), JSON.stringify({ password,databaseUrl,gatewayKey,issuer,principals,jwtSecret:jwt }), { mode:0o444 });
  command('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
    '-keyout',path.join(work,'tls/key.pem'),'-out',path.join(work,'tls/cert.pem'),'-subj','/CN=stocks.fixture.invalid',
    '-addext','subjectAltName=DNS:stocks.fixture.invalid,DNS:postgres,DNS:localhost,IP:127.0.0.1,DNS:api.bybit.com,DNS:api.binance.com,DNS:iss.moex.com,DNS:www.cbr.ru,DNS:api.kraken.com']);
  fs.chmodSync(path.join(work,'tls/key.pem'),0o444);
  fs.copyFileSync(path.join(work,'tls/cert.pem'),path.join(work,'ca/cert.pem'));
  const ca = { NODE_EXTRA_CA_CERTS:'/smoke-private/cert.pem' };
  const shared = { ...ca, NODE_ENV:'production', JWT_SECRET:jwt, API_KEY_ENCRYPTION_SECRET:encryption,
    DATABASE_URL:databaseUrl, DIRECT_URL:databaseUrl, GIT_COMMIT:APP,
    STOCKS_CATALOGUE_ENABLED:'true', STOCKS_TEST_CASH_ENABLED:'true', STOCKS_IDENTITY_ISSUER:issuer,
    STOCKS_TEST_CASH_GATEWAY_KEY:gatewayKey, STOCKS_TRADE_PRINCIPALS:JSON.stringify(principals),
    ALLOWED_ORIGINS:'https://stocks.fixture.invalid:4443' };
  envFile('api',{ ...shared, PORT:'3000', STOCKS_AUTHORITY_INTERNAL_PORT:'3001', STOCKS_AUTHORITY_REQUESTS_PER_MINUTE:'240',
    NODE_OPTIONS:'--require=/smoke/quota-trace.cjs', STOCKS_QUOTA_TRACE_SCOPE:'disposable-private-topology', STOCKS_QUOTA_TRACE_APP:APP });
  envFile('disabled',{ ...shared, PORT:'3010', STOCKS_AUTHORITY_INTERNAL_PORT:'3011',
    STOCKS_AUTHORITY_REQUESTS_PER_MINUTE:'240', STOCKS_TEST_CASH_ENABLED:'false' });
  envFile('gateway',{ ...ca, STOCKS_IDENTITY_ISSUER:issuer, STOCKS_TEST_CASH_GATEWAY_KEY:gatewayKey,
    STOCKS_TRADE_PRINCIPALS:JSON.stringify(principals), STOCKS_TEST_CASH_AUTHORITY_URL:'http://127.0.0.1:3001/api/v1/stocks-test-cash',
    STOCKS_MARKET_DATA_ENABLED:'true', STOCKS_BINANCE_WS_ENABLED:'false',
    STOCKS_GLOBAL_PORT:'4437', STOCKS_INGRESS_PORT:'4438', STOCKS_PUBLIC_ORIGIN:'https://stocks.fixture.invalid:4443' });
  envFile('postgres',{ POSTGRES_USER:'stocks_fixture', POSTGRES_PASSWORD:pgPassword, POSTGRES_DB:databaseName });
  for(const role of ['checks','provider','proxy','frontend']) envFile(role,ca);
  project = 'stocks-private-' + process.env.GITHUB_RUN_ID;
  const topology = require('./topology.cjs').compose({ work, project, apiImage:receipt.images.api.id,
    gatewayImage:receipt.images.gateway.id, pgImage:receipt.images.postgres.id });
  composeFile = path.join(work,'compose.staging.json');
  fs.writeFileSync(composeFile,JSON.stringify(topology,null,2));
  const compose = args => docker(['compose','--project-name',project,'--file',composeFile,...args],{ timeout:180000 });
  const id = service => compose(['ps','--all','--quiet',service]).trim();
  const remember = service => { const cid=id(service); assert.match(cid,/^[a-f0-9]{64}$/); if(!names.includes(cid))names.push(cid); return cid; };
  const up = service => { compose(['up','-d','--no-deps',service]); return remember(service); };
  const once = async service => { const cid=up(service); const code=docker(['wait',cid],{timeout:240000}); dockerLogs(cid,service+'-exit'); assert.equal(code,'0',service+' failed; no rerun'); return cid; };
  receipt.composeVersion = docker(['compose','version','--short']);
  // No production secrets, host ports or external runtime network. No Docker socket mounted.
  compose(['config','--quiet']);
  const pg = up('postgres');
  const net = JSON.parse(docker(['network','inspect',project+'_isolated']))[0]; assert.equal(net.Internal,true);
  await waitFor(pg,()=>{ try { docker(['exec',pg,'pg_isready','-U','stocks_fixture','-d',databaseName,'-h','127.0.0.1']); return true; } catch { return false; } });
  receipt.postgresVersion=docker(['exec',pg,'postgres','--version']); assert.match(receipt.postgresVersion,/18\.6\b/);
  stage('isolated-pg-bridge-ready',{ publishedPorts:0, productionCredentials:false, databaseName });
  await once('setup');
  const api=up('api-production'); apiId=api;
  const provider=up('provider');
  await waitFor(provider,()=>dockerLogs(provider,'provider-readiness').includes('local-provider-transport-listening'));
  const disabled=up('finance-off');
  for(const [cid,port] of [[api,3000],[disabled,3010]]) await waitFor(cid,()=>{
    try { docker(['exec',cid,'node','-e',`fetch('http://127.0.0.1:${port}/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))`]); return true; } catch { return false; }
  });
  const gateway=up('gateway');
  await waitFor(gateway,()=>dockerLogs(gateway,'gateway-readiness').includes('STOCKS_RELEASE_LISTENING'));
  const proxy=up('unix-ingress');
  await waitFor(proxy,()=>dockerLogs(proxy,'unix-readiness').includes('UNIX_INGRESS_READY'));
  const front=up('frontend');
  await waitFor(front,()=>dockerLogs(front,'tls-readiness').includes('local-tls-proxy-listening'));
  const apiNamespace=docker(['exec',api,'readlink','/proc/self/ns/net']);
  for(const service of ['gateway','unix-ingress','provider','finance-off']) {
    const cid=id(service); assert.equal(inspect(cid).HostConfig.NetworkMode,'container:'+api);
    assert.equal(docker(['exec',cid,'readlink','/proc/self/ns/net']),apiNamespace);
  }
  for(const cid of [pg,front]) assert.notEqual(docker(['exec',cid,'readlink','/proc/self/ns/net']),apiNamespace);
  for(const cid of names) assert.equal(Object.keys(inspect(cid).HostConfig.PortBindings??{}).length,0);
  // Confirm sidecars inherit provider host mapping rather than using external DNS.
  for(const cid of [api,gateway]) {
    const hosts=docker(['exec',cid,'cat','/etc/hosts']);
    for(const host of require('./topology.cjs').PROVIDERS) assert.ok(hosts.split('\n').some(line=>line.trim().split(/\s+/)[0]==='127.0.0.1'&&line.trim().split(/\s+/).includes(host)), 'provider fixture host mapping missing');
  }
  stage('api-owned-network-namespace-and-unix-ingress-verified',{ apiNamespace, noPublishedPorts:true, privatePort:3001 });
  await once('outsider');
  await once('checks');
  receipt.result='PASS';
}
main().catch(error=>{
  receipt.result='FAIL'; receipt.error=redact(error.stack||error.message);
  if(Object.hasOwn(error,'status'))receipt.commandFailure={exitCode:error.status,signal:error.signal,errorCode:error.errorCode};
  process.exitCode=1;
}).finally(()=>{
  // Discover every service even if a start command failed before remember().
  if(composeFile)try {
    const ids=docker(['compose','--project-name',project,'--file',composeFile,'ps','--all','--quiet']).split(/\s+/).filter(Boolean);
    for(const cid of ids)if(!names.includes(cid))names.push(cid);
  }catch(error){receipt.discoveryError=redact(error.message);}
  if(apiId)try {
    const lines=dockerLogs(apiId,'quota-envelope').split('\n');
    const events=lines.flatMap(line=>{try {const v=JSON.parse(line);return v.trace==='private-quota'?[v]:[];}catch{return [];}});
    receipt.quotaSummary=events.at(-1)??{status:'NO_QUOTA_TRACE'};
  }catch(error){receipt.quotaDiagnosticsError=redact(error.message);}
  for(const cid of names)captureContainer(cid,'final-state-before-cleanup');
  if(composeFile)try { docker(['compose','--project-name',project,'--file',composeFile,'down','--volumes','--timeout','10'],{timeout:60000}); }
  catch(error){receipt.cleanupError=redact(error.message);receipt.result='FAIL';process.exitCode=1;}
  const safe=redact(JSON.stringify(receipt,null,2));
  if(work)fs.writeFileSync(path.join(work,'receipt.json'),safe);
  console.log('STOCKS_PRIVATE_PG_TLS_RECEIPT\n'+safe);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '\n### Stocks private topology PG/TLS\n```json\n'+safe+'\n```\nREAL_PRODUCTION_BOOTSTRAP=NOT_RUN. No production readiness claim.\n');
});
