process.env.JWT_SECRET = 'isolated-ingress-jwt-secret-not-production';
import express from 'express';
import { Server, request as httpRequest } from 'http';
import jwt from 'jsonwebtoken';
import { createStocksAuthorityIngress, stocksAuthorityIngressConfig } from '../stocksAuthorityIngress';
import { stocksTestCashRouter } from '../../routes/stocksTestCash';
import { contactEmailHash } from '../../../services/ContactEmailPolicy';

const key = 'fabricated-gateway-capability-'.repeat(2), issuer = 'isolated-ingress';
const principals = ['alice-fixture', 'bob-fixture'].map(subject => ({ issuer, subject }));
const identity = '/api/v1/stocks-test-cash/identity', command = '/api/v1/stocks-test-cash/command';
const identities = '/api/v1/stocks-test-cash/identities';
const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve()); server.closeAllConnections();
  })));
});
async function fixture(options: { enabled?: boolean; finance?: boolean; cap?: number } = {}) {
  const revoked = new Set<string>(), sessionReads: string[] = [];
  const prisma: any = {
    user: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id })) },
    session: {
      findUnique: jest.fn(async ({ where }: any) => {
        sessionReads.push(where.id);
        return { id: where.id, userId: where.id.replace('session-', ''), revokedAt: revoked.has(where.id) ? new Date() : null,
          lastSeenAt: new Date(), remembered: false, user: { email: 'fixture@example.invalid' } };
      }), update: jest.fn(),
    }, auditLog: { findFirst: jest.fn(async () => null) },
    // requireAuth singleSessionRead: the one-query session read, from the rows above.
    $queryRaw: jest.fn(async (_sql: unknown, ...values: any[]) => {
      const s = await prisma.session.findUnique({ where: { id: values[values.length - 1] } }); if (!s) return [];
      const event = await prisma.auditLog.findFirst({});
      return [{ ...s, createdAt: null, email: s.user.email, role: null, emailHash: contactEmailHash(s.user.email), contactAction: event?.action ?? null }];
    }),
  };
  const authority = { execute: jest.fn(async (actor: any) => ({
    fixtureOnly: true, subject: actor.subject,
    wallets: { USDT: { cash: '100.00000000', reserved: '0.00000000', available: '100.00000000' } },
  })), metrics: () => ({}) };
  const ingress = createStocksAuthorityIngress(options.enabled === false ? {} :
    { port: 0, gatewayKey: key, requestsPerMinute: options.cap ?? 240 });
  const app = express(); app.set('trust proxy', 1); app.use(express.json()); app.use(ingress.middleware);
  app.get('/public-probe', (_req, res) => res.json({ ok: true }));
  app.use('/api/v1', stocksTestCashRouter(prisma, {
    catalogueEnabled: true, enabled: options.finance !== false, orderExecutionEnabled: true, issuer, gatewayKey: key,
    principals, secret: process.env.JWT_SECRET,
  }, authority));
  const privateServer = await ingress.listen(app);
  if (privateServer) open.push(privateServer);
  const publicServer = await new Promise<Server>(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  }); open.push(publicServer);
  const url = (server: Server) => `http://127.0.0.1:${(server.address() as any).port}`;
  const token = (subject = principals[0].subject) => jwt.sign({ sub: subject, sid: 'session-' + subject },
    process.env.JWT_SECRET!, { expiresIn: '1h' });
  const call = async (path: string, opts: { public?: boolean; headers?: Record<string, string>; method?: string; body?: unknown; subject?: string } = {}) => {
    const response = await fetch(url(opts.public || !privateServer ? publicServer : privateServer) + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { authorization: 'Bearer ' + token(opts.subject), 'x-stocks-authority-key': key,
        ...(opts.body ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: response.status, headers: response.headers, text: await response.text() };
  };
  return { ingress, call, authority, revoked, sessionReads, token,
    privateUrl: privateServer ? url(privateServer) : undefined, privateAddress: privateServer?.address() };
}

test('two traders share one private IP: 240 live validations pass, 241 is denied; public still 120', async () => {
  const f = await fixture();
  let lastLimit: string | null = null;
  for (let i = 0; i < 240; i++) {
    const r = await f.call(identity, { subject: principals[i % 2].subject });
    expect({ validation: i + 1, status: r.status }).toEqual({ validation: i + 1, status: 200 });
    lastLimit = r.headers.get('ratelimit-limit');
  }
  expect(lastLimit).toBe('240');
  expect(f.sessionReads.filter(id => id === 'session-alice-fixture')).toHaveLength(120);
  expect(f.sessionReads.filter(id => id === 'session-bob-fixture')).toHaveLength(120);
  const denied = await f.call(identity);
  expect(denied.status).toBe(429); expect(denied.headers.get('ratelimit-remaining')).toBe('0');
  expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(f.sessionReads).toHaveLength(240); expect(f.authority.execute).not.toHaveBeenCalled();
  for (let i = 0; i < 120; i++) expect((await f.call('/public-probe', { public: true })).status).toBe(200);
  expect((await f.call('/public-probe', { public: true })).status).toBe(429);
}, 15000);

test('listener is loopback-only; duplicate capabilities and a forged Host cannot pass admission', async () => {
  const f = await fixture(), url = new URL(f.privateUrl!);
  expect((f.privateAddress as any).address).toBe('127.0.0.1');
  const raw = (headers: string[]) => new Promise<number>(resolve => {
    const req = httpRequest(url.origin + identity, { headers }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode!));
    }); req.end();
  });
  expect(await raw(['Host', url.host, 'Authorization', 'Bearer ' + f.token(),
    'X-Stocks-Authority-Key', key, 'x-stocks-authority-key', key])).toBe(403);
  expect(await raw(['Host', 'forged.invalid', 'Authorization', 'Bearer ' + f.token(),
    'X-Stocks-Authority-Key', key])).toBe(403);
  expect(f.sessionReads).toHaveLength(0);
  expect((await f.call(identity)).status).toBe(200);
});

test('public listener cannot claim private quota even with the correct key and spoofed proxy headers', async () => {
  const f = await fixture();
  for (const path of [identity, command, identities, '/api/v1/stocks-test-cash/readiness']) {
    expect((await f.call(path, { public: true, method: path === command || path === identities ? 'POST' : 'GET',
      headers: { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': '127.0.0.1', 'forwarded': 'for=127.0.0.1' } })).status).toBe(403);
  }
  expect(f.sessionReads).toHaveLength(0); expect(f.authority.execute).not.toHaveBeenCalled();
  // Existing user wallet projection is not a service authority endpoint.
  expect((await f.call('/api/v1/stocks-test-cash/wallet', { public: true })).status).toBe(200);
  expect(f.authority.execute).toHaveBeenCalledTimes(1);
  for (const path of ['/api/v1/stocks-test-cash/IDENTITY/', identity + '?spoof=1'])
    expect((await f.call(path, { public: true })).status).toBe(403);
  expect((await f.call('/api/v1/stocks-test-cash/Identities/', { public: true, body: { tokens: [f.token()] } })).status).toBe(403);
  const r = await f.call(identity); expect(r.status).toBe(200);
  expect(r.headers.get('ratelimit-remaining')).toBe('239');
});

test('private listener rejects forged capabilities, proxy headers, wrong path and method; denial flood bounded', async () => {
  const f = await fixture();
  const cases: { headers?: Record<string, string>; method?: string }[] = [
    { headers: { 'x-stocks-authority-key': 'forged' } },
    { headers: { 'x-stocks-authority-key': '' } },
    { headers: { 'x-forwarded-for': '127.0.0.1' } },
    { headers: { forwarded: 'for=127.0.0.1' } },
    { headers: { 'cf-connecting-ip': '127.0.0.1' } },
    { headers: { 'x-forwarded-host': 'localhost' } },
    { method: 'POST' },
  ];
  for (const opts of cases) expect((await f.call(identity, opts)).status).toBe(403);
  // The batch path has its own exact method; a forged capability never reaches a session read.
  expect((await f.call(identities)).status).toBe(403);
  expect((await f.call(identities, { body: { tokens: [f.token()] }, headers: { 'x-stocks-authority-key': 'forged' } })).status).toBe(403);
  for (const path of [identity + '?spoof=1', '/api/v1/stocks-test-cash/%69dentity', '/public-probe'])
    expect((await f.call(path)).status).toBe(403);
  for (let i = 12; i < 120; i++) expect((await f.call(identity, { headers: { 'x-stocks-authority-key': 'forged' } })).status).toBe(403);
  expect((await f.call(identity, { headers: { 'x-stocks-authority-key': 'forged' } })).status).toBe(429);
  expect(f.sessionReads).toHaveLength(0);
  const valid = await f.call(identity); expect(valid.status).toBe(200);
  expect(valid.headers.get('ratelimit-remaining')).toBe('239');
}, 15000);

test('every financial request still verifies JWT and current session; revocation and finance-OFF deny', async () => {
  const f = await fixture();
  for (const p of principals) {
    expect((await f.call(command, { subject: p.subject, body: { type: 'readView' } })).status).toBe(200);
  }
  expect(f.sessionReads).toEqual(['session-alice-fixture', 'session-bob-fixture']);
  expect(f.authority.execute.mock.calls.map(c => c[0].subject)).toEqual(['alice-fixture', 'bob-fixture']);
  f.revoked.add('session-alice-fixture');
  expect((await f.call(command, { body: { type: 'submitObserved', input: {} } })).status).toBe(401);
  expect((await f.call(identity)).status).toBe(401);
  const before = f.sessionReads.length;
  expect((await f.call(command, { body: { type: 'submitObserved' }, headers: { authorization: 'Bearer forged.jwt.token' } })).status).toBe(401);
  expect(f.sessionReads).toHaveLength(before);
  expect(f.authority.execute).toHaveBeenCalledTimes(2);
  const off = await fixture({ finance: false });
  expect((await off.call(identity)).status).toBe(200);
  expect((await off.call(command, { body: { type: 'submitObserved' } })).status).toBe(403);
  expect(off.authority.execute).not.toHaveBeenCalled();
});

test('a saturated private quota cannot reach or replay a financial command', async () => {
  const f = await fixture({ cap: 120 });
  for (let i = 0; i < 120; i++) expect((await f.call(identity)).status).toBe(200);
  const input = { type: 'submitObserved', input: { idempotencyKey: 'same-fixture-intent' } };
  for (let i = 0; i < 2; i++) expect((await f.call(command, { body: input })).status).toBe(429);
  expect(f.authority.execute).not.toHaveBeenCalled(); expect(f.sessionReads).toHaveLength(120);
}, 15000);

test('default disabled preserves old public JWT path and finite120 budget without a private exemption', async () => {
  const f = await fixture({ enabled: false });
  expect((await f.call(identity, { headers: { authorization: 'Bearer invalid' } })).status).toBe(401);
  for (let i = 1; i < 120; i++) expect((await f.call(identity)).status).toBe(200);
  expect((await f.call(identity)).status).toBe(429);
  expect(f.sessionReads).toHaveLength(119);
});

test('opt-in configuration rejects unsafe ports/keys and unreviewed quotas', () => {
  expect(stocksAuthorityIngressConfig({})).toEqual({});
  const base = { STOCKS_AUTHORITY_INTERNAL_PORT: '3002', STOCKS_CATALOGUE_ENABLED: 'true', STOCKS_TEST_CASH_GATEWAY_KEY: key };
  expect(stocksAuthorityIngressConfig(base).requestsPerMinute).toBe(240);
  for (const port of ['', '0', '3000', '65536', '1e4', '0.0.0.0:3002'])
    expect(() => stocksAuthorityIngressConfig({ ...base, STOCKS_AUTHORITY_INTERNAL_PORT: port })).toThrow();
  for (const cap of [119, 241, Infinity, 120.5])
    expect(() => createStocksAuthorityIngress({ port: 3002, gatewayKey: key, requestsPerMinute: cap })).toThrow();
  expect(() => createStocksAuthorityIngress({ port: 3002, gatewayKey: 'short' })).toThrow();
});

test('one private request carries up to 64 live checks: the quota counts requests, every bearer reads its own session', async () => {
  const f = await fixture();
  const subjects = Array.from({ length: 64 }, (_, n) => n < 2 ? principals[n].subject : 'viewer-' + n);
  const batch = (list: string[]) => f.call(identities, { body: { tokens: list.map(subject => f.token(subject)) }, headers: { authorization: '' } });
  const first = await batch(subjects);
  expect(first.status).toBe(200);
  expect(JSON.parse(first.text).results).toEqual(subjects.map(subject => ({ issuer, subject })));
  expect(first.headers.get('ratelimit-remaining')).toBe('239');
  expect(f.sessionReads).toEqual(subjects.map(subject => 'session-' + subject));
  // A sign-out between two batches is seen by the next one; nothing is reused.
  f.revoked.add('session-alice-fixture');
  const second = await batch(subjects.slice(0, 3));
  expect(JSON.parse(second.text).results).toEqual([{ error: 'AUTH_REQUIRED' }, { issuer, subject: 'bob-fixture' }, { issuer, subject: 'viewer-2' }]);
  expect(f.sessionReads).toHaveLength(67);
  const tooMany = await batch(Array.from({ length: 65 }, (_, n) => 'viewer-' + n));
  expect(tooMany.status).toBe(422); expect(f.sessionReads).toHaveLength(67);
  expect(f.authority.execute).not.toHaveBeenCalled();
});
