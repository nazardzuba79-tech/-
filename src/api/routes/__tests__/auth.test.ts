process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.REGISTRATION_OPEN = 'true';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { authRouter } from '../auth';
import { generateBackupCodes } from '../../../services/TwoFactorService';

function makePrismaMock(overrides: Partial<any> = {}) {
  const base: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'user-1', ...data })),
      ...overrides.user,
    },
    auditLog: { create: jest.fn() },
    session: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'session-1', ...data })),
      ...overrides.session,
    },
    // Registration now issues a verification challenge before any session.
    emailVerificationChallenge: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: '00000000-0000-4000-8000-000000000001', attempts: 0, consumedAt: null, ...data })
        ),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      ...overrides.emailVerificationChallenge,
    },
    $transaction: jest.fn().mockImplementation((fn: any) => fn(base)),
  };
  return base as any;
}

/** Captures the code instead of mailing it; never a real relay in tests. */
function stubMailer() {
  const sent: { to: string; code: string }[] = [];
  return {
    sent,
    isConfigured: true,
    send: jest.fn(async (input: any) => {
      sent.push({ to: input.to, code: input.code });
      return true;
    }),
  } as any;
}

const passThrough = (_req: any, _res: any, next: any) => next();

function buildApp(prisma: any, mailer: any = stubMailer()) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    authRouter(prisma, {
      verificationEmail: mailer,
      limiters: {
        register: passThrough,
        verifyEmail: passThrough,
        resendVerification: passThrough,
        login: passThrough,
      },
    })
  );
  return app;
}

describe('auth routes', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret-at-least-this-long', REGISTRATION_OPEN: 'true' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('registers a new user and returns a verification challenge, not a session', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(201);
    // The session comes from /auth/verify-email now, never from register.
    expect(res.body.token).toBeUndefined();
    expect(res.body).toMatchObject({ verificationRequired: true });
    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it('registers everyone else as a plain USER', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    await request(app).post('/api/v1/auth/register').send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'USER' }) })
    );
  });

  it('assigns ADMIN automatically to exactly the one designated admin email', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'voltex.crypto@gmail.com', password: 'Correcthorsebattery' });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN' }) })
    );
  });

  it('matches the admin email case-insensitively', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'Voltex.Crypto@Gmail.com', password: 'Correcthorsebattery' });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN' }) })
    );
  });

  it('records the registration IP and user agent on the audit log', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    await request(app)
      .post('/api/v1/auth/register')
      .set('User-Agent', 'test-agent/1.0')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'USER_REGISTERED',
          metadata: expect.objectContaining({ userAgent: 'test-agent/1.0' }),
        }),
      })
    );
  });

  it('rejects registration with a weak password', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@team.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects registration when the email is already taken', async () => {
    const prisma = makePrismaMock({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'existing', email: 'alice@team.com' }) },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(400);
  });

  it('blocks registration when REGISTRATION_OPEN=false', async () => {
    process.env.REGISTRATION_OPEN = 'false';
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'bob@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(403);
  });

  it('logs in with correct credentials', async () => {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('Correcthorsebattery', 12);
    const prisma = makePrismaMock({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'alice@team.com', passwordHash, emailVerifiedAt: new Date('2026-01-01') }) },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', action: 'USER_LOGGED_IN' }) })
    );
  });

  it('rejects login with wrong password', async () => {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('Correcthorsebattery', 12);
    const prisma = makePrismaMock({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'alice@team.com', passwordHash, emailVerifiedAt: new Date('2026-01-01') }) },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@team.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('rejects login for a blocked account, even with the correct password', async () => {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('Correcthorsebattery', 12);
    const prisma = makePrismaMock({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', email: 'alice@team.com', passwordHash, blockedAt: new Date(), blockedReason: 'Нарушение правил' }),
      },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Нарушение правил');
  });

  it('rejects login for a nonexistent user without revealing that', async () => {
    const prisma = makePrismaMock(); // findUnique resolves null
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@team.com', password: 'whatever12345' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  describe('2FA-enabled login', () => {
    async function makeTwoFactorUser() {
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash('Correcthorsebattery', 12);
      const { base32 } = speakeasy.generateSecret({ length: 20 });
      const { hashed } = await generateBackupCodes();
      return {
        id: 'user-1',
        email: 'alice@team.com',
        passwordHash,
        // Predates verification, exactly as the migration's backfill leaves
        // every account that existed before the feature.
        emailVerifiedAt: new Date('2026-01-01'),
        twoFactorEnabled: true,
        twoFactorSecret: base32,
        twoFactorBackupCodes: hashed,
      };
    }

    it('returns a pending token instead of a session token when 2FA is on', async () => {
      const user = await makeTwoFactorUser();
      const prisma = makePrismaMock({ user: { findUnique: jest.fn().mockResolvedValue(user) } });
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'Correcthorsebattery' });

      expect(res.status).toBe(200);
      expect(res.body.requires2fa).toBe(true);
      expect(res.body.token).toBeUndefined();
      expect(res.body.pendingToken).toEqual(expect.any(String));
    });

    it('exchanges a valid pending token + TOTP code for a real session token', async () => {
      const user = await makeTwoFactorUser();
      const prisma = makePrismaMock({ user: { findUnique: jest.fn().mockResolvedValue(user) } });
      const app = buildApp(prisma);

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'Correcthorsebattery' });
      const code = speakeasy.totp({ secret: user.twoFactorSecret, encoding: 'base32' });

      const res = await request(app)
        .post('/api/v1/auth/login/2fa')
        .send({ pendingToken: loginRes.body.pendingToken, code });

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', action: 'USER_LOGGED_IN' }) })
      );
    });

    it('rejects a wrong 2FA code', async () => {
      const user = await makeTwoFactorUser();
      const prisma = makePrismaMock({ user: { findUnique: jest.fn().mockResolvedValue(user) } });
      const app = buildApp(prisma);

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'Correcthorsebattery' });

      const res = await request(app)
        .post('/api/v1/auth/login/2fa')
        .send({ pendingToken: loginRes.body.pendingToken, code: '000000' });

      expect(res.status).toBe(401);
    });

    it('rejects a regular session token used as a pending token', async () => {
      const user = await makeTwoFactorUser();
      const prisma = makePrismaMock({ user: { findUnique: jest.fn().mockResolvedValue(user) } });
      const app = buildApp(prisma);
      const code = speakeasy.totp({ secret: user.twoFactorSecret, encoding: 'base32' });

      // A full session token has no `purpose` claim — the 2FA endpoint must
      // not accept it as a stand-in for a pending-login token.
      const sessionToken = jwt.sign({ sub: user.id }, process.env.JWT_SECRET!);

      const res = await request(app)
        .post('/api/v1/auth/login/2fa')
        .send({ pendingToken: sessionToken, code });

      expect(res.status).toBe(401);
    });

    it('consumes a backup code and removes it from the user record', async () => {
      const user = await makeTwoFactorUser();
      const { plaintext } = await (async () => {
        // Re-derive the plaintext codes paired to user.twoFactorBackupCodes
        // isn't possible from hashes alone, so build a fresh matched pair.
        const pair = await generateBackupCodes();
        user.twoFactorBackupCodes = pair.hashed;
        return pair;
      })();
      const updateMock = jest.fn();
      const prisma = makePrismaMock({
        user: { findUnique: jest.fn().mockResolvedValue(user), update: updateMock },
      });
      const app = buildApp(prisma);

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'Correcthorsebattery' });

      const res = await request(app)
        .post('/api/v1/auth/login/2fa')
        .send({ pendingToken: loginRes.body.pendingToken, code: plaintext[2] });

      expect(res.status).toBe(200);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ twoFactorBackupCodes: expect.any(Array) }) })
      );
      expect(updateMock.mock.calls[0][0].data.twoFactorBackupCodes).toHaveLength(7);
    });
  });
});
