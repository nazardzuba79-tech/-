import { DepositWatchService, watcherIntervalMs } from './DepositWatchService';

/**
 * Automatic deposit discovery, default every 6 hours (4 scans a day;
 * DEPOSIT_WATCHER_INTERVAL_MINUTES, minimum 60). Its only purpose is that
 * new on-chain transfers appear in Admin → Пополнения periodically. It sends
 * no push, email or other notification (the owner's wallet app is the
 * real-time source) and it never credits anything.
 *
 * One timer, set to the next due time: between runs there is no database
 * read and no provider call at all. On process start the stored state is read
 * once; an overdue scan (e.g. the API slept past its slot) runs shortly after
 * start, otherwise the timer waits for the slot. The service itself refuses a
 * scheduled run before the interval, so a restart or an external trigger can
 * never make it more frequent. The timer is unref'd: it keeps nothing awake.
 * Paused (the default) → no timer at all.
 */
export class DepositWatchScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  readonly stats = { runs: 0, stateReads: 0 };

  constructor(
    private watch: DepositWatchService,
    readonly intervalMs = watcherIntervalMs(),
    private now: () => number = Date.now,
    private startupDelayMs = 60_000,
  ) {}

  async start(): Promise<void> {
    if (process.env.DEPOSIT_WATCHER_SCHEDULE === 'off') return;
    try {
      this.stats.stateReads++;
      const state = await this.watch.ensureState();
      this.enabled = state.enabled;
      this.arm(state.lastScheduledRunAt?.getTime() ?? null);
    } catch { /* database unavailable at boot: stay idle until an admin toggles */ }
  }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  /** Admin toggled automatic scans in this process. */
  setEnabled(enabled: boolean, lastScheduledRunAt: number | null = null): void {
    this.enabled = enabled;
    this.arm(lastScheduledRunAt);
  }

  /** Delay until the next automatic run, or null when paused. */
  nextDelayMs(lastScheduledRunAt: number | null): number | null {
    if (!this.enabled) return null;
    if (lastScheduledRunAt === null) return this.startupDelayMs;
    return Math.max(this.startupDelayMs, lastScheduledRunAt + this.intervalMs - this.now());
  }

  private arm(lastScheduledRunAt: number | null): void {
    this.stop();
    const delay = this.nextDelayMs(lastScheduledRunAt);
    if (delay === null) return;
    // setTimeout's ceiling is ~24.8 days; the interval is hours.
    this.timer = setTimeout(() => { void this.fire(); }, Math.min(delay, 2 ** 31 - 1));
    this.timer.unref?.();
  }

  /** One automatic run, then re-arm for the next slot. */
  async fire(): Promise<string> {
    this.timer = null;
    let outcome = 'error';
    try {
      const summary = await this.watch.runOnce('schedule');
      this.stats.runs++;
      outcome = summary.skipped ?? (summary.ok ? 'ran' : 'failed');
      if (summary.skipped === 'PAUSED') this.enabled = false;
    } catch { /* recorded by the service when it can be */ }
    // A skipped NOT_DUE/LEASE_HELD run re-arms from now; a run re-arms from its start.
    this.arm(this.now());
    return outcome;
  }
}
