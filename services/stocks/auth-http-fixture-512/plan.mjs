// Review-only auth transport diagnostic. The original targeted-http-512 plan is immutable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PLAN_ID = 'stocks-auth-http-fixture-512-v2';
export const ISSUER = 'compact-principal-counterfactual-fixture';
export const SUBJECTS = Object.freeze(['alice', 'bob', ...Array.from({ length: 48 }, (_, i) => `user${String(i + 3).padStart(3, '0')}`)]);
export const LIMITS = Object.freeze({ serviceCpuMax: '5000 100000', auxiliaryCpuMax: '50000 100000', memory: 268435456,
  serviceCpu: '0', auxiliaryCpu: '1', swap: '0', readBps: 1048576, writeBps: 131072, deadlineMs: 3000,
  abortMs: 250, drainMs: 10000, sampleMs: 100, startupProbes: 40, startupCadenceMs: 250, startupDeadlineMs: 500,
  runMs: 300000, totalMs: 2100000, maxHttpBody: 2097152, maxRpcBytes: 4194304, maxRecords: 4000 });
export const COUNTS = Object.freeze({ runs: 6, ordinaryPerRun: 225, ordinary: 1350, scheduledAborts: 30,
  warmup: 300, gatewaySafety: 102, directAuthority: 312, healthMaximum: 240 });
export const SEED = Object.freeze({ api: 'openAccountWorker.forPrincipal', schema: 2, revision: 0,
  wallets: { USDT: { cash: '10000.00000000', reserved: '0.00000000' }, USDC: { cash: '10000.00000000', reserved: '0.00000000' } }, feeBps: 0,
  positions: 0, orders: 0, fills: 0, adjustments: 0, journal: 'delete', synchronous: 2 });
export const SAFETY = Object.freeze([
  { name: 'alice', subject: 'alice', status: 200 },
  { name: 'bob', subject: 'bob', status: 200 },
  { name: 'bob-forged-owner', subject: 'bob', forged: true, status: 200 },
  { name: 'foreign-selector', subject: 'alice', path: '/__stocks_global/state?userId=bob', status: 400, code: 'QUERY_NOT_ALLOWED', proxyOnly: true },
  { name: 'feature-off', subject: 'alice', enabled: false, status: 503, code: 'LOCAL_STOCKS_UNAVAILABLE', proxyOnly: true },
  { name: 'feature-restored', subject: 'alice', enabled: true, status: 200 },
  { name: 'before-revoke', subject: 'alice', status: 200 },
  { name: 'revoked', subject: 'alice', control: 'revoke', status: 401, code: 'AUTH_REQUIRED' },
  { name: 'session-restored', subject: 'alice', control: 'restore-session', status: 200 },
  { name: 'deleted', subject: 'alice', control: 'delete', status: 401, code: 'AUTH_REQUIRED' },
  { name: 'user-restored', subject: 'alice', control: 'restore-user', status: 200 },
  { name: 'blocked', subject: 'alice', control: 'contact-block', status: 401, code: 'AUTH_REQUIRED' },
  { name: 'unblocked', subject: 'alice', control: 'unblock', status: 200 },
  { name: 'post-auth-deleted', subject: 'alice', control: 'post-auth-delete', status: 401, code: 'AUTH_REQUIRED' },
  { name: 'post-auth-restored', subject: 'alice', control: 'restore-user', status: 200 },
  { name: 'authority-unavailable', subject: 'alice', control: 'fail-session', status: 503, code: 'AUTH_UNAVAILABLE' },
  { name: 'authority-restored', subject: 'alice', control: 'restore-session', status: 200 },
]);
export function schedule() {
  return [[5, 20, 50], [50, 5, 20], [20, 50, 5]].flatMap((cohorts, pair) =>
    (pair === 1 ? ['C', 'P'] : ['P', 'C']).map(variant => ({ pair, variant, cohorts: [...cohorts], runId: `pair${pair + 1}-${variant}` })));
}
export function ordinaryWaves(row) {
  return row.cohorts.flatMap(cohort => Array.from({ length: 3 }, (_, wave) => ({ cohort, wave,
    requests: SUBJECTS.slice(0, cohort).map(subject => ({ subject, requestId: `${row.runId}-ordinary-${cohort}-${wave}-${subject}` })) })));
}
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const planHash = () => sha256(JSON.stringify({ PLAN_ID, ISSUER, SUBJECTS, LIMITS, COUNTS, SEED, SAFETY, schedule: schedule() }));
export function validateResources(proof, role, device) {
  assert.ok(['service', 'authority', 'driver'].includes(role));
  assert.equal(proof.cpuMax?.trim(), role === 'service' ? LIMITS.serviceCpuMax : LIMITS.auxiliaryCpuMax, 'CPU quota proof');
  assert.equal(proof.memoryMax?.trim(), String(LIMITS.memory), 'memory proof');
  assert.equal(proof.swapMax?.trim(), LIMITS.swap, 'swap proof');
  assert.equal(proof.cpuset?.trim(), role === 'service' ? LIMITS.serviceCpu : LIMITS.auxiliaryCpu, 'CPU placement proof');
  if (role === 'service') {
    assert.match(device || '', /^\d+:\d+$/);
    assert.ok(proof.ioMax?.split('\n').some(line => line.trim().split(/\s+/)[0] === device &&
      /\brbps=1048576\b/.test(line) && /\bwbps=131072\b/.test(line)), 'original disk limits missing');
  }
}
export function nearestRank(values, fraction) {
  assert.ok(fraction > 0 && fraction <= 1);
  const rows = values.filter(x => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  assert.equal(rows.length, values.length, 'invalid latency cannot be omitted');
  return rows.length ? rows[Math.max(0, Math.ceil(rows.length * fraction) - 1)] : null;
}
export function latencySummary(rows) {
  const values = rows.map(r => r.elapsedMs);
  return { n: rows.length, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null,
    p50: nearestRank(values, .5), p95: nearestRank(values, .95), p99: nearestRank(values, .99) };
}
export function verifyUniqueTerminals(rows, expected) {
  assert.equal(rows.length, expected.length, 'missing terminal attempts');
  const ids = new Set();
  for (const row of rows) { assert.ok(expected.includes(row.requestId), 'unexpected attempt'); assert.ok(!ids.has(row.requestId), 'duplicate terminal');
    ids.add(row.requestId); assert.ok(['HTTP', 'DEADLINE', 'ABORTED_CLIENT', 'TRANSPORT_ERROR'].includes(row.outcome));
    assert.ok(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0); }
}
export function classifyRun(rows, evidenceIssues = []) {
  if (evidenceIssues.length) return 'INCOMPLETE';
  return rows.some(row => row.outcome !== 'HTTP' || row.status !== 200) ? 'FAIL' : 'PASS';
}
const SAFETY_CODES = new Set(['SAFETY_CONTRACT_MISMATCH', 'SAFETY_LEDGER_CHANGED', 'SAFETY_LEDGER_WRITE',
  'SAFETY_PROVIDER_ACCESS', 'SAFETY_UNEXPECTED_PRISMA', 'SAFETY_UNREGISTERED_AUTHORITY', 'SAFETY_ACCOUNT_RESPONSE']);
export function safetyCode(error) {
  const code = String(error?.code || error?.message || error).match(/^SAFETY_[A-Z_]+\b/)?.[0]; return SAFETY_CODES.has(code) ? code : null;
}
export function assertSafety(condition, code) {
  assert.ok(SAFETY_CODES.has(code)); if (!condition) { const error = Error(code); error.code = code; throw error; }
}
export function failureVerdict(error) {
  return { status: safetyCode(error) ? 'FAIL' : 'INCOMPLETE', safetyStatus: safetyCode(error) ? 'FAIL' : 'NOT_EVALUATED', datasetStatus: 'INCOMPLETE' };
}
export function cancellationCoverage(rows, authorityEvents = []) {
  assert.equal(rows.length, 5);
  return rows.some(row => row.outcome === 'ABORTED_CLIENT' && authorityEvents.some(event => event.type === 'authority-terminal' && event.requestId === row.requestId &&
    event.startedMonoNs && event.endedMonoNs && BigInt(event.startedMonoNs) <= BigInt(row.endedMonoNs) && BigInt(event.endedMonoNs) >= BigInt(row.endedMonoNs))) ? 'OBSERVED' : 'NOT_PROVEN';
}
export function terminalTiming(proposed, elapsedMs, deadlineMs, scheduledAbortMs, abortTimerFired) {
  assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
  return { outcome: elapsedMs >= deadlineMs ? 'DEADLINE' : proposed,
    completedBeforeScheduledAbort: proposed === 'HTTP' && scheduledAbortMs !== undefined && elapsedMs < scheduledAbortMs,
    completedBeforeAbortTimer: proposed === 'HTTP' && scheduledAbortMs !== undefined && !abortTimerFired };
}
export function reconcileAuthority(rows, events) {
  const expected = new Map(rows.map(row => [row.requestId, row])); assert.equal(expected.size, rows.length);
  const starts = new Map(), terminals = new Map();
  for (const event of events) {
    if (!['authority-start', 'authority-terminal'].includes(event.type)) continue;
    assert.ok(expected.has(event.requestId), 'unmatched authority request'); const row = expected.get(event.requestId); assert.equal(event.subject, row.subject);
    const target = event.type === 'authority-start' ? starts : terminals; assert.ok(!target.has(event.requestId), 'duplicate authority dispatch/terminal'); target.set(event.requestId, event);
  }
  assert.deepEqual([...starts.keys()].sort(), [...terminals.keys()].sort(), 'authority tail unresolved');
  return rows.map(row => {
    const admitted = starts.has(row.requestId), terminal = terminals.get(row.requestId);
    if (row.outcome === 'HTTP' && row.status === 200) assert.equal(admitted, true, 'successful HTTP without authority');
    assert.ok(!terminal || /^\d+$/.test(terminal.startedMonoNs) && /^\d+$/.test(terminal.endedMonoNs));
    return { requestId: row.requestId, admitted, canceledBeforeDispatch: !admitted && ['ABORTED_CLIENT', 'DEADLINE'].includes(row.outcome),
      authorityTerminalAfterClient: admitted ? BigInt(terminal.endedMonoNs) > BigInt(row.endedMonoNs) : null,
      authorityAdmittedAfterClient: admitted ? BigInt(terminal.startedMonoNs) > BigInt(row.endedMonoNs) : null,
      authorityStatus: terminal?.status ?? null, authorityBytes: terminal?.responseBytes ?? 0 };
  });
}
export function verifyImageClosure(expectedContextSha) {
  assert.match(expectedContextSha || '', /^[a-f0-9]{64}$/);
  const root = '/source', manifestPath = root + '/runtime-source-manifest.json', stat = fs.lstatSync(manifestPath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1024 * 1024);
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  assert.equal(manifest.contextSha256, expectedContextSha); assert.equal(sha256(JSON.stringify(manifest.files)), expectedContextSha);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 10000);
  for (const row of manifest.files) {
    assert.ok(typeof row.path === 'string' && !path.isAbsolute(row.path) && !row.path.split('/').includes('..'));
    const file = path.resolve(root, row.path); assert.ok(file.startsWith(root + '/')); assert.equal(fs.realpathSync(file), file);
    const st = fs.lstatSync(file); assert.ok(st.isFile() && !st.isSymbolicLink() && st.size === row.bytes && st.size <= 16 * 1024 * 1024);
    assert.equal(sha256(fs.readFileSync(file)), row.sha256, 'image closure changed');
  }
  return { contextSha256: expectedContextSha, verifiedFiles: manifest.files.length };
}
export function servePrivateStdio(command) {
  let buffer = '', busy = false, failed = false, count = 0; const queue = [], seen = new Set();
  const output = value => { const line = JSON.stringify(value); assert.ok(Buffer.byteLength(line) <= LIMITS.maxRpcBytes); process.stdout.write(line + '\n'); };
  const fail = (id, error) => { failed = true; queue.length = 0; process.exitCode = 1; process.stdin.pause(); output({ id, error: { code: safetyCode(error) || 'FIXTURE_COMMAND_FAILED' } }); };
  async function consume() {
    if (busy || failed) return; busy = true;
    try { while (queue.length && !failed) { const message = queue.shift(); try {
      const result = await command(message.op, message.args); output({ id: message.id, result });
      if (message.op === 'stop') { failed = true; process.stdin.pause(); break; }
    } catch (error) { fail(message.id, error); } } } finally { busy = false; }
  }
  process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => {
    if (failed) return; try {
      buffer += chunk; assert.ok(Buffer.byteLength(buffer) <= 128 * 1024, 'private IPC partial line bound'); let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); assert.ok(Buffer.byteLength(line) <= 64 * 1024 && ++count <= 4096);
        const message = validateRpcEnvelope(JSON.parse(line));
        assert.ok(!seen.has(message.id)); seen.add(message.id); assert.ok(queue.length < 8); queue.push(message);
      }
      void consume();
    } catch { fail(null); }
  });
  process.stdin.on('end', () => { if (!failed) fail(null); });
}
export function validateRpcEnvelope(message) {
  assert.deepEqual(Object.keys(message).sort(), ['args', 'id', 'op']); assert.match(message.id, /^[1-9]\d{0,5}$/);
  assert.match(message.op, /^[a-z][a-zA-Z-]{0,31}$/); assert.ok(message.args && typeof message.args === 'object' && !Array.isArray(message.args)); return message;
}
export function validateFreeze(freeze) {
  assert.equal(freeze.schema, 1); assert.equal(freeze.planId, PLAN_ID); assert.equal(freeze.planSha256, planHash());
  assert.equal(freeze.status, 'FROZEN_REVIEWED'); assert.equal(freeze.launchAuthorized, true);
  assert.match(freeze.sourceSha || '', /^[a-f0-9]{40}$/); assert.match(freeze.sourceTree || '', /^[a-f0-9]{40}$/);
  assert.equal(freeze.node, 'v24.21.0'); assert.equal(freeze.platform, 'linux'); assert.equal(freeze.arch, 'x64');
  assert.match(freeze.baseImage || '', /^node@sha256:[a-f0-9]{64}$/); assert.match(freeze.runtimeImageId || '', /^sha256:[a-f0-9]{64}$/);
  assert.match(freeze.contextSha256 || '', /^[a-f0-9]{64}$/); assert.match(freeze.compiledProofSha256 || '', /^[a-f0-9]{64}$/);
  assert.match(freeze.bcryptSha256 || '', /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(freeze.files) && freeze.files.length > 0, 'complete executable closure required');
  const paths = new Set();
  for (const row of freeze.files) { assert.ok(typeof row.path === 'string' && /^[A-Za-z0-9_.\-/]+$/.test(row.path) && !row.path.startsWith('/') && !row.path.split('/').includes('..'));
    assert.ok(!paths.has(row.path), 'duplicate source'); paths.add(row.path); assert.match(row.sha256 || '', /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 16 * 1024 * 1024);
    assert.ok(!/(^|\/)(?:\.env|node_modules|\.git)(?:[/.]|$)|\.(?:sqlite|pem|key)$/i.test(row.path), 'private input in source closure'); }
  for (const required of ['package.json', 'package-lock.json', 'frontend/package-lock.json', 'tsconfig.json',
    'services/stocks-global/server.mjs', 'services/stocks-global/identity.mjs', 'services/stocks-global/local-proxy.mjs',
    'services/stocks-global/accounts.mjs', 'services/stocks-global/account-worker.mjs', 'services/stocks-global/account-worker-runtime.mjs',
    'services/stocks-global/engine.mjs', 'scripts/qa-stocks-principal-projection.cjs',
    'compiled-proof.json', 'build.log', 'services/stocks/auth-http-fixture-512/authority.cjs', 'services/stocks/auth-http-fixture-512/authority-entry.cjs',
    'services/stocks/auth-http-fixture-512/run.mjs', 'services/stocks/auth-http-fixture-512/plan.mjs',
    'services/stocks/auth-http-fixture-512/probe.mjs', 'services/stocks/auth-http-fixture-512/stock-child.mjs']) assert.ok(paths.has(required), `missing required closure member ${required}`);
  assert.equal(freeze.closureReview?.complete, true); assert.equal(freeze.closureReview?.nativePrismaEngine, false);
  assert.equal(freeze.closureReview?.unresolvedImports, 0); assert.ok(new Set(freeze.closureReview?.reviewers).size >= 2, 'two independent reviews required');
  assert.equal(freeze.seed?.api, SEED.api); assert.match(freeze.seed?.sha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(freeze.seed.closed, true); assert.equal(freeze.seed.integrity, 'ok'); assert.equal(freeze.seed.synchronous, 2);
  assert.equal(freeze.seed.journal, 'delete'); assert.deepEqual(freeze.seed.subjects, SUBJECTS);
  assert.equal(freeze.seed.accounts?.length, 50); assert.equal(new Set(freeze.seed.accounts.map(x => x.id)).size, 50);
  assert.deepEqual(freeze.seed.accounts.map(x => x.id).sort(), SUBJECTS.map(subject => sha256(JSON.stringify([ISSUER, subject]))).sort());
  for (const account of freeze.seed.accounts) { assert.match(account.id || '', /^[a-f0-9]{64}$/); assert.match(account.ledgerSha256 || '', /^[a-f0-9]{64}$/); }
  assert.deepEqual(freeze.expectedCounts, COUNTS); assert.equal(freeze.originalTargetedPlanSha256, '258cc65cbee2638265d61bfa7b8f6079fc385520f66af710e324fe4a2a37a1cc');
  return true;
}
