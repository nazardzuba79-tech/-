import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { inflate, NativeAccount } from '../../private-trading/native/store';
import { PUBLIC_STRATEGIES } from './strategyOwner';
import { copyDemoEnabled } from './CopyDemoService';
import { futuresDemoSourceFills, futuresDemoSourceRiskCheck } from './FuturesDemoSource';

type Tx = Prisma.TransactionClient;
const MAX_REVISIONS_PER_SCAN = 8;
const MAX_EVENTS_PER_REVISION = 500;

export class FuturesDemoObserverError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}

/** Strict opt-in additionally requires Copy Demo's disposable-loopback test gate. */
export const futuresDemoObserverEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.COPY_FUTURES_DEMO_OBSERVER_ENABLED === 'true' && copyDemoEnabled(env);

/** Explicit consent list; never infer consent from a public strategy profile. */
export function approvedFuturesDemoLeader(userId: string, env: NodeJS.ProcessEnv = process.env) {
  const ids = (env.COPY_FUTURES_DEMO_APPROVED_LEADER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.length > 0 && ids.length <= 25 && ids.includes(userId);
}

export interface FuturesObserverCaps { maxLeverage: string; maxFillUsdt: string }
const numeric = (v: string) => /^(0|[1-9][0-9]{0,11})([.][0-9]{1,8})?$/.test(v) && new BigNumber(v).gt(0);

export class FuturesDemoObserverService {
  constructor(private db: PrismaClient,
    private enabled: () => boolean = futuresDemoObserverEnabled,
    private approvedLeader: (userId: string) => boolean = approvedFuturesDemoLeader) {}

  private on() { if (!this.enabled()) throw new FuturesDemoObserverError('FUTURES_DEMO_OBSERVER_OFF', 403); }
  private caps(c: FuturesObserverCaps) {
    if (!numeric(c.maxLeverage) || !numeric(c.maxFillUsdt)
      || new BigNumber(c.maxLeverage).gt(100)) throw new FuturesDemoObserverError('INVALID_OBSERVER_CAPS', 400);
  }
  private async authorized(tx: Tx, userId: string, sessionId: string) {
    const [user, session] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { blockedAt: true } }),
      tx.session.findUnique({ where: { id: sessionId }, select: { userId: true, revokedAt: true } }),
    ]);
    if (!user || user.blockedAt || !session || session.revokedAt || session.userId !== userId)
      throw new FuturesDemoObserverError('OBSERVER_ACCESS_DENIED', 403);
  }
  private async source(tx: Tx, traderId: string, ownerUserId: string) {
    if (!(PUBLIC_STRATEGIES as readonly string[]).includes(traderId)) throw new FuturesDemoObserverError('UNKNOWN_TRADER', 400);
    const strategy = await tx.copyStrategyOwner.findUnique({ where: { traderId }, select: { ownerUserId: true } });
    if (!strategy?.ownerUserId || strategy.ownerUserId !== ownerUserId)
      throw new FuturesDemoObserverError('OBSERVER_OWNER_CHANGED', 409);
    if (!this.approvedLeader(ownerUserId)) throw new FuturesDemoObserverError('LEADER_NOT_OPTED_IN', 403);
    const leader = await tx.user.findUnique({ where: { id: ownerUserId }, select: { blockedAt: true } });
    if (!leader || leader.blockedAt) throw new FuturesDemoObserverError('LEADER_UNAVAILABLE', 403);
    const account = await tx.nativeDemoAccount.findUnique({ where: { userId: ownerUserId } });
    if (!account || account.revision < 1) throw new FuturesDemoObserverError('LEADER_DEMO_NOT_INITIALIZED');
    const mode = (account.payload as Record<string, unknown>)?.executionMode;
    if (mode === 'HISTORICAL_DEMO') throw new FuturesDemoObserverError('HISTORICAL_LEADER_REFUSED', 403);
    return account.revision;
  }
  private async admission(tx: Tx, userId: string, sessionId: string) {
    await this.authorized(tx, userId, sessionId);
    if (!await tx.nativeDemoAccount.findUnique({ where: { userId }, select: { userId: true } }))
      throw new FuturesDemoObserverError('FOLLOWER_DEMO_NOT_INITIALIZED', 403);
    if (await tx.copyStrategyOwner.findFirst({ where: { ownerUserId: userId }, select: { traderId: true } }))
      throw new FuturesDemoObserverError('LEADER_CANNOT_FOLLOW', 403);
  }

  /** A server subscription is only OBSERVING, not copying orders. Start at the
   * source's current committed revision: no historical backfill or bootstrap.
   */
  async subscribe(userId: string, sessionId: string, traderId: string, caps: FuturesObserverCaps) {
    this.on(); this.caps(caps);
    return this.db.$transaction(async tx => {
      this.on();
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      await this.admission(tx, userId, sessionId);
      if (!(PUBLIC_STRATEGIES as readonly string[]).includes(traderId)) throw new FuturesDemoObserverError('UNKNOWN_TRADER', 400);
      const strategy = await tx.copyStrategyOwner.findUnique({ where: { traderId }, select: { ownerUserId: true } });
      if (!strategy?.ownerUserId || strategy.ownerUserId === userId) throw new FuturesDemoObserverError('INVALID_SOURCE', 403);
      const latestRevision = await this.source(tx, traderId, strategy.ownerUserId);
      const previous = await tx.copyFuturesDemoSubscription.findUnique({ where: { userId } });
      if (previous && (previous.traderId !== traderId || previous.ownerUserId !== strategy.ownerUserId))
        throw new FuturesDemoObserverError('EXISTING_SOURCE_MUST_BE_RECONCILED');
      const reset = !previous || previous.status === 'STOPPED';
      const row = await tx.copyFuturesDemoSubscription.upsert({
        where: { userId },
        create: { userId, traderId, ownerUserId: strategy.ownerUserId,
          status: 'OBSERVING', lastRevision: latestRevision, ...caps },
        update: { status: 'OBSERVING', ...caps, ...(reset ? { lastRevision: latestRevision } : {}) },
      });
      return { mode: 'OBSERVATION_ONLY' as const, subscriptionId: row.id,
        status: row.status, lastRevision: row.lastRevision, automaticCopying: false };
    }, { timeout: 15000 });
  }

  async stop(userId: string, sessionId: string) {
    this.on();
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      await this.authorized(tx, userId, sessionId);
      await tx.copyFuturesDemoSubscription.updateMany({
        where: { userId, status: 'OBSERVING' }, data: { status: 'STOPPED' },
      });
      return { mode: 'OBSERVATION_ONLY' as const, status: 'STOPPED' as const, automaticCopying: false };
    });
  }

  /** Explicit, bounded, serialized read of immutable source revisions.
   * No worker, timer, follower command, financial writes or fund transfers.
   */
  async scan(userId: string, sessionId: string) {
    this.on();
    return this.db.$transaction(async tx => {
      this.on(); await this.authorized(tx, userId, sessionId);
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "CopyFuturesDemoSubscription"
        WHERE "userId" = ${userId} FOR UPDATE`;
      if (!locked.length) throw new FuturesDemoObserverError('NO_OBSERVER_SUBSCRIPTION', 404);
      const sub = await tx.copyFuturesDemoSubscription.findUniqueOrThrow({ where: { userId } });
      if (sub.status !== 'OBSERVING') throw new FuturesDemoObserverError('OBSERVER_STOPPED');
      const currentRevision = await this.source(tx, sub.traderId, sub.ownerUserId);
      if (currentRevision < sub.lastRevision) throw new FuturesDemoObserverError('SOURCE_REVISION_ROLLBACK');
      const revisions = await tx.nativeDemoRevision.findMany({
        where: { userId: sub.ownerUserId, revision: { gt: sub.lastRevision, lte: currentRevision } },
        orderBy: { revision: 'asc' }, take: MAX_REVISIONS_PER_SCAN,
      });
      let nextRevision = sub.lastRevision, accepted = 0, rejected = 0;
      for (const revision of revisions) {
        if (revision.revision !== nextRevision + 1) throw new FuturesDemoObserverError('SOURCE_REVISION_GAP');
        const account = inflate(revision.payload as unknown as NativeAccount);
        if (account.revision !== revision.revision || account.executionMode === 'HISTORICAL_DEMO'
          || !Array.isArray(account.snapshot?.events) || account.snapshot.events.length > MAX_EVENTS_PER_REVISION)
          throw new FuturesDemoObserverError('SOURCE_REVISION_INVALID');
        const results = futuresDemoSourceFills(account);
        rejected += results.rejected.length;
        for (const fill of results.accepted) {
          if (futuresDemoSourceRiskCheck(fill, sub.maxLeverage.toString(), sub.maxFillUsdt.toString())) {
            rejected++; continue;
          }
          const inserted = await tx.copyFuturesDemoEvent.createMany({
            data: [{ subscriptionId: sub.id, sourceEventId: fill.sourceEventId,
              sourceRevision: revision.revision, sourceActionId: fill.sourceActionId,
              sourcePositionId: fill.sourcePositionId, symbol: fill.symbol, kind: fill.kind,
              side: fill.side, quantity: fill.quantity, price: fill.price,
              leverage: fill.leverage, marginType: fill.marginType,
              pricing: fill.pricing, status: 'OBSERVED_ONLY' }],
            skipDuplicates: true,
          });
          accepted += inserted.count;
        }
        nextRevision = revision.revision;
      }
      if (currentRevision > nextRevision && revisions.length === 0)
        throw new FuturesDemoObserverError('SOURCE_REVISION_GAP');
      if (nextRevision !== sub.lastRevision) await tx.copyFuturesDemoSubscription.update({
        where: { id: sub.id }, data: { lastRevision: nextRevision },
      });
      return { mode: 'OBSERVATION_ONLY' as const, automaticCopying: false,
        scannedRevisions: revisions.length, accepted, rejected, lastRevision: nextRevision,
        hasMore: nextRevision < currentRevision };
    }, { timeout: 20000 });
  }

  async snapshot(userId: string, sessionId: string) {
    this.on();
    return this.db.$transaction(async tx => {
      await this.authorized(tx, userId, sessionId);
      const row = await tx.copyFuturesDemoSubscription.findUnique({ where: { userId } });
      if (!row) return { mode: 'OBSERVATION_ONLY' as const, automaticCopying: false, subscription: null, events: [] };
      const events = await tx.copyFuturesDemoEvent.findMany({
        where: { subscriptionId: row.id }, orderBy: [{ sourceRevision: 'desc' }, { createdAt: 'desc' }], take: 50,
      });
      return { mode: 'OBSERVATION_ONLY' as const, automaticCopying: false,
        subscription: { traderId: row.traderId, status: row.status, lastRevision: row.lastRevision,
          maxLeverage: row.maxLeverage.toString(), maxFillUsdt: row.maxFillUsdt.toString() },
        events: events.map(e => ({ sourceEventId: e.sourceEventId, kind: e.kind, symbol: e.symbol,
          quantity: e.quantity.toString(), price: e.price.toString(), status: e.status })),
      };
    });
  }
}
