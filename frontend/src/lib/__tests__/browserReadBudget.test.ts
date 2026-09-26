import { createVisibleRead } from '../visibleRead';
import { subscribeFuturesMark } from '../useFuturesMark';
import { api } from '../api';
jest.mock('../api', () => ({ api: { getFuturesMarkPrice: jest.fn() } }));

const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
let doc: EventTarget & { hidden: boolean };
beforeEach(() => {
  jest.useFakeTimers();
  doc = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
});
afterEach(() => { jest.useRealTimers(); Reflect.deleteProperty(globalThis, 'document'); });
function visibility(hidden: boolean) { doc.hidden = hidden; doc.dispatchEvent(new Event('visibilitychange')); }

test('Wallet has one opening read, zero hourly timers, 120s successful-age visibility and manual refresh', async () => {
  const read = jest.fn(async () => {});
  const reader = createVisibleRead(read, 120_000);
  await flush(); expect(read).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(119_999); visibility(true); visibility(false); await flush();
  expect(read).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(2); visibility(true); visibility(false); await flush();
  expect(read).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(3_600_000); await flush(); expect(read).toHaveBeenCalledTimes(2);
  await reader.refresh(); expect(read).toHaveBeenCalledTimes(3);
  reader.stop();
});

test.each([['Admin Users', 3_600_000], ['Admin Alerts', 3_600_000], ['Mark', 30_000]])('%s: one reader, correct cadence, zero hidden timers, fresh return costs nothing', async (_name, ms) => {
  const read = jest.fn(async () => {});
  const reader = createVisibleRead(read, ms as number, true);
  await flush(); expect(read).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime((ms as number) - 1); await flush(); expect(read).toHaveBeenCalledTimes(1);
  visibility(true); expect(jest.getTimerCount()).toBe(0);
  visibility(false); await flush(); expect(read).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1); await flush(); expect(read).toHaveBeenCalledTimes(2);
  visibility(true); jest.advanceTimersByTime(7_200_000); await flush();
  expect(read).toHaveBeenCalledTimes(2); expect(jest.getTimerCount()).toBe(0);
  visibility(false); await flush(); expect(read).toHaveBeenCalledTimes(3);
  reader.stop(); expect(jest.getTimerCount()).toBe(0);
});

test('mutation during GET queues a single post-mutation read; hidden invalidations wait until visible', async () => {
  let release!: () => void;
  const read = jest.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined);
  const reader = createVisibleRead(read, 120_000);
  await flush(); void reader.refresh(); void reader.refresh();
  expect(read).toHaveBeenCalledTimes(1);
  release(); await flush(); expect(read).toHaveBeenCalledTimes(2);
  visibility(true); await reader.refresh(); expect(read).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
  visibility(false); await flush(); expect(read).toHaveBeenCalledTimes(3);
  reader.stop();
});

test('failed request does not advance successful age and cannot create a retry storm', async () => {
  const read = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('offline'));
  const reader = createVisibleRead(read, 60_000, true);
  await flush(); jest.advanceTimersByTime(60_000); await flush();
  expect(read).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(59_999); await flush(); expect(read).toHaveBeenCalledTimes(2);
  visibility(true); visibility(false); await flush(); expect(read).toHaveBeenCalledTimes(3);
  reader.stop();
});

test('hidden mount and unmount before queued read never issue a request', async () => {
  const read = jest.fn(async () => {});
  visibility(true); const hidden = createVisibleRead(read, 30_000, true);
  await flush(); expect(read).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
  hidden.stop(); visibility(false);
  const reader = createVisibleRead(read, 30_000, true); reader.stop();
  await flush(); expect(read).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});

test('form + header share exactly 20 mark reads per 10 minutes; index preserved, symbol switches isolated', async () => {
  const read = api.getFuturesMarkPrice as jest.Mock;
  read.mockReset().mockResolvedValue({ markPrice: '104235', indexPrice: '104230' });
  const header = jest.fn(), form = jest.fn();
  const offHeader = subscribeFuturesMark('BTC/USDT', header);
  const offForm = subscribeFuturesMark('BTC/USDT', form);
  await flush();
  for (let second = 1; second < 600; second++) { jest.advanceTimersByTime(1000); await flush(); }
  expect(read).toHaveBeenCalledTimes(20);
  expect(header).toHaveBeenLastCalledWith({ markPrice: 104235, indexPrice: 104230 });
  expect(form).toHaveBeenLastCalledWith({ markPrice: 104235, indexPrice: 104230 });
  visibility(true); expect(jest.getTimerCount()).toBe(0);
  offHeader(); offForm();
  const eth = jest.fn(); read.mockResolvedValue({ markPrice: '4000', indexPrice: '3999' });
  const offEth = subscribeFuturesMark('ETH/USDT', eth);
  expect(eth).toHaveBeenLastCalledWith({ markPrice: null, indexPrice: null });
  visibility(false); await flush();
  expect(eth).toHaveBeenLastCalledWith({ markPrice: 4000, indexPrice: 3999 }); offEth();
  expect(jest.getTimerCount()).toBe(0);
});
