"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEPOSIT_COPY_PAGE_SIZE = exports.DEPOSIT_COPY_SOURCES = exports.DEPOSIT_COPY_PATH = void 0;
exports.isDepositCopyEventRequest = isDepositCopyEventRequest;
exports.depositAddressCopiesRouter = depositAddressCopiesRouter;
const crypto_1 = require("crypto");
const asyncRoute_1 = require("../asyncRoute");
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const admin_1 = require("../middleware/admin");
const registry_1 = require("../../services/depositCatalogue/registry");
const depositCopyResolution_1 = require("../../services/deposits/depositCopyResolution");
const BackgroundWorkCoordinator_1 = require("../../services/BackgroundWorkCoordinator");
const TelegramNotifications_1 = require("../../services/TelegramNotifications");
const deposits_1 = require("./deposits");
const adminDepositCopyReview_1 = require("./adminDepositCopyReview");
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
exports.DEPOSIT_COPY_PATH = '/deposit-address-copies';
exports.DEPOSIT_COPY_SOURCES = ['wallet', 'header', 'otc', 'support'];
exports.DEPOSIT_COPY_PAGE_SIZE = 25;
/** The one request the app-wide limiter leaves to this route's own limits. */
function isDepositCopyEventRequest(req) {
    return req.method === 'POST' && req.path.replace(/\/+$/, '').toLowerCase() === `/api/v1${exports.DEPOSIT_COPY_PATH}`;
}
/** How far the device clock may sit from ours before its time is not shown. */
const CLIENT_CLOCK_PAST_MS = 24 * 60 * 60_000 + 5 * 60_000;
const CLIENT_CLOCK_FUTURE_MS = 5 * 60_000;
const eventSchema = zod_1.z.object({
    eventId: zod_1.z.string().uuid(),
    asset: zod_1.z.string().regex(/^[A-Z0-9]{1,15}$/),
    network: zod_1.z.string().regex(/^[a-z0-9-]{2,40}$/),
    destinationId: zod_1.z.string().regex(/^[a-z0-9-]{1,80}(:[a-z0-9-]{1,40})?$/).optional(),
    address: zod_1.z.string().min(1).max(256),
    memo: zod_1.z.string().max(128).regex(/^[^<>\x00-\x1f\x7f]*$/).optional(),
    source: zod_1.z.enum(exports.DEPOSIT_COPY_SOURCES),
    clientCopiedAt: zod_1.z.string().datetime().optional(),
}).strict();
/**
 * The address must be one the dialog can show: an asset/network rail from the
 * catalogue registry, or a chain of the treasury-based dialog, with the
 * address in that network's format. Shape only — no RPC, no catalogue read,
 * and an address an admin has since rotated away is still accepted as what
 * the user really copied.
 */
function destinationProblem(event) {
    const rail = registry_1.DEPOSIT_RAILS.find(r => r.asset === event.asset && r.networkId === event.network);
    const legacy = deposits_1.KNOWN_CHAINS.includes(event.network);
    if (!rail && !legacy)
        return 'Unknown asset/network';
    // The catalogue dialog names a rail (`tether:tron`), the treasury one a chain.
    const destinations = rail ? [(0, registry_1.railKey)(rail), event.network] : [event.network];
    if (event.destinationId !== undefined && !destinations.includes(event.destinationId))
        return 'Destination does not match asset/network';
    if (!(0, registry_1.validAddress)(event.network, event.address))
        return 'Invalid address format';
    if (event.memo) {
        if (!rail?.memoAllowed)
            return 'Memo not supported on this network';
        if (event.network === 'xrp' && (!/^\d{1,10}$/.test(event.memo) || BigInt(event.memo) > 4294967295n))
            return 'Invalid destination tag';
    }
    return null;
}
/** The device's time as an ISO string, or null when it is far from ours. */
function shownClientTime(value, now) {
    if (!value)
        return null;
    const at = Date.parse(value);
    return Number.isFinite(at) && at >= now - CLIENT_CLOCK_PAST_MS && at <= now + CLIENT_CLOCK_FUTURE_MS ? new Date(at).toISOString() : null;
}
const samePayload = (row, event) => row.asset === event.asset && row.network === event.network && row.destinationId === (event.destinationId ?? null)
    && row.addressSnapshot === event.address && row.memoSnapshot === (event.memo || null) && row.source === event.source;
const listQuery = zod_1.z.object({
    countOnly: zod_1.z.enum(['true', 'false']).optional(),
    before: zod_1.z.string().max(200).optional(),
    user: zod_1.z.string().trim().max(120).optional(),
    asset: zod_1.z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,15}$/).optional().or(zod_1.z.literal('').transform(() => undefined)),
});
/** «TRON» + «TRC-20» for the journal, from the same rail registry. */
function networkLabel(asset, network) {
    const rail = registry_1.DEPOSIT_RAILS.find(r => r.asset === asset && r.networkId === network);
    const anyOnNetwork = rail ?? registry_1.DEPOSIT_RAILS.find(r => r.networkId === network);
    return { networkName: anyOnNetwork?.networkName ?? network, standard: rail?.standard ?? null };
}
function decodeCursor(value) {
    try {
        const [at, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
        const date = new Date(at);
        return Number.isFinite(date.getTime()) && /^[0-9a-f-]{36}$/.test(id ?? '') ? { at: date, id } : null;
    }
    catch {
        return null;
    }
}
const encodeCursor = (at, id) => Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
function depositAddressCopiesRouter(prisma, notifyCopy = TelegramNotifications_1.notifyDepositAddressCopied) {
    const router = (0, express_1.Router)();
    (0, adminDepositCopyReview_1.mountDepositCopyReview)(router, prisma);
    // Its own small budgets, outside the app-wide 120/min: a copy note never
    // spends a trader's request budget, and a flood of notes stops here. The
    // address limiter runs before auth so a flood costs no session lookup.
    const perAddress = (0, express_rate_limit_1.default)({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
    const perAccount = (0, express_rate_limit_1.default)({
        windowMs: 10 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
        keyGenerator: (req) => `user:${req.userId}`,
    });
    router.post(exports.DEPOSIT_COPY_PATH, perAddress, (0, auth_1.requireAuth)(prisma), perAccount, (0, asyncRoute_1.asyncRoute)(async (req, res) => {
        // Written below; never wakes the sleeping background loops.
        (0, BackgroundWorkCoordinator_1.markWriteWithoutBackgroundWork)(res);
        const parsed = eventSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid copy event' });
        const event = parsed.data;
        const problem = destinationProblem(event);
        if (problem)
            return res.status(400).json({ error: problem });
        const userId = req.userId;
        const clientCopiedAt = shownClientTime(event.clientCopiedAt, Date.now());
        // One statement for the usual case. receivedAt is the database's clock in
        // UTC. A retried eventId inserts nothing and keeps its first receivedAt,
        // so a retry never moves a row up the list.
        const inserted = await prisma.$queryRaw `
      INSERT INTO "DepositAddressCopyEvent"
        ("id", "eventId", "userId", "asset", "network", "destinationId", "addressSnapshot", "memoSnapshot", "source", "receivedAt", "clientCopiedAt")
      VALUES (${(0, crypto_1.randomUUID)()}, ${event.eventId}, ${userId}, ${event.asset}, ${event.network}, ${event.destinationId ?? null},
        ${event.address}, ${event.memo || null}, ${event.source}, now() AT TIME ZONE 'UTC', ${clientCopiedAt}::timestamptz AT TIME ZONE 'UTC')
      ON CONFLICT ("userId", "eventId") DO NOTHING
      RETURNING "id", "receivedAt"`;
        res.set('Cache-Control', 'no-store');
        if (inserted.length) {
            // Only the first committed note is eligible; identical HTTP retries stay silent.
            // Return 201 without waiting for Telegram. No credit, deposit lookup or account write.
            const row = inserted[0];
            res.status(201).json({ id: row.id, receivedAt: row.receivedAt, duplicate: false });
            const rail = networkLabel(event.asset, event.network);
            const label = rail.standard && rail.standard !== 'Native' ? `${rail.networkName} (${rail.standard})` : rail.networkName;
            void Promise.resolve().then(async () => {
                // Identity comes from the authenticated account, never a browser-supplied email.
                const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null);
                await notifyCopy({
                    id: row.id, asset: event.asset, network: event.network, networkLabel: label,
                    receivedAt: row.receivedAt, email: user?.email,
                });
            }).catch(() => { });
            return;
        }
        const existing = await prisma.depositAddressCopyEvent.findUnique({
            where: { userId_eventId: { userId, eventId: event.eventId } },
            select: { id: true, asset: true, network: true, destinationId: true, addressSnapshot: true, memoSnapshot: true, source: true, receivedAt: true },
        });
        if (!existing)
            return res.status(409).json({ error: 'Copy event conflict' });
        if (!samePayload(existing, event))
            return res.status(409).json({ error: 'This event ID was already used for another address' });
        return res.status(200).json({ id: existing.id, receivedAt: existing.receivedAt, duplicate: true });
    }));
    // Admin journal: one page of 25, newest first, with the account's email and
    // name from the same query. Read only when the admin opens the section or
    // asks for more; nothing polls it.
    router.get('/admin/deposit-address-copies', (0, auth_1.requireAuth)(prisma), (0, admin_1.requireAdmin)(prisma), (0, asyncRoute_1.asyncRoute)(async (req, res) => {
        const parsed = listQuery.safeParse(req.query);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid filter' });
        const { before, user, asset, countOnly } = parsed.data;
        if (countOnly === 'true') {
            // Global pending-copy indicator, independent of Users pagination and filters.
            // Same durable resolution predicate as the operational queue; no finance writes.
            const [row] = await prisma.$queryRaw `
        SELECT COUNT(*) AS "count" FROM "DepositAddressCopyEvent" e WHERE ${depositCopyResolution_1.unresolvedCopy}`;
            const pendingCount = Number(row.count);
            if (!Number.isSafeInteger(pendingCount) || pendingCount < 0)
                throw new Error('Invalid pending copy count');
            res.set('Cache-Control', 'private, no-store');
            return res.json({ pendingCount });
        }
        const cursor = before ? decodeCursor(before) : null;
        if (before && !cursor)
            return res.status(400).json({ error: 'Invalid cursor' });
        // This screen is an operational queue, not the immutable audit history.
        // Credited/ignored copy events remain in DepositAddressCopyEvent + AuditLog,
        // but must not return to the admin after refresh.
        const where = [depositCopyResolution_1.unresolvedCopy];
        if (cursor)
            where.push(client_1.Prisma.sql `(e."receivedAt", e."id") < (${cursor.at.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${cursor.id})`);
        if (asset)
            where.push(client_1.Prisma.sql `e."asset" = ${asset}`);
        if (user) {
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user))
                where.push(client_1.Prisma.sql `e."userId" = ${user.toLowerCase()}`);
            else {
                const like = `%${user.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
                where.push(client_1.Prisma.sql `(u."email" ILIKE ${like} OR u."displayName" ILIKE ${like})`);
            }
        }
        const rows = await prisma.$queryRaw `
      SELECT e."id", e."userId", e."asset", e."network", e."destinationId", e."addressSnapshot", e."memoSnapshot", e."source",
             e."receivedAt", e."clientCopiedAt", u."email", u."displayName"
      FROM "DepositAddressCopyEvent" e
      JOIN "User" u ON u."id" = e."userId"
      ${where.length ? client_1.Prisma.sql `WHERE ${client_1.Prisma.join(where, ' AND ')}` : client_1.Prisma.empty}
      ORDER BY e."receivedAt" DESC, e."id" DESC
      LIMIT ${exports.DEPOSIT_COPY_PAGE_SIZE + 1}`;
        const page = rows.slice(0, exports.DEPOSIT_COPY_PAGE_SIZE);
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
            nextCursor: rows.length > exports.DEPOSIT_COPY_PAGE_SIZE && last ? encodeCursor(last.receivedAt, last.id) : null,
        });
    }));
    return router;
}
//# sourceMappingURL=depositAddressCopies.js.map