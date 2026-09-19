import { PrivateTradingError } from './privateTradingError';

/**
 * THE CLIENT'S ORDERED LANE FOR NATIVE COMMANDS.
 *
 * The controller used to keep one boolean, `pending`, and `run()` returned
 * `false` the moment it was set. The 30-second REFRESH shares that path, so
 * a CLOSE clicked while a refresh was in flight was never sent and the
 * trader saw "Операция не подтверждена" for a click that nobody refused.
 *
 * Commands now wait their turn instead. The rules are the server's own:
 * one command at a time, in arrival order; a plain REFRESH that is still
 * the tail of the lane is shared with the next plain REFRESH rather than
 * sent twice (a refresh queued behind a CLOSE is not shared, because it
 * has to observe the close); and the lane is bounded, so a runaway loop
 * gets an explicit retriable refusal instead of a silent drop.
 *
 * No React, no `import.meta`, no network: the class is the whole policy,
 * and the hook only wires it to the API client.
 */
export const NATIVE_CLIENT_QUEUE_LIMIT = 8;

export class NativeCommandLane {
  private chain: Promise<unknown> = Promise.resolve();
  private depth = 0;
  private tailRefresh: Promise<unknown> | null = null;

  constructor(readonly limit = NATIVE_CLIENT_QUEUE_LIMIT) {}

  /** Commands running or waiting. */
  get pending() { return this.depth; }

  /**
   * Run `task` after everything queued before it. `coalesce` marks a plain
   * REFRESH: if the lane's tail is already such a refresh, its promise is
   * returned and nothing new is queued.
   */
  enqueue<T>(coalesce: boolean, task: () => Promise<T>): Promise<T> {
    if (coalesce && this.tailRefresh) return this.tailRefresh as Promise<T>;
    if (this.depth >= this.limit) {
      return Promise.reject(new PrivateTradingError('Слишком много операций в очереди. Повторите через секунду', 429, 'client_queue_full'));
    }
    this.depth += 1;
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    this.tailRefresh = coalesce ? run : null;
    const settle = () => { this.depth -= 1; if (this.tailRefresh === run) this.tailRefresh = null; };
    run.then(settle, settle);
    return run;
  }

  /** Forget the shared refresh (a session boundary). Queued tasks decide for themselves whether they may still run. */
  reset() { this.tailRefresh = null; }
}

/**
 * An older receipt never overwrites a newer account.
 *
 * A retried command answers with the revision it committed, which may be
 * older than what a later command has already painted; a slow refresh can
 * land after the close that followed it. The account moves forward only.
 * A refresh that changed nothing answers with the SAME revision and fresh
 * marks, so equality is accepted; only a strictly older revision is not.
 */
export function acceptsRevision(
  current: { initialized: boolean; revision: number } | null,
  next: { initialized: boolean; revision: number },
): boolean {
  if (!current || !current.initialized || !next.initialized) return true;
  return next.revision >= current.revision;
}
