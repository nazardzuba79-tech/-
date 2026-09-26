import { AdminUserDeletionService, UserDeletionError } from '../../services/AdminUserDeletionService';
import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { BalanceAdjustmentService, BalanceAdjustmentError } from '../../services/BalanceAdjustmentService';
import { DemoTradingService, DemoTradingError } from '../../services/DemoTradingService';

/**
 * Admin's view into every registered account — the registration data,
 * verification status, and balances the admin panel's Users section needs,
 * plus (on the detail route) a client's full activity history. Login times
 * come from Session; infrastructure IPs are not presented as client IPs.
 */
export function adminUsersRouter(prisma: PrismaClient, demoTrading: DemoTradingService, deletion?: AdminUserDeletionService): Router {
  const router = Router();
  const balanceAdjustments = new BalanceAdjustmentService(prisma);

  router.get('/admin/users', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const [users, balances, lastLogins] = await Promise.all([
      prisma.user.findMany({
        where: search ? { email: { contains: search, mode: 'insensitive' } } : undefined,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.balance.findMany(),
      prisma.session.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    ]);

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
        registrationIp: null,
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
  router.get('/admin/users/:id', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [lastLogin, balances, demoBalances, deposits, withdrawals, orders, purchases, kycSubmissions] = await Promise.all([
      prisma.session.findFirst({ where: { userId: id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.balance.findMany({ where: { userId: id } }),
      prisma.demoBalance.findMany({ where: { userId: id }, orderBy: { asset: 'asc' } }),
      prisma.deposit.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.withdrawal.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.order.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.purchase.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 100, include: { product: { select: { name: true } } } }),
      prisma.kycSubmission.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
    ]);

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      isAdmin: user.role === 'ADMIN',
      kycStatus: user.kycStatus,
      createdAt: user.createdAt,
      registrationIp: null,
      lastLoginAt: lastLogin?.createdAt ?? null,
      isBlocked: !!user.blockedAt,
      blockedAt: user.blockedAt,
      blockedReason: user.blockedReason,
      balances: balances.map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })),
      demoBalances: demoBalances.map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })),
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
  router.post('/admin/users/:id/adjust-balance', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
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

  const demoTopupSchema = z.object({
    asset: z.string().trim().min(1).max(10),
    amount: z.string().min(1),
    note: z.string().trim().max(500).optional(),
  });

  // Credits/debits the target account's DEMO balance only — a fully
  // separate ledger from adjust-balance above, never touches the real
  // Balance table or ReservesService. Single explicit :id from the form,
  // admin-only: no bulk/broadcast path exists here. Always logs to
  // AuditLog with reason "demo top-up" (see DemoTradingService.topUp).
  router.post('/admin/users/:id/demo-topup', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = demoTopupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      const result = await demoTrading.topUp({
        userId: req.params.id,
        asset: parsed.data.asset.toUpperCase(),
        amount: parsed.data.amount,
        note: parsed.data.note,
        performedByAdminId: req.userId!,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof DemoTradingError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to adjust demo balance' });
    }
  });

  const blockSchema = z.object({
    reason: z.string().trim().min(1).max(300),
  });

  // Locks the account out at login (see auth.ts) — for rule violations or
  // long-dormant accounts an admin decides to shut down without deleting
  // their history. Existing sessions still expire naturally rather than
  // being revoked mid-flight.
  router.post('/admin/users/:id/block', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
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

  router.post('/admin/users/:id/unblock', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    await prisma.user.update({ where: { id: target.id }, data: { blockedAt: null, blockedReason: null } });
    await prisma.auditLog.create({
      data: { userId: target.id, action: 'USER_UNBLOCKED', metadata: { performedByAdminId: req.userId } },
    });
    res.json({ ok: true });
  });

  router.delete('/admin/users/:id', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    if (!deletion) return res.status(503).json({ error: 'Account deletion is not configured' });
    try {
      return res.json(await deletion.delete(req.userId!, req.params.id));
    } catch (error: any) {
      if (error instanceof UserDeletionError) return res.status(error.status).json({ error: error.message });
      if (error?.code === 'P2034' || error?.code === 'P2025') return res.status(409).json({ error: 'Аккаунт изменился. Обновите список и повторите попытку.' });
      // Avoid logging user metadata or query parameters on destructive-operation errors.
      console.error('Admin account deletion failed', { code: error?.code ?? 'UNKNOWN' });
      return res.status(500).json({ error: 'Не удалось завершить удаление. Обновите список и повторите попытку.' });
    }
  });

  return router;
}
