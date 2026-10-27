process.env.JWT_SECRET = 'isolated-stocks-process-jwt-secret-not-production';
import net from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { startStocksAuthority } from '../stocksAuthority';
import { contactEmailHash } from '../services/ContactEmailPolicy';

// The dedicated Stocks authority process: the unchanged router behind the unchanged private ingress, with no
// public listener. Mocked rows only; the PostgreSQL path is covered by services/stocks-global/*.pg.test.cjs.
const key = 'fabricated-process-capability-'.repeat(2), issuer = 'isolated-stocks-process';
const principals = ['alice-fixture', 'bob-fixture'].map(subject => ({ issuer, subject }));
const STOCKS = ['STOCKS_AUTHORITY_INTERNAL_PORT', 'STOCKS_AUTHORITY_REQUESTS_PER_MINUTE', 'STOCKS_TEST_CASH_GATEWAY_KEY', 'STOCKS_TEST_CASH_ENABLED',
  'STOCKS_CATALOGUE_ENABLED', 'STOCKS_ORDER_EXECUTION_ENABLED', 'STOCKS_IDENTITY_ISSUER', 'STOCKS_TRADE_PRINCIPALS', 'PORT'];
const saved = Object.fromEntries(STOCKS.map(k => [k, process.env[k]]));
const services: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(s => s.close()));
  for (const k of STOCKS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});
const freePort = () => new Promise<number>(resolve => {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as net.AddressInfo; probe.close(() => resolve(port)); });
});
function rows() {
  const revoked = new Set<string>(), sessionReads: string[] = [];
  const prisma: any = {
    session: {
      findUnique: jest.fn(async ({ where }: any) => {
        sessionReads.push(where.id);
        return { id: where.id, userId: where.id.replace('session-', ''), revokedAt: revoked.has(where.id) ? new Date() : null,
          lastSeenAt: new Date(), remembered: false, user: { email: 'fixture@example.invalid' } };
      }), update: jest.fn(),
    }, auditLog: { findFirst: jest.fn(async () => null) },
    $queryRaw: jest.fn(async (_sql: unknown, ...values: any[]) => {
      const s = await prisma.session.findUnique({ where: { id: values[values.length - 1] } });
      return [{ ...s, createdAt: null, email: s.user.email, role: null, emailHash: contactEmailHash(s.user.email), contactAction: null }];
    }),
  };
  const authority = { execute: jest.fn(async (actor: any, type: string) => ({ type, subject: actor.subject })), metrics: () => ({}) };
  return { prisma, authority, revoked, sessionReads };
}
async function configure(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    STOCKS_AUTHORITY_INTERNAL_PORT: String(await freePort()), STOCKS_TEST_CASH_GATEWAY_KEY: key, STOCKS_TEST_CASH_ENABLED: 'true',
    STOCKS_ORDER_EXECUTION_ENABLED: 'true', STOCKS_IDENTITY_ISSUER: issuer, STOCKS_TRADE_PRINCIPALS: JSON.stringify(principals),
    STOCKS_AUTHORITY_REQUESTS_PER_MINUTE: '120', ...extra,
  });
}
const token = (subject = principals[0].subject) => jwt.sign({ sub: subject, sid: 'session-' + subject }, process.env.JWT_SECRET!, { expiresIn: '1h' });

test('a Stocks authority process never starts without its private loopback listener or with relaxed limits', async () => {
  const cases: [Record<string, string>, string[], string][] = [
    [{}, ['STOCKS_AUTHORITY_INTERNAL_PORT', 'STOCKS_AUTHORITY_REQUESTS_PER_MINUTE'], 'STOCKS_AUTHORITY_PROCESS_CONFIG_INVALID'],
    [{ STOCKS_AUTHORITY_REQUESTS_PER_MINUTE: '999' }, [], 'STOCKS_INGRESS_CONFIG_INVALID'],
    [{ STOCKS_TEST_CASH_ENABLED: 'false' }, [], 'STOCKS_INGRESS_CONFIG_INVALID'],
    [{}, ['STOCKS_TEST_CASH_GATEWAY_KEY'], 'STOCKS_INGRESS_CONFIG_INVALID'],
  ];
  for (const [extra, unset, code] of cases) {
    await configure(extra);
    for (const k of unset) delete process.env[k];
    const r = rows();
    await expect(startStocksAuthority({ prisma: r.prisma, authority: r.authority })).rejects.toThrow(code);
    expect(r.sessionReads).toHaveLength(0);
  }
});

test('serves only the private authority surface with the unchanged session, capability and quota checks', async () => {
  await configure();
  const r = rows(), service = await startStocksAuthority({ prisma: r.prisma, authority: r.authority }); services.push(service);
  const origin = `http://127.0.0.1:${service.port}`;
  const call = async (path: string, opts: { key?: string; subject?: string; method?: string; body?: unknown } = {}) => {
    const response = await fetch(origin + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { authorization: 'Bearer ' + token(opts.subject), 'x-stocks-authority-key': opts.key ?? key, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  const identity = await call('/api/v1/stocks-test-cash/identity');
  expect(identity).toMatchObject({ status: 200, body: { issuer, subject: 'alice-fixture' } });
  expect(identity.headers.get('x-powered-by')).toBeNull();
  expect((await call('/api/v1/stocks-test-cash/command', { body: { type: 'readView' } })).status).toBe(200);
  expect(r.authority.execute).toHaveBeenCalledTimes(1);
  // Capability, path and method are judged before any session read; wallet is not a service endpoint here.
  const reads = r.sessionReads.length;
  for (const [path, opts] of [['/api/v1/stocks-test-cash/identity', { key: 'forged' }], ['/api/v1/stocks-test-cash/wallet', {}],
    ['/api/v1/stocks-test-cash/identity', { method: 'POST' }], ['/api/v1/demo/orders', {}], ['/health', {}]] as const)
    expect((await call(path, opts)).status).toBe(403);
  expect(r.sessionReads).toHaveLength(reads);
  // Revocation is read live on every request, never cached by the process.
  r.revoked.add('session-alice-fixture');
  expect((await call('/api/v1/stocks-test-cash/identity')).status).toBe(401);
  expect((await call('/api/v1/stocks-test-cash/command', { body: { type: 'readView' } })).status).toBe(401);
  expect(r.authority.execute).toHaveBeenCalledTimes(1);
  // The configured service quota (120 here) still ends in AUTH_RATE_LIMIT.
  let last = 0;
  for (let i = 0; i < 120 && last !== 429; i++) last = (await call('/api/v1/stocks-test-cash/identity', { subject: 'bob-fixture' })).status;
  expect(last).toBe(429);
}, 20000);

test('the process has no public listener: its port is loopback-only and closes cleanly', async () => {
  await configure();
  const r = rows(), service = await startStocksAuthority({ prisma: r.prisma, authority: r.authority });
  const port = service.port;
  await service.close();
  const app = express(), reuse = await new Promise<boolean>(resolve => {
    const server = app.listen(port, '127.0.0.1', () => server.close(() => resolve(true))); server.once('error', () => resolve(false));
  });
  expect(reuse).toBe(true);
});
