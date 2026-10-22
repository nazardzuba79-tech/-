import express from 'express';
import request from 'supertest';
import { BackgroundWorkCoordinator, markWriteWithoutBackgroundWork, type SleepingWatcher } from '../BackgroundWorkCoordinator';

function watcher(name: string, asleep = true) {
  const w = { name, asleep, nudges: 0, nudge() { this.nudges++; } };
  return w as SleepingWatcher & { asleep: boolean; nudges: number };
}

function clock(startIso: string) {
  let now = Date.parse(startIso);
  const timers: { fn: () => void; at: number }[] = [];
  return {
    now: () => now,
    setTimer: ((fn: () => void, ms: number) => { const t = { fn, at: now + ms }; timers.push(t); return { unref() {}, t } as unknown as NodeJS.Timeout; }) as (fn: () => void, ms: number) => NodeJS.Timeout,
    clearTimer: (h: NodeJS.Timeout) => { const i = timers.indexOf((h as any).t); if (i >= 0) timers.splice(i, 1); },
    /** Advance, firing due timers in order. */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.fn();
      }
      now = end;
    },
    pending: () => timers.map((t) => new Date(t.at).toISOString()),
  };
}

describe('BackgroundWorkCoordinator', () => {
  it('a successful write re-checks only the loops that are asleep', () => {
    const c = clock('2026-09-28T10:00:00Z');
    const asleep = watcher('asleep'), awake = watcher('awake', false);
    const co = new BackgroundWorkCoordinator([asleep, awake], { now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
    co.start();
    co.activity();
    expect(asleep.nudges).toBe(1);
    expect(awake.nudges).toBe(0);
  });

  it('is rate-limited, and a write inside the window still gets one trailing re-check', () => {
    const c = clock('2026-09-28T10:00:00Z');
    const w = watcher('loop');
    const co = new BackgroundWorkCoordinator([w], { now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, activityCooldownMs: 30_000 });
    co.start();
    co.activity();                 // immediate
    for (let i = 0; i < 20; i++) { c.advance(1_000); co.activity(); } // a burst inside the window
    expect(w.nudges).toBe(1);
    c.advance(10_000);             // window ends: exactly one trailing re-check
    expect(w.nudges).toBe(2);
    c.advance(60_000);
    expect(w.nudges).toBe(2);      // and nothing after it without new writes
  });

  it('the scheduled re-check rides the funding boundary, 00:00/08:00/16:00 UTC plus the offset', () => {
    const c = clock('2026-09-28T09:30:00Z');
    const w = watcher('loop');
    const co = new BackgroundWorkCoordinator([w], { now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, reconcileAfterFundingMs: 120_000 });
    co.start();
    expect(c.pending()).toEqual(['2026-09-28T16:02:00.000Z']);
    c.advance(24 * 3_600_000);
    expect(w.nudges).toBe(3); // 16:02, 00:02, 08:02
    expect(co.stats.scheduledRechecks).toBe(3);
  });

  it('does nothing before start() or after stop(), and holds no timer when stopped', () => {
    const c = clock('2026-09-28T10:00:00Z');
    const w = watcher('loop');
    const co = new BackgroundWorkCoordinator([w], { now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
    co.activity();
    expect(w.nudges).toBe(0);
    co.start();
    co.stop();
    co.activity();
    expect(c.pending()).toEqual([]);
    expect(w.nudges).toBe(0);
  });

  it('the middleware reports only successful writes', async () => {
    const w = watcher('loop');
    const co = new BackgroundWorkCoordinator([w], { activityCooldownMs: 0 });
    co.start();
    const app = express();
    app.use(co.middleware());
    app.get('/read', (_req, res) => res.json({ ok: true }));
    app.post('/write', (_req, res) => res.status(201).json({ ok: true }));
    app.post('/refused', (_req, res) => res.status(400).json({ ok: false }));
    await request(app).get('/read');
    await request(app).post('/refused');
    expect(w.nudges).toBe(0);
    await request(app).post('/write');
    expect(w.nudges).toBe(1);
    co.stop();
  });

  it('a write its route marks as creating no work skips the re-check; every other write keeps it', async () => {
    const w = watcher('loop');
    const co = new BackgroundWorkCoordinator([w], { activityCooldownMs: 0 });
    co.start();
    const app = express();
    app.use(express.json());
    app.use(co.middleware());
    app.post('/note', (_req, res) => { markWriteWithoutBackgroundWork(res); res.status(201).json({ ok: true }); });
    app.post('/money', (_req, res) => res.status(200).json({ ok: true }));
    // Nothing the client sends can set the marker.
    await request(app).post('/money').set('X-No-Background-Work', '1').send({ markWriteWithoutBackgroundWork: true, locals: { notWork: true } });
    expect(w.nudges).toBe(1);
    await request(app).post('/note');
    await request(app).post('/note');
    expect(w.nudges).toBe(1);
    await request(app).post('/money');
    expect(w.nudges).toBe(2);
    expect(co.stats.activityRechecks).toBe(2);
    co.stop();
  });
});
