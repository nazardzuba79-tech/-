import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAccountWorker } from './account-worker.mjs';
import { accountId, openAccounts } from './accounts.mjs';
import { snapshot, applyQuote, submit } from './engine.mjs';

const NOW = 1791569400000;
const ID = 'BYBIT:AAPLXUSDT';
const ALICE = { issuer: 'worker-fixture-only', subject: 'alice' };
const BOB = { issuer: 'worker-fixture-only', subject: 'bob' };
const quote = (extra = {}) => ({ instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100', timestamp: NOW, receivedAt: NOW, verified: true, marketOpen: true, eventId: 'worker-fixture-quote-1', capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' } }, fx: {}, ...extra });
const order = (n, extra = {}) => ({ id: `worker-request-${String(n).padStart(16, '0')}`, instrumentId: ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.1', ...extra });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-worker-test-'));
  const path = join(dir, 'accounts.sqlite');
  const control = new Int32Array(new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT));
  const repo = await openAccountWorker(path, { now: () => NOW, diagnostics: true, ...options, testHooks: { commitControl: control.buffer } });
  const repositories = [repo];
  t.after(async () => {
    Atomics.store(control, 2, 1); Atomics.notify(control, 2);
    for (const value of repositories) await value.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  const reopen = async () => {
    const value = await openAccountWorker(path, { now: () => NOW, diagnostics: true });
    repositories.push(value); return value;
  };
  return { repo, path, dir, control, reopen };
}

async function entered(control, after) {
  const deadline = Date.now() + 5000;
  while (Atomics.load(control, 1) <= after) {
    assert.ok(Date.now() < deadline, 'worker must enter the deterministic commit barrier');
    await delay(5);
  }
}

function release(control) { Atomics.store(control, 2, 1); Atomics.notify(control, 2); }
function durable(path, principal) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return JSON.parse(db.prepare('SELECT ledger FROM paper_accounts WHERE id=?').get(accountId(principal)).ledger); }
  finally { db.close(); }
}

test('worker acknowledges only durable commits and never mixes Alice/Bob account namespaces', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE), bob = await f.repo.forPrincipal(BOB);
  assert.notEqual(alice.id, bob.id);
  await alice.execute('quote', quote());
  const bought = await alice.execute('submit', order(1));
  assert.deepEqual(snapshot(durable(f.path, ALICE), NOW), bought.snapshot, 'acknowledged data is readable from a separate SQLite connection');
  await alice.execute('submit', order(2, { type: 'LIMIT', limitPrice: '50', quantity: '0.2' }));
  const a = await alice.read(), b = await bob.read();
  assert.equal(a.wallets.USDT.cash, '9990.00000000');
  assert.equal(a.wallets.USDT.reserved, '10.00000000');
  assert.equal(a.positions[ID + '|USDT'].quantity, '0.10000000');
  assert.equal(b.wallets.USDT.cash, '10000.00000000');
  assert.equal(b.wallets.USDT.reserved, '0.00000000');
  assert.deepEqual(b.positions, {}); assert.equal(b.orders.length, 0); assert.equal(b.fills.length, 0);
  await assert.rejects(bob.execute('cancel', { id: order(2).id }), /ORDER_NOT_FOUND/);
  await bob.execute('quote', quote()); await bob.execute('submit', order(1));
  assert.equal((await bob.read()).fills.length, 1, 'same request ID is scoped to its authenticated account');
  assert.deepEqual((await alice.read()).fills, a.fills);
  await assert.rejects(f.repo.forPrincipal({ issuer: ALICE.issuer, subject: '../bob' }), /AUTH_REQUIRED/);
  await assert.rejects(alice.execute('arbitrary-sql', { sql: 'DROP TABLE paper_accounts' }));
});

test('blocked pre-COMMIT work has no optimistic acknowledgement and rollback exposes no mutation', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE);
  await alice.execute('quote', quote());
  const before = await alice.read(), count = Atomics.load(f.control, 1);
  Atomics.store(f.control, 0, 1); Atomics.store(f.control, 2, 0); Atomics.store(f.control, 4, 1);
  let settled = false;
  const command = alice.execute('submit', order(1));
  const rejected = assert.rejects(command, /ACCOUNT_TEST_COMMIT_FAILURE/);
  command.then(() => { settled = true; }, () => { settled = true; });
  await entered(f.control, count);
  assert.equal(settled, false, 'a pending disk commit must not be acknowledged');
  assert.deepEqual(snapshot(durable(f.path, ALICE), NOW), before, 'other connections cannot see uncommitted balances or fills');
  release(f.control); await rejected; Atomics.store(f.control, 4, 0);
  assert.deepEqual(await alice.read(), before, 'rollback preserves the committed revision and complete ledger');
  assert.equal((await alice.execute('submit', order(1))).snapshot.fills.length, 1);
});

test('worker loss after COMMIT reports unknown outcome and retry/restart never double-fills', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE);
  await alice.execute('quote', quote()); Atomics.store(f.control, 3, 1);
  await assert.rejects(alice.execute('submit', order(1)), /ACCOUNT_OUTCOME_UNKNOWN/);
  const committed = durable(f.path, ALICE);
  assert.equal(committed.fills.length, 1); assert.equal(committed.wallets.USDT.cash, '9990.00000000');
  await assert.rejects(alice.read(), /ACCOUNT_UNAVAILABLE/);
  const recovered = await f.reopen(), restored = await recovered.forPrincipal(ALICE);
  const retried = await restored.execute('submit', order(1));
  assert.equal(retried.result.id, order(1).id);
  assert.deepEqual(retried.snapshot.fills, committed.fills);
  assert.equal(retried.snapshot.wallets.USDT.cash, '9990.00000000');
  assert.equal(retried.snapshot.positions[ID + '|USDT'].quantity, '0.10000000');
  await assert.rejects(restored.execute('submit', order(1, { quantity: '0.2' })), /IDEMPOTENCY_CONFLICT/);
});

test('a snapshot failure after COMMIT reports unknown outcome without pretending the durable mutation rolled back', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-commit-ack-test-')), path = join(dir, 'accounts.sqlite');
  let armed = false, throwAfterCommit = false;
  const repo = openAccounts(path, {
    now: () => { if (throwAfterCommit) { throwAfterCommit = false; throw Error('fixture acknowledgement snapshot failure'); } return NOW; },
    beforeCommit: () => { if (armed) throwAfterCommit = true; },
  });
  t.after(async () => { repo.close(); await rm(dir, { recursive: true, force: true }); });
  const alice = repo.forPrincipal(ALICE); await alice.transact(s => applyQuote(s, quote(), NOW));
  armed = true;
  await assert.rejects(alice.transact(s => submit(s, order(1), NOW)), /ACCOUNT_OUTCOME_UNKNOWN/);
  armed = false;
  const committed = durable(path, ALICE);
  assert.equal(committed.wallets.USDT.cash, '9990.00000000'); assert.equal(committed.fills.length, 1);
  const replay = await alice.transact(s => submit(s, order(1), NOW));
  assert.deepEqual(replay.snapshot.fills, committed.fills);
  assert.equal(replay.snapshot.positions[ID + '|USDT'].quantity, '0.10000000');
  assert.equal(replay.snapshot.wallets.USDT.cash, '9990.00000000');
});

test('an explicit unknown-outcome worker response fail-closes the connection and never dispatches queued mutations', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE);
  await alice.execute('quote', quote());
  const count = Atomics.load(f.control, 1);
  Atomics.store(f.control, 0, 1); Atomics.store(f.control, 2, 0); Atomics.store(f.control, 3, 2);
  const active = assert.rejects(alice.execute('submit', order(1)), /ACCOUNT_OUTCOME_UNKNOWN/);
  await entered(f.control, count);
  const queued = assert.rejects(alice.execute('submit', order(2, { type: 'LIMIT', limitPrice: '50' })), /ACCOUNT_UNAVAILABLE/);
  release(f.control); await active; await queued;
  assert.equal(f.repo.metrics().workerAlive, 0);
  await assert.rejects(alice.read(), /ACCOUNT_UNAVAILABLE/);
  await assert.rejects(alice.execute('submit', order(3)), /ACCOUNT_UNAVAILABLE/);
  const committed = durable(f.path, ALICE);
  assert.deepEqual(committed.orders.map(o => o.id), [order(1).id]); assert.equal(committed.fills.length, 1);
  const restarted = await f.reopen(), recovered = await restarted.forPrincipal(ALICE);
  const replay = await recovered.execute('submit', order(1));
  assert.deepEqual(replay.snapshot.fills, committed.fills);
  assert.equal(replay.snapshot.wallets.USDT.cash, '9990.00000000');
  assert.equal(replay.snapshot.wallets.USDT.reserved, '0.00000000');
});

test('queued timeout and admission rejection never execute later; in-flight timeout never implies rollback', async t => {
  const f = await fixture(t, { maxPending: 2, queueTimeoutMs: 60 }), alice = await f.repo.forPrincipal(ALICE);
  await alice.execute('quote', quote());
  const count = Atomics.load(f.control, 1); Atomics.store(f.control, 0, 1); Atomics.store(f.control, 2, 0);
  let activeSettled = false;
  const active = alice.execute('submit', order(1, { type: 'LIMIT', limitPrice: '50' }));
  active.then(() => { activeSettled = true; }, () => { activeSettled = true; });
  await entered(f.control, count);
  const timedOut = assert.rejects(alice.execute('submit', order(2, { type: 'LIMIT', limitPrice: '50' })), /ACCOUNT_BUSY/);
  await assert.rejects(alice.execute('submit', order(3)), /ACCOUNT_BUSY/);
  await timedOut;
  assert.equal(activeSettled, false, 'the dispatch boundary, not elapsed time, determines whether outcome is unknown');
  release(f.control); await active;
  const state = await alice.read();
  assert.deepEqual(state.orders.map(o => o.id), [order(1).id]);
  assert.equal(state.wallets.USDT.reserved, '5.00000000');
  await alice.execute('cancel', { id: order(1).id });
  assert.equal((await alice.read()).wallets.USDT.reserved, '0.00000000', 'released capacity accepts subsequent commands');
});

test('queue byte budget is bounded and admitted account/order values are immutable snapshots', async t => {
  const f = await fixture(t, { maxQueueBytes: 1024 }), principal = { ...ALICE }, alice = await f.repo.forPrincipal(principal);
  principal.subject = BOB.subject;
  const count = Atomics.load(f.control, 1); Atomics.store(f.control, 0, 1); Atomics.store(f.control, 2, 0);
  const first = alice.execute('submit', order(1, { type: 'LIMIT', limitPrice: '50' }));
  await entered(f.control, count);
  await assert.rejects(alice.execute('submit', order(2, { type: 'LIMIT', limitPrice: '50', padding: 'x'.repeat(1024) })), /ACCOUNT_BUSY/);
  const input = order(3, { type: 'LIMIT', limitPrice: '50', quantity: '0.2' });
  const next = alice.execute('submit', input); input.quantity = '100'; input.id = order(4).id;
  assert.ok(f.repo.metrics().queue.maxBytes <= 1024);
  release(f.control); await Promise.all([first, next]);
  const state = await alice.read();
  assert.equal(alice.id, accountId(ALICE));
  assert.deepEqual(state.orders.map(o => o.id), [order(1).id, order(3).id]);
  assert.equal(state.orders[1].quantity, '0.20000000');
  assert.equal(state.wallets.USDT.reserved, '15.00000000');
  assert.equal(f.repo.metrics().queue.bytes, 0); assert.equal(f.repo.metrics().queue.active, 0);
});

test('lost cancellation acknowledgement is unknown, while restart/retry releases reservation only once', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE);
  await alice.execute('submit', order(1, { type: 'LIMIT', limitPrice: '50', quantity: '0.2' }));
  const count = Atomics.load(f.control, 1); Atomics.store(f.control, 0, 1); Atomics.store(f.control, 2, 0); Atomics.store(f.control, 3, 1);
  const unknown = assert.rejects(alice.execute('cancel', { id: order(1).id }), /ACCOUNT_OUTCOME_UNKNOWN/);
  await entered(f.control, count);
  const neverDispatched = assert.rejects(alice.execute('submit', order(2, { type: 'LIMIT', limitPrice: '50' })), /ACCOUNT_UNAVAILABLE/);
  release(f.control); await unknown; await neverDispatched;
  const committed = durable(f.path, ALICE);
  assert.equal(committed.orders.length, 1); assert.equal(committed.orders[0].status, 'CANCELLED');
  assert.equal(committed.wallets.USDT.reserved, '0.00000000');
  const restarted = await f.reopen(), restored = await restarted.forPrincipal(ALICE);
  const cancelled = await restored.execute('cancel', { id: order(1).id });
  assert.equal(cancelled.result.status, 'CANCELLED');
  assert.equal(cancelled.snapshot.wallets.USDT.cash, '10000.00000000');
  assert.equal(cancelled.snapshot.wallets.USDT.reserved, '0.00000000');
  assert.equal(cancelled.snapshot.fills.length, 0);
});

test('delayed commands validate quote freshness at execution, not when placed in the queue', async t => {
  let time = NOW;
  const f = await fixture(t, { now: () => time }), alice = await f.repo.forPrincipal(ALICE);
  await alice.execute('quote', quote());
  const count = Atomics.load(f.control, 1); Atomics.store(f.control, 0, 1); Atomics.store(f.control, 2, 0);
  const blocking = alice.execute('submit', order(1, { type: 'LIMIT', limitPrice: '50' }));
  await entered(f.control, count);
  const stale = assert.rejects(alice.execute('submit', order(2)), /QUOTE_STALE/);
  time += 60001; release(f.control); await blocking; await stale;
  const state = await alice.read();
  assert.equal(state.fills.length, 0); assert.deepEqual(state.orders.map(o => o.id), [order(1).id]);
  assert.equal(state.wallets.USDT.cash, '10000.00000000');
});

test('restart restores both accounts, reservations and consumed quote capacity without touching ownerless JSON', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE), bob = await f.repo.forPrincipal(BOB);
  const legacy = join(f.dir, 'ledger.json'), legacyBytes = '{"legacy":"unassigned-owner-history"}';
  await writeFile(legacy, legacyBytes);
  await alice.execute('quote', quote()); await alice.execute('submit', order(1, { quantity: '0.8' }));
  await alice.execute('submit', order(2, { type: 'LIMIT', limitPrice: '50', quantity: '0.2' }));
  await bob.execute('balances', { id: 'worker-balance-fixture-1', balances: { USDT: '2000', USDC: '3000' } });
  const beforeAlice = await alice.read(), beforeBob = await bob.read();
  await f.repo.close(); const recovered = await f.reopen(), a = await recovered.forPrincipal(ALICE), b = await recovered.forPrincipal(BOB);
  assert.deepEqual(await a.read(), beforeAlice); assert.deepEqual(await b.read(), beforeBob);
  await a.execute('quote', quote());
  const next = await a.execute('submit', order(3, { quantity: '0.5' }));
  assert.equal(next.result.filled, '0.20000000', 'replaying a quote never replenishes consumed observation capacity');
  assert.equal(next.snapshot.positions[ID + '|USDT'].quantity, '1.00000000');
  assert.equal(next.snapshot.wallets.USDT.reserved, '10.00000000');
  assert.equal(await readFile(legacy, 'utf8'), legacyBytes);
});

test('matching and cancellation races preserve fill history and release each reservation once', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE);
  await alice.execute('quote', quote());
  await alice.execute('submit', order(1, { type: 'LIMIT', limitPrice: '100', quantity: '1.2' }));
  const [, cancelled] = await Promise.all([
    alice.execute('quote', quote({ eventId: 'worker-fixture-quote-2' })),
    alice.execute('cancel', { id: order(1).id }),
  ]);
  assert.equal(cancelled.result.status, 'PARTIAL_CANCELLED');
  assert.equal(cancelled.snapshot.orders[0].filled, '1.00000000');
  assert.equal(cancelled.snapshot.wallets.USDT.reserved, '0.00000000');
  const repeated = await alice.execute('cancel', { id: order(1).id });
  assert.deepEqual(repeated.snapshot.fills, cancelled.snapshot.fills);
  assert.equal(repeated.snapshot.wallets.USDT.cash, '9900.00000000');
  assert.equal(repeated.snapshot.wallets.USDT.reserved, '0.00000000');
  await assert.rejects(alice.execute('submit', order(2, { side: 'SELL', quantity: '1.1' })), /INSUFFICIENT_SHARES/);
});
