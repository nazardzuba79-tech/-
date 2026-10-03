import { randomUUID } from 'crypto';
import { asyncRoute } from '../asyncRoute';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { DEPOSIT_RAILS, railKey, validAddress } from '../../services/depositCatalogue/registry';
import { unresolvedCopy } from '../../services/deposits/depositCopyResolution';
import { markWriteWithoutBackgroundWork } from '../../services/BackgroundWorkCoordinator';
import { KNOWN_CHAINS } from './deposits';
import { mountDepositCopyReview } from './adminDepositCopyReview';

/**
 * «Копировали адрес»: a signed-in browser reports that its «Скопировать
 * адрес» button put this deposit address on the clipboard.
 *
 * The note proves nothing about money. Anyone signed in can send it, for any
 * address the dialog can show, as often as the limits allow; the transfer
 * that arrives later may be someone else's. Nothing here attributes or
 * credits money. A successful manual credit may close older captured notes
 * for its own user/rail; notes never determine the credit recipient/amount.
 * The admin reads them beside the real incoming transfers and decides by hand.
 */

export const DEPOSIT_COPY_PATH = '/deposit-address-copies';
export const DEPOSIT_COPY_SOURCES = ['wallet', 'header', 'otc', 'support'] as const;
export const DEPOSIT_COPY_PAGE_SIZE = 25;

/** The one request the app-wide limiter leaves to this route's own limits. */
export function isDepositCopyEventRequest(req: Request): boolean {
  return req.method === 'POST' && req.path.replace(/\/+$/, '').toLowerCase() === `/api/v1${DEPOSIT_COPY_PATH}`;
}

/** How far the device clock may sit from ours before its time is not shown. */
const CLIENT_CLOCK_PAST_MS = 24 * 60 * 60_000 + 5 * 60_000;
const CLIENT_CLOCK_FUTURE_MS = 5 * 60_000;

const eventSchema = z.object({
  eventId: z.string().uuid(),
  asset: z.string().regex(/^[A-Z0-9]{1,15}$/),
  network: z.string().regex(/^[a-z0-9-]{2,40}$/),
  destinationId: z.string().regex(/^[a-z0-9-]{1,80}(:[a-z0-9-]{1,40})?$/).optional(),
  address: z.string().min(1).max(256),
  memo: z.string().max(128).regex(/^[^<>\x00-\x1f\x7f]*$/).optional(),
  source: z.enum(DEPOSIT_COPY_SOURCES),
  clientCopiedAt: z.string().datetime().optional(),
}).strict();
type CopyEvent = z.infer<typeof eventSchema>;

/**
 * The address must be one the dialog can show: an asset/network rail from the
 * catalogue registry, or a chain of the treasury-based dialog, with the
 * address in that network's format. Shape only — no RPC, no catalogue read,
 * and an address an admin has since rotated away is still accepted as what
 * the user really copied.
 */
function destinationProblem(event: CopyEvent): string | null {
  const rail = DEPOSIT_RAILS.find(r => r.asset === event.asset && r.networkId === event.network);
  const legacy = KNOWN_CHAINS.includes(event.network);
  if (!rail && !legacy) return 'Unknown asset/network';
  // The catalogue dialog names a rail (`tether:tron`), the treasury one a chain.
  const destinations = rail ? [railKey(rail), event.network] : [event.network];
  if (event.destinationId !== undefined && !destinations.includes(event.destinationId)) return 'Destination does not match asset/network';
  if (!validAddress(event.network, event.address)) return 'Invalid address format';
  if (event.memo) {
    if (!rail?.memoAllowed) return 'Memo not supported on this network';
    if (event.network === 'xrp' && (!/^\d{1,10}$/.test(event.memo) || BigInt(event.memo) > 4294967295n)) return 'Invalid destination tag';
  }
  return null;
}

/** The device's time as an ISO string, or null when it is far from ours. */
function shownClientTime(value: string | undefined, now: number): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && at >= now - CLIENT_CLOCK_PAST_MS && at <= now + CLIENT_CLOCK_FUTURE_MS ? new Date(at).toISOString() : null;
}

interface StoredRow {
  id: string; asset: string; network: string; destinationId: string | null; addressSnapshot: string;
  memoSnapshot: string | null; source: string; receivedAt: Date;
}

const samePayload = (row: StoredRow, event: CopyEvent) =>
  row.asset === event.asset && row.network === event.network && row.destinationId === (event.destinationId ?? null)
  && row.addressSnapshot === event.address && row.memoSnapshot === (event.memo || null) && row.source === event.source;

const listQuery = z.object({
  before: z.string().max(200).optional(),
  user: z.string().trim().max(120).optional(),
  asset: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,15}$/).optional().or(z.literal('').transform(() => undefined)),
});

/** «TRON» + «TRC-20» for the journal, from the same rail registry. */
function networkLabel(asset: string, network: string): { networkName: string; standard: string | null } {
  const rail = DEPOSIT_RAILS.find(r => r.asset === asset && r.networkId === network);
  const anyOnNetwork = rail ?? DEPOSIT_RAILS.find(r => r.networkId === network);
  return { networkName: anyOnNetwork?.networkName ?? network, standard: rail?.standard ?? null };
}

function decodeCursor(value: string): { at: Date; id: string } | null {
  try {
    const [at, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
    const date = new Date(at);
    return Number.isFinite(date.getTime()) && /^[0-9a-f-]{36}$/.test(id ?? '') ? { at: date, id } : null;
  } catch { return null; }
}
const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');

export function depositAddressCopiesRouter(prisma: PrismaClient): Router {
  const router = Router();
  mountDepositCopyReview(router, prisma);

  // Its own small budgets, outside the app-wide 120/min: a copy note never
  // spends a trader's request budget, and a flood of notes stops here. The
  // address limiter runs before auth so a flood costs no session lookup.
  const perAddress = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const perAccount = rateLimit({
    windowMs: 10 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `user:${(req as AuthedRequest).userId}`,
  });

  router.post(DEPOSIT_COPY_PATH, perAddress, requireAuth(prisma), perAccount, asyncRoute(async (req: AuthedRequest, res) => {
    // Written below; never wakes the sleeping background loops.
    markWriteWithoutBackgroundWork(res);
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid copy event' });
    const event = parsed.data;
    const problem = destinationProblem(event);
    if (problem) return res.status(400).json({ error: problem });
    const userId = req.userId!;
    const clientCopiedAt = shownClientTime(event.clientCopiedAt, Date.now());

    // One statement for the usual case. receivedAt is the database's clock in
    // UTC. A retried eventId inserts nothing and keeps its first receivedAt,
    // so a retry never moves a row up the list.
    const inserted = await prisma.$queryRaw<{ id: string; receivedAt: Date }[]>`
      INSERT INTO "DepositAddressCopyEvent"
        ("id", "eventId", "userId", "asset", "network", "destinationId", "addressSnapshot", "memoSnapshot", "source", "receivedAt", "clientCopiedAt")
      VALUES (${randomUUID()}, ${event.eventId}, ${userId}, ${event.asset}, ${event.network}, ${event.destinationId ?? null},
        ${event.address}, ${event.memo || null}, ${event.source}, now() AT TIME ZONE 'UTC', ${clientCopiedAt}::timestamptz AT TIME ZONE 'UTC')
      ON CONFLICT ("userId", "eventId") DO NOTHING
      RETURNING "id", "receivedAt"`;
    res.set('Cache-Control', 'no-store');
    if (inserted.length) return res.status(201).json({ id: inserted[0].id, receivedAt: inserted[0].receivedAt, duplicate: false });

    const existing = await prisma.depositAddressCopyEvent.findUnique({
      where: { userId_eventId: { userId, eventId: event.eventId } },
      select: { id: true, asset: true, network: true, destinationId: true, addressSnapshot: true, memoSnapshot: true, source: true, receivedAt: true },
    });
    if (!existing) return res.status(409).json({ error: 'Copy event conflict' });
    if (!samePayload(existing, event)) return res.status(409).json({ error: 'This event ID was already used for another address' });
    return res.status(200).json({ id: existing.id, receivedAt: existing.receivedAt, duplicate: true });
  }));

  // Admin journal: one page of 25, newest first, with the account's email and
  // name from the same query. Read only when the admin opens the section or
  // asks for more; nothing polls it.
  router.get('/admin/deposit-address-copies', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid filter' });
    const { before, user, asset } = parsed.data;
    const cursor = before ? decodeCursor(before) : null;
    if (before && !cursor) return res.status(400).json({ error: 'Invalid cursor' });

    // This screen is an operational queue, not the immutable audit history.
    // Credited/ignored copy events remain in DepositAddressCopyEvent + AuditLog,
    // but must not return to the admin after refresh.
    const where: Prisma.Sql[] = [unresolvedCopy];
    if (cursor) where.push(Prisma.sql`(e."receivedAt", e."id") < (${cursor.at.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${cursor.id})`);
    if (asset) where.push(Prisma.sql`e."asset" = ${asset}`);
    if (user) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user)) where.push(Prisma.sql`e."userId" = ${user.toLowerCase()}`);
      else {
        const like = `%${user.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(Prisma.sql`(u."email" ILIKE ${like} OR u."displayName" ILIKE ${like})`);
      }
    }
    const rows = await prisma.$queryRaw<(StoredRow & { userId: string; email: string; displayName: string | null; clientCopiedAt: Date | null })[]>`
      SELECT e."id", e."userId", e."asset", e."network", e."destinationId", e."addressSnapshot", e."memoSnapshot", e."source",
             e."receivedAt", e."clientCopiedAt", u."email", u."displayName"
      FROM "DepositAddressCopyEvent" e
      JOIN "User" u ON u."id" = e."userId"
      ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty}
      ORDER BY e."receivedAt" DESC, e."id" DESC
      LIMIT ${DEPOSIT_COPY_PAGE_SIZE + 1}`;
    const page = rows.slice(0, DEPOSIT_COPY_PAGE_SIZE);
    const last = page[page.length - 1];
    res.set('Cache-Control', 'private, no-store');
    res.json({
      asOf: new Date().toISOString(),
      items: page.map((r) => ({
        id: r.id, userId: r.userId, email: r.email, displayName: r.displayName,
        asset: r.asset, network: r.network, destinationId: r.destinationId, ...networkLabel(r.asset, r.network),
        address: r.addressSnapshot, memo: r.memoSnapshot, source: r.source,
        receivedAt: r.receivedAt.toISOString(), clientCopiedAt: r.clientCopiedAt ? r.clientCopiedAt.toISOString() : null,
      })),
      nextCursor: rows.length > DEPOSIT_COPY_PAGE_SIZE && last ? encodeCursor(last.receivedAt, last.id) : null,
    });
  }));

  return router;
}
