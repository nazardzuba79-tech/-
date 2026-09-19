import { NativeCommandLane, acceptsRevision, NATIVE_CLIENT_QUEUE_LIMIT } from '../nativeCommandLane';
import { PrivateTradingError } from '../privateTradingError';

/**
 * The client's command lane, driven directly.
 *
 * The defect this replaces: `run()` returned `false` while any command —
 * including the 30-second REFRESH — was in flight, so a CLOSE clicked at
 * that moment was never sent. These tests hold a command open with a gate
 * and check that what arrives behind it is executed, in order, once.
 */
function gate<T>() {
  let release!: (value: T) => void, refuse!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { release = resolve; refuse = reject; });
  return { promise, release, refuse };
}
const tick = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

describe('NativeCommandLane', () => {
  test('a command that arrives during another waits and then runs — it is never dropped', async () => {
    const lane = new NativeCommandLane();
    const first = gate<string>();
    const order: string[] = [];
    const refresh = lane.enqueue(true, async () => { order.push('refresh:start'); const v = await first.promise; order.push('refresh:end'); return v; });
    const close = lane.enqueue(false, async () => { order.push('close'); return 'closed'; });
    expect(lane.pending).toBe(2);
    await tick();
    expect(order).toEqual(['refresh:start']);
    first.release('refreshed');
    await expect(refresh).resolves.toBe('refreshed');
    await expect(close).resolves.toBe('closed');
    expect(order).toEqual(['refresh:start', 'refresh:end', 'close']);
    expect(lane.pending).toBe(0);
  });

  test('a failure does not block the commands behind it', async () => {
    const lane = new NativeCommandLane();
    const failing = lane.enqueue(false, async () => { throw new PrivateTradingError('refused', 409, 'X'); });
    const next = lane.enqueue(false, async () => 'ok');
    await expect(failing).rejects.toMatchObject({ code: 'X' });
    await expect(next).resolves.toBe('ok');
  });

  test('a plain refresh queued behind a plain refresh shares it', async () => {
    const lane = new NativeCommandLane();
    const first = gate<number>();
    let runs = 0;
    const a = lane.enqueue(true, async () => { runs += 1; return first.promise; });
    const b = lane.enqueue(true, async () => { runs += 1; return 2; });
    expect(lane.pending).toBe(1);
    first.release(1);
    expect(await Promise.all([a, b])).toEqual([1, 1]);
    expect(runs).toBe(1);
  });

  test('a refresh queued AFTER a command is not shared with the refresh before it', async () => {
    const lane = new NativeCommandLane();
    const first = gate<string>();
    const early = lane.enqueue(true, async () => first.promise);
    const close = lane.enqueue(false, async () => 'closed');
    const late = lane.enqueue(true, async () => 'fresh');
    expect(lane.pending).toBe(3);
    first.release('stale');
    expect(await Promise.all([early, close, late])).toEqual(['stale', 'closed', 'fresh']);
  });

  test('the lane is bounded, and overflow is a structured retriable refusal', async () => {
    const lane = new NativeCommandLane(3);
    const first = gate<number>();
    const queued = [lane.enqueue(false, () => first.promise), lane.enqueue(false, async () => 2), lane.enqueue(false, async () => 3)];
    const overflow = lane.enqueue(false, async () => 4);
    await expect(overflow).rejects.toMatchObject({ code: 'client_queue_full', status: 429 });
    first.release(1);
    expect(await Promise.all(queued)).toEqual([1, 2, 3]);
    expect(lane.pending).toBe(0);
    expect(NATIVE_CLIENT_QUEUE_LIMIT).toBeGreaterThanOrEqual(4);
  });
});

describe('acceptsRevision', () => {
  const at = (revision: number, initialized = true) => ({ initialized, revision });
  test('the account only moves forward: an older receipt is not applied over a newer state', () => {
    expect(acceptsRevision(at(7), at(5))).toBe(false);
    expect(acceptsRevision(at(7), at(8))).toBe(true);
  });
  test('the same revision is applied (a refresh that changed nothing carries fresher marks)', () => {
    expect(acceptsRevision(at(7), at(7))).toBe(true);
  });
  test('an unknown or uninitialized account accepts whatever the server answers', () => {
    expect(acceptsRevision(null, at(1))).toBe(true);
    expect(acceptsRevision(at(0, false), at(1))).toBe(true);
    expect(acceptsRevision(at(9), at(0, false))).toBe(true);
  });
});
