import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import type { AuthedRequest } from './auth';
import { asyncRoute } from '../asyncRoute';
import { assertNativeTrader } from '../../private-trading/native/testAccess';
import { nativeTestAccountIds } from '../../private-trading/native/testAccounts';
import { privateTradingConfig } from '../../private-trading/access';
import { PrivateTradingError } from '../../private-trading/serviceTypes';

/** Called only AFTER requireAuth/requireAuthOrApiKey. API keys and legacy
 * sessionless JWTs cannot acquire this interactive demo permission. No role,
 * balance, audit credit, request body or client flag grants admission. */
export async function orderTicketAllowed(db: PrismaClient, req: AuthedRequest): Promise<boolean> {
  const config = privateTradingConfig();
  const testers = [...nativeTestAccountIds()].filter(id => id !== config.ownerId);
  // A deployment with an ambiguous tester list must be reviewed, not widened.
  if (!config.enabled || !config.ownerId || testers.length !== 1 || !req.sessionId
    || !req.userId || ![config.ownerId, testers[0]].includes(req.userId)) return false;
  const bearer = req.headers.authorization;
  if (!bearer?.startsWith('Bearer ')) return false;
  const claims = jwt.decode(bearer.slice(7));
  if (!claims || typeof claims === 'string' || claims.sub !== req.userId || claims.sid !== req.sessionId) return false;
  try {
    await assertNativeTrader(db, { userId: req.userId, sessionId: req.sessionId,
      expiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : 0 });
    const final = privateTradingConfig();
    const finalTesters = [...nativeTestAccountIds()].filter(id => id !== final.ownerId);
    return final.enabled && final.ownerId === config.ownerId
      && finalTesters.length === 1 && finalTesters[0] === testers[0];
  } catch (error) {
    if (error instanceof PrivateTradingError) return false;
    throw error; // DB outage is not a successful access verdict.
  }
}

export function requireOrderTicketTrader(db: PrismaClient) {
  return asyncRoute(async (req: AuthedRequest, res, next) => {
    if (!(await orderTicketAllowed(db, req))) {
      return res.status(403).json({ code: 'ORDER_TICKET_ACCESS_DENIED', error: 'Trading access required' });
    }
    next();
  });
}
