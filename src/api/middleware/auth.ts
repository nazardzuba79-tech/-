import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthedRequest extends Request {
  userId?: string;
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly at startup rather than silently signing tokens with `undefined`.
  throw new Error('JWT_SECRET env var is required');
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET!) as { sub: string; purpose?: string };
    // A pending-2FA token (issued mid-login, before the code is verified) is
    // only ever valid against /auth/login/2fa — never as a real session.
    if (payload.purpose) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Like requireAuth, but never rejects — sets req.userId when a valid
 * bearer token is present, otherwise leaves the request anonymous. For
 * routes usable by both logged-in users and guests (e.g. the support chat
 * widget), where a missing/invalid token just means "guest", not an error. */
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
