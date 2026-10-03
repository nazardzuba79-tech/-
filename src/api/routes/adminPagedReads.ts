import { Router } from 'express';
import { Prisma, PrismaClient, User, KycSubmission, AuditLog } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../asyncRoute';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { decryptAdminPassword } from '../../services/AdminPasswordVault';
import { latestDepositCopiesForUsers } from '../../services/deposits/latestDepositCopiesForUsers';

const paging = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const userQuery = paging.extend({
  search: z.string().trim().max(200).default(''),
  status: z.enum(['all', 'blocked', 'active', 'kyc-pending', 'new']).default('all'),
  sort: z.enum(['createdAt', 'email', 'lastLoginAt']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
const kycQuery = paging.extend({
  search: z.string().trim().max(200).default(''),
  status: z.enum(['all', 'NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED']).default('all'),
  from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
}).refine(q => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), 'Invalid date range');
const withdrawalQuery = paging.extend({ search: z.string().trim().max(200).default(''),
  status: z.enum(['all', 'active', 'processed', 'PENDING', 'APPROVED', 'SENT', 'REJECTED', 'COMPLETED']).default('all') });
const date = z.string().datetime({ offset: true }).optional();
const auditQuery = paging.extend({
  search: z.string().trim().max(200).default(''), action: z.string().trim().max(100).optional(),
  userId: z.string().trim().max(100).optional(), from: date, to: date,
}).refine(q => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), 'Invalid date range');
const historyQuery = paging.extend({ kind: z.enum(['deposits', 'withdrawals', 'orders', 'futuresOrders', 'futuresPositions', 'cfdPositions', 'purchases', 'kyc', 'audit']) });
const stableOrder = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
const literalContains = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const pageResult = (items: unknown[], total: number, q: { page: number; pageSize: number }) => ({
  items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), asOf: new Date().toISOString(),
});
const identity = (u: User) => ({ id: u.id, email: u.email, role: u.role, isAdmin: u.role === 'ADMIN',
  kycStatus: u.kycStatus, createdAt: u.createdAt, registrationIp: null, isBlocked: !!u.blockedAt,
  blockedAt: u.blockedAt, blockedReason: u.blockedReason });
const balanceView = (b: { asset: string; available: { toString(): string }; locked: { toString(): string } }) => ({
  asset: b.asset, available: b.available.toString(), locked: b.locked.toString(),
});
const kycView = (k: KycSubmission) => ({ id: k.id, country: k.country, fullName: k.fullName,
  dateOfBirth: k.dateOfBirth, documentType: k.documentType, status: k.status, rejectionReason: k.rejectionReason,
  reviewedBy: k.reviewedBy, reviewedAt: k.reviewedAt, createdAt: k.createdAt,
  documentDelivery: k.documentDelivery === 'EMAIL' ? 'EMAIL' : k.documentImagePath ? 'LEGACY_FILE' : 'NONE',
  emailMessageId: k.emailMessageId, documentMimeType: k.documentMimeType, documentSizeBytes: k.documentSizeBytes });

/** Audit details remain inspectable without returning credentials accidentally recorded in metadata. */
export function redactAuditMetadata(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[Ограничена вложенность]';
  if (Array.isArray(value)) return value.map(v => redactAuditMetadata(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /password|passwd|secret|token|authorization|private.?key|seed|mnemonic|database.?url|cookie/i.test(key)
      ? '[Скрыто]' : redactAuditMetadata(item, depth + 1)]));
  if (typeof value === 'string') return value.replace(/\bBearer\s+\S+/gi, 'Bearer [Скрыто]')
    .replace(/\b(postgres(?:ql)?):\/\/[^\s]+/gi, '$1://[Скрыто]');
  return value;
}

async function auditViews(prisma: PrismaClient, entries: AuditLog[]) {
  const actor = (e: AuditLog) => {
    const m = e.metadata as { performedByAdminId?: string; reviewedBy?: string } | null;
    return m?.performedByAdminId ?? m?.reviewedBy;
  };
  const ids = [...new Set(entries.flatMap(e => [e.userId, actor(e)]).filter((x): x is string => typeof x === 'string'))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
  const email = new Map(users.map(u => [u.id, u.email]));
  return entries.map(e => ({ id: e.id, userId: e.userId, userEmail: e.userId ? email.get(e.userId) ?? null : null,
    action: e.action, metadata: redactAuditMetadata(e.metadata), performedByAdminEmail: email.get(actor(e) ?? '') ?? null,
    createdAt: e.createdAt }));
}

/** Additive paged read contracts. Legacy callers keep their existing response shapes. */
export function adminPagedReadsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const gate = [requireAuth(prisma), requireAdmin(prisma)];
  router.get('/admin/users/page', ...gate, asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = userQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Недопустимые параметры списка' });
    const q = parsed.data, since = new Date(Date.now() - 86_400_000);
    const where: Prisma.UserWhereInput = { role: 'USER',
      ...(q.search ? { OR: [{ email: { contains: literalContains(q.search), mode: 'insensitive' } }, { id: { contains: literalContains(q.search), mode: 'insensitive' } }] } : {}),
      ...(q.status === 'blocked' ? { blockedAt: { not: null } } : q.status === 'active' ? { blockedAt: null }
        : q.status === 'kyc-pending' ? { kycStatus: 'PENDING' } : q.status === 'new' ? { createdAt: { gte: since } } : {}),
    };
    const total = await prisma.user.count({ where });
    let users: User[];
    if (q.sort === 'lastLoginAt') {
      // Only the requested IDs cross the DB boundary. Sort SQL is selected from a fixed enum.
      const direction = q.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
      const filters = [Prisma.sql`u."role" = 'USER'`];
      if (q.search) filters.push(Prisma.sql`(strpos(lower(u."email"), lower(${q.search})) > 0 OR strpos(lower(u."id"), lower(${q.search})) > 0)`);
      if (q.status === 'blocked') filters.push(Prisma.sql`u."blockedAt" IS NOT NULL`);
      if (q.status === 'active') filters.push(Prisma.sql`u."blockedAt" IS NULL`);
      if (q.status === 'kyc-pending') filters.push(Prisma.sql`u."kycStatus" = 'PENDING'`);
      if (q.status === 'new') filters.push(Prisma.sql`u."createdAt" >= ${since}`);
      const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT u."id" FROM "User" u
        LEFT JOIN LATERAL (SELECT max(s."createdAt") AS last_login FROM "Session" s WHERE s."userId" = u."id") l ON true
        WHERE ${Prisma.join(filters, ' AND ')} ORDER BY l.last_login ${direction} NULLS LAST, u."id" ${direction}
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`);
      const rows = ids.length ? await prisma.user.findMany({ where: { id: { in: ids.map(x => x.id) }, role: 'USER' }, take: q.pageSize }) : [];
      const byId = new Map(rows.map(x => [x.id, x]));
      users = ids.map(x => byId.get(x.id)).filter((u): u is User => !!u);
    } else users = await prisma.user.findMany({ where, orderBy: [{ [q.sort]: q.direction }, { id: q.direction }], skip: (q.page - 1) * q.pageSize, take: q.pageSize });
    const ids = users.map(u => u.id);
    const [balances, logins, copies] = await Promise.all([
      ids.length ? prisma.balance.findMany({ where: { userId: { in: ids } } }) : [],
      ids.length ? prisma.session.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { createdAt: true } }) : [],
      latestDepositCopiesForUsers(prisma, ids),
    ]);
    // Preserve the owner-only password vault behavior exactly; never read other pages' vault entries.
    const passwords = new Map<string, string>();
    if (process.env.PRIVATE_TRADING_OWNER_ID && req.userId === process.env.PRIVATE_TRADING_OWNER_ID && ids.length) {
      const records = await prisma.adminPasswordVault.findMany({ where: { userId: { in: ids } } });
      const emails = new Map(users.map(u => [u.id, u.email]));
      for (const record of records) { const email = emails.get(record.userId); if (email) {
        try { passwords.set(record.userId, decryptAdminPassword(record.encryptedPassword, email)); } catch { /* same damaged-record handling as legacy */ }
      } }
    }
    const lastLogin = new Map(logins.map(x => [x.userId, x._max.createdAt]));
    const items = users.map(u => ({ ...identity(u), password: passwords.get(u.id) ?? null,
      lastLoginAt: lastLogin.get(u.id) ?? null, lastDepositCopy: copies.byUser.get(u.id) ?? null,
      depositCopyLookupFailed: copies.failed, balances: balances.filter(b => b.userId === u.id).map(balanceView) }));
    res.set('Cache-Control', 'private, no-store').json(pageResult(items, total, q));
  }));

  router.get('/admin/users/:id/profile', ...gate, asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const [lastLogin, balances, demoBalances] = await Promise.all([
      prisma.session.findFirst({ where: { userId: user.id }, orderBy: stableOrder, select: { createdAt: true } }),
      prisma.balance.findMany({ where: { userId: user.id }, orderBy: { asset: 'asc' } }),
      prisma.demoBalance.findMany({ where: { userId: user.id }, orderBy: { asset: 'asc' } }),
    ]);
    res.set('Cache-Control', 'private, no-store').json({ ...identity(user), lastLoginAt: lastLogin?.createdAt ?? null,
      balances: balances.map(balanceView), demoBalances: demoBalances.map(balanceView), asOf: new Date().toISOString() });
  }));

  router.get('/admin/withdrawals/page', ...gate, asyncRoute(async (req, res) => {
    const parsed = withdrawalQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Недопустимые параметры очереди' });
    const q = parsed.data, search = { contains: literalContains(q.search), mode: 'insensitive' as const };
    const where: Prisma.WithdrawalWhereInput = {
      ...(q.status === 'all' ? {} : { status: q.status === 'active' ? { in: ['PENDING', 'APPROVED'] }
        : q.status === 'processed' ? { in: ['SENT', 'REJECTED', 'COMPLETED'] } : q.status }),
      ...(q.search ? { OR: [{ id: search }, { userId: search }, { asset: search }, { network: search },
        { toAddress: search }, { txHash: search }, { user: { email: search } }] } : {}),
    };
    const [rows, total] = await Promise.all([prisma.withdrawal.findMany({ where, skip: (q.page - 1) * q.pageSize,
      take: q.pageSize, orderBy: stableOrder, include: { user: { select: { email: true } } } }), prisma.withdrawal.count({ where })]);
    res.set('Cache-Control', 'private, no-store').json(pageResult(rows.map(w => ({ id: w.id, userId: w.userId,
      userEmail: w.user?.email ?? 'Удалённый аккаунт', asset: w.asset, network: w.network, toAddress: w.toAddress,
      amount: w.amount.toString(), status: w.status, txHash: w.txHash, rejectionReason: w.rejectionReason,
      performedByAdminId: w.performedByAdminId, balanceHeld: w.balanceHeld, createdAt: w.createdAt, updatedAt: w.updatedAt,
    })), total, q));
  }));

  router.get('/admin/users/:id/history', ...gate, asyncRoute(async (req, res) => {
    const parsed = historyQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Недопустимый раздел истории' });
    const q = parsed.data;
    if (!await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } })) return res.status(404).json({ error: 'Пользователь не найден' });
    const where = { userId: req.params.id }, args = { where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: stableOrder };
    let items: unknown[], total: number;
    switch (q.kind) {
      case 'deposits': {
        const [rows, count] = await Promise.all([prisma.deposit.findMany(args), prisma.deposit.count({ where })]); total = count;
        items = rows.map(d => ({ id: d.id, asset: d.asset, chain: d.chain, txHash: d.txHash, amount: d.amount.toString(), confirmations: d.confirmations, status: d.status, createdAt: d.createdAt })); break;
      }
      case 'withdrawals': {
        const [rows, count] = await Promise.all([prisma.withdrawal.findMany(args), prisma.withdrawal.count({ where })]); total = count;
        items = rows.map(w => ({ id: w.id, asset: w.asset, network: w.network, toAddress: w.toAddress, amount: w.amount.toString(), status: w.status, txHash: w.txHash, rejectionReason: w.rejectionReason, createdAt: w.createdAt })); break;
      }
      case 'orders': {
        const [rows, count] = await Promise.all([prisma.order.findMany(args), prisma.order.count({ where })]); total = count;
        items = rows.map(o => ({ id: o.id, pair: o.pair, side: o.side, type: o.type, price: o.price?.toString() ?? null, originalQuantity: o.originalQuantity.toString(), remainingQuantity: o.remainingQuantity.toString(), status: o.status, createdAt: o.createdAt })); break;
      }
      case 'futuresOrders': {
        const [rows, count] = await Promise.all([prisma.futuresOrder.findMany(args), prisma.futuresOrder.count({ where })]); total = count;
        items = rows.map(o => ({ id: o.id, symbol: o.symbol, side: o.side, type: o.type, price: o.price?.toString() ?? null,
          originalQuantity: o.originalQuantity.toString(), remainingQuantity: o.remainingQuantity.toString(), status: o.status,
          leverage: o.leverage, marginType: o.marginType, reduceOnly: o.reduceOnly, createdAt: o.createdAt })); break;
      }
      case 'futuresPositions': {
        const positionArgs = { ...args, orderBy: [{ openedAt: 'desc' as const }, { id: 'desc' as const }] };
        const [rows, count] = await Promise.all([prisma.futuresPosition.findMany(positionArgs), prisma.futuresPosition.count({ where })]); total = count;
        items = rows.map(p => ({ id: p.id, symbol: p.symbol, side: p.side, size: p.size.toString(), entryPrice: p.entryPrice.toString(),
          leverage: p.leverage, marginType: p.marginType, initialMargin: p.initialMargin.toString(), liquidationPrice: p.liquidationPrice.toString(),
          status: p.status, realizedPnl: p.realizedPnl.toString(), openedAt: p.openedAt, closedAt: p.closedAt })); break;
      }
      case 'cfdPositions': {
        const positionArgs = { ...args, orderBy: [{ openedAt: 'desc' as const }, { id: 'desc' as const }] };
        const [rows, count] = await Promise.all([prisma.cfdPosition.findMany(positionArgs), prisma.cfdPosition.count({ where })]); total = count;
        items = rows.map(p => ({ id: p.id, symbol: p.symbol, side: p.side, size: p.size.toString(), entryPrice: p.entryPrice.toString(),
          leverage: p.leverage, initialMargin: p.initialMargin.toString(), liquidationPrice: p.liquidationPrice.toString(),
          status: p.status, realizedPnl: p.realizedPnl.toString(), openedAt: p.openedAt, closedAt: p.closedAt })); break;
      }
      case 'purchases': {
        const [rows, count] = await Promise.all([prisma.purchase.findMany({ ...args, include: { product: { select: { name: true } } } }), prisma.purchase.count({ where })]); total = count;
        items = rows.map(p => ({ id: p.id, productName: p.product.name, amount: p.amount.toString(), asset: p.asset, status: p.status, createdAt: p.createdAt })); break;
      }
      case 'kyc': {
        const [rows, count] = await Promise.all([prisma.kycSubmission.findMany(args), prisma.kycSubmission.count({ where })]); total = count; items = rows.map(kycView); break;
      }
      case 'audit': {
        const [rows, count] = await Promise.all([prisma.auditLog.findMany(args), prisma.auditLog.count({ where })]); total = count; items = await auditViews(prisma, rows); break;
      }
    }
    res.set('Cache-Control', 'private, no-store').json(pageResult(items!, total!, q));
  }));

  router.get('/admin/clients/page', ...gate, asyncRoute(async (req, res) => {
    const parsed = kycQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Недопустимые параметры списка' });
    const q = parsed.data;
    const where: Prisma.UserWhereInput = { ...(q.status !== 'all' ? { kycStatus: q.status } : {}),
      ...(q.search ? { OR: [{ email: { contains: literalContains(q.search), mode: 'insensitive' } }, { id: { contains: literalContains(q.search), mode: 'insensitive' } }] } : {}) };
    let rows: User[], total: number;
    if (q.from || q.to) {
      const filters = [Prisma.sql`true`];
      if (q.status !== 'all') filters.push(Prisma.sql`u."kycStatus"::text = ${q.status}`);
      if (q.search) filters.push(Prisma.sql`(strpos(lower(u."email"), lower(${q.search})) > 0 OR strpos(lower(u."id"), lower(${q.search})) > 0)`);
      if (q.from) filters.push(Prisma.sql`latest."createdAt" >= ${new Date(q.from)}`);
      if (q.to) filters.push(Prisma.sql`latest."createdAt" <= ${new Date(q.to)}`);
      const source = Prisma.sql`FROM "User" u CROSS JOIN LATERAL (
        SELECT s."createdAt" FROM "KycSubmission" s WHERE s."userId" = u."id"
        ORDER BY s."createdAt" DESC, s."id" DESC LIMIT 1
      ) latest WHERE ${Prisma.join(filters, ' AND ')}`;
      const [counts, ids] = await Promise.all([
        prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total ${source}`),
        prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT u."id" ${source} ORDER BY u."createdAt" DESC, u."id" DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
      ]);
      total = Number(counts[0]?.total ?? 0);
      const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids.map(x => x.id) } }, take: q.pageSize }) : [];
      const byId = new Map(users.map(u => [u.id, u]));
      rows = ids.map(x => byId.get(x.id)).filter((u): u is User => !!u);
    } else [rows, total] = await Promise.all([prisma.user.findMany({ where, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      orderBy: stableOrder }), prisma.user.count({ where })]);
    // Prisma's query relation strategy can fetch every child of the page's users
    // before applying nested take. LATERAL LIMIT 1 bounds rows inside PostgreSQL.
    const latest = rows.length ? await prisma.$queryRaw<KycSubmission[]>(Prisma.sql`
      SELECT k.* FROM "User" u CROSS JOIN LATERAL (
        SELECT s.* FROM "KycSubmission" s WHERE s."userId" = u."id"
        ORDER BY s."createdAt" DESC, s."id" DESC LIMIT 1
      ) k WHERE u."id" IN (${Prisma.join(rows.map(u => u.id))})`) : [];
    const latestByUser = new Map(latest.map(k => [k.userId, k]));
    res.set('Cache-Control', 'private, no-store').json(pageResult(rows.map(u => ({ ...identity(u), latestKyc: latestByUser.has(u.id) ? kycView(latestByUser.get(u.id)!) : null })), total, q));
  }));

  router.get('/admin/audit-log/page', ...gate, asyncRoute(async (req, res) => {
    const parsed = auditQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Недопустимые параметры журнала' });
    const q = parsed.data;
    const where: Prisma.AuditLogWhereInput = { ...(q.action ? { action: q.action } : {}), ...(q.userId ? { userId: q.userId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ id: { contains: literalContains(q.search), mode: 'insensitive' } }, { action: { contains: literalContains(q.search), mode: 'insensitive' } }, { userId: { contains: literalContains(q.search), mode: 'insensitive' } }] } : {}),
    };
    let rows: AuditLog[], total: number;
    if (q.search) {
      const filters = [Prisma.sql`(strpos(lower(a."id"), lower(${q.search})) > 0
        OR strpos(lower(a."action"), lower(${q.search})) > 0
        OR strpos(lower(coalesce(a."userId", '')), lower(${q.search})) > 0
        OR strpos(lower(coalesce(target."email", '')), lower(${q.search})) > 0
        OR strpos(lower(coalesce(actor."email", '')), lower(${q.search})) > 0)`];
      if (q.action) filters.push(Prisma.sql`a."action" = ${q.action}`);
      if (q.userId) filters.push(Prisma.sql`a."userId" = ${q.userId}`);
      if (q.from) filters.push(Prisma.sql`a."createdAt" >= ${new Date(q.from)}`);
      if (q.to) filters.push(Prisma.sql`a."createdAt" <= ${new Date(q.to)}`);
      const source = Prisma.sql`FROM "AuditLog" a LEFT JOIN "User" target ON target."id" = a."userId"
        LEFT JOIN "User" actor ON actor."id" = coalesce(a."metadata"->>'performedByAdminId', a."metadata"->>'reviewedBy')
        WHERE ${Prisma.join(filters, ' AND ')}`;
      const [counts, entries] = await Promise.all([
        prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total ${source}`),
        prisma.$queryRaw<AuditLog[]>(Prisma.sql`SELECT a.* ${source} ORDER BY a."createdAt" DESC, a."id" DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
      ]);
      rows = entries; total = Number(counts[0]?.total ?? 0);
    } else [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: stableOrder }), prisma.auditLog.count({ where })]);
    res.set('Cache-Control', 'private, no-store').json(pageResult(await auditViews(prisma, rows), total, q));
  }));
  return router;
}
