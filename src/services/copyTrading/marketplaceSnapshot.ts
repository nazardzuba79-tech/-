import { gunzipSync, gzipSync } from 'zlib';
import { resolveBuildCommit } from '../../buildCommit';
import { PERFORMANCE_SCENARIOS, yieldToEventLoop, type CopyPerformanceService, type PerformanceDatabase,
  type PerformanceStrategy } from './CopyPerformanceService';
import { summarizeStrategy } from './marketplaceSummary';
import { withKseniaReportedTrade } from './kseniaReportedTrade';
import { withKseniaReportedWeek } from './kseniaReportedWeek';
import { redactTradeHistory } from './tradeHistoryVisibility';
import { utcDay } from './canonical/analytics';
import type { SyntheticCopyResponse } from './canonical/types';

/**
 * WHY THE CARDS HUNG ON «Загрузка…», AND WHAT KEEPS THEM FROM HANGING.
 *
 * The marketplace used to build each strategy's section on the request
 * path: decode the stored ledger, append the new UTC day, re-encode it,
 * write it back, replay Nazar's presentation, then summarise. Measured on
 * one full core that is ≈ 2.5 s for Nazar and ≈ 1.5 s for Ksenia on the
 * first request of every UTC day, and ≈ 1.7 s together on the first
 * request after every process start (deploy, restart, spin-up). The work is
 * synchronous, so it scales with the CPU the process is given — and the
 * production API shares one 0.1-CPU free container with the market
 * collector. Production logged 42.29 s for that first request on
 * 2026-09-28. The browser abandons the request at 15 s, by design, so both
 * cards settled with nothing to show while every demo trader beside them —
 * needing no request — rendered normally.
 *
 * The fix is to keep that work off the request path:
 *
 *  1. The finished public section (exactly the bytes the wire carries:
 *     summarised, overlaid, redacted) is PUBLISHED per strategy — in memory
 *     and as one small compressed row beside the ledger's own row in the
 *     same isolated table. A process that has just started serves it in
 *     milliseconds instead of replaying history.
 *  2. When the published section belongs to an earlier UTC day, the
 *     request is answered with it at once and the day's append runs after
 *     the response — started only once the response has been sent, because
 *     started alongside it the synchronous replay took the container's CPU
 *     and that response waited for it anyway. The same holds for a section
 *     from an earlier build, after a deploy. It is real, previously
 *     confirmed data; its
 *     `simulation.simulatedAt` says which day it is, and the client already
 *     marks a section older than today as stale. The next refresh carries
 *     the new day. Nothing is fabricated and no history is rewritten: the
 *     ledger itself is advanced by exactly the same authoritative
 *     `CopyPerformanceService.get` as before.
 *  3. Where this process has already SHOWN it can do the day's work inside
 *     the budget, the request waits for it instead, so a fast host answers
 *     with today's figures on the first request of the day, as it always
 *     did. The measurement is the last real refresh of that strategy in
 *     this process — never a guess about the host.
 *  4. Refreshes run one strategy at a time. Two concurrent appends need a
 *     third more live heap than one after the other, measured, inside a
 *     container whose memory is shared with the collector.
 *  5. Once the marketplace has been asked for, the next UTC day is prepared
 *     a few minutes after midnight UTC — just after the 00:00 funding
 *     settlement has woken the database anyway — so the first visitor of
 *     the day normally finds it already done.
 *  6. Likewise, a process started by a deploy prepares its build's sections
 *     once, shortly after start-up, so the first visitor after a deploy
 *     normally finds them already done.
 */

export type MarketplaceSection = SyntheticCopyResponse & Record<string, unknown>;

/** The wire's section for one strategy, from the service's full response.
 *  The one place this pipeline is spelled out: redaction LAST, after the
 *  Ksenia overlays, so no overlay can put a row back into a cleaned
 *  section. See tradeHistoryVisibility.ts. */
export function marketplaceSection(strategy: PerformanceStrategy, response: SyntheticCopyResponse): MarketplaceSection {
  const summary = summarizeStrategy(response);
  return redactTradeHistory(strategy === 'ksenia'
    ? withKseniaReportedWeek(withKseniaReportedTrade(summary)) : summary) as MarketplaceSection;
}

/** Where a strategy's published section is stored: beside its ledger row,
 *  never in it. The ledger row stays the only source of history. */
export function marketplaceSnapshotId(strategy: PerformanceStrategy): string {
  return `${PERFORMANCE_SCENARIOS[strategy].id}:marketplace`;
}

const FORMAT = 'copy-marketplace-section/1';
const PACKED_PREFIX = 'gz1:';

interface PublishedSection {
  /** UTC day the section describes — its own `simulation.simulatedAt`. */
  day: string;
  /** The backend build that produced it. A section from another build is
   *  served only as a stale answer while this build produces its own. */
  build: string | null;
  section: MarketplaceSection;
}

interface Envelope {
  format: typeof FORMAT;
  strategy: PerformanceStrategy;
  day: string;
  build: string | null;
  section: MarketplaceSection;
}

export function encodeMarketplaceSnapshot(strategy: PerformanceStrategy, published: PublishedSection): string {
  const envelope: Envelope = { format: FORMAT, strategy, day: published.day, build: published.build, section: published.section };
  return PACKED_PREFIX + gzipSync(Buffer.from(JSON.stringify(envelope), 'utf8'), { level: 6 }).toString('base64');
}

/** A stored section, or null when it is not one this strategy may serve.
 *  Anything that does not decode, names another strategy or trader, or
 *  disagrees with its own date is refused rather than trusted. */
export function decodeMarketplaceSnapshot(strategy: PerformanceStrategy, value: string): PublishedSection | null {
  try {
    if (!value.startsWith(PACKED_PREFIX)) return null;
    const envelope = JSON.parse(gunzipSync(Buffer.from(value.slice(PACKED_PREFIX.length), 'base64')).toString('utf8')) as Envelope;
    const section = envelope?.section;
    if (envelope?.format !== FORMAT || envelope.strategy !== strategy || typeof envelope.day !== 'string'
      || !section || section.trader?.id !== PERFORMANCE_SCENARIOS[strategy].traderId
      || typeof section.simulation?.simulatedAt !== 'string'
      || utcDay(section.simulation.simulatedAt) !== envelope.day) return null;
    return { day: envelope.day, build: typeof envelope.build === 'string' ? envelope.build : null, section };
  } catch {
    return null;
  }
}

export interface MarketplaceSnapshotOptions {
  now?: () => Date;
  /** Wait for a stale day's refresh only if this process last did it within
   *  this many ms. Well inside the client's own 15 s abort. */
  inlineBudgetMs?: number;
  build?: string | null;
  /** Prepare each new UTC day shortly after midnight UTC, once asked for. */
  dailyRefresh?: boolean;
  /** Monotonic clock for measuring a refresh. */
  elapsed?: () => number;
  /** Prepare both sections this many ms after the process starts, once, so
   *  the first visitor after a deploy finds this build's section ready. */
  warmOnStartMs?: number;
}

export interface SectionOptions {
  /** Settles once the response carrying this answer has been sent. When the
   *  answer is the confirmed previous section, the heavy refresh waits for
   *  it: started together, the replay holds a small container's only CPU
   *  and the response that did not need it waits anyway. */
  answered?: PromiseLike<unknown>;
}

export const INLINE_REFRESH_BUDGET_MS = 10_000;
/** 00:03 UTC: after the 00:00 funding settlement has woken the database. */
export const DAILY_REFRESH_OFFSET_MS = 3 * 60_000;
const DAY_MS = 86_400_000;

export class MarketplaceSnapshots {
  private readonly now: () => Date;
  private readonly inlineBudgetMs: number;
  private readonly build: string | null;
  private readonly dailyRefresh: boolean;
  private readonly elapsed: () => number;
  private readonly memory = new Map<PerformanceStrategy, PublishedSection>();
  private readonly refreshes = new Map<PerformanceStrategy, Promise<MarketplaceSection>>();
  private readonly lastRefreshMs = new Map<PerformanceStrategy, number>();
  /** One heavy refresh at a time, in the order they were asked for. */
  private queue: Promise<unknown> = Promise.resolve();
  private dailyTimer: NodeJS.Timeout | null = null;

  constructor(private readonly db: PerformanceDatabase, private readonly service: CopyPerformanceService,
    options: MarketplaceSnapshotOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.inlineBudgetMs = options.inlineBudgetMs ?? INLINE_REFRESH_BUDGET_MS;
    this.build = options.build !== undefined ? options.build : resolveBuildCommit(process.env);
    this.dailyRefresh = options.dailyRefresh ?? false;
    this.elapsed = options.elapsed ?? (() => Number(process.hrtime.bigint() / 1_000_000n));
    if (options.warmOnStartMs !== undefined) {
      const timer = setTimeout(() => { void this.warm(); }, options.warmOnStartMs);
      timer.unref?.();
    }
  }

  /** The strategy's section for the marketplace. See the header comment. */
  async section(strategy: PerformanceStrategy, options: SectionOptions = {}): Promise<MarketplaceSection> {
    this.armDailyRefresh();
    const today = utcDay(this.now());
    const published = await this.published(strategy);
    if (published && this.isCurrent(published, today)) return published.section;
    // Nothing confirmed yet for this strategy anywhere: the authoritative
    // path is the only honest answer, once.
    if (!published) return this.refresh(strategy);
    const measured = this.lastRefreshMs.get(strategy);
    const waits = measured !== undefined && measured <= this.inlineBudgetMs;
    // Answering with the confirmed section: start the refresh only once that
    // answer has been sent (2 in the header).
    if (!waits && options.answered) {
      const start = () => { void this.refreshInBackground(strategy); };
      Promise.resolve(options.answered).then(start, start);
      return published.section;
    }
    const refresh = this.refreshInBackground(strategy);
    if (!waits) return published.section;
    // This process has done the day's work inside the budget before, so wait
    // for today's figures — but never past the budget: a refresh that is
    // slower today than it was yesterday answers with the confirmed previous
    // section and finishes behind it. Should it fail, that section is still
    // the truth this process has.
    let deadline: NodeJS.Timeout | undefined;
    const late = new Promise<MarketplaceSection>(resolve => {
      deadline = setTimeout(() => resolve(published.section), this.inlineBudgetMs);
      deadline.unref?.();
    });
    return Promise.race([refresh.catch(() => published.section), late]).finally(() => clearTimeout(deadline));
  }

  /** Prepare each section this build does not have yet, one at a time. */
  async warm(): Promise<void> {
    const today = utcDay(this.now());
    for (const strategy of ['nazar', 'ksenia'] as const) {
      try {
        const published = await this.published(strategy);
        if (!published || !this.isCurrent(published, today)) await this.refresh(strategy);
      } catch (error) {
        console.error(`[copy-trading] ${strategy} marketplace warm-up failed: `
          + (error instanceof Error ? error.message : 'unknown'));
      }
    }
  }

  private refreshInBackground(strategy: PerformanceStrategy): Promise<MarketplaceSection> {
    const refresh = this.refresh(strategy);
    refresh.catch(error => console.error(`[copy-trading] ${strategy} marketplace refresh failed: `
      + (error instanceof Error ? error.message : 'unknown')));
    return refresh;
  }

  /** Stop the daily timer. For tests and shutdown. */
  stop(): void {
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    this.dailyTimer = null;
  }

  private isCurrent(published: PublishedSection, today: string): boolean {
    // A day AFTER today can only come from a clock rolled back; the ledger
    // itself serves that stored future day too and never regenerates.
    return published.day >= today && published.build === this.build;
  }

  private async published(strategy: PerformanceStrategy): Promise<PublishedSection | null> {
    const inMemory = this.memory.get(strategy);
    if (inMemory) return inMemory;
    const row = await this.db.copyPerformanceScenario.findUnique({ where: { id: marketplaceSnapshotId(strategy) } });
    const stored = row ? decodeMarketplaceSnapshot(strategy, row.stateText) : null;
    // Another request may have published while this read was in flight.
    const newer = this.memory.get(strategy);
    if (newer) return newer;
    if (stored) this.memory.set(strategy, stored);
    return stored;
  }

  private refresh(strategy: PerformanceStrategy): Promise<MarketplaceSection> {
    const inFlight = this.refreshes.get(strategy);
    if (inFlight) return inFlight;
    const task = this.queue.then(() => this.publish(strategy));
    this.queue = task.catch(() => undefined);
    this.refreshes.set(strategy, task);
    task.then(() => this.refreshes.delete(strategy), () => this.refreshes.delete(strategy));
    return task;
  }

  private async publish(strategy: PerformanceStrategy): Promise<MarketplaceSection> {
    const started = this.elapsed();
    const response = await this.service.get(strategy);
    await yieldToEventLoop();
    const section = marketplaceSection(strategy, response);
    const published: PublishedSection = { day: utcDay(section.simulation.simulatedAt), build: this.build, section };
    this.memory.set(strategy, published);
    await yieldToEventLoop();
    try {
      await this.persist(strategy, published);
    } catch (error) {
      // The section is real and already in memory; failing to store the
      // copy only costs the next process start its shortcut.
      console.error(`[copy-trading] ${strategy} marketplace section not stored: `
        + (error instanceof Error ? error.message : 'unknown'));
    }
    this.lastRefreshMs.set(strategy, this.elapsed() - started);
    return section;
  }

  private async persist(strategy: PerformanceStrategy, published: PublishedSection): Promise<void> {
    const id = marketplaceSnapshotId(strategy);
    const data = { stateText: encodeMarketplaceSnapshot(strategy, published),
      simulatedAt: new Date(published.section.simulation.simulatedAt) };
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.db.copyPerformanceScenario.findUnique({ where: { id } });
      if (!row) {
        try {
          await this.db.copyPerformanceScenario.create({ data: { id, ...data } });
          return;
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') continue;
          throw error;
        }
      }
      // Never replace a later day with an earlier one (a process whose clock
      // is behind, or a slower instance finishing second).
      if (row.simulatedAt.getTime() > data.simulatedAt.getTime()) return;
      const updated = await this.db.copyPerformanceScenario.updateMany({
        where: { id, revision: row.revision }, data: { ...data, revision: { increment: 1 } },
      });
      if (updated.count === 1) return;
    }
  }

  private armDailyRefresh(): void {
    if (!this.dailyRefresh || this.dailyTimer) return;
    const now = this.now().getTime();
    const next = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS + DAILY_REFRESH_OFFSET_MS;
    this.dailyTimer = setTimeout(() => {
      this.dailyTimer = null;
      for (const strategy of ['nazar', 'ksenia'] as const) {
        this.refresh(strategy).catch(error => console.error(`[copy-trading] ${strategy} daily marketplace refresh failed: `
          + (error instanceof Error ? error.message : 'unknown')));
      }
      this.armDailyRefresh();
    }, next - now);
    this.dailyTimer.unref?.();
  }
}
