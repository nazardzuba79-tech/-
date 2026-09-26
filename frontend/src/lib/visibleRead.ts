/** A read scheduler, not an account cache. Hidden/unmounted readers own no timer.
 * Successful acquisition time (not visibility or a failed attempt) determines age.
 * A mutation during a GET queues one subsequent GET; it never joins an old snapshot.
 */
export function createVisibleRead(read: () => Promise<void>, staleMs: number, poll = false) {
  let stopped = false;
  let dirty = true;
  let succeededAt: number | null = null;
  let attemptedAt: number | null = null;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hidden = () => typeof document !== 'undefined' && document.hidden;
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
    running = Promise.resolve().then(() => {
      if (stopped || hidden()) { dirty = true; return; }
      dirty = false;
      return read();
    }).then(() => { if (!stopped && !dirty) succeededAt = Date.now(); })
      .catch(() => { /* The consumer preserves last-good data and reports failure. */ })
      .finally(() => {
        running = null;
        if (!stopped && dirty && !hidden()) void load(); else schedule();
      });
    return running;
  };
  const visible = () => {
    clear();
    if (hidden() || stopped) return;
    if (dirty || succeededAt === null || Date.now() - succeededAt >= staleMs) void load();
    else schedule();
  };
  document.addEventListener('visibilitychange', visible);
  visible();
  return {
    refresh: () => { dirty = true; return load(); },
    stop: () => { stopped = true; clear(); document.removeEventListener('visibilitychange', visible); },
  };
}
