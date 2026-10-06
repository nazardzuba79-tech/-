process.env.JWT_SECRET = 'test-secret-at-least-this-long';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { contactPolicyRouter } from '../contactPolicy';
import { supportRequestRouter } from '../supportRequest';
import { isBlockedContactEmail, blockedContactEmails, contactEmailHash, CONTACT_EMAIL_BLOCKED, CONTACT_EMAIL_UNBLOCKED } from '../../../services/ContactEmailPolicy';

const token = (id: string) => jwt.sign({ sub: id }, process.env.JWT_SECRET!);
function setup() {
  const events: any[] = [];
  const user = { id: 'user', email: 'member@example.invalid', role: 'USER', blockedAt: null };
  const db: any = {
    user: { findUnique: jest.fn(async ({ where }) => where.id === 'admin' ? { ...user, id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' } : where.id === 'user' ? user : null) },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    $executeRaw: jest.fn(),
    auditLog: {
      findFirst: jest.fn(async ({ where }) => [...events].reverse().find(e => e.metadata.emailHash === where.metadata.equals) ?? null),
      findMany: jest.fn(async () => [...events].reverse()),
      create: jest.fn(async ({ data }) => { events.push(data); return data; }),
    },
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  const send = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const app = express(); app.use(express.json());
  app.use('/api/v1', contactPolicyRouter(db)); app.use('/api/v1', supportRequestRouter(db, send));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use((_err: any, _req: any, res: any, _next: any) => res.status(503).json({ error: 'unavailable' }));
  return { app, db, events, user, send };
}
const body = { name: 'Member', email: 'forged@example.invalid', subject: 'OTHER', message: 'Fixture support message' };
const old = process.env;
beforeEach(() => { process.env = { ...old, SUPPORT_RELAY_KEY: 'fixture-key', BLOCKED_CONTACT_EMAIL_SHA256: '', BLOCKED_CONTACT_EMAILS: '' }; });
afterAll(() => { process.env = old; });

test('only admin can manage list; unauthenticated and ordinary users cannot write', async () => {
  const { app, db } = setup();
  for (const suffix of ['', '/block', '/unblock']) {
    const method = suffix ? 'post' : 'get';
    expect((await request(app)[method]('/api/v1/admin/spam-emails' + suffix).send({ email: 'spam@example.invalid' })).status).toBe(401);
    expect((await request(app)[method]('/api/v1/admin/spam-emails' + suffix).set('Authorization', 'Bearer ' + token('user')).send({ email: 'spam@example.invalid' })).status).toBe(403);
  }
  expect(db.auditLog.create).not.toHaveBeenCalled();
});
test('admin block/unblock is normalized, persistent without an account, and changes no user data', async () => {
  const { app, db, events } = setup();
  const headers = { Authorization: 'Bearer ' + token('admin') };
  expect((await request(app).post('/api/v1/admin/spam-emails/block').set(headers).send({ email: ' SPAM@EXAMPLE.INVALID ' })).status).toBe(200);
  expect(await isBlockedContactEmail(db, 'SPAM@example.invalid')).toBe(true);
  expect((await blockedContactEmails(db)).map(row => row.email)).toEqual(['spam@example.invalid']);
  expect(events[0]).toMatchObject({ userId: 'admin', action: CONTACT_EMAIL_BLOCKED, metadata: { email: 'spam@example.invalid', emailHash: contactEmailHash('spam@example.invalid'), actorEmail: 'admin@example.invalid' } });
  expect(db.session.updateMany).toHaveBeenCalledTimes(1);
  expect(db.session.updateMany.mock.calls[0][0].where).toEqual({ revokedAt: null, user: { email: { equals: 'spam@example.invalid', mode: 'insensitive' } } });
  expect((await request(app).post('/api/v1/admin/spam-emails/unblock').set(headers).send({ email: 'spam@example.invalid' })).status).toBe(200);
  expect(await isBlockedContactEmail(db, 'spam@example.invalid')).toBe(false);
  expect(await blockedContactEmails(db)).toEqual([]);
  expect(Object.keys(db.user)).toEqual(['findUnique']);
  expect(db.session.updateMany).toHaveBeenCalledTimes(1); // Unspam never resurrects sessions.
});
test('unblock is persistent and overrides earlier block', async () => {
  const { db, events } = setup();
  events.push({ action: CONTACT_EMAIL_BLOCKED, metadata: { email: 'spam@example.invalid', emailHash: contactEmailHash('spam@example.invalid') }, createdAt: new Date() });
  expect(await isBlockedContactEmail(db, 'spam@example.invalid')).toBe(true);
  expect((await blockedContactEmails(db)).map(row => row.email)).toEqual(['spam@example.invalid']);
  events.push({ action: CONTACT_EMAIL_UNBLOCKED, metadata: { email: 'spam@example.invalid', emailHash: contactEmailHash('spam@example.invalid') } });
  expect(await isBlockedContactEmail(db, 'spam@example.invalid')).toBe(false);
  expect(await blockedContactEmails(db)).toEqual([]);
});
test('guest or deleted account cannot relay mail', async () => {
  const { app, send } = setup();
  expect((await request(app).post('/api/v1/support/request').send(body)).status).toBe(401);
  expect((await request(app).post('/api/v1/support/request').set('Authorization', 'Bearer ' + token('deleted')).send(body)).status).toBe(401);
  expect(send).not.toHaveBeenCalled();
});
test('blocked member cannot bypass policy using a different form email', async () => {
  const { app, events, send } = setup();
  events.push({ action: CONTACT_EMAIL_BLOCKED, metadata: { email: 'member@example.invalid', emailHash: contactEmailHash('member@example.invalid') } });
  expect((await request(app).post('/api/v1/support/request').set('Authorization', 'Bearer ' + token('user')).send(body)).status).toBe(403);
  expect(send).not.toHaveBeenCalled();
});
test('allowed member relay uses account email, never browser supplied email', async () => {
  const { app, send } = setup();
  expect((await request(app).post('/api/v1/support/request').set('Authorization', 'Bearer ' + token('user')).send(body)).status).toBe(200);
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(send.mock.calls[0][1].body).email).toBe('member@example.invalid');
  expect(send.mock.calls[0][1].headers['X-Voltex-Support-Key']).toBe('fixture-key');
});
test('DB failure denies delivery, produces HTTP response and leaves server alive', async () => {
  const { app, db, send } = setup(); db.auditLog.findFirst.mockRejectedValueOnce(new Error('database offline'));
  expect((await request(app).post('/api/v1/support/request').set('Authorization', 'Bearer ' + token('user')).send(body)).status).toBe(503);
  expect(send).not.toHaveBeenCalled(); expect((await request(app).get('/health')).status).toBe(200);
});
test('delivery failure never reports success or retries', async () => {
  const { app, send } = setup(); send.mockRejectedValueOnce(new Error('timeout'));
  expect((await request(app).post('/api/v1/support/request').set('Authorization', 'Bearer ' + token('user')).send(body)).status).toBe(502);
  expect(send).toHaveBeenCalledTimes(1); expect((await request(app).get('/health')).status).toBe(200);
});


test('existing sid sessions and legacy tokens are refused while blocked; revoked sessions stay revoked after unspam', async () => {
  const {app,db,events,send,user}=setup();
  const session={id:'session',userId:'user',revokedAt:null as Date|null,lastSeenAt:new Date(),remembered:false,user:{email:user.email}};
  db.session.findUnique=jest.fn(async()=>session);
  const sid=jwt.sign({sub:'user',sid:'session'},process.env.JWT_SECRET!);
  const auth={Authorization:'Bearer '+sid};
  events.push({action:CONTACT_EMAIL_BLOCKED,metadata:{email:user.email,emailHash:contactEmailHash(user.email)}});
  expect((await request(app).post('/api/v1/support/request').set(auth).send(body)).status).toBe(403);
  expect(send).not.toHaveBeenCalled();
  session.revokedAt=new Date();
  events.push({action:CONTACT_EMAIL_UNBLOCKED,metadata:{email:user.email,emailHash:contactEmailHash(user.email)}});
  expect((await request(app).post('/api/v1/support/request').set(auth).send(body)).status).toBe(401);
  expect(send).not.toHaveBeenCalled();
});

test('normalization does not block aliases, other addresses, or whole domains', async()=>{
  const {db,events}=setup();
  events.push({action:CONTACT_EMAIL_BLOCKED,metadata:{email:'one@gmail.com',emailHash:contactEmailHash('one@gmail.com')}});
  expect(await isBlockedContactEmail(db,' ONE@GMAIL.COM ')).toBe(true);
  for(const email of ['one+alias@gmail.com','o.ne@gmail.com','two@gmail.com']) expect(await isBlockedContactEmail(db,email)).toBe(false);
});

test('session revoke failure is an HTTP error and the server remains available',async()=>{
  const {app,db}=setup();
  db.session.updateMany.mockRejectedValueOnce(new Error('revoke failed'));
  const response=await request(app).post('/api/v1/admin/spam-emails/block').set('Authorization','Bearer '+token('admin')).send({email:'spam@example.invalid'});
  expect(response.status).toBe(503);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  expect((await request(app).get('/health')).status).toBe(200);
});
