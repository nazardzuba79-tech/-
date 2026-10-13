import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { verifyBudget, summarizeAttempts, compareCrypto, MODEL } from './metrics.mjs';
import { IDS, INERT, fixtureBody, startStocks } from './stocks-fixture.mjs';
import { instrument } from '../../stocks-global/catalog.mjs';
import { runWorkload, viewerCoveragePass } from './workload.mjs';
import { installLoopbackDbGuard } from './network-guard.cjs';
import net from 'node:net';
import { requireEmptyDirectory, requireFreePorts, requireImageRevision, controlJson, cleanupWithEvidence } from './safety.mjs';
import { writeFile } from 'node:fs/promises';
test('aggregate quota proof fails closed for missing, unbounded and per-container-wrong budgets', () => {
  const correct = { cpuMax: '200000 100000', memoryMax: String(MODEL.memory), memoryPeak: '100', memoryEvents: 'oom 0\noom_kill 0', cpuStat: 'usage_usec 1' };
  assert.equal(verifyBudget(correct), true);
  for (const patch of [{ cpuMax: 'max 100000' }, { cpuMax: '100000 100000' }, { memoryMax: 'max' }, { memoryPeak: null }, { memoryPeak: undefined }, { memoryPeak: 'garbage' }, { memoryPeak: '-1' }, { memoryEvents: null }, { memoryEvents: 'high 0' }, { memoryEvents: 'oom garbage\noom_kill 0' }, { cpuStat: null }, { cpuStat: 'usage_usec -1' }])
    assert.throws(() => verifyBudget({ ...correct, ...patch }), /NOT_VERIFIED/);
});
test('failed HTTP attempts retained once and cannot turn missing crypto into PASS', () => {
  const rows = [{ ok: true, ms: 1 }, { ok: false, code: 'DEADLINE_3000MS', ms: 3001 }, { ok: false, code: 'ACCOUNT_BUSY', ms: 3 }];
  const result = summarizeAttempts(rows); assert.equal(result.attempts, 3); assert.equal(result.successes, 1); assert.equal(result.failures, 2);
  assert.equal(result.allAttemptLatencyMs.p99, 3001); assert.equal(result.successLatencyMs.p99, 1);
  assert.equal(compareCrypto([], []).originalFivePercentComparison, 'INCOMPLETE_OR_ERROR');
  assert.equal(compareCrypto([{ ok: true, ms: 1 }], rows).originalFivePercentComparison, 'INCOMPLETE_OR_ERROR');
  assert.equal(compareCrypto([{ ok: true, ms: 1 }], [{ ok: true, ms: 1 }], { expectedOperations: 2 }).originalFivePercentComparison, 'INCOMPLETE_OR_ERROR');
});
test('all-failed or missing scheduled viewers cannot produce a functional PASS', () => {
  const good = { viewer: 0, validStates: 2, validHistories: 2, hiddenPhaseEntered: true };
  assert.equal(viewerCoveragePass([good], 1), true);
  assert.equal(viewerCoveragePass([], 1), false);
  assert.equal(viewerCoveragePass([{ ...good, validStates: 0, validHistories: 0 }], 1), false);
  assert.equal(viewerCoveragePass([{ ...good, validHistories: 0 }], 1), false);
  assert.equal(viewerCoveragePass([good, good], 2), false);
});
test('250-item metadata never registers inert trading IDs and external native fixture paths fail closed', () => {
  assert.equal(IDS.length, 20); assert.equal(IDS.length + INERT.length, 250);
  assert(INERT.every(i => i.online === false && i.tradable === false && !instrument(i.id)));
  assert.throws(() => fixtureBody('https://example.com/private'), /TRANSPORT_DENIED/);
  assert.throws(() => fixtureBody('https://iss.moex.com/iss/engines/stock'), /TRANSPORT_DENIED/);
  assert.equal(fixtureBody('https://api.binance.com/api/v3/trades?symbol=USDCUSDT')[0].price, '0.999');
});
test('Docker entrypoint cannot launch production, migration deploy, seed or collector', () => {
  const docker = readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('./start.sh', import.meta.url), 'utf8');
  assert.match(docker, /ENTRYPOINT \["bash", "\/app\/services\/stocks\/cx23-model\/start.sh"\]/);
  assert.match(docker, /LABEL org.opencontainers.image.revision=\$SOURCE_SHA/);
  assert.match(entry, /test ! -e \/data\/pg\/PG_VERSION/);
  assert.match(entry, /createdb .*cx23_disposable/);
  assert.doesNotMatch(entry, /migrate deploy|prisma.*seed|collector|src\/index/);
  const ignore = readFileSync(new URL('./Dockerfile.dockerignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\*\*$/m); assert.match(ignore, /\*\*\/\.env\.\*/);
  assert.match(ignore, /!node_modules\/\*\*/); assert.match(ignore, /!dist\/\*\*/);
});
test('crypto process network guard rejects external hosts and non-disposable local ports before connect', () => {
  const restore = installLoopbackDbGuard();
  try {
    for (const opts of [{ host: 'example.com', port: 443 }, { host: '127.0.0.1', port: 5432 }, { host: '10.0.0.1', port: 15432 }])
      assert.throws(() => new net.Socket().connect(opts), /EXTERNAL_NETWORK_FORBIDDEN/);
  } finally { restore(); }
});
test('cleanup errors retain the original outcome and remaining cleanup actions', async () => {
  const writes = [], calls = [], original = { complete: false, error: 'original fixture failure', samples: [1, 2] };
  const r = await cleanupWithEvidence(original, value => writes.push(structuredClone(value)), [
    { name: 'logs', run: () => { assert.equal(writes.length, 1); calls.push('logs'); throw Error('docker logs unavailable'); } },
    { name: 'inspect', run: () => calls.push('inspect') },
  ]);
  assert.deepEqual(calls, ['logs', 'inspect']); assert.equal(r.error, original.error); assert.deepEqual(r.samples, [1, 2]);
  assert.equal(r.complete, false); assert.equal(r.cleanupErrors[0].action, 'logs'); assert.equal(writes.length, 2);
});
test('stale output, occupied ports and wrong run/image identity fail before load', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx23-safety-'));
  const stub = createServer((q, r) => { if (q.url === '/hang') return; r.setHeader('Content-Type', 'application/json'); r.end('{"runId":"other-run"}'); });
  await new Promise(ok => stub.listen(0, '127.0.0.1', ok));
  t.after(async () => { stub.closeAllConnections(); await new Promise(ok => stub.close(ok)); await rm(dir, { recursive: true, force: true }); });
  requireEmptyDirectory(dir); await writeFile(join(dir, 'old-results'), 'retain');
  assert.throws(() => requireEmptyDirectory(dir), /NOT_EMPTY/);
  await assert.rejects(requireFreePorts([stub.address().port]), /PORT_NOT_FREE/);
  await assert.rejects(controlJson(`http://127.0.0.1:${stub.address().port}/health`, 'expected'), /RUN_ID_MISMATCH/);
  await assert.rejects(controlJson(`http://127.0.0.1:${stub.address().port}/hang`, 'expected', 20), { name: 'TimeoutError' });
  requireImageRevision('a'.repeat(40), 'a'.repeat(40));
  assert.throws(() => requireImageRevision('b'.repeat(40), 'a'.repeat(40)), /IMAGE_REVISION_MISMATCH/);
  assert.throws(() => requireImageRevision('', 'a'.repeat(40)), /IMAGE_REVISION_MISMATCH/);
});
test('local model owner cycle and readonly viewer lifecycle reuse real Stocks server without external calls', { timeout: 25000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx23-model-unit-'));
  const f = await startStocks({ path: join(dir, 'paper.sqlite'), port: 0 });
  // Only this harness unit uses a tiny crypto/control stub. Linux model uses real
  // existing services + PostgreSQL, and that distinction is asserted in source.
  const stub = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url === '/metadata' ? { catalogue: [...IDS.map(id => ({ id })), ...INERT] } : { ok: true })); });
  await new Promise(ok => stub.listen(0, '127.0.0.1', ok));
  t.after(async () => { await f.app.close(); await new Promise(ok => stub.close(ok)); await rm(dir, { recursive: true, force: true }); });
  const result = await runWorkload({ profile: 'local-harness-unit', viewers: 1, pattern: 'shared', seconds: 11,
    stocksBase: `http://127.0.0.1:${f.app.port}`, cryptoBase: `http://127.0.0.1:${stub.address().port}`, controlBase: `http://127.0.0.1:${stub.address().port}` });
  assert.deepEqual(result.contracts.filter(c => !c.pass), []);
  assert.equal(result.viewerMutationPosts, 0); assert.equal(result.stocks.failures, 0); assert.equal(f.metrics().externalApiCalls, 0);
  const cat = await (await fetch(`http://127.0.0.1:${f.app.port}/__stocks_global/catalogue`, { headers: { Authorization: 'Bearer cx23-fixture-owner' } })).json();
  assert.equal(cat.catalogue.length, 20); assert(cat.catalogue.every(i => !i.id.startsWith('FIXTURE_METADATA_ONLY:')));
});
