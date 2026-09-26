import { Router } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { DepositWatchService } from '../../services/deposits/DepositWatchService';

/**
 * Optional external trigger for a daytime slot (for when the API slept
 * through it), e.g. a free scheduled job at 12:00/16:00/20:00 Kyiv. The
 * service itself enforces the schedule (NOT_DUE at night, for a slot already
 * done, or right after another scan), so no caller can scan more often.
 * Authorized by DEPOSIT_WATCHER_TOKEN (not a user session, not an admin
 * key). It is not accepted anywhere else, and this route can only call
 * DepositWatchService.runOnce('schedule') — which observes and proves
 * transfers but has no credit, attribution, balance or withdrawal path.
 * Without the env var the route does not exist (404).
 */
export function depositWatchInternalRouter(watch: DepositWatchService): Router {
  const router = Router();
  router.post('/internal/deposit-watch/tick', async (req, res) => {
    const expected = process.env.DEPOSIT_WATCHER_TOKEN ?? '';
    if (expected.length < 32) return res.status(404).json({ error: 'Not found' });
    const header = req.get('authorization') ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    const digest = (v: string) => createHash('sha256').update(v).digest();
    if (!given || !timingSafeEqual(digest(given), digest(expected))) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const s = await watch.runOnce('schedule');
      res.set('Cache-Control', 'no-store').json({
        ran: s.ran, skipped: s.skipped ?? null, notDueReason: s.notDueReason ?? null, ok: s.ok, needsFollowUp: s.needsFollowUp,
        newTransfers: s.newTransfers, pagesRead: s.pagesRead, providerCalls: s.providerCalls, durationMs: s.durationMs,
      });
    } catch {
      res.status(503).json({ error: 'Watcher run failed' });
    }
  });
  return router;
}
