process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.REGISTRATION_OPEN = 'true';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { authRouter } from '../auth';
import { generateBackupCodes } from '../../../services/TwoFactorService';

function makePrismaMock(overrides: Partial<any> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'user-1', ...data })),
      ...overrides.user,
    },
    auditLog: { create: jest.fn() },
  } as any;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', authRouter(prisma));
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

  it('registers a new user and returns a token', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@team.com', password: 'correcthorsebattery' });

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(prisma.user.create).toHaveBeenCalled();
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
      .send({ email: 'alice@team.com', password: 'correcthorsebattery' });

    expect(res.status).toBe(400);
  });

  it('blocks registration when REGISTRATION_OPEN=false', async () => {
    process.env.REGISTRATION_OPEN = 'false';
    const prisma = makePrismaMock();
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'bob@team.com', password: 'correcthorsebattery' });

    expect(res.status).toBe(403);
  });

  it('logs in with correct credentials', async () => {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('correcthorsebattery', 12);
    const prisma = makePrismaMock({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'alice@team.com', passwordHash }) },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@team.com', password: 'correcthorsebattery' });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('rejects login with wrong password', async () => {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('correcthorsebattery', 12);
    const prisma = makePrismaMock({
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'alice@team.com', passwordHash }) },
    });
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@team.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
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
      const passwordHash = await bcrypt.hash('correcthorsebattery', 12);
      const { base32 } = speakeasy.generateSecret({ length: 20 });
      const { hashed } = await generateBackupCodes();
      return {
        id: 'user-1',
        email: 'alice@team.com',
        passwordHash,
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
        .send({ email: user.email, password: 'correcthorsebattery' });

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
        .send({ email: user.email, password: 'correcthorsebattery' });
      const code = speakeasy.totp({ secret: user.twoFactorSecret, encoding: 'base32' });

      const res = await request(app)
        .post('/api/v1/auth/login/2fa')
        .send({ pendingToken: loginRes.body.pendingToken, code });

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
    });

    it('rejects a wrong 2FA code', async () => {
      const user = await makeTwoFactorUser();
      const prisma = makePrismaMock({ user: { findUnique: jest.fn().mockResolvedValue(user) } });
      const app = buildApp(prisma);

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'correcthorsebattery' });

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
        .send({ email: user.email, password: 'correcthorsebattery' });

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
