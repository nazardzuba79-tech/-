process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.REGISTRATION_OPEN = 'true';

import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { authRouter } from '../auth';
import { generateBackupCodes } from '../../../services/TwoFactorService';

function makePrismaMock(overrides: Partial<any> = {}) {
  const base: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'user-1', ...data })),
      // The country backfill writes through updateMany, guarded on country: null.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...overrides.user,
    },
    auditLog: { create: jest.fn() },
    session: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'session-1', ...data })),
      ...overrides.session,
    },
    // Deliberately NO emailVerificationChallenge delegate. Mandatory email
    // verification is gone, so any code that still tried to write a challenge
    // would fail loudly here rather than passing silently against a stub.
    $transaction: jest.fn().mockImplementation((fn: any) => fn(base)),
  };
  return base as any;
}

const passThrough = (_req: any, _res: any, next: any) => next();

function buildApp(prisma: any, countryDetection?: any) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    authRouter(prisma, {
      limiters: { register: passThrough, login: passThrough },
      // Default: a detector that never finds anything, so the existing tests
      // exercise registration without any country machinery running.
      countryDetection: countryDetection ?? { detect: async () => null },
    })
  );
  return app;
}

/** Lets a test wait for the fire-and-forget backfill to finish. */
const flush = () => new Promise((r) => setImmediate(r));

/** A real session token, as requireAuth would see it. */
function decodeSession(token: string) {
  return jwt.verify(token, process.env.JWT_SECRET!) as { sub: string; sid: string; purpose?: string };
}

describe('auth routes', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret-at-least-this-long', REGISTRATION_OPEN: 'true' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('registers a new user and returns a real session token straight away', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalled();
    expect(typeof res.body.token).toBe('string');

    // A token requireAuth would accept: the account's id, a session id, and
    // no `purpose` claim (that marks the short-lived pending-2FA token).
    const payload = decodeSession(res.body.token);
    expect(payload.sub).toBe('user-1');
    expect(payload.sid).toBe('session-1');
    expect(payload.purpose).toBeUndefined();
  });

  it('creates a real Session row for the new account', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1' }) })
    );
  });

  it('answers with the token alone — no verification fields survive', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    expect(Object.keys(res.body)).toEqual(['token']);
    for (const gone of [
      'verificationRequired',
      'challengeId',
      'maskedEmail',
      'expiresInSeconds',
      'resendAvailableInSeconds',
      'emailDelivered',
    ]) {
      expect(res.body[gone]).toBeUndefined();
    }
  });

  it('creates no email-verification challenge', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    // The mock has no emailVerificationChallenge delegate at all, so a
    // surviving write would have thrown a 500 rather than reaching here.
    expect(res.status).toBe(201);
    expect(prisma.emailVerificationChallenge).toBeUndefined();
  });

  it('leaves emailVerifiedAt unset rather than claiming a verification that never happened', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@team.com', password: 'Correcthorsebattery' });

    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.emailVerifiedAt).toBeUndefined();
  });

  it('registers with no SMTP transport configured at all', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.VERIFICATION_FROM_EMAIL;
    delete process.env.EMAIL_VERIFICATION_SECRET;

    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'nomail@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
  });

  it('stores the referral link when a valid code is supplied', async () => {
    const referrer = { id: 'ref-1', email: 'ref@team.com', referralCode: 'VLTX1234' };
    const prisma = makePrismaMock({
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where.referralCode === 'VLTX1234' ? referrer : null)
        ),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'user-1', ...data })),
      },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'invited@team.com', password: 'Correcthorsebattery', ref: 'vltx1234' });

    expect(res.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ referredById: 'ref-1' }) })
    );
  });

  it('ignores an unknown referral code instead of failing the signup', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'invited@team.com', password: 'Correcthorsebattery', ref: 'NOSUCH99' });

    expect(res.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ referredById: undefined }) })
    );
  });

  it('asks for nothing but an email and a password', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    // No confirm, no phone, no country, no referral, no terms acceptance,
    // no verification code — exactly what the form now collects.
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'minimal@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');

    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.phone).toBeUndefined();
    expect(created.country).toBeUndefined();
  });

  it('enforces the same password rule the form does: 10+ chars, one uppercase', async () => {
    const app = buildApp(makePrismaMock());

    const short = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'a@team.com', password: 'Short1' });
    expect(short.status).toBe(400);

    const noUpper = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'b@team.com', password: 'alllowercaseletters' });
    expect(noUpper.status).toBe(400);

    const ok = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'c@team.com', password: 'Exactlyten1' });
    expect(ok.status).toBe(201);
  });

  describe('best-effort country', () => {
    it('fills an empty country after a successful registration', async () => {
      const prisma = makePrismaMock();
      const app = buildApp(prisma, { detect: async () => 'PL' });

      await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'geo@team.com', password: 'Correcthorsebattery' });
      await flush();

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        // Guarded on country: null — this is what makes it impossible to
        // overwrite a country the user chose, even under a race.
        where: { id: 'user-1', country: null },
        data: { country: 'PL' },
      });
    });

    it('writes nothing when detection comes back empty', async () => {
      const prisma = makePrismaMock();
      const app = buildApp(prisma, { detect: async () => null });

      await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'nogeo@team.com', password: 'Correcthorsebattery' });
      await flush();

      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('does not fail the registration when detection throws', async () => {
      const prisma = makePrismaMock();
      const app = buildApp(prisma, {
        detect: async () => {
          throw new Error('geoip provider unreachable');
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'broken@team.com', password: 'Correcthorsebattery' });
      await flush();

      expect(res.status).toBe(201);
      expect(typeof res.body.token).toBe('string');
    });

    it('never re-detects for a user who already has a country', async () => {
      const passwordHash = await bcrypt.hash('Correcthorsebattery', 4);
      const detect = jest.fn(async () => 'FR');
      const prisma = makePrismaMock({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'settled@team.com',
            passwordHash,
            country: 'UA', // the user's own saved choice
            blockedAt: null,
            twoFactorEnabled: false,
          }),
          updateMany: jest.fn(),
        },
      });
      const app = buildApp(prisma, { detect });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'settled@team.com', password: 'Correcthorsebattery' });
      await flush();

      expect(res.status).toBe(200);
      expect(detect).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('fills a country on login for an account that predates detection', async () => {
      const passwordHash = await bcrypt.hash('Correcthorsebattery', 4);
      const prisma = makePrismaMock({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'legacy@team.com',
            passwordHash,
            country: null,
            blockedAt: null,
            twoFactorEnabled: false,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      const app = buildApp(prisma, { detect: async () => 'DE' });

      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'legacy@team.com', password: 'Correcthorsebattery' });
      await flush();

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', country: null },
        data: { country: 'DE' },
      });
    });

    it('does not block a login when detection hangs or fails', async () => {
      const passwordHash = await bcrypt.hash('Correcthorsebattery', 4);
      const prisma = makePrismaMock({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'slow@team.com',
            passwordHash,
            country: null,
            blockedAt: null,
            twoFactorEnabled: false,
          }),
          updateMany: jest.fn(),
        },
      });
      const app = buildApp(prisma, {
        detect: async () => {
          throw new Error('lookup timed out');
        },
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'slow@team.com', password: 'Correcthorsebattery' });
      await flush();

      expect(res.status).toBe(200);
      expect(typeof res.body.token).toBe('string');
    });

    it('stores only a country code — never a KYC or verification claim', async () => {
      const prisma = makePrismaMock();
      const app = buildApp(prisma, { detect: async () => 'IT' });

      await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'kyc@team.com', password: 'Correcthorsebattery' });
      await flush();

      const written = prisma.user.updateMany.mock.calls[0][0].data;
      expect(Object.keys(written)).toEqual(['country']);
      expect(written.country).toBe('IT');
      // Nothing here touches KYC status or claims the address was verified.
      expect(written).not.toHaveProperty('kycStatus');
      expect(written).not.toHaveProperty('emailVerifiedAt');
    });
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

  it('logs in an account whose emailVerifiedAt is null', async () => {
    // Exactly the shape registration now leaves behind. Before this change
    // the same row was refused a session with EMAIL_VERIFICATION_REQUIRED.
    const passwordHash = await bcrypt.hash('Correcthorsebattery', 4);
    const prisma = makePrismaMock({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'newer@team.com',
          passwordHash,
          emailVerifiedAt: null,
          blockedAt: null,
          twoFactorEnabled: false,
        }),
      },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'newer@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.code).toBeUndefined();
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'USER_LOGGED_IN' }) })
    );
  });

  it('still refuses a blocked account whose emailVerifiedAt is null', async () => {
    const passwordHash = await bcrypt.hash('Correcthorsebattery', 4);
    const prisma = makePrismaMock({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'blocked@team.com',
          passwordHash,
          emailVerifiedAt: null,
          blockedAt: new Date(),
          blockedReason: 'fraud review',
          twoFactorEnabled: false,
        }),
      },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'blocked@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(403);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('still requires 2FA for an account whose emailVerifiedAt is null', async () => {
    const passwordHash = await bcrypt.hash('Correcthorsebattery', 4);
    const prisma = makePrismaMock({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'twofa@team.com',
          passwordHash,
          emailVerifiedAt: null,
          blockedAt: null,
          twoFactorEnabled: true,
        }),
      },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'twofa@team.com', password: 'Correcthorsebattery' });

    expect(res.status).toBe(200);
    expect(res.body.requires2fa).toBe(true);
    expect(res.body.token).toBeUndefined();
    expect(prisma.session.create).not.toHaveBeenCalled();
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

  it('no longer exposes the email-verification routes', async () => {
    const app = buildApp(makePrismaMock());

    const verify = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ challengeId: '00000000-0000-4000-8000-000000000001', code: '123456' });
    const resend = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ challengeId: '00000000-0000-4000-8000-000000000001' });

    expect(verify.status).toBe(404);
    expect(resend.status).toBe(404);
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
