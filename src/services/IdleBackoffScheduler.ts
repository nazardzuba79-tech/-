/**
 * A background sweep that slows down while there is nothing to sweep.
 *
 * Every sweep in this backend runs on a fixed `setInterval` and queries the
 * database on every tick whether or not any row can possibly match. With no
 * open positions and no resting orders, the liquidation, protection,
 * price-watcher and CFD sweeps together issued on the order of a hundred
 * queries a minute, around the clock, all of them returning nothing. The
 * database is Neon, whose compute suspends only while it is genuinely idle,
 * so a query every fraction of a second means it never suspends at all.
 *
 * The rule here is deliberately narrow: **the delay grows only after a sweep
 * that found NO ROWS AT ALL.** A sweep that found rows and simply had no
 * reason to act on them — a position that is nowhere near its liquidation
 * price, which is the normal state of a healthy position — counts as busy
 * and keeps the base cadence. So the backoff cannot reach a trader who has
 * anything open; it only ever applies to an empty table.
 *
 * That distinction is the whole safety argument, and it is easy to get
 * wrong: every one of these sweeps returns a count of ACTIONS TAKEN
 * (liquidated, triggered, executed), which is zero both for an empty table
 * and for ten healthy positions. Driving the backoff off that return value
 * would slow the liquidation check down precisely when a real position is
 * open. Callers therefore report rows FOUND, and `SweepOutcome` names the
 * two cases rather than passing a bare number that could be either.
 *
 * `wake()` collapses the delay the moment work is created, so the first
 * position after a quiet spell is picked up at the base cadence rather than
 * after a backed-off wait. It is an OPTIMISATION, NOT A CORRECTNESS
 * REQUIREMENT: if a `wake()` call is ever missed — a new code path that
 * forgets it, a refactor that drops it — the sweep still notices the work
 * within `maxIdleMs`. That bound is what keeps a missing wake-up a delay
 * instead of a silent failure, which is why it is a small number of seconds
 * rather than minutes.
 */

export type SweepOutcome =
  /** The sweep's query matched at least one row. Stay at the base cadence. */
  | 'found-work'
  /** The query matched nothing at all. Only this may grow the delay. */
  | 'idle';

export interface IdleBackoffOptions {
  /** The cadence to run at whenever there is work. Unchanged from before. */
  baseMs: number;
  /** Ceiling on the idle delay, and the worst case if a wake() is missed. */
  maxIdleMs: number;
  /** One pass. Must report whether its query MATCHED ROWS, not whether it
   *  acted on them. */
  sweep: () => Promise<SweepOutcome>;
  /** Reported rather than thrown: a failing sweep must not kill the loop. */
  onError?: (err: unknown) => void;
  /** Injectable for deterministic tests. */
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (handle: NodeJS.Timeout) => void;
}

export class IdleBackoffScheduler {
  private readonly baseMs: number;
  private readonly maxIdleMs: number;
  private readonly sweep: () => Promise<SweepOutcome>;
  private readonly onError?: (err: unknown) => void;
  private readonly setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearTimer: (handle: NodeJS.Timeout) => void;

  private timer: NodeJS.Timeout | null = null;
  private delayMs: number;
  private running = false;
  private stopped = true;
  /** A wake that lands mid-sweep must not be lost: the sweep in flight may
   *  have already read the table before the new row was committed. */
  private wakePending = false;

  constructor(options: IdleBackoffOptions) {
    this.baseMs = options.baseMs;
    this.maxIdleMs = Math.max(options.maxIdleMs, options.baseMs);
    this.sweep = options.sweep;
    this.onError = options.onError;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.delayMs = this.baseMs;
  }

  /** The delay the next tick is currently scheduled at. For tests and for
   *  anything that wants to report how idle this loop has gone. */
  get currentDelayMs(): number {
    return this.delayMs;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.delayMs = this.baseMs;
    this.schedule(this.baseMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /**
   * Work was just created — run at the base cadence again, now.
   *
   * Safe to call from inside the transaction that created the work: it
   * touches no database and never throws.
   */
  wake(): void {
    this.delayMs = this.baseMs;
    if (this.stopped) return;
    if (this.running) {
      // The in-flight sweep may have queried before this row existed, so
      // it cannot be trusted to have seen it. Re-run straight after.
      this.wakePending = true;
      return;
    }
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => void this.tick(), ms);
    // Never hold the process open on account of a background sweep.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    let outcome: SweepOutcome = 'idle';
    try {
      outcome = await this.sweep();
    } catch (err) {
      this.onError?.(err);
      // An error is not evidence that the table is empty, so it must not
      // earn a longer delay — retry at the cadence we were already on.
      outcome = 'found-work';
    } finally {
      this.running = false;
    }

    if (this.wakePending) {
      this.wakePending = false;
      this.delayMs = this.baseMs;
      this.schedule(0);
      return;
    }

    this.delayMs =
      outcome === 'found-work' ? this.baseMs : Math.min(this.delayMs * 2, this.maxIdleMs);
    this.schedule(this.delayMs);
  }
}
