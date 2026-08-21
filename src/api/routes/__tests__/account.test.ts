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
});
