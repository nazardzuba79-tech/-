process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { accountRouter } from '../account';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', accountRouter(prisma));
  return app;
}

describe('account routes', () => {
  describe('GET /me', () => {
    it('returns the authenticated user profile', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'alice@team.com',
            isAdmin: false,
            kycStatus: 'NOT_STARTED',
            twoFactorEnabled: false,
            createdAt: new Date('2026-01-01'),
          }),
        },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app).get('/api/v1/me').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('alice@team.com');
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('requires authentication', async () => {
      const app = buildApp({ user: { findUnique: jest.fn() } } as any);
      const res = await request(app).get('/api/v1/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /me/password', () => {
    it('changes the password when the current password is correct', async () => {
      const currentHash = await bcrypt.hash('correcthorsebattery', 12);
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: 'user-1', passwordHash: currentHash }),
          update: jest.fn().mockResolvedValue({}),
        },
        auditLog: { create: jest.fn() },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .patch('/api/v1/me/password')
        .set('Authorization', authHeader('user-1'))
        .send({ currentPassword: 'correcthorsebattery', newPassword: 'newlongenoughpassword' });

      expect(res.status).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } })
      );
    });

    it('rejects an incorrect current password', async () => {
      const currentHash = await bcrypt.hash('correcthorsebattery', 12);
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', passwordHash: currentHash }), update: jest.fn() },
        auditLog: { create: jest.fn() },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .patch('/api/v1/me/password')
        .set('Authorization', authHeader('user-1'))
        .send({ currentPassword: 'wrongpassword', newPassword: 'newlongenoughpassword' });

      expect(res.status).toBe(401);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a new password shorter than 10 characters', async () => {
      const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .patch('/api/v1/me/password')
        .set('Authorization', authHeader('user-1'))
        .send({ currentPassword: 'whatever', newPassword: 'short' });

      expect(res.status).toBe(400);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('POST /account/2fa/setup', () => {
    it('generates a secret, stores it, and returns a QR code', async () => {
      const updateMock = jest.fn().mockResolvedValue({});
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'alice@team.com', twoFactorEnabled: false }),
          update: updateMock,
        },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app).post('/api/v1/account/2fa/setup').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.secret).toEqual(expect.any(String));
      expect(res.body.otpauthUrl).toContain('otpauth://');
      expect(res.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: { twoFactorSecret: res.body.secret } })
      );
    });

    it('refuses to restart setup once 2FA is already enabled', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'alice@team.com', twoFactorEnabled: true }), update: jest.fn() },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app).post('/api/v1/account/2fa/setup').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('POST /account/2fa/verify', () => {
    it('enables 2FA and returns backup codes when the code is correct', async () => {
      const speakeasy = require('speakeasy');
      const secret = speakeasy.generateSecret({ length: 20 });
      const code = speakeasy.totp({ secret: secret.base32, encoding: 'base32' });
      const updateMock = jest.fn().mockResolvedValue({});
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            twoFactorEnabled: false,
            twoFactorSecret: secret.base32,
          }),
          update: updateMock,
        },
        auditLog: { create: jest.fn() },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/account/2fa/verify')
        .set('Authorization', authHeader('user-1'))
        .send({ code });

      expect(res.status).toBe(200);
      expect(res.body.backupCodes).toHaveLength(8);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ twoFactorEnabled: true }) })
      );
    });

    it('rejects an incorrect code and leaves 2FA disabled', async () => {
      const speakeasy = require('speakeasy');
      const secret = speakeasy.generateSecret({ length: 20 });
      const updateMock = jest.fn();
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: 'user-1', twoFactorEnabled: false, twoFactorSecret: secret.base32 }),
          update: updateMock,
        },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/account/2fa/verify')
        .set('Authorization', authHeader('user-1'))
        .send({ code: '000000' });

      expect(res.status).toBe(401);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('requires /2fa/setup to have run first', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', twoFactorEnabled: false, twoFactorSecret: null }), update: jest.fn() },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/account/2fa/verify')
        .set('Authorization', authHeader('user-1'))
        .send({ code: '123456' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /account/2fa/disable', () => {
    it('disables 2FA and clears the secret + backup codes when the code is correct', async () => {
      const speakeasy = require('speakeasy');
      const secret = speakeasy.generateSecret({ length: 20 });
      const code = speakeasy.totp({ secret: secret.base32, encoding: 'base32' });
      const updateMock = jest.fn().mockResolvedValue({});
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            twoFactorEnabled: true,
            twoFactorSecret: secret.base32,
            twoFactorBackupCodes: [],
          }),
          update: updateMock,
        },
        auditLog: { create: jest.fn() },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/account/2fa/disable')
        .set('Authorization', authHeader('user-1'))
        .send({ code });

      expect(res.status).toBe(200);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
        })
      );
    });

    it('rejects disabling with a wrong code', async () => {
      const speakeasy = require('speakeasy');
      const secret = speakeasy.generateSecret({ length: 20 });
      const updateMock = jest.fn();
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            twoFactorEnabled: true,
            twoFactorSecret: secret.base32,
            twoFactorBackupCodes: [],
          }),
          update: updateMock,
        },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/account/2fa/disable')
        .set('Authorization', authHeader('user-1'))
        .send({ code: '000000' });

      expect(res.status).toBe(401);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('refuses when 2FA is not currently enabled', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', twoFactorEnabled: false }), update: jest.fn() },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/account/2fa/disable')
        .set('Authorization', authHeader('user-1'))
        .send({ code: '123456' });

      expect(res.status).toBe(400);
    });
  });
});
