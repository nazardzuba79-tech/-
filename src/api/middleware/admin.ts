import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthedRequest } from './auth';

/**
 * Only the account(s) with isAdmin=true in the database can create/edit
 * products. There's no self-service "become admin" flow — set it directly
 * in the DB for your own account:
 *
 *   UPDATE "User" SET "isAdmin" = true WHERE email = 'your@email.com';
 *
 * This is intentionally manual. A product catalog controls what people can
 * spend their balance on, so the bar for granting that power should be
 * "you personally ran a SQL command", not a button anyone could click.
 */
export function requireAdmin(prisma: PrismaClient) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) return res.status(401).json({ error: 'Missing bearer token' });

    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { isAdmin: true } });
    if (!user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };
}
