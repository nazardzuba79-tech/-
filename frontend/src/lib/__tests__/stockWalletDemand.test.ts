import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as projection from '../../pages/wallet-v3/stockPortfolio';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const source = ts.transpileModule(readFileSync(resolve(frontend, 'src/pages/wallet-v3/useStockPortfolio.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const T0 = 1_791_849_600_000;
const payload = (account = 'alice') => ({
  schema: 2, account: { id: account, mode: 'isolated-paper' },
  catalogue: [{ id: 'BYBIT:AAPLXUSDT', asset: 'AAPLX', ticker: 'AAPL', name: 'Apple' }],
  positions: { one: { instrumentId: 'BYBIT:AAPLXUSDT', currency: 'USDT', quantity: '2', available: '1',
    reserved: '1', average: '100', unrealized: '18' } },
  quotes: { 'BYBIT:AAPLXUSDT': { timestamp: Date.now(), status: { USDT: 'READY' }, prices: { USDT: { sell: '109' } } } },
});

type Pending = { url: string; init: RequestInit; ok: (body: unknown) => void; fail: (status: number) => void };

describe('Wallet Stocks demand reader', () => {
  let dom: any, root: any, token: string | null, pending: Pending[], hook: any, rows: any[], listener: (() => void) | undefined;
  let renders: { token: string | null; rows: any[] }[], ignoreAbort: boolean;
  const originalFetch = globalThis.fetch;
  const load = (enabled = true) => {
    const exports: any = {};
    new Function('exports', 'require', '__VOLTEX_STOCKS_GLOBAL_SIMULATOR__', source)(exports, (name: string) => {
      if (name === 'react') return React;
      if (name === '../../lib/api') return {
        getToken: () => token,
        onSessionChange: (callback: () => void) => { listener = callback; return () => { listener = undefined; }; },
      };
      if (name === './stockPortfolio') return projection;
      throw new Error(name);
    }, enabled);
    hook = exports.useStockPortfolio;
  };
  const Probe = ({ refresh = 0 }: { refresh?: number }) => {
    rows = hook(refresh); renders.push({ token, rows }); return null;
  };
  const flush = async (work?: () => void) => React.act(async () => {
    work?.(); for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  const render = (refresh = 0) => flush(() => root.render(React.createElement(Probe, { refresh })));
  const answer = (index: number, data: unknown = payload()) => flush(() => pending[index].ok(data));
  const visibility = (hidden: boolean) => flush(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
  });

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    jest.useFakeTimers({ now: T0, doNotFake: ['queueMicrotask'] });
    token = 'alice-token'; pending = []; rows = []; renders = []; ignoreAbort = false;
    globalThis.fetch = jest.fn((url: string, init: RequestInit) => new Promise((resolveFetch, rejectFetch) => {
      init.signal?.addEventListener('abort', () => { if (!ignoreAbort) rejectFetch(new Error('aborted')); });
      pending.push({ url, init,
        ok: body => resolveFetch({ ok: true, status: 200, json: async () => body }),
        fail: status => resolveFetch({ ok: false, status, json: async () => ({ error: 'unavailable' }) }),
      });
    })) as unknown as typeof fetch;
    root = createRoot(document.getElementById('root')); load();
  });
  afterEach(async () => {
    await flush(() => root.unmount());
    jest.useRealTimers(); globalThis.fetch = originalFetch; dom.window.close();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) delete (globalThis as any)[key];
  });

  test('uses compact authenticated portfolio read and ages valuations without another request', async () => {
    await render(); expect(pending).toHaveLength(1);
    expect(pending[0].url).toBe('/__stocks_global/portfolio');
    expect(pending[0].init).toMatchObject({ credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer alice-token' } });
    await answer(0); expect(rows[0].stockPosition.valueUSDT).toBe(218);
    await flush(() => jest.advanceTimersByTime(30_001));
    expect(rows[0].total).toBe(2); expect(rows[0].stockPosition.valueUSDT).toBeNull();
    expect(rows[0].stockPosition.unrealizedUSDT).toBeNull();
    await flush(() => jest.advanceTimersByTime(300_000));
    expect(pending).toHaveLength(1); expect(jest.getTimerCount()).toBe(0);
  });

  test('hidden tabs do no reads, abort demand and read once on return', async () => {
    await visibility(true); await render(); expect(pending).toHaveLength(0);
    await visibility(false); expect(pending).toHaveLength(1);
    await visibility(true); expect(pending[0].init.signal?.aborted).toBe(true);
    await flush(() => jest.advanceTimersByTime(60_000)); expect(pending).toHaveLength(1);
    await visibility(false); expect(pending).toHaveLength(2);
    await answer(1); expect(rows).toHaveLength(1);
  });

  test('session replacement never renders Alice holdings as Bob, including late responses', async () => {
    await render(); await answer(0);
    await render(1); ignoreAbort = true;
    await flush(() => { token = 'bob-token'; listener?.(); });
    expect(rows).toEqual([]); expect(pending[1].init.signal?.aborted).toBe(true);
    await answer(1, payload('alice')); expect(rows).toEqual([]);
    expect(renders.filter(rendered => rendered.token === 'bob-token').every(rendered => rendered.rows.length === 0)).toBe(true);
    await answer(2, { ...payload('bob'), positions: {} }); expect(rows).toEqual([]);
    await flush(() => { token = null; listener?.(); }); expect(rows).toEqual([]);
    expect(pending).toHaveLength(3);
  });

  test('a failed explicit refresh retains scoped quantity but removes unavailable valuations without retry', async () => {
    await render(); await answer(0); await render(1);
    expect(rows[0].total).toBe(2);
    await flush(() => pending[1].fail(503));
    expect(rows[0].total).toBe(2); expect(rows[0].locked).toBe(1);
    expect(rows[0].stockPosition.valueUSDT).toBeNull(); expect(rows[0].valueUsd).toBeNull();
    await flush(() => jest.advanceTimersByTime(60_000)); expect(pending).toHaveLength(2);
  });

  test('deadline aborts a stalled read without retry; unauthorized reads clear holdings', async () => {
    await render(); await answer(0); await render(1);
    await flush(() => jest.advanceTimersByTime(8_000));
    expect(pending[1].init.signal?.aborted).toBe(true);
    expect(rows[0].stockPosition.valueUSDT).toBeNull(); expect(pending).toHaveLength(2);
    await render(2); await flush(() => pending[2].fail(401)); expect(rows).toEqual([]);
  });

  test('malformed portfolio cannot replace holdings or fabricate a valuation', async () => {
    await render(); await answer(0); await render(1);
    await answer(1, { ...payload(), catalogue: {} } as any);
    expect(rows[0].total).toBe(2); expect(rows[0].stockPosition.valueUSDT).toBeNull();
  });

  test('disabled Stocks and anonymous users do not call the Stocks service', async () => {
    load(false); await render(); expect(pending).toHaveLength(0);
    load(true); token = null; await render(); expect(pending).toHaveLength(0);
  });
});
