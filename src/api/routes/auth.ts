import { Router, Request, RequestHandler } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { verifyAndConsume2FACode } from '../../services/TwoFactorService';
import { generateReferralCode } from '../../services/referralCode';
import {
  EmailVerificationService,
  MAX_VERIFICATION_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  VERIFICATION_EXPIRY_MS,
  maskEmail,
} from '../../services/EmailVerificationService';
import { VerificationEmailService } from '../../services/VerificationEmailService';

// Real login metadata for the account's Security Log — never a placeholder.
// req.ip depends on `trust proxy` being set (see index.ts) to reflect the
// actual client rather than the reverse proxy's own address.
function loginMetadata(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

// The ONE email that ever gets ADMIN automatically, and only at the moment
// of registration — never re-checked or re-derived from email afterward
// (see requireAdmin middleware, which only ever reads the role column).
// Lowercased for a case-insensitive match, same normalization Postgres's
// own unique index on email doesn't enforce but registration should.
const ADMIN_EMAIL = 'voltex.crypto@gmail.com';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required');

const JWT_EXPIRES_IN = '12h';
const BCRYPT_ROUNDS = 12;

// Short-lived, narrowly-scoped token issued after a correct password but
// before the 2FA step completes. Carries a `purpose` claim so requireAuth
// (which only accepts claim-less session tokens) can never mistake it for
// a full session — it's only good for POSTing to /auth/login/2fa.
const PENDING_2FA_EXPIRES_IN = '5m';

const registerSchema = z.object({
  email: z.string().email(),
  // Exactly what the registration form validates and its hint promises:
  // 10+ characters and at least one uppercase letter. Frontend and backend
  // must agree — a password the UI accepts and the server rejects is a dead
  // end the user cannot diagnose. See frontend/src/pages/register/
  // RegisterPanel.tsx, which enforces the same two rules and no others.
  password: z
    .string()
    .min(10, 'password must be at least 10 characters')
    .regex(/[A-ZА-ЯЁ]/, 'password must contain at least one uppercase letter'),
  // The referral code from the link the new user signed up through (see
  // /r/:code on the frontend). Optional — most registrations have none.
  // Looked up and stored as referredById below; a code that doesn't match
  // any user is silently ignored rather than rejecting the registration
  // over it (a stale/typo'd link shouldn't block signup).
  ref: z.string().max(32).optional(),
});

const verifyEmailSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'code must be six digits'),
});

const resendVerificationSchema = z.object({
  challengeId: z.string().uuid(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const login2faSchema = z.object({
  pendingToken: z.string(),
  code: z.string().min(6).max(64),
});

// Login attempts are the classic brute-force target — much tighter limit
// than the general API rate limit in index.ts. The 2FA step gets the same
// treatment: a 6-digit TOTP code is only ~1M possibilities.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
});

// A six-digit code is a million possibilities; the per-challenge attempt
// counter caps guesses against one challenge, and this caps how fast a
// caller can cycle through challenges from one address.
const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts, try again later' },
});

// Each resend sends a real email. The per-challenge cooldown is the primary
// control; this stops one address from driving resends across many
// challenges (i.e. using the platform as a mail cannon).
const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification emails requested, try again later' },
});

// Registration creates rows and sends mail; unlimited attempts from one
// address is how a signup form becomes a spam relay.
const registerLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, try again later' },
});

const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later' },
});

// Creates the real Session row a token's `sid` claim points at (see
// requireAuth) — one per register/login/login-2fa, carrying the actual
// request's IP/UA so Settings → Security's "Active sessions" list and the
// sign-out-this-device button have real data and real effect, not a mock.
async function createSession(prisma: PrismaClient, userId: string, req: Request) {
  const meta = loginMetadata(req);
  return prisma.session.create({ data: { userId, ip: meta.ip, userAgent: meta.userAgent } });
}

function issueToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, JWT_SECRET!, { expiresIn: JWT_EXPIRES_IN });
}

function issuePendingToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'pending_2fa' }, JWT_SECRET!, { expiresIn: PENDING_2FA_EXPIRES_IN });
}

export function authRouter(
  prisma: PrismaClient,
  deps: {
    emailVerification?: EmailVerificationService;
    verificationEmail?: VerificationEmailService;
    /**
     * Override the per-route limiters. Production passes nothing and gets
     * the real ones defined above; tests that are exercising route logic
     * rather than throttling substitute pass-throughs, because the limiters
     * are module-level singletons whose counters would otherwise carry from
     * one test case into the next. The limiters themselves are covered by
     * their own test.
     */
    limiters?: Partial<Record<'register' | 'verifyEmail' | 'resendVerification' | 'login', RequestHandler>>;
  } = {}
): Router {
  const router = Router();
  const emailVerification = deps.emailVerification ?? new EmailVerificationService(prisma);
  const verificationEmail = deps.verificationEmail ?? new VerificationEmailService();
  const limit = {
    register: deps.limiters?.register ?? registerLimiter,
    verifyEmail: deps.limiters?.verifyEmail ?? verifyEmailLimiter,
    resendVerification: deps.limiters?.resendVerification ?? resendVerificationLimiter,
    login: deps.limiters?.login ?? loginLimiter,
  };

  // For a private team tool, leave self-registration OPEN only while you're
  // onboarding people, then set REGISTRATION_OPEN=false in .env so randoms
  // who find the URL can't create accounts. Simple on/off switch, no invite
  // system yet — ask if you want invite-only registration instead.
  router.post('/auth/register', limit.register, async (req, res) => {
    if (process.env.REGISTRATION_OPEN === 'false') {
      return res.status(403).json({ error: 'Registration is currently closed' });
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password, ref } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Same generic message as an invalid login — don't reveal which emails
      // are already registered to an unauthenticated caller.
      return res.status(400).json({ error: 'Registration failed' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const role = email.toLowerCase() === ADMIN_EMAIL ? 'ADMIN' : 'USER';

    const referrer = ref ? await prisma.user.findUnique({ where: { referralCode: ref.toUpperCase() } }) : null;

    // Astronomically unlikely to ever collide (32^8 combinations), but a
    // unique constraint is only actually enforced if we respect it — retry
    // a handful of times rather than letting a freak collision 500 the
    // request.
    let user;
    for (let attempt = 0; ; attempt++) {
      try {
        user = await prisma.user.create({
          data: { email, passwordHash, role, referralCode: generateReferralCode(), referredById: referrer?.id },
        });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && err?.meta?.target?.includes?.('referralCode') && attempt < 5) continue;
        throw err;
      }
    }

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_REGISTERED', metadata: { email, ...loginMetadata(req) } },
    });

    // NO SESSION HERE. The account exists but emailVerifiedAt is null, so it
    // cannot log in yet. A token is issued only by /auth/verify-email, after
    // the user proves they can read the address they typed.
    const { challengeId, code } = await emailVerification.issueChallenge(user.id);
    const delivered = await verificationEmail.send({
      to: email,
      code,
      expiryMinutes: Math.round(VERIFICATION_EXPIRY_MS / 60_000),
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'EMAIL_VERIFICATION_SENT',
        metadata: { delivered, ...loginMetadata(req) },
      },
    });

    if (!delivered) {
      // The account row stays: the user can come back and resend rather than
      // being told the email is taken on their second attempt. What must not
      // happen is a verification screen for a code that was never sent.
      return res.status(201).json({
        verificationRequired: true,
        challengeId,
        maskedEmail: maskEmail(email),
        expiresInSeconds: Math.round(VERIFICATION_EXPIRY_MS / 1000),
        resendAvailableInSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
        emailDelivered: false,
      });
    }

    res.status(201).json({
      verificationRequired: true,
      challengeId,
      maskedEmail: maskEmail(email),
      expiresInSeconds: Math.round(VERIFICATION_EXPIRY_MS / 1000),
      resendAvailableInSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
      emailDelivered: true,
    });
  });

  // Second half of registration: the code proves the address is reachable,
  // and only here does the account get a real session on the existing
  // Session + JWT machinery — no second auth mechanism.
  router.post('/auth/verify-email', limit.verifyEmail, async (req, res) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { challengeId, code } = parsed.data;

    const result = await emailVerification.verify(challengeId, code);

    if (!result.ok) {
      if (result.reason === 'TOO_MANY_ATTEMPTS') {
        await prisma.auditLog.create({
          data: { action: 'EMAIL_VERIFICATION_ATTEMPT_LIMIT', metadata: { challengeId, ...loginMetadata(req) } },
        });
      }
      const status = result.reason === 'CHALLENGE_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({
        error: 'Verification failed',
        code: result.reason,
        attemptsRemaining: result.attemptsRemaining,
        maxAttempts: MAX_VERIFICATION_ATTEMPTS,
      });
    }

    const user = await prisma.user.findUnique({ where: { id: result.userId } });
    if (!user) return res.status(404).json({ error: 'Verification failed', code: 'CHALLENGE_NOT_FOUND' });

    if (user.blockedAt) {
      return res.status(403).json({
        error: user.blockedReason ? `Аккаунт заблокирован: ${user.blockedReason}` : 'Аккаунт заблокирован',
      });
    }

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'EMAIL_VERIFIED', metadata: loginMetadata(req) },
    });

    const session = await createSession(prisma, user.id, req);
    res.json({ token: issueToken(user.id, session.id) });
  });

  // Keyed by challenge id, never by email address, so this endpoint cannot
  // be used to discover which addresses are registered.
  router.post('/auth/resend-verification', limit.resendVerification, async (req, res) => {
    const parsed = resendVerificationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const result = await emailVerification.resend(parsed.data.challengeId);

    if (!result.ok) {
      if (result.reason === 'COOLDOWN') {
        return res.status(429).json({
          error: 'Please wait before requesting another code',
          code: 'COOLDOWN',
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
      if (result.reason === 'ALREADY_VERIFIED') {
        return res.status(400).json({ error: 'Verification failed', code: 'ALREADY_VERIFIED' });
      }
      return res.status(404).json({ error: 'Verification failed', code: 'CHALLENGE_NOT_FOUND' });
    }

    const delivered = await verificationEmail.send({
      to: result.email,
      code: result.code,
      expiryMinutes: Math.round(VERIFICATION_EXPIRY_MS / 60_000),
    });

    await prisma.auditLog.create({
      data: { action: 'EMAIL_VERIFICATION_SENT', metadata: { delivered, resend: true, ...loginMetadata(req) } },
    });

    if (!delivered) {
      return res.status(502).json({ error: 'Could not send the verification email', code: 'MAIL_UNAVAILABLE' });
    }

    res.json({
      challengeId: result.challengeId,
      maskedEmail: maskEmail(result.email),
      expiresInSeconds: Math.round(VERIFICATION_EXPIRY_MS / 1000),
      resendAvailableInSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
    });
  });

  router.post('/auth/login', limit.login, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    // Always run bcrypt.compare even on a missing user (against a dummy hash)
    // so response timing doesn't leak whether the email exists.
    const hash = user?.passwordHash ?? '$2b$12$invalidsaltinvalidsaltinvalidsalu';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.blockedAt) {
      return res.status(403).json({
        error: user.blockedReason ? `Аккаунт заблокирован: ${user.blockedReason}` : 'Аккаунт заблокирован',
      });
    }

    // Password is right, but the address was never proven. No session, and
    // a structured code the frontend can route into the verification screen.
    // Accounts that predate this feature were backfilled as verified by the
    // migration, so this can only ever catch someone who registered after it
    // and stopped before entering their code.
    if (!user.emailVerifiedAt) {
      const { challengeId, code } = await emailVerification.issueChallenge(user.id);
      const delivered = await verificationEmail.send({
        to: user.email,
        code,
        expiryMinutes: Math.round(VERIFICATION_EXPIRY_MS / 60_000),
      });
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'EMAIL_VERIFICATION_SENT',
          metadata: { delivered, viaLogin: true, ...loginMetadata(req) },
        },
      });
      return res.status(403).json({
        error: 'Email verification required',
        code: 'EMAIL_VERIFICATION_REQUIRED',
        challengeId,
        maskedEmail: maskEmail(user.email),
        expiresInSeconds: Math.round(VERIFICATION_EXPIRY_MS / 1000),
        resendAvailableInSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
        emailDelivered: delivered,
      });
    }

    if (user.twoFactorEnabled) {
      return res.json({ requires2fa: true, pendingToken: issuePendingToken(user.id) });
    }

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_LOGGED_IN', metadata: loginMetadata(req) },
    });

    const session = await createSession(prisma, user.id, req);
    res.json({ token: issueToken(user.id, session.id) });
  });

  router.post('/auth/login/2fa', twoFactorLimiter, async (req, res) => {
    const parsed = login2faSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { pendingToken, code } = parsed.data;

    let userId: string;
    try {
      const payload = jwt.verify(pendingToken, JWT_SECRET!) as { sub: string; purpose?: string };
      if (payload.purpose !== 'pending_2fa') throw new Error('wrong token type');
      userId = payload.sub;
    } catch {
      return res.status(401).json({ error: 'Login session expired, please sign in again' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorEnabled) {
      return res.status(401).json({ error: 'Login session expired, please sign in again' });
    }

    if (user.blockedAt) {
      return res.status(403).json({
        error: user.blockedReason ? `Аккаунт заблокирован: ${user.blockedReason}` : 'Аккаунт заблокирован',
      });
    }

    const result = await verifyAndConsume2FACode(user, code);
    if (!result.ok) {
      return res.status(401).json({ error: 'Invalid authentication code' });
    }

    if (result.remainingBackupCodes) {
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorBackupCodes: result.remainingBackupCodes },
      });
      await prisma.auditLog.create({
        data: { userId: user.id, action: 'TWO_FACTOR_BACKUP_CODE_USED', metadata: {} },
      });
    }

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_LOGGED_IN', metadata: loginMetadata(req) },
    });

    const session = await createSession(prisma, user.id, req);
    res.json({ token: issueToken(user.id, session.id) });
  });

  return router;
}
