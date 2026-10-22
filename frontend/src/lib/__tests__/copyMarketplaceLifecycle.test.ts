import { CopyMarketplaceStore } from '../copyMarketplaceStore';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const pendingFetch = () => {
  const signals: AbortSignal[] = [];
  const answers: ((value: unknown) => void)[] = [];
  const fetch = jest.fn((signal: AbortSignal) => {
    signals.push(signal);
    // Deliberately ignores abort: late network/cache answers must also be safe.
    return new Promise(resolve => answers.push(resolve));
  });
  return { fetch, signals, answers };
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('aborts the last page request and clears its deadline on navigation away', async () => {
  const f = pendingFetch();
  const store = new CopyMarketplaceStore(f.fetch, () => 'session-a', Date.now, null);
  const leave = store.subscribe(() => {});
  await flush();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  leave();
  await flush();
  expect(f.signals[0].aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(120_000);
  await flush();
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

it('a late old-session answer cannot bootstrap Copy Trading after leaving it', async () => {
  const f = pendingFetch();
  let session = 'session-a';
  const store = new CopyMarketplaceStore(f.fetch, () => session, Date.now, null);
  const leave = store.subscribe(() => {});
  await flush();
  leave();
  session = 'session-b';
  f.answers[0]({});
  await flush();
  jest.runAllTicks();
  await flush();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not fetch from a queued session change after the last unsubscribe', async () => {
  const f = pendingFetch();
  let session = 'session-a';
  const store = new CopyMarketplaceStore(f.fetch, () => session, Date.now, null);
  const leave = store.subscribe(() => {});
  await flush();
  session = 'session-b';
  store.getState();
  leave();
  jest.runAllTicks();
  await flush();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('keeps a shared request until the final subscriber leaves and refetches on immediate return', async () => {
  const f = pendingFetch();
  const store = new CopyMarketplaceStore(f.fetch, () => 'session-a', Date.now, null);
  const leaveA = store.subscribe(() => {});
  const leaveB = store.subscribe(() => {});
  await flush();
  leaveA();
  expect(f.signals[0].aborted).toBe(false);
  leaveB();
  await flush();
  const leaveC = store.subscribe(() => {});
  await flush();
  expect(f.fetch).toHaveBeenCalledTimes(2);
  f.answers[0]({});
  await flush();
  expect(f.signals[1].aborted).toBe(false);
  leaveC();
  await flush();
  expect(jest.getTimerCount()).toBe(0);
});

it('still supports an explicit intent prefetch with no page subscriber', async () => {
  const f = pendingFetch();
  const store = new CopyMarketplaceStore(f.fetch, () => 'session-a', Date.now, null);
  const done = store.prefetch();
  await flush();
  expect(f.fetch).toHaveBeenCalledTimes(1);
  f.answers[0]({});
  await done;
  expect(jest.getTimerCount()).toBe(0);
});
