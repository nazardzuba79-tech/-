import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as activity from '../browserActivity';
import * as minimum from '../depositMinimum';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { JSDOM } = req('jsdom'), { createRoot } = req('react-dom/client');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const entries = (address: string) => ({ version: address, entries: [
  { assetId: 'usdt', asset: 'USDT', networkId: 'tron', networkName: 'Tron', standard: 'TRC20', address: 'fixture-tron', enabled: true },
  { assetId: 'eth', asset: 'ETH', networkId: 'ethereum', networkName: 'Ethereum', standard: 'Native', address, enabled: true },
] });
const config = (address: string) => ({ minDepositUsd: 300, usdPeggedAssets: ['USDT'], chains: [
  { chain: 'tron', nativeAsset: 'TRX', tokens: ['USDT'], supportedAssets: ['USDT'], address: 'fixture-tron' },
  { chain: 'ethereum', nativeAsset: 'ETH', tokens: [], supportedAssets: ['ETH'], address },
] });

describe('open Deposit destinations follow the actual browser lifecycle', () => {
  let dom: any, root: any, current: any, read: jest.Mock, stop: (() => void) | undefined;
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    jest.useFakeTimers(); dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    read = jest.fn(); root = createRoot(document.getElementById('root'));
    globalThis.fetch = (async () => new Response(JSON.stringify(await read()), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  });
  afterEach(async () => {
    await React.act(async () => root.unmount()); stop?.(); stop = undefined; dom.window.close(); jest.useRealTimers();
    globalThis.fetch = originalFetch;
    delete (globalThis as any).window; delete (globalThis as any).document; delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
  async function mount(manual: boolean) {
    const source = readFileSync(resolve(frontend, 'src/lib/useDepositOptions.ts'), 'utf8').replace(/import\.meta\.env/g, '({} as any)');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const output: any = {}, imports: Record<string, unknown> = {
      react: React, './browserActivity': activity, './depositMinimum': minimum,
      './depositCatalogue': { MANUAL_DEPOSIT_CATALOGUE: manual, getPublicCatalogue: () => read() },
      './api': { api: { getDepositAddress: () => { throw Error('Unexpected address fallback'); } }, getToken: () => 'fixture-token', clearToken: jest.fn() },
    };
    new Function('exports', 'require', code)(output, (name: string) => { if (!(name in imports)) throw Error(name); return imports[name]; });
    function Harness() { const wallets = output.useDepositWallets(true); current = { ...wallets, ...output.useDepositSelection(wallets.wallets, 'ETH') }; return null; }
    await React.act(async () => root.render(React.createElement(Harness)));
    stop = activity.startBrowserActivity({ validate: async () => {}, identity: () => 'fixture-session' });
  }
  const tick = (ms: number) => React.act(async () => { await jest.advanceTimersByTimeAsync(ms); });

  test.each([false, true])('mode manual=%s revalidates once on wake, keeps asset/network and waits for the rotated destination', async manual => {
    const payload = manual ? entries : config;
    read.mockResolvedValueOnce(payload('fixture-old'));
    await mount(manual);
    expect(current.asset).toBe('ETH'); expect(current.address).toBe('fixture-old');
    const selectedChain = current.chain;
    const next = deferred<unknown>(); read.mockReturnValueOnce(next.promise);
    await React.act(async () => activity.sleepBrowser());
    expect(current.address).toBeNull();
    await React.act(async () => { void activity.resumeBrowser(); });
    await tick(300);
    expect(activity.getBrowserPhase()).toBe('syncing'); expect(current.address).toBeNull(); expect(read).toHaveBeenCalledTimes(2);
    await React.act(async () => next.resolve(payload('fixture-new')));
    await tick(150);
    expect(activity.getBrowserPhase()).toBe('active'); expect(current.asset).toBe('ETH'); expect(current.chain).toBe(selectedChain);
    expect(current.address).toBe('fixture-new');
    await tick(60_000); expect(read).toHaveBeenCalledTimes(2);
  });

  test('a catalogue read suspended across sleep is discarded before one fresh read can enable the destination', async () => {
    const old = deferred<unknown>(), fresh = deferred<unknown>();
    read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await mount(true);
    await React.act(async () => { activity.sleepBrowser(); void activity.resumeBrowser(); });
    await tick(300); expect(activity.getBrowserPhase()).toBe('syncing'); expect(read).toHaveBeenCalledTimes(1);
    await React.act(async () => old.resolve(entries('fixture-suspended')));
    await tick(300);
    expect(activity.getBrowserPhase()).toBe('syncing'); expect(read).toHaveBeenCalledTimes(2); expect(current.address).toBeNull();
    await React.act(async () => fresh.resolve(entries('fixture-current')));
    await tick(150);
    expect(activity.getBrowserPhase()).toBe('active'); expect(current.address).toBe('fixture-current'); expect(current.asset).toBe('ETH');
  });
});
