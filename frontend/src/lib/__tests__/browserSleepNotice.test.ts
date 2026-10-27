import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as activity from '../browserActivity';
import { futuresAccountStore } from '../futuresAccountStore';
import { api, getToken, setToken, clearToken } from '../api';
import { RU } from '../i18n/locales/ru';

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
    // Mounted bare, as main.tsx never does: the notice falls back to the default language's literals.
    '../lib/i18n': { useOptionalLanguage: () => null },
    '../lib/i18n/locales/ru': { RU },
    './BrowserSleepNotice.css': {},
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

  // A failed wake refuses every click, key and double click until a wake succeeds (lib/browserActivity).
  // Owner, 2026-10-21: that state needs a visible reason and a retry path — this is the only phase with UI.
  test('a failed session check shows one notice naming it, with retry and reload, and keeps received data', async () => {
    await mount();
    validate.mockRejectedValueOnce(new Error('Fixture validation outage'));
    await React.act(async () => { activity.sleepBrowser(); await activity.resumeBrowser(); });
    expect(activity.getBrowserPhase()).toBe('error');
    expect(activity.getBrowserResumeFailure()).toEqual({ kind: 'session', detail: 'Fixture validation outage' });
    const notice = document.querySelector('[role="alert"][data-browser-notice]')!;
    expect(notice).not.toBeNull();
    expect(notice.getAttribute('data-browser-phase')).toBe('error');
    expect(notice.getAttribute('data-browser-failure')).toBe('session');
    expect(notice.hasAttribute('hidden')).toBe(false);
    expect(notice.textContent).toContain(RU['browserResumeBlocked']);
    expect(notice.textContent).not.toContain('Fixture validation outage');
    expect(notice.querySelector('code')).toBeNull();
    const buttons = Array.from(document.querySelectorAll('button'), button => button.textContent);
    expect(buttons).toEqual([RU['browserRetry']]);
    expect(RU['browserRetry']).toBe('Повторить попытку');
    expect(document.querySelector('a, input')).toBeNull();
    expect(futuresAccountStore.getState().balances.data).toEqual(OLD_BALANCES);
    expect(futuresAccountStore.getState().positions.data).toEqual(OLD_POSITIONS);
    // «Повторить попытку» is the same wake again: validation, then the sync barrier over the account reads.
    const nextBalance = deferred<typeof NEW_BALANCES>();
    balances.mockReturnValueOnce(nextBalance.promise);
    await React.act(async () => {
      document.querySelector<HTMLButtonElement>('.browser-resume-notice__retry')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(validate).toHaveBeenCalledTimes(2);
    expect(activity.getBrowserPhase()).toBe('syncing');
    expect(document.querySelector('[data-browser-notice]')).toBeNull();
    expect(document.querySelector('[data-browser-phase="syncing"]')?.hasAttribute('hidden')).toBe(true);
    expectNoControls();
    await React.act(async () => { nextBalance.resolve(NEW_BALANCES); await flush(); });
    await tick(200);
    expect(activity.getBrowserPhase()).toBe('active');
    expect(activity.getBrowserResumeFailure()).toBeNull();
    expect(futuresAccountStore.getState().balances.data).toEqual(NEW_BALANCES);
    expect(document.getElementById('root')!.textContent).toBe(''); expectNoControls();
  });

  test('a failed account read during the wake is named on the notice; sleeping, validating and syncing stay silent', async () => {
    await mount();
    const validation = deferred<void>();
    validate.mockReturnValueOnce(validation.promise);
    balances.mockRejectedValueOnce(new Error('Fixture balance outage'));
    await React.act(async () => { activity.sleepBrowser(); await flush(); });
    expect(document.querySelector('[data-browser-notice]')).toBeNull(); expectNoControls();
    let waking!: Promise<void>;
    await React.act(async () => { waking = activity.resumeBrowser(); await flush(); });
    expect(activity.getBrowserPhase()).toBe('validating');
    expect(document.querySelector('[data-browser-notice]')).toBeNull(); expectNoControls();
    await React.act(async () => { validation.resolve(); await flush(); });
    expect(activity.getBrowserPhase()).toBe('syncing');
    expect(document.querySelector('[data-browser-notice]')).toBeNull(); expectNoControls();
    await tick(200); await React.act(async () => { await waking; });
    expect(activity.getBrowserPhase()).toBe('error');
    expect(activity.getBrowserResumeFailure()).toEqual({ kind: 'read', detail: 'Fixture balance outage' });
    const notice = document.querySelector('[role="alert"][data-browser-notice]')!;
    expect(notice.getAttribute('data-browser-failure')).toBe('read');
    expect(notice.textContent).toContain(RU['browserResumeBlocked']);
    expect(notice.textContent).not.toContain('Fixture balance outage');
    expect(notice.querySelector('code')).toBeNull();
    expect(futuresAccountStore.getState().balances.data).toEqual(OLD_BALANCES);
    expect(futuresAccountStore.getState().positions.data).toEqual(OLD_POSITIONS);
  });

  test('a failing auxiliary Futures mark quote does not block the entire terminal after wake', async () => {
    await mount();
    const quoteUrl = 'https://api.fixture.invalid/api/v1/futures/mark-price/ARIA-USDT';
    (globalThis.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (String(url) !== quoteUrl) throw new Error('Unexpected network read');
      return new Response('{"error":"fixture unavailable"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
    });
    let status: number | null = null;
    const onWake = () => {
      if (activity.getBrowserPhase() !== 'syncing') return;
      void activity.browserFetch(quoteUrl).then(response => { status = response.status; });
    };
    activity.addBrowserActivityListener(onWake);
    try {
      let waking!: Promise<void>;
      await React.act(async () => { activity.sleepBrowser(); waking = activity.resumeBrowser(); await flush(); });
      await tick(200);
      await React.act(async () => { await waking; });
      expect(status).toBe(503);
      expect(activity.getBrowserPhase()).toBe('active');
      expect(activity.getBrowserResumeFailure()).toBeNull();
      expect(document.querySelector('[data-browser-notice]')).toBeNull();
      expect(futuresAccountStore.getState().balances.data).toEqual(OLD_BALANCES);
    } finally {
      activity.removeBrowserActivityListener(onWake);
    }
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
