// jest.setup.ts already supplies a suite-wide value; this file pins its own
// so the HMAC assertions below are independent of that default.
process.env.EMAIL_VERIFICATION_SECRET = 'test-verification-secret-value';

import {
  EmailVerificationService,
  MAX_VERIFICATION_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  VERIFICATION_EXPIRY_MS,
  generateVerificationCode,
  hashVerificationCode,
  maskEmail,
} from '../EmailVerificationService';

/**
 * A small in-memory stand-in for the two tables this service touches.
 * `$transaction(fn)` runs the callback against the same store, which is
 * enough to exercise the read-modify-write ordering the service relies on;
 * the real atomicity is Postgres's job and is not what these tests claim to
 * verify.
 */
function fakePrisma(users: Record<string, { id: string; email: string; emailVerifiedAt: Date | null }>) {
  const challenges = new Map<string, any>();
  let seq = 0;

  const store = {
    emailVerificationChallenge: {
      deleteMany: jest.fn(async ({ where }: any) => {
        for (const [id, c] of challenges) if (c.userId === where.userId) challenges.delete(id);
        return { count: 0 };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `challenge-${++seq}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
        challenges.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where, include }: any) => {
        const row = challenges.get(where.id);
        if (!row) return null;
        return include?.user ? { ...row, user: users[row.userId] } : { ...row };
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
        Object.assign(users[where.id], data);
        return users[where.id];
      }),
    },
  };

  return {
    ...store,
    $transaction: jest.fn(async (fn: any) => fn(store)),
    __challenges: challenges,
  } as any;
}

describe('generateVerificationCode', () => {
  it('always produces exactly six digits', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it('spreads across the range rather than repeating one value', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateVerificationCode()));
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe('hashVerificationCode', () => {
  it('is keyed, so the digest is not a bare hash of the digits', () => {
    const crypto = require('crypto') as typeof import('crypto');
    const plain = crypto.createHash('sha256').update('123456').digest('hex');
    expect(hashVerificationCode('123456')).not.toBe(plain);
  });

  it('changes completely when the secret changes', () => {
    const withFirst = hashVerificationCode('123456');
    process.env.EMAIL_VERIFICATION_SECRET = 'a-different-secret-entirely';
    const withSecond = hashVerificationCode('123456');
    process.env.EMAIL_VERIFICATION_SECRET = 'test-verification-secret-value';
    expect(withSecond).not.toBe(withFirst);
  });
});

describe('EmailVerificationService', () => {
  const user = () => ({ 'user-1': { id: 'user-1', email: 'alice@example.com', emailVerifiedAt: null } });

  it('stores an HMAC, never the code itself', async () => {
    const users = user();
    const prisma = fakePrisma(users);
    const svc = new EmailVerificationService(prisma);

    const { code, challengeId } = await svc.issueChallenge('user-1');
    const stored = prisma.__challenges.get(challengeId);

    expect(stored.codeHash).not.toContain(code);
    expect(stored.codeHash).toBe(hashVerificationCode(code));
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it('accepts the right code and marks the user verified', async () => {
    const users = user();
    const svc = new EmailVerificationService(fakePrisma(users));
    const { challengeId, code } = await svc.issueChallenge('user-1');

    const result = await svc.verify(challengeId, code);

    expect(result).toEqual({ ok: true, userId: 'user-1' });
    expect(users['user-1'].emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong code and counts the attempt down', async () => {
    const svc = new EmailVerificationService(fakePrisma(user()));
    const { challengeId, code } = await svc.issueChallenge('user-1');
    const wrong = code === '000000' ? '111111' : '000000';

    const result = await svc.verify(challengeId, wrong);

    expect(result).toMatchObject({ ok: false, reason: 'INVALID_CODE', attemptsRemaining: MAX_VERIFICATION_ATTEMPTS - 1 });
  });

  it('kills the challenge after the attempt limit, even if the right code arrives next', async () => {
    const users = user();
    const svc = new EmailVerificationService(fakePrisma(users));
    const { challengeId, code } = await svc.issueChallenge('user-1');
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) await svc.verify(challengeId, wrong);
    const afterLimit = await svc.verify(challengeId, code);

    expect(afterLimit).toEqual({ ok: false, reason: 'TOO_MANY_ATTEMPTS' });
    expect(users['user-1'].emailVerifiedAt).toBeNull();
  });

  it('refuses an expired challenge', async () => {
    const prisma = fakePrisma(user());
    const svc = new EmailVerificationService(prisma);
    const { challengeId, code } = await svc.issueChallenge('user-1');
    prisma.__challenges.get(challengeId).expiresAt = new Date(Date.now() - 1000);

    expect(await svc.verify(challengeId, code)).toEqual({ ok: false, reason: 'CHALLENGE_EXPIRED' });
  });

  it('sets an expiry of about ten minutes', async () => {
    const prisma = fakePrisma(user());
    const svc = new EmailVerificationService(prisma);
    const { challengeId } = await svc.issueChallenge('user-1');
    const ahead = prisma.__challenges.get(challengeId).expiresAt.getTime() - Date.now();

    expect(ahead).toBeGreaterThan(VERIFICATION_EXPIRY_MS - 5_000);
    expect(ahead).toBeLessThanOrEqual(VERIFICATION_EXPIRY_MS);
  });

  it('cannot replay a code that already worked', async () => {
    const svc = new EmailVerificationService(fakePrisma(user()));
    const { challengeId, code } = await svc.issueChallenge('user-1');

    expect(await svc.verify(challengeId, code)).toEqual({ ok: true, userId: 'user-1' });
    expect(await svc.verify(challengeId, code)).toEqual({ ok: false, reason: 'CHALLENGE_CONSUMED' });
  });

  it('rejects an unknown challenge id', async () => {
    const svc = new EmailVerificationService(fakePrisma(user()));
    expect(await svc.verify('no-such-challenge', '123456')).toEqual({ ok: false, reason: 'CHALLENGE_NOT_FOUND' });
  });

  describe('resend', () => {
    it('is refused inside the cooldown window', async () => {
      const svc = new EmailVerificationService(fakePrisma(user()));
      const { challengeId } = await svc.issueChallenge('user-1');

      const result = await svc.resend(challengeId);

      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === 'COOLDOWN') {
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
        expect(result.retryAfterSeconds).toBeLessThanOrEqual(RESEND_COOLDOWN_MS / 1000);
      } else {
        throw new Error('expected a COOLDOWN result');
      }
    });

    it('issues a new code once the cooldown has passed, and the old code stops working', async () => {
      const prisma = fakePrisma(user());
      const svc = new EmailVerificationService(prisma);
      const first = await svc.issueChallenge('user-1');
      // Pretend the last send was long enough ago.
      prisma.__challenges.get(first.challengeId).lastSentAt = new Date(Date.now() - RESEND_COOLDOWN_MS - 1000);

      const resent = await svc.resend(first.challengeId);
      if (!resent.ok) throw new Error('expected the resend to succeed');

      expect(resent.challengeId).not.toBe(first.challengeId);
      expect(resent.code).not.toBe(first.code);
      // The superseded challenge is gone, so the original code verifies
      // nothing at all.
      expect(await svc.verify(first.challengeId, first.code)).toEqual({ ok: false, reason: 'CHALLENGE_NOT_FOUND' });
      expect(await svc.verify(resent.challengeId, resent.code)).toEqual({ ok: true, userId: 'user-1' });
    });

    it('refuses to resend for an address that is already verified', async () => {
      const users = { 'user-1': { id: 'user-1', email: 'alice@example.com', emailVerifiedAt: new Date() } };
      const prisma = fakePrisma(users);
      const svc = new EmailVerificationService(prisma);
      const { challengeId } = await svc.issueChallenge('user-1');
      prisma.__challenges.get(challengeId).lastSentAt = new Date(Date.now() - RESEND_COOLDOWN_MS - 1000);

      expect(await svc.resend(challengeId)).toEqual({ ok: false, reason: 'ALREADY_VERIFIED' });
    });
  });

  it('replaces any earlier challenge when a new one is issued', async () => {
    const prisma = fakePrisma(user());
    const svc = new EmailVerificationService(prisma);
    const first = await svc.issueChallenge('user-1');
    const second = await svc.issueChallenge('user-1');

    expect(prisma.__challenges.size).toBe(1);
    expect(await svc.verify(first.challengeId, first.code)).toEqual({ ok: false, reason: 'CHALLENGE_NOT_FOUND' });
    expect(await svc.verify(second.challengeId, second.code)).toEqual({ ok: true, userId: 'user-1' });
  });
});

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
  });

  it('leaves an unparseable value alone rather than mangling it', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});

describe('the secret is required, with no JWT_SECRET fallback', () => {
  const ORIGINAL = process.env.EMAIL_VERIFICATION_SECRET;

  afterEach(() => {
    process.env.EMAIL_VERIFICATION_SECRET = ORIGINAL;
  });

  it('refuses to hash a code when EMAIL_VERIFICATION_SECRET is absent, even with JWT_SECRET set', () => {
    delete process.env.EMAIL_VERIFICATION_SECRET;
    process.env.JWT_SECRET = 'a-session-signing-key';

    // Before this hardening, JWT_SECRET silently keyed the HMAC here.
    expect(() => hashVerificationCode('123456')).toThrow(/EMAIL_VERIFICATION_SECRET/);
  });

  it('produces a digest unrelated to JWT_SECRET once configured', () => {
    process.env.JWT_SECRET = 'a-session-signing-key';
    process.env.EMAIL_VERIFICATION_SECRET = 'a-separate-verification-key';
    const withDedicated = hashVerificationCode('123456');

    // Keying with JWT_SECRET would have produced this instead; it must not
    // be what the service stores.
    const crypto = require('crypto') as typeof import('crypto');
    const asIfKeyedByJwt = crypto.createHmac('sha256', 'a-session-signing-key').update('123456').digest('hex');

    expect(withDedicated).not.toBe(asIfKeyedByJwt);
  });

  it('still runs the full issue -> verify flow with a dedicated secret', async () => {
    process.env.EMAIL_VERIFICATION_SECRET = 'a-separate-verification-key';
    const users = { 'user-1': { id: 'user-1', email: 'alice@example.com', emailVerifiedAt: null as Date | null } };
    const svc = new EmailVerificationService(fakePrisma(users));

    const { challengeId, code } = await svc.issueChallenge('user-1');
    expect(await svc.verify(challengeId, code)).toEqual({ ok: true, userId: 'user-1' });
    expect(users['user-1'].emailVerifiedAt).toBeInstanceOf(Date);
  });
});
