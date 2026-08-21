import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';

const BCRYPT_ROUNDS = 12;

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(10, 'password must be at least 10 characters'),
});

export function accountRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
      kycStatus: user.kycStatus,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
    });
  });

  router.patch('/me/password', requireAuth, async (req: AuthedRequest, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'PASSWORD_CHANGED', metadata: {} },
    });

    res.json({ status: 'ok' });
  });

  return router;
}
