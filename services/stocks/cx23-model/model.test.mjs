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
import { validState, validHistory, idleEvidence, createJournal, reconcileJournal, evidenceCasePass } from './evidence.mjs';
import { modelPlan, expectedAccountRoles } from './plan.mjs';
import { measureFiniteIdle } from './idle.mjs';
import { proveForcedInterruption } from './interruption.mjs';

test('targeted mode schedules exactly30 loaded repetitions without inventing crypto controls', () => {
  const p = modelPlan('evidence-v2');
  assert.equal(p.labels.length, 30); assert.equal(p.profiles.length, 10); assert.equal(p.overheadLabels.length, 0);
  assert(p.labels.every(x => x.includes('-loaded-'))); assert.equal(p.cryptoComparison, 'NOT_RUN_NO_MATCHED_CONTROLS');
  assert.equal(modelPlan().labels.length + modelPlan().overheadLabels.length, 66);
  assert.deepEqual(expectedAccountRoles({ profile: 'idle', viewers: 0 }), []);
  assert.deepEqual(expectedAccountRoles({ profile: '5-shared', viewers: 5 }), ['owner', 'viewer-0', 'viewer-1', 'viewer-2', 'viewer-3', 'viewer-4']);
  assert.throws(() => modelPlan('lighter'), /INVALID_CX23_MODE/);
});
test('finite idle gate drains before measuring and rejects new work, stale clocks and missing evidence', async () => {
  const run = async change => {
    let time = 0, calls = 0;
    return measureFiniteIdle({ expectedRoles: ['owner'], interestProof: { expectedAccounts: 1, accounts: [{ role: 'owner', uninterested: true }] }, now: () => time, sleep: async ms => { time += ms; }, drainTimeoutMs: 10, windowMs: 20, intervalMs: 5,
      sample: async () => { const s = { at: time, stocks: { fixtureTransportStarts: 4, accounts: { workerAlive: 1, queue: { dispatched: 3, pending: 0, active: calls++ === 0 ? 1 : 0 } }, live: { transportInflight: 0, quoteInflight: 0, historyInflight: 0, historyActive: 0, historyQueued: 0 } } }; change?.(s, calls); return s; } });
  };
  const good = await run(); assert.equal(good.status, 'PASS'); assert.equal(good.dispatchedDelta, 0); assert.equal(good.providerStartsDelta, 0); assert(good.samples.length >= 6);
  assert.equal((await run((s,n) => { if(n>2)s.stocks.fixtureTransportStarts++; })).status, 'FAIL');
  assert.equal((await run((s,n) => { if(n>2)s.stocks.accounts.queue.dispatched++; })).status, 'FAIL');
  assert.equal((await run(s => { s.stocks.accounts.queue.active = 1; })).reason, 'DRAIN_BARRIER_TIMEOUT');
  assert.equal((await run(s => { delete s.stocks.live; })).status, 'INCOMPLETE');
  assert.equal((await run(s => { s.at = 0; })).reason, 'IDLE_SAMPLE_CLOCK_NOT_ADVANCING');
  assert.equal((await measureFiniteIdle({ expectedRoles: ['owner'], interestProof: { expectedAccounts: 0, accounts: [] } })).reason, 'POST_RELEASE_ACCOUNT_INTEREST_UNVERIFIED');
});
test('known HTTP/source failures cannot be hidden behind functional and idle PASS', () => {
  const good = { complete: true, finiteIdle: { status: 'PASS' }, workload: { functionalContractsPass: true, stocks: { failures: 0 }, crypto: { failures: 0, attempts: 1120 }, cryptoSchedule: { expectedCycles: 80, completedCycles: 80 }, sourceErrors: [], attemptEvidence: { complete: true } } };
  assert.equal(evidenceCasePass(good), true);
  for (const patch of [{ stocks: { failures: 1 } }, { sourceErrors: [{ code: 'RATE_LIMIT' }] }, { crypto: { failures: 1, attempts: 1120 } }, { cryptoSchedule: { expectedCycles: 80, completedCycles: 79 } }, { attemptEvidence: { complete: false } }])
    assert.equal(evidenceCasePass({ ...good, workload: { ...good.workload, ...patch } }), false);
});
test('forced child interruption retains dispatched HTTP as UNKNOWN in raw journal', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cx23-interrupted-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await proveForcedInterruption(join(dir, 'proof'));
  assert.equal(result.pass, true); assert.equal(result.reconciliation.unknown, 1); assert.equal(result.reconciliation.complete, false);
  assert.match(readFileSync(join(dir, 'proof/interrupted.attempts.ndjson'), 'utf8'), /"event":"dispatch"/);
});
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
  const good = { viewer: 0, phases: { preHide: { validStates: 2, validHistories: 2 }, postReopen: { validStates: 2, validHistories: 2 } }, hiddenPhaseEntered: true };
  assert.equal(viewerCoveragePass([good], 1), true);
  assert.equal(viewerCoveragePass([], 1), false);
  assert.equal(viewerCoveragePass([{ ...good, phases: { ...good.phases, postReopen: { validStates: 0, validHistories: 0 } } }], 1), false);
  assert.equal(viewerCoveragePass([{ ...good, phases: { ...good.phases, postReopen: { validStates: 1, validHistories: 0 } } }], 1), false);
  assert.equal(viewerCoveragePass([{ ...good, phases: undefined, validStates: 20, validHistories: 20 }], 1), false, 'Legacy total counters do not prove post-reopen success');
  assert.equal(viewerCoveragePass([good, good], 2), false);
});
test('graph evidence validates exact source identity/timeframe and OHLC before recording success', () => {
  const id = 'BYBIT:AAPLXUSDT', now = 1791849600000;
  const q = { instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', eventId: 'fixture-event', timestamp: now, receivedAt: now,
    verified: true, marketOpen: true, prices: { USDT: { buy: '100', sell: '100' } }, capacity: '1' };
  const state = { account: { canTrade: false }, quotes: { [id]: q } };
  assert.equal(validState(state, id, now), true);
  assert.equal(validState({ ...state, quotes: { [id]: { ...q, instrumentId: 'BYBIT:NVDAXUSDT' } } }, id, now), false);
  const candle = { time: now / 1000 - 900, open: 100, high: 102, low: 99, close: 101, volume: 10 };
  const history = { instrumentId: id, interval: '15m', provider: 'bybit', currency: 'USDT', candles: [candle] };
  assert.equal(validHistory(history, id, '15m', now), true);
  for (const patch of [{ instrumentId: 'BYBIT:NVDAXUSDT' }, { interval: '1m' }, { provider: 'binance' }, { currency: 'RUB' }, { candles: [] },
    { candles: [{ ...candle, high: 90 }] }, { candles: [{ ...candle, volume: -1 }] }, { candles: [candle, candle] }, { candles: [{ ...candle, time: now / 1000 + 60 }] }])
    assert.equal(validHistory({ ...history, ...patch }, id, '15m', now), false);
});
test('idle observations never claim no-new-work proof without dispatch attribution', () => {
  const start = { at: 1, stocks: { fixtureTransportStarts: 10, accounts: { sqlCalls: 3 } } };
  const finish = { at: 3401, stocks: { fixtureTransportStarts: 10, accounts: { sqlCalls: 3 } } };
  assert.equal(idleEvidence(start, finish).providerStarts, 0);
  assert.equal(idleEvidence(start, finish).noNewWorkGate, 'UNVERIFIED');
  assert.equal(idleEvidence(start, { ...finish, stocks: { fixtureTransportStarts: 11, accounts: { sqlCalls: 4 } } }).noNewWorkGate, 'UNVERIFIED');
});
test('dispatch journal preserves interrupted unknowns, one settlement, bounded pending state and no secrets', () => {
  const events = [], journal = createJournal({ append: e => events.push(e), maxPending: 1 });
  const id = journal.dispatch({ kind: 'stocks', route: '/__stocks_global/state', atMs: 0, context: { viewer: 2, phase: 'postReopen', token: 'never-retain-this' } });
  assert.throws(() => journal.dispatch({ kind: 'stocks', route: '/state', atMs: 1 }), /PENDING_LIMIT/);
  const raw = () => events.map(e => JSON.stringify(e)).join('\n');
  assert(!raw().includes('never-retain-this'));
  const interrupted = reconcileJournal(raw());
  assert.equal(interrupted.complete, false); assert.equal(interrupted.dispatched, 1); assert.equal(interrupted.unknown, 1);
  assert.equal(interrupted.unknownAttempts[0].outcome, 'INTERRUPTED_UNKNOWN'); assert.equal(interrupted.unknownAttempts[0].ms, null);
  journal.settle(id, { ok: true, status: 200, ms: 2, code: null });
  assert.equal(reconcileJournal(raw()).complete, true); assert.equal(reconcileJournal(raw()).successes, 1);
  assert.throws(() => journal.settle(id, { ok: true, ms: 2 }), /DOUBLE_SETTLEMENT/);
  assert.equal(reconcileJournal(raw() + '\n{"broken"').complete, false);
  assert.equal(reconcileJournal([events[0], { ...events[1], evidenceVersion: 1 }].map(e => JSON.stringify(e)).join('\n')).complete, false);
  assert.equal(reconcileJournal(raw() + '\n' + JSON.stringify({ kind: 'stocks', ok: false, ms: 3000, code: 'DEADLINE_3000MS' })).complete, false);
  assert.equal(reconcileJournal(raw() + '\n' + JSON.stringify({ unexpected: true })).complete, false);
  assert.equal(reconcileJournal(raw() + '\nnull').complete, false);
  assert.equal(reconcileJournal([{ ...events[0], requestId: 3 }, { ...events[1], requestId: 3 }].map(e => JSON.stringify(e)).join('\n')).complete, false);
  assert.equal(reconcileJournal([events[1], events[0]].map(e => JSON.stringify(e)).join('\n')).complete, false);
  const auxiliary = [{ evidenceVersion: 2, event: 'graph-validation', requestId: id, valid: true }, { evidenceVersion: 2, event: 'source-observation', kind: 'source-observation', requestId: id, code: 'QUOTE_STALE' }];
  assert.equal(reconcileJournal(raw() + '\n' + auxiliary.map(e => JSON.stringify(e)).join('\n')).complete, true);
  assert.equal(reconcileJournal(JSON.stringify({ kind: 'stocks', ok: true, ms: 1 })).dispatchCoverage, 'UNVERIFIED');
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
  const result = await runWorkload({ profile: 'local-harness-unit', viewers: 1, pattern: 'shared', seconds: 11, verifyReleased: true,
    stocksBase: `http://127.0.0.1:${f.app.port}`, cryptoBase: `http://127.0.0.1:${stub.address().port}`, controlBase: `http://127.0.0.1:${stub.address().port}` });
  assert.deepEqual(result.contracts.filter(c => !c.pass), []);
  assert.equal(result.viewerMutationPosts, 0); assert.equal(result.stocks.failures, 0); assert.equal(f.metrics().externalApiCalls, 0);
  assert.equal(result.interestProof.accounts.length, 2); assert(result.interestProof.accounts.every(r => r.uninterested));
  assert.equal(result.postReleaseProofHttp.attempts, 2); assert.equal(result.measurementBoundary.postReleaseProofRequests, 2);
  const idle = await measureFiniteIdle({ interestProof: result.interestProof, expectedRoles: ['owner', 'viewer-0'], sample: async () => ({ at: Date.now(), stocks: f.metrics() }) });
  assert.equal(idle.status, 'PASS', JSON.stringify(idle)); assert.equal(idle.dispatchedDelta, 0);
  const cat = await (await fetch(`http://127.0.0.1:${f.app.port}/__stocks_global/catalogue`, { headers: { Authorization: 'Bearer cx23-fixture-owner' } })).json();
  assert.equal(cat.catalogue.length, 20); assert(cat.catalogue.every(i => !i.id.startsWith('FIXTURE_METADATA_ONLY:')));
});
