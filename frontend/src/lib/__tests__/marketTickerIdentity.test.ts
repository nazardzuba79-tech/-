import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import * as testMarkets from '../testMarkets';

// Execute the real hook with a persistent memo slot, without starting stores
// or network subscriptions. Its consumer (OrderForm) derives state in an
// effect keyed by ticker identity.
function session() {
  let assets: testMarkets.TestAsset[] = [];
  const btc = { pair: 'BTC/USDT', lastPrice: '65000' };
  const state = { loaded: true, status: 'ready', tickers: new Map([['BTC/USDT', btc]]) };
  let previous: unknown[] | undefined;
  let memo: unknown;
  const exports: any = {};
  const js = ts.transpileModule(readFileSync(resolve(__dirname, '../useMarketData.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', 'require', js)(exports, (name: string) => {
    if (name === 'react') return {
      useState: (initial: () => unknown) => [initial(), () => {}],
      useEffect: () => {},
      useMemo: (create: () => unknown, deps: unknown[]) => {
        if (!previous || deps.some((value, i) => !Object.is(value, previous![i]))) {
          memo = create(); previous = deps;
        }
        return memo;
      },
    };
    if (name === './marketDataStore') return { marketDataStore: { getState: () => state } };
    if (name === './testMarketStore') return { useTestMarkets: () => ({ assets, loaded: true, error: false }) };
    if (name === './testMarkets') return testMarkets;
    throw new Error('Unexpected dependency: ' + name);
  });
  const setPrice = (price: number | null) => {
    assets = testMarkets.parseTestMarkets({ serverTime: 1, assets: [{
      pair: 'VTA/USDT', isTestAsset: true, isTradable: false, listingAt: '2026-09-28T15:00:00Z',
      state: { phase: price === null ? 'pre-listing' : 'live', lastPrice: price, serverTime: 1 },
    }] })!.assets;
  };
  return { read: (pair = 'VTA/USDT') => exports.useMarketTicker(pair).ticker, setPrice, btc };
}

test('VTA consumer effects settle until the source price changes', () => {
  const hook = session();
  hook.setPrice(0.42);
  const first = hook.read();
  for (let i = 0; i < 25; i++) expect(hook.read()).toBe(first);
  hook.setPrice(0.43);
  const next = hook.read();
  expect(next).not.toBe(first);
  expect(Number(next.lastPrice)).toBe(0.43);
  expect(hook.read()).toBe(next);
});

test('missing/pre-listing prices stay unavailable and ordinary pairs keep their store ticker', () => {
  const hook = session();
  expect(hook.read()).toBeNull();
  hook.setPrice(null);
  expect(hook.read()).toBeNull();
  expect(hook.read('BTC/USDT')).toBe(hook.btc);
  expect(hook.read('ETH/USDT')).toBeNull();
  hook.setPrice(0.42);
  expect(Number(hook.read().lastPrice)).toBe(0.42);
});
