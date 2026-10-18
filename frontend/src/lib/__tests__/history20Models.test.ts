/**
 * History20 model contracts in the existing Futures terminal: which pairs are
 * models, where their chart and mark come from, and that no venue read is
 * made for them. Synthetic responses only.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
function load(file: string, imports: Record<string, unknown> = {}) {
  const output: any = {};
  const source = readFileSync(resolve(frontend, 'src', file), 'utf8').replace(/import\.meta\.env\.VITE_API_URL/g, 'undefined');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', code)((name: string) => (name in imports ? imports[name] : req(name)), output);
  return output;
}
/** A visible read that runs once, synchronously started, and can be stopped. */
const reads: { stopped: boolean }[] = [];
const visibleRead = { createVisibleRead: (read: (s: AbortSignal) => Promise<void>) => { const r = { stopped: false }; reads.push(r); void read(new AbortController().signal); return { stop: () => { r.stopped = true; } }; } };
const adapter = { pairToNativeSymbol: (pair: string) => pair.replace(/[^A-Z0-9]/gi, '').toUpperCase() };
const MODEL = { symbol: 'VHXTSIMUSDT', pair: 'VHXTSIM/USDT', source: 'VOLTEX_HISTORY20_MODEL', rights: 'HISTORICAL_RIGHTS_UNVERIFIED', scenarioId: 'VHX-03-SOL',
  intrabar: 'SEEDED_BRIDGE_OHLC_V2', listingAt: 1, draftRevision: 3, logsSha256: 'a'.repeat(64), mark: { symbol: 'VHXTSIMUSDT', markPrice: '2.84536985', lastPrice: '2.84536985', markProviderTimestamp: 1 } };

function modules() {
  const models = jest.fn(async () => ({ models: [MODEL] }));
  const candles = jest.fn();
  const getFuturesMarkPrice = jest.fn(async () => ({ markPrice: '60000', indexPrice: '59990' }));
  // The shared mark hook keeps its two dependencies; the model module registers its own source with it.
  const mark = load('lib/useFuturesMark.ts', { './api': { api: { getFuturesMarkPrice } }, './visibleRead': visibleRead });
  const history20 = load('lib/history20Models.ts', {
    './nativeDemoApi': { nativeDemoApi: { models } }, './privateTradingApi': { privateTradingApi: { candles } },
    './nativeFuturesAdapter': adapter, './visibleRead': visibleRead, './useFuturesMark': mark,
  });
  return { history20, mark, models, candles, getFuturesMarkPrice };
}
const flush = () => new Promise(r => setImmediate(r));

describe('History20 model contracts in the Futures terminal', () => {
  test('a model pair is recognised by its server-given suffix in every spelling; venue pairs are not', () => {
    const { history20 } = modules();
    for (const pair of ['VHXTSIM/USDT', 'VHXTSIMUSDT', 'VHXTSIM-USDT']) expect(history20.isHistory20Pair(pair)).toBe(true);
    for (const pair of ['BTC/USDT', 'SIM/USDT', 'SIMUSDTX/USDT', 'ETHUSDT']) expect(history20.isHistory20Pair(pair)).toBe(false);
  });

  test('the chart loader asks the private route for the model source and refuses any page under another label', async () => {
    const { history20, candles } = modules();
    const page = { source: 'VOLTEX_HISTORY20_MODEL', symbol: 'VHXTSIMUSDT', interval: '1h', candles: [{ time: 1, open: 2, high: 3, low: 1, close: 2.5, volume: 9 }] };
    candles.mockResolvedValueOnce(page);
    await expect(history20.history20CandleLoader('VHXTSIM/USDT', '1h', 500, undefined, 1_700_000_000_000)).resolves.toEqual({ candles: page.candles });
    expect(candles).toHaveBeenCalledWith('VHXTSIM/USDT', '1h', 500, undefined, 1_700_000_000_000, 'VOLTEX_HISTORY20_MODEL');
    for (const wrong of [{ ...page, source: 'BYBIT_LINEAR' }, { ...page, symbol: 'BTCUSDT' }, { ...page, interval: '5m' }]) {
      candles.mockResolvedValueOnce(wrong);
      await expect(history20.history20CandleLoader('VHXTSIM/USDT', '1h', 500)).rejects.toThrow('history20_chart_mismatch');
    }
  });

  test('one shared read of the served models; the last subscriber stops it; a failed read is an empty, loaded list', async () => {
    const { history20, models } = modules();
    const a = jest.fn(), b = jest.fn();
    const stopA = history20.subscribeHistory20Models(a, models), stopB = history20.subscribeHistory20Models(b, models);
    await flush();
    expect(models).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenLastCalledWith({ loaded: true, models: [MODEL] });
    stopA(); expect(reads.at(-1)!.stopped).toBe(false);
    stopB(); expect(reads.at(-1)!.stopped).toBe(true);
    const failing = jest.fn(async () => { throw new Error('403'); }), c = jest.fn();
    const stopC = history20.subscribeHistory20Models(c, failing);
    await flush();
    expect(c).toHaveBeenLastCalledWith({ loaded: true, models: [] });
    stopC();
    expect(history20.history20MarkOf([MODEL], 'VHXTSIM/USDT')).toBe(2.84536985);
    expect(history20.history20MarkOf([{ ...MODEL, mark: null }], 'VHXTSIM/USDT')).toBeNull();
    expect(history20.history20MarkOf([MODEL], 'BTC/USDT')).toBeNull();
  });

  test('the shared mark of a model pair is its model price with no index, and the venue mark route is never asked; venue pairs are unchanged', async () => {
    const { mark, models, getFuturesMarkPrice } = modules();
    const seen = jest.fn();
    const stop = mark.subscribeFuturesMark('VHXTSIM/USDT', seen);
    await flush();
    expect(seen).toHaveBeenLastCalledWith({ markPrice: 2.84536985, indexPrice: null });
    expect(models).toHaveBeenCalledTimes(1);
    expect(getFuturesMarkPrice).not.toHaveBeenCalled();
    stop();
    const venue = jest.fn(), stopVenue = mark.subscribeFuturesMark('BTC/USDT', venue);
    await flush();
    expect(getFuturesMarkPrice).toHaveBeenCalledWith('BTC/USDT');
    expect(venue).toHaveBeenLastCalledWith({ markPrice: 60000, indexPrice: 59990 });
    stopVenue();
  });
});
