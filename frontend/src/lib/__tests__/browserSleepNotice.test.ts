import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as activity from '../browserActivity';
import { futuresAccountStore } from '../futuresAccountStore';
import { api, getToken, setToken, clearToken } from '../api';

jest.mock('../api', () => {
  let token: string | null = 'fixture-a';
  const listeners = new Set<() => void>();
  return {
    api: {
      getFuturesBalances: jest.fn(), getFuturesPositions: jest.fn(),
      getMyFuturesOrders: jest.fn(), getFuturesPositionHistory: jest.fn(),
    },
    getToken: () => token,
    setToken: (next: string) => { token = next; for (const fn of listeners) fn(); },
    clearToken: () => { token = null; for (const fn of listeners) fn(); },
    onSessionChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
});

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const balances = api.getFuturesBalances as jest.Mock;
const positions = api.getFuturesPositions as jest.Mock;
const OLD_BALANCES = [{ asset: 'USDT', available: '1234.5678', locked: '25' }];
const NEW_BALANCES = [{ asset: 'USDT', available: '1250.8765', locked: '25' }];
const OLD_POSITIONS = [{ id: 'fixture-position', symbol: 'BTC/USDT', size: '0.05', unrealizedPnl: '11.75', roe: '2.26' }];
function loadNotice() {
  const source = readFileSync(resolve(frontend, 'src/components/BrowserSleepNotice.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const output: any = {};
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': req('react/jsx-runtime'),
    '../lib/browserActivity': activity,
  };
  new Function('exports', 'require', code)(output, (name: string) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  });
  return output.BrowserSleepNotice;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

describe('a paused browser has no Continue UI and retains known account values', () => {
  let dom: any, root: any, Notice: any;
  let stop: (() => void) | undefined, off: (() => void) | undefined;
  let validate: jest.Mock;
  const nativeFetch = globalThis.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    // All account answers are fixtures; a stray real network read fails the test.
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('Unexpected network read'))) as typeof fetch;
    futuresAccountStore._resetForTests();
    setToken('fixture-a');
    balances.mockReset().mockResolvedValue(OLD_BALANCES);
    positions.mockReset().mockResolvedValue(OLD_POSITIONS);
    (api.getMyFuturesOrders as jest.Mock).mockReset().mockResolvedValue([]);
    (api.getFuturesPositionHistory as jest.Mock).mockReset().mockResolvedValue([]);
    validate = jest.fn(async () => {});
    Notice = loadNotice();
    root = createRoot(document.getElementById('root'));
  });

  afterEach(async () => {
    await React.act(async () => { root.unmount(); off?.(); stop?.(); });
    off = undefined; stop = undefined;
    futuresAccountStore._resetForTests();
    globalThis.fetch = nativeFetch;
    dom.window.close(); jest.useRealTimers();
    delete (globalThis as any).window; delete (globalThis as any).document;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  async function mount() {
    stop = activity.startBrowserActivity({ validate, identity: getToken });
    off = futuresAccountStore.subscribe(() => {}, { balances: 30_000, positions: 10_000 });
    await React.act(async () => { root.render(React.createElement(Notice)); await flush(); });
  }
  const tick = (ms: number) => React.act(async () => { await jest.advanceTimersByTimeAsync(ms); });
  const expectNoControls = () => expect(document.querySelector('button, a, input')).toBeNull();

  test('sleep removes the notice, preserves figures and observation times, and performs zero idle reads', async () => {
    await mount();
    expect(document.querySelector('[role="status"]')).toBeNull();
    const before = futuresAccountStore.getState();
    await React.act(async () => activity.sleepBrowser());
    await tick(3_600_000);
    expect(activity.getBrowserPhase()).toBe('sleeping');
    expect(document.getElementById('root')!.textContent).toBe(''); expectNoControls();
    const after = futuresAccountStore.getState();
    expect(after.balances).toEqual(before.balances);
    expect(after.positions).toEqual(before.positions);
    expect(after.positions.data).toEqual(OLD_POSITIONS);
    expect(after.balances.data).toEqual(OLD_BALANCES);
    expect(futuresAccountStore._timerCount).toBe(0);
    expect(balances).toHaveBeenCalledTimes(1); expect(positions).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('a quick refresh after a return shows nothing; only the hidden phase marker', async () => {
    await mount();
    const validation = deferred<void>();
    validate.mockImplementationOnce(() => validation.promise);
    await React.act(async () => { activity.sleepBrowser(); void activity.resumeBrowser(); });
    expect(activity.getBrowserPhase()).toBe('validating');
    await tick(2_900);
    expect(document.querySelector('[role="status"]')).toBeNull(); expectNoControls();
    expect(document.querySelector('[data-browser-phase="validating"]')?.hasAttribute('hidden')).toBe(true);
    await React.act(async () => { validation.resolve(); await flush(); });
    await tick(200);
    expect(activity.getBrowserPhase()).toBe('active');
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('[data-browser-phase]')).toBeNull();
  });

  test('validation and synchronization stay completely silent; the last good values are not blanked', async () => {
    await mount();
    const validation = deferred<void>(), nextBalance = deferred<typeof NEW_BALANCES>();
    validate.mockImplementationOnce(() => validation.promise);
    balances.mockImplementationOnce(() => nextBalance.promise);
    await React.act(async () => { activity.sleepBrowser(); void activity.resumeBrowser(); });
    expect(activity.getBrowserPhase()).toBe('validating'); expectNoControls();
    expect(document.querySelector('[role="status"]')).toBeNull();
    await tick(30_000);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.getElementById('root')!.textContent).toBe('');
    expect(document.querySelector('[data-browser-phase="validating"]')?.hasAttribute('hidden')).toBe(true);
    expect(futuresAccountStore.getState().balances.data).toEqual(OLD_BALANCES);
    await React.act(async () => { validation.resolve(); await flush(); });
    expect(activity.getBrowserPhase()).toBe('syncing'); expectNoControls();
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('[data-browser-phase="syncing"]')?.hasAttribute('hidden')).toBe(true);
    expect(futuresAccountStore.getState().balances).toMatchObject({ data: OLD_BALANCES, loading: false, refreshing: true });
    expect(futuresAccountStore.getState().positions.data).toEqual(OLD_POSITIONS);
    await React.act(async () => { nextBalance.resolve(NEW_BALANCES); await flush(); });
    await tick(200);
    expect(activity.getBrowserPhase()).toBe('active');
    expect(futuresAccountStore.getState().balances.data).toEqual(NEW_BALANCES);
    expect(document.querySelector('[role="status"]')).toBeNull(); expectNoControls();
  });

  test('a real global refresh failure stays silent and keeps received data', async () => {
    await mount();
    validate.mockRejectedValueOnce(new Error('Fixture validation outage'));
    await React.act(async () => { activity.sleepBrowser(); await activity.resumeBrowser(); });
    expect(activity.getBrowserPhase()).toBe('error');
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.getElementById('root')!.textContent).toBe('');
    expect(document.querySelector('[data-browser-phase="error"]')?.hasAttribute('hidden')).toBe(true);
    expectNoControls();
    expect(futuresAccountStore.getState().balances.data).toEqual(OLD_BALANCES);
    expect(futuresAccountStore.getState().positions.data).toEqual(OLD_POSITIONS);
  });

  test('a cold application lifecycle fetches fresh values without a Continue control', async () => {
    await mount();
    await React.act(async () => activity.sleepBrowser());
    await React.act(async () => { root.unmount(); off?.(); stop?.(); });
    off = undefined; stop = undefined;
    // Deterministic equivalent of replacing the old page's in-memory store.
    // This is a mounted fixture test, not a production-browser reload claim.
    futuresAccountStore._resetForTests();
    balances.mockReset().mockResolvedValue(NEW_BALANCES);
    positions.mockReset().mockResolvedValue([]);
    expect(futuresAccountStore.getState().balances.data).toBeNull();
    root = createRoot(document.getElementById('root'));
    await mount();
    expect(futuresAccountStore.getState().balances.data).toEqual(NEW_BALANCES);
    expect(futuresAccountStore.getState().positions.data).toEqual([]);
    expect(balances).toHaveBeenCalledTimes(1); expect(positions).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="status"]')).toBeNull(); expectNoControls();
  });

  test('a session change still clears private snapshots, even while the notice is hidden', async () => {
    await mount();
    await React.act(async () => { activity.sleepBrowser(); clearToken(); });
    expect(futuresAccountStore.getState().balances.data).toBeNull();
    expect(futuresAccountStore.getState().positions.data).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull(); expectNoControls();
  });
});
