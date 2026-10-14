// Finite loopback client and sampler, charged to the separate driver cgroup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { LIMITS, ISSUER, SUBJECTS, sha256, validateResources, terminalTiming, verifyImageClosure, servePrivateStdio, assertSafety, safetyCode } from './plan.mjs';

const mono = () => process.hrtime.bigint();
const CGROUP_FIELDS = Object.freeze({ cpuMax: 'cpu.max', cpuStat: 'cpu.stat', memoryMax: 'memory.max', memoryCurrent: 'memory.current',
  memoryPeak: 'memory.peak', memoryEvents: 'memory.events', swapMax: 'memory.swap.max', cpuset: 'cpuset.cpus.effective', ioMax: 'io.max', ioStat: 'io.stat' });
export function readCgroup(root, read = file => fs.readFileSync(file, 'utf8')) {
  assert.ok(['/metrics/service', '/metrics/authority', '/sys/fs/cgroup'].includes(root));
  return Object.fromEntries(Object.entries(CGROUP_FIELDS).map(([key, file]) => {
    const value = read(path.join(root, file)); assert.ok(Buffer.byteLength(value) <= 65536); return [key, value];
  }));
}
export function validatePublicState(body, subject) {
  try {
  const id = sha256(JSON.stringify([ISSUER, subject]));
  assert.equal(body.account?.id, id, 'cross-account identity'); assert.equal(body.account.mode, 'isolated-paper');
  assert.equal(body.account.canTrade, subject === 'alice', 'owner-only policy'); assert.equal(body.revision, 0);
  for (const currency of ['USDT', 'USDC']) {
    assert.equal(body.wallets?.[currency]?.cash, '10000.00000000'); assert.equal(body.wallets[currency].reserved, '0.00000000'); assert.equal(body.wallets[currency].available, '10000.00000000');
  }
  for (const key of ['orders', 'fills', 'adjustments']) assert.deepEqual(body[key], []);
  assert.deepEqual(body.positions, {}); assert.deepEqual(body.quotes, {});
  assert.deepEqual(body.realized, { USDT: '0.00000000', USDC: '0.00000000' });
  // No CSRF token, profile body or private header is copied to the audit record.
  return { accountId: id, canTrade: body.account.canTrade, financialSha256: sha256(JSON.stringify({
    wallets: body.wallets, positions: body.positions, orders: body.orders, fills: body.fills, realized: body.realized, adjustments: body.adjustments,
  })) };
  } catch { assertSafety(false, 'SAFETY_ACCOUNT_RESPONSE'); }
}
export function validateRequest(row) {
  assert.ok(SUBJECTS.includes(row.subject)); assert.match(row.requestId || '', /^[A-Za-z0-9_-]{1,100}$/);
  assert.ok(row.path === undefined || row.path === '/__stocks_global/state?userId=bob');
  assert.ok(row.forged === undefined || row.forged === true);
}
export function requestOnce({ port, row, authorization, deadlineMs = LIMITS.deadlineMs, abortMs, health = false }) {
  assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535);
  if (!health) validateRequest(row);
  assert.equal(deadlineMs, health ? LIMITS.startupDeadlineMs : LIMITS.deadlineMs);
  assert.ok(abortMs === undefined || abortMs === LIMITS.abortMs);
  const started = mono(), record = { requestId: row?.requestId ?? null, subject: row?.subject ?? null,
    startedMonoNs: started.toString(), outcome: null, status: null, code: null, sentBytes: 0, receivedBytes: 0,
    scheduledAbortMs: abortMs ?? null, abortTimerFired: false, health };
  return new Promise(resolve => {
    let done = false, response, request, deadline, abort; const chunks = [];
    const finish = (outcome, reason = null) => {
      if (done) return; done = true; clearTimeout(deadline); clearTimeout(abort);
      record.endedMonoNs = mono().toString(); record.elapsedMs = Number(BigInt(record.endedMonoNs) - started) / 1e6;
      record.firstEventOutcome = outcome; record.firstEventReason = reason;
      Object.assign(record, terminalTiming(outcome, record.elapsedMs, deadlineMs, abortMs, record.abortTimerFired));
      record.reason = record.outcome === 'DEADLINE' ? health ? 'HEALTH_DEADLINE_500MS' : 'DEADLINE_3000MS' : reason;
      response?.destroy(); request?.destroy(); resolve(record);
    };
    const headers = health ? {} : { Authorization: authorization, 'x-fixture-request-id': row.requestId,
      ...(row.forged ? { 'x-user-id': 'alice', 'x-role': 'ADMIN', 'x-owner': 'alice' } : {}) };
    request = http.request({ hostname: '127.0.0.1', port, path: health ? '/__stocks_global/health' : row.path || '/__stocks_global/state',
      method: 'GET', headers, agent: false }, res => {
      response = res; record.status = res.statusCode;
      res.on('data', data => { if (done) return; record.receivedBytes += data.length;
        if (record.receivedBytes > LIMITS.maxHttpBody) return finish('TRANSPORT_ERROR', 'RESPONSE_TOO_LARGE'); chunks.push(data); });
      res.once('aborted', () => finish('TRANSPORT_ERROR', 'RESPONSE_ABORTED'));
      res.once('error', () => finish('TRANSPORT_ERROR', 'RESPONSE_ERROR'));
      res.once('end', () => {
        if (done) return;
        record.bodyEndedMonoNs = mono().toString();
        if (Number(BigInt(record.bodyEndedMonoNs) - started) / 1e6 >= deadlineMs) return finish('DEADLINE', health ? 'HEALTH_DEADLINE_500MS' : 'DEADLINE_3000MS');
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof body.error === 'string') record.code = /^[A-Z0-9_]{1,80}$/.test(body.error) ? body.error : 'UNSAFE_CODE_REDACTED';
          if (res.statusCode === 200 && !health) Object.assign(record, validatePublicState(body, row.subject));
          if (res.statusCode === 200 && health) assert.equal(body.ok, true);
          finish('HTTP');
        } catch (error) { finish('TRANSPORT_ERROR', safetyCode(error) || 'BODY_CONTRACT_FAILED'); }
      });
    });
    request.once('error', error => finish('TRANSPORT_ERROR', /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'REQUEST_ERROR'));
    deadline = setTimeout(() => finish('DEADLINE', health ? 'HEALTH_DEADLINE_500MS' : 'DEADLINE_3000MS'), deadlineMs);
    if (abortMs !== undefined) abort = setTimeout(() => { record.abortTimerFired = true; finish('ABORTED_CLIENT', 'SCHEDULED_ABORT_250MS'); }, abortMs);
    request.end(); record.sentBytes = Buffer.byteLength(request._header || '');
  });
}
export function readPrivateCredentials(file = '/private-ipc/tokens.json') {
  assert.equal(file, '/private-ipc/tokens.json'); const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600 && stat.size < 65536);
  const body = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(body.schema, 1); assert.equal(body.issuer, ISSUER);
  assert.deepEqual(body.credentials.map(row => row.subject), SUBJECTS);
  for (const row of body.credentials) assert.ok(typeof row.authorization === 'string' && /^Bearer [A-Za-z0-9_.-]{30,4000}$/.test(row.authorization));
  return new Map(body.credentials.map(row => [row.subject, row.authorization]));
}
export async function createDriver() {
  assert.equal(process.platform, 'linux'); assert.equal(process.version, 'v24.21.0'); assert.ok(process.getuid() > 0);
  assert.equal(process.env.AUTH_HTTP_FIXTURE_512, 'true');
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET', 'NODE_OPTIONS', 'NODE_PATH']) assert.equal(process.env[key], undefined);
  let credentials, port, sampling, samples = 0, sampleIssues = [], phase = 'not-started', active = false, ordinary = 0, scheduled = 0, warmup = 0, safety = 0, health = 0;
  const records = [], output = '/evidence', files = ['driver-attempts.jsonl', 'driver-cgroups.jsonl'];
  for (const file of files) fs.writeFileSync(path.join(output, file), '', { flag: 'wx', mode: 0o600 });
  const append = (file, value) => fs.appendFileSync(path.join(output, file), JSON.stringify(value) + '\n');
  const snap = () => {
    const data = { phase, observedMonoNs: mono().toString(), cpu: process.cpuUsage(), rss: process.memoryUsage().rss,
      service: readCgroup('/metrics/service'), authority: readCgroup('/metrics/authority'), driver: readCgroup('/sys/fs/cgroup') };
    if (++samples > LIMITS.runMs / LIMITS.sampleMs + 500) throw Error('SAMPLER_BUDGET_EXCEEDED');
    append(files[1], data); return data;
  };
  const note = (row, kind) => { assert.ok(records.length < LIMITS.maxRecords); row.class = kind; row.phase = phase; records.push(row); append(files[0], row); return row; };
  async function command(op, input = {}) {
    if (op === 'init') {
      assert.ok(!credentials); const closure = verifyImageClosure(input.contextSha256); credentials = readPrivateCredentials(); port = input.gatewayPort;
      const proof = snap(); for (const role of ['service', 'authority', 'driver']) validateResources(proof[role], role, input.device);
      sampling = setInterval(() => { try { snap(); } catch (error) { sampleIssues.push(String(error.message).slice(0, 120)); clearInterval(sampling); } }, LIMITS.sampleMs);
      return { resourceProof: proof, credentials: SUBJECTS.length, closure };
    }
    assert.ok(credentials);
    if (op === 'phase') { assert.match(input.name || '', /^[A-Za-z0-9_-]{1,80}$/); assert.equal(active, false);
      const previousPhase = phase; phase = input.name; return { phase, previousPhase, snapshot: snap() }; }
    if (op === 'health') {
      assert.ok(health < LIMITS.startupProbes && !active); health++;
      return note(await requestOnce({ port, deadlineMs: LIMITS.startupDeadlineMs, health: true }), 'health');
    }
    if (op === 'requests') {
      assert.ok(!active); assert.ok(['ordinary', 'warmup', 'gatewaySafety', 'cancellation'].includes(input.class));
      assert.ok(Array.isArray(input.rows) && input.rows.length > 0 && input.rows.length <= 50);
      assert.equal(new Set(input.rows.map(row => row.subject)).size, input.rows.length);
      input.rows.forEach(validateRequest);
      if (input.class === 'ordinary') { ordinary += input.rows.length; assert.ok(ordinary <= 225); }
      if (input.class === 'warmup') { warmup += input.rows.length; assert.ok(warmup <= 50 && input.rows.length === 1); }
      if (input.class === 'gatewaySafety') { safety += input.rows.length; assert.ok(safety <= 17 && input.rows.length === 1); }
      if (input.class === 'cancellation') { scheduled += input.rows.length; assert.ok(scheduled <= 5); }
      active = true;
      try { return await Promise.all(input.rows.map(async row => note(await requestOnce({ port, row, authorization: credentials.get(row.subject),
        ...(input.class === 'cancellation' ? { abortMs: LIMITS.abortMs } : {}) }), input.class))); }
      finally { active = false; }
    }
    if (op === 'audit') return { ordinary, scheduled, warmup, safety, health, samples, sampleIssues, active, records: records.length };
    if (op === 'stop') {
      assert.equal(active, false); clearInterval(sampling); snap(); credentials.clear();
      return { ordinary, scheduled, warmup, safety, health, samples, sampleIssues,
        files: files.map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(output, file))), bytes: fs.statSync(path.join(output, file)).size })) };
    }
    throw Error('DRIVER_COMMAND_DENIED');
  }
  return { command };
}
async function main() {
  const driver = await createDriver(); servePrivateStdio(driver.command);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
