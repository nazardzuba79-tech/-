import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
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

/** Real per-session auth: verifies the JWT, then (for any token carrying a
 * `sid` claim — every token issued since the Session model existed)
 * checks that session hasn't been revoked, so "sign out this device" in
 * Settings → Security actually invalidates that device's token instead of
 * just hiding a row in a list. A token from before this model existed has
 * no `sid` claim and skips the DB check entirely — old sessions keep
 * working until they expire on their own (JWT_EXPIRES_IN), nothing is
 * force-logged-out by this deploy. */
export function requireAuth(prisma: PrismaClient) {
  return async function (req: AuthedRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    let payload: { sub: string; sid?: string; purpose?: string };
    try {
      payload = jwt.verify(header.slice(7), JWT_SECRET!) as typeof payload;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    // A pending-2FA token (issued mid-login, before the code is verified) is
    // only ever valid against /auth/login/2fa — never as a real session.
    if (payload.purpose) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (payload.sid) {
      const session = await prisma.session.findUnique({ where: { id: payload.sid } });
      if (!session || session.userId !== payload.sub || session.revokedAt) {
        return res.status(401).json({ error: 'Session has been signed out' });
      }
      req.sessionId = session.id;
      if (Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
        // Fire-and-forget — a missed "last seen" tick isn't worth failing
        // or delaying the actual request over.
        prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
      }
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
