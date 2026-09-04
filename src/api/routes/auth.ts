import { Router, Request, RequestHandler } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { verifyAndConsume2FACode } from '../../services/TwoFactorService';
import { generateReferralCode } from '../../services/referralCode';
import { CountryDetectionService } from '../../services/CountryDetectionService';

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

// Registration creates a real account and a real session; unlimited
// attempts from one address is how a signup form becomes an account farm.
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
    /**
     * Override the per-route limiters. Production passes nothing and gets
     * the real ones defined above; tests that are exercising route logic
     * rather than throttling substitute pass-throughs, because the limiters
     * are module-level singletons whose counters would otherwise carry from
     * one test case into the next. The limiters themselves are covered by
     * their own test.
     */
    limiters?: Partial<Record<'register' | 'login', RequestHandler>>;
    /** Injected in tests; production builds the real one. */
    countryDetection?: CountryDetectionService;
  } = {}
): Router {
  const router = Router();
  const countryDetection = deps.countryDetection ?? new CountryDetectionService();

  /**
   * Fill in an account's country from the request, once, if it has none.
   *
   * Fire-and-forget on purpose. It runs after the response has already been
   * sent, so it cannot add a millisecond to a signup or a sign-in, and every
   * failure path inside it ends in "no country" rather than an error. A
   * country the user has saved is never touched: the update is conditional on
   * the column still being null, so even a race with the profile form cannot
   * overwrite their choice.
   *
   * This is a convenience, not a claim. See CountryDetectionService — the
   * value is never presented as verified and never feeds KYC.
   */
  function backfillCountry(userId: string, req: Request): void {
    void (async () => {
      try {
        const code = await countryDetection.detect(req);
        if (!code) return;
        await prisma.user.updateMany({ where: { id: userId, country: null }, data: { country: code } });
      } catch {
        // Detection is best-effort; nothing about the account depends on it.
      }
    })();
  }

  const limit = {
    register: deps.limiters?.register ?? registerLimiter,
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

    // A successful registration is a signed-in session, on exactly the same
    // Session row + JWT machinery every login uses — no second auth path and
    // no intermediate step. `emailVerifiedAt` stays null: nobody has proven
    // ownership of the address, and writing a timestamp to unlock the door
    // would be recording something that never happened. Nothing in
    // authentication reads that column any more; it is informational.
    const session = await createSession(prisma, user.id, req);
    res.status(201).json({ token: issueToken(user.id, session.id) });

    // After the response: the new account has no country yet, so offer one.
    backfillCountry(user.id, req);
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

    // No email-ownership gate: `emailVerifiedAt` is not consulted here, so an
    // account created since mandatory verification was removed (null column)
    // logs in exactly like one created before it. 2FA is untouched and still
    // stands between a correct password and a session.
    if (user.twoFactorEnabled) {
      return res.json({ requires2fa: true, pendingToken: issuePendingToken(user.id) });
    }

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_LOGGED_IN', metadata: loginMetadata(req) },
    });

    const session = await createSession(prisma, user.id, req);
    res.json({ token: issueToken(user.id, session.id) });

    // Accounts that predate country detection get theirs on a later sign-in.
    if (!user.country) backfillCountry(user.id, req);
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

    if (!user.country) backfillCountry(user.id, req);
  });

  return router;
}
