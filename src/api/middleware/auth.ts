import { isBlockedContactEmail, isRevokedContactToken, contactEmailHash, CONTACT_EMAIL_BLOCKED, CONTACT_EMAIL_UNBLOCKED } from '../../services/ContactEmailPolicy';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createPublicKey, createSecretKey } from 'crypto';
import { PrismaClient } from '@prisma/client';

export interface AuthedRequest extends Request {
  userId?: string;
  /** Set only when the bearer token carries a `sid` claim (every token
   * issued since the Session model existed) and that session is still
   * live — see requireAuth. Lets a route act on "this session" (e.g. the
   * sign-out-this-device button never lets you revoke the session you're
   * currently making the request with by surprise). */
  sessionId?: string;
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly at startup rather than silently signing tokens with `undefined`.
  throw new Error('JWT_SECRET env var is required');
}

// How long a session's lastSeenAt can go stale before requireAuth bothers
// writing a fresh value — without this, "last seen" would cost a DB write
// on literally every authenticated request.
const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;

/** Remembered device (admin accounts only): the longest such a sign-in can
 * last (the token's own expiry), after which the password is asked again. */
export const REMEMBERED_SESSION_MAX = '90d';
/** A remembered device that has not been used for this long is signed out,
 * so a forgotten laptop does not stay signed in for the full 90 days. */
export const REMEMBERED_SESSION_IDLE_MS = 30 * 24 * 60 * 60_000;
/** The ordinary sign-in lifetime — the same 12h the login route's token carries. */
const ORDINARY_SESSION_MS = 12 * 60 * 60_000;

interface LiveSessionRow {
  id: string; userId: string; revokedAt: Date | null; lastSeenAt: Date; remembered: boolean; createdAt: Date | null;
  email: string | null; role: string | null; emailHash: string | null; contactAction: string | null;
}

/** One round trip for the session, its owner and the owner's latest contact
 * block event. The SQL-side email hash is trusted only when it equals the
 * application's own normalization; any other address uses the original lookup. */
async function readLiveSession(prisma: PrismaClient, sid: string) {
  const rows = await prisma.$queryRaw<LiveSessionRow[]>`
    SELECT s."id", s."userId", s."revokedAt", s."lastSeenAt", s."remembered", s."createdAt",
           u."email", u."role"::text AS "role", h."emailHash", c."action" AS "contactAction"
    FROM "Session" s
    LEFT JOIN "User" u ON u."id" = s."userId"
    LEFT JOIN LATERAL (SELECT encode(sha256(convert_to(lower(btrim(u."email")), 'UTF8')), 'hex') AS "emailHash") h ON true
    LEFT JOIN LATERAL (
      SELECT a."action" FROM "AuditLog" a
      WHERE a."action" IN (${CONTACT_EMAIL_BLOCKED}, ${CONTACT_EMAIL_UNBLOCKED}) AND a."metadata" -> 'emailHash' = to_jsonb(h."emailHash")
      ORDER BY a."createdAt" DESC, a."id" DESC LIMIT 1
    ) c ON true
    WHERE s."id" = ${sid}`;
  const session = rows[0];
  if (!session) return null;
  const sameHash = typeof session.email === 'string' && session.email.length <= 320 && session.emailHash === contactEmailHash(session.email);
  const blocked = sameHash ? session.contactAction === CONTACT_EMAIL_BLOCKED : await isBlockedContactEmail(prisma, session.email);
  return { ...session, blocked };
}

/** Real per-session auth: verifies the JWT, then (for any token carrying a
 * `sid` claim — every token issued since the Session model existed)
 * checks that session hasn't been revoked, so "sign out this device" in
 * Settings → Security actually invalidates that device's token instead of
 * just hiding a row in a list. A token from before this model existed has
 * no `sid` claim and must still belong to an existing user. Deleted accounts
 * cannot keep access through legacy tokens. */
export function requireAuth(prisma: PrismaClient, { prepareVerificationKey = false, singleSessionRead = false }: { prepareVerificationKey?: boolean; singleSessionRead?: boolean } = {}) {
  // Stocks opt-in only; the default auth path keeps the original string key.
  const verificationKey = prepareVerificationKey
    ? (() => { const { createPublicKey, createSecretKey } = require('crypto') as typeof import('crypto'); try { return createPublicKey(JWT_SECRET!); } catch { return createSecretKey(Buffer.from(JWT_SECRET!)); } })()
    : JWT_SECRET!;
  return async function (req: AuthedRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    let payload: { sub: string; sid?: string; purpose?: string; iat?: number };
    try {
      payload = jwt.verify(header.slice(7), verificationKey) as typeof payload;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    // A pending-2FA token (issued mid-login, before the code is verified) is
    // only ever valid against /auth/login/2fa — never as a real session.
    if (payload.purpose || typeof payload.sub !== 'string' || !payload.sub.trim()) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
      if (payload.sid && singleSessionRead) {
        // Stocks opt-in: the same checks as below, read in one query. Still a
        // fresh database read on every request; no auth cache or TTL.
        const session = await readLiveSession(prisma, payload.sid);
        if (!session || session.userId !== payload.sub || session.revokedAt) {
          return res.status(401).json({ error: 'Session has been signed out' });
        }
        if (session.remembered) {
          if (Date.now() - session.lastSeenAt.getTime() > REMEMBERED_SESSION_IDLE_MS) {
            return res.status(401).json({ error: 'Session expired' });
          }
          if (session.role !== 'ADMIN'
            && !(session.createdAt && Date.now() - session.createdAt.getTime() <= ORDINARY_SESSION_MS)) {
            return res.status(401).json({ error: 'Session expired' });
          }
        }
        if (session.blocked) return res.status(403).json({ error: 'Account blocked' });
        req.sessionId = session.id;
        if (Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
          prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() }, select: { id: true } }).catch(() => {});
        }
      } else if (payload.sid) {
        // Re-check the database on EVERY request, but do not transfer device/IP
        // metadata that authorization never reads. No auth cache or TTL.
        const session = await prisma.session.findUnique({
          where: { id: payload.sid },
          select: { id: true, userId: true, revokedAt: true, lastSeenAt: true, remembered: true, user: { select: { email: true } } },
        });
        if (!session || session.userId !== payload.sub || session.revokedAt) {
          return res.status(401).json({ error: 'Session has been signed out' });
        }
        if (session.remembered) {
          if (Date.now() - session.lastSeenAt.getTime() > REMEMBERED_SESSION_IDLE_MS) {
            return res.status(401).json({ error: 'Session expired' });
          }
          // Remembering is for the admin account only. A remembered session of
          // any other account (ticked on the short-lived login checkbox, or an
          // account no longer ADMIN) is held to the ordinary 12h from sign-in.
          // Only remembered sessions pay for this read.
          const owner = await prisma.session.findUnique({
            where: { id: session.id }, select: { createdAt: true, user: { select: { role: true } } },
          });
          if (owner?.user?.role !== 'ADMIN'
            && !(owner?.createdAt && Date.now() - owner.createdAt.getTime() <= ORDINARY_SESSION_MS)) {
            return res.status(401).json({ error: 'Session expired' });
          }
        }
        if (await isBlockedContactEmail(prisma, session.user?.email)) return res.status(403).json({ error: 'Account blocked' });
        req.sessionId = session.id;
        if (Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
          // Fire-and-forget — a missed "last seen" tick isn't worth failing
          // or delaying the actual request over.
          prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() }, select: { id: true } }).catch(() => {});
        }
      }

      if (!payload.sid) {
        const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true } });
        if (!user) return res.status(401).json({ error: 'Account no longer exists' });
        if (await isBlockedContactEmail(prisma, user.email)) return res.status(403).json({ error: 'Account blocked' });
        if (await isRevokedContactToken(prisma, user.email, payload.iat)) return res.status(401).json({ error: 'Session has been signed out' });
      }
    } catch {
      return res.status(503).json({ error: 'Authentication temporarily unavailable' });
    }
    req.userId = payload.sub;
    next();
  };
}

/** Like requireAuth, but never rejects — sets req.userId when a valid
 * bearer token is present, otherwise leaves the request anonymous. For
 * routes usable by both logged-in users and guests (e.g. the support chat
 * widget), where a missing/invalid token just means "guest", not an error.
 * Deliberately doesn't check session revocation (unlike requireAuth) —
 * these routes don't touch funds or account settings, so a revoked-but-
 * not-yet-expired token falling back to "guest" here isn't a real risk,
 * and it keeps this middleware synchronous and DB-free. */
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET!) as { sub: string; purpose?: string };
      if (!payload.purpose) req.userId = payload.sub;
    } catch {
      // Invalid/expired token on an optional-auth route: proceed as a guest.
    }
  }
  next();
}
