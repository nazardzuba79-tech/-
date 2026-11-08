import { DepositWatchService, WATCH } from '../DepositWatchService';

afterEach(() => jest.useRealTimers());

test('one anonymous-provider budget spaces page, head and proof reads without retrying or exceeding 40 calls', async () => {
  jest.useFakeTimers({ now: 1_000_000 });
  const times: number[] = [];
  const provider = jest.fn(async () => { times.push(Date.now()); return new Response('{}'); });
  const watch = new DepositWatchService({} as any, async () => { throw Error('not needed'); }, provider);
  const summary = { providerCalls: 0, providerBytes: 0 };
  // The same run-scoped transport is shared by account pages and verifier reads.
  const transport = (watch as any).counted(summary, WATCH.anonymousRequestIntervalMs) as typeof fetch;
  await transport('https://fixture.invalid/account');
  const head = transport('https://fixture.invalid/head');
  await jest.advanceTimersByTimeAsync(999); expect(provider).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1); await head;
  const proof = transport('https://fixture.invalid/proof');
  await jest.advanceTimersByTimeAsync(1000); await proof;
  expect(times).toEqual([1_000_000, 1_001_000, 1_002_000]);
  summary.providerCalls = WATCH.maxProviderCallsPerRun;
  await expect(transport('https://fixture.invalid/over-budget')).rejects.toThrow('provider call budget');
  expect(provider).toHaveBeenCalledTimes(3);
  expect(jest.getTimerCount()).toBe(0);
});

test('configured-key transport has no artificial wait, retry or background timer', async () => {
  jest.useFakeTimers();
  const provider = jest.fn(async () => new Response('{}'));
  const watch = new DepositWatchService({} as any, async () => { throw Error('not needed'); }, provider);
  const summary = { providerCalls: 0, providerBytes: 0 };
  const transport = (watch as any).counted(summary, 0) as typeof fetch;
  await transport('https://fixture.invalid/a'); await transport('https://fixture.invalid/b');
  expect(provider).toHaveBeenCalledTimes(2); expect(jest.getTimerCount()).toBe(0);
});
