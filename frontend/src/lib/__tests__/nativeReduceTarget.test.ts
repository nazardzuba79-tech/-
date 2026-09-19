import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import { nativeOrderDraft, resolveNativeReduceTarget } from '../nativeReduceTarget';
import { PrivateTradingError } from '../privateTradingError';
import type { NativeCandle, NativePosition } from '../nativeDemoApi';

// Deterministic test positions only, never production balances or quotes.
function position(id: string, marginMode: 'CROSS' | 'ISOLATED', quantity = '1'): NativePosition {
  return {
    id, symbol: 'BTCUSDT', side: 'LONG', quantity, entryPrice: '50000', markPrice: '50000', lastPrice: '50000', leverage: '10',
    status: 'OPEN', openedAt: 1, closedAt: null, historical: false, unrealizedPnl: '0', realizedPnl: '0', netPnl: '0', roiPercent: '0',
    roiBasis: '5000', closedRoiBasis: '0', fundingNet: '0',
    protection: { takeProfit: null, stopLoss: null, quantity: null, triggerBy: 'MARK' },
    liquidationPrice: null, liquidationStatus: 'TEST_FIXTURE', marginMode, isolatedMargin: marginMode === 'ISOLATED' ? '5000' : '0',
  };
}
const params = (marginType: 'CROSS' | 'ISOLATED', quantity = '1') => ({
  symbol: 'BTC/USDT', side: 'SELL' as const, type: 'LIMIT' as const,
  quantity, price: '50123.4', leverage: 10, marginType, reduceOnly: true,
});
const candle: NativeCandle = { source: 'BYBIT_LINEAR', interval: '1m', openTime: 60_000, pricePoint: 'CLOSE' };

describe('strict native reduce-only target', () => {
  test.each(['CROSS', 'ISOLATED'] as const)('a sole position in the OTHER bucket is refused for %s', mode => {
    const other = mode === 'CROSS' ? 'ISOLATED' : 'CROSS';
    expect(resolveNativeReduceTarget([position('other', other)], params(mode), null)).toBeUndefined();
  });
  test('same symbol/side/size in different buckets uses only the selected bucket', () => {
    const cross = position('cross', 'CROSS'), isolated = position('isolated', 'ISOLATED');
    expect(resolveNativeReduceTarget([cross, isolated], params('CROSS'), null)).toBe(cross);
    expect(resolveNativeReduceTarget([isolated, cross], params('ISOLATED'), null)).toBe(isolated);
  });
  test('explicit id selects its own bucket even if the form default is old', () => {
    const cross = position('cross', 'CROSS'), isolated = position('isolated', 'ISOLATED');
    expect(resolveNativeReduceTarget([cross, isolated], params('CROSS'), 'isolated')).toBe(isolated);
  });
  test.each(['missing', ''])('explicit invalid id %p never falls back', id => {
    expect(resolveNativeReduceTarget([position('valid', 'CROSS')], params('CROSS'), id)).toBeUndefined();
  });
  test.each(['CLOSED', 'LIQUIDATED'] as const)('%s target never falls back to an open neighbour', status => {
    const gone = { ...position('gone', 'CROSS'), status };
    expect(resolveNativeReduceTarget([gone, position('neighbour', 'CROSS')], params('CROSS'), gone.id)).toBeUndefined();
  });
  test('wrong symbol and side cannot be selected even by explicit id', () => {
    const eth = { ...position('eth', 'CROSS'), symbol: 'ETHUSDT' };
    const short = { ...position('short', 'CROSS'), side: 'SHORT' as const };
    expect(resolveNativeReduceTarget([eth, short], params('CROSS'), 'eth')).toBeUndefined();
    expect(resolveNativeReduceTarget([eth, short], params('CROSS'), 'short')).toBeUndefined();
  });
  test('two candidates in one bucket remain ambiguous even with an exact full-size match', () => {
    const a = position('a', 'CROSS', '1'), b = position('b', 'CROSS', '7');
    expect(resolveNativeReduceTarget([a, b], params('CROSS', '7'), null)).toBeUndefined();
    expect(resolveNativeReduceTarget([b, a], params('CROSS', '1'), null)).toBeUndefined();
  });
  test('empty selected bucket cannot fall back by matching quantity in another bucket', () => {
    const a = position('a', 'ISOLATED', '1'), b = position('b', 'ISOLATED', '7');
    expect(resolveNativeReduceTarget([a, b], params('CROSS', '7'), null)).toBeUndefined();
  });
  test('BUY resolves only a SHORT in the selected bucket', () => {
    const short = { ...position('short', 'ISOLATED'), side: 'SHORT' as const };
    expect(resolveNativeReduceTarget([position('long', 'ISOLATED'), short], { ...params('ISOLATED'), side: 'BUY' }, null)).toBe(short);
  });
});

describe('actual native command construction', () => {
  const cross = position('cross', 'CROSS'), isolated = position('isolated', 'ISOLATED');
  test('table LIMIT id wins over stale chart exit/candle and preserves typed price and quantity', () => {
    expect(nativeOrderDraft([cross, isolated], { ...params('CROSS', '0.500'), positionId: isolated.id }, cross.id, candle)).toEqual({
      kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'LIMIT', price: '50123.4', quantity: '0.500',
      leverage: '10', marginType: 'ISOLATED', reduceOnly: true, positionId: isolated.id,
    });
  });
  test('switching a named table ticket to MARKET still closes the same live target', () => {
    expect(nativeOrderDraft([cross, isolated], { ...params('CROSS'), type: 'MARKET', positionId: isolated.id }, cross.id, candle)).toEqual({
      kind: 'CLOSE', positionId: isolated.id, quantity: '1',
    });
  });
  test('an unavailable table id is never replaced by a valid chart id', () => {
    expect(() => nativeOrderDraft([cross], { ...params('CROSS'), positionId: 'gone' }, cross.id, candle)).toThrow(PrivateTradingError);
  });
  test('a named table target without reduce-only is refused, not turned into a new position', () => {
    expect(() => nativeOrderDraft([cross], { ...params('CROSS'), reduceOnly: false, positionId: cross.id }, null, null)).toThrow(PrivateTradingError);
  });
  test('a deliberate chart-only close keeps its historical candle and id', () => {
    expect(nativeOrderDraft([cross, isolated], { ...params('CROSS'), type: 'MARKET' }, isolated.id, candle)).toEqual({
      kind: 'CLOSE', positionId: isolated.id, quantity: '1', candle,
    });
  });
  test('ordinary native OPEN keeps its original payload', () => {
    expect(nativeOrderDraft([], { ...params('CROSS', '0.01'), reduceOnly: false }, null, null)).toEqual({
      kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'LIMIT', price: '50123.4', quantity: '0.01', leverage: '10', marginType: 'CROSS',
    });
  });
  test('no-id ambiguous order is refused before any native command can be sent', () => {
    expect(() => nativeOrderDraft([cross, { ...cross, id: 'other', quantity: '2' }], params('CROSS', '2'), null, null)).toThrow(PrivateTradingError);
  });
});

// Evaluate the actual hook with only its render dependencies stubbed. The
// production command builder above remains real. This avoids importing
// Vite's import.meta client and tests stale-render/current-ref behaviour.
function executionHook() {
  const text = readFileSync(resolve(__dirname, '../useNativeFuturesExecution.ts'), 'utf8');
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  new Function('exports', 'require', code)(exports, (id: string) => {
    if (id === 'react') return { useMemo: (factory: () => unknown) => factory() };
    if (id === './futuresExecution') return { REAL_FUTURES_EXECUTION: { engine: 'REAL' } };
    if (id === './nativeFuturesAdapter') return { nativeAccountState: () => null };
    if (id === './nativeReduceTarget') return { nativeOrderDraft };
    if (id === './privateTradingError') return { PrivateTradingError };
    throw new Error(`Unexpected runtime import: ${id}`);
  });
  return exports.useNativeFuturesExecution;
}
function controller(rendered: NativePosition[], current: NativePosition[]) {
  return {
    binding: 'owner', allowed: true, checked: true, stateLoaded: true,
    state: { initialized: true, positions: rendered, asOf: 1, account: null },
    getState: () => ({ initialized: true, positions: current }), getError: () => '',
    candle: null, exitId: null, run: jest.fn(async () => true), error: '',
    // The hook sends through `execute`, which answers with the server state or
    // rethrows the server's structured refusal; `run` is its boolean wrapper.
    execute: jest.fn(async () => ({ initialized: true, positions: current })),
    busy: false, initialize: jest.fn(), showCard: jest.fn(),
  };
}

describe('execution resolves against current state, not a stale render', () => {
  test('a removed explicit target refuses even while the rendered state still contains it', async () => {
    const p = position('target', 'ISOLATED'), neighbour = position('neighbour', 'CROSS');
    const native = controller([neighbour, p], [neighbour]);
    await expect(executionHook()(native, null).placeOrder({ ...params('ISOLATED'), positionId: p.id })).rejects.toThrow(PrivateTradingError);
    expect(native.execute).not.toHaveBeenCalled();
  });
  test('the newest target and its margin mode are used before the next render', async () => {
    const p = position('target', 'ISOLATED');
    const native = controller([], [p]);
    await executionHook()(native, null).placeOrder({ ...params('CROSS'), positionId: p.id });
    expect(native.execute).toHaveBeenCalledWith(expect.objectContaining({ positionId: p.id, marginType: 'ISOLATED', reduceOnly: true }));
  });
  test('warm display-only state cannot authorize a close', async () => {
    const p = position('target', 'ISOLATED'), native = { ...controller([p], [p]), stateLoaded: false };
    const execution = executionHook()(native, null);
    expect(execution.ready).toBe(false);
    await expect(execution.placeOrder({ ...params('ISOLATED'), positionId: p.id })).rejects.toThrow();
    expect(native.execute).not.toHaveBeenCalled();
  });
});
