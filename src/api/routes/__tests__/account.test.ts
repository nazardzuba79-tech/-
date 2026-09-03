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
  // Mirrors src/index.ts's parser order — the avatar route's wider body
  // limit only applies because it is mounted ahead of the global parser,
  // so a test app without it would 413 before reaching the route.
  app.use('/api/v1/me/avatar', express.json({ limit: '1mb' }));
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

    it('includes displayName when set on the account', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'voltex.crypto@gmail.com',
            displayName: 'Ксения',
            isAdmin: true,
            kycStatus: 'NOT_STARTED',
            twoFactorEnabled: false,
            createdAt: new Date('2026-01-01'),
          }),
        },
      } as any;
      const app = buildApp(prisma);

      const res = await request(app).get('/api/v1/me').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Ксения');
    });

    it('requires authentication', async () => {
      const app = buildApp({ user: { findUnique: jest.fn() } } as any);
      const res = await request(app).get('/api/v1/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /me/password', () => {
    it('changes the password when the current password is correct', async () => {
      const currentHash = await bcrypt.hash('Correcthorsebattery', 12);
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
        .send({ currentPassword: 'Correcthorsebattery', newPassword: 'newlongenoughpassword' });

      expect(res.status).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } })
      );
    });

    it('rejects an incorrect current password', async () => {
      const currentHash = await bcrypt.hash('Correcthorsebattery', 12);
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

  describe('PATCH /me/profile', () => {
    it('updates name, phone, and country', async () => {
      const updateMock = jest.fn().mockResolvedValue({ displayName: 'Ксения', phone: '+7 900 123-45-67', country: 'RU' });
      const prisma = { user: { update: updateMock } } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .patch('/api/v1/me/profile')
        .set('Authorization', authHeader('user-1'))
        .send({ displayName: 'Ксения', phone: '+7 900 123-45-67', country: 'RU' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ displayName: 'Ксения', phone: '+7 900 123-45-67', country: 'RU' });
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { displayName: 'Ксения', phone: '+7 900 123-45-67', country: 'RU' },
      });
    });

    it('accepts a partial update (only one field)', async () => {
      const updateMock = jest.fn().mockResolvedValue({ displayName: 'Ксения', phone: null, country: null });
      const prisma = { user: { update: updateMock } } as any;
      const app = buildApp(prisma);

      const res = await request(app)
        .patch('/api/v1/me/profile')
        .set('Authorization', authHeader('user-1'))
        .send({ displayName: 'Ксения' });

      expect(res.status).toBe(200);
      expect(updateMock).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { displayName: 'Ксения' } });
    });

    it('rejects a name over 80 characters', async () => {
      const updateMock = jest.fn();
      const app = buildApp({ user: { update: updateMock } } as any);

      const res = await request(app)
        .patch('/api/v1/me/profile')
        .set('Authorization', authHeader('user-1'))
        .send({ displayName: 'x'.repeat(81) });

      expect(res.status).toBe(400);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('requires authentication', async () => {
      const app = buildApp({ user: { update: jest.fn() } } as any);
      const res = await request(app).patch('/api/v1/me/profile').send({ displayName: 'Ксения' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /account/security-log', () => {
    it('returns only this account\'s security-relevant audit entries, newest first', async () => {
      const entries = [
        { id: 'log-2', userId: 'user-1', action: 'USER_LOGGED_IN', metadata: { ip: '1.2.3.4', userAgent: 'Chrome' }, createdAt: new Date('2026-02-01') },
        { id: 'log-1', userId: 'user-1', action: 'PASSWORD_CHANGED', metadata: {}, createdAt: new Date('2026-01-01') },
      ];
      const findManyMock = jest.fn().mockResolvedValue(entries);
      const prisma = { auditLog: { findMany: findManyMock } } as any;
      const app = buildApp(prisma);

      const res = await request(app).get('/api/v1/account/security-log').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].action).toBe('USER_LOGGED_IN');
      expect(res.body[0].metadata).toEqual({ ip: '1.2.3.4', userAgent: 'Chrome' });
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('requires authentication', async () => {
      const app = buildApp({ auditLog: { findMany: jest.fn() } } as any);
      const res = await request(app).get('/api/v1/account/security-log');
      expect(res.status).toBe(401);
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

  describe('avatar', () => {
    // Smallest valid images of each accepted type, so the signature check
    // below is exercised against real bytes rather than a stub.
    const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const pngDataUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

    function prismaWithUpdate() {
      return {
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
          update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'user-1', ...data })),
        },
      } as any;
    }

    it('PUT /me/avatar stores a valid image and returns it', async () => {
      const prisma = prismaWithUpdate();
      const app = buildApp(prisma);

      const res = await request(app)
        .put('/api/v1/me/avatar')
        .set('Authorization', authHeader('user-1'))
        .send({ image: pngDataUrl });

      expect(res.status).toBe(200);
      expect(res.body.avatarUrl).toBe(pngDataUrl);
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { avatarUrl: pngDataUrl } });
    });

    it('PUT /me/avatar rejects a non-data-URL string', async () => {
      const prisma = prismaWithUpdate();
      const res = await request(buildApp(prisma))
        .put('/api/v1/me/avatar')
        .set('Authorization', authHeader('user-1'))
        .send({ image: 'https://example.com/photo.png' });

      expect(res.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('PUT /me/avatar rejects content whose bytes do not match the declared type', async () => {
      const prisma = prismaWithUpdate();
      const notAnImage = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;

      const res = await request(buildApp(prisma))
        .put('/api/v1/me/avatar')
        .set('Authorization', authHeader('user-1'))
        .send({ image: notAnImage });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/does not look like/);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('PUT /me/avatar rejects an image over the size cap', async () => {
      const prisma = prismaWithUpdate();
      const huge = Buffer.concat([PNG_BYTES, Buffer.alloc(600 * 1024)]);

      const res = await request(buildApp(prisma))
        .put('/api/v1/me/avatar')
        .set('Authorization', authHeader('user-1'))
        .send({ image: `data:image/png;base64,${huge.toString('base64')}` });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/too large/);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('PUT /me/avatar requires authentication', async () => {
      const prisma = prismaWithUpdate();
      const res = await request(buildApp(prisma)).put('/api/v1/me/avatar').send({ image: pngDataUrl });

      expect(res.status).toBe(401);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('DELETE /me/avatar clears the stored photo', async () => {
      const prisma = prismaWithUpdate();
      const res = await request(buildApp(prisma))
        .delete('/api/v1/me/avatar')
        .set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.avatarUrl).toBeNull();
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { avatarUrl: null } });
    });
  });

});
