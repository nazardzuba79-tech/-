import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { copyPerformanceRouter } from '../copyPerformance';

function setup() {
  const db: any = { copyStrategyOwner: { findUnique: jest.fn().mockResolvedValue({ publicName: 'Nazar', ownerUserId: null, premium: true }) }, user: { findUnique: jest.fn() },
    session: { findUnique: jest.fn().mockResolvedValue({ id: 'local-session', userId: 'local-viewer', revokedAt: null, lastSeenAt: new Date() }) } };
  const service: any = { get: jest.fn(async (strategy: string) => ({ trader: { name: strategy }, rawPrecision: 1113907.030012345 })) };
  const app = express(); app.use('/api/v1', copyPerformanceRouter(db, service));
  const token = jwt.sign({ sub: 'local-viewer', sid: 'local-session' }, process.env.JWT_SECRET!, { expiresIn: '10m' });
  return { app, db, service, token };
}
test('normal API preserves precision and real session auth; HEAD works without account writes', async () => {
  const { app, service, token, db } = setup();
  for (const name of ['nazar', 'ksenia']) {
    await request(app).get('/api/v1/copy-trading/' + name).expect(401);
    const response = await request(app).get('/api/v1/copy-trading/' + name).set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body).toEqual({ trader: { name }, rawPrecision: 1113907.030012345 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.get).toHaveBeenCalledWith(name);
  }
  await request(app).head('/api/v1/copy-trading/nazar').set('Authorization', `Bearer ${token}`).expect(200);
  await request(app).post('/api/v1/copy-trading/nazar').expect(404);
  await request(app).post('/api/v1/copy-trading/ksenia/reset').expect(404);
  await request(app).get('/api/v1/copy-trading/unknown').expect(404);
  db.session.findUnique.mockResolvedValue({ id: 'local-session', userId: 'local-viewer', revokedAt: new Date(), lastSeenAt: new Date() });
  await request(app).get('/api/v1/copy-trading/nazar').set('Authorization', `Bearer ${token}`).expect(401);
});
test('identities allowlist does not disclose owner IDs, email or financial fields', async () => {
  const { app, db } = setup();
  const response = await request(app).get('/api/v1/copy-trading/identities').expect(200);
  expect(response.body.identities).toHaveLength(2);
  for (const identity of response.body.identities) expect(Object.keys(identity).sort())
    .toEqual(['traderId', 'displayName', 'avatarUrl', 'avatarVersion', 'verified', 'premium'].sort());
  await request(app).get('/api/v1/copy-trading/identity/unrelated-account').expect(404);
  expect(db.user.findUnique).not.toHaveBeenCalled();
});
test('storage failures are explicit 503 without leaking details or falling back to a fake history', async () => {
  const { app, service, token } = setup();
  service.get.mockRejectedValue(new Error('private database connection'));
  const response = await request(app).get('/api/v1/copy-trading/ksenia').set('Authorization', `Bearer ${token}`).expect(503);
  expect(response.body).toEqual({ error: 'Strategy performance temporarily unavailable' });
  expect(JSON.stringify(response.body)).not.toContain('private');
});

test('marketplace bootstrap preserves both original responses and identity allowlist behind real session auth', async () => {
  const { app, service, token, db } = setup();
  await request(app).get('/api/v1/copy-trading/marketplace').expect(401);
  const { body, headers } = await request(app).get('/api/v1/copy-trading/marketplace').set('Authorization', `Bearer ${token}`).expect(200);
  expect(body.nazar).toEqual(await service.get('nazar'));
  expect(body.ksenia).toEqual(await service.get('ksenia'));
  expect(body.identities).toHaveLength(2);
  expect(body.errors).toEqual({});
  expect(Number.isFinite(Date.parse(body.generatedAt))).toBe(true);
  expect(headers['cache-control']).toBe('no-store');
  expect(db.session.findUnique).toHaveBeenCalledTimes(1);
});

test.each(['nazar', 'ksenia', 'identities'])('marketplace keeps other sections when %s fails', async failed => {
  const { app, service, token, db } = setup();
  service.get.mockImplementation(async (strategy: string) => {
    if (strategy === failed) throw new Error('private failure');
    return { trader: { name: strategy }, realZero: 0 };
  });
  if (failed === 'identities') db.copyStrategyOwner.findUnique.mockRejectedValue(new Error('private owner'));
  const { body } = await request(app).get('/api/v1/copy-trading/marketplace').set('Authorization', `Bearer ${token}`).expect(200);
  expect(body[failed]).toBeNull();
  for (const section of ['nazar', 'ksenia', 'identities'].filter(key => key !== failed)) expect(body[section]).not.toBeNull();
  expect(body.errors).toEqual({ [failed]: 'temporarily_unavailable' });
  expect(JSON.stringify(body)).not.toContain('private');
});

test('marketplace total failure returns explicit nulls and 503', async () => {
  const { app, service, token, db } = setup();
  service.get.mockRejectedValue(new Error('private database'));
  db.copyStrategyOwner.findUnique.mockRejectedValue(new Error('private identity'));
  const { body } = await request(app).get('/api/v1/copy-trading/marketplace').set('Authorization', `Bearer ${token}`).expect(503);
  expect([body.nazar, body.ksenia, body.identities]).toEqual([null, null, null]);
  expect(Object.keys(body.errors)).toHaveLength(3);
  expect(JSON.stringify(body)).not.toContain('private');
});

test('marketplace starts both strategies before either resolves', async () => {
  const { app, service, token } = setup();
  const releases: (() => void)[] = [];
  let bothStarted!: () => void;
  const started = new Promise<void>(resolve => { bothStarted = resolve; });
  service.get.mockImplementation((name: string) => new Promise(resolve => {
    releases.push(() => resolve({ trader: { name } }));
    if (releases.length === 2) bothStarted();
  }));
  const pending = request(app).get('/api/v1/copy-trading/marketplace').set('Authorization', `Bearer ${token}`).then(response => response);
  await started;
  expect(service.get.mock.calls.map((args: unknown[]) => args[0])).toEqual(['nazar', 'ksenia']);
  releases.forEach(release => release());
  expect((await pending).status).toBe(200);
});
