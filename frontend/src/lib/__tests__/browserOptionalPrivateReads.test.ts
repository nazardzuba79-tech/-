import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import * as activity from '../browserActivity';
import { PrivateTradingError } from '../privateTradingError';
import { nativeRequestDeadline } from '../nativeRequestDeadline';

function load(name: string, imports: Record<string, unknown>) {
  const source = readFileSync(resolve(__dirname, '..', name + '.ts'), 'utf8').replace(/import\.meta\.env\.VITE_API_URL/g, 'undefined');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output: any = {};
  new Function('exports', 'require', code)(output, (key: string) => { if (!(key in imports)) throw Error(key); return imports[key]; });
  return output;
}
const privateApi = load('privateTradingApi', { './browserActivity': activity, './api': { getToken: () => 'fixture' }, './privateTradingError': { PrivateTradingError } });
const nativeApi = load('nativeDemoApi', { './browserActivity': activity, './api': { getToken: () => 'fixture' }, './privateTradingApi': privateApi, './nativeRequestDeadline': { nativeRequestDeadline } });

describe('optional engine probes use decoded outcomes without weakening session or account reads', () => {
  const originalFetch = globalThis.fetch;
  let stop: () => void;
  beforeEach(() => {
    jest.useFakeTimers();
    Object.assign(globalThis, { document: Object.assign(new EventTarget(), { hidden: false }), window: new EventTarget() });
    stop = activity.startBrowserActivity({ validate: async () => {}, identity: () => 'fixture' });
  });
  afterEach(() => { stop(); globalThis.fetch = originalFetch; jest.useRealTimers(); delete (globalThis as any).document; delete (globalThis as any).window; });

  test.each([
    ['nativeAccess', 403, 'private_access_denied', 'active'],
    ['privateAccess', 403, 'private_access_denied', 'active'],
    ['wallet', 403, 'private_access_denied', 'active'],
    ['wallet', 409, 'initialize_demo', 'active'],
    ['nativeAccess', 403, 'unexpected_policy_error', 'error'],
    ['privateAccess', 401, 'session_expired', 'error'],
    ['wallet', 401, 'session_expired', 'error'],
    ['wallet', 503, 'private_trading_unavailable', 'error'],
    ['wallet', 0, 'network', 'error'],
    ['state', 403, 'private_access_denied', 'error'],
  ] as const)('%s status %s / %s produces a %s wake', async (kind, status, code, phase) => {
    globalThis.fetch = (async () => {
      if (!status) throw new TypeError('fixture transport outage');
      return new Response(JSON.stringify({ code, error: 'fixture refusal' }), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const native = nativeApi.createNativeDemoClient('/api/v1', () => 'fixture');
    const legacy = privateApi.createPrivateTradingClient('/api/v1', () => 'fixture');
    activity.sleepBrowser(); const wake = activity.resumeBrowser();
    await Promise.resolve();
    const task = kind === 'nativeAccess' ? native.access() : kind === 'privateAccess' ? legacy.access() : kind === 'wallet' ? native.wallet() : native.state();
    const outcome = await task.then((value: unknown) => ({ value }), (error: unknown) => ({ error }));
    await jest.advanceTimersByTimeAsync(151); await wake;
    expect(activity.getBrowserPhase()).toBe(phase);
    if (kind === 'wallet' && phase === 'active') expect(outcome).toEqual({ value: null });
    else expect(outcome).toHaveProperty('error'); // Access policy still receives its refusal.
  });
});
