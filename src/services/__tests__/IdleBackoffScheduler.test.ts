import { IdleBackoffScheduler, type SweepOutcome } from '../IdleBackoffScheduler';

/**
 * A controllable clock. Timers are held and fired by hand so the delays the
 * scheduler asks for can be asserted exactly, rather than waited on.
 */
function harness() {
  let pending: { fn: () => void; ms: number } | null = null;
  const asked: number[] = [];
  return {
    asked,
    setTimer: ((fn: () => void, ms: number) => {
      asked.push(ms);
      pending = { fn, ms };
      return { unref() {} } as unknown as NodeJS.Timeout;
    }) as (fn: () => void, ms: number) => NodeJS.Timeout,
    clearTimer: () => { pending = null; },
    /** Fire the scheduled timer and let its async sweep settle. */
    async fire() {
      const p = pending;
      pending = null;
      p?.fn();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    },
    get scheduled() { return pending?.ms ?? null; },
  };
}

function make(outcomes: SweepOutcome[], h: ReturnType<typeof harness>, onError?: (e: unknown) => void) {
  let i = 0;
  const calls: number[] = [];
  const s = new IdleBackoffScheduler({
    baseMs: 5_000,
    maxIdleMs: 60_000,
    sweep: async () => {
      calls.push(Date.now());
      const next = outcomes[Math.min(i, outcomes.length - 1)];
      i++;
      if (next === ('throw' as SweepOutcome)) throw new Error('sweep failed');
      return next;
    },
    onError,
    setTimer: h.setTimer,
    clearTimer: h.clearTimer,
  });
  return { scheduler: s, calls };
}

describe('IdleBackoffScheduler', () => {
  it('keeps the base cadence while the sweep finds rows', async () => {
    const h = harness();
    const { scheduler } = make(['found-work'], h);
    scheduler.start();
    for (let i = 0; i < 4; i++) await h.fire();
    expect(scheduler.currentDelayMs).toBe(5_000);
    expect(h.asked.slice(1)).toEqual([5_000, 5_000, 5_000, 5_000]);
  });

  /**
   * THE TRAP THIS CLASS EXISTS FOR. Every sweep in this backend returns a
   * count of ACTIONS TAKEN, which is zero for an empty table and equally
   * zero for ten healthy positions that simply are not near liquidation.
   * A scheduler driven off that number would back off while real positions
   * are open. 'found-work' means rows MATCHED, and it must hold the base
   * cadence even though nothing was acted on.
   */
  it('does NOT back off when a sweep found rows but acted on none', async () => {
    const h = harness();
    const { scheduler } = make(['found-work'], h);
    scheduler.start();
    for (let i = 0; i < 6; i++) await h.fire();
    expect(scheduler.currentDelayMs).toBe(5_000);
    expect(h.asked.every((ms) => ms === 5_000)).toBe(true);
  });

  it('doubles the delay only while the table is empty, up to the ceiling', async () => {
    const h = harness();
    const { scheduler } = make(['idle'], h);
    scheduler.start();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) { await h.fire(); seen.push(scheduler.currentDelayMs); }
    expect(seen).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
  });

  it('never exceeds maxIdleMs however long it stays idle', async () => {
    const h = harness();
    const { scheduler } = make(['idle'], h);
    scheduler.start();
    for (let i = 0; i < 40; i++) await h.fire();
    expect(scheduler.currentDelayMs).toBe(60_000);
    expect(Math.max(...h.asked)).toBe(60_000);
  });

  it('wake() drops back to the base cadence and runs immediately', async () => {
    const h = harness();
    const { scheduler, calls } = make(['idle'], h);
    scheduler.start();
    for (let i = 0; i < 3; i++) await h.fire();
    expect(scheduler.currentDelayMs).toBe(40_000);

    scheduler.wake();
    expect(scheduler.currentDelayMs).toBe(5_000);
    expect(h.scheduled).toBe(0); // now, not after the backed-off wait
    const before = calls.length;
    await h.fire();
    expect(calls.length).toBe(before + 1);
  });

  /**
   * A position committed while a sweep is mid-flight may not be visible to
   * the query that sweep already ran, so the wake must survive it.
   */
  it('does not lose a wake() that arrives while a sweep is in flight', async () => {
    const h = harness();
    let release: (() => void) | null = null;
    const calls: number[] = [];
    const scheduler = new IdleBackoffScheduler({
      baseMs: 5_000,
      maxIdleMs: 60_000,
      sweep: async () => {
        calls.push(1);
        await new Promise<void>((r) => { release = r; });
        return 'idle';
      },
      setTimer: h.setTimer,
      clearTimer: h.clearTimer,
    });
    scheduler.start();
    h.fire(); // starts the sweep, which now blocks
    await new Promise((r) => setImmediate(r));
    expect(calls.length).toBe(1);

    scheduler.wake(); // lands mid-sweep
    release!();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // The idle result must NOT have earned a longer delay, and the next run
    // must be immediate rather than backed off.
    expect(scheduler.currentDelayMs).toBe(5_000);
    expect(h.scheduled).toBe(0);
  });

  it('a failing sweep is reported, does not stop the loop, and does not earn a longer delay', async () => {
    const h = harness();
    const errors: unknown[] = [];
    const { scheduler, calls } = make(['throw' as SweepOutcome], h, (e) => errors.push(e));
    scheduler.start();
    await h.fire();
    expect(errors).toHaveLength(1);
    // An error is not evidence the table is empty.
    expect(scheduler.currentDelayMs).toBe(5_000);
    await h.fire();
    expect(calls.length).toBe(2); // still looping
  });

  it('stop() prevents any further sweep, and wake() after stop does not restart it', async () => {
    const h = harness();
    const { scheduler, calls } = make(['found-work'], h);
    scheduler.start();
    await h.fire();
    const after = calls.length;
    scheduler.stop();
    scheduler.wake();
    expect(h.scheduled).toBeNull();
    await h.fire();
    expect(calls.length).toBe(after);
  });

  it('treats a maxIdleMs below the base cadence as the base cadence', async () => {
    const h = harness();
    const s = new IdleBackoffScheduler({
      baseMs: 5_000, maxIdleMs: 1_000,
      sweep: async () => 'idle',
      setTimer: h.setTimer, clearTimer: h.clearTimer,
    });
    s.start();
    await h.fire();
    expect(s.currentDelayMs).toBe(5_000); // never faster than the base
  });
});
