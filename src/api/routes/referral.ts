import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { REFERRAL_REWARD_PERCENT } from '../../config/limits';

/**
 * Everything here is read-only — the actual reward payout happens inside
 * DepositService.claimDeposit, in the same DB transaction as the deposit
 * credit itself (see ReferralReward's schema doc comment). This router just
 * reports on that real, already-happened activity: nothing here can create
 * or adjust a balance.
 */
export function referralRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/referral/me', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [referredCount, rewardsByAsset, recentRewards] = await Promise.all([
      prisma.user.count({ where: { referredById: user.id } }),
      prisma.referralReward.groupBy({
        by: ['asset'],
        where: { referrerId: user.id },
        _sum: { amount: true },
      }),
      prisma.referralReward.findMany({
        where: { referrerId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, asset: true, amount: true, createdAt: true },
      }),
    ]);

    res.json({
      referralCode: user.referralCode,
      rewardPercent: REFERRAL_REWARD_PERCENT,
      referredCount,
      rewardsByAsset: rewardsByAsset.map((r) => ({ asset: r.asset, amount: r._sum.amount?.toString() ?? '0' })),
      recentRewards: recentRewards.map((r) => ({ ...r, amount: r.amount.toString() })),
    });
  });

  return router;
}
