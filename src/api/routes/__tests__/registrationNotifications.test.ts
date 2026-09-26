process.env.JWT_SECRET = 'synthetic-registration-notification-secret-123456';
process.env.REGISTRATION_OPEN = 'true';

import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';
import { authRouter } from '../auth';

const createdAt = new Date();
const passThrough = (_req: any, _res: any, next: any) => next();
function setup(role?: string) {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => ({ ...data, id: 'synthetic-user-id', createdAt, role: role ?? data.role })),
      updateMany: jest.fn(),
    },
    session: { create: jest.fn().mockResolvedValue({ id: 'synthetic-session' }) },
    auditLog: { create: jest.fn(), findMany: jest.fn() },
  };
  const router = authRouter(prisma, {
    limiters: { register: passThrough, login: passThrough },
    countryDetection: { detect: async () => null } as any,
  });
  let response: express.Response;
  const app = express().use(express.json()).use((_req, res, next) => { response = res; next(); }).use('/api/v1', router);
  const route: any = router.stack.find((layer: any) => layer.route?.path === '/auth/register');
  const handler: any = route.route.stack.at(-1).handle;
  return { app, prisma, handler, response: () => response };
}
const signup = (app: express.Express, email = 'synthetic@example.invalid') => request(app)
  .post('/api/v1/auth/register').send({ email, password: 'SyntheticPassword123', jwt: 'DO_NOT_SEND', apiKey: 'DO_NOT_SEND' });

beforeEach(() => {
  process.env.REGISTRATION_OPEN = 'true';
  jest.spyOn(bcrypt, 'hash').mockImplementation(async () => 'synthetic-password-hash');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ status: 'SENT' }));
});
afterEach(() => jest.restoreAllMocks());

test('successful USER: exactly one notification after 201, using returned row; zero extra DB operations', async () => {
  const s = setup();
  let atDispatch: any;
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    atDispatch = { headersSent: s.response().headersSent, status: s.response().statusCode,
      sessions: s.prisma.session.create.mock.calls.length, body: JSON.parse(init!.body as string) };
    return Response.json({ status: 'SENT' });
  });
  const res = await signup(s.app);
  expect(res.status).toBe(201);
  expect(Object.keys(res.body)).toEqual(['token']);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(atDispatch).toEqual({ headersSent: true, status: 201, sessions: 1,
    body: { eventId: 'synthetic-user-id', eventType: 'NEW_USER_REGISTERED', userId: 'synthetic-user-id',
      email: 'synthetic@example.invalid', role: 'USER', timestamp: createdAt.getTime() } });
  expect(s.prisma.user.findUnique).toHaveBeenCalledTimes(1);
  expect(s.prisma.user.create).toHaveBeenCalledTimes(1);
  expect(s.prisma.user.updateMany).not.toHaveBeenCalled();
  expect(s.prisma.auditLog.create).not.toHaveBeenCalled();
  expect(s.prisma.auditLog.findMany).not.toHaveBeenCalled();
});
test.each(['ADMIN', 'SERVICE'])('successful %s creation does not notify', async role => {
  const s = setup(role);
  expect((await signup(s.app)).status).toBe(201);
  expect(fetch).not.toHaveBeenCalled();
});
test('automatic ADMIN assignment is preserved and silent', async () => {
  const s = setup();
  expect((await signup(s.app, 'voltex.crypto@gmail.com')).status).toBe(201);
  expect(fetch).not.toHaveBeenCalled();
});
test.each(['duplicate', 'closed', 'invalid'])('%s registration does not notify', async mode => {
  const s = setup();
  if (mode === 'duplicate') s.prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
  if (mode === 'closed') process.env.REGISTRATION_OPEN = 'false';
  const res = await signup(s.app, mode === 'invalid' ? 'invalid-email' : undefined);
  expect(res.status).toBe(mode === 'closed' ? 403 : 400);
  expect(s.prisma.user.create).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
test.each(['user', 'session'])('failed %s write never emits success notification', async delegate => {
  const s = setup();
  s.prisma[delegate].create.mockRejectedValue(new Error('synthetic DB failure'));
  await expect(s.handler({ body: { email: 'synthetic@example.invalid', password: 'SyntheticPassword123' }, get: () => undefined }, {}))
    .rejects.toThrow('synthetic DB failure');
  expect(fetch).not.toHaveBeenCalled();
});
test('referral-code collision retries do not duplicate notification', async () => {
  const s = setup();
  s.prisma.user.create.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['referralCode'] } });
  expect((await signup(s.app)).status).toBe(201);
  expect(s.prisma.user.create).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test.each(['reject', 'http', 'pending'])('Telegram %s cannot block or roll back 201 registration', async mode => {
  const s = setup();
  jest.mocked(fetch).mockImplementation(() => mode === 'reject' ? Promise.reject(new Error('NEVER_LOG_SECRET'))
    : mode === 'pending' ? new Promise(() => {}) : Promise.resolve(new Response('NEVER_LOG_SECRET', { status: 503 })));
  expect((await signup(s.app).timeout(2000)).status).toBe(201);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(s.prisma.user.create).toHaveBeenCalledTimes(1);
  expect(s.prisma.session.create).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(jest.mocked(console.warn).mock.calls)).not.toContain('NEVER_LOG_SECRET');
});
