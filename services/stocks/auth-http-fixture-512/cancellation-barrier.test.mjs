import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../../stocks-global/server.mjs';
import { identityResolver } from '../../stocks-global/identity.mjs';
import { accountId } from '../../stocks-global/accounts.mjs';
import { createCancellationBarrier, cancellationEvidence } from './cancellation-barrier.mjs';

// This exercises the actual Stocks server/resolver over real loopback HTTP.
// The held authority is a tiny transport fixture, NOT the compiled backend /me
// handler. No resource/capacity or ordinary finite-matrix PASS is implied.
const TOKENS = { alice: 'Bearer fixture-cancel-alice-123', bob: 'Bearer fixture-cancel-bob-123' };
const deadline = async (promise, ms = 2000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('FOCUSED_FIXTURE_DEADLINE')), ms); })]); }
  finally { clearTimeout(timer); }
};
async function listen(server) { await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); }); return server.address().port; }
async function close(server) { if (!server) return; const done = new Promise(ok => server.close(ok)); server.closeAllConnections(); await done; }
function request(url, authorization) {
  let client;
  const result = new Promise(resolve => {
    client = http.get(url, { headers: { Authorization: authorization }, agent: false }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      response.on('error', () => resolve({ aborted: true }));
    });
    client.on('error', () => resolve({ aborted: true }));
  });
  return { client, result };
}

test('actual admitted authority closes after client abort; live Bob remains isolated and every barrier cleans', { timeout: 8000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-cancel-barrier-'));
  const accountsPath = join(dir, 'accounts.sqlite');
  const bobAccountId = accountId({ issuer: 'cancel-barrier-fixture', subject: 'bob' });
  const aliceAccountId = accountId({ issuer: 'cancel-barrier-fixture', subject: 'alice' });
  const barrier = createCancellationBarrier({ caseId: 'actual-http-alice', timeoutMs: 1000 });
  const subjects = [], handlerErrors = []; let app, appClose, authority, alice, bob, providerCalls = 0;
  const closeApp = () => {
    if (!app) return Promise.resolve();
    return appClose ??= (async () => { app.server.closeAllConnections(); await app.close(); })();
  };
  let resolveBobAdmitted;
  const bobAdmitted = new Promise(resolve => { resolveBobAdmitted = resolve; });
  const handlerTasks = new Set();
  try {
    authority = http.createServer((req, res) => {
      const task = (async () => {
        assert.equal(req.method, 'GET'); assert.equal(req.url, '/api/v1/me');
        if (req.headers.authorization === TOKENS.alice) {
          subjects.push('alice');
          await barrier.hold(req, res);
          if (!res.destroyed) res.end(JSON.stringify({ id: 'alice' }));
        } else if (req.headers.authorization === TOKENS.bob) {
          subjects.push('bob'); res.setHeader('Content-Type', 'application/json'); res.write('{"id":');
          resolveBobAdmitted();
          // Bob is actually admitted with an incomplete body when Alice aborts.
          // His independent body reader must remain live through Alice's close.
          await barrier.settled; assert.equal(res.destroyed, false); res.end('"bob"}');
        } else { res.writeHead(401); res.end('{}'); }
      })().catch(error => { handlerErrors.push(error); res.destroy(); }).finally(() => handlerTasks.delete(task));
      handlerTasks.add(task);
    });
    const authPort = await listen(authority);
    const forbidden = async () => { providerCalls++; throw new Error('PROVIDER_NOT_ALLOWED'); };
    app = await createServer({ port: 0, accountsPath, autoPoll: false,
      hub: { metrics: {}, catalogue: forbidden, quote: forbidden, history: forbidden },
      authenticate: identityResolver({ endpoint: `http://127.0.0.1:${authPort}/api/v1/me`, issuer: 'cancel-barrier-fixture' }) });
    app.server.prependListener('request', (req, res) => { if (req.headers.authorization === TOKENS.alice) barrier.observeStocksResponse(res); });
    const url = `http://127.0.0.1:${app.port}/__stocks_global/state`;
    alice = request(url, TOKENS.alice); await deadline(barrier.admitted);
    // Start an independent live request while Alice is held, not after cleanup.
    bob = request(url, TOKENS.bob); await deadline(bobAdmitted);
    barrier.markClientAbort(); alice.client.destroy();
    const proof = await deadline(barrier.settled);
    assert.equal(proof.proof.status, 'PROVEN', JSON.stringify(proof));
    t.diagnostic(JSON.stringify({ fixtureOnly: true, compiledAuthority: false, capacityAcceptance: 'NOT_EVALUATED', ...proof }));
    assert.deepEqual(await deadline(alice.result), { aborted: true });
    const live = await deadline(bob.result);
    assert.equal(live.status, 200); assert.equal(live.body.account.mode, 'isolated-paper');
    assert.equal(live.body.account.id, bobAccountId);
    assert.equal(live.body.wallets.USDT.cash, '10000.00000000'); assert.equal(live.body.orders.length, 0); assert.equal(live.body.fills.length, 0);
    assert.deepEqual(subjects.sort(), ['alice', 'bob']); assert.equal(providerCalls, 0); assert.deepEqual(handlerErrors, []);
    await Promise.all([...handlerTasks]); assert.equal(handlerTasks.size, 0);
    // Read only this test's private ledger, after HTTP and the worker have
    // quiesced. A cancelled Alice authentication must not register an account.
    await closeApp();
    const db = new DatabaseSync(accountsPath, { readOnly: true });
    try {
      const persistedIds = db.prepare('SELECT id FROM paper_accounts ORDER BY id').all().map(row => row.id);
      assert.deepEqual(persistedIds, [bobAccountId]);
      assert.equal(persistedIds.includes(aliceAccountId), false);
      t.diagnostic(JSON.stringify({ fixtureAccountIsolation: true, readOnly: true, workerClosed: true, rows: persistedIds.length, bobMatched: true, aliceAbsent: true }));
    } finally { db.close(); }
  } finally {
    barrier.dispose(); alice?.client.destroy(); bob?.client.destroy();
    await Promise.allSettled([...handlerTasks]);
    try { await closeApp(); }
    finally { try { await close(authority); } finally { await rm(dir, { recursive: true, force: true }); } }
  }
  assert.deepEqual(barrier.snapshot().cleanup, { timerActive: false, authorityListenersActive: false, stocksListenerActive: false, handlerSettled: true });
});

test('barrier timeout and finally cleanup cannot become cancellation proof', { timeout: 3000 }, async () => {
  const barrier = createCancellationBarrier({ caseId: 'bounded-timeout', timeoutMs: 50 });
  let task, client;
  const authority = http.createServer((req, res) => { task = barrier.hold(req, res).finally(() => res.end('{}')); });
  try {
    const port = await listen(authority); client = request(`http://127.0.0.1:${port}/api/v1/me`, TOKENS.alice);
    await deadline(barrier.admitted); const result = await deadline(barrier.settled);
    assert.equal(result.terminalReason, 'BARRIER_TIMEOUT'); assert.equal(result.proof.status, 'NOT_PROVEN');
    assert.equal((await deadline(client.result)).status, 200); await task;
  } finally { barrier.dispose(); client?.client.destroy(); await close(authority); }
  assert.equal(barrier.snapshot().cleanup.handlerSettled, true); assert.equal(barrier.snapshot().cleanup.timerActive, false);
});

test('cleanup release removes listeners and cannot masquerade as observed upstream cancellation', { timeout: 3000 }, async () => {
  const barrier = createCancellationBarrier({ caseId: 'cleanup-release' });
  let task, client, response;
  const authority = http.createServer((req, res) => { response = res; task = barrier.hold(req, res).finally(() => res.end('{}')); });
  try {
    const port = await listen(authority); client = request(`http://127.0.0.1:${port}/api/v1/me`, TOKENS.alice);
    await deadline(barrier.admitted); barrier.dispose(); const result = await deadline(barrier.settled);
    assert.equal(result.terminalReason, 'CLEANUP_RELEASED'); assert.equal(result.proof.status, 'NOT_PROVEN');
    await deadline(client.result); await task; assert.equal(response.listenerCount('close'), 0);
  } finally { barrier.dispose(); client?.client.destroy(); await close(authority); }
});

test('proof rejects missing admission, close before abort, case mismatch, completion and incomplete cleanup', () => {
  const caseId = 'proof-guards', kinds = ['authority-admitted', 'client-abort', 'stocks-response-close', 'upstream-close', 'handler-finally'];
  const good = { caseId, terminalReason: 'UPSTREAM_CLOSED', cleanup: { timerActive: false, authorityListenersActive: false, stocksListenerActive: false, handlerSettled: true },
    events: kinds.map((kind, i) => ({ caseId, sequence: i + 1, kind, atMs: i })) };
  assert.equal(cancellationEvidence(good).status, 'PROVEN');
  const faults = [
    { ...good, events: good.events.slice(1) },
    { ...good, events: good.events.map((event, i) => ({ ...event, kind: i === 1 ? 'upstream-close' : i === 3 ? 'client-abort' : event.kind })) },
    { ...good, events: good.events.map((event, i) => ({ ...event, caseId: i === 2 ? 'another-case' : caseId })) },
    { ...good, terminalReason: 'AUTHORITY_FINISHED' },
    { ...good, cleanup: { ...good.cleanup, timerActive: true } },
    { ...good, events: good.events.map((event, i) => ({ ...event, atMs: i === 4 ? 0 : i })) },
  ];
  for (const bad of faults) assert.equal(cancellationEvidence(bad).status, 'NOT_PROVEN');
  const barrier = createCancellationBarrier({ caseId: 'pre-admission' });
  assert.throws(() => barrier.markClientAbort(), /BARRIER_ABORT_BEFORE_ADMISSION/); barrier.dispose();
});
