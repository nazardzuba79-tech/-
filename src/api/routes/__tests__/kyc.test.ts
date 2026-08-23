process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { kycRouter } from '../kyc';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', kycRouter(prisma));
  return app;
}

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'kyc');

afterAll(() => {
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

const validFields = {
  country: 'UA',
  fullName: 'Іван Іванов',
  dateOfBirth: '1990-01-01',
  documentType: 'PASSPORT',
  documentNumber: 'AB123456',
};

function submitRequest(app: express.Express, userId: string, fields = validFields) {
  let req = request(app).post('/api/v1/kyc/submit').set('Authorization', authHeader(userId));
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  return req.attach('document', Buffer.from('fake-image-bytes'), { filename: 'passport.jpg', contentType: 'image/jpeg' });
}

describe('POST /kyc/submit', () => {
  it('creates a submission and sets the user to PENDING', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', kycStatus: 'NOT_STARTED' }),
        update: jest.fn(),
      },
      kycSubmission: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'PENDING' }),
      },
      auditLog: { create: jest.fn() },
    } as any;
    const app = buildApp(prisma);

    const res = await submitRequest(app, 'user-1');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'sub-1', status: 'PENDING' });
    expect(prisma.kycSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', country: 'UA', documentType: 'PASSPORT' }),
      })
    );
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { kycStatus: 'PENDING' } });
  });

  it('rejects when the document file is missing', async () => {
    const prisma = { user: { findUnique: jest.fn() } } as any;
    const app = buildApp(prisma);

    let req = request(app).post('/api/v1/kyc/submit').set('Authorization', authHeader('user-1'));
    for (const [key, value] of Object.entries(validFields)) req = req.field(key, value);
    const res = await req;

    expect(res.status).toBe(400);
  });

  it('rejects an unsupported file type', async () => {
    const prisma = { user: { findUnique: jest.fn() } } as any;
    const app = buildApp(prisma);

    let req = request(app).post('/api/v1/kyc/submit').set('Authorization', authHeader('user-1'));
    for (const [key, value] of Object.entries(validFields)) req = req.field(key, value);
    const res = await req.attach('document', Buffer.from('exe-bytes'), {
      filename: 'malware.exe',
      contentType: 'application/x-msdownload',
    });

    expect(res.status).toBe(400);
  });

  it('rejects an invalid country code', async () => {
    const prisma = { user: { findUnique: jest.fn() } } as any;
    const app = buildApp(prisma);

    const res = await submitRequest(app, 'user-1', { ...validFields, country: 'Ukraine' });

    expect(res.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('blocks resubmission when the user is already APPROVED', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', kycStatus: 'APPROVED' }) },
      kycSubmission: { findFirst: jest.fn() },
    } as any;
    const app = buildApp(prisma);

    const res = await submitRequest(app, 'user-1');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already verified/i);
  });

  it('blocks a second submission while one is already pending', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', kycStatus: 'PENDING' }) },
      kycSubmission: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
    } as any;
    const app = buildApp(prisma);

    const res = await submitRequest(app, 'user-1');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already pending/i);
  });
});

describe('GET /kyc/me', () => {
  it('returns the current status and latest submission', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ kycStatus: 'REJECTED' }) },
      kycSubmission: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sub-1',
          country: 'UA',
          fullName: 'Іван Іванов',
          documentType: 'PASSPORT',
          status: 'REJECTED',
          rejectionReason: 'Blurry photo',
          createdAt: new Date('2026-01-01'),
        }),
      },
    } as any;
    const app = buildApp(prisma);

    const res = await request(app).get('/api/v1/kyc/me').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body.kycStatus).toBe('REJECTED');
    expect(res.body.latestSubmission.rejectionReason).toBe('Blurry photo');
  });
});

describe('admin-only KYC routes', () => {
  it('POST /kyc/:id/review requires an admin account', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } } as any;
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/kyc/sub-1/review')
      .set('Authorization', authHeader('user-1'))
      .send({ approve: true });

    expect(res.status).toBe(403);
  });

  it('POST /kyc/:id/review approves a submission for an admin', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
        update: jest.fn(),
      },
      kycSubmission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', userId: 'user-1', status: 'PENDING' }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    } as any;
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/kyc/sub-1/review')
      .set('Authorization', authHeader('admin-1'))
      .send({ approve: true });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { kycStatus: 'APPROVED' } });
  });

  it('POST /kyc/:id/review rejects with a reason', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }), update: jest.fn() },
      kycSubmission: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', userId: 'user-1', status: 'PENDING' }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    } as any;
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/kyc/sub-1/review')
      .set('Authorization', authHeader('admin-1'))
      .send({ approve: false, reason: 'Document expired' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
    expect(prisma.kycSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Document expired' }) })
    );
  });

  it('POST /kyc/:id/review refuses to re-review an already-decided submission', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
      kycSubmission: { findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'APPROVED' }) },
    } as any;
    const app = buildApp(prisma);

    const res = await request(app)
      .post('/api/v1/kyc/sub-1/review')
      .set('Authorization', authHeader('admin-1'))
      .send({ approve: true });

    expect(res.status).toBe(400);
  });
});
