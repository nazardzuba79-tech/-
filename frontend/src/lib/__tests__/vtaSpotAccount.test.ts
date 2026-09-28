import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useVtaSpotAccount } from '../useVtaSpotAccount';
import { api, setToken } from '../api';
import { readVtaIntent, prepareVtaIntent, clearVtaIntent } from '../vtaSaleIntent';
const { JSDOM } = require('jsdom');
jest.mock('../api', () => {
  let token: string | null = null; const listeners = new Set<() => void>();
  return { api: { getMe: jest.fn(), getVtaDemo: jest.fn() }, getToken: () => token,
    setToken: (value: string) => { token = value; listeners.forEach(fn => fn()); },
    onSessionChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } };
});
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
let dom: any, root: ReturnType<typeof createRoot>, refresh: () => Promise<void>;
beforeEach(() => {
  jest.useFakeTimers(); setToken('a');
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.getElementById('root')!);
  (api.getMe as jest.Mock).mockReset().mockResolvedValue({ id: 'a', isAdmin: true });
  (api.getVtaDemo as jest.Mock).mockReset().mockResolvedValue({ account: { id: 'a' }, totalValueUsd: '123' });
});
afterEach(async () => {
  await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers();
  for (const key of ['document', 'window', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']) Reflect.deleteProperty(globalThis, key);
});
function View() {
  const account = useVtaSpotAccount(true); refresh = account.refresh;
  return createElement('output', null, account.failed ? 'unavailable' : account.snapshot?.totalValueUsd ?? 'unknown');
}
test('two mounted views share one read; mutation invalidates once; no idle polling', async () => {
  await act(async () => { root.render(createElement('div', null, createElement(View), createElement(View))); await flush(); });
  expect(api.getVtaDemo).toHaveBeenCalledTimes(1);
  expect(Array.from(document.querySelectorAll('output')).map(e => e.textContent)).toEqual(['123', '123']);
  await act(async () => { jest.advanceTimersByTime(3600000); await flush(); });
  expect(api.getVtaDemo).toHaveBeenCalledTimes(1);
  await act(async () => { await refresh(); });
  expect(api.getVtaDemo).toHaveBeenCalledTimes(2);
});
test('old-session completion cannot overwrite new account; errors are unavailable, never zero', async () => {
  let release!: (value: unknown) => void;
  (api.getVtaDemo as jest.Mock).mockImplementationOnce(() => new Promise(r => release = r)).mockResolvedValue({ account: { id: 'b' }, totalValueUsd: '77' });
  await act(async () => { root.render(createElement(View)); await flush(); });
  await act(async () => { setToken('b'); await flush(); });
  await act(async () => { release({ account: { id: 'a' }, totalValueUsd: '999' }); await flush(); });
  expect(document.querySelector('output')!.textContent).toBe('77');
  (api.getVtaDemo as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await refresh(); });
  expect(document.querySelector('output')!.textContent).toBe('unavailable');
  await act(async () => { setToken(''); await flush(); });
  expect(document.querySelector('output')!.textContent).toBe('unknown');
});
test('durable intent survives navigation and is isolated by account without losing exact quantity', () => {
  const intent = prepareVtaIntent('a', '4545454.54545454');
  expect(readVtaIntent('a')).toEqual(intent);
  expect(prepareVtaIntent('a', '1')).toEqual(intent);
  expect(readVtaIntent('b')).toBeNull();
  clearVtaIntent('b', intent.requestId); clearVtaIntent('a', 'old-request');
  expect(readVtaIntent('a')).toEqual(intent);
  expect(localStorage.getItem('voltex:vta-sale:v1:a')).not.toMatch(/token|receipt|password/i);
  clearVtaIntent('a', intent.requestId); expect(readVtaIntent('a')).toBeNull();
});
test('corrupt or unwritable recovery storage refuses to create another intent', () => {
  localStorage.setItem('voltex:vta-sale:v1:a', '{');
  expect(() => prepareVtaIntent('a', '1')).toThrow();
  expect(() => prepareVtaIntent('b', '0.000000001')).toThrow();
  const spy = jest.spyOn(dom.window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(() => prepareVtaIntent('c', '100')).toThrow('quota');
  spy.mockRestore();
});
