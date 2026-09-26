import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { useVisibleAccountRead } from '../useVisibleAccountRead';
import { setToken } from '../api';
import { useAdminAlertSound } from '../useAdminAlerts';
import { getAdminAlertSummary } from '../adminAlertApi';
const { JSDOM } = require('jsdom');

jest.mock('../api', () => {
  let token: string | null = 'a'; const listeners = new Set<() => void>();
  return { getToken: () => token, setToken: (next: string) => { token = next; listeners.forEach(fn => fn()); },
    onSessionChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } };
});
jest.mock('../adminAlertApi', () => ({ getAdminAlertSummary: jest.fn() }));
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
let dom: any, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  jest.useFakeTimers(); setToken('a');
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers();
  for (const key of ['document','window','localStorage','IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis,key);
});

test('mounted account reader keeps last good, queues post-mutation GET, discards old session and stops on logout', async () => {
  let release!: (n: number) => void, refresh!: () => Promise<void>;
  const read = jest.fn().mockResolvedValue(100);
  function Harness() {
    const [value, setValue] = useState<number | null>(null);
    refresh = useVisibleAccountRead({ load: read, accept: setValue, reset: () => setValue(null), staleMs: 120_000 });
    return createElement('output', null, value === null ? 'unknown' : String(value));
  }
  await act(async () => { root.render(createElement(Harness)); await flush(); });
  expect(document.querySelector('output')!.textContent).toBe('100');
  jest.runAllTicks(); // React/JSDOM microtasks are not scheduled polling timers.
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => { jest.advanceTimersByTime(3_600_000); await flush(); });
  expect(read).toHaveBeenCalledTimes(1);
  read.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await refresh(); });
  expect(document.querySelector('output')!.textContent).toBe('100');
  read.mockImplementationOnce(() => new Promise<number>(resolve => { release=resolve; })).mockResolvedValue(200);
  await act(async () => { void refresh(); await flush(); });
  await act(async () => { void refresh(); release(101); await flush(); });
  expect(document.querySelector('output')!.textContent).toBe('200');
  read.mockImplementationOnce(() => new Promise<number>(resolve => { release=resolve; })).mockResolvedValue(500);
  await act(async () => { void refresh(); await flush(); });
  await act(async () => { setToken('b'); await flush(); });
  expect(document.querySelector('output')!.textContent).toBe('500');
  await act(async () => { release(999); await flush(); });
  expect(document.querySelector('output')!.textContent).toBe('500');
  await act(async () => { setToken(''); await flush(); });
  expect(document.querySelector('output')!.textContent).toBe('unknown');
  expect(jest.getTimerCount()).toBe(0);
});

test('real alerts hook mounts only when enabled, reads hourly, sleeps hidden, retains its chime preference', async () => {
  const read=getAdminAlertSummary as jest.Mock;
  read.mockReset().mockResolvedValue({ depositId: 'd1', withdrawalId: null, kycId: null });
  localStorage.setItem('exchange_admin_alert_sound','0');
  function Harness({enabled}:{enabled:boolean}) { useAdminAlertSound(enabled); return null; }
  await act(async () => { root.render(createElement(Harness,{enabled:false})); await flush(); });
  expect(read).not.toHaveBeenCalled();
  await act(async () => { root.render(createElement(Harness,{enabled:true})); await flush(); });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(3_599_999); await flush(); });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(1); await flush(); });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => { Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new dom.window.Event('visibilitychange')); });
  expect(jest.getTimerCount()).toBe(0);
  await act(async () => { Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush(); });
  expect(read).toHaveBeenCalledTimes(2);
});
