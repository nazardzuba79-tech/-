process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.EMAIL_VERIFICATION_SECRET = 'test-verification-secret-value';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { authRouter } from '../auth';
import { EmailVerificationService } from '../../../services/EmailVerificationService';

/**
 * End-to-end over the HTTP contract: what /auth/register, /auth/verify-email,
 * /auth/resend-verification and /auth/login actually return, with the mailer
 * injected so nothing tries to reach a relay.
 *
 * The point most of these guard is a single one: no session token exists
 * before the code is checked server-side.
 */

/** Records what would have been emailed, and can be told to fail. */
function fakeMailer(opts: { deliver?: boolean } = {}) {
  const sent: { to: string; code: string }[] = [];
  return {
    sent,
    isConfigured: true,
    send: jest.fn(async (input: { to: string; code: string; expiryMinutes: number }) => {
      if (opts.deliver === false) return false;
      sent.push({ to: input.to, code: input.code });
      return true;
    }),
  } as any;
}

/** Minimal prisma double: real enough for the routes, in-memory. */
function fakePrisma(seedUsers: any[] = []) {
  const users = new Map<string, any>();
  const byEmail = new Map<string, any>();
  const challenges = new Map<string, any>();
  const audit: any[] = [];
  let seq = 0;

  for (const u of seedUsers) {
    users.set(u.id, u);
    byEmail.set(u.email, u);
  }

  const tx: any = {
    emailVerificationChallenge: {
      deleteMany: jest.fn(async ({ where }: any) => {
        for (const [id, c] of challenges) if (c.userId === where.userId) challenges.delete(id);
        return { count: 0 };
      }),
      create: jest.fn(async ({ data }: any) => {
        // uuid-shaped, because the route validates the id with z.string().uuid()
        const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
        const row = { id, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
        challenges.set(id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where, include }: any) => {
        const row = challenges.get(where.id);
        if (!row) return null;
        return include?.user ? { ...row, user: users.get(row.userId) } : { ...row };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = challenges.get(where.id);
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
        if (data.consumedAt !== undefined) row.consumedAt = data.consumedAt;
        return { ...row };
      }),
    },
    user: {
      update: jest.fn(async ({ where, data }: any) => {
        const row = users.get(where.id);
        Object.assign(row, data);
        return row;
      }),
    },
  };

  const prisma: any = {
    ...tx,
    user: {
      ...tx.user,
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.email) return byEmail.get(where.email) ?? null;
        if (where.referralCode) {
          for (const u of users.values()) if (u.referralCode === where.referralCode) return u;
          return null;
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `user-${++seq}`, emailVerifiedAt: null, blockedAt: null, twoFactorEnabled: false, ...data };
        users.set(row.id, row);
        byEmail.set(row.email, row);
        return row;
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { audit.push(data); return data; }) },
    session: { create: jest.fn(async ({ data }: any) => ({ id: `session-${++seq}`, ...data })) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    __users: users,
    __challenges: challenges,
    __audit: audit,
  };
  return prisma;
}

/** Pass-through in place of the module-level limiters, whose counters are
 *  shared across every case in this file. Throttling gets its own test
 *  below, against the real limiter. */
const noLimit = (_req: any, _res: any, next: any) => next();

function buildApp(prisma: any, mailer: any, opts: { realLimiters?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    authRouter(prisma, {
      emailVerification: new EmailVerificationService(prisma),
      verificationEmail: mailer,
      ...(opts.realLimiters
        ? {}
        : {
            limiters: {
              register: noLimit,
              verifyEmail: noLimit,
              resendVerification: noLimit,
              login: noLimit,
            },
          }),
    })
  );
  return app;
}

const GOOD = { email: 'new@example.com', password: 'CorrectHorse1' };

describe('POST /auth/register', () => {
  it('creates an unverified user and issues NO session token', async () => {
    const prisma = fakePrisma();
    const mailer = fakeMailer();
    const res = await request(buildApp(prisma, mailer)).post('/api/v1/auth/register').send(GOOD);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ verificationRequired: true, emailDelivered: true });
    expect(res.body.token).toBeUndefined();
    expect(prisma.session.create).not.toHaveBeenCalled();

    const created = [...prisma.__users.values()][0];
    expect(created.emailVerifiedAt).toBeNull();
  });

  it('never returns the code in the response body', async () => {
    const prisma = fakePrisma();
    const mailer = fakeMailer();
    const res = await request(buildApp(prisma, mailer)).post('/api/v1/auth/register').send(GOOD);

    expect(mailer.sent).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain(mailer.sent[0].code);
  });

  it('masks the address it echoes back', async () => {
    const prisma = fakePrisma();
    const res = await request(buildApp(prisma, fakeMailer())).post('/api/v1/auth/register').send(GOOD);
    expect(res.body.maskedEmail).toBe('n***@example.com');
    expect(res.body.maskedEmail).not.toBe(GOOD.email);
  });

  it('reports honestly when the mailer could not deliver', async () => {
    const prisma = fakePrisma();
    const res = await request(buildApp(prisma, fakeMailer({ deliver: false })))
      .post('/api/v1/auth/register')
      .send(GOOD);

    expect(res.status).toBe(201);
    expect(res.body.emailDelivered).toBe(false);
    expect(res.body.token).toBeUndefined();
  });

  it('still records the referrer', async () => {
    const referrer = { id: 'ref-1', email: 'ref@example.com', referralCode: 'VLTX1234', emailVerifiedAt: new Date() };
    const prisma = fakePrisma([referrer]);
    await request(buildApp(prisma, fakeMailer()))
      .post('/api/v1/auth/register')
      .send({ ...GOOD, ref: 'vltx1234' });

    const created = [...prisma.__users.values()].find((u) => u.email === GOOD.email);
    expect(created.referredById).toBe('ref-1');
  });

  it('still honours REGISTRATION_OPEN=false', async () => {
    process.env.REGISTRATION_OPEN = 'false';
    const res = await request(buildApp(fakePrisma(), fakeMailer())).post('/api/v1/auth/register').send(GOOD);
    delete process.env.REGISTRATION_OPEN;

    expect(res.status).toBe(403);
  });

  it('keeps duplicate-email rejection generic', async () => {
    const existing = { id: 'u-1', email: GOOD.email, referralCode: 'AAAA1111', emailVerifiedAt: new Date() };
    const res = await request(buildApp(fakePrisma([existing]), fakeMailer())).post('/api/v1/auth/register').send(GOOD);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Registration failed');
  });

  describe('password rule — identical to the frontend validator', () => {
    it('rejects nine characters', async () => {
      const res = await request(buildApp(fakePrisma(), fakeMailer()))
        .post('/api/v1/auth/register')
        .send({ email: GOOD.email, password: 'Shorty123' });
      expect(res.status).toBe(400);
    });

    it('rejects ten characters with no uppercase', async () => {
      const res = await request(buildApp(fakePrisma(), fakeMailer()))
        .post('/api/v1/auth/register')
        .send({ email: GOOD.email, password: 'alllower12' });
      expect(res.status).toBe(400);
    });

    it('accepts ten characters with an uppercase letter', async () => {
      const res = await request(buildApp(fakePrisma(), fakeMailer()))
        .post('/api/v1/auth/register')
        .send({ email: GOOD.email, password: 'Justenough' });
      expect(res.status).toBe(201);
    });
  });
});

describe('POST /auth/verify-email', () => {
  async function registered(mailerOpts = {}) {
    const prisma = fakePrisma();
    const mailer = fakeMailer(mailerOpts);
    const app = buildApp(prisma, mailer);
    const res = await request(app).post('/api/v1/auth/register').send(GOOD);
    return { prisma, mailer, app, challengeId: res.body.challengeId, code: mailer.sent[0]?.code };
  }

  it('issues a real session only after the right code', async () => {
    const { prisma, app, challengeId, code } = await registered();
    const res = await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    // A genuine session row, and a token the existing middleware understands.
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET!) as any;
    expect(decoded.sub).toBe([...prisma.__users.values()][0].id);
    expect(decoded.sid).toBeDefined();
  });

  it('marks emailVerifiedAt', async () => {
    const { prisma, app, challengeId, code } = await registered();
    await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code });
    expect([...prisma.__users.values()][0].emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong code without issuing a session', async () => {
    const { prisma, app, challengeId, code } = await registered();
    const wrong = code === '000000' ? '111111' : '000000';

    const res = await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code: wrong });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CODE');
    expect(res.body.token).toBeUndefined();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('refuses a code that already worked', async () => {
    const { app, challengeId, code } = await registered();
    await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code });

    const replay = await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code });

    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('CHALLENGE_CONSUMED');
    expect(replay.body.token).toBeUndefined();
  });

  it('refuses an expired code', async () => {
    const { prisma, app, challengeId, code } = await registered();
    prisma.__challenges.get(challengeId).expiresAt = new Date(Date.now() - 1000);

    const res = await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('stops accepting guesses at the attempt limit', async () => {
    const { app, challengeId, code } = await registered();
    const wrong = code === '000000' ? '111111' : '000000';

    let last;
    for (let i = 0; i < 6; i++) {
      last = await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code: wrong });
    }
    expect(last!.body.code).toBe('TOO_MANY_ATTEMPTS');

    // And the correct code no longer helps.
    const afterwards = await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code });
    expect(afterwards.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(afterwards.body.token).toBeUndefined();
  });

  it('rejects a malformed code before touching the database', async () => {
    const { app, challengeId } = await registered();
    const res = await request(app).post('/api/v1/auth/verify-email').send({ challengeId, code: 'abcdef' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/resend-verification', () => {
  it('is refused during the cooldown', async () => {
    const prisma = fakePrisma();
    const app = buildApp(prisma, fakeMailer());
    const reg = await request(app).post('/api/v1/auth/register').send(GOOD);

    const res = await request(app).post('/api/v1/auth/resend-verification').send({ challengeId: reg.body.challengeId });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('COOLDOWN');
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('sends a new code and invalidates the previous one', async () => {
    const prisma = fakePrisma();
    const mailer = fakeMailer();
    const app = buildApp(prisma, mailer);
    const reg = await request(app).post('/api/v1/auth/register').send(GOOD);
    const firstCode = mailer.sent[0].code;
    prisma.__challenges.get(reg.body.challengeId).lastSentAt = new Date(Date.now() - 120_000);

    const res = await request(app).post('/api/v1/auth/resend-verification').send({ challengeId: reg.body.challengeId });

    expect(res.status).toBe(200);
    expect(res.body.challengeId).not.toBe(reg.body.challengeId);
    expect(mailer.sent).toHaveLength(2);

    // The first code is dead; the second one works.
    const stale = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ challengeId: reg.body.challengeId, code: firstCode });
    expect(stale.body.token).toBeUndefined();

    const fresh = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ challengeId: res.body.challengeId, code: mailer.sent[1].code });
    expect(fresh.status).toBe(200);
    expect(typeof fresh.body.token).toBe('string');
  });

  it('reports a mail failure instead of pretending a code went out', async () => {
    const prisma = fakePrisma();
    const mailer = fakeMailer();
    const app = buildApp(prisma, mailer);
    const reg = await request(app).post('/api/v1/auth/register').send(GOOD);
    prisma.__challenges.get(reg.body.challengeId).lastSentAt = new Date(Date.now() - 120_000);
    mailer.send.mockResolvedValueOnce(false);

    const res = await request(app).post('/api/v1/auth/resend-verification').send({ challengeId: reg.body.challengeId });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('MAIL_UNAVAILABLE');
  });

  it('does not leak whether an address exists (keyed by challenge, not email)', async () => {
    const app = buildApp(fakePrisma(), fakeMailer());
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ challengeId: '00000000-0000-4000-8000-000000009999' });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('@');
  });
});

describe('POST /auth/login', () => {
  const passwordHash = () => bcrypt.hashSync(GOOD.password, 4);

  it('lets a user who predates verification sign in normally', async () => {
    // Exactly the shape the migration leaves behind: emailVerifiedAt filled
    // in from createdAt.
    const legacy = {
      id: 'legacy-1',
      email: 'legacy@example.com',
      passwordHash: passwordHash(),
      emailVerifiedAt: new Date('2026-01-01'),
      twoFactorEnabled: false,
      blockedAt: null,
    };
    const prisma = fakePrisma([legacy]);
    const res = await request(buildApp(prisma, fakeMailer()))
      .post('/api/v1/auth/login')
      .send({ email: legacy.email, password: GOOD.password });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('refuses a session to an unverified account and returns a routable code', async () => {
    const pending = {
      id: 'pending-1',
      email: 'pending@example.com',
      passwordHash: passwordHash(),
      emailVerifiedAt: null,
      twoFactorEnabled: false,
      blockedAt: null,
    };
    const prisma = fakePrisma([pending]);
    const mailer = fakeMailer();
    const res = await request(buildApp(prisma, mailer))
      .post('/api/v1/auth/login')
      .send({ email: pending.email, password: GOOD.password });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(res.body.token).toBeUndefined();
    expect(prisma.session.create).not.toHaveBeenCalled();
    // A fresh code goes out so the user can finish from the login screen.
    expect(res.body.challengeId).toBeDefined();
    expect(mailer.sent).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain(mailer.sent[0].code);
  });

  it('lets that account in once it verifies', async () => {
    const pending = {
      id: 'pending-2',
      email: 'pending2@example.com',
      passwordHash: passwordHash(),
      emailVerifiedAt: null,
      twoFactorEnabled: false,
      blockedAt: null,
    };
    const prisma = fakePrisma([pending]);
    const mailer = fakeMailer();
    const app = buildApp(prisma, mailer);

    const blocked = await request(app).post('/api/v1/auth/login').send({ email: pending.email, password: GOOD.password });
    await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ challengeId: blocked.body.challengeId, code: mailer.sent[0].code });

    const after = await request(app).post('/api/v1/auth/login').send({ email: pending.email, password: GOOD.password });
    expect(after.status).toBe(200);
    expect(typeof after.body.token).toBe('string');
  });

  it('still rejects a wrong password without mentioning verification', async () => {
    const pending = {
      id: 'pending-3',
      email: 'pending3@example.com',
      passwordHash: passwordHash(),
      emailVerifiedAt: null,
      twoFactorEnabled: false,
      blockedAt: null,
    };
    const res = await request(buildApp(fakePrisma([pending]), fakeMailer()))
      .post('/api/v1/auth/login')
      .send({ email: pending.email, password: 'WrongPassword1' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBeUndefined();
  });
});

describe('audit trail', () => {
  it('records the lifecycle without ever writing the code down', async () => {
    const prisma = fakePrisma();
    const mailer = fakeMailer();
    const app = buildApp(prisma, mailer);
    const reg = await request(app).post('/api/v1/auth/register').send(GOOD);
    await request(app).post('/api/v1/auth/verify-email').send({ challengeId: reg.body.challengeId, code: mailer.sent[0].code });

    const actions = prisma.__audit.map((a: any) => a.action);
    expect(actions).toContain('USER_REGISTERED');
    expect(actions).toContain('EMAIL_VERIFICATION_SENT');
    expect(actions).toContain('EMAIL_VERIFIED');
    expect(JSON.stringify(prisma.__audit)).not.toContain(mailer.sent[0].code);
  });
});

describe('rate limiting', () => {
  it('throttles repeated registration attempts from one address', async () => {
    // The real registerLimiter allows 20 per hour per IP. Each attempt below
    // carries a deliberately invalid body so zod rejects it before bcrypt
    // runs — the limiter is middleware and counts the request either way,
    // which keeps this assertion about throttling rather than about how long
    // 25 password hashes take.
    const app = buildApp(fakePrisma(), fakeMailer(), { realLimiters: true });

    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await request(app).post('/api/v1/auth/register').send({ email: 'not-an-email', password: 'x' });
      statuses.push(res.status);
      if (res.status === 429) break;
    }

    expect(statuses).toContain(429);
    // Everything before the cap was handled normally (rejected on validation),
    // so the 429 is the limiter and not an unrelated failure.
    expect(statuses.slice(0, -1).every((s) => s === 400)).toBe(true);
  });
});
