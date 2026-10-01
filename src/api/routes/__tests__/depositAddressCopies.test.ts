process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { depositAddressCopiesRouter, isDepositCopyEventRequest } from '../depositAddressCopies';
import { BackgroundWorkCoordinator, type SleepingWatcher } from '../../../services/BackgroundWorkCoordinator';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const XRP = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const EVM = '0x52908400098527886e0f7030069857d2e4169ee7';

const auth = (userId: string) => `Bearer ${jwt.sign({ sub: userId, sid: `s:${userId}` }, process.env.JWT_SECRET!)}`;

/** A table with the (userId, eventId) unique index, and a tripwire on every
 * financial model: a copy note must never reach one. */
function fakeDb(roles: Record<string, string> = {}) {
  const rows = new Map<string, any>();
  const forbidden = () => { throw new Error('a copy note touched a financial table'); };
  const db: any = {
    rows,
    inserts: 0,
    session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.slice(2), revokedAt: null, lastSeenAt: new Date() })) },
    user: { findUnique: jest.fn(async ({ where }: any) => ({ role: roles[where.id] ?? 'USER' })) },
    deposit: new Proxy({}, { get: forbidden }),
    balance: new Proxy({}, { get: forbidden }),
    depositClaim: new Proxy({}, { get: forbidden }),
    $transaction: forbidden,
    // INSERT … ON CONFLICT DO NOTHING RETURNING: values in column order.
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
      if (!strings.join('?').includes('INSERT INTO "DepositAddressCopyEvent"')) return [];
      const [id, eventId, userId, asset, network, destinationId, addressSnapshot, memoSnapshot, source, clientCopiedAt] = values;
      const key = `${userId}|${eventId}`;
      if (rows.has(key)) return [];
      db.inserts++;
      const row = { id, eventId, userId, asset, network, destinationId, addressSnapshot, memoSnapshot, source, clientCopiedAt, receivedAt: new Date(Date.now() + db.inserts) };
      rows.set(key, row);
      return [{ id, receivedAt: row.receivedAt }];
    }),
    depositAddressCopyEvent: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(`${where.userId_eventId.userId}|${where.userId_eventId.eventId}`) ?? null),
    },
  };
  return db;
}

function app(db: any, coordinator?: BackgroundWorkCoordinator) {
  const a = express();
  a.use(express.json());
  if (coordinator) a.use(coordinator.middleware());
  a.use('/api/v1', depositAddressCopiesRouter(db));
  return a;
}

const event = (over: Record<string, unknown> = {}) => ({
  eventId: randomUUID(), asset: 'USDT', network: 'tron', destinationId: 'tether:tron', address: TRON, source: 'wallet', ...over,
});

describe('POST /deposit-address-copies', () => {
  it('needs a signed-in account; the author is the session, never the body', async () => {
    const db = fakeDb();
    expect((await request(app(db)).post('/api/v1/deposit-address-copies').send(event())).status).toBe(401);
    const forged = await request(app(db)).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send({ ...event(), userId: U2 });
    expect(forged.status).toBe(400);
    const ok = await request(app(db)).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(event());
    expect(ok.status).toBe(201);
    expect([...db.rows.values()].map((r) => r.userId)).toEqual([U1]);
  });

  it('stores exactly the copied address, network and rail', async () => {
    const db = fakeDb();
    const e = event({ asset: 'XRP', network: 'xrp', destinationId: 'ripple:xrp', address: XRP, memo: '4294967295', source: 'header' });
    expect((await request(app(db)).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(e)).status).toBe(201);
    expect([...db.rows.values()][0]).toMatchObject({ asset: 'XRP', network: 'xrp', destinationId: 'ripple:xrp', addressSnapshot: XRP, memoSnapshot: '4294967295', source: 'header' });
  });

  it('accepts the treasury dialog chains too (destination = chain)', async () => {
    const db = fakeDb();
    const e = event({ asset: 'USDT', network: 'bsc', destinationId: 'bsc', address: EVM });
    expect((await request(app(db)).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(e)).status).toBe(201);
  });

  it.each([
    ['an unknown rail', { asset: 'DOGE', network: 'tron' }],
    ['an address of another network', { address: EVM }],
    ['a rail that does not match', { destinationId: 'usd-coin:solana' }],
    ['a memo where the network has none', { memo: '123' }],
    ['a bad destination tag', { asset: 'XRP', network: 'xrp', destinationId: 'ripple:xrp', address: XRP, memo: '4294967296' }],
    ['markup in the address', { address: `${TRON}<script>` }],
    ['a source outside the list', { source: 'https://evil.example/x' }],
    ['an amount', { amount: '500' }],
    ['a TXID', { txHash: 'a'.repeat(64) }],
    ['a non-UUID event ID', { eventId: 'x' }],
  ])('refuses %s', async (_name, over) => {
    const db = fakeDb();
    const res = await request(app(db)).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(event(over));
    expect(res.status).toBe(400);
    expect(db.inserts).toBe(0);
  });

  it('a retried eventId inserts nothing and keeps the first server time; another payload is refused', async () => {
    const db = fakeDb();
    const a = app(db);
    const e = event();
    const first = await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(e);
    const again = await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(e);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, receivedAt: first.body.receivedAt, duplicate: true });
    const other = await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send({ ...e, address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8' });
    expect(other.status).toBe(409);
    expect(db.inserts).toBe(1);
    // The same eventId from another account is its own note.
    expect((await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U2)).send(e)).status).toBe(201);
    expect(db.inserts).toBe(2);
  });

  it('keeps a plausible device time and drops an implausible one', async () => {
    const db = fakeDb();
    const a = app(db);
    const near = new Date(Date.now() - 90_000).toISOString();
    await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(event({ clientCopiedAt: near }));
    await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(event({ clientCopiedAt: '2031-01-01T00:00:00.000Z' }));
    await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(event({ clientCopiedAt: '2020-01-01T00:00:00.000Z' }));
    expect([...db.rows.values()].map((r) => r.clientCopiedAt)).toEqual([near, null, null]);
  });

  it('has its own per-account limit', async () => {
    const db = fakeDb();
    const a = app(db);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(event())).status);
    expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
    expect(statuses[30]).toBe(429);
    // Another account is not affected.
    expect((await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U2)).send(event())).status).toBe(201);
  });

  it('does not wake the sleeping background loops; a refused note does not either', async () => {
    const loop = { name: 'deposit-watch', asleep: true, nudges: 0, nudge() { this.nudges++; } };
    const coordinator = new BackgroundWorkCoordinator([loop as SleepingWatcher], { activityCooldownMs: 0 });
    coordinator.start();
    const a = app(fakeDb(), coordinator);
    const e = event();
    await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(e);
    await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(e);
    await request(a).post('/api/v1/deposit-address-copies').set('Authorization', auth(U1)).send(event({ address: 'nope' }));
    expect(loop.nudges).toBe(0);
    expect(coordinator.stats.activityRechecks).toBe(0);
    coordinator.stop();
  });
});

describe('GET /admin/deposit-address-copies', () => {
  it('is for admins only', async () => {
    const db = fakeDb({ [U2]: 'ADMIN' });
    expect((await request(app(db)).get('/api/v1/admin/deposit-address-copies')).status).toBe(401);
    expect((await request(app(db)).get('/api/v1/admin/deposit-address-copies').set('Authorization', auth(U1))).status).toBe(403);
    expect((await request(app(db)).get('/api/v1/admin/deposit-address-copies').set('Authorization', auth(U2))).status).toBe(200);
  });

  it('refuses a forged cursor or filter', async () => {
    const db = fakeDb({ [U2]: 'ADMIN' });
    for (const query of ['before=bm90LWEtY3Vyc29y', 'asset=%3Cb%3E', `user=${'x'.repeat(200)}`]) {
      expect((await request(app(db)).get(`/api/v1/admin/deposit-address-copies?${query}`).set('Authorization', auth(U2))).status).toBe(400);
    }
  });
});

describe('the app-wide limiter', () => {
  it('leaves exactly the copy note to its own limits', () => {
    const req = (method: string, path: string) => ({ method, path }) as any;
    expect(isDepositCopyEventRequest(req('POST', '/api/v1/deposit-address-copies'))).toBe(true);
    expect(isDepositCopyEventRequest(req('POST', '/api/v1/deposit-address-copies/'))).toBe(true);
    expect(isDepositCopyEventRequest(req('GET', '/api/v1/deposit-address-copies'))).toBe(false);
    expect(isDepositCopyEventRequest(req('POST', '/api/v1/deposits/claim'))).toBe(false);
    expect(isDepositCopyEventRequest(req('POST', '/api/v1/admin/deposit-packages/confirm'))).toBe(false);
    expect(isDepositCopyEventRequest(req('POST', '/api/v1/withdrawals'))).toBe(false);
  });
});
