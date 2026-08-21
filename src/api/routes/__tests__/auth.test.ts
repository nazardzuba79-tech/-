process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.REGISTRATION_OPEN = 'true';

import request from 'supertest';
import express from 'express';
import { authRouter } from '../auth';

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
});
