// Disposable local QA child only. No production entrypoint, database or broker.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const FIXTURE_SECRET = 'stocks-local-stage-disposable-jwt-secret-only';
const ID = 'BYBIT:AAPLXUSDT';
const ISSUER = 'stocks-local-stage-fixture-only';
const PREFIX = '/__stocks_global/';
const sha = value => createHash('sha256').update(value).digest('hex');

async function start(config) {
  assert.equal(process.env.STOCKS_LOCAL_STAGE_FIXTURE, 'true');
  assert.equal(process.env.JWT_SECRET, FIXTURE_SECRET);
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(process.env.NODE_OPTIONS, undefined);
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.fixtureOnly, true);
  for (const file of manifest.files) {
    const target = path.resolve(root, file.path);
    assert.ok(target.startsWith(root + path.sep));
    assert.equal(sha(fs.readFileSync(target)), file.sha256, file.path);
  }
  const dataRoot = path.resolve(config.dataRoot);
  assert.equal(path.dirname(dataRoot), path.dirname(root));
  assert.ok(!fs.existsSync(path.join(dataRoot, 'primary.sqlite')), 'new fixture DB only');
  fs.mkdirSync(dataRoot, { recursive: false, mode: 0o700 });
  const audit = { fixtureOnly: true, productionAccess: false, runtime: { node: process.version, platform: process.platform, arch: process.arch }, identityRequests: 0,
    prisma: { sessionReads: 0, sessionTouches: 0, userReads: 0, policyReads: 0, unexpected: 0 },
    forwarded: 0, blockedRoutes: 0, deniedNetwork: 0, quotes: 0, histories: 0, droppedAcknowledgements: 0 };
  const ports = new Set();
  const nativeConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const a = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof a[0] === 'object' ? a[0] : { port: a[0], host: a[1] };
    if (options.path || (options.host || options.hostname) !== '127.0.0.1' || !ports.has(Number(options.port))) {
      audit.deniedNetwork++; throw Error('FIXTURE_NETWORK_DENIED');
    }
    return Reflect.apply(nativeConnect, this, args);
  };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !ports.has(Number(url.port))) {
      audit.deniedNetwork++; return Promise.reject(Error('FIXTURE_NETWORK_DENIED'));
    }
    return nativeFetch(input, options);
  };
  // These are existing build outputs. No API bootstrap or PrismaClient is loaded.
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const { accountRouter } = require('../dist/api/routes/account.js');
  const { contactEmailHash } = require('../dist/services/ContactEmailPolicy.js');
  const users = new Map(['alice', 'bob'].map(id => [id, { id, email: id + '@fixture.invalid',
    role: id === 'alice' ? 'ADMIN' : 'USER', isAdmin: id === 'alice', displayName: id,
    phone: null, country: null, avatarUrl: null, kycStatus: 'NONE', twoFactorEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00Z') }]));
  const sessions = new Map(['alice', 'bob'].map(id => [id, { id, userId: id, revokedAt: null,
    lastSeenAt: new Date(), createdAt: new Date(), remembered: false }]));
  const policies = [];
  const unknown = () => { audit.prisma.unexpected++; throw Error('FIXTURE_PRISMA_OPERATION_DENIED'); };
  const strict = methods => new Proxy(methods, { get: (target, name) => typeof name === 'symbol' ? target[name] : name in target ? target[name] : unknown });
  const prisma = strict({
    session: strict({
      findUnique: async ({ where, select }) => {
        audit.prisma.sessionReads++;
        assert.deepEqual(Object.keys(where), ['id']);
        assert.ok(select && Object.keys(select).every(k => ['id', 'userId', 'revokedAt', 'lastSeenAt', 'remembered', 'user', 'createdAt'].includes(k)));
        const row = sessions.get(where.id); if (!row) return null;
        const user = users.get(row.userId);
        return { ...row, user: user ? { email: user.email, role: user.role } : null };
      },
      update: async ({ where, data, select }) => {
        audit.prisma.sessionTouches++; assert.deepEqual(select, { id: true });
        assert.deepEqual(Object.keys(data), ['lastSeenAt']); assert.ok(data.lastSeenAt instanceof Date);
        const row = sessions.get(where.id); assert.ok(row); row.lastSeenAt = data.lastSeenAt;
        return { id: row.id };
      },
    }),
    user: strict({ findUnique: async ({ where, select }) => {
      audit.prisma.userReads++; assert.deepEqual(Object.keys(where), ['id']);
      if (select) assert.deepEqual(select, { id: true, email: true });
      return users.get(where.id) || null;
    } }),
    auditLog: strict({ findFirst: async ({ where, orderBy, select }) => {
      audit.prisma.policyReads++;
      assert.deepEqual(where.metadata.path, ['emailHash']);
      assert.deepEqual(orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
      assert.ok(JSON.stringify(select) === '{"action":true}' || JSON.stringify(select) === '{"createdAt":true}');
      const actions = typeof where.action === 'string' ? [where.action] : where.action.in;
      assert.ok(actions.every(x => ['CONTACT_EMAIL_BLOCKED', 'CONTACT_EMAIL_UNBLOCKED'].includes(x)));
      return policies.filter(x => x.emailHash === where.metadata.equals && actions.includes(x.action))
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] || null;
    } }),
  });
  const authorityApp = express();
  authorityApp.disable('x-powered-by');
  authorityApp.use((req, res, next) => {
    if (req.method !== 'GET' || req.url !== '/api/v1/me') { audit.blockedRoutes++; return res.status(403).json({ error: 'FIXTURE_ROUTE_DENIED' }); }
    audit.identityRequests++; res.setHeader('Cache-Control', 'no-store'); next();
  });
  authorityApp.use('/api/v1', accountRouter(prisma));
  authorityApp.use((_error, _req, res, _next) => res.status(503).json({ error: 'FIXTURE_AUTH_UNAVAILABLE' }));
  const authority = authorityApp.listen(0, '127.0.0.1'); await once(authority, 'listening');
  ports.add(authority.address().port);
  const authorityOrigin = 'http://127.0.0.1:' + authority.address().port;
  const { identityResolver } = await import(pathToFileURL(path.join(root, 'services/stocks-global/identity.mjs')));
  const { createLocalStocksProxy } = await import(pathToFileURL(path.join(root, 'services/stocks-global/local-proxy.mjs')));
  const { createServer } = await import(pathToFileURL(path.join(root, 'services/stocks-global/server.mjs')));
  const { CATALOG } = await import(pathToFileURL(path.join(root, 'services/stocks-global/catalog.mjs')));
  const aapl = CATALOG.find(x => x.id === ID); assert.ok(aapl);
  let sequence = 0, price = '100', stocks, enabled = true, dropNext = false;
  let currentPath = path.join(dataRoot, 'primary.sqlite');
  const hub = { metrics: {}, catalogue: async () => [{ ...aapl, online: true, exists: true }],
    quote: async symbol => {
      assert.equal(symbol, ID); audit.quotes++; const now = Date.now();
      return { instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT', bid: price, ask: price, last: price,
        verified: true, marketOpen: true, eventId: 'local-fixture-' + (++sequence), timestamp: now, receivedAt: now,
        capacity: '1.00000000', prices: { USDT: { buy: price, sell: price } }, fx: {} };
    },
    history: async (symbol, interval) => {
      assert.equal(symbol, ID); audit.histories++; const now = Date.now();
      return { instrumentId: ID, interval, provider: 'bybit', currency: 'USDT', receivedAt: now, delaySeconds: 0,
        candles: [{ time: Math.floor(now / 900000) * 900 - 900, open: 100, high: 101, low: 99, close: 100, volume: 1 }] };
    },
  };
  const authenticate = identityResolver({ endpoint: authorityOrigin + '/api/v1/me', issuer: ISSUER });
  const boot = async () => {
    stocks = await createServer({ port: 0, accountsPath: currentPath, ownerOnlyMode: true, tradeOwnerSubject: 'alice',
      autoPoll: false, authenticate, hub, accountDiagnostics: true, dist: path.join(root, 'no-static-files') });
    if (process.platform !== 'win32') fs.chmodSync(currentPath, 0o600);
    ports.add(stocks.port);
  };
  await boot();
  let gatewayOrigin;
  const proxy = createLocalStocksProxy({ origin: () => gatewayOrigin, stocksOrigin: () => enabled && stocks ? 'http://127.0.0.1:' + stocks.port : null });
  const gateway = http.createServer((req, res) => {
    if (!req.url.startsWith(PREFIX)) { audit.blockedRoutes++; res.writeHead(403); res.end('{"error":"FIXTURE_ROUTE_DENIED"}'); return; }
    if (enabled && stocks) audit.forwarded++;
    if (dropNext && enabled && req.method === 'POST' && req.url === PREFIX + 'orders') {
      dropNext = false;
      let status = 0, bytes = 0, chunks = [];
      res.writeHead = code => { status = code; return res; };
      res.write = (chunk, encoding, callback) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined);
        bytes += data.length; assert.ok(bytes <= 1024 * 1024); chunks.push(data);
        if (typeof encoding === 'function') encoding(); else callback?.(); return true;
      };
      res.end = chunk => {
        if (chunk) res.write(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(status, 200); assert.ok(body.result?.id);
        audit.droppedAcknowledgements++; audit.droppedOrderId = body.result.id;
        res.destroy(); return res;
      };
    }
    proxy(req, res);
  });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening'); ports.add(gateway.address().port);
  gatewayOrigin = 'http://127.0.0.1:' + gateway.address().port;
  const sign = (id, extra = {}) => jwt.sign({ sub: id, sid: id, ...extra }, FIXTURE_SECRET, { expiresIn: '10m' });
  const tokens = { alice: sign('alice'), bob: sign('bob'), pending: sign('alice', { purpose: 'pending_2fa' }), mismatch: sign('bob', { sid: 'alice' }) };
  async function stopStocks() { if (stocks) { const previous = stocks; stocks = null; await previous.close(); ports.delete(previous.port); } }
  return { ready: { gatewayOrigin, authorityOrigin, tokens, path: currentPath, issuer: ISSUER }, async command(name, input = {}) {
    switch (name) {
      case 'audit': return structuredClone(audit);
      case 'price': assert.match(input.value, /^\d+(\.\d+)?$/); price = input.value; return true;
      case 'dropAck': dropNext = true; return true;
      case 'enabled': enabled = input.value === true; return true;
      case 'session': {
        const row = sessions.get(input.id); assert.ok(row);
        if ('revoked' in input) row.revokedAt = input.revoked ? new Date() : null;
        if ('staleTouch' in input) row.lastSeenAt = new Date(Date.now() - (input.staleTouch ? 360000 : 0));
        if ('expired' in input) { row.remembered = input.expired; row.lastSeenAt = new Date(Date.now() - (input.expired ? 31 * 86400000 : 0)); }
        return true;
      }
      case 'userDeleted': {
        assert.equal(input.id, 'bob'); const user = users.get('bob');
        if (input.value) { assert.ok(user); this.savedBob = user; users.delete('bob'); } else { assert.ok(this.savedBob); users.set('bob', this.savedBob); }
        return true;
      }
      case 'avatar': users.get('alice').avatarUrl = input.value ? 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(512 * 1024 - 8)]).toString('base64') : null; return true;
      case 'policy': policies.push({ id: String(policies.length).padStart(8, '0'), emailHash: contactEmailHash(input.id + '@fixture.invalid'), action: input.blocked ? 'CONTACT_EMAIL_BLOCKED' : 'CONTACT_EMAIL_UNBLOCKED', createdAt: new Date() }); return true;
      case 'networkProbe': try { await fetch('https://example.invalid/'); throw Error('unreachable'); } catch (e) { assert.equal(e.message, 'FIXTURE_NETWORK_DENIED'); return true; }
      case 'quiesce': {
        enabled = false; const accountMetrics = stocks?.accountMetrics(); await stopStocks();
        return { path: currentPath, closed: true, accountMetrics };
      }
      case 'restart': await stopStocks(); await boot(); enabled = true; return true;
      case 'restore': {
        assert.equal(stocks, null); const restored = path.resolve(input.path);
        assert.equal(path.dirname(restored), dataRoot); assert.notEqual(restored, currentPath);
        assert.equal(path.basename(restored), 'restored.sqlite'); assert.ok(fs.statSync(restored).isFile());
        currentPath = restored; await boot(); enabled = true; return true;
      }
      case 'stop': enabled = false; await stopStocks(); gateway.closeAllConnections(); authority.closeAllConnections();
        await Promise.all([new Promise(resolve => gateway.close(resolve)), new Promise(resolve => authority.close(resolve))]); return structuredClone(audit);
      default: throw Error('FIXTURE_COMMAND_DENIED');
    }
  } };
}

if (require.main === module) {
  assert.ok(process.send, 'IPC fixture child only');
  let fixture, chain = Promise.resolve();
  process.on('message', message => {
    chain = chain.then(async () => {
      try {
        if (message.command === 'init') { assert.equal(fixture, undefined); fixture = await start(message.input); process.send({ id: message.id, result: fixture.ready }); }
        else { assert.ok(fixture); const result = await fixture.command(message.command, message.input); process.send({ id: message.id, result }); if (message.command === 'stop') process.disconnect(); }
      } catch (error) { process.send({ id: message.id, error: { name: error.name, message: error.message, stack: error.stack } }); }
    });
  });
}
module.exports = { FIXTURE_SECRET, ID, ISSUER };
