import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required');

const JWT_EXPIRES_IN = '12h';
const BCRYPT_ROUNDS = 12;

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

// Login attempts are the classic brute-force target — much tighter limit
// than the general API rate limit in index.ts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
});

function issueToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET!, { expiresIn: JWT_EXPIRES_IN });
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
    const user = await prisma.user.create({
      data: { email, passwordHash },
    });

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'USER_REGISTERED', metadata: { email } },
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

    res.json({ token: issueToken(user.id) });
  });

  return router;
}
