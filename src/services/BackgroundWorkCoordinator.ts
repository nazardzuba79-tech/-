import type { NextFunction, Request, Response } from 'express';
import { msUntilNextFundingBoundary } from '../futures/FundingRateService';
import { ACTIVITY_RECONCILE_COOLDOWN_MS, RECONCILE_AFTER_FUNDING_MS } from '../config/limits';

/** A background loop that can sleep: nudge() re-checks its table once. */
export interface SleepingWatcher {
  readonly name: string;
  readonly asleep: boolean;
  nudge(): void;
}

const NOT_WORK = Symbol('voltex.writeCreatesNoBackgroundWork');

/**
 * Marks THIS response as a write that creates no background work (it only
 * appends a note no loop reads), so it does not re-check the sleeping loops.
 * Set by the route itself, on the server; nothing a client sends can set it.
 * Every other write keeps the re-check.
 */
export function markWriteWithoutBackgroundWork(res: Response): void {
  res.locals[NOT_WORK as unknown as string] = true;
}

export interface BackgroundWorkCoordinatorOptions {
  activityCooldownMs?: number;
  reconcileAfterFundingMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (handle: NodeJS.Timeout) => void;
}

/**
 * The safety net under the sleeping background loops.
 *
 * Each loop is woken by the mutation that creates its work, right after the
 * commit. Those wakes are what make sleeping safe, so a code path that
 * creates work and forgets its wake would leave that work unwatched. This
 * class makes sure such a miss is a short delay rather than a silent one,
 * without ever waking the database on its own account:
 *
 *  - ACTIVITY. Every successful mutating API request (anything but GET /
 *    HEAD / OPTIONS, answered below 400) re-checks every sleeping loop,
 *    at most once per `activityCooldownMs`, with one trailing re-check for
 *    requests inside that window. Every way work is created in this backend
 *    is such a request, and the database is awake for it anyway. The one
 *    exception is a route that marks its own response with
 *    markWriteWithoutBackgroundWork (today: the deposit-address copy note,
 *    which no loop reads).
 *
 *  - SCHEDULE. One re-check every funding boundary (00:00 / 08:00 / 16:00
 *    UTC) plus `reconcileAfterFundingMs`: the funding settlement has just
 *    woken the database, so this costs no wake of its own. It covers work
 *    that reached the database with no request to this instance at all.
 *
 * A re-check only nudges loops that are ASLEEP, and a nudged loop runs one
 * sweep: if it finds work it stays awake, otherwise it goes back to sleep.
 */
export class BackgroundWorkCoordinator {
  private readonly cooldownMs: number;
  private readonly afterFundingMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearTimer: (handle: NodeJS.Timeout) => void;
  private lastActivityRecheck = Number.NEGATIVE_INFINITY;
  private trailing: NodeJS.Timeout | null = null;
  private scheduled: NodeJS.Timeout | null = null;
  private started = false;
  readonly stats = { activityRechecks: 0, scheduledRechecks: 0, nudges: 0 };

  constructor(private readonly watchers: SleepingWatcher[], options: BackgroundWorkCoordinatorOptions = {}) {
    this.cooldownMs = options.activityCooldownMs ?? ACTIVITY_RECONCILE_COOLDOWN_MS;
    this.afterFundingMs = options.reconcileAfterFundingMs ?? RECONCILE_AFTER_FUNDING_MS;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.armScheduled();
  }

  stop(): void {
    this.started = false;
    if (this.scheduled) this.clearTimer(this.scheduled);
    if (this.trailing) this.clearTimer(this.trailing);
    this.scheduled = null;
    this.trailing = null;
  }

  /** Names of the loops currently asleep. For diagnostics and tests. */
  sleeping(): string[] {
    return this.watchers.filter((w) => w.asleep).map((w) => w.name);
  }

  /** A write succeeded somewhere: re-check sleeping loops, rate-limited. */
  activity(): void {
    if (!this.started) return;
    const now = this.now();
    if (now - this.lastActivityRecheck >= this.cooldownMs) {
      this.lastActivityRecheck = now;
      this.stats.activityRechecks++;
      this.recheck();
      return;
    }
    // Inside the window: one trailing re-check at its end, so a write here is
    // never left uncovered.
    if (this.trailing) return;
    this.trailing = this.setTimer(() => {
      this.trailing = null;
      this.lastActivityRecheck = this.now();
      this.stats.activityRechecks++;
      this.recheck();
    }, this.cooldownMs - (now - this.lastActivityRecheck));
    this.trailing.unref?.();
  }

  /** Express middleware: report successful writes as activity. */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        // After the response: nothing here may reach the request, or crash
        // the process from an event listener.
        res.once('finish', () => {
          if (res.statusCode >= 400 || res.locals[NOT_WORK as unknown as string] === true) return;
          try { this.activity(); } catch (err) { console.error('[background] activity re-check failed', err); }
        });
      }
      next();
    };
  }

  private recheck(): void {
    for (const watcher of this.watchers) {
      if (!watcher.asleep) continue;
      this.stats.nudges++;
      try { watcher.nudge(); } catch (err) { console.error(`[background] nudge ${watcher.name} failed`, err); }
    }
  }

  private armScheduled(): void {
    if (!this.started) return;
    const delay = msUntilNextFundingBoundary(new Date(this.now())) + this.afterFundingMs;
    this.scheduled = this.setTimer(() => {
      this.scheduled = null;
      this.stats.scheduledRechecks++;
      this.recheck();
      this.armScheduled();
    }, delay);
    this.scheduled.unref?.();
  }
}
