import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { NativeDemoService } from '../../private-trading/native/service';
import { FuturesDemoObserverError, FuturesDemoObserverService } from './FuturesDemoObserverService';
import { FuturesCopyExecutionError, FuturesDemoFollowerExecutor, futuresDemoAutomaticEnabled } from './FuturesDemoFollowerExecutor';

/**
 * Automatic Futures copy. For every ACTIVE consent that carries an unexpired,
 * unrevoked delegation, one bounded pass: collect the leader's new committed
 * Native Demo events (observer), and if any are undelivered, run them through the
 * same executor and commit guard the follower's own "Apply" uses, acting with the
 * follower's delegated Session. Nothing here can act for a follower who has not
 * consented, who stopped, whose delegation was revoked, or whose account is blocked:
 * the executor and NativeDemoService re-check all of it inside their transactions.
 */
export class FuturesCopyWorker {
  constructor(private readonly db: PrismaClient, private readonly observer: FuturesDemoObserverService,
    private readonly executor: FuturesDemoFollowerExecutor, private readonly native: Pick<NativeDemoService, 'command'>,
    private readonly enabled: () => boolean = futuresDemoAutomaticEnabled) {}

  async pass() {
    if (!this.enabled()) return { followers: 0, delivered: 0, refused: [] as string[] };
    const consents = await this.db.copyFuturesDemoConsent.findMany({
      where: { status: 'ACTIVE', delegatedSessionId: { not: null }, delegationExpiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'asc' }, take: 50,
    });
    let delivered = 0; const refused: string[] = [];
    for (const c of consents) {
      if (!this.enabled()) break;
      const sessionId = c.delegatedSessionId!, userId = c.userId;
      const actor = { userId, sessionId, expiresAt: c.delegationExpiresAt!.getTime() };
      try {
        await this.observer.scan(userId, sessionId);
        const pending = await this.db.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM "CopyFuturesDemoEvent" e
          WHERE e."subscriptionId" = ${c.subscriptionId} AND e."sourceRevision" > ${c.startedAfterRevision}
            AND NOT EXISTS (SELECT 1 FROM "CopyFuturesDemoMirror" m WHERE m."consentId" = ${c.id} AND m."sourceEventId" = e."sourceEventId")`;
        if (!Number(pending[0]?.n ?? 0)) continue;
        // Admit the delegated session to the follower's own account only when work exists.
        const account = await this.db.nativeDemoAccount.findUnique({ where: { userId }, select: { payload: true } });
        const admitted = (account?.payload as Record<string, unknown> | undefined)?.executionSession as { sessionId?: string; expiresAt?: number } | undefined;
        if (admitted?.sessionId !== sessionId || admitted.expiresAt !== actor.expiresAt) {
          const key = 'copy-auto-admit-' + createHash('sha256').update(`${sessionId}:${actor.expiresAt}`).digest('hex').slice(0, 44);
          await this.native.command(actor, { kind: 'REFRESH', idempotencyKey: key }, { persist: true });
        }
        const run = await this.executor.run(userId, sessionId, 10);
        delivered += run.results.length;
      } catch (error) {
        // A refusal for one follower (stopped, revoked, blocked) never stops the others.
        if (error instanceof FuturesCopyExecutionError || error instanceof FuturesDemoObserverError
          || (error as { code?: string })?.code) { refused.push((error as { code: string }).code); continue; }
        throw error;
      }
    }
    return { followers: consents.length, delivered, refused };
  }
}

/** One bounded pass at a time; nothing runs (no timer, no read) while disabled. */
export function startFuturesCopyWorker(worker: Pick<FuturesCopyWorker, 'pass'>, enabled: () => boolean,
  report: (error: unknown) => void, intervalMs = 3000) {
  let stopped = false, timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped || !enabled()) return;
    try { await worker.pass(); } catch (error) { report(error); }
    if (!stopped && enabled()) { timer = setTimeout(tick, intervalMs); timer.unref(); }
  };
  if (enabled()) void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
