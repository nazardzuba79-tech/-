import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { JSDOM } = req('jsdom');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const summary = (value = 3) => ({ asOf: new Date().toISOString(), widgets: Object.fromEntries(
  ['readyPackages', 'pendingPackages', 'unlinkedTransfers', 'activeWithdrawals', 'pendingKyc', 'openOtc', 'totalUsers', 'newUsers24h'].map(key => [key, { value, unit: 'users', href: '/admin/kyc', status: 'ready', asOf: new Date().toISOString() }])), alerts: { depositId: null, withdrawalId: null, kycId: 'k1' } });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
let dom: any, root: any, store: any, read: jest.Mock, hidden: boolean, token: string | null, sessionListeners: Set<() => void>;
let snapshots: Record<string, any>;
function load() {
  const output: any = {};
  const source = readFileSync(resolve(frontend, 'src/pages/admin/adminWorkSummary.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(output, (name: string) => {
    if (name === 'react') return React;
    if (name.endsWith('/api')) return { getToken: () => token, onSessionChange: (fn: () => void) => { sessionListeners.add(fn); return () => sessionListeners.delete(fn); } };
    if (name.endsWith('/adminReadApi')) return { adminRead: read };
    throw new Error(`Unexpected import ${name}`);
  });
  return output;
}
function Consumer({ id = 'a', enabled = true }: { id?: string; enabled?: boolean }) {
  const state = store.useAdminWorkSummary(enabled); snapshots[id] = state;
  return React.createElement('span', { 'data-id': id }, state.data ? state.data.widgets.pendingKyc.value : 'unavailable');
}
const mount = (count = 1) => React.act(async () => { root.render(React.createElement(React.Fragment, null, ...Array.from({ length: count }, (_, i) => React.createElement(Consumer, { key: i, id: String(i) })))); await flush(); });
const tick = (ms: number) => React.act(async () => { await jest.advanceTimersByTimeAsync(ms); });
const visibility = (value: boolean) => React.act(async () => { hidden = value; document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush(); });
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin/users', pretendToBeVisual: true });
  hidden = false; token = 'fixture-owner'; sessionListeners = new Set(); snapshots = {};
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => hidden });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  read = jest.fn().mockResolvedValue(summary()); store = load();
  root = req('react-dom/client').createRoot(document.getElementById('root'));
});
afterEach(async () => { await React.act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); delete (globalThis as any).window; delete (globalThis as any).document; delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });

test('two consumers share one immediate read and one 30-second schedule', async () => {
  await mount(2); expect(read).toHaveBeenCalledTimes(1);
  await tick(29_999); expect(read).toHaveBeenCalledTimes(1);
  await tick(1); expect(read).toHaveBeenCalledTimes(2);
  expect(snapshots['0'].data).toEqual(snapshots['1'].data);
});
test('fresh focus events cannot push the original freshness deadline back', async () => {
  await mount(); await tick(20_000);
  await React.act(async () => { window.dispatchEvent(new dom.window.Event('focus')); await flush(); });
  await tick(10_000); expect(read).toHaveBeenCalledTimes(2);
});
test('leaving admin clears private summary and stops every request until a new subscriber arrives', async () => {
  await mount(); expect(document.body.textContent).toContain('3');
  await React.act(async () => root.render(null));
  read.mockImplementationOnce(() => new Promise(() => {}));
  await mount(); expect(document.body.textContent).toContain('unavailable');
  expect(read).toHaveBeenCalledTimes(2);
  await React.act(async () => root.render(null));
  await tick(120_000); expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[1][1].aborted).toBe(true);
});
test('hidden tabs abort in-flight reads, ignore late results and resume once when stale', async () => {
  const pending = deferred(); read.mockReturnValueOnce(pending.promise); await mount();
  const signal = read.mock.calls[0][1]; await visibility(true); expect(signal.aborted).toBe(true);
  await React.act(async () => { pending.resolve(summary(99)); await flush(); });
  expect(snapshots['0'].data).toBeNull(); await tick(120_000); expect(read).toHaveBeenCalledTimes(1);
  await visibility(false); expect(read).toHaveBeenCalledTimes(2); expect(snapshots['0'].data.widgets.pendingKyc.value).toBe(3);
});
test('quick tab returns keep fresh data and the original deadline', async () => {
  await mount(); await tick(20_000); await visibility(true); await tick(5_000); await visibility(false);
  expect(read).toHaveBeenCalledTimes(1); await tick(5_000); expect(read).toHaveBeenCalledTimes(2);
});
test('timeout settles a non-cooperative read, retains known data and retries at a bounded cadence', async () => {
  await mount(); read.mockImplementationOnce(() => new Promise(() => {}));
  await React.act(async () => store.refreshAdminSummary()); await tick(15_000);
  expect(snapshots['0'].loading).toBe(false); expect(snapshots['0'].error).toContain('время');
  expect(snapshots['0'].data.widgets.pendingKyc.value).toBe(3); expect(read.mock.calls[1][1].aborted).toBe(true);
  await tick(29_999); expect(read).toHaveBeenCalledTimes(2); await tick(1); expect(read).toHaveBeenCalledTimes(3);
});
test('session replacement erases prior data and ignores the old pending response', async () => {
  await mount(); const pending = deferred(); read.mockReturnValueOnce(pending.promise);
  await React.act(async () => store.refreshAdminSummary());
  read.mockResolvedValueOnce(summary(7));
  await React.act(async () => { token = 'fixture-second'; sessionListeners.forEach(fn => fn()); await flush(); });
  await React.act(async () => { pending.resolve(summary(99)); await flush(); });
  expect(snapshots['0'].data.widgets.pendingKyc.value).toBe(7);
  await React.act(async () => { token = null; sessionListeners.forEach(fn => fn()); await flush(); });
  expect(snapshots['0'].data).toBeNull(); await tick(120_000); expect(read).toHaveBeenCalledTimes(3);
});
test.each([401, 403])('permission failure %s drops retained private data', async status => {
  await mount(); read.mockRejectedValueOnce(Object.assign(new Error('denied'), { status }));
  await React.act(async () => { store.refreshAdminSummary(); await flush(); });
  expect(snapshots['0'].data).toBeNull(); expect(snapshots['0'].updatedAt).toBeNull(); expect(snapshots['0'].error).toContain('Нет доступа');
});

test('mutations during a pending snapshot coalesce exactly one follow-up and never mark the older response fresh', async () => {
  await mount(2); const earlier = deferred(), after = deferred();
  read.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(after.promise);
  await tick(30_000); expect(read).toHaveBeenCalledTimes(2);
  await React.act(async () => { store.refreshAdminSummary(); store.refreshAdminSummary(); await flush(); });
  expect(read).toHaveBeenCalledTimes(2);
  await React.act(async () => { earlier.resolve(summary(99)); await flush(); });
  expect(read).toHaveBeenCalledTimes(3); expect(snapshots['0'].loading).toBe(true);
  expect(snapshots['0'].data.widgets.pendingKyc.value).toBe(3);
  await React.act(async () => { after.resolve(summary(7)); await flush(); });
  expect(snapshots['0'].data.widgets.pendingKyc.value).toBe(7); expect(snapshots['0'].loading).toBe(false);
  await tick(29_999); expect(read).toHaveBeenCalledTimes(3);
  await tick(1); expect(read).toHaveBeenCalledTimes(4);
});

test.each(['hidden', 'unmount', 'session'])('queued forced follow-up is cleared by %s and cannot run under obsolete ownership', async lifecycle => {
  await mount(); const earlier = deferred(); read.mockReturnValueOnce(earlier.promise);
  await React.act(async () => { store.refreshAdminSummary(); store.refreshAdminSummary(); await flush(); });
  const signal = read.mock.calls[1][1];
  if (lifecycle === 'hidden') await visibility(true);
  if (lifecycle === 'unmount') await React.act(async () => root.render(null));
  if (lifecycle === 'session') await React.act(async () => { token = 'new-fixture-admin'; sessionListeners.forEach(fn => fn()); await flush(); });
  expect(signal.aborted).toBe(true);
  await React.act(async () => { earlier.resolve(summary(99)); await flush(); });
  expect(read).toHaveBeenCalledTimes(lifecycle === 'session' ? 3 : 2);
  if (lifecycle === 'hidden') {
    await tick(60_000); expect(read).toHaveBeenCalledTimes(2);
    await visibility(false); expect(read).toHaveBeenCalledTimes(3);
  }
});

test('forced invalidation while hidden makes the next visible return refresh even within the old freshness window', async () => {
  await mount(); await tick(1_000); await visibility(true);
  await React.act(async () => { store.refreshAdminSummary(); await flush(); });
  expect(read).toHaveBeenCalledTimes(1);
  await visibility(false); expect(read).toHaveBeenCalledTimes(2);
});
