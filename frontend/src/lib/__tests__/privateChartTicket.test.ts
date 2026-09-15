import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
function load(file: string, imports: Record<string, unknown> = {}, expose?: string) {
  const output: any = {};
  const source = readFileSync(resolve(frontend, 'src', file), 'utf8').replace('import.meta.env.VITE_API_URL', 'undefined');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', compiled + (expose ? `\nexports.${expose} = ${expose};` : ''))((name: string) => name in imports ? imports[name] : name.endsWith('.css') ? {} : req(name), output);
  return output;
}
const actualApi = load('lib/privateTradingApi.ts', { './api': { getToken: () => null }, './privateTradingError': load('lib/privateTradingError.ts') });
const { privateChartOverlays } = load('lib/privateChartPresentation.ts', { './privateTradingApi': actualApi });
const { refreshPrivateScenario } = load('lib/usePrivateScenarioRefresh.ts', { './privateTradingApi': actualApi });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T = any>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function nodes(node: any): any[] { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function text(node: any): string { return node === null || node === undefined || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children); }
function find(tree: any, predicate: (node: any) => boolean) { const result = nodes(tree).find(predicate); if (!result) throw new Error(`Rendered control not found; ${text(tree)}`); return result; }
function button(tree: any, label: string) { return find(tree, node => node.type === 'button' && text(node) === label); }
function input(tree: any, label: string) { return find(tree, node => node.type === 'input' && node.props['aria-label'] === label); }

const candle = { symbol: 'BTCUSDT', source: 'BYBIT_LINEAR', interval: '1h', openTime: Date.UTC(2026, 8, 1, 12), closeTime: Date.UTC(2026, 8, 1, 13), open: 100, high: 115, low: 98, close: 110, x: 720, y: 420 };
const position = { id: 'saved-position', symbol: 'BTCUSDT', mode: 'HISTORICAL_REPLAY', side: 'LONG', leverage: '10', status: 'OPEN', verification: 'VERIFIED', quantity: '8.9', initialQuantity: '9', entryPrice: '110', markPrice: '220', netPnl: '978.40', unrealizedPnl: '990', effectiveOpenedAt: '2026-09-01T13:00:00.000Z', asOf: '2026-09-14T11:59:00Z', candleEntry: { source: 'BYBIT_LINEAR', interval: '1h', openTime: candle.openTime, pricePoint: 'CLOSE' }, fills: [] };
function preview(id = 'job-1', status = 'READY', extra: any = {}) { return { id, status, progress: status === 'READY' ? 100 : 20, expiresAt: new Date(Date.now() + 60000).toISOString(), result: { position, cost: { initialMargin: '100', required: '101.60', fee: '0.60', closeFeeReserve: '1' }, capital: { total: '1000', usedMargin: '100', free: '898.40' } }, ...extra }; }

/** Same hook-driven rendered component harness as the existing private frontend suite.
 * Only the network and browser host are replaced; all handlers, effects and rendered controls are real. */
function mountTicket(overrides: any = {}, clientOverrides: any = {}) {
  let cursor = 0;
  const hooks: any[] = [], effects: (() => void)[] = [];
  const onSaved = jest.fn(), onDismiss = jest.fn(), onDenied = jest.fn();
  const client = { preview: jest.fn().mockResolvedValue(preview()), getPreview: jest.fn().mockResolvedValue(preview()), cancelPreview: jest.fn().mockResolvedValue({}), confirm: jest.fn().mockResolvedValue({}), closeOnChart: jest.fn().mockResolvedValue(preview('close-job')), ...clientOverrides };
  let props = { candle, wallet: { available: '1000', allocatedCapital: '1000', reserved: '0' }, market: { instrument: { minLeverage: '1', maxLeverage: '50', leverageStep: '1' } }, onSaved, onDismiss, onDenied, ...overrides };
  const react = { ...React,
    useState(initial: any) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], (next: any) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; },
    useRef(initial: any) { const index = cursor++; return hooks[index] ?? (hooks[index] = { current: initial }); },
    useEffect(fn: () => any, deps?: any[]) { const index = cursor++, previous = hooks[index]; if (!previous || !deps || deps.some((value, n) => !Object.is(value, previous.deps[n]))) { hooks[index] = { deps }; effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = fn(); }); } },
    useCallback: (fn: any) => fn,
  };
  const icons = new Proxy({}, { get: (_target, key) => () => React.createElement('i', { 'data-icon': String(key) }) });
  const { PrivateChartTicket } = load('pages/private-trading/PrivateChartTicket.tsx', { react, 'lucide-react': icons, '../../lib/privateTradingApi': { ...actualApi, privateTradingApi: client } });
  const render = (updates = {}) => { props = { ...props, ...updates }; cursor = 0; const tree = PrivateChartTicket(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const unmount = () => hooks.forEach(hook => hook?.cleanup?.());
  return { render, unmount, client, onSaved, onDismiss, onDenied };
}

/** Exercise the real workspace's chart/table/sidebar callbacks, with data and child widgets isolated. */
function mountWorkspace(clientOverrides: any = {}) {
  let cursor = 0;
  const hooks: any[] = [], effects: (() => void)[] = [];
  const react = { ...React,
    useState(initial: any) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], (next: any) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; },
    useRef(initial: any) { const index = cursor++; return hooks[index] ?? (hooks[index] = { current: initial }); },
    useEffect(fn: () => any, deps?: any[]) { const index = cursor++, previous = hooks[index]; if (!previous || !deps || deps.some((value, n) => !Object.is(value, previous.deps[n]))) { hooks[index] = { deps }; effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = fn(); }); } },
    useCallback: (fn: any) => fn,
  };
  const ethPosition = { ...position, id: 'eth-position', symbol: 'ETHUSDT' };
  const state = { wallet: { available: '1000', allocatedCapital: '1000', reserved: '0' }, positions: [], history: [], scenarios: [position, ethPosition], previews: [], orders: [], copyHistory: [] };
  const client = { state: jest.fn().mockResolvedValue(state), market: jest.fn().mockResolvedValue(null), getPreview: jest.fn().mockResolvedValue(preview('eth-preview', 'READY', { result: { position: ethPosition } })), ...clientOverrides };
  const components: Record<string, any> = {};
  const child = (name: string) => ({ [name]: components[name] = () => null });
  const icons = new Proxy({}, { get: (_target, key) => () => React.createElement('i', { 'data-icon': String(key) }) });
  const imports = {
    react, 'lucide-react': icons, 'react-router-dom': { Link: () => null, useSearchParams: () => [new URLSearchParams()] },
    '../../lib/api': { api: { getFuturesUniverse: async () => [] }, onSessionChange: () => () => {} },
    '../../lib/futuresDiscovery': { discoverFuturesSymbols: (seed: any) => seed },
    '../../lib/privateTradingApi': { ...actualApi, privateTradingApi: client },
    '../../lib/usePrivateScenarioRefresh': { usePrivateScenarioRefresh: () => {} },
    '../../lib/privateChartPresentation': { privateChartOverlays },
    '../../components/Nav': child('Nav'), '../../components/FuturesPairList': child('FuturesPairList'),
    '../../components/TerminalChart': child('TerminalChart'), '../../components/FuturesReferenceBook': child('FuturesReferenceBook'),
    './PrivateOrderTicket': child('PrivateOrderTicket'), './PrivatePositions': { ...child('PrivatePositions'), ...child('PrivatePositionDialog') },
    './PrivateResultCardDialog': child('PrivateResultCardDialog'), './PrivateLinkedCard': child('PrivateLinkedCard'), './PrivateChartTicket': child('PrivateChartTicket'),
  };
  const { PrivateTradingWorkspace } = load('pages/private-trading/PrivateTradingPage.tsx', imports, 'PrivateTradingWorkspace');
  const render = () => { cursor = 0; const tree = PrivateTradingWorkspace({ onDenied: jest.fn() }); effects.splice(0).forEach(effect => effect()); return tree; };
  return { render, client, components, unmount: () => hooks.forEach(hook => hook?.cleanup?.()) };
}

const globals: Record<string, any> = {};
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-14T12:00:00Z'));
  globals.window = (globalThis as any).window;
  globals.document = (globalThis as any).document;
  const target = new EventTarget();
  (globalThis as any).window = { innerWidth: 1440, innerHeight: 900, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), setTimeout: (...args: any[]) => (setTimeout as any)(...args), clearTimeout: (id: any) => clearTimeout(id), setInterval: (...args: any[]) => (setInterval as any)(...args) };
  (globalThis as any).document = { hidden: false, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) };
});
afterEach(() => { jest.useRealTimers(); for (const key of ['window', 'document']) { if (globals[key] === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = globals[key]; } });

describe('rendered private candle ticket', () => {
  test('automatically derives source/time/Close and keeps selected values without manual datetime or price input', async () => {
    const ui = mountTicket(); let tree = ui.render(); ui.render();
    expect(nodes(tree).some(node => node.type === 'input' && node.props.type === 'datetime-local')).toBe(false);
    expect(text(tree)).toContain('110.000000'); expect(text(tree)).toContain('2026-09-01 13:00:00 UTC');
    expect(nodes(tree).find(node => node.type === 'details').props.open).toBeUndefined();
    expect(ui.client.preview).not.toHaveBeenCalled(); jest.advanceTimersByTime(649); await tick(); expect(ui.client.preview).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1); await tick(); tree = ui.render();
    expect(ui.client.preview).toHaveBeenCalledTimes(1);
    expect(ui.client.preview).toHaveBeenCalledWith(expect.objectContaining({ mode: 'HISTORICAL_REPLAY', type: 'MARKET', symbol: 'BTCUSDT', side: 'LONG', leverage: '10', margin: '100', capital: '1000', candleEntry: { source: 'BYBIT_LINEAR', interval: '1h', openTime: candle.openTime, pricePoint: 'CLOSE' } }));
    const request = ui.client.preview.mock.calls[0][0];
    expect(request).not.toHaveProperty('manualEntryPrice'); expect(request).not.toHaveProperty('effectiveOpenedAt'); expect(request).not.toHaveProperty('quantity');
    expect(text(tree)).toContain('898.40 USDT'); expect(text(tree)).toContain('978.40'); expect(ui.client.confirm).not.toHaveBeenCalled(); ui.unmount();
  });

  test('debounces direction/margin/leverage/point changes; capital and calculation cutoff stay fixed', async () => {
    const ui = mountTicket(); ui.render(); let tree = ui.render();
    button(tree, 'Short').props.onClick(); input(tree, 'Маржа сделки, USDT').props.onChange({ target: { value: '75.125' } });
    input(tree, 'Плечо сделки').props.onChange({ target: { value: '3' } });
    find(tree, node => node.type === 'select').props.onChange({ target: { value: 'OPEN' } }); ui.render();
    jest.advanceTimersByTime(650); await tick(); tree = ui.render();
    expect(ui.client.preview).toHaveBeenCalledTimes(1); const first = ui.client.preview.mock.calls[0][0];
    expect(first).toMatchObject({ side: 'SHORT', leverage: '3', margin: '75.125', capital: '1000', candleEntry: { pricePoint: 'OPEN', openTime: candle.openTime } });
    input(tree, 'Маржа сделки, USDT').props.onChange({ target: { value: '80' } }); ui.render({ wallet: { available: '800' } });
    expect(ui.client.cancelPreview).toHaveBeenCalledWith('job-1');
    jest.advanceTimersByTime(650); await tick(); ui.render(); const second = ui.client.preview.mock.calls[1][0];
    expect(second.asOf).toBe(first.asOf); expect(second.capital).toBe('1000'); expect(second.idempotencyKey).not.toBe(first.idempotencyKey); ui.unmount();
  });

  test('a late creation response after parameter change is cancelled and cannot replace the newer preview', async () => {
    const late = deferred(); const create = jest.fn().mockReturnValueOnce(late.promise).mockResolvedValueOnce(preview('new-job'));
    const ui = mountTicket({}, { preview: create }); ui.render(); jest.advanceTimersByTime(650); await tick();
    input(ui.render(), 'Плечо сделки').props.onChange({ target: { value: '5' } }); ui.render();
    jest.advanceTimersByTime(650); await tick(); ui.render();
    late.resolve(preview('old-late-job')); await tick(); let tree = ui.render();
    expect(ui.client.cancelPreview).toHaveBeenCalledWith('old-late-job'); button(tree, 'Открыть').props.onClick(); await tick();
    expect(ui.client.confirm).toHaveBeenCalledWith('new-job', expect.any(String)); expect(ui.client.confirm).not.toHaveBeenCalledWith('old-late-job', expect.anything()); ui.unmount();
  });

  test('unmount cancels an in-flight creation once its ID arrives and never updates or confirms it', async () => {
    const late = deferred(); const ui = mountTicket({}, { preview: jest.fn().mockReturnValue(late.promise) });
    ui.render(); jest.advanceTimersByTime(650); await tick(); ui.unmount(); late.resolve(preview('late-unmounted')); await tick();
    expect(ui.client.cancelPreview).toHaveBeenCalledWith('late-unmounted'); expect(ui.client.confirm).not.toHaveBeenCalled(); expect(ui.onSaved).not.toHaveBeenCalled();
  });

  test('double confirmation issues one write and uncertain retry preserves its idempotency key', async () => {
    const confirmation = deferred(); const ui = mountTicket({}, { confirm: jest.fn().mockReturnValueOnce(confirmation.promise).mockResolvedValueOnce({}) });
    ui.render(); jest.advanceTimersByTime(650); await tick(); const tree = ui.render();
    button(tree, 'Открыть').props.onClick(); button(tree, 'Открыть').props.onClick();
    expect(ui.client.confirm).toHaveBeenCalledTimes(1); const key = ui.client.confirm.mock.calls[0][1];
    confirmation.reject(new Error('Connection lost')); await tick();
    button(ui.render(), 'Открыть').props.onClick(); await tick();
    expect(ui.client.confirm.mock.calls[1]).toEqual(['job-1', key]); expect(ui.onSaved).toHaveBeenCalledTimes(1); ui.unmount();
  });

  test('Close from chart uses the saved scenario and original OPEN model, never creates a new entry', async () => {
    const closed = { ...position, id: 'existing-scenario', side: 'SHORT', candleEntry: { ...position.candleEntry, pricePoint: 'OPEN' } };
    const ui = mountTicket({ exitPosition: closed }); ui.render(); jest.advanceTimersByTime(650); await tick(); const tree = ui.render();
    expect(ui.client.preview).not.toHaveBeenCalled();
    expect(ui.client.closeOnChart).toHaveBeenCalledWith('existing-scenario', { source: 'BYBIT_LINEAR', interval: '1h', openTime: candle.openTime, pricePoint: 'OPEN' }, expect.any(String));
    expect(nodes(tree).some(node => node.props?.['aria-label'] === 'Маржа сделки, USDT')).toBe(false);
    button(tree, 'Закрыть').props.onClick(); await tick(); expect(ui.client.confirm).toHaveBeenCalledWith('close-job', expect.any(String)); ui.unmount();
  });

  test.each(['INCOMPLETE', 'AMBIGUOUS', 'FAILED', 'EXPIRED'])('%s cannot confirm through visible or programmatic click', async status => {
    const ui = mountTicket({}, { preview: jest.fn().mockResolvedValue(preview('unverified', status)) }); ui.render(); jest.advanceTimersByTime(650); await tick();
    const tree = ui.render(), open = button(tree, 'Открыть'); expect(open.props.disabled).toBe(true); open.props.onClick(); await tick();
    expect(ui.client.confirm).not.toHaveBeenCalled(); expect(text(tree)).toContain('Расчёт не подтверждён'); ui.unmount();
  });

  test('no positive margin means no preview request, and READY server values remain the only displayed math', async () => {
    const ui = mountTicket(); ui.render(); input(ui.render(), 'Маржа сделки, USDT').props.onChange({ target: { value: '0' } }); ui.render();
    jest.advanceTimersByTime(1000); await tick(); expect(ui.client.preview).not.toHaveBeenCalled(); expect(button(ui.render(), 'Открыть').props.disabled).toBe(true); ui.unmount();
  });

  test('READY expiry disables confirmation and explicit recalculation replaces the expired preview', async () => {
    const create = jest.fn().mockResolvedValueOnce(preview('expiring', 'READY', { expiresAt: new Date(Date.now() + 1000).toISOString() })).mockResolvedValueOnce(preview('fresh'));
    const ui = mountTicket({}, { preview: create }); ui.render(); jest.advanceTimersByTime(650); await tick(); ui.render();
    jest.advanceTimersByTime(351); await tick(); let tree = ui.render();
    expect(button(tree, 'Открыть').props.disabled).toBe(true); button(tree, 'Пересчитать').props.onClick(); ui.render();
    jest.advanceTimersByTime(650); await tick(); tree = ui.render();
    expect(create).toHaveBeenCalledTimes(2); expect(button(tree, 'Открыть').props.disabled).toBe(false); expect(ui.client.confirm).not.toHaveBeenCalled(); ui.unmount();
  });
});

describe('private chart workspace contract changes', () => {
  test('showing a saved ETH entry dismisses a BTC candle ticket and focuses the selected contract', async () => {
    const ui = mountWorkspace(); ui.render(); await tick(); let tree = ui.render();
    find(tree, node => node.type === ui.components.TerminalChart).props.privateTrading.onCandleSelect(candle); tree = ui.render();
    expect(nodes(tree).some(node => node.type === ui.components.PrivateChartTicket)).toBe(true);
    find(tree, node => node.type === ui.components.PrivatePositions).props.onShowEntry('eth-position'); tree = ui.render();
    expect(nodes(tree).some(node => node.type === ui.components.PrivateChartTicket)).toBe(false);
    expect(find(tree, node => node.type === ui.components.TerminalChart).props).toMatchObject({ pair: 'ETH/USDT', privateTrading: { selecting: null, selectedCandle: null, selectedTradeId: 'eth-position', focus: { tradeId: 'eth-position' } } });
    ui.unmount();
  });
  test('resuming another contract clears an armed existing-position close and its selected candle', async () => {
    const ui = mountWorkspace(); ui.render(); await tick(); let tree = ui.render();
    find(tree, node => node.type === ui.components.PrivatePositions).props.onCloseOnChart(position.id); tree = ui.render();
    find(tree, node => node.type === ui.components.TerminalChart).props.privateTrading.onCandleSelect(candle); tree = ui.render();
    expect(find(tree, node => node.type === ui.components.PrivateChartTicket).props.exitPosition.id).toBe(position.id);
    find(tree, node => node.type === ui.components.PrivateOrderTicket).props.onResume('eth-preview'); await tick(); tree = ui.render();
    expect(nodes(tree).some(node => node.type === ui.components.PrivateChartTicket)).toBe(false);
    expect(find(tree, node => node.type === ui.components.TerminalChart).props).toMatchObject({ pair: 'ETH/USDT', privateTrading: { selecting: null, selectedCandle: null } });
    expect(find(tree, node => node.type === ui.components.PrivateOrderTicket).props.preview.id).toBe('eth-preview');
    ui.unmount();
  });
  test('an old-contract candle callback after pair switching cannot mount a ticket on the new chart', async () => {
    const ui = mountWorkspace(); ui.render(); await tick(); let tree = ui.render();
    const oldSelect = find(tree, node => node.type === ui.components.TerminalChart).props.privateTrading.onCandleSelect;
    find(tree, node => node.type === ui.components.FuturesPairList).props.onChange('ETH/USDT'); tree = ui.render();
    oldSelect(candle); tree = ui.render();
    expect(find(tree, node => node.type === ui.components.TerminalChart).props.pair).toBe('ETH/USDT');
    expect(nodes(tree).some(node => node.type === ui.components.PrivateChartTicket)).toBe(false);
    ui.unmount();
  });
  test('ordinary pair selection is not blocked by an in-flight account/market poll', async () => {
    const initialRead = deferred(); const state = jest.fn().mockReturnValueOnce(initialRead.promise).mockResolvedValue({ positions: [], history: [], scenarios: [], wallet: {}, previews: [] });
    const ui = mountWorkspace({ state }); let tree = ui.render();
    find(tree, node => node.type === ui.components.FuturesPairList).props.onChange('ETH/USDT'); tree = ui.render();
    expect(find(tree, node => node.type === ui.components.TerminalChart).props.pair).toBe('ETH/USDT');
    expect(ui.client.market).toHaveBeenLastCalledWith('ETH/USDT', expect.any(AbortSignal));
    initialRead.resolve({}); await tick(); ui.unmount();
  });
});

describe('private saved-value overlay adapter', () => {
  test('exact contract, verification and unavailable/null values are filtered instead of fabricated', () => {
    const rows = [position, { ...position, id: 'eth', symbol: 'ETHUSDT' }, { ...position, id: 'incomplete', verification: 'INCOMPLETE' }, { ...position, id: 'ambiguous', verification: 'AMBIGUOUS' }, { ...position, id: 'unavailable', dataStatus: 'UNAVAILABLE' }, { ...position, id: 'null', netPnl: null }, { ...position, id: 'zero', entryPrice: '0' }];
    const result = privateChartOverlays(rows, 'BTC/USDT'); expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ id: position.id, symbol: 'BTCUSDT', quantity: 8.9, pnl: 978.40, entryTime: Date.parse(position.effectiveOpenedAt), entryModel: 'CLOSE', entryCandleOpenTime: candle.openTime });
  });
  test('live open overlays use unrealized values; closed overlays retain original size and fixed net result', () => {
    const live = { ...position, mode: 'DEMO_LIVE', netPnl: '20', unrealizedPnl: '25', verification: undefined };
    expect(privateChartOverlays([live], 'BTCUSDT')[0].pnl).toBe(25);
    expect(privateChartOverlays([{ ...live, status: 'CLOSED', quantity: '0' }], 'BTCUSDT')[0]).toMatchObject({ quantity: 9, pnl: 20 });
  });
  test('Close exit anchors immediately before its close boundary; opening fill is not repeated as an exit', () => {
    const end = candle.closeTime + 3600000;
    const row = { ...position, candleClose: { source: 'BYBIT_LINEAR', interval: '1h', openTime: candle.closeTime, pricePoint: 'CLOSE', effectiveAt: end }, fills: [{ effectiveAt: candle.closeTime, kind: 'OPEN', quantity: '9', price: '110' }, { effectiveAt: end, kind: 'CLOSE', quantity: '9', price: '220' }] };
    expect(privateChartOverlays([row], 'BTCUSDT')[0].exits).toEqual([{ time: end - 1, price: 220, quantity: 9, kind: 'CLOSE' }]);
    expect(privateChartOverlays([{ ...row, candleClose: { ...row.candleClose, pricePoint: 'OPEN' } }], 'BTCUSDT')[0].exits[0].time).toBe(end);
  });
  test('a later candle-Close exit never shifts earlier partial-close or risk fills off their actual opening bar', () => {
    const partial = candle.closeTime + 3600000, end = partial + 3600000;
    const fills = [{ effectiveAt: partial, kind: 'CLOSE', quantity: '2', price: '130' }, { effectiveAt: partial, kind: 'TAKE_PROFIT', quantity: '1', price: '135' }, { effectiveAt: end, kind: 'CLOSE', quantity: '6', price: '140' }];
    const row = { ...position, candleClose: { source: 'BYBIT_LINEAR', interval: '1h', openTime: partial, pricePoint: 'CLOSE', effectiveAt: end }, fills };
    expect(privateChartOverlays([row], 'BTCUSDT')[0].exits.map((fill: any) => fill.time)).toEqual([partial, partial, end - 1]);
    expect(privateChartOverlays([{ ...row, candleClose: { ...row.candleClose, effectiveAt: undefined } }], 'BTCUSDT')[0].exits.map((fill: any) => fill.time)).toEqual([partial, partial, end]);
  });
});

describe('bounded incremental scenario refresh', () => {
  function client(initial: any = preview('advance-job', 'READY')) { return { advance: jest.fn().mockResolvedValue(initial), getPreview: jest.fn().mockResolvedValue(initial), confirm: jest.fn().mockResolvedValue({}), cancelPreview: jest.fn().mockResolvedValue({}) }; }
  test('ready advance confirms the existing scenario once and never reserves a new deposit', async () => {
    const api = client(), confirmed = jest.fn();
    await refreshPrivateScenario('saved-scenario', api, new AbortController().signal, () => true, confirmed, async () => {});
    expect(api.advance).toHaveBeenCalledWith('saved-scenario', '2026-09-14T12:00:00.000Z', expect.any(String)); expect(api.confirm).toHaveBeenCalledTimes(1); expect(confirmed).toHaveBeenCalledTimes(1); expect(api.cancelPreview).not.toHaveBeenCalled();
  });
  test.each(['INCOMPLETE', 'AMBIGUOUS', 'FAILED', 'EXPIRED', 'CANCELLED'])('%s advance is cancelled without financial confirmation', async status => {
    const api = client(preview('bad-job', status)), confirmed = jest.fn();
    await refreshPrivateScenario('saved-scenario', api, new AbortController().signal, () => true, confirmed, async () => {});
    expect(api.confirm).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled(); expect(api.cancelPreview).toHaveBeenCalledWith('bad-job');
  });
  test('aborted or paused before starting makes no request', async () => {
    const api = client(), aborted = new AbortController(); aborted.abort();
    await refreshPrivateScenario('p', api, aborted.signal, () => true, jest.fn());
    await refreshPrivateScenario('p', api, new AbortController().signal, () => false, jest.fn());
    expect(api.advance).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled();
  });
  test('late READY after cancellation is discarded and its job cancelled', async () => {
    const late = deferred(), api = client(), controller = new AbortController(), confirmed = jest.fn(); api.advance.mockReturnValue(late.promise);
    const pending = refreshPrivateScenario('p', api, controller.signal, () => true, confirmed, async () => {}); controller.abort(); late.resolve(preview('late-ready')); await pending;
    expect(api.cancelPreview).toHaveBeenCalledWith('late-ready'); expect(api.confirm).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled();
  });
  test('at most 45 polls run before a still-running calculation is cancelled', async () => {
    const api = client(preview('slow', 'RUNNING')), wait = jest.fn().mockResolvedValue(undefined), confirmed = jest.fn();
    await refreshPrivateScenario('p', api, new AbortController().signal, () => true, confirmed, wait);
    expect(wait).toHaveBeenCalledTimes(45); expect(api.getPreview).toHaveBeenCalledTimes(45); expect(api.confirm).not.toHaveBeenCalled(); expect(api.cancelPreview).toHaveBeenCalledWith('slow'); expect(confirmed).not.toHaveBeenCalled();
  });
  test('poll failure cancels the job and propagates the error instead of synthesizing a result', async () => {
    const api = client(preview('failing', 'RUNNING')); api.getPreview.mockRejectedValue(new Error('Source unavailable'));
    await expect(refreshPrivateScenario('p', api, new AbortController().signal, () => true, jest.fn(), async () => {})).rejects.toThrow('Source unavailable');
    expect(api.cancelPreview).toHaveBeenCalledWith('failing'); expect(api.confirm).not.toHaveBeenCalled();
  });
});
