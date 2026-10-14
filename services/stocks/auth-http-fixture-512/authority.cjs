// PLAN-ONLY QA fixture. Not a production handler, auth service or capacity acceptance runner.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { pathToFileURL } = require('node:url');
const SUBJECTS = Object.freeze(['alice', 'bob', ...Array.from({ length: 48 }, (_, i) => 'user' + String(i + 3).padStart(3, '0'))]);
const SECRET = 'stocks-auth-http-disposable-fixture-secret';
const PRIVATE_TOKEN_PATH = '/private-ipc/tokens.json';
const sha = b => createHash('sha256').update(b).digest('hex');
const MODE = new Set(['profile', 'compact']);
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,96}$/;
function subject(value) { assert.ok(SUBJECTS.includes(value), 'FIXTURE_SUBJECT_INVALID'); return value; }
function timestamp(value) { assert.ok(Number.isSafeInteger(value) && value >= 1700000000000 && value <= 2200000000000, 'FIXTURE_TIME_INVALID'); return value; }
function maxAvatar() {
  const png = Buffer.alloc(512 * 1024); png.set([0x89, 0x50, 0x4e, 0x47]);
  return ('data:image/png;base64,' + png.toString('base64')).padEnd(1024 * 1024, ' ');
}
function emptyAudit() {
  return { requests: 0, responseBytes: 0, completed: 0, disconnected: 0, unregisteredRequests: 0,
    sessionReads: 0, sessionTouches: 0, selectedUserReads: 0, fullUserReads: 0, policyReads: 0,
    profileAvatarReads: 0, compactAvatarReads: 0, unexpectedPrisma: 0, queryCalls: 0 };
}
function contractFailure(error, context) {
  // Transport, source proof and arbitrary implementation errors are not contract evidence.
  if (error?.code !== 'ERR_ASSERTION') return error;
  assert.match(context.caseName, /^[a-z0-9-]{1,80}$/);
  const safe = { caseName: context.caseName };
  for (const key of ['expectedStatus', 'actualStatus']) if (context[key] !== undefined) {
    assert.ok(Number.isInteger(context[key]) && context[key] >= 100 && context[key] <= 599); safe[key] = context[key];
  }
  const failure = Error('SAFETY_CONTRACT_MISMATCH'); failure.code = 'SAFETY_CONTRACT_MISMATCH'; failure.fixtureContract = safe;
  return failure;
}
// Observe the original returned promises without replacing them or changing their error path.
function createSettlementTracker() {
  const pending = { handlers: 0, operations: 0 }, counts = { handlers: 0, operations: 0 };
  function wrap(handler, kind) {
    assert.equal(typeof handler, 'function'); assert.ok(Object.hasOwn(pending, kind));
    return function(...args) {
      pending[kind]++; counts[kind]++; let settled = false;
      const done = () => { if (!settled) { settled = true; pending[kind]--; } };
      let result;
      try { result = handler.apply(this, args); assert.ok(result && typeof result.then === 'function', 'FIXTURE_PROMISE_REQUIRED'); }
      catch (error) { done(); throw error; }
      result.then(done, done);
      return result;
    };
  }
  function assertQuiescent(activeHttp) {
    assert.equal(activeHttp, 0, 'FIXTURE_AUTHORITY_BUSY');
    assert.equal(pending.handlers, 0, 'FIXTURE_AUTHORITY_HANDLER_BUSY');
    assert.equal(pending.operations, 0, 'FIXTURE_AUTHORITY_OPERATION_BUSY');
  }
  return { wrap, assertQuiescent, snapshot: () => ({ pending: { ...pending }, counts: { ...counts } }) };
}
function mountTrackedMeRouter(app, router, tracker) {
  assert.ok(Array.isArray(router.stack), 'FIXTURE_ROUTER_STACK_REQUIRED');
  const matches = router.stack.filter(layer => layer.route?.path === '/me' && layer.route.methods?.get === true);
  assert.equal(matches.length, 1, 'FIXTURE_ME_ROUTE_REQUIRED');
  const layers = matches[0].route.stack;
  assert.ok(Array.isArray(layers)); assert.equal(layers.length, 2, 'FIXTURE_ME_HANDLER_COUNT');
  for (const layer of layers) { assert.equal(layer.method, 'get'); layer.handle = tracker.wrap(layer.handle, 'handlers'); }
  app.use('/api/v1', router);
}
function createFixtureState({ startedAtMs, contactEmailHash, mode, operation = () => {} }) {
  assert.ok(MODE.has(mode)); timestamp(startedAtMs); assert.equal(typeof contactEmailHash, 'function');
  const state = { users: new Map(), sessions: new Map(), policies: [], failSession: false, failUser: false, failPolicy: false, orphanDelete: new Set(), start: startedAtMs };
  const audit = emptyAudit(), avatar = maxAvatar();
  const makeUser = id => ({ id, email: id + '@fixture.invalid', role: id === 'alice' ? 'ADMIN' : 'USER', displayName: id,
    phone: null, country: null, avatarUrl: avatar, kycStatus: 'NONE', twoFactorEnabled: false, createdAt: new Date('2026-01-01T00:00:00Z') });
  const makeSession = id => ({ id, userId: id, revokedAt: null, lastSeenAt: new Date(state.start), remembered: false, createdAt: new Date(state.start) });
  function reset(time, { avatars = true } = {}) {
    timestamp(time); state.start = time;
    state.users.clear(); state.sessions.clear(); state.policies.length = 0; state.orphanDelete.clear();
    state.failSession = state.failUser = state.failPolicy = false;
    for (const id of SUBJECTS) { const user = makeUser(id); if (!avatars) user.avatarUrl = null; state.users.set(id, user); state.sessions.set(id, makeSession(id)); }
  }
  function policy(id, blocked, time = Date.now()) {
    subject(id); timestamp(time); assert.equal(typeof blocked, 'boolean');
    assert.ok(state.policies.length < 1024, 'FIXTURE_POLICY_BOUND');
    state.policies.push({ id: String(state.policies.length).padStart(8, '0'), emailHash: contactEmailHash(id + '@fixture.invalid'),
      action: blocked ? 'CONTACT_EMAIL_BLOCKED' : 'CONTACT_EMAIL_UNBLOCKED', createdAt: new Date(time) });
  }
  function mutate({ action, subject: id = 'alice', enabled = true }) {
    subject(id); assert.equal(typeof enabled, 'boolean');
    switch (action) {
      case 'revoke': assert.ok(state.sessions.has(id)); state.sessions.get(id).revokedAt = new Date(); break;
      case 'restoreSession': state.sessions.set(id, makeSession(id)); break;
      case 'deleteUser': state.users.delete(id); break;
      case 'restoreUser': state.users.set(id, makeUser(id)); state.orphanDelete.delete(id); break;
      case 'block': policy(id, true); break;
      case 'unblock': policy(id, false, Date.now() + 1); break;
      case 'deleteBetweenReads': state.orphanDelete.add(id); break;
      case 'sessionBackendFailure': state.failSession = enabled; break;
      case 'policyBackendFailure': state.failPolicy = enabled; break;
      case 'userBackendFailure': state.failUser = enabled; break;
      case 'restoreAll': state.failSession = state.failUser = state.failPolicy = false; break; // Restore backend availability only; never another principal.
      default: throw Error('FIXTURE_MUTATION_INVALID');
    }
  }
  const denied = () => { audit.unexpectedPrisma++; throw Error('FIXTURE_PRISMA_OPERATION_DENIED'); };
  const strict = methods => new Proxy(methods, { get: (target, key) => typeof key === 'symbol' ? target[key] : Object.hasOwn(target, key) ? target[key] : denied });
  const selected = (row, select) => row ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : null;
  const count = kind => { audit[kind]++; audit.queryCalls++; operation(kind); };
  // Query shapes are copied from the reviewed principal-projection proof. Unknown operations fail closed.
  const prisma = strict({
    session: strict({
      findUnique: async ({ where, select }) => {
        count('sessionReads'); assert.deepEqual(Object.keys(where), ['id']);
        const primary = { id: true, userId: true, revokedAt: true, lastSeenAt: true, remembered: true, user: { select: { email: true } } };
        const remembered = { createdAt: true, user: { select: { role: true } } };
        assert.ok(JSON.stringify(select) === JSON.stringify(primary) || JSON.stringify(select) === JSON.stringify(remembered), 'FIXTURE_SESSION_QUERY_INVALID');
        if (state.failSession) throw Error('FIXTURE_SESSION_UNAVAILABLE');
        const row = state.sessions.get(where.id); if (!row) return null;
        const user = state.users.get(row.userId);
        const result = Object.fromEntries(Object.keys(select).map(k => [k, k === 'user' ? selected(user, select.user.select) : row[k]]));
        if (state.orphanDelete.has(row.userId)) state.users.delete(row.userId);
        return result;
      },
      update: async ({ where, data, select }) => {
        count('sessionTouches'); assert.deepEqual(Object.keys(where), ['id']); assert.deepEqual(select, { id: true });
        assert.deepEqual(Object.keys(data), ['lastSeenAt']); assert.ok(data.lastSeenAt instanceof Date && Number.isFinite(+data.lastSeenAt));
        const row = state.sessions.get(where.id); assert.ok(row, 'FIXTURE_SESSION_MISSING');
        row.lastSeenAt = data.lastSeenAt; return { id: row.id };
      },
    }),
    user: strict({ findUnique: async ({ where, select }) => {
      assert.deepEqual(Object.keys(where), ['id']); if (state.failUser) throw Error('FIXTURE_USER_UNAVAILABLE');
      const row = state.users.get(where.id);
      const observed = row && new Proxy(row, { get(target, key, receiver) {
        if (key === 'avatarUrl') audit[mode === 'compact' ? 'compactAvatarReads' : 'profileAvatarReads']++;
        return Reflect.get(target, key, receiver);
      } });
      if (select) {
        count('selectedUserReads');
        assert.ok(JSON.stringify(select) === '{"id":true,"email":true}' || (mode === 'compact' && JSON.stringify(select) === '{"id":true}'), 'FIXTURE_USER_PROJECTION_INVALID');
        return selected(observed, select);
      }
      assert.equal(mode, 'profile', 'FIXTURE_COMPACT_PROFILE_READ_DENIED'); count('fullUserReads');
      return row ? { ...observed } : null;
    } }),
    auditLog: strict({ findFirst: async ({ where, orderBy, select }) => {
      count('policyReads'); if (state.failPolicy) throw Error('FIXTURE_POLICY_UNAVAILABLE');
      assert.deepEqual(where.metadata.path, ['emailHash']); assert.deepEqual(orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
      const actions = typeof where.action === 'string' ? [where.action] : where.action.in;
      assert.ok(Array.isArray(actions) && actions.length > 0 && actions.every(x => ['CONTACT_EMAIL_BLOCKED', 'CONTACT_EMAIL_UNBLOCKED'].includes(x)), 'FIXTURE_POLICY_QUERY_INVALID');
      assert.ok(JSON.stringify(select) === '{"action":true}' || JSON.stringify(select) === '{"createdAt":true}');
      const event = state.policies.filter(x => x.emailHash === where.metadata.equals && actions.includes(x.action))
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0];
      return selected(event, select);
    } }),
  });
  reset(startedAtMs);
  return { state, audit, prisma, reset, mutate, policy, avatarHash: sha(avatar), avatarBytes: Buffer.byteLength(avatar) };
}
function writePrivateCredentials(file, issuer, credentials) {
  assert.equal(file, PRIVATE_TOKEN_PATH, 'FIXTURE_PRIVATE_PATH_REQUIRED');
  const parent = fs.lstatSync(path.dirname(file));
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === process.getuid() && (parent.mode & 0o077) === 0, 'FIXTURE_PRIVATE_DIRECTORY_INVALID');
  assert.equal(fs.realpathSync(path.dirname(file)), path.dirname(file), 'FIXTURE_PRIVATE_PATH_CHANGED');
  assert.equal(credentials.length, 50); assert.deepEqual(credentials.map(x => x.subject), SUBJECTS);
  const bytes = Buffer.from(JSON.stringify({ schema: 1, issuer, credentials }) + '\n');
  assert.ok(bytes.length < 64 * 1024);
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); const st = fs.fstatSync(fd); assert.ok(st.isFile() && st.uid === process.getuid() && (st.mode & 0o777) === 0o600); }
  finally { fs.closeSync(fd); }
  return { path: file, count: 50, mode: '600', containsFixtureCredentials: true, artifactAllowed: false };
}
function safeEnvironment() {
  assert.equal(process.platform, 'linux', 'FIXTURE_REQUIRES_LINUX');
  assert.equal(process.env.STOCKS_AUTH_HTTP_FIXTURE, 'true', 'FIXTURE_OPT_IN_REQUIRED');
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'SHADOW_DATABASE_URL', 'NODE_OPTIONS', 'NODE_PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'LD_PRELOAD'])
    assert.ok(!process.env[key], 'FIXTURE_ENVIRONMENT_DENIED:' + key);
  assert.equal(process.env.JWT_SECRET, SECRET, 'FIXTURE_DISPOSABLE_SECRET_REQUIRED');
}
async function createAuthority({ sourceRoot, compiledRoot, proofFile, mode, port, issuer, startedAtMs, eventSink = () => {} }) {
  safeEnvironment(); assert.ok(MODE.has(mode)); timestamp(startedAtMs);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535); assert.match(issuer, /^[A-Za-z0-9_.:-]{1,128}$/);
  for (const value of [sourceRoot, compiledRoot, proofFile]) assert.ok(path.isAbsolute(value));
  const { verifyBuild } = require(path.join(sourceRoot, 'scripts/qa-stocks-principal-projection.cjs'));
  const sourceProvenance = verifyBuild(proofFile, sourceRoot, compiledRoot);
  const provenance = { ...sourceProvenance, authorityFixtureSha256: sha(fs.readFileSync(__filename)), authorityEntrySha256: sha(fs.readFileSync(path.join(__dirname, 'authority-entry.cjs'))) };
  const express = require(path.join(sourceRoot, 'node_modules/express'));
  const jwt = require(path.join(sourceRoot, 'node_modules/jsonwebtoken'));
  const { accountRouter } = require(path.join(compiledRoot, 'dist/api/routes/account.js'));
  const { requireAuth } = require(path.join(compiledRoot, 'dist/api/middleware/auth.js'));
  const { asyncRoute } = require(path.join(compiledRoot, 'dist/api/asyncRoute.js'));
  const { contactEmailHash } = require(path.join(compiledRoot, 'dist/services/ContactEmailPolicy.js'));
  const { identityResolver } = await import(pathToFileURL(path.join(sourceRoot, 'services/stocks-global/identity.mjs')));
  const als = new AsyncLocalStorage(), active = new Map(), registered = new Map(), credentials = new Map(), window = new Map();
  let sequence = 0, events = 0, closed = false;
  const emit = value => { assert.ok(++events <= 12000, 'FIXTURE_EVENT_BOUND'); eventSink(value); };
  const fixture = createFixtureState({ startedAtMs, contactEmailHash, mode, operation(kind) {
    const row = als.getStore(); if (row) row.operations[kind] = (row.operations[kind] || 0) + 1;
  } });
  const settlement = createSettlementTracker();
  for (const model of Object.values(fixture.prisma)) for (const method of Object.keys(model)) {
    model[method] = settlement.wrap(model[method], 'operations');
  }
  function sign(id = 'alice', extra = {}, secret = SECRET, options = { expiresIn: '60m' }) {
    subject(id); return jwt.sign({ sub: id, sid: id, ...extra }, secret, options);
  }
  function register(token, id, requestId = null) {
    subject(id); assert.ok(typeof token === 'string' && token.length <= 4096);
    assert.ok(registered.size < 512 || registered.has(token), 'FIXTURE_TOKEN_REGISTRY_BOUND');
    registered.set(token, { subject: id, requestId }); return token;
  }
  for (const id of SUBJECTS) { const token = sign(id); credentials.set(id, token); register(token, id); }
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.url !== '/api/v1/me') return res.status(403).json({ error: 'FIXTURE_ROUTE_DENIED' });
    const token = typeof req.headers.authorization === 'string' ? req.headers.authorization.replace(/^Bearer /, '') : '';
    const descriptor = registered.get(token);
    const requestId = descriptor?.requestId || (descriptor && window.get(descriptor.subject));
    if (!descriptor || !requestId) fixture.audit.unregisteredRequests++;
    assert.ok(++sequence <= 4096, 'FIXTURE_REQUEST_BOUND');
    const row = { sequence, requestId: requestId || null, subject: descriptor?.subject || null, start: performance.now(), startedMonoNs: process.hrtime.bigint().toString(), operations: {}, responseBytes: 0 };
    active.set(sequence, row); fixture.audit.requests++;
    emit({ type: 'authority-start', sequence, requestId: row.requestId, subject: row.subject, at: row.start, startedMonoNs: row.startedMonoNs });
    res.setHeader('Cache-Control', 'no-store');
    const write = res.write, end = res.end;
    const length = (chunk, encoding) => chunk == null ? 0 : Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk), typeof encoding === 'string' ? encoding : undefined);
    res.write = function(chunk, encoding, callback) { row.responseBytes += length(chunk, encoding); return write.call(this, chunk, encoding, callback); };
    res.end = function(chunk, encoding, callback) { row.responseBytes += length(chunk, encoding); return end.call(this, chunk, encoding, callback); };
    let done = false;
    const terminal = kind => {
      if (done) return; done = true; active.delete(row.sequence);
      fixture.audit[kind === 'finish' ? 'completed' : 'disconnected']++; fixture.audit.responseBytes += row.responseBytes;
      emit({ type: 'authority-terminal', ...row, end: performance.now(), endedMonoNs: process.hrtime.bigint().toString(), status: res.headersSent ? res.statusCode : null, headersSent: res.headersSent, terminal: kind });
    };
    res.once('finish', () => terminal('finish')); res.once('close', () => terminal('close'));
    als.run(row, next);
  });
  const router = mode === 'profile' ? accountRouter(fixture.prisma) : express.Router();
  if (mode === 'compact') router.get('/me', requireAuth(fixture.prisma), asyncRoute(async (req, res) => {
    const user = await fixture.prisma.user.findUnique({ where: { id: req.userId }, select: { id: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    assert.ok(user.id === req.userId && /^[A-Za-z0-9_.:@-]{1,128}$/.test(user.id));
    const body = { id: user.id }; assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 137);
    return res.json(body);
  }));
  mountTrackedMeRouter(app, router, settlement);
  app.use((_error, _req, res, _next) => { if (!res.headersSent) res.status(503).json({ error: 'FIXTURE_AUTH_UNAVAILABLE' }); else res.destroy(); });
  const server = app.listen(port, '127.0.0.1'); server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = 'http://127.0.0.1:' + port, endpoint = origin + '/api/v1/me';
  const resolver = identityResolver({ endpoint, issuer });
  function quiescent() { settlement.assertQuiescent(active.size); }
  function setWindow(entries) {
    quiescent(); assert.ok(Array.isArray(entries) && entries.length <= 50);
    const next = new Map(), ids = new Set();
    for (const row of entries) { subject(row.subject); assert.match(row.requestId, REQUEST_ID); assert.ok(!next.has(row.subject) && !ids.has(row.requestId)); next.set(row.subject, row.requestId); ids.add(row.requestId); }
    window.clear(); for (const [key, value] of next) window.set(key, value);
    return { registeredSubjects: window.size };
  }
  function snapshot() {
    return { mode, origin, issuer, active: active.size, settlement: settlement.snapshot(), counters: { ...fixture.audit }, events, subjects: SUBJECTS.slice(),
      avatarBytes: fixture.avatarBytes, avatarSha256: fixture.avatarHash, startedAtMs: fixture.state.start,
      sessionOffsets: SUBJECTS.map(id => { const s = fixture.state.sessions.get(id); return { subject: id, present: !!s, createdOffsetMs: s ? +s.createdAt - fixture.state.start : null, lastSeenOffsetMs: s ? +s.lastSeenAt - fixture.state.start : null }; }) };
  }
  function control(args) {
    quiescent();
    if (args.action === 'prepare') { timestamp(args.startedAtMs); fixture.reset(args.startedAtMs); window.clear(); registered.clear(); for (const [id, token] of credentials) register(token, id); return snapshot(); }
    fixture.mutate(args); return { action: args.action, subject: args.subject || 'alice', applied: true };
  }
  async function runContractCases() {
    quiescent(); const before = fixture.audit.requests, rows = [];
    let caseSequence = 0;
    async function observe(name, setup = () => {}, token = sign(), expected = 200, id = 'alice') {
      fixture.reset(Date.now(), { avatars: false }); setup();
      const caseId = 'contract:' + mode + ':' + (++caseSequence);
      register(token, id, caseId + ':direct');
      const headers = { Authorization: 'Bearer ' + token, 'x-user-id': id === 'alice' ? 'bob' : 'alice', 'x-role': 'ADMIN' };
      const response = await fetch(endpoint, { headers, redirect: 'error', signal: AbortSignal.timeout(3000) });
      const text = await response.text(), body = JSON.parse(text);
      try {
        assert.equal(response.status, expected, name); assert.equal(response.headers.get('cache-control'), 'no-store');
        if (expected === 200) { assert.equal(body.id, id); if (mode === 'compact') assert.deepEqual(body, { id }); }
      } catch (error) { throw contractFailure(error, { caseName: name, expectedStatus: expected, actualStatus: response.status }); }
      register(token, id, caseId + ':resolver');
      let principal = null, code = null;
      try { principal = await resolver({ headers: { authorization: headers.Authorization, 'x-user-id': headers['x-user-id'], 'x-role': 'ADMIN' } }); } catch (error) { code = error.code; }
      try {
        if (expected === 200) assert.deepEqual(principal, { issuer, subject: id });
        else assert.equal(code, expected === 503 ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED');
      } catch (error) { throw contractFailure(error, { caseName: name + '-identity' }); }
      rows.push({ name, mode, status: response.status, bytes: Buffer.byteLength(text), principal, code });
    }
    const s = fixture.state;
    await observe('valid-session');
    await observe('valid-bob-forged-owner-role-ignored', undefined, sign('bob'), 200, 'bob');
    await observe('pending-2fa', undefined, sign('alice', { purpose: 'pending_2fa' }), 401);
    await observe('subject-session-mismatch', undefined, sign('alice', { sub: 'bob' }), 401);
    await observe('expired-jwt', undefined, sign('alice', { exp: Math.floor(Date.now() / 1000) - 5 }, SECRET, {}), 401);
    await observe('invalid-signature', undefined, sign('alice', {}, 'different-disposable-fixture-secret'), 401);
    await observe('revoked-session', () => { s.sessions.get('alice').revokedAt = new Date(); }, undefined, 401);
    await observe('missing-session', () => s.sessions.delete('alice'), undefined, 401);
    await observe('blocked-contact', () => fixture.policy('alice', true), undefined, 403);
    await observe('deleted-user-orphan-session', () => s.users.delete('alice'), undefined, 404);
    await observe('deleted-between-middleware-and-handler', () => s.orphanDelete.add('alice'), undefined, 404);
    await observe('session-backend-unavailable', () => { s.failSession = true; }, undefined, 503);
    await observe('policy-backend-unavailable', () => { s.failPolicy = true; }, undefined, 503);
    await observe('post-auth-user-unavailable', () => { s.failUser = true; }, undefined, 503);
    await observe('remembered-admin-valid', () => { s.sessions.get('alice').remembered = true; });
    await observe('remembered-admin-idle-expired', () => { const row = s.sessions.get('alice'); row.remembered = true; row.lastSeenAt = new Date(Date.now() - 31 * 86400000); }, undefined, 401);
    await observe('remembered-demoted-ordinary-expired', () => { s.users.get('alice').role = 'USER'; const row = s.sessions.get('alice'); row.remembered = true; row.createdAt = new Date(Date.now() - 13 * 3600000); }, undefined, 401);
    await observe('stale-session-touch', () => { s.sessions.get('alice').lastSeenAt = new Date(Date.now() - 6 * 60000); });
    const legacy = jwt.sign({ sub: 'alice', iat: Math.floor(Date.now() / 1000) - 60 }, SECRET, { expiresIn: '10m' });
    await observe('legacy-valid', undefined, legacy);
    await observe('legacy-deleted', () => s.users.delete('alice'), legacy, 401);
    await observe('legacy-blocked', () => fixture.policy('alice', true), legacy, 403);
    await observe('legacy-revoked-after-unblock', () => { fixture.policy('alice', true, Date.now() - 1000); fixture.policy('alice', false); }, legacy, 401);
    await observe('maximum-avatar-valid', () => { s.users.get('alice').avatarUrl = maxAvatar(); });
    await observe('maximum-avatar-blocked', () => { s.users.get('alice').avatarUrl = maxAvatar(); fixture.policy('alice', true); }, undefined, 403);
    try { assert.equal(rows.length, 24); } catch (error) { throw contractFailure(error, { caseName: 'paired-row-count' }); }
    fixture.reset(Date.now(), { avatars: false });
    const token = register(sign(), 'alice', 'contract:' + mode + ':immediate:valid');
    const req = { headers: { authorization: 'Bearer ' + token } };
    const immediatePrincipal = await resolver(req);
    try { assert.deepEqual(immediatePrincipal, { issuer, subject: 'alice' }); } catch (error) { throw contractFailure(error, { caseName: 'immediate-valid-identity' }); }
    const checks = [];
    for (const [name, mutate, undo] of [
      ['revoke', () => { s.sessions.get('alice').revokedAt = new Date(); }, () => { s.sessions.get('alice').revokedAt = null; }],
      ['block', () => fixture.policy('alice', true), () => fixture.policy('alice', false, Date.now() + 1)],
      ['delete', () => s.users.delete('alice'), () => {}],
    ]) {
      mutate(); register(token, 'alice', 'contract:' + mode + ':immediate:' + name); const reads = fixture.audit.sessionReads;
      try {
        await assert.rejects(resolver(req), error => error.code === 'AUTH_REQUIRED');
        assert.ok(fixture.audit.sessionReads > reads);
      } catch (error) { throw contractFailure(error, { caseName: 'immediate-' + name }); }
      checks.push(name); undo();
    }
    try {
      assert.equal(fixture.audit.requests - before, 52);
      assert.equal(fixture.audit.compactAvatarReads, 0); assert.equal(fixture.audit.unexpectedPrisma, 0);
    } catch (error) { throw contractFailure(error, { caseName: 'contract-accounting' }); }
    assert.deepEqual(verifyBuild(proofFile, sourceRoot, compiledRoot), sourceProvenance);
    // Functional mutations are never a timed-load seed. The driver must explicitly prepare afterward.
    window.clear();
    return { status: 'PASS', mode, pairedRows: rows, immediateSequence: { mode, checks }, authorityRequests: 52 };
  }
  return { origin, provenance, snapshot, control, setWindow, runContractCases,
    privateTokenDescriptors: () => SUBJECTS.map(id => ({ subject: id, authorization: 'Bearer ' + credentials.get(id) })),
    async close() { quiescent(); if (!closed) { closed = true; await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); } return { closed: true, active: active.size }; },
  };
}
module.exports = { SUBJECTS, SECRET, PRIVATE_TOKEN_PATH, createFixtureState, createAuthority, writePrivateCredentials, maxAvatar, emptyAudit, safeEnvironment, createSettlementTracker, mountTrackedMeRouter, contractFailure };
