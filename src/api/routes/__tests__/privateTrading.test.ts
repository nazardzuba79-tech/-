import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { privateTradingRouter, privatePreviewSchema } from '../privateTrading';
import { assertOwner } from '../../../private-trading/access';

const fixture = () => {
  const config = { enabled: true, ownerId: 'owner' };
  const users: Record<string, any> = { owner: { role: 'ADMIN', blockedAt: null }, admin2: { role: 'ADMIN', blockedAt: null }, ordinary: { role: 'USER', blockedAt: null } };
  const sessions: Record<string, any> = Object.fromEntries(Object.keys(users).map(id => [`session-${id}`, { id: `session-${id}`, userId: id, revokedAt: null, lastSeenAt: new Date() }]));
  const prisma: any = {
    user: { findUnique: jest.fn(async ({ where }: any) => users[where.id]) },
    session: { findUnique: jest.fn(async ({ where }: any) => sessions[where.id]), update: jest.fn(async () => ({})) },
  };
  const service: any = { store: { authorized: (actor: any) => assertOwner(prisma, actor, () => config), allocate: jest.fn(async () => ({ available: '10' })) } };
  for (const method of ['state', 'getMarket', 'getChartCandles', 'preview', 'getPreview', 'cancelPreview', 'confirm', 'cancelOrder', 'close', 'edit', 'advance', 'closeOnChart', 'card', 'getCard']) service[method] = jest.fn(async () => ({ ok: true }));
  const app = express(); app.use(express.json()); app.use('/api/v1', privateTradingRouter(prisma, service));
  const token = (id = 'owner', extras: any = {}, options: any = {}) => jwt.sign({ sub: id, sid: `session-${id}`, ...extras }, process.env.JWT_SECRET!, { expiresIn: '1h', ...options });
  return { app, service, prisma, config, users, sessions, token };
};
const trade = { mode: 'DEMO_LIVE', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', leverage: '10', quantity: '0.01', idempotencyKey: 'request-key-1' };

describe('private owner trading API', () => {
  test('requires actual owner, role, server flag and current session together', async () => {
    const f = fixture();
    expect((await request(f.app).get('/api/v1/private-trading/access')).status).toBe(401);
    for (const id of ['ordinary', 'admin2']) expect((await request(f.app).get('/api/v1/private-trading/access').auth(f.token(id), { type: 'bearer' })).status).toBe(403);
    expect((await request(f.app).get('/api/v1/private-trading/access').auth(f.token(), { type: 'bearer' })).body.allowed).toBe(true);
    f.config.enabled = false;
    expect((await request(f.app).get('/api/v1/private-trading/access').auth(f.token(), { type: 'bearer' })).status).toBe(403);
  });
  test('legacy tokens, pending 2FA, expired tokens and revoked sessions never grant access', async () => {
    const f = fixture();
    for (const token of [f.token('owner', { sid: undefined }), f.token('owner', { purpose: '2fa' }), f.token('owner', {}, { expiresIn: -1 })]) {
      expect((await request(f.app).get('/api/v1/private-trading/state').auth(token, { type: 'bearer' })).status).toBe(401);
    }
    f.sessions['session-owner'].revokedAt = new Date();
    expect((await request(f.app).get('/api/v1/private-trading/state').auth(f.token(), { type: 'bearer' })).status).toBe(401);
    expect(f.service.state).not.toHaveBeenCalled();
  });
  test('fresh role and block status are checked on every request, including card exports', async () => {
    const f = fixture(), token = f.token();
    expect((await request(f.app).get('/api/v1/private-trading/cards/card-id').auth(token, { type: 'bearer' })).status).toBe(200);
    f.users.owner.role = 'USER';
    expect((await request(f.app).get('/api/v1/private-trading/cards/card-id').auth(token, { type: 'bearer' })).status).toBe(403);
    f.users.owner.role = 'ADMIN'; f.users.owner.blockedAt = new Date();
    expect((await request(f.app).post('/api/v1/private-trading/cards').auth(token, { type: 'bearer' }).send({ positionId: 'p1' })).status).toBe(403);
    expect(f.service.card).not.toHaveBeenCalled();
  });
  test.each([
    ['get', '/state', {}], ['get', '/market?symbol=BTCUSDT', {}], ['get', '/previews/id', {}],
    ['post', '/previews', trade], ['post', '/previews/id/confirm', { idempotencyKey: 'request-key' }],
    ['delete', '/previews/id', {}], ['delete', '/orders/id', { idempotencyKey: 'request-key' }],
    ['post', '/positions/id/close', { idempotencyKey: 'request-key' }],
    ['patch', '/positions/id', { marginDelta: '1', idempotencyKey: 'request-key' }],
    ['post', '/scenarios/id/advance', { asOf: new Date().toISOString(), idempotencyKey: 'request-key' }],
    ['get', '/cards/id', {}], ['post', '/cards', { positionId: 'id' }], ['post', '/allocate', { amount: '1', idempotencyKey: 'request-key' }],
    ['get', '/candles?symbol=BTCUSDT&source=BYBIT_LINEAR&interval=1h', {}],
    ['post', '/scenarios/id/close-on-chart', { candle: { source: 'BYBIT_LINEAR', interval: '1h', openTime: 1789340400000, pricePoint: 'CLOSE' }, idempotencyKey: 'request-key' }],
  ])('other admins cannot reach %s %s', async (method, path, body) => {
    const f = fixture();
    const res = await (request(f.app) as any)[method as string](`/api/v1/private-trading${path}`).auth(f.token('admin2'), { type: 'bearer' }).send(body);
    expect(res.status).toBe(403); expect(res.headers['cache-control']).toBe('private, no-store');
  });
  test('passes server session identity rather than client-supplied owner fields', async () => {
    const f = fixture();
    const res = await request(f.app).post('/api/v1/private-trading/previews').auth(f.token(), { type: 'bearer' }).send(trade);
    expect(res.status).toBe(200);
    expect(f.service.preview).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', sessionId: 'session-owner' }), expect.objectContaining(trade));
    const bad = await request(f.app).post('/api/v1/private-trading/previews').auth(f.token(), { type: 'bearer' }).send({ ...trade, userId: 'admin2', profile: { fee: '0' } });
    expect(bad.status).toBe(400); expect(f.service.preview).toHaveBeenCalledTimes(1);
  });
  test.each(['0', '-1', 'NaN', 'Infinity', '1e4', '0.0000000000000000001', null, 1])('rejects malformed quantity %p before financial writes', async quantity => {
    const f = fixture();
    const res = await request(f.app).post('/api/v1/private-trading/previews').auth(f.token(), { type: 'bearer' }).send({ ...trade, quantity });
    expect(res.status).toBe(400); expect(f.service.preview).not.toHaveBeenCalled();
  });
  test('does not permit historical timestamps or manual prices on current execution', () => {
    expect(privatePreviewSchema.safeParse({ ...trade, manualEntryPrice: '1' }).success).toBe(false);
    expect(privatePreviewSchema.safeParse({ ...trade, effectiveOpenedAt: '2026-09-01T00:00:00Z' }).success).toBe(false);
    expect(privatePreviewSchema.safeParse({ ...trade, margin: '1' }).success).toBe(false);
  });
  test('historical event timestamps normalize to UTC and client-model overrides are rejected', () => {
    const parsed = privatePreviewSchema.parse({ ...trade, mode: 'HISTORICAL_REPLAY', effectiveOpenedAt: '2026-09-01T10:00:00+03:00', events: [
      { kind: 'MARGIN', id: 'event-key-1', effectiveAt: '2026-09-01T12:00:00+03:00', amount: '50' },
    ] });
    expect(parsed.events?.[0].effectiveAt).toBe(Date.parse('2026-09-01T09:00:00Z'));
    expect(privatePreviewSchema.safeParse({ ...trade, instrumentSnapshot: {} }).success).toBe(false);
  });
  test('private data is never publicly cached; unexpected exceptions do not expose SQL or secrets', async () => {
    const f = fixture(); f.service.state.mockRejectedValue(new Error('postgres://secret-password test SQL'));
    const res = await request(f.app).get('/api/v1/private-trading/state').auth(f.token(), { type: 'bearer' });
    expect(res.status).toBe(500); expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers.vary).toContain('Authorization'); expect(JSON.stringify(res.body)).not.toMatch(/password|postgres|SQL/);
  });
});

describe('private chart trade API', () => {
  const candle = { source: 'BYBIT_LINEAR', interval: '1h', openTime: 1789340400000, pricePoint: 'CLOSE' };
  test('historical entry needs only selected candle identity, never manual date or price', async () => {
    const f = fixture(); const res = await request(f.app).post('/api/v1/private-trading/previews').auth(f.token(), { type: 'bearer' }).send({ ...trade, mode: 'HISTORICAL_REPLAY', candleEntry: candle });
    expect(res.status).toBe(200); expect(f.service.preview.mock.calls[0][1]).toMatchObject({ candleEntry: candle });
    expect(f.service.preview.mock.calls[0][1]).not.toHaveProperty('effectiveOpenedAt');
  });
  test.each([{ source: 'BYBIT_SPOT' }, { price: '100' }, { effectiveAt: 12345 }, { interval: '2h' }, { openTime: -1 }, { openTime: null }])('selected candle forbids source and financial overrides %p', patch => {
    expect(privatePreviewSchema.safeParse({ ...trade, mode: 'HISTORICAL_REPLAY', candleEntry: { ...candle, ...patch } }).success).toBe(false);
  });
  test('candle entry cannot be mixed with manual price/date or live execution', () => {
    for (const patch of [{ manualEntryPrice: '100' }, { effectiveOpenedAt: '2026-09-01T00:00:00Z' }, { effectiveClosedAt: '2026-09-02T00:00:00Z' }, { mode: 'DEMO_LIVE' }]) expect(privatePreviewSchema.safeParse({ ...trade, mode: 'HISTORICAL_REPLAY', candleEntry: candle, ...patch }).success).toBe(false);
  });
  test('close-on-chart passes owner session, scenario ID and strict candle identity', async () => {
    const f = fixture(); const res = await request(f.app).post('/api/v1/private-trading/scenarios/scenario-1/close-on-chart').auth(f.token(), { type: 'bearer' }).send({ candle, idempotencyKey: 'close-request-1' });
    expect(res.status).toBe(200); expect(f.service.closeOnChart).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner' }), 'scenario-1', candle, 'close-request-1');
    const forged = await request(f.app).post('/api/v1/private-trading/scenarios/scenario-1/close-on-chart').auth(f.token(), { type: 'bearer' }).send({ candle: { ...candle, price: '1' }, idempotencyKey: 'close-request-1' });
    expect(forged.status).toBe(400); expect(f.service.closeOnChart).toHaveBeenCalledTimes(1);
  });
  test('private chart candle read is bounded, uncached publicly and has a cancellation signal', async () => {
    const f = fixture(); const res = await request(f.app).get('/api/v1/private-trading/candles?symbol=BTCUSDT&source=BYBIT_LINEAR&interval=1h&limit=500').auth(f.token(), { type: 'bearer' });
    expect(res.status).toBe(200); expect(res.headers['cache-control']).toBe('private, no-store');
    expect(f.service.getChartCandles).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner' }), expect.objectContaining({ symbol: 'BTCUSDT', limit: 500 }), expect.any(AbortSignal));
    expect((await request(f.app).get('/api/v1/private-trading/candles?symbol=BTCUSDT&source=BYBIT_LINEAR&interval=1h&limit=10000').auth(f.token(), { type: 'bearer' })).status).toBe(400);
  });
});
