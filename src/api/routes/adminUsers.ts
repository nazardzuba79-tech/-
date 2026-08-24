import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { BalanceAdjustmentService, BalanceAdjustmentError } from '../../services/BalanceAdjustmentService';

/**
 * Admin's view into every registered account — the registration data,
 * verification status, and balances the admin panel's Users section needs,
 * plus (on the detail route) a client's full activity history. The
 * registration IP isn't a column on User; it's read back from the
 * USER_REGISTERED AuditLog entry auth.ts already writes on every sign-up.
 */
export function adminUsersRouter(prisma: PrismaClient): Router {
  const router = Router();
  const balanceAdjustments = new BalanceAdjustmentService(prisma);

  router.get('/admin/users', requireAuth, requireAdmin(prisma), async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const [users, registrations, balances, lastLogins] = await Promise.all([
      prisma.user.findMany({
        where: search ? { email: { contains: search, mode: 'insensitive' } } : undefined,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.findMany({ where: { action: 'USER_REGISTERED' }, orderBy: { createdAt: 'asc' } }),
      prisma.balance.findMany(),
      prisma.auditLog.groupBy({ by: ['userId'], where: { action: 'USER_LOGGED_IN' }, _max: { createdAt: true } }),
    ]);

    const registrationIpByUser = new Map<string, string | null>();
    for (const r of registrations) {
      if (!registrationIpByUser.has(r.userId!)) {
        const meta = r.metadata as { ip?: string | null } | null;
        registrationIpByUser.set(r.userId!, meta?.ip ?? null);
      }
    }

    const balancesByUser = new Map<string, typeof balances>();
    for (const b of balances) {
      const list = balancesByUser.get(b.userId) ?? [];
      list.push(b);
      balancesByUser.set(b.userId, list);
    }

    const lastLoginByUser = new Map<string, Date | null>();
    for (const l of lastLogins) {
      if (l.userId) lastLoginByUser.set(l.userId, l._max.createdAt);
    }

    res.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        isAdmin: u.role === 'ADMIN',
        kycStatus: u.kycStatus,
        createdAt: u.createdAt,
        registrationIp: registrationIpByUser.get(u.id) ?? null,
        lastLoginAt: lastLoginByUser.get(u.id) ?? null,
        isBlocked: !!u.blockedAt,
        blockedAt: u.blockedAt,
        blockedReason: u.blockedReason,
        balances: (balancesByUser.get(u.id) ?? []).map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })),
      }))
    );
  });

  // Full activity history for one client — deposits, withdrawals, orders,
  // and purchases, plus every KYC submission (not just the latest one).
  router.get('/admin/users/:id', requireAuth, requireAdmin(prisma), async (req, res) => {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [registration, lastLogin, balances, deposits, withdrawals, orders, purchases, kycSubmissions] = await Promise.all([
      prisma.auditLog.findFirst({ where: { userId: id, action: 'USER_REGISTERED' }, orderBy: { createdAt: 'asc' } }),
      prisma.auditLog.findFirst({ where: { userId: id, action: 'USER_LOGGED_IN' }, orderBy: { createdAt: 'desc' } }),
      prisma.balance.findMany({ where: { userId: id } }),
      prisma.deposit.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.withdrawal.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.order.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.purchase.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 100, include: { product: { select: { name: true } } } }),
      prisma.kycSubmission.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
    ]);

    const registrationMeta = registration?.metadata as { ip?: string | null } | null;

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      isAdmin: user.role === 'ADMIN',
      kycStatus: user.kycStatus,
      createdAt: user.createdAt,
      registrationIp: registrationMeta?.ip ?? null,
      lastLoginAt: lastLogin?.createdAt ?? null,
      isBlocked: !!user.blockedAt,
      blockedAt: user.blockedAt,
      blockedReason: user.blockedReason,
      balances: balances.map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })),
      deposits: deposits.map((d) => ({
        id: d.id,
        asset: d.asset,
        chain: d.chain,
        txHash: d.txHash,
        amount: d.amount.toString(),
        confirmations: d.confirmations,
        status: d.status,
        createdAt: d.createdAt,
      })),
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        asset: w.asset,
        network: w.network,
        toAddress: w.toAddress,
        amount: w.amount.toString(),
        status: w.status,
        txHash: w.txHash,
        rejectionReason: w.rejectionReason,
        createdAt: w.createdAt,
      })),
      orders: orders.map((o) => ({
        id: o.id,
        pair: o.pair,
        side: o.side,
        type: o.type,
        price: o.price?.toString() ?? null,
        originalQuantity: o.originalQuantity.toString(),
        remainingQuantity: o.remainingQuantity.toString(),
        status: o.status,
        createdAt: o.createdAt,
      })),
      purchases: purchases.map((p) => ({
        id: p.id,
        productName: p.product.name,
        amount: p.amount.toString(),
        asset: p.asset,
        status: p.status,
        createdAt: p.createdAt,
      })),
      kycSubmissions: kycSubmissions.map((k) => ({
        id: k.id,
        country: k.country,
        fullName: k.fullName,
        dateOfBirth: k.dateOfBirth,
        documentType: k.documentType,
        status: k.status,
        rejectionReason: k.rejectionReason,
        reviewedBy: k.reviewedBy,
        reviewedAt: k.reviewedAt,
        createdAt: k.createdAt,
      })),
    });
  });

  const adjustBalanceSchema = z.object({
    asset: z.string().min(1).max(10),
    amount: z.string().min(1),
    reason: z.string().trim().min(1).max(500),
  });

  // Manual correction of a user's available balance — always requires a
  // reason, which lands in AuditLog alongside the admin who made it (see
  // BalanceAdjustmentService). Not for routine crediting: that's what the
  // deposit-claim and manual-credit flows are for.
  router.post('/admin/users/:id/adjust-balance', requireAuth, requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = adjustBalanceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      const result = await balanceAdjustments.adjust({
        userId: req.params.id,
        asset: parsed.data.asset,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        performedByAdminId: req.userId!,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof BalanceAdjustmentError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to adjust balance' });
    }
  });

  const blockSchema = z.object({
    reason: z.string().trim().min(1).max(300),
  });

  // Locks the account out at login (see auth.ts) — for rule violations or
  // long-dormant accounts an admin decides to shut down without deleting
  // their history. Existing sessions still expire naturally rather than
  // being revoked mid-flight.
  router.post('/admin/users/:id/block', requireAuth, requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'ADMIN') return res.status(400).json({ error: 'Cannot block an admin account' });

    await prisma.user.update({
      where: { id: target.id },
      data: { blockedAt: new Date(), blockedReason: parsed.data.reason },
    });
    await prisma.auditLog.create({
      data: { userId: target.id, action: 'USER_BLOCKED', metadata: { reason: parsed.data.reason, performedByAdminId: req.userId } },
    });
    res.json({ ok: true });
  });

  router.post('/admin/users/:id/unblock', requireAuth, requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    await prisma.user.update({ where: { id: target.id }, data: { blockedAt: null, blockedReason: null } });
    await prisma.auditLog.create({
      data: { userId: target.id, action: 'USER_UNBLOCKED', metadata: { performedByAdminId: req.userId } },
    });
    res.json({ ok: true });
  });

  // Permanently removes an account, but only once it has zero financial
  // history to lose — no deposits, withdrawals, spot/futures orders, or
  // purchases. That's deliberately what makes this safe to offer as a
  // one-click "delete" rather than block: an account with real money
  // movement keeps its trail (compliance, disputes) and must be blocked
  // instead. AuditLog rows are left in place either way — they carry no DB
  // relation to User, so nothing here can orphan-break them.
  router.delete('/admin/users/:id', requireAuth, requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'ADMIN') return res.status(400).json({ error: 'Cannot delete an admin account' });

    const [deposits, withdrawals, orders, futuresOrders, futuresPositions, purchases] = await Promise.all([
      prisma.deposit.count({ where: { userId: target.id } }),
      prisma.withdrawal.count({ where: { userId: target.id } }),
      prisma.order.count({ where: { userId: target.id } }),
      prisma.futuresOrder.count({ where: { userId: target.id } }),
      prisma.futuresPosition.count({ where: { userId: target.id } }),
      prisma.purchase.count({ where: { userId: target.id } }),
    ]);
    if (deposits + withdrawals + orders + futuresOrders + futuresPositions + purchases > 0) {
      return res.status(400).json({
        error: 'У пользователя есть история операций (депозиты/выводы/ордера/покупки) — такой аккаунт можно только заблокировать, не удалить.',
      });
    }

    await prisma.$transaction([
      prisma.balance.deleteMany({ where: { userId: target.id } }),
      prisma.wallet.deleteMany({ where: { userId: target.id } }),
      prisma.kycSubmission.deleteMany({ where: { userId: target.id } }),
      prisma.apiKey.deleteMany({ where: { userId: target.id } }),
      prisma.futuresBalance.deleteMany({ where: { userId: target.id } }),
      // Support history is kept (guestName/guestEmail already carry it) —
      // just detached from the account being deleted.
      prisma.supportConversation.updateMany({ where: { userId: target.id }, data: { userId: null } }),
      prisma.auditLog.create({
        data: {
          userId: null,
          action: 'USER_DELETED',
          metadata: { deletedUserId: target.id, deletedEmail: target.email, performedByAdminId: req.userId },
        },
      }),
      prisma.user.delete({ where: { id: target.id } }),
    ]);

    res.json({ ok: true });
  });

  return router;
}
