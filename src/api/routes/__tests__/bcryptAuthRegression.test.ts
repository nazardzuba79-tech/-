/**
 * bcrypt migration acceptance through the unchanged real HTTP routes.
 * Only Prisma storage and optional country lookup are isolated fixtures.
 * bcrypt, JWT, TOTP, QR encoding and requireAuth are NOT mocked. No real
 * database, production account, mail transport or external lookup is used.
 */
process.env.JWT_SECRET = 'bcrypt-phase2a-isolated-test-secret';
process.env.REGISTRATION_OPEN = 'true';

import request from 'supertest';
import express, { RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import jwt, { JwtPayload } from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { PrismaClient } from '@prisma/client';
import { authRouter } from '../auth';
import { accountRouter } from '../account';
import legacyFixtures from '../../../services/__tests__/fixtures/bcrypt-5.1.1-compatibility.json';

jest.setTimeout(30_000);

type MemoryUser = {
  id: string; email: string; passwordHash: string; role: string;
  referralCode: string; referredById?: string; country: string | null;
  displayName: string | null; phone: string | null; avatarUrl: string | null;
  emailVerifiedAt: Date | null; blockedAt: Date | null; blockedReason: string | null;
  kycStatus: string; twoFactorEnabled: boolean; twoFactorSecret: string | null;
  twoFactorBackupCodes: string[]; createdAt: Date;
};
type MemorySession = {
  id: string; userId: string; ip: string | null; userAgent: string | null;
  createdAt: Date; lastSeenAt: Date; revokedAt: Date | null;
};
type MemoryAudit = {
  id: string; userId: string; action: string; metadata: unknown; createdAt: Date;
};
type MemoryState = {
  users: Map<string, MemoryUser>; sessions: Map<string, MemorySession>;
  audit: MemoryAudit[]; nextId: number;
};

function memoryStore(state: MemoryState = { users: new Map(), sessions: new Map(), audit: [], nextId: 1 }) {
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Partial<MemoryUser> }) => {
        const user = [...state.users.values()].find((value) =>
          Object.entries(where).every(([key, expected]) => value[key as keyof MemoryUser] === expected));
        return user ? structuredClone(user) : null;
      },
      create: async ({ data }: { data: Pick<MemoryUser, 'email' | 'passwordHash' | 'role' | 'referralCode'> }) => {
        if ([...state.users.values()].some((user) => user.email === data.email)) {
          throw new Error('Unexpected duplicate fixture user');
        }
        const user: MemoryUser = {
          id: `fixture-user-${state.nextId++}`, country: null, displayName: null,
          phone: null, avatarUrl: null, emailVerifiedAt: null, blockedAt: null,
          blockedReason: null, kycStatus: 'NOT_STARTED', twoFactorEnabled: false,
          twoFactorSecret: null, twoFactorBackupCodes: [], createdAt: new Date(), ...data,
        };
        state.users.set(user.id, user);
        return structuredClone(user);
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<MemoryUser> }) => {
        const user = state.users.get(where.id);
        if (!user) throw new Error('Unknown fixture user');
        Object.assign(user, structuredClone(data));
        return structuredClone(user);
      },
    },
    session: {
      create: async ({ data }: { data: Pick<MemorySession, 'userId' | 'ip' | 'userAgent'> }) => {
        const session: MemorySession = {
          id: `fixture-session-${state.nextId++}`, createdAt: new Date(), lastSeenAt: new Date(),
          revokedAt: null, ...data,
        };
        state.sessions.set(session.id, session);
        return structuredClone(session);
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        structuredClone(state.sessions.get(where.id) ?? null),
      findMany: async ({ where }: { where: { userId: string; revokedAt: null } }) =>
        [...state.sessions.values()].filter((session) => session.userId === where.userId && !session.revokedAt)
          .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()).map((session) => structuredClone(session)),
      update: async ({ where, data }: { where: { id: string }; data: Partial<MemorySession> }) => {
        const session = state.sessions.get(where.id);
        if (!session) throw new Error('Unknown fixture session');
        Object.assign(session, data);
        return structuredClone(session);
      },
    },
    auditLog: {
      create: async ({ data }: { data: Pick<MemoryAudit, 'userId' | 'action' | 'metadata'> }) => {
        const entry = { id: `fixture-audit-${state.nextId++}`, createdAt: new Date(), ...data };
        state.audit.push(structuredClone(entry));
        return entry;
      },
      findMany: async ({ where, take }: { where: { userId: string; action: { in: string[] } }; take: number }) =>
        state.audit.filter((entry) => entry.userId === where.userId && where.action.in.includes(entry.action))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take),
    },
    // No balances, email challenges or financial delegates exist. Unexpected
    // product side effects therefore cannot silently pass against these fixtures.
  };
  return { state, prisma: prisma as unknown as PrismaClient };
}

const passThrough: RequestHandler = (_req, _res, next) => next();
function buildApp(store: ReturnType<typeof memoryStore>) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', authRouter(store.prisma, {
    limiters: { register: passThrough, login: passThrough },
    countryDetection: { detect: async () => null } as any,
  }));
  app.use('/api/v1', accountRouter(store.prisma));
  return app;
}
function claims(token: string): JwtPayload {
  return jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
}
const password = 'VoltexFixturePasswordA1';
const email = 'bcrypt-fixture@example.invalid';
async function register(app: ReturnType<typeof buildApp>, customPassword = password) {
  const response = await request(app).post('/api/v1/auth/register')
    .set('User-Agent', 'VOLTEX-isolated-bcrypt-regression').send({ email, password: customPassword });
  expect(response.status).toBe(201);
  return response.body.token as string;
}
function login(app: ReturnType<typeof buildApp>, suppliedPassword = password, suppliedEmail = email) {
  return request(app).post('/api/v1/auth/login').send({ email: suppliedEmail, password: suppliedPassword });
}

describe('bcrypt real-route auth/security regression', () => {
  it('registers at unchanged cost 12 and issues a 12-hour persisted session accepted by protected /me', async () => {
    const store = memoryStore();
    const app = buildApp(store);
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    const token = await register(app);
    const payload = claims(token);
    const user = store.state.users.get(payload.sub!)!;
    expect(user.passwordHash).toMatch(/^\$2b\$12\$/);
    expect(bcrypt.getRounds(user.passwordHash)).toBe(12);
    expect(await bcrypt.compare(password, user.passwordHash)).toBe(true);
    expect(await bcrypt.compare('wrong-password', user.passwordHash)).toBe(false);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.role).toBe('USER');
    expect(payload).toMatchObject({ sub: user.id, sid: expect.any(String) });
    expect(payload.purpose).toBeUndefined();
    expect(payload.exp! - payload.iat!).toBe(12 * 60 * 60);
    expect(store.state.sessions.get(payload.sid)).toMatchObject({
      userId: user.id, revokedAt: null, userAgent: 'VOLTEX-isolated-bcrypt-regression',
    });
    const me = await request(app).get('/api/v1/me').auth(token, { type: 'bearer' });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: user.id, email, twoFactorEnabled: false });
    expect(me.body).not.toHaveProperty('passwordHash');
    expect(me.body).not.toHaveProperty('twoFactorBackupCodes');
    expect(store.state.audit.map((entry) => entry.action)).toEqual(['USER_REGISTERED']);
  });

  it.each(['Uppercase', 'alllowercasepassword'])('preserves rejected registration password rule: %s', async (value) => {
    const store = memoryStore();
    const response = await request(buildApp(store)).post('/api/v1/auth/register').send({ email, password: value });
    expect(response.status).toBe(400);
    expect(store.state.users.size).toBe(0);
    expect(store.state.sessions.size).toBe(0);
  });

  it('preserves accepted Unicode registration and generic duplicate-registration response', async () => {
    const store = memoryStore();
    const app = buildApp(store);
    const unicodePassword = 'ПарольБезпеки💱123';
    await register(app, unicodePassword);
    expect((await login(app, unicodePassword)).status).toBe(200);
    const duplicate = await request(app).post('/api/v1/auth/register').send({ email, password });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body).toEqual({ error: 'Registration failed' });
    expect(store.state.users.size).toBe(1);
    expect(store.state.sessions.size).toBe(2);
  });

  it('keeps nonexistent and incorrect-password login generic and creates no rejected-login session', async () => {
    const store = memoryStore();
    const app = buildApp(store);
    const registeredToken = await register(app);
    const originalHash = [...store.state.users.values()][0].passwordHash;
    const wrong = await login(app, 'wrong-password');
    const missing = await login(app, password, 'missing@example.invalid');
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toEqual({ error: 'Invalid email or password' });
    expect(missing.body).toEqual(wrong.body);
    expect(store.state.sessions.size).toBe(1);
    const accepted = await login(app);
    expect(accepted.status).toBe(200);
    expect(claims(accepted.body.token).sid).not.toBe(claims(registeredToken).sid);
    expect((await request(app).get('/api/v1/me').auth(accepted.body.token, { type: 'bearer' })).status).toBe(200);
    expect([...store.state.users.values()][0].passwordHash).toBe(originalHash);
    expect(store.state.audit.map((entry) => entry.action)).toEqual(['USER_REGISTERED', 'USER_LOGGED_IN']);
  });

  it('preserves account blocking after valid credentials without exposing it for a wrong password', async () => {
    const store = memoryStore();
    const app = buildApp(store);
    await register(app);
    const user = [...store.state.users.values()][0];
    user.blockedAt = new Date();
    user.blockedReason = 'Isolated fixture block';
    const blocked = await login(app);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ error: 'Аккаунт заблокирован: Isolated fixture block' });
    const wrong = await login(app, 'wrong-password');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: 'Invalid email or password' });
    expect(store.state.sessions.size).toBe(1);
    expect(store.state.audit.map((entry) => entry.action)).toEqual(['USER_REGISTERED']);
  });

  it('logs in an unchanged real bcrypt-5 fixture and consumes its old backup hash through the real 2FA route', async () => {
    const oldPassword = legacyFixtures.fixtures.find((fixture) => fixture.id === 'password-ascii')!;
    const oldBackup = legacyFixtures.fixtures.find((fixture) => fixture.id === 'backup-code-one')!;
    const spareBackup = legacyFixtures.fixtures.find((fixture) => fixture.id === 'backup-code-two')!;
    const store = memoryStore();
    const app = buildApp(store);
    const seeded = await store.prisma.user.create({ data: {
      email, passwordHash: oldPassword.hash, role: 'USER', referralCode: 'FIXTURE5',
    } });
    expect((await login(app, oldPassword.wrongPassword)).body).toEqual({ error: 'Invalid email or password' });
    const accepted = await login(app, oldPassword.password);
    expect(accepted.status).toBe(200);
    expect((await request(app).get('/api/v1/me').auth(accepted.body.token, { type: 'bearer' })).status).toBe(200);
    const user = store.state.users.get(seeded.id)!;
    expect(user.passwordHash).toBe(oldPassword.hash); // No silent migration/rehash.
    user.twoFactorEnabled = true;
    user.twoFactorSecret = speakeasy.generateSecret({ length: 20 }).base32;
    user.twoFactorBackupCodes = [oldBackup.hash, spareBackup.hash];
    const pending = await login(app, oldPassword.password);
    expect(pending.body.requires2fa).toBe(true);
    const complete = (target: ReturnType<typeof buildApp>) => request(target).post('/api/v1/auth/login/2fa')
      .send({ pendingToken: pending.body.pendingToken, code: ` ${oldBackup.password.toLowerCase()} ` });
    const completed = await complete(app);
    expect(completed.status).toBe(200);
    expect(user.twoFactorBackupCodes).toEqual([spareBackup.hash]);
    expect(user.passwordHash).toBe(oldPassword.hash);
    expect(store.state.audit.filter((entry) => entry.action === 'TWO_FACTOR_BACKUP_CODE_USED')).toHaveLength(1);
    const restored = memoryStore(structuredClone(store.state));
    const replay = await complete(buildApp(restored));
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ error: 'Invalid authentication code' });
    expect(restored.state.sessions.size).toBe(store.state.sessions.size);
  });

  it('changes only a valid current password, persists a cost-12 hash and rejects the old password afterwards', async () => {
    const store = memoryStore();
    const app = buildApp(store);
    const token = await register(app);
    const user = [...store.state.users.values()][0];
    const initialHash = user.passwordHash;
    const change = (currentPassword: string, newPassword: string) => request(app).patch('/api/v1/me/password')
      .auth(token, { type: 'bearer' }).send({ currentPassword, newPassword });
    expect((await change('wrong-password', 'newvalidlowercasepassword')).status).toBe(401);
    expect((await change(password, 'short')).status).toBe(400);
    expect(user.passwordHash).toBe(initialHash);
    // Password-change schema intentionally differs from registration: 10+
    // characters, with no uppercase rule. Preserve it, do not invent a policy.
    expect((await change(password, 'newvalidlowercasepassword')).body).toEqual({ status: 'ok' });
    expect(bcrypt.getRounds(user.passwordHash)).toBe(12);
    expect(user.passwordHash).not.toBe(initialHash);
    expect(await bcrypt.compare(password, user.passwordHash)).toBe(false);
    expect(await bcrypt.compare('newvalidlowercasepassword', user.passwordHash)).toBe(true);
    const restored = memoryStore(structuredClone(store.state));
    const refreshedApp = buildApp(restored);
    expect((await login(refreshedApp, password)).status).toBe(401);
    expect((await login(refreshedApp, 'newvalidlowercasepassword')).status).toBe(200);
    // Existing sessions survive password change by current product policy.
    expect((await request(refreshedApp).get('/api/v1/me').auth(token, { type: 'bearer' })).status).toBe(200);
    expect(store.state.audit.filter((entry) => entry.action === 'PASSWORD_CHANGED')).toHaveLength(1);
  });

  it('preserves sid/JWT checks, session listing, scoped revocation and legacy session compatibility', async () => {
    const store = memoryStore();
    const app = buildApp(store);
    const firstToken = await register(app);
    const second = await login(app);
    const secondToken = second.body.token;
    const first = claims(firstToken);
    const sessions = await request(app).get('/api/v1/me/sessions').auth(firstToken, { type: 'bearer' });
    expect(sessions.status).toBe(200);
    expect(sessions.body).toHaveLength(2);
    expect(sessions.body.find((session: { id: string }) => session.id === first.sid).current).toBe(true);
    const foreign = jwt.sign({ sub: 'another-user', sid: first.sid }, process.env.JWT_SECRET!);
    expect((await request(app).get('/api/v1/me').auth(foreign, { type: 'bearer' })).status).toBe(401);
    const expired = jwt.sign({ sub: first.sub, sid: first.sid }, process.env.JWT_SECRET!, { expiresIn: -1 });
    expect((await request(app).get('/api/v1/me').auth(expired, { type: 'bearer' })).status).toBe(401);
    const revoke = await request(app).delete(`/api/v1/me/sessions/${first.sid}`).auth(firstToken, { type: 'bearer' });
    expect(revoke.status).toBe(200);
    expect((await request(app).get('/api/v1/me').auth(firstToken, { type: 'bearer' })).status).toBe(401);
    expect((await request(app).get('/api/v1/me').auth(secondToken, { type: 'bearer' })).status).toBe(200);
    const legacy = jwt.sign({ sub: first.sub }, process.env.JWT_SECRET!, { expiresIn: '12h' });
    expect((await request(app).get('/api/v1/me').auth(legacy, { type: 'bearer' })).status).toBe(200);
    expect(store.state.audit.filter((entry) => entry.action === 'SESSION_REVOKED')).toHaveLength(1);
  });

  it('completes real TOTP setup/login and persists normalized backup-code consumption across new app instances', async () => {
    const store = memoryStore();
    const app = buildApp(store);
    const token = await register(app);
    const user = [...store.state.users.values()][0];
    const setup = await request(app).post('/api/v1/account/2fa/setup').auth(token, { type: 'bearer' });
    expect(setup.status).toBe(200);
    expect(setup.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(user.twoFactorSecret).toBe(setup.body.secret);
    expect(user.twoFactorEnabled).toBe(false);
    const invalidSetup = await request(app).post('/api/v1/account/2fa/verify').auth(token, { type: 'bearer' }).send({ code: 'NOPE-NOPE' });
    expect(invalidSetup.status).toBe(401);
    expect(user.twoFactorEnabled).toBe(false);
    const totp = () => speakeasy.totp({ secret: setup.body.secret, encoding: 'base32' });
    const verified = await request(app).post('/api/v1/account/2fa/verify').auth(token, { type: 'bearer' }).send({ code: totp() });
    expect(verified.status).toBe(200);
    expect(user.twoFactorEnabled).toBe(true);
    expect(verified.body.backupCodes).toHaveLength(8);
    expect(user.twoFactorBackupCodes).toHaveLength(8);
    for (let index = 0; index < 8; index++) {
      expect(bcrypt.getRounds(user.twoFactorBackupCodes[index])).toBe(10);
      expect(user.twoFactorBackupCodes[index]).not.toBe(verified.body.backupCodes[index]);
      expect(await bcrypt.compare(verified.body.backupCodes[index], user.twoFactorBackupCodes[index])).toBe(true);
    }
    const pending = await login(app);
    expect(pending.status).toBe(200);
    expect(pending.body.requires2fa).toBe(true);
    expect(pending.body.token).toBeUndefined();
    const pendingClaims = claims(pending.body.pendingToken);
    expect(pendingClaims.purpose).toBe('pending_2fa');
    expect(pendingClaims.exp! - pendingClaims.iat!).toBe(5 * 60);
    expect(pendingClaims.sid).toBeUndefined();
    expect(store.state.sessions.size).toBe(1);
    expect((await request(app).get('/api/v1/me').auth(pending.body.pendingToken, { type: 'bearer' })).status).toBe(401);
    const complete = (target: ReturnType<typeof buildApp>, code: string, pendingToken = pending.body.pendingToken) =>
      request(target).post('/api/v1/auth/login/2fa').send({ pendingToken, code });
    expect((await complete(app, 'NOPE-NOPE')).status).toBe(401);
    expect(store.state.sessions.size).toBe(1);
    expect((await complete(app, totp(), token)).status).toBe(401);
    const completedTotp = await complete(app, totp());
    expect(completedTotp.status).toBe(200);
    expect(claims(completedTotp.body.token).purpose).toBeUndefined();
    expect(user.twoFactorBackupCodes).toHaveLength(8);
    expect((await request(app).get('/api/v1/me').auth(completedTotp.body.token, { type: 'bearer' })).status).toBe(200);
    const consumedHash = user.twoFactorBackupCodes[0];
    const backup = await complete(app, `  ${verified.body.backupCodes[0].toLowerCase()}  `);
    expect(backup.status).toBe(200);
    expect(user.twoFactorBackupCodes).toHaveLength(7);
    expect(user.twoFactorBackupCodes).not.toContain(consumedHash);
    expect(store.state.audit.filter((entry) => entry.action === 'TWO_FACTOR_BACKUP_CODE_USED')).toHaveLength(1);
    // Reconstruct both routers from a persisted memory snapshot; a mocked
    // one-shot return value could not prove that the stored hash was removed.
    const restored = memoryStore(structuredClone(store.state));
    const refreshedApp = buildApp(restored);
    const beforeReplay = restored.state.sessions.size;
    const replay = await complete(refreshedApp, verified.body.backupCodes[0]);
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ error: 'Invalid authentication code' });
    expect(restored.state.sessions.size).toBe(beforeReplay);
    const disableWrong = await request(refreshedApp).post('/api/v1/account/2fa/disable')
      .auth(backup.body.token, { type: 'bearer' }).send({ code: 'NOPE-NOPE' });
    expect(disableWrong.status).toBe(401);
    const disable = await request(refreshedApp).post('/api/v1/account/2fa/disable')
      .auth(backup.body.token, { type: 'bearer' }).send({ code: verified.body.backupCodes[1] });
    expect(disable.status).toBe(200);
    expect(restored.state.users.get(user.id)).toMatchObject({
      twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [],
    });
    expect((await login(refreshedApp)).body.token).toEqual(expect.any(String));
  });
});
