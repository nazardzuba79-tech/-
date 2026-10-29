import { isBlockedContactEmail, isRevokedContactToken, contactEmailHash, CONTACT_EMAIL_BLOCKED, CONTACT_EMAIL_UNBLOCKED } from '../../services/ContactEmailPolicy';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createPublicKey, createSecretKey } from 'crypto';
import type { KeyObject } from 'crypto';
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

/** Claims of a bearer that a Stocks-prepared requireAuth verified. */
export interface VerifiedBearerClaims { sub: string; sid?: string; nbf?: number; exp?: number }
// Kept per request object only, so nothing is reused by another request.
const verifiedBearers = new WeakMap<Request, { token: string; claims: VerifiedBearerClaims }>();

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

/** One round trip for the sessions, their owners and each owner's latest contact
 * block event (one session for a request; all sessions of a Stocks identity batch). */
async function readLiveSessions(prisma: PrismaClient, sids: string[]): Promise<Map<string, LiveSessionRow>> {
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
    WHERE s."id" = ANY(${sids}::text[])`;
  return new Map(rows.map(row => [row.id, row]));
}

/** requireAuth's refusal for a verified bearer (`sub`) and its live session row, or null
 * when it passes. The SQL-side email hash is trusted only when it equals the
 * application's own normalization; any other address uses the original lookup. */
async function liveSessionRefusal(prisma: PrismaClient, session: LiveSessionRow | undefined, sub: string): Promise<{ status: 401 | 403; error: string } | null> {
  if (!session || session.userId !== sub || session.revokedAt) return { status: 401, error: 'Session has been signed out' };
  if (session.remembered) {
    if (Date.now() - session.lastSeenAt.getTime() > REMEMBERED_SESSION_IDLE_MS) return { status: 401, error: 'Session expired' };
    if (session.role !== 'ADMIN'
      && !(session.createdAt && Date.now() - session.createdAt.getTime() <= ORDINARY_SESSION_MS)) {
      return { status: 401, error: 'Session expired' };
    }
  }
  const sameHash = typeof session.email === 'string' && session.email.length <= 320 && session.emailHash === contactEmailHash(session.email);
  const blocked = sameHash ? session.contactAction === CONTACT_EMAIL_BLOCKED : await isBlockedContactEmail(prisma, session.email);
  return blocked ? { status: 403, error: 'Account blocked' } : null;
}

function touchSession(prisma: PrismaClient, session: { id: string; lastSeenAt: Date }) {
  if (Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    // Fire-and-forget — a missed "last seen" tick isn't worth failing
    // or delaying the actual request over.
    prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() }, select: { id: true } }).catch(() => {});
  }
}

type BearerClaims = { sub: string; sid?: string; purpose?: string; iat?: number; nbf?: number; exp?: number };
/** The verified claims of a bearer header, or null when requireAuth answers 401 before any database read. */
function verifyBearer(header: string, key: string | KeyObject): BearerClaims | null {
  let payload: BearerClaims;
  try {
    payload = jwt.verify(header.slice(7), key) as BearerClaims;
  } catch {
    return null;
  }
  // A pending-2FA token (issued mid-login, before the code is verified) is
  // only ever valid against /auth/login/2fa — never as a real session.
  if (payload.purpose || typeof payload.sub !== 'string' || !payload.sub.trim()) return null;
  return payload;
}

/** The normalized key of the Stocks-prepared paths, loaded only when one is built. */
function stocksVerificationKey(): KeyObject {
  const { createPublicKey, createSecretKey } = require('crypto') as typeof import('crypto');
  try { return createPublicKey(JWT_SECRET!); } catch { return createSecretKey(Buffer.from(JWT_SECRET!)); }
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
  const verificationKey = prepareVerificationKey ? stocksVerificationKey() : JWT_SECRET!;
  return async function (req: AuthedRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    const payload = verifyBearer(header, verificationKey);
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

    try {
      if (payload.sid && singleSessionRead) {
        // Stocks opt-in: the same checks as below, read in one query. Still a
        // fresh database read on every request; no auth cache or TTL.
        const session = (await readLiveSessions(prisma, [payload.sid])).get(payload.sid);
        const refusal = await liveSessionRefusal(prisma, session, payload.sub);
        if (refusal) return res.status(refusal.status).json({ error: refusal.error });
        req.sessionId = session!.id;
        touchSession(prisma, session!);
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
    if (prepareVerificationKey) {
      verifiedBearers.set(req, { token: header.slice(7), claims: { sub: payload.sub, sid: payload.sid, nbf: payload.nbf, exp: payload.exp } });
    }
    next();
  };
}

/** requireAuth (Stocks-prepared, single session read) for the bearers of one Stocks identity
 * batch: every bearer is verified and judged now, exactly as requireAuth would judge it alone,
 * but the sessions of all `sid` bearers are read in one query. Returns, per bearer and in order,
 * the request requireAuth would have passed on (userId, sessionId, the verified bearer for
 * verifiedBearerAtUse) or the status it would have answered. Nothing is kept between calls. */
export function requireAuthBatch(prisma: PrismaClient) {
  const single = requireAuth(prisma, { prepareVerificationKey: true, singleSessionRead: true });
  const verificationKey = stocksVerificationKey();
  return async function (tokens: string[]): Promise<Array<AuthedRequest | { status: number }>> {
    const requests = tokens.map(token => ({ headers: { authorization: 'Bearer ' + token } }) as unknown as AuthedRequest);
    const results: Array<AuthedRequest | { status: number } | undefined> = new Array(tokens.length);
    const live: Array<{ index: number; payload: BearerClaims & { sid: string } }> = [];
    for (const [index, req] of requests.entries()) {
      const payload = verifyBearer(req.headers.authorization!, verificationKey);
      if (!payload) results[index] = { status: 401 };
      else if (payload.sid) live.push({ index, payload: payload as BearerClaims & { sid: string } });
      else {
        // A bearer without a session claim keeps requireAuth's own legacy path.
        let status = 200, passed = false;
        const outcome = { status(code: number) { status = code; return outcome; }, json() { return outcome; } };
        await single(req, outcome as never, () => { passed = true; });
        results[index] = passed ? req : { status };
      }
    }
    if (live.length) {
      let sessions: Map<string, LiveSessionRow> | null = null;
      try { sessions = await readLiveSessions(prisma, [...new Set(live.map(x => x.payload.sid))]); } catch {}
      for (const { index, payload } of live) {
        if (!sessions) { results[index] = { status: 503 }; continue; }
        try {
          const session = sessions.get(payload.sid), refusal = await liveSessionRefusal(prisma, session, payload.sub);
          if (refusal) { results[index] = { status: refusal.status }; continue; }
          const req = requests[index];
          req.sessionId = session!.id; req.userId = payload.sub;
          touchSession(prisma, session!);
          verifiedBearers.set(req, { token: tokens[index], claims: { sub: payload.sub, sid: payload.sid, nbf: payload.nbf, exp: payload.exp } });
          results[index] = req;
        } catch { results[index] = { status: 503 }; }
      }
    }
    return results as Array<AuthedRequest | { status: number }>;
  };
}

/** The claims of the bearer that a Stocks-prepared requireAuth verified earlier in
 * this same request, judged again now. Only for a caller verifying with this very
 * secret while the request still carries that exact token text; otherwise null,
 * and the caller verifies the token itself. The not-before and expiry windows are
 * re-checked here with jwt.verify's own rule and errors, so a token that expired
 * since requireAuth (e.g. during the session read) is refused exactly as a second
 * jwt.verify would refuse it. Only the signature is not verified a second time. */
export function verifiedBearerAtUse(req: Request, secret: string | undefined): VerifiedBearerClaims | null {
  const verified = verifiedBearers.get(req);
  if (!verified || secret !== JWT_SECRET || req.headers.authorization?.slice(7) !== verified.token) return null;
  const now = Math.floor(Date.now() / 1000), { nbf, exp } = verified.claims;
  if (nbf !== undefined && nbf > now) throw new jwt.NotBeforeError('jwt not active', new Date(nbf * 1000));
  if (exp !== undefined && now >= exp) throw new jwt.TokenExpiredError('jwt expired', new Date(exp * 1000));
  return verified.claims;
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
