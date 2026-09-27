import { IdleBackoffScheduler, type SweepOutcome } from '../IdleBackoffScheduler';

/**
 * SLEEP MODE. Timers are held and fired by hand, and the clock is set by
 * hand, so "holds no timer at all" is asserted exactly rather than waited on.
 */
function harness(start = 1_000_000) {
  let pending: { fn: () => void; ms: number } | null = null;
  let now = start;
  return {
    setTimer: ((fn: () => void, ms: number) => { pending = { fn, ms }; return { unref() {} } as unknown as NodeJS.Timeout; }) as (fn: () => void, ms: number) => NodeJS.Timeout,
    clearTimer: () => { pending = null; },
    now: () => now,
    advance(ms: number) { now += ms; },
    async fire() {
      const p = pending; pending = null; p?.fn();
      for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    },
    get scheduled() { return pending?.ms ?? null; },
  };
}

function make(h: ReturnType<typeof harness>, outcomes: SweepOutcome[], graceMs = 0) {
  let i = 0;
  const sweeps: number[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  const s = new IdleBackoffScheduler({
    baseMs: 5_000, maxIdleMs: 60_000, setTimer: h.setTimer, clearTimer: h.clearTimer, now: h.now,
    sleep: { graceMs },
    sweep: async () => {
      sweeps.push(h.now());
      if (hold) await new Promise<void>((r) => { release = r; });
      return outcomes[Math.min(i++, outcomes.length - 1)];
    },
  });
  return { s, sweeps, holdNext: () => { hold = true; }, release: () => { hold = false; release?.(); } };
}

describe('IdleBackoffScheduler sleep', () => {
  it('an empty sweep after the grace holds no timer at all', async () => {
    const h = harness();
    const { s, sweeps } = make(h, ['idle']);
    s.start();
    await h.fire();
    expect(sweeps).toHaveLength(1);
    expect(s.isAsleep).toBe(true);
    expect(h.scheduled).toBeNull(); // nothing will ever run on its own
  });

  it('a sweep that found work never sleeps, however long it runs', async () => {
    const h = harness();
    const { s } = make(h, ['found-work']);
    s.start();
    for (let n = 0; n < 50; n++) { h.advance(5_000); await h.fire(); }
    expect(s.isAsleep).toBe(false);
    expect(h.scheduled).toBe(5_000);
  });

  it('inside the grace an empty sweep only backs off (bounded), then sleeps once the grace is over', async () => {
    const h = harness();
    const { s } = make(h, ['idle'], 10 * 60_000);
    s.start();
    const delays: number[] = [];
    while (!s.isAsleep) {
      h.advance(h.scheduled ?? 0);
      await h.fire();
      if (h.scheduled !== null) delays.push(h.scheduled);
    }
    expect(delays.slice(0, 5)).toEqual([10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(Math.max(...delays)).toBe(60_000);
    expect(h.now() - 1_000_000).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it('wake() runs a sweep immediately and restores the base cadence when it finds work', async () => {
    const h = harness();
    const { s, sweeps } = make(h, ['idle', 'found-work']);
    s.start();
    await h.fire();
    expect(s.isAsleep).toBe(true);
    s.wake();
    expect(s.isAsleep).toBe(false);
    expect(h.scheduled).toBe(0);
    await h.fire();
    expect(sweeps).toHaveLength(2);
    expect(h.scheduled).toBe(5_000);
  });

  it('a wake that lands mid-sweep re-runs straight after, even if that sweep found nothing', async () => {
    const h = harness();
    const { s, sweeps, holdNext, release } = make(h, ['idle', 'idle', 'found-work']);
    s.start();
    await h.fire();          // sleeps
    holdNext();
    s.wake();
    const running = h.fire(); // sweep 2 in flight, will report idle
    await new Promise((r) => setImmediate(r));
    s.wake();                 // the row was committed after sweep 2 read the table
    release();
    await running;
    expect(s.isAsleep).toBe(false);
    expect(h.scheduled).toBe(0);
    await h.fire();          // sweep 3 sees it
    expect(sweeps).toHaveLength(3);
    expect(h.scheduled).toBe(5_000);
  });

  it('nudge() wakes a sleeping loop but adds nothing to one already at its base cadence with work', async () => {
    const h = harness();
    const { s, sweeps } = make(h, ['found-work', 'found-work', 'idle', 'idle']);
    s.start();
    await h.fire();
    expect(h.scheduled).toBe(5_000);
    s.nudge();
    expect(h.scheduled).toBe(5_000); // not rescheduled to 0
    h.advance(5_000); await h.fire(); // found-work
    h.advance(5_000); await h.fire(); // idle → asleep (grace 0)
    expect(s.isAsleep).toBe(true);
    s.nudge();
    expect(h.scheduled).toBe(0);
    await h.fire();
    expect(sweeps).toHaveLength(4);
  });

  it('an error is never taken as "empty": it retries at the base cadence instead of sleeping', async () => {
    const h = harness();
    const s = new IdleBackoffScheduler({
      baseMs: 5_000, maxIdleMs: 60_000, setTimer: h.setTimer, clearTimer: h.clearTimer, now: h.now, sleep: { graceMs: 0 },
      sweep: async () => { throw new Error('database unreachable'); }, onError: () => {},
    });
    s.start();
    await h.fire();
    expect(s.isAsleep).toBe(false);
    expect(h.scheduled).toBe(5_000);
  });

  it('without the sleep option nothing changes: the idle ceiling stays the worst case', async () => {
    const h = harness();
    const s = new IdleBackoffScheduler({ baseMs: 5_000, maxIdleMs: 60_000, setTimer: h.setTimer, clearTimer: h.clearTimer, sweep: async () => 'idle' });
    s.start();
    for (let n = 0; n < 20; n++) await h.fire();
    expect(s.isAsleep).toBe(false);
    expect(h.scheduled).toBe(60_000);
  });

  it('stop() leaves nothing scheduled and a later wake() does not restart it', async () => {
    const h = harness();
    const { s } = make(h, ['idle']);
    s.start();
    await h.fire();
    s.stop();
    s.wake();
    s.nudge();
    expect(h.scheduled).toBeNull();
    expect(s.isAsleep).toBe(false);
  });
});
