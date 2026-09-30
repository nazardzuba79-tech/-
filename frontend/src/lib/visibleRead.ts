import { isBrowserInactive, addBrowserActivityListener, removeBrowserActivityListener, trackBrowserRead } from './browserActivity';
/** A read scheduler, not an account cache. Hidden/unmounted readers own no timer.
 * Successful acquisition time (not visibility or a failed attempt) determines age.
 * A mutation during a GET queues one subsequent GET; it never joins an old snapshot.
 */
export function createVisibleRead(read: (signal: AbortSignal) => Promise<void>, staleMs: number, poll = false, refreshOnWake = true) {
  let stopped = false;
  let dirty = true;
  let succeededAt: number | null = null;
  let attemptedAt: number | null = null;
  let running: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hidden = () => typeof document !== 'undefined' && isBrowserInactive();
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const schedule = () => {
    clear();
    if (stopped || hidden() || !poll || running) return;
    // Failed reads retry at the normal budget, never a zero-delay error loop.
    const since = Math.max(succeededAt ?? 0, attemptedAt ?? 0);
    timer = setTimeout(() => { timer = null; void load(); }, Math.max(1, staleMs - (Date.now() - since)));
  };
  const load = (): Promise<void> => {
    if (stopped || hidden()) return Promise.resolve();
    if (running) return running;
    clear(); dirty = false; attemptedAt = Date.now();
    const requestController = new AbortController(); controller = requestController;
    running = trackBrowserRead(Promise.resolve().then(() => {
      if (stopped || hidden()) { dirty = true; return; }
      dirty = false;
      return read(requestController.signal);
    }).then(() => { if (!stopped && !dirty) succeededAt = Date.now(); }))
      .catch(() => {
        // Keep the consumer's last-good data, but a failed explicit refresh
        // cannot make the next deliberate wake reuse it as a fresh result.
        succeededAt = null;
      })
      .finally(() => {
        running = null;
        controller = null;
        if (!stopped && dirty && !hidden()) void load(); else schedule();
      });
    return running;
  };
  const visible = (event?: Event) => {
    clear();
    if (hidden() || stopped) return;
    // Trading state must refresh on every wake. Low-frequency Admin summaries
    // retain their successful-read budget; explicit invalidations still win.
    if (refreshOnWake && event?.type === 'voltex:browser-activity') dirty = true;
    if (dirty || succeededAt === null || Date.now() - succeededAt >= staleMs) void load();
    else schedule();
  };
  addBrowserActivityListener(visible);
  visible();
  return {
    refresh: () => { dirty = true; return load(); },
    stop: () => { stopped = true; controller?.abort(); clear(); removeBrowserActivityListener(visible); },
  };
}
