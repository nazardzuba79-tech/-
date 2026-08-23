import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

/**
 * Admin's view into every registered account — the registration data,
 * verification status, and balances the admin panel's Users section needs,
 * plus (on the detail route) a client's full activity history. The
 * registration IP isn't a column on User; it's read back from the
 * USER_REGISTERED AuditLog entry auth.ts already writes on every sign-up.
 */
export function adminUsersRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/admin/users', requireAuth, requireAdmin(prisma), async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const [users, registrations, balances] = await Promise.all([
      prisma.user.findMany({
        where: search ? { email: { contains: search, mode: 'insensitive' } } : undefined,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.findMany({ where: { action: 'USER_REGISTERED' }, orderBy: { createdAt: 'asc' } }),
      prisma.balance.findMany(),
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

    res.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        isAdmin: u.role === 'ADMIN',
        kycStatus: u.kycStatus,
        createdAt: u.createdAt,
        registrationIp: registrationIpByUser.get(u.id) ?? null,
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

    const [registration, balances, deposits, withdrawals, orders, purchases, kycSubmissions] = await Promise.all([
      prisma.auditLog.findFirst({ where: { userId: id, action: 'USER_REGISTERED' }, orderBy: { createdAt: 'asc' } }),
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
        documentNumber: k.documentNumber,
        status: k.status,
        rejectionReason: k.rejectionReason,
        reviewedBy: k.reviewedBy,
        reviewedAt: k.reviewedAt,
        createdAt: k.createdAt,
      })),
    });
  });

  return router;
}
