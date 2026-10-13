// OFFLINE QA COUNTERFACTUAL ONLY. The compact /me handler below is not a
// production endpoint, deployable auth change, or capacity acceptance test.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const SECRET = 'stocks-principal-projection-disposable-fixture-secret';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const boundedFile = (file, maximum = 4 * 1024 * 1024) => {
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'bounded regular file required');
  return fs.readFileSync(file);
};
function sourceInputs(base) {
  const rows = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else { assert.ok(entry.isFile(), 'no special source file'); if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) rows.push({ path: path.relative(base, file).replaceAll('\\', '/'), sha256: sha(boundedFile(file)) }); }
    }
  }
  walk(path.join(base, 'src')); return rows.sort((a, b) => a.path.localeCompare(b.path));
}
// Accept an explicit successful fresh-build proof from the existing local-stage
// rehearsal only while every source/compiler/config and used emitted module still
// matches. Drift requires a new build; stale outputs are never silently reused.
function verifyBuild(proofFile, base = root, compiledBase = base) {
  assert.ok(path.isAbsolute(proofFile) && path.isAbsolute(base) && path.isAbsolute(compiledBase));
  const proofBytes = boundedFile(proofFile), proof = JSON.parse(proofBytes);
  assert.equal(proof.exitCode, 0); assert.equal(proof.signal, null); assert.equal(proof.sourcesUnchanged, true);
  assert.equal(sha(boundedFile(path.join(base, 'tsconfig.json'))), proof.tsconfig.sha256);
  assert.equal(sha(boundedFile(path.join(base, 'package-lock.json'), 8 * 1024 * 1024)), proof.packageLockSha256);
  assert.deepEqual(sourceInputs(base), proof.sourcesBefore, 'fresh source-build binding required');
  assert.equal(sha(JSON.stringify(proof.sourcesBefore)), proof.sourcesAfterHash);
  for (const row of proof.compilerFiles) {
    assert.ok(/^(package\.json|bin\/tsc|lib\/(?:_?tsc)\.js)$/.test(row.file));
    assert.equal(sha(boundedFile(path.join(base, 'node_modules/typescript', row.file), 16 * 1024 * 1024)), row.sha256);
  }
  assert.equal(sha(boundedFile(path.join(path.dirname(proofFile), 'build.log'))), proof.logSha256);
  const outputs = new Map(proof.outputs.map(row => [row.path, row.sha256]));
  const checked = new Map();
  // Browser jobs may receive only the verified compiled artifact, without a
  // root dist directory. Keep current-source checks above anchored to base;
  // only this emitted closure can come from a separate compiled package.
  const compiledDist = path.join(compiledBase, 'dist');
  const distStat = fs.lstatSync(compiledDist);
  assert.ok(distStat.isDirectory() && !distStat.isSymbolicLink(), 'regular compiled dist directory required');
  const realDist = fs.realpathSync(compiledDist);
  function visit(relative) {
    assert.ok(/^dist\/[A-Za-z0-9_/-]+\.js$/.test(relative) && !relative.includes('..'), 'compiled closure path');
    if (checked.has(relative)) return;
    const file = path.join(compiledBase, relative);
    assert.ok(fs.realpathSync(file).startsWith(realDist + path.sep), 'compiled module stays inside artifact dist');
    const bytes = boundedFile(file), digest = sha(bytes);
    assert.equal(digest, outputs.get(relative), 'actual compiled module must match fresh build');
    checked.set(relative, digest);
    for (const match of bytes.toString().matchAll(/require\(["']([^"']+)["']\)/g)) if (match[1].startsWith('.')) visit(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])) + '.js');
  }
  ['dist/api/routes/account.js', 'dist/api/middleware/auth.js', 'dist/api/asyncRoute.js', 'dist/services/ContactEmailPolicy.js'].forEach(visit);
  return { proofSha256: sha(proofBytes), compiled: Object.fromEntries(checked), sourceCount: proof.sourcesBefore.length,
    compilerVersion: proof.compilerVersion, sourceBuildStartedAt: proof.startedAt, sourceBuildEndedAt: proof.endedAt,
    identityResolverSha256: sha(boundedFile(path.join(base, 'services/stocks-global/identity.mjs'))),
    fixtureSha256: sha(boundedFile(__filename)) };
}
async function child(proofFile, output) {
  assert.ok(process.env.STOCKS_PRINCIPAL_PROJECTION_FIXTURE === 'true', 'fixture invocation required');
  assert.ok(process.env.JWT_SECRET === SECRET, 'disposable fixture secret required');
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'NODE_OPTIONS', 'NODE_PATH']) assert.ok(!Object.hasOwn(process.env, key), key + ' must be absent');
  const provenance = verifyBuild(proofFile);
  const net = require('node:net');
  const allowed = new Set(), audit = { requests: 0, deniedNetwork: 0, unexpectedPrisma: 0, sessionReads: 0, sessionTouches: 0, policyReads: 0, fullUserReads: 0, selectedUserReads: 0, profileAvatarReads: 0, compactAvatarReads: 0 };
  const nativeConnect = net.Socket.prototype.connect, nativeFetch = globalThis.fetch;
  net.Socket.prototype.connect = function (...args) {
    const a = Array.isArray(args[0]) ? args[0] : args;
    const o = typeof a[0] === 'object' ? a[0] : { port: a[0], host: a[1] };
    if (o.path || (o.host || o.hostname) !== '127.0.0.1' || !allowed.has(Number(o.port))) { audit.deniedNetwork++; throw Error('FIXTURE_NETWORK_DENIED'); }
    return Reflect.apply(nativeConnect, this, args);
  };
  globalThis.fetch = (input, options) => {
    const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !allowed.has(Number(u.port))) { audit.deniedNetwork++; return Promise.reject(Error('FIXTURE_NETWORK_DENIED')); }
    return nativeFetch(input, options);
  };
  const express = require('express'), jwt = require('jsonwebtoken');
  const { accountRouter } = require('../dist/api/routes/account.js');
  const { requireAuth } = require('../dist/api/middleware/auth.js');
  const { asyncRoute } = require('../dist/api/asyncRoute.js');
  const { contactEmailHash } = require('../dist/services/ContactEmailPolicy.js');
  const { identityResolver } = await import(pathToFileURL(path.join(root, 'services/stocks-global/identity.mjs')).href);
  const state = { users: new Map(), sessions: new Map(), policies: [], failSession: false, failUser: false, failPolicy: false, orphanDelete: false };
  const rows = [], servers = [], resolvers = new Map(), endpoints = new Map();
  const unknown = () => { audit.unexpectedPrisma++; throw Error('FIXTURE_PRISMA_OPERATION_DENIED'); };
  const strict = methods => new Proxy(methods, { get: (target, name) => typeof name === 'symbol' ? target[name] : Object.hasOwn(target, name) ? target[name] : unknown });
  const selectRow = (row, select) => row ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : null;
  function reset() {
    state.users.clear(); state.sessions.clear(); state.policies.length = 0;
    state.failSession = state.failUser = state.failPolicy = state.orphanDelete = false;
    for (const id of ['alice', 'bob']) {
      state.users.set(id, { id, email: id + '@fixture.invalid', role: id === 'alice' ? 'ADMIN' : 'USER', displayName: id, phone: null, country: null, avatarUrl: null, kycStatus: 'NONE', twoFactorEnabled: false, createdAt: new Date('2026-01-01T00:00:00Z') });
      state.sessions.set(id, { id, userId: id, revokedAt: null, lastSeenAt: new Date(), remembered: false, createdAt: new Date() });
    }
  }
  function policy(blocked, time = Date.now()) { state.policies.push({ id: String(state.policies.length).padStart(8, '0'), emailHash: contactEmailHash('alice@fixture.invalid'), action: blocked ? 'CONTACT_EMAIL_BLOCKED' : 'CONTACT_EMAIL_UNBLOCKED', createdAt: new Date(time) }); }
  function prisma(mode) {
    return strict({ session: strict({
      findUnique: async ({ where, select }) => {
        audit.sessionReads++; assert.deepEqual(Object.keys(where), ['id']);
        const primary = { id: true, userId: true, revokedAt: true, lastSeenAt: true, remembered: true, user: { select: { email: true } } };
        const remembered = { createdAt: true, user: { select: { role: true } } };
        assert.ok(JSON.stringify(select) === JSON.stringify(primary) || JSON.stringify(select) === JSON.stringify(remembered), 'exact existing session query');
        if (state.failSession) throw Error('FIXTURE_SESSION_UNAVAILABLE');
        const row = state.sessions.get(where.id); if (!row) return null;
        const user = state.users.get(row.userId);
        const result = Object.fromEntries(Object.keys(select).map(k => [k, k === 'user' ? selectRow(user, select.user.select) : row[k]]));
        if (state.orphanDelete) state.users.delete(row.userId);
        return result;
      },
      update: async ({ where, data, select }) => {
        audit.sessionTouches++; assert.deepEqual(select, { id: true }); assert.deepEqual(Object.keys(data), ['lastSeenAt']); assert.ok(data.lastSeenAt instanceof Date);
        const row = state.sessions.get(where.id); assert.ok(row); row.lastSeenAt = data.lastSeenAt; return { id: row.id };
      },
    }), user: strict({ findUnique: async ({ where, select }) => {
      assert.deepEqual(Object.keys(where), ['id']); if (state.failUser) throw Error('FIXTURE_USER_UNAVAILABLE');
      const row = state.users.get(where.id);
      const observed = row && new Proxy(row, { get(target, key, receiver) { if (key === 'avatarUrl') audit[mode === 'compact' ? 'compactAvatarReads' : 'profileAvatarReads']++; return Reflect.get(target, key, receiver); } });
      if (select) { audit.selectedUserReads++; assert.ok(JSON.stringify(select) === '{"id":true,"email":true}' || (mode === 'compact' && JSON.stringify(select) === '{"id":true}'), 'exact user projection'); return selectRow(observed, select); }
      assert.equal(mode, 'profile', 'compact must never read profile columns'); audit.fullUserReads++;
      if (!row) return null;
      return { ...observed };
    } }), auditLog: strict({ findFirst: async ({ where, orderBy, select }) => {
      audit.policyReads++; if (state.failPolicy) throw Error('FIXTURE_POLICY_UNAVAILABLE');
      assert.deepEqual(where.metadata.path, ['emailHash']); assert.deepEqual(orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
      const actions = typeof where.action === 'string' ? [where.action] : where.action.in;
      assert.ok(actions.every(x => ['CONTACT_EMAIL_BLOCKED', 'CONTACT_EMAIL_UNBLOCKED'].includes(x)));
      assert.ok(JSON.stringify(select) === '{"action":true}' || JSON.stringify(select) === '{"createdAt":true}');
      const event = state.policies.filter(x => x.emailHash === where.metadata.equals && actions.includes(x.action)).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0];
      return selectRow(event, select);
    } }) });
  }
  try {
    for (const mode of ['profile', 'compact']) {
      const app = express(), db = prisma(mode); app.disable('x-powered-by');
      app.use((req, res, next) => { assert.equal(req.method, 'GET'); if (req.url !== '/api/v1/me') return res.status(403).json({ error: 'FIXTURE_ROUTE_DENIED' }); audit.requests++; res.setHeader('Cache-Control', 'no-store'); next(); });
      if (mode === 'profile') app.use('/api/v1', accountRouter(db));
      else app.get('/api/v1/me', requireAuth(db), asyncRoute(async (req, res) => {
        // This handler exists ONLY in this test process. It deliberately keeps
        // the post-middleware existence read of the real /me route.
        const user = await db.user.findUnique({ where: { id: req.userId }, select: { id: true } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        assert.ok(user.id === req.userId && /^[A-Za-z0-9_.:@-]{1,128}$/.test(user.id));
        const body = JSON.stringify({ id: user.id }); assert.ok(Buffer.byteLength(body) <= 137);
        return res.type('json').send(body);
      }));
      app.use((_error, _req, res, _next) => res.status(503).json({ error: 'FIXTURE_AUTH_UNAVAILABLE' }));
      const server = app.listen(0, '127.0.0.1'); servers.push(server);
      await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      allowed.add(server.address().port); const endpoint = `http://127.0.0.1:${server.address().port}/api/v1/me`; endpoints.set(mode, endpoint);
      resolvers.set(mode, identityResolver({ endpoint, issuer: 'compact-principal-counterfactual-fixture' }));
    }
    const sign = (extra = {}, secret = SECRET) => jwt.sign({ sub: 'alice', sid: 'alice', ...extra }, secret, { expiresIn: '10m' });
    async function observe(name, setup = () => {}, token = sign(), expected = 200, subject = 'alice') {
      const expectedPrincipal = { issuer: 'compact-principal-counterfactual-fixture', subject };
      const result = { name, expected, expectedPrincipal: expected === 200 ? expectedPrincipal : null, modes: {} };
      for (const mode of ['profile', 'compact']) {
        reset(); setup();
        const forged = { 'x-user-id': subject === 'alice' ? 'bob' : 'alice', 'x-role': 'ADMIN' };
        const headers = { Authorization: 'Bearer ' + token, ...forged };
        const response = await fetch(endpoints.get(mode), { headers, redirect: 'error', signal: AbortSignal.timeout(3000) });
        const text = await response.text(); assert.equal(response.status, expected, name + ':' + mode); assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = JSON.parse(text), bytes = Buffer.byteLength(text);
        if (expected === 200) { assert.equal(body.id, subject); if (mode === 'compact') { assert.deepEqual(body, { id: subject }); assert.ok(bytes <= 137); } }
        let principal = null, code = null;
        try { principal = await resolvers.get(mode)({ headers: { authorization: headers.Authorization, ...forged } }); } catch (error) { code = error.code; }
        if (expected === 200) assert.deepEqual(principal, expectedPrincipal);
        else assert.equal(code, expected === 503 ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED');
        result.modes[mode] = { status: response.status, bytes, principal, code };
      }
      rows.push(result);
    }
    await observe('valid-session');
    await observe('valid-bob-forged-owner-role-ignored', undefined, sign({ sub: 'bob', sid: 'bob' }), 200, 'bob');
    await observe('pending-2fa', undefined, sign({ purpose: 'pending_2fa' }), 401);
    await observe('subject-session-mismatch', undefined, sign({ sub: 'bob' }), 401);
    await observe('expired-jwt', undefined, jwt.sign({ sub: 'alice', sid: 'alice', exp: Math.floor(Date.now() / 1000) - 5 }, SECRET), 401);
    await observe('invalid-signature', undefined, sign({}, 'different-disposable-fixture-secret'), 401);
    await observe('revoked-session', () => { state.sessions.get('alice').revokedAt = new Date(); }, undefined, 401);
    await observe('missing-session', () => state.sessions.delete('alice'), undefined, 401);
    await observe('blocked-contact', () => policy(true), undefined, 403);
    await observe('deleted-user-orphan-session', () => state.users.delete('alice'), undefined, 404);
    await observe('deleted-between-middleware-and-handler', () => { state.orphanDelete = true; }, undefined, 404);
    await observe('session-backend-unavailable', () => { state.failSession = true; }, undefined, 503);
    await observe('policy-backend-unavailable', () => { state.failPolicy = true; }, undefined, 503);
    await observe('post-auth-user-unavailable', () => { state.failUser = true; }, undefined, 503);
    await observe('remembered-admin-valid', () => { state.sessions.get('alice').remembered = true; });
    await observe('remembered-admin-idle-expired', () => { const s = state.sessions.get('alice'); s.remembered = true; s.lastSeenAt = new Date(Date.now() - 31 * 86400000); }, undefined, 401);
    await observe('remembered-demoted-ordinary-expired', () => { state.users.get('alice').role = 'USER'; const s = state.sessions.get('alice'); s.remembered = true; s.createdAt = new Date(Date.now() - 13 * 3600000); }, undefined, 401);
    await observe('stale-session-touch', () => { state.sessions.get('alice').lastSeenAt = new Date(Date.now() - 6 * 60000); });
    const legacy = jwt.sign({ sub: 'alice', iat: Math.floor(Date.now() / 1000) - 60 }, SECRET, { expiresIn: '10m' });
    await observe('legacy-valid', undefined, legacy);
    await observe('legacy-deleted', () => state.users.delete('alice'), legacy, 401);
    await observe('legacy-blocked', () => policy(true), legacy, 403);
    await observe('legacy-revoked-after-unblock', () => { policy(true, Date.now() - 1000); policy(false); }, legacy, 401);
    // Valid PNG signature with512KiB decoded data, padded base64 whitespace up to
    // the actual upload string bound. Fixture profile only; never real data.
    const png = Buffer.alloc(512 * 1024); png.set([0x89, 0x50, 0x4e, 0x47]);
    const avatar = ('data:image/png;base64,' + png.toString('base64')).padEnd(1024 * 1024, ' ');
    await observe('maximum-avatar-valid', () => { state.users.get('alice').avatarUrl = avatar; });
    await observe('maximum-avatar-blocked', () => { state.users.get('alice').avatarUrl = avatar; policy(true); }, undefined, 403);
    for (const mode of ['profile', 'compact']) {
      reset(); const token = sign(), request = { headers: { authorization: 'Bearer ' + token } };
      await resolvers.get(mode)(request);
      const checks = [];
      for (const [name, mutate, undo] of [
        ['revoke', () => { state.sessions.get('alice').revokedAt = new Date(); }, () => { state.sessions.get('alice').revokedAt = null; }],
        ['block', () => policy(true), () => policy(false, Date.now() + 1)],
        ['delete', () => state.users.delete('alice'), () => {}],
      ]) {
        mutate(); const before = audit.sessionReads;
        await assert.rejects(resolvers.get(mode)(request), error => error.code === 'AUTH_REQUIRED');
        assert.ok(audit.sessionReads > before, 'every request rechecks session; no cache'); checks.push(name); undo();
      }
      rows.push({ name: 'immediate-authorization-changes-' + mode, checks });
    }
    const large = rows.find(x => x.name === 'maximum-avatar-valid'); assert.ok(large.modes.profile.bytes > 1024 * 1024); assert.equal(large.modes.compact.bytes, 14);
    assert.equal(audit.unexpectedPrisma, 0); assert.equal(audit.deniedNetwork, 0); assert.equal(audit.compactAvatarReads, 0);
    assert.deepEqual(verifyBuild(proofFile), provenance, 'source/build closure unchanged during fixture');
    const report = { fixtureOnly: true, counterfactualProjection: true, productionEndpointExists: false, productionReady: false, capacityTest: false,
      note: 'No runtime endpoint, resolver, caching or production auth code changed. Projected handler exists only in this local test process. All identities, secrets and profile bytes are disposable fixtures.',
      runtime: { node: process.version, platform: process.platform }, provenance, cases: rows, audit, pass: true };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { pass: true, cases: rows.length, largeProfileBytes: large.modes.profile.bytes, compactBytes: large.modes.compact.bytes, externalApiCalls: 0 };
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    globalThis.fetch = nativeFetch; net.Socket.prototype.connect = nativeConnect;
  }
}
function main(output, proofFile) {
  assert.ok(path.isAbsolute(output) && path.isAbsolute(proofFile), 'absolute output/proof paths required');
  const provenance = verifyBuild(proofFile);
  fs.mkdirSync(output, { mode: 0o700 }); // exclusive final directory, never reuse
  const env = { STOCKS_PRINCIPAL_PROJECTION_FIXTURE: 'true', JWT_SECRET: SECRET, TEMP: output, TMP: output, HOME: output, USERPROFILE: output };
  if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot || 'C:\\Windows';
  const r = spawnSync(process.execPath, [__filename, '--child', output, proofFile], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  fs.writeFileSync(path.join(output, 'child.log'), (r.stdout || '') + (r.stderr || '') + (r.error ? '\nCHILD_PROCESS_ERROR:' + r.error.code : ''), { flag: 'wx', mode: 0o600 });
  assert.equal(r.error, undefined); assert.equal(r.status, 0, 'compact principal fixture must succeed');
  const report = JSON.parse(boundedFile(path.join(output, 'report.json'))); assert.equal(report.pass, true); assert.deepEqual(report.provenance, provenance);
  return report;
}
if (require.main === module) {
  if (process.argv[2] === '--child') child(process.argv[4], process.argv[3]).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
  else {
    assert.equal(process.argv.length, 6); assert.equal(process.argv[2], '--output'); assert.equal(process.argv[4], '--build-proof');
    const r = main(process.argv[3], process.argv[5]); console.log(JSON.stringify({ pass: r.pass, cases: r.cases.length, output: process.argv[3], counterfactualOnly: true }));
  }
}
module.exports = { verifyBuild, main };
