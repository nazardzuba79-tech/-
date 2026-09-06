import type { PrismaClient } from '@prisma/client';
import { advanceState, toResponse } from './canonical/SyntheticCopyTradingEngine';
import { createReviewSyntheticState } from './canonical/reviewSyntheticHistory';
import { advanceKseniaReview, kseniaReviewResponse } from './canonical/kseniaReview';
import { KSENIA_REVIEW } from './canonical/kseniaReview';
import { REVIEW_PERFORMANCE_V8_CONFIG } from './canonical/reviewPerformanceV8Config';
import { dayDiff, utcDay } from './canonical/analytics';
import type { CashflowReviewState } from './canonical/reviewEconomicsTypes';
import type { SyntheticCopyResponse } from './canonical/types';
import { loadPublishedKseniaState } from './approvedPerformanceSeeds';

export const PERFORMANCE_SCENARIOS = {
  nazar: { id: 'nazar-performance-v8', traderId: 'VX-001', baseline: '2026-09-05' },
  ksenia: { id: 'ksenia-performance-v1', traderId: 'VX-KSENIA', baseline: '2026-09-06' },
} as const;
export type PerformanceStrategy = keyof typeof PERFORMANCE_SCENARIOS;
export type PerformanceDatabase = Pick<PrismaClient, 'copyPerformanceScenario'>;

export function encodePerformanceState(state: CashflowReviewState): string { return JSON.stringify(state); }
export function decodePerformanceState(value: string): CashflowReviewState {
  const state = JSON.parse(value) as CashflowReviewState;
  if (state.version !== 8 || !state.cashflow || !Array.isArray(state.trades)
      || !Array.isArray(state.dailyResults) || !Number.isFinite(Date.parse(state.simulatedAt))) {
    throw new Error('Stored canonical performance is invalid; refusing to regenerate history');
  }
  return state;
}
function bootstrap(strategy: PerformanceStrategy): CashflowReviewState {
  // Fixed approved histories. Nazar's unchanged constructor matches its exact
  // published snapshot; Ksenia imports the exact already-persisted reviewed
  // state including historical numeric transport tails. Only missing NEW
  // namespaces bootstrap; existing rows are never reset or refitted.
  return strategy === 'nazar'
    ? createReviewSyntheticState(new Date('2026-09-05T12:00:00Z'))
    : loadPublishedKseniaState();
}
function advance(strategy: PerformanceStrategy, state: CashflowReviewState, today: string): CashflowReviewState {
  const missing = dayDiff(utcDay(new Date(state.simulatedAt)), today);
  for (let remaining = missing; remaining > 0; remaining -= 365) {
    const existingAum = state.aumHistory;
    state = strategy === 'nazar'
      ? advanceState(state, Math.min(remaining, 365)) as CashflowReviewState
      : advanceKseniaReview(state, Math.min(remaining, 365));
    // The canonical AUM projection is replayed from exact allocation events.
    // Reuse equal published objects so historical JSON key order is preserved
    // too, rather than merely preserving their numeric values after JSONB.
    if (state.aumHistory.length < existingAum.length || existingAum.some((old, index) => {
      const next = state.aumHistory[index];
      return Object.keys(old).length !== Object.keys(next).length
        || Object.keys(old).some(key => old[key as keyof typeof old] !== next[key as keyof typeof next]);
    })) throw new Error('Canonical append attempted to change historical AUM');
    state.aumHistory = existingAum.concat(state.aumHistory.slice(existingAum.length));
  }
  state.mode = 'REAL_TIME'; // Match the reviewed calendar publication contract.
  return state;
}

/** Normal backend read model for the globally disclosed pre-launch catalogue.
 * Only this isolated table is writable. Real copy execution, balances, orders,
 * User, and legacy admin simulation state are not capabilities of this class. */
export class CopyPerformanceService {
  private pending = new Map<PerformanceStrategy, Promise<SyntheticCopyResponse>>();
  private cached = new Map<PerformanceStrategy, { date: string; response: SyntheticCopyResponse }>();
  constructor(private db: PerformanceDatabase, private now: () => Date = () => new Date()) {}

  async get(strategy: PerformanceStrategy): Promise<SyntheticCopyResponse> {
    const today = utcDay(this.now());
    const cached = this.cached.get(strategy);
    if (cached && cached.date >= today) return cached.response;
    const pending = this.pending.get(strategy);
    if (pending) {
      await pending;
      return this.get(strategy); // Recheck UTC day if it changed while pending.
    }
    const task = this.current(strategy, today).then(state => {
      const response = strategy === 'nazar' ? toResponse(state) : kseniaReviewResponse(state);
      this.cached.set(strategy, { date: utcDay(new Date(state.simulatedAt)), response });
      return response;
    }).finally(() => this.pending.delete(strategy));
    this.pending.set(strategy, task);
    return task;
  }

  private async current(strategy: PerformanceStrategy, today: string): Promise<CashflowReviewState> {
    const { id, baseline } = PERFORMANCE_SCENARIOS[strategy];
    if (today < baseline) throw new Error('Clock precedes approved performance baseline');
    // Optimistic revision protects simultaneous requests/restarts and rolling
    // deploys across processes. Losing writers reload, never overwrite a prefix.
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await this.db.copyPerformanceScenario.findUnique({ where: { id } });
      if (!row) {
        const state = advance(strategy, bootstrap(strategy), today);
        try {
          await this.db.copyPerformanceScenario.create({ data: {
            id, stateText: encodePerformanceState(state), simulatedAt: new Date(state.simulatedAt),
          } });
          return state;
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') continue;
          throw error;
        }
      }
      const stored = decodePerformanceState(row.stateText);
      const expectedSeed = strategy === 'nazar' ? REVIEW_PERFORMANCE_V8_CONFIG.seed : KSENIA_REVIEW.seed;
      if (stored.seed !== expectedSeed) throw new Error('Stored performance namespace mismatch; refusing to rewrite history');
      if (new Date(stored.simulatedAt).getTime() !== row.simulatedAt.getTime()) {
        throw new Error('Stored performance date mismatch; refusing to rewrite history');
      }
      // Clock rollback may serve the already-persisted future snapshot; it must
      // NEVER regenerate an earlier state or remove previously appended trades.
      if (utcDay(new Date(stored.simulatedAt)) >= today) return stored;
      const next = advance(strategy, stored, today);
      const updated = await this.db.copyPerformanceScenario.updateMany({
        where: { id, revision: row.revision },
        data: { revision: { increment: 1 }, stateText: encodePerformanceState(next), simulatedAt: new Date(next.simulatedAt) },
      });
      if (updated.count === 1) return next;
    }
    throw new Error('Canonical performance append contention; retry request');
  }
}
