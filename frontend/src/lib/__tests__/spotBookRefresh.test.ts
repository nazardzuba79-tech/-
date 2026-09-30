import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import { isBrowserInactive } from '../browserActivity';

// Execute the real parent callback in isolation, not a second implementation
// of its race guards. No network, production API or financial payload mock.
const source = readFileSync(resolve(__dirname, '../../pages/TradePage.tsx'), 'utf8');
const parsed = ts.createSourceFile('TradePage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'refreshBook') {
    declaration = `const ${node.getText(parsed)};`;
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
if (!declaration) throw new Error('The actual TradePage refreshBook callback was not found');
const compiled = ts.transpileModule(declaration, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;

function deferred() {
  let resolve!: (book: { bids: unknown[]; asks: unknown[] }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ bids: unknown[]; asks: unknown[] }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const requests: ReturnType<typeof deferred>[] = [];
  const api = { getExternalOrderBook: jest.fn(() => {
    const request = deferred(); requests.push(request); return request.promise;
  }) };
  const refs = { bookPairRef: { current: 'BTC/USDT' }, bookGenerationRef: { current: 1 },
    bookRequestRef: { current: 0 }, bookWsVersionRef: { current: 0 },
    bookPendingRef: { current: null as null | { generation: number; request: number } } };
  const setBook = jest.fn(), setBookFeed = jest.fn();
  const callback = (pair = refs.bookPairRef.current) => new Function('useCallback', 'api', 'setBook', 'setBookFeed', 'pair', 'marketType', 'isTestMarketPair', 'isBrowserInactive', 'readSpotPublicBook', ...Object.keys(refs),
    `${compiled}; return refreshBook;`)((fn: unknown) => fn, api, setBook, setBookFeed, pair, 'spot', () => false, isBrowserInactive, api.getExternalOrderBook, ...Object.values(refs)) as () => void;
  return { requests, api, refs, setBook, setBookFeed, callback };
}
const settle = async () => { for (let tick = 0; tick < 5; tick++) await Promise.resolve(); };
const book = { bids: [], asks: [] };
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('ticker state resets with the selected pair instead of briefly showing the old instrument price', () => {
  expect(source).toContain('<TickerBar key={pair} pair={pair}');
});

test('the actual lifecycle guard suppresses hidden reads without clearing the last book', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const documentState = { hidden: true };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentState });
  try {
    const ctx = setup(), refresh = ctx.callback();
    refresh();
    expect(ctx.api.getExternalOrderBook).not.toHaveBeenCalled();
    expect(ctx.setBook).not.toHaveBeenCalled();
    documentState.hidden = false;
    refresh();
    expect(ctx.api.getExternalOrderBook).toHaveBeenCalledTimes(1);
    ctx.requests[0].resolve(book); await settle();
    expect(ctx.setBook).toHaveBeenCalledWith({ pair: 'BTC/USDT', ...book, asOf: undefined });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('slow REST remains single-flight and can complete across repeated polling ticks', async () => {
  const ctx = setup(), refresh = ctx.callback();
  refresh(); refresh(); refresh(); refresh();
  expect(ctx.api.getExternalOrderBook).toHaveBeenCalledTimes(1);
  ctx.requests[0].resolve(book); await settle();
  expect(ctx.setBook).toHaveBeenCalledWith({ pair: 'BTC/USDT', ...book, asOf: undefined });
  expect(ctx.refs.bookPendingRef.current).toBeNull();
  refresh(); expect(ctx.api.getExternalOrderBook).toHaveBeenCalledTimes(2);
});

test('new pair starts immediately; an old promise cannot unlock or overwrite its request', async () => {
  const ctx = setup(), oldRefresh = ctx.callback();
  oldRefresh();
  ctx.refs.bookPairRef.current = 'ETH/USDT'; ctx.refs.bookGenerationRef.current++;
  const refresh = ctx.callback(); refresh();
  const pending = ctx.refs.bookPendingRef.current;
  expect(ctx.api.getExternalOrderBook).toHaveBeenCalledTimes(2);
  ctx.requests[0].resolve(book); await settle();
  expect(ctx.setBook).not.toHaveBeenCalled();
  expect(ctx.refs.bookPendingRef.current).toBe(pending);
  refresh(); oldRefresh(); expect(ctx.api.getExternalOrderBook).toHaveBeenCalledTimes(2);
  ctx.requests[1].resolve(book); await settle();
  expect(ctx.setBook).toHaveBeenCalledTimes(1);
});

test('BTC → ETH → BTC cannot accept the previous BTC generation', async () => {
  const ctx = setup(); ctx.callback()();
  ctx.refs.bookPairRef.current = 'ETH/USDT'; ctx.refs.bookGenerationRef.current++;
  ctx.callback()();
  ctx.refs.bookPairRef.current = 'BTC/USDT'; ctx.refs.bookGenerationRef.current++;
  ctx.callback()();
  ctx.requests[0].resolve(book); ctx.requests[1].resolve(book); await settle();
  expect(ctx.setBook).not.toHaveBeenCalled();
  ctx.requests[2].resolve(book); await settle();
  expect(ctx.setBook).toHaveBeenCalledTimes(1);
});

test('newer WS data wins over delayed REST and the next fallback can still start', async () => {
  const ctx = setup(), refresh = ctx.callback(); refresh();
  ctx.refs.bookWsVersionRef.current++;
  ctx.requests[0].resolve(book); await settle();
  expect(ctx.setBook).not.toHaveBeenCalled();
  refresh(); expect(ctx.api.getExternalOrderBook).toHaveBeenCalledTimes(2);
  ctx.requests[1].resolve(book); await settle();
  expect(ctx.setBook).toHaveBeenCalledTimes(1);
});

test('failed REST releases its own lock without inventing data; unmount generation remains guarded', async () => {
  const ctx = setup(), refresh = ctx.callback(); refresh();
  ctx.requests[0].reject(new Error('test-only unavailable feed')); await settle();
  expect(ctx.setBook).not.toHaveBeenCalled(); expect(ctx.refs.bookPendingRef.current).toBeNull();
  expect(ctx.setBookFeed).toHaveBeenCalledWith({ pair: 'BTC/USDT', healthy: false });
  refresh(); ctx.refs.bookGenerationRef.current++;
  ctx.requests[1].resolve(book); await settle();
  expect(ctx.setBook).not.toHaveBeenCalled();
});
