'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createFixtureState, SUBJECTS, maxAvatar, writePrivateCredentials } = require('./authority.cjs');
const { assertEnvelope, drainAuthority } = require('./authority-entry.cjs');
const time = 1791936000000;
const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = mode => createFixtureState({ mode, startedAtMs: time, contactEmailHash: hash });
const primary = { id: true, userId: true, revokedAt: true, lastSeenAt: true, remembered: true, user: { select: { email: true } } };
test('exactly 50 fixed principals have independent session and user rows', () => {
  const f = fixture('profile'); assert.equal(SUBJECTS.length, 50); assert.equal(new Set(SUBJECTS).size, 50);
  assert.equal(SUBJECTS[0], 'alice'); assert.equal(SUBJECTS[49], 'user050');
  f.mutate({ action: 'revoke', subject: 'alice' });
  assert.ok(f.state.sessions.get('alice').revokedAt instanceof Date);
  assert.equal(f.state.sessions.get('bob').revokedAt, null);
  f.mutate({ action: 'deleteUser', subject: 'alice' });
  assert.equal(f.state.users.has('alice'), false); assert.equal(f.state.users.get('bob').id, 'bob');
  f.mutate({ action: 'restoreUser', subject: 'alice' }); assert.equal(f.state.users.get('alice').id, 'alice');
});
test('reset initializes timestamps once and preserves original maximum avatar shape', () => {
  const f = fixture('profile'); f.state.sessions.get('bob').lastSeenAt = new Date(time + 1000);
  assert.equal(+f.state.sessions.get('alice').lastSeenAt, time);
  f.reset(time + 2000);
  for (const s of f.state.sessions.values()) { assert.equal(+s.createdAt, time + 2000); assert.equal(+s.lastSeenAt, time + 2000); assert.equal(s.remembered, false); }
  const a = maxAvatar(); assert.equal(a.length, 1024 * 1024); assert.ok(a.startsWith('data:image/png;base64,iVBORw'));
  const decoded = Buffer.from(a.slice(a.indexOf(',') + 1), 'base64'); assert.equal(decoded.length, 512 * 1024);
  assert.equal(f.avatarBytes, 1024 * 1024); assert.equal(f.avatarHash, hash(a));
});
test('compact adapter returns id only without reading avatar/profile columns', async () => {
  const f = fixture('compact');
  assert.deepEqual(await f.prisma.user.findUnique({ where: { id: 'alice' }, select: { id: true } }), { id: 'alice' });
  assert.equal(f.audit.compactAvatarReads, 0); assert.equal(f.audit.selectedUserReads, 1);
  await assert.rejects(f.prisma.user.findUnique({ where: { id: 'alice' } }), /FIXTURE_COMPACT_PROFILE_READ_DENIED/);
  await assert.rejects(f.prisma.user.findUnique({ where: { id: 'alice' }, select: { avatarUrl: true } }), /FIXTURE_USER_PROJECTION_INVALID/);
});
test('post-auth deletion occurs after session projection and is seen by the second user read', async () => {
  const f = fixture('compact'); f.mutate({ action: 'deleteBetweenReads', subject: 'alice' });
  const session = await f.prisma.session.findUnique({ where: { id: 'alice' }, select: primary });
  assert.equal(session.user.email, 'alice@fixture.invalid');
  assert.equal(await f.prisma.user.findUnique({ where: { id: 'alice' }, select: { id: true } }), null);
  assert.ok(f.state.users.has('bob')); f.mutate({ action: 'restoreUser', subject: 'alice' });
  assert.deepEqual(await f.prisma.user.findUnique({ where: { id: 'alice' }, select: { id: true } }), { id: 'alice' });
});
test('policy block and unblock are isolated, ordered and use original policy projections', async () => {
  const f = fixture('profile'); f.policy('alice', true, time); f.policy('alice', false, time + 1);
  const query = id => ({ where: { metadata: { path: ['emailHash'], equals: hash(id + '@fixture.invalid') }, action: { in: ['CONTACT_EMAIL_BLOCKED', 'CONTACT_EMAIL_UNBLOCKED'] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true } });
  assert.deepEqual(await f.prisma.auditLog.findFirst(query('alice')), { action: 'CONTACT_EMAIL_UNBLOCKED' });
  assert.equal(await f.prisma.auditLog.findFirst(query('bob')), null);
  await assert.rejects(f.prisma.auditLog.findFirst({ ...query('alice'), select: { metadata: true } }));
});
test('unexpected financial/native Prisma operations and changed query shapes are denied', async () => {
  const f = fixture('profile');
  assert.throws(() => f.prisma.balance.update(), /FIXTURE_PRISMA_OPERATION_DENIED|not a function/);
  assert.throws(() => f.prisma.$queryRaw(), /FIXTURE_PRISMA_OPERATION_DENIED/);
  assert.throws(() => f.prisma.user.update(), /FIXTURE_PRISMA_OPERATION_DENIED/);
  await assert.rejects(f.prisma.session.findUnique({ where: { id: 'alice' }, select: { userId: true } }), /FIXTURE_SESSION_QUERY_INVALID/);
  await assert.rejects(f.prisma.session.update({ where: { id: 'alice' }, data: { userId: 'bob' }, select: { id: true } }));
  assert.equal(f.state.sessions.get('alice').userId, 'alice');
});
test('fixture backend failures remain failures and can be restored explicitly', async () => {
  const f = fixture('compact'); f.mutate({ action: 'sessionBackendFailure', enabled: true });
  await assert.rejects(f.prisma.session.findUnique({ where: { id: 'alice' }, select: primary }), /FIXTURE_SESSION_UNAVAILABLE/);
  f.mutate({ action: 'sessionBackendFailure', enabled: false });
  assert.equal((await f.prisma.session.findUnique({ where: { id: 'alice' }, select: primary })).userId, 'alice');
  f.mutate({ action: 'userBackendFailure' });
  await assert.rejects(f.prisma.user.findUnique({ where: { id: 'alice' }, select: { id: true } }), /FIXTURE_USER_UNAVAILABLE/);
});
test('only the reviewed session lastSeenAt write is accepted', async () => {
  const f = fixture('profile'); const operations = f.audit.queryCalls;
  await f.prisma.session.update({ where: { id: 'alice' }, data: { lastSeenAt: new Date(time + 2000) }, select: { id: true } });
  assert.equal(+f.state.sessions.get('alice').lastSeenAt, time + 2000); assert.equal(+f.state.sessions.get('bob').lastSeenAt, time);
  assert.equal(f.audit.sessionTouches, 1); assert.equal(f.audit.queryCalls, operations + 1);
});
test('invalid fixture identities, times, controls and private-file paths fail before mutation', () => {
  const f = fixture('compact');
  assert.throws(() => f.mutate({ action: 'deleteUser', subject: 'actual-user' }));
  assert.throws(() => f.mutate({ action: 'arbitrarySql' }));
  assert.throws(() => f.reset(-1)); assert.equal(f.state.users.size, 50);
  assert.throws(() => writePrivateCredentials('/tmp/tokens.json', 'test', []), /FIXTURE_PRIVATE_PATH_REQUIRED/);
});
test('IPC accepts only bounded known operations with exact envelope keys', () => {
  assertEnvelope({ id: 'run1:init', op: 'init', args: {} });
  assertEnvelope({ id: 'run1:audit', op: 'audit', args: {} });
  for (const input of [null, [], { id: 'x', op: 'shell', args: {} }, { id: 'x', op: 'audit', args: {}, extra: 1 },
    { id: '\n', op: 'audit', args: {} }, { id: 'x', op: 'audit', args: [] }]) assert.throws(() => assertEnvelope(input));
});

test('restoring failed backend availability never restores another principal', () => {
  const f = fixture('profile'); f.mutate({ action: 'revoke', subject: 'bob' }); f.mutate({ action: 'sessionBackendFailure' });
  const revoked = f.state.sessions.get('bob').revokedAt; f.mutate({ action: 'restoreAll' });
  assert.equal(f.state.failSession, false); assert.equal(f.state.sessions.get('bob').revokedAt, revoked);
});

test('a disconnected response cannot hide pending original handler or adapter promises', async () => {
  const { createSettlementTracker } = require('./authority.cjs');
  const tracker = createSettlementTracker(); let resolveHandler, resolveOperation;
  const handler = new Promise(resolve => { resolveHandler = resolve; });
  const operation = new Promise(resolve => { resolveOperation = resolve; });
  const receiver = {}, input = { same: true };
  const wrapped = tracker.wrap(function(value) { assert.equal(this, receiver); assert.equal(value, input); return handler; }, 'handlers');
  assert.equal(wrapped.call(receiver, input), handler);
  assert.equal(tracker.wrap(() => operation, 'operations')(), operation);
  assert.throws(() => tracker.assertQuiescent(0), /FIXTURE_AUTHORITY_HANDLER_BUSY/);
  resolveHandler('unchanged'); assert.equal(await handler, 'unchanged');
  assert.throws(() => tracker.assertQuiescent(0), /FIXTURE_AUTHORITY_OPERATION_BUSY/);
  resolveOperation(17); assert.equal(await operation, 17); tracker.assertQuiescent(0);
  assert.deepEqual(tracker.snapshot(), { pending: { handlers: 0, operations: 0 }, counts: { handlers: 1, operations: 1 } });
  assert.throws(() => tracker.assertQuiescent(1), /FIXTURE_AUTHORITY_BUSY/);
});

test('settlement observation preserves original rejection and synchronous throw', async () => {
  const { createSettlementTracker } = require('./authority.cjs');
  const tracker = createSettlementTracker(), failure = Error('fixture rejection');
  const rejected = Promise.reject(failure);
  assert.equal(tracker.wrap(() => rejected, 'handlers')(), rejected);
  await assert.rejects(rejected, error => error === failure); tracker.assertQuiescent(0);
  assert.throws(() => tracker.wrap(() => { throw failure; }, 'handlers')(), error => error === failure);
  tracker.assertQuiescent(0);
});

test('both variants mount exactly two observed GET /me layers under the original /api/v1 prefix', async () => {
  const { createSettlementTracker, mountTrackedMeRouter } = require('./authority.cjs');
  for (const mode of ['profile', 'compact']) {
    const tracker = createSettlementTracker(), calls = [];
    const layers = [0, 1].map(index => ({ method: 'get', handle: async () => index }));
    const untouched = () => {};
    const router = { mode, stack: [{ route: { path: '/me', methods: { get: true }, stack: layers } },
      { route: { path: '/other', methods: { get: true }, stack: [{ handle: untouched }] } }] };
    mountTrackedMeRouter({ use: (...args) => calls.push(args) }, router, tracker);
    assert.deepEqual(calls, [['/api/v1', router]]);
    assert.equal(router.stack[1].route.stack[0].handle, untouched);
    assert.equal(await layers[0].handle(), 0); assert.equal(await layers[1].handle(), 1); tracker.assertQuiescent(0);
    assert.equal(tracker.snapshot().counts.handlers, 2);
  }
  const tracker = createSettlementTracker(), app = { use() { assert.fail('invalid route mounted'); } };
  assert.throws(() => mountTrackedMeRouter(app, { stack: [] }, tracker), /FIXTURE_ME_ROUTE_REQUIRED/);
  assert.throws(() => mountTrackedMeRouter(app, { stack: [{ route: { path: '/me', methods: { get: true }, stack: [] } }] }, tracker), /FIXTURE_ME_HANDLER_COUNT/);
});

test('explicit auth contract mismatch keeps a safe FAIL code while transport and source errors remain unclassified', () => {
  const { contractFailure } = require('./authority.cjs'), { safeCommandError } = require('./authority-entry.cjs');
  let mismatch;
  try { assert.equal(200, 401, 'private raw value must never escape'); } catch (error) { mismatch = error; }
  const tagged = contractFailure(mismatch, { caseName: 'revoked-session', expectedStatus: 401, actualStatus: 200 });
  assert.deepEqual(safeCommandError(tagged), { code: 'SAFETY_CONTRACT_MISMATCH', name: 'Error',
    contract: { caseName: 'revoked-session', expectedStatus: 401, actualStatus: 200 } });
  assert.ok(!JSON.stringify(safeCommandError(tagged)).includes('private raw'));
  const transport = Object.assign(Error('private provider detail'), { code: 'ECONNRESET' });
  assert.equal(contractFailure(transport, { caseName: 'transport' }), transport);
  assert.equal(safeCommandError(transport).code, 'FIXTURE_COMMAND_FAILED');
  assert.equal(safeCommandError(mismatch).code, 'FIXTURE_COMMAND_FAILED');
  assert.equal(safeCommandError(Error('FIXTURE_SOURCE_PROOF_FAILED')).code, 'FIXTURE_SOURCE_PROOF_FAILED');
  tagged.fixtureContract.authorization = 'must not be retained';
  assert.equal(Object.hasOwn(safeCommandError(tagged).contract, 'authorization'), false);
});

test('authority drain uses only caller remaining budget and waits for actual handler and operation tails', async () => {
  let clock = 0, calls = 0;
  const snapshots = [
    { active: 0, settlement: { pending: { handlers: 1, operations: 0 } } },
    { active: 0, settlement: { pending: { handlers: 0, operations: 1 } } },
    { active: 0, settlement: { pending: { handlers: 0, operations: 0 } } },
  ];
  const result = await drainAuthority({ snapshot: () => snapshots[calls++] }, 80,
    { now: () => clock, pause: async ms => { clock += ms; } });
  assert.equal(result.quiescent, true); assert.equal(result.elapsedMs, 50); assert.equal(calls, 3);
  for (const invalid of [undefined, 0, -1, 10001, 1.5]) await assert.rejects(drainAuthority({}, invalid), /FIXTURE_DRAIN_BUDGET_INVALID/);
});

test('authority rejects quiescence observed after the deadline including delayed timer delivery', async () => {
  let clock = 0; const ready = { active: 0, settlement: { pending: { handlers: 0, operations: 0 } } };
  await assert.rejects(drainAuthority({ snapshot: () => { clock = 80; return ready; } }, 80, { now: () => clock }), /FIXTURE_DRAIN_TIMEOUT/);
  clock = 0; let calls = 0;
  await assert.rejects(drainAuthority({ snapshot: () => { calls++; return calls === 1 ? { active: 1, settlement: ready.settlement } : ready; } }, 80,
    { now: () => clock, pause: async () => { clock = 81; } }), /FIXTURE_DRAIN_TIMEOUT/);
  assert.equal(calls, 1, 'late callback cannot return a fresh successful snapshot');
});
