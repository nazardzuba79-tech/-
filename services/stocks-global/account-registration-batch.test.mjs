import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { openAccounts, accountId } from './accounts.mjs';
import { openAccountWorker } from './account-worker.mjs';
import { setBalances } from './engine.mjs';

const NOW = 1791569400000;
const principal = subject => ({ issuer: 'registration-batch-fixture-only', subject });
const ALICE = principal('alice'), BOB = principal('bob');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const control = () => new Int32Array(new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT));
const release = value => { Atomics.store(value, 2, 1); Atomics.notify(value, 2); };
const arm = value => { Atomics.store(value, 0, 1); Atomics.store(value, 2, 0); return Atomics.load(value, 1); };
async function entered(value, previous) {
  const deadline = Date.now() + 5000;
  while (Atomics.load(value, 1) <= previous) {
    assert.ok(Date.now() < deadline, 'registration/financial worker must enter its commit barrier');
    await delay(5);
  }
}
function rows(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return new Map(db.prepare('SELECT id,ledger FROM paper_accounts').all().map(row => [row.id, JSON.parse(row.ledger)])); }
  finally { db.close(); }
}
async function localPath(t) {
  const directory = await mkdtemp(join(tmpdir(), 'stocks-registration-batch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'paper.sqlite');
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'stocks-registration-worker-'));
  const path = join(directory, 'paper.sqlite'), financial = control(), registration = control();
  const repo = await openAccountWorker(path, { now: () => NOW, diagnostics: true, ...options,
    testHooks: { commitControl: financial.buffer, registrationControl: registration.buffer } });
  const repositories = [repo];
  t.after(async () => {
    release(financial); release(registration);
    for (const item of repositories) await item.close();
    await rm(directory, { recursive: true, force: true });
  });
  let serial = 0;
  // Returning an object keeps an async helper from awaiting the blocked promise.
  const gate = async (account, balance) => {
    const previous = arm(financial);
    const pending = account.execute('balances', { id: `batch-gate-${String(++serial).padStart(20, '0')}`, balances: { USDT: balance ?? '10000', USDC: '10000' } });
    pending.catch(() => {}); await entered(financial, previous); return { pending };
  };
  const reopen = async () => { const next = await openAccountWorker(path, { now: () => NOW, diagnostics: true }); repositories.push(next); return next; };
  return { path, repo, financial, registration, gate, reopen };
}

test('group registration deduplicates identities, commits once and never overwrites an existing funded ledger', async t => {
  const path = await localPath(t), repo = openAccounts(path, { now: () => NOW, diagnostics: true });
  try {
    const alice = repo.forPrincipal(ALICE);
    await alice.transact(state => setBalances(state, { id: 'existing-ledger-adjustment-1', balances: { USDT: '12345', USDC: '3210' } }, NOW));
    const before = alice.readState(), metrics = repo.metrics();
    const result = repo.ensurePrincipals([BOB, ALICE, BOB, principal('carol')]);
    assert.equal(result.committed, true);
    assert.equal(result.owners.length, 3);
    assert.equal(result.owners.filter(owner => owner.created).length, 2);
    assert.deepEqual(alice.readState(), before);
    assert.equal(rows(path).size, 3);
    assert.equal(repo.metrics().sqlWriteCalls - metrics.sqlWriteCalls, 2);
    assert.equal(repo.metrics().sqlStages.commit.calls - metrics.sqlStages.commit.calls, 1);
    const beforeRetry = repo.metrics();
    assert.equal(repo.ensurePrincipals([ALICE, BOB, BOB]).committed, false);
    assert.equal(repo.metrics().sqlWriteCalls, beforeRetry.sqlWriteCalls);
    assert.equal(repo.metrics().transactionExecCalls, beforeRetry.transactionExecCalls);
    assert.deepEqual(alice.readState(), before);
  } finally { repo.close(); }
  const restarted = openAccounts(path, { now: () => NOW + 1000 });
  try {
    assert.equal(restarted.forPrincipal(ALICE).read().wallets.USDT.cash, '12345.00000000');
    assert.equal(restarted.forPrincipal(BOB).read().wallets.USDT.cash, '10000.00000000');
    assert.equal(restarted.forPrincipal(ALICE).readState().adjustments.length, 1);
  } finally { restarted.close(); }
});

test('invalid or oversized registration groups cannot partly create accounts', async t => {
  const path = await localPath(t), repo = openAccounts(path);
  try {
    assert.throws(() => repo.ensurePrincipals([ALICE, principal('../invalid')]), error => error.code === 'AUTH_REQUIRED');
    assert.throws(() => repo.ensurePrincipals(Array.from({ length: 33 }, (_, n) => principal(`owner-${n}`))), error => error.code === 'ACCOUNT_COMMAND_INVALID');
    assert.equal(rows(path).size, 0);
  } finally { repo.close(); }
});

test('another process creating an identity between lookup and BEGIN is never overwritten', async t => {
  const path = await localPath(t), repo = openAccounts(path, { now: () => NOW }), other = openAccounts(path, { now: () => NOW + 500 });
  const original = DatabaseSync.prototype.exec; let inserted = false;
  const patched = t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (sql === 'BEGIN IMMEDIATE' && !inserted) { inserted = true; other.forPrincipal(BOB); }
    return original.call(this, sql);
  });
  try {
    const result = repo.ensurePrincipals([ALICE, BOB]);
    assert.equal(result.owners.find(owner => owner.id === accountId(BOB)).created, false);
    assert.equal(repo.forPrincipal(BOB).readState().createdAt, NOW + 500);
    assert.equal(rows(path).size, 2);
  } finally { patched.mock.restore(); repo.close(); other.close(); }
});

test('a later INSERT failure rolls back every new owner in the registration group', async t => {
  const path = await localPath(t), repo = openAccounts(path, { diagnostics: true });
  const trigger = new DatabaseSync(path);
  trigger.exec(`CREATE TRIGGER fail_fixture_owner BEFORE INSERT ON paper_accounts WHEN NEW.id='${accountId(BOB)}' BEGIN SELECT RAISE(ABORT,'fixture later insert failed'); END`);
  trigger.close();
  try {
    assert.throws(() => repo.ensurePrincipals([ALICE, BOB]), /fixture later insert failed/);
    assert.equal(rows(path).size, 0);
    assert.equal(repo.metrics().sqlStages.rollback.calls, 1);
    assert.equal(repo.metrics().sqlStages.commit, undefined);
  } finally { repo.close(); }
});

test('a registration rollback failure is explicitly unknown, never a claimed clean rejection', async t => {
  const path = await localPath(t), repo = openAccounts(path, { beforeRegistrationCommit: () => { throw Error('fixture pre-commit failure'); } });
  const original = DatabaseSync.prototype.exec;
  const patched = t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (sql === 'ROLLBACK') throw Error('fixture rollback failure');
    return original.call(this, sql);
  });
  try {
    assert.throws(() => repo.ensurePrincipals([ALICE, BOB]), error => error.code === 'ACCOUNT_OUTCOME_UNKNOWN');
  } finally { patched.mock.restore(); repo.close(); }
  assert.equal(rows(path).size, 0, 'closing the failed connection recovers its uncommitted transaction');
});

test('50 queued owners use bounded groups, receive no pre-COMMIT ACK and survive graceful drain/restart', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE), { pending } = await f.gate(alice, '12000');
  const previous = arm(f.registration);
  let acknowledgements = 0;
  const owners = Array.from({ length: 50 }, (_, n) => principal(`burst-${n}`));
  const waiting = Promise.all(owners.map(owner => f.repo.forPrincipal(owner).then(account => { acknowledgements++; return account; })));
  waiting.catch(() => {});
  release(f.financial); await pending; await entered(f.registration, previous);
  assert.equal(acknowledgements, 0);
  assert.equal(rows(f.path).size, 1, 'uncommitted group is not visible to an independent connection');
  assert.equal(f.repo.metrics().queue.active, 32);
  assert.equal(f.repo.metrics().queue.pending, 18);
  let closed = false;
  const closing = f.repo.close().then(() => { closed = true; });
  await delay(10); assert.equal(closed, false);
  release(f.registration);
  const accounts = await waiting; await closing;
  assert.deepEqual(accounts.map(account => account.id), owners.map(accountId));
  assert.equal(Atomics.load(f.registration, 1), 2, '32 + 18 registrations share two FULL transactions');
  assert.equal(f.repo.metrics().sqlWriteCalls, 52, 'one initial Alice INSERT, one financial update and 50 registration INSERTs');
  assert.equal(f.repo.metrics().sqlStages.commit.calls, 3, 'one financial commit and two registration commits');
  assert.equal(f.repo.metrics().queue.registrationGroups, 2);
  assert.equal(f.repo.metrics().queue.groupedRegistrations, 50);
  assert.equal(f.repo.metrics().queue.maxRegistrationGroup, 32);
  assert.ok(f.repo.metrics().queue.logicalWorkMs > f.repo.metrics().queue.workMs, 'logical member latency must not be hidden by amortized occupancy');
  assert.equal(f.repo.metrics().queue.bytes, 0);
  assert.equal(rows(f.path).size, 51);
  const restarted = await f.reopen();
  assert.equal((await (await restarted.forPrincipal(ALICE)).read()).wallets.USDT.cash, '12000.00000000');
  const restored = await Promise.all(owners.map(async owner => (await restarted.forPrincipal(owner)).read()));
  assert.ok(restored.every(snapshot => snapshot.wallets.USDT.cash === '10000.00000000' && snapshot.fills.length === 0));
  assert.equal(restarted.metrics().sqlWriteCalls, 0, 'reopening existing accounts never credits them again');
});

test('registration grouping preserves FIFO across an interleaved financial command', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE), first = await f.gate(alice);
  const previous = arm(f.registration);
  const before = [principal('before-one'), principal('before-two')], after = [principal('after-one'), principal('after-two')];
  const beforeRequests = Promise.all(before.map(owner => f.repo.forPrincipal(owner)));
  const middle = alice.execute('balances', { id: 'middle-financial-command-1', balances: { USDT: '15000', USDC: '10000' } });
  const afterRequests = Promise.all(after.map(owner => f.repo.forPrincipal(owner)));
  [beforeRequests, middle, afterRequests].forEach(promise => promise.catch(() => {}));
  release(f.financial); await first.pending; await entered(f.registration, previous);
  const financialCount = arm(f.financial);
  release(f.registration); await beforeRequests; await entered(f.financial, financialCount);
  const committed = rows(f.path);
  assert.ok(before.every(owner => committed.has(accountId(owner))));
  assert.ok(after.every(owner => !committed.has(accountId(owner))), 'later registrations must not jump the financial command');
  assert.equal(committed.get(accountId(ALICE)).wallets.USDT.cash, '10000.00000000', 'middle financial transaction remains uncommitted');
  release(f.financial); await middle; await afterRequests;
  assert.equal((await alice.read()).wallets.USDT.cash, '15000.00000000');
});

test('a read command is also a FIFO barrier between registration groups', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE), first = await f.gate(alice);
  const previous = arm(f.registration);
  const before = Promise.all(['before-read-one', 'before-read-two'].map(subject => f.repo.forPrincipal(principal(subject))));
  const read = alice.read();
  const after = Promise.all(['after-read-one', 'after-read-two'].map(subject => f.repo.forPrincipal(principal(subject))));
  [before, read, after].forEach(promise => promise.catch(() => {}));
  release(f.financial); await first.pending; await entered(f.registration, previous);
  assert.equal(f.repo.metrics().queue.active, 2);
  assert.equal(f.repo.metrics().queue.pending, 3);
  release(f.registration); await Promise.all([before, read, after]);
  assert.equal(Atomics.load(f.registration, 1), 2);
});

test('mixed existing/new duplicate registration preserves observed prices and consumed execution capacity', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE), gateOwner = await f.repo.forPrincipal(principal('gate'));
  const id = 'BYBIT:AAPLXUSDT';
  const quote = { instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100', timestamp: NOW,
    receivedAt: NOW, verified: true, marketOpen: true, eventId: 'batch-capacity-fixture', capacity: '1.00000000',
    prices: { USDT: { buy: '100', sell: '100' } }, fx: {} };
  const order = n => ({ id: `batch-capacity-order-${n}`, instrumentId: id, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.6' });
  await alice.execute('observe', quote);
  await alice.execute('submitObserved', { order: order(1) });
  await alice.execute('observe', { ...quote, receivedAt: NOW + 1 });
  const before = await alice.execute('readView'), first = await f.gate(gateOwner);
  const waiting = Promise.all([ALICE, BOB, ALICE, principal('carol'), BOB].map(owner => f.repo.forPrincipal(owner))); waiting.catch(() => {});
  release(f.financial); await first.pending; const registered = await waiting;
  assert.equal(registered[0].id, registered[2].id);
  assert.equal(registered[1].id, registered[4].id);
  assert.deepEqual(await alice.execute('readView'), before);
  const after = await alice.execute('submitObserved', { order: order(2) });
  assert.equal(after.snapshot.fills.at(-1).quantity, '0.40000000');
  assert.equal(rows(f.path).size, 4);
});

test('active group members retain request/byte limits and queued expiry never creates an owner later', async t => {
  const f = await fixture(t, { maxPending: 4, maxQueueBytes: 800, queueTimeoutMs: 150 }), alice = await f.repo.forPrincipal(ALICE);
  // This is an active-group accounting test, not a 150 ms fsync benchmark.
  // Keep real worker/COMMIT barriers and the original queue deadline, but
  // establish that precondition before advancing the queue's logical clock.
  let now = performance.now();
  const nativeTimeout = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  const timers = new Map(), owned = new Set();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => {
    if (milliseconds !== 150) return nativeTimeout(callback, milliseconds, ...args);
    const handle = {}; owned.add(handle); timers.set(handle, { callback, args, at: now + milliseconds }); return handle;
  });
  t.mock.method(globalThis, 'clearTimeout', handle => {
    if (owned.has(handle)) { timers.delete(handle); return; }
    return nativeClear(handle);
  });
  const advance = milliseconds => {
    now += milliseconds;
    for (const [handle, timer] of [...timers]) if (timer.at <= now) {
      timers.delete(handle); timer.callback(...timer.args);
    }
  };
  const first = await f.gate(alice), previous = arm(f.registration);
  const activeOwners = ['one', 'two', 'three'].map(principal);
  const active = Promise.all(activeOwners.map(owner => f.repo.forPrincipal(owner))); active.catch(() => {});
  release(f.financial); await first.pending;
  await Promise.race([entered(f.registration, previous), active.then(() => { throw Error('registration completed before its armed barrier'); })]);
  assert.equal(f.repo.metrics().queue.active, 3);
  assert.equal(f.repo.metrics().queue.pending, 0);
  assert.equal(timers.size, 0, 'all active registration deadlines were cancelled on dispatch');
  await assert.rejects(f.repo.forPrincipal({ issuer: 'x'.repeat(512), subject: 'byte-rejected' }), error => error.code === 'ACCOUNT_BUSY');
  const expiredOwner = principal('expired'), rejectedOwner = principal('count-rejected');
  const expired = f.repo.forPrincipal(expiredOwner); expired.catch(() => {});
  await assert.rejects(f.repo.forPrincipal(rejectedOwner), error => error.code === 'ACCOUNT_BUSY');
  const beforeExpiry = f.repo.metrics().queue.timedOut;
  assert.equal(timers.size, 1, 'exactly the queued owner retains its 150 ms deadline');
  advance(149);
  assert.equal(f.repo.metrics().queue.pending, 1);
  assert.equal(f.repo.metrics().queue.timedOut, beforeExpiry);
  assert.equal(timers.size, 1);
  advance(1);
  await assert.rejects(expired, error => error.code === 'ACCOUNT_BUSY');
  assert.equal(f.repo.metrics().queue.timedOut, beforeExpiry + 1);
  assert.equal(f.repo.metrics().queue.pending, 0);
  assert.equal(f.repo.metrics().queue.active, 3);
  assert.equal(timers.size, 0);
  assert.equal(f.repo.metrics().queue.maxPending, 4);
  assert.ok(f.repo.metrics().queue.maxBytes <= 800);
  release(f.registration); await active;
  const durable = rows(f.path);
  assert.equal(durable.size, 4);
  assert.equal(durable.has(accountId(expiredOwner)), false);
  assert.equal(durable.has(accountId(rejectedOwner)), false);
  assert.equal(f.repo.metrics().queue.bytes, 0);
});

test('real registration deadlines may expire behind a prior commit without creating any queued owners', async t => {
  const f = await fixture(t, { maxPending: 4, maxQueueBytes: 800, queueTimeoutMs: 150 }), alice = await f.repo.forPrincipal(ALICE);
  const first = await f.gate(alice), previous = arm(f.registration);
  const queuedOwners = ['one', 'two', 'three'].map(principal);
  // Do not release the prior real commit until the three real queue timers fire.
  const outcomes = await Promise.allSettled(queuedOwners.map(owner => f.repo.forPrincipal(owner)));
  assert.equal(outcomes.length, 3);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, 'rejected'); assert.equal(outcome.reason.code, 'ACCOUNT_BUSY');
  }
  assert.equal(f.repo.metrics().queue.queueTimeoutMs, 150);
  assert.equal(f.repo.metrics().queue.timedOut, 3);
  assert.equal(f.repo.metrics().queue.pending, 0);
  assert.equal(Atomics.load(f.registration, 1), previous);
  release(f.financial); await first.pending;
  const durable = rows(f.path);
  assert.equal(durable.size, 1);
  for (const owner of queuedOwners) assert.equal(durable.has(accountId(owner)), false);
  assert.equal(Atomics.load(f.registration, 1), previous);
  assert.equal(f.repo.metrics().queue.bytes, 0);
});

test('elapsed queue deadlines are checked at dispatch even before the timer callback can run', async t => {
  const f = await fixture(t, { queueTimeoutMs: 1000 }), alice = await f.repo.forPrincipal(ALICE);
  const originalNow = performance.now.bind(performance); let offset = 0;
  t.mock.method(performance, 'now', () => originalNow() + offset);
  const first = await f.gate(alice);
  const waiting = Promise.allSettled([f.repo.forPrincipal(BOB), f.repo.forPrincipal(principal('carol'))]);
  offset = 1100; release(f.financial); await first.pending;
  const results = await waiting;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'ACCOUNT_BUSY'));
  assert.equal(rows(f.path).size, 1);
  assert.equal(Atomics.load(f.registration, 1), 0);
  assert.equal(f.repo.metrics().queue.timedOut, 2);
});

test('a failed pre-COMMIT group rolls back all owners, and a later retry funds them only once', async t => {
  const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE), first = await f.gate(alice);
  Atomics.store(f.registration, 4, 1);
  const waiting = Promise.allSettled([f.repo.forPrincipal(BOB), f.repo.forPrincipal(principal('carol')), f.repo.forPrincipal(BOB)]);
  release(f.financial); await first.pending;
  const results = await waiting;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'ACCOUNT_TEST_REGISTRATION_COMMIT_FAILURE'));
  assert.equal(rows(f.path).size, 1);
  Atomics.store(f.registration, 4, 0);
  const retried = await Promise.all([f.repo.forPrincipal(BOB), f.repo.forPrincipal(principal('carol')), f.repo.forPrincipal(BOB)]);
  assert.equal(retried[0].id, retried[2].id);
  assert.equal(rows(f.path).size, 3);
  assert.equal((await retried[0].read()).wallets.USDT.cash, '10000.00000000');
});

for (const outcome of ['after-commit-exit', 'after-commit-unknown', 'before-commit-exit']) {
  test(`registration ${outcome} fails closed and retry/restart cannot double-credit owners`, async t => {
    const f = await fixture(t), alice = await f.repo.forPrincipal(ALICE), first = await f.gate(alice, '12000');
    if (outcome === 'before-commit-exit') Atomics.store(f.registration, 4, 2);
    else Atomics.store(f.registration, 3, outcome === 'after-commit-exit' ? 1 : 2);
    const registered = Promise.allSettled([f.repo.forPrincipal(BOB), f.repo.forPrincipal(principal('carol'))]);
    const queued = alice.execute('balances', { id: 'must-not-run-after-unknown', balances: { USDT: '99999', USDC: '99999' } }); queued.catch(() => {});
    release(f.financial); await first.pending;
    const results = await registered;
    assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'ACCOUNT_OUTCOME_UNKNOWN'));
    await assert.rejects(queued, error => error.code === 'ACCOUNT_UNAVAILABLE');
    await f.repo.close();
    const restarted = await f.reopen();
    const countBeforeRetry = rows(f.path).size;
    assert.equal(countBeforeRetry, outcome === 'before-commit-exit' ? 1 : 3);
    const accounts = await Promise.all([restarted.forPrincipal(BOB), restarted.forPrincipal(principal('carol'))]);
    assert.equal(rows(f.path).size, 3);
    assert.equal((await (await restarted.forPrincipal(ALICE)).read()).wallets.USDT.cash, '12000.00000000');
    assert.ok((await Promise.all(accounts.map(account => account.read()))).every(state => state.wallets.USDT.cash === '10000.00000000' && state.fills.length === 0));
  });
}
