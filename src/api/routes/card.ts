import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';

/**
 * Crypto card — waitlist only, the card itself doesn't exist yet (no card
 * network or issuing bank partnership). Joining requires full KYC: this
 * isn't a business choice we could relax later, it's a hard requirement
 * from Visa/Mastercard and the issuing bank on ANY card program, wherever
 * the operating company is registered — a card can't be anonymous.
 */
export function cardRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/card/waitlist/me', requireAuth, async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ joined: user.cardWaitlistJoinedAt != null, joinedAt: user.cardWaitlistJoinedAt, kycStatus: user.kycStatus });
  });

  router.post('/card/waitlist/join', requireAuth, async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.kycStatus !== 'APPROVED') {
      return res.status(400).json({ error: 'Card waitlist requires an approved identity verification' });
    }

    const joinedAt = user.cardWaitlistJoinedAt ?? new Date();
    if (!user.cardWaitlistJoinedAt) {
      await prisma.user.update({ where: { id: user.id }, data: { cardWaitlistJoinedAt: joinedAt } });
      await prisma.auditLog.create({ data: { userId: user.id, action: 'CARD_WAITLIST_JOINED', metadata: {} } });
    }

    res.json({ joined: true, joinedAt });
  });

  return router;
}
