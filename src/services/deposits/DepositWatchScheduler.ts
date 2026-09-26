import { DepositWatchService, WATCH } from './DepositWatchService';
import { nextSlotAt, WatchSchedule } from './depositWatchSchedule';

/**
 * In-process timer for the watcher's daytime slots (Europe/Kyiv 12:00,
 * 16:00, 20:00; see depositWatchSchedule.ts). The first scan of the day is
 * not timed: it runs when an admin first opens Admin → Пополнения after
 * 07:00 (POST /admin/deposit-watch/open).
 *
 * One timer, set to the next slot: no database read and no provider call
 * between slots. On process start there is one check shortly after boot; the
 * service decides whether a slot is due (a slot missed while the API slept
 * runs only the same day, before 22:00 and before the next slot; never at
 * night). The timer is unref'd, so it keeps nothing awake. No notification
 * is ever sent, and the watcher never credits.
 */
export class DepositWatchScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly stats = { fires: 0 };

  constructor(
    private watch: DepositWatchService,
    private schedule: WatchSchedule = WATCH.schedule,
    private now: () => number = Date.now,
    private startupDelayMs = 60_000,
  ) {}

  start(): void {
    if (process.env.DEPOSIT_WATCHER_SCHEDULE === 'off') return;
    this.arm(this.startupDelayMs);
  }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  /** Delay to the next daytime slot. */
  nextDelayMs(): number { return Math.max(1_000, nextSlotAt(this.now(), this.schedule) - this.now()); }

  private arm(delay: number): void {
    this.stop();
    this.timer = setTimeout(() => { void this.fire(); }, Math.min(delay, 2 ** 31 - 1));
    this.timer.unref?.();
  }

  /** Ask the service for the due slot (it refuses night, done slots and
   * duplicates), then wait for the next slot. */
  async fire(): Promise<string> {
    this.timer = null;
    this.stats.fires++;
    let outcome = 'error';
    try {
      const summary = await this.watch.runOnce('schedule');
      outcome = summary.skipped ? `${summary.skipped}${summary.notDueReason ? `:${summary.notDueReason}` : ''}` : summary.ok ? 'ran' : 'failed';
    } catch { /* recorded by the service when it can be */ }
    if (process.env.DEPOSIT_WATCHER_SCHEDULE !== 'off') this.arm(this.nextDelayMs());
    return outcome;
  }
}
