import { VisibleStockReads, startVisibleStockPolling, mergeStockCandles } from '../../pages/stocks/global/readWork';
import type { Candle } from '../../pages/stocks/global/types';

test('unchanged pages retain candle identity while actual corrections, gaps and paging are preserved', () => {
  const first: Candle = { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 4 };
  const old = [first, { ...first, time: 3 }];
  expect(mergeStockCandles(old, old.map(c => ({ ...c })))).toBe(old);
  const updated = mergeStockCandles(old, [{ ...first, time: 3, close: 11.5 }, { ...first, time: 0 }]);
  expect(updated.map(c => c.time)).toEqual([0, 1, 3]);
  expect(updated[1]).toBe(first); expect(updated[2].close).toBe(11.5); expect(old[1].close).toBe(11);
  const many = Array.from({ length: 1600 }, (_, n) => ({ ...first, time: n }));
  expect(mergeStockCandles([], many)).toEqual(many.slice(-1500));
});

test('identical pending reads coalesce, different charts do not, and session reset cannot reuse an old request', async () => {
  let hidden = false, finish!: () => void;
  const gate = new VisibleStockReads(() => hidden), wait = new Promise<void>(resolve => { finish = resolve; });
  const fetch = jest.fn(() => wait);
  const first = gate.run('state:AAPL', fetch); expect(gate.run('state:AAPL', fetch)).toBe(first);
  await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(1);
  gate.run('history:AAPL:1h', fetch); await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(2);
  hidden = true; expect(gate.run('history:NVDA:1h', fetch)).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(2);
  hidden = false; gate.reset(); const next = gate.run('state:AAPL', fetch); expect(next).not.toBe(first);
  await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(3); finish(); await next;
  await gate.run('state:AAPL', fetch); expect(fetch).toHaveBeenCalledTimes(4);
});

test('hidden page starts no polling and spends no interval work; return triggers one read and resumes the same cadence', () => {
  jest.useFakeTimers();
  let hidden = true; const documentStub = new EventTarget();
  Object.defineProperty(documentStub, 'hidden', { get: () => hidden });
  Object.assign(globalThis, { document: documentStub });
  const run = jest.fn(), stop = startVisibleStockPolling(run, 3000);
  try {
    jest.advanceTimersByTime(60000); expect(run).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
    hidden = false; documentStub.dispatchEvent(new Event('visibilitychange')); expect(run).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3000); expect(run).toHaveBeenCalledTimes(2);
    hidden = true; documentStub.dispatchEvent(new Event('visibilitychange')); jest.advanceTimersByTime(60000);
    expect(run).toHaveBeenCalledTimes(2); expect(jest.getTimerCount()).toBe(0);
    hidden = false; documentStub.dispatchEvent(new Event('visibilitychange')); expect(run).toHaveBeenCalledTimes(3);
    stop(); jest.advanceTimersByTime(60000); expect(run).toHaveBeenCalledTimes(3); expect(jest.getTimerCount()).toBe(0);
  } finally { stop(); delete (globalThis as any).document; jest.useRealTimers(); }
});
