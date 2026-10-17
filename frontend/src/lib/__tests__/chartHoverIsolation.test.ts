const { installHoverIntervalIsolation } = require('../../../../scripts/qa-hover-interval-isolation.cjs');

function fixture() {
  let next = 1, now = 0;
  const intervals = new Map<number, () => void>();
  const timeouts: (() => void)[] = [], frames: (() => void)[] = [];
  const requests: string[] = [];
  const scope = {
    performance: { now: () => ++now },
    setInterval: (callback: () => void) => { const id = next++; intervals.set(id, callback); return id; },
    clearInterval: (id: number) => intervals.delete(id),
    setTimeout: (callback: () => void) => timeouts.push(callback),
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    fetch: (url: string) => { requests.push(url); return Promise.resolve(); },
  };
  const probe = installHoverIntervalIsolation(scope);
  return { scope, probe, requests, tick: (id: number) => intervals.get(id)?.(), timeouts, frames };
}

test('an existing periodic poll is resumed once after hover, with its cadence still alive', () => {
  const f = fixture();
  const id = f.scope.setInterval(() => { void f.scope.fetch('/candles'); });
  f.probe.begin();
  f.tick(id); f.tick(id);
  expect(f.requests).toEqual([]);
  const result = f.probe.end();
  expect(result.deferred).toHaveLength(2);
  expect(result.created).toEqual([]);
  expect(f.requests).toEqual(['/candles']);
  f.tick(id);
  expect(f.requests).toEqual(['/candles', '/candles']);
});

test('negative control: a pointer callback fetch remains visible, even at the poll URL', () => {
  const f = fixture();
  f.scope.setInterval(() => { void f.scope.fetch('/candles'); });
  f.probe.begin();
  const onPointerMove = () => f.scope.fetch('/candles');
  onPointerMove();
  expect(f.requests).toEqual(['/candles']);
  expect(f.requests.length === 0).toBe(false);
  f.probe.end();
});

test('negative controls: pointer timeouts, animation frames and microtasks are not suppressed', async () => {
  const f = fixture();
  f.probe.begin();
  f.scope.setTimeout(() => { void f.scope.fetch('/timeout'); });
  f.scope.requestAnimationFrame(() => { void f.scope.fetch('/frame'); });
  const microtask = Promise.resolve().then(() => f.scope.fetch('/microtask'));
  f.timeouts.forEach(run => run());
  f.frames.forEach(run => run());
  await microtask;
  expect(f.requests).toEqual(['/timeout', '/frame', '/microtask']);
  f.probe.end();
});

test('negative control: an interval created by hover still fires and is reported as new', () => {
  const f = fixture();
  f.probe.begin();
  const id = f.scope.setInterval(() => { void f.scope.fetch('/hover-interval'); });
  f.tick(id);
  expect(f.requests).toEqual(['/hover-interval']);
  expect(f.probe.end().created.map((x: { id: number }) => x.id)).toEqual([id]);
});

test('even a new interval whose first tick is later cannot pass the hover guard', () => {
  const f = fixture();
  f.probe.begin();
  const id = f.scope.setInterval(() => { void f.scope.fetch('/later'); });
  f.scope.clearInterval(id);
  const result = f.probe.end();
  expect(f.requests).toEqual([]);
  expect(result.created).toHaveLength(1);
});

test('a cancelled periodic task is never resurrected when the window closes', () => {
  const f = fixture();
  const id = f.scope.setInterval(() => { void f.scope.fetch('/cancelled'); });
  f.probe.begin();
  f.tick(id);
  f.scope.clearInterval(id);
  f.probe.end();
  expect(f.requests).toEqual([]);
});

test('finally resumes scheduled work after an interaction failure', () => {
  const f = fixture();
  const id = f.scope.setInterval(() => { void f.scope.fetch('/poll'); });
  expect(() => {
    f.probe.begin();
    try { f.tick(id); throw new Error('pointer action failed'); }
    finally { f.probe.end(); }
  }).toThrow('pointer action failed');
  expect(f.requests).toEqual(['/poll']);
  f.probe.begin();
  expect(f.probe.end().deferred).toEqual([]);
});
