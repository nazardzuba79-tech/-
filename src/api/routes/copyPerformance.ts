import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { CopyPerformanceService } from '../../services/copyTrading/CopyPerformanceService';
import { PUBLIC_STRATEGIES, resolveStrategyOwner } from '../../services/copyTrading/strategyOwner';
import { MarketplaceSnapshots, marketplaceSection } from '../../services/copyTrading/marketplaceSnapshot';
import { randomUUID } from 'crypto';

const SECTIONS = ['nazar', 'ksenia', 'identities'] as const;

/**
 * ONE STRUCTURED LINE PER SECTION, EVERY REQUEST — INCLUDING THE GOOD ONES.
 *
 * A card that went blank used to leave one clue in the logs and only when
 * the server itself had failed: if the response was fine and the BROWSER
 * refused it, or the response was fine and simply slow, there was nothing
 * written down at all. So "both traders are stuck loading" could not be
 * answered from the logs — it had to be reproduced, and the production path
 * is the one path we cannot reproduce here.
 *
 * These lines close that. Each names the section, whether it was produced,
 * how long it took, and — when it failed — the error's CLASS, never its
 * text. Grep `copy_marketplace.` and the shape of an incident is immediate:
 * `copy_marketplace.ksenia.error` with a duration near the client's fifteen
 * seconds is a timeout on our side; `copy_marketplace.nazar.ok` on every
 * request while the card is blank means the payload is being refused by the
 * browser, which is a frontend validator problem and nothing to do with
 * this file.
 *
 * WHAT MAY NOT BE WRITTEN. No token, no Authorization header, no account or
 * user id, no email, no request body, no section payload and no figure. The
 * request id is generated here and correlates the three lines of ONE
 * response to each other; it identifies nothing and nobody outside this log.
 * The error class is the constructor name, which is ours, not user input.
 */
function logSections(requestId: string, results: PromiseSettledResult<unknown>[], durationMs: number) {
  results.forEach((result, index) => {
    const section = SECTIONS[index];
    if (result.status === 'fulfilled') {
      console.info(`copy_marketplace.${section}.ok request_id=${requestId} duration_ms=${durationMs}`);
      return;
    }
    const errorClass = result.reason?.constructor?.name ?? 'unknown';
    console.error(`copy_marketplace.${section}.error request_id=${requestId} `
      + `duration_ms=${durationMs} error_class=${errorClass}`);
    // The message is a developer's and stays a developer's: it is the only
    // thing that distinguishes a decode failure from an unreachable database.
    const reason = result.reason instanceof Error ? result.reason.message : 'unknown';
    console.error(`[copy-trading] section "${section}" unavailable: ${reason}`);
  });
}

/** Modeled strategy read endpoints; existing production session auth preserved.
 * The normal production backend owns persistence and same-environment identity.
 * The existing legacy synthetic/admin and real account routes remain separate. */
export function copyPerformanceRouter(prisma: PrismaClient, service = new CopyPerformanceService(prisma),
  snapshots = new MarketplaceSnapshots(prisma, service, { dailyRefresh: process.env.NODE_ENV !== 'test' })) {
  const router = Router();
  // One authenticated bootstrap; a failed section must not discard its peers.
  // PerformanceService already coalesces and caches each UTC-day projection.
  // Identity/KYC is read afresh: it can legitimately change within the day.
  router.get('/copy-trading/marketplace', requireAuth(prisma), async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const requestId = randomUUID();
    const startedAt = Date.now();
    // Each section is the strategy's PUBLISHED marketplace section: built
    // from the COMPLETE history (`summarizeStrategy` reads every trade for
    // `tradeStats`), Ksenia's overlays folded in, and `redactTradeHistory`
    // LAST, so executions never leave this function. The day's heavy append
    // no longer runs inside this request when a confirmed section already
    // exists — see services/copyTrading/marketplaceSnapshot.ts for why the
    // cards hung and how this keeps them from hanging.
    // Nazar, THEN Ksenia — never both at once: two concurrent appends need a
    // third more live heap (128 MB instead of < 96 MB, measured) inside a
    // container whose memory is shared with the market collector.
    // Identities are a small read and still run alongside.
    const nazarSection = snapshots.section('nazar');
    const kseniaSection = nazarSection.catch(() => undefined).then(() => snapshots.section('ksenia'));
    const results = await Promise.allSettled([
      nazarSection,
      kseniaSection,
      Promise.all(PUBLIC_STRATEGIES.map(id => resolveStrategyOwner(prisma, id))),
    ]);
    const [nazar, ksenia, identities] = results.map(result => result.status === 'fulfilled' ? result.value : null);
    const errors = Object.fromEntries(results.flatMap((result, index) => result.status === 'rejected'
      ? [[['nazar', 'ksenia', 'identities'][index], 'temporarily_unavailable']] : []));
    // The wire keeps saying `temporarily_unavailable` and nothing else — the
    // visitor learns that a section is missing, never why. The REASON is a
    // developer's, so it is logged here instead: without it, a card that has
    // gone blank looks identical whether the stored state failed to decode,
    // the append hit contention, or the database was simply unreachable.
    // Only the strategy name and the error's own message are logged; no
    // token, account, request header or payload goes anywhere near this.
    logSections(requestId, results, Date.now() - startedAt);
    res.status(results.every(result => result.status === 'rejected') ? 503 : 200)
      .json({ nazar, ksenia, identities, generatedAt: new Date().toISOString(), errors });
  });
  for (const strategy of ['nazar', 'ksenia'] as const) {
    router.get(`/copy-trading/${strategy}`, requireAuth(prisma), async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        // The per-strategy endpoint is a direct link to the same data, so it
        // is built by the same pipeline and redacts on exactly the same terms.
        res.json(marketplaceSection(strategy, await service.get(strategy)));
      }
      catch (error) {
        console.error(`[copy-trading] strategy "${strategy}" unavailable: `
          + (error instanceof Error ? error.message : 'unknown'));
        res.status(503).json({ error: 'Strategy performance temporarily unavailable' });
      }
    });
  }
  router.get('/copy-trading/identities', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ identities: await Promise.all(PUBLIC_STRATEGIES.map(id => resolveStrategyOwner(prisma, id))) }); }
    catch { res.status(503).json({ error: 'Strategy identity temporarily unavailable' }); }
  });
  router.get('/copy-trading/identity/:traderId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await resolveStrategyOwner(prisma, req.params.traderId);
      if (!identity) { res.status(404).json({ error: 'Strategy unavailable' }); return; }
      res.json(identity);
    } catch { res.status(503).json({ error: 'Strategy identity temporarily unavailable' }); }
  });
  return router;
}
