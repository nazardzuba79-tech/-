import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useCfdTickers } from '../useCfdTickers';
import { marketDataStore } from '../marketDataStore';
import { readDisplayJson } from '../displaySnapshotCache';
import { useVisibleAccountRead } from '../useVisibleAccountRead';
import { useAdminUserActivity } from '../../pages/admin/adminUserActivity';
import { useAdminAlertSound } from '../useAdminAlerts';
import { getAdminAlertSummary } from '../adminAlertApi';
jest.mock('../adminAlertApi', () => ({ getAdminAlertSummary: jest.fn() }));
const { JSDOM } = require('jsdom');
jest.mock('../api', () => ({ API_BASE: '/api/v1', api: {}, getToken: () => 'fixture-session', onSessionChange: () => () => {} }));
jest.mock('../displaySnapshotCache', () => ({
  DISPLAY_REFRESH_MS: 60_000, SLOW_DISPLAY_REFRESH_MS: 21_600_000,
  readDisplayJson: jest.fn(), displayRefreshDelay: () => 21_600_000,
}));
const read = readDisplayJson as jest.Mock;
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
let dom: any, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  jest.useFakeTimers();
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.getElementById('root')!);
  read.mockReset().mockImplementation(() => new Promise(() => {}));
});
afterEach(async () => {
  await act(async () => root.unmount()); marketDataStore._resetForTests();
  dom.window.close(); jest.useRealTimers();
  for (const key of ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis, key);
});

it('releases CFD snapshot ownership when switching to Copy Trading', async () => {
  function Cfd() { useCfdTickers(); return null; }
  await act(async () => { root.render(createElement(Cfd)); await flush(); });
  const signal = read.mock.calls[0][2] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal?.aborted).toBe(true);
  await act(async () => { jest.advanceTimersByTime(21_600_000); await flush(); });
  expect(read).toHaveBeenCalledTimes(1);
});

it('releases the shared Spot snapshot only when its last subscriber leaves', async () => {
  const offA = marketDataStore.subscribe(() => {});
  const offB = marketDataStore.subscribe(() => {});
  await flush();
  const signal = read.mock.calls[0][2] as AbortSignal;
  offA(); expect(signal?.aborted).toBe(false);
  offB(); expect(signal?.aborted).toBe(true);
  const offC = marketDataStore.subscribe(() => {});
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  offC();
});

it('passes a cancelled signal to the Wallet account loader on navigation to Admin', async () => {
  const load = jest.fn((_signal?: AbortSignal) => new Promise<void>(() => {}));
  function Wallet() {
    useVisibleAccountRead({ load, accept: () => {}, reset: () => {}, staleMs: 120_000 }); return null;
  }
  await act(async () => { root.render(createElement(Wallet)); await flush(); });
  const signal = load.mock.calls[0][0];
  await act(async () => root.render(null));
  expect(signal?.aborted).toBe(true);
  await act(async () => { jest.advanceTimersByTime(120_000); await flush(); });
  expect(load).toHaveBeenCalledTimes(1);
});

it('cancels Admin activity and its deadline when leaving Users', async () => {
  const schedule = jest.spyOn(globalThis, 'setTimeout');
  const clear = jest.spyOn(globalThis, 'clearTimeout');
  const load = jest.fn((_signal?: AbortSignal) => new Promise<any>(() => {}));
  function Users() { useAdminUserActivity(load); return null; }
  await act(async () => { root.render(createElement(Users)); await flush(); });
  await act(async () => root.render(null));
  expect(load.mock.calls[0][0]?.aborted).toBe(true);
  const deadline = schedule.mock.calls.findIndex(call => call[1] === 20_000);
  expect(deadline).toBeGreaterThanOrEqual(0);
  expect(clear).toHaveBeenCalledWith(schedule.mock.results[deadline].value);
  schedule.mockRestore(); clear.mockRestore();
});

it('cancels the alert cursor read when admin alerts are disabled', async () => {
  const load = getAdminAlertSummary as jest.Mock;
  load.mockReset().mockImplementation(() => new Promise(() => {}));
  function Alerts({ enabled }: { enabled: boolean }) { useAdminAlertSound(enabled); return null; }
  await act(async () => { root.render(createElement(Alerts, { enabled: true })); await flush(); });
  await act(async () => root.render(createElement(Alerts, { enabled: false })));
  expect(load.mock.calls[0][0]?.aborted).toBe(true);
});
