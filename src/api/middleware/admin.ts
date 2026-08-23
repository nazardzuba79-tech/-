import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthedRequest } from './auth';

/**
 * Only the account(s) with role=ADMIN in the database can reach anything
 * behind this. Exactly one account is granted this automatically, at
 * registration, for one specific email (see src/api/routes/auth.ts) —
 * everyone else must be promoted manually, directly in the DB:
 *
 *   UPDATE "User" SET "role" = 'ADMIN' WHERE email = 'your@email.com';
 *
 * This is intentionally manual, and intentionally NOT keyed on email
 * anywhere past that one registration-time check — every request re-checks
 * the role column fresh, so a change to this column (revoking or granting)
 * takes effect on the very next request, not just at login time.
 */
export function requireAdmin(prisma: PrismaClient) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) return res.status(401).json({ error: 'Missing bearer token' });

    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
    if (user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };
}
