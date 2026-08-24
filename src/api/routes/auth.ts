import { Router, Request } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { verifyAndConsume2FACode } from '../../services/TwoFactorService';

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
  // Minimum bar for a team tool — raise this and/or add a strength meter
  // client-side if you want stricter policy.
  password: z.string().min(10, 'password must be at least 10 characters'),
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

const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later' },
});

function issueToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET!, { expiresIn: JWT_EXPIRES_IN });
}

function issuePendingToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'pending_2fa' }, JWT_SECRET!, { expiresIn: PENDING_2FA_EXPIRES_IN });
}

export function authRouter(prisma: PrismaClient): Router {
  const router = Router();

  // For a private team tool, leave self-registration OPEN only while you're
  // onboarding people, then set REGISTRATION_OPEN=false in .env so randoms
  // who find the URL can't create accounts. Simple on/off switch, no invite
  // system yet — ask if you want invite-only registration instead.
  router.post('/auth/register', async (req, res) => {
    if (process.env.REGISTRATION_OPEN === 'false') {
      return res.status(403).json({ error: 'Registration is currently closed' });
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Same generic message as an invalid login — don't reveal which emails
      // are already registered to an unauthenticated caller.
      return res.status(400).json({ error: 'Registration failed' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const role = email.toLowerCase() === ADMIN_EMAIL ? 'ADMIN' : 'USER';
    const user = await prisma.user.create({
      data: { email, passwordHash, role },
    });

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_REGISTERED', metadata: { email, ...loginMetadata(req) } },
    });

    res.status(201).json({ token: issueToken(user.id) });
  });

  router.post('/auth/login', loginLimiter, async (req, res) => {
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

    if (user.twoFactorEnabled) {
      return res.json({ requires2fa: true, pendingToken: issuePendingToken(user.id) });
    }

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_LOGGED_IN', metadata: loginMetadata(req) },
    });

    res.json({ token: issueToken(user.id) });
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

    res.json({ token: issueToken(user.id) });
  });

  return router;
}
