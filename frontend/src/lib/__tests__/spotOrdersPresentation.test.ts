import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';
import * as presentation from '../../components/spotOrderPresentation';
import { cancelSpotOrders, spotOrderCancelIds, createSpotReadController, formatOrderDecimal, formatOrderDifference,
  formatOrderProduct, formatOrderSum, spotOrderStatus, spotOrderType, type SpotOrderRow } from '../../components/spotOrderPresentation';

const t = (key: string) => key;
const order: SpotOrderRow = Object.freeze({ id: 'local-order-1', pair: 'SHIB/USDT', side: 'BUY', type: 'STOP_LIMIT',
  price: '0.00001234', triggerPrice: '0.00001250', ocoGroupId: null, originalQuantity: '12000.5', remainingQuantity: '11000.25',
  status: 'PARTIALLY_FILLED', createdAt: '2026-09-06T12:04:31.000Z' });
const source = (name: string) => readFileSync(resolve(__dirname, '../../components', name), 'utf8');
// Follow the existing frontend SSR harness without changing backend Jest's
// compilation settings. This executes the actual TSX view and real React.
const req = createRequire(resolve(__dirname, '../../../package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const compiled = ts.transpileModule(source('SpotOrdersView.tsx'), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
}}).outputText;
const views: Record<string, any> = {};
new Function('exports', 'require', compiled)(views, (name: string) => name === './spotOrderPresentation' ? presentation : req(name));
const renderOrders = (props: object) => renderToStaticMarkup(React.createElement(views.SpotOrdersView,
  { orders: [], loading: false, error: null, locale: 'en-US', t, onRetry: () => {}, ...props }));
const renderAssets = (props: object) => renderToStaticMarkup(React.createElement(views.SpotAssetsView,
  { balances: [], loading: false, error: null, t, onRetry: () => {}, ...props }));

describe('Spot orders truthful dense presentation', () => {
  it.each([
    ['0.00001234', '0.00001234'], ['1e-8', '0.00000001'], ['1.25e3', '1,250'],
    ['9007199254740993.12345678', '9,007,199,254,740,993.12345678'], ['0.00000000', '0'],
    ['12.34000000', '12.34'], [null, '—'], ['NaN', '—'], ['1e999999', '—'],
  ])('preserves decimal value %s without zeroing small assets', (value, expected) => {
    expect(formatOrderDecimal(value)).toBe(expected);
  });
  it('derives exact display totals and fills from only the real decimal inputs', () => {
    expect(formatOrderDifference('0.3', '0.1')).toBe('0.2');
    expect(formatOrderProduct('0.00001234', '12000.5')).toBe('0.14808617');
    expect(formatOrderSum('0.1', '0.2')).toBe('0.3');
    expect(formatOrderProduct(null, '1')).toBe('—');
    expect(formatOrderDifference('invalid', '1')).toBe('—');
    expect(formatOrderSum('1', 'invalid')).toBe('—');
  });
  it('distinguishes real market/limit conditional types and OCO without relabeling unknown types', () => {
    expect(spotOrderType(order, t)).toBe('trade.orderType.STOP_LIMIT · trade.orderType.LIMIT');
    expect(spotOrderType({ ...order, type: 'STOP_MARKET' }, t)).toBe('trade.orderType.STOP_MARKET · trade.orderType.MARKET');
    expect(spotOrderType({ ...order, ocoGroupId: 'actual-group' }, t)).toBe('trade.orderType.OCO');
    expect(spotOrderType({ ...order, type: 'UNKNOWN' }, t)).toBe('UNKNOWN');
    expect(spotOrderStatus('PARTIALLY_FILLED', t)).toBe('trade.status.PARTIALLY_FILLED');
    expect(spotOrderStatus('EXPIRED', t)).toBe('EXPIRED');
  });
  it('renders all real columns, precise price/trigger/fill/status, and does not mutate the row', () => {
    const before = JSON.stringify(order);
    const html = renderOrders({ orders: [order], onCancel: () => {} });
    expect(html.match(/<th /g)).toHaveLength(11);
    expect(html).toContain('0.00001234');
    expect(html).toContain('0.0000125');
    expect(html).toContain('1,000.25');
    expect(html).toContain('0.14808617');
    expect(html).toContain('data-status="PARTIALLY_FILLED"');
    expect(html).toContain('data-order-id="local-order-1"');
    expect(html).toContain('aria-label="trade.cancel SHIB/USDT local-order-1"');
    expect(JSON.stringify(order)).toBe(before);
  });
  it('keeps a compact intentional empty state below the real header', () => {
    const html = renderOrders({});
    expect(html.match(/<th /g)).toHaveLength(11);
    expect(html).toContain('colSpan="11"');
    expect(html).toContain('trade.noOrdersForPair');
    expect(html).toContain('trade.placeOrderPrompt');
    expect(html).not.toContain('data-order-id=');
  });
  it('never mistakes loading or a failed GET for a confirmed empty account', () => {
    const loading = renderOrders({ loading: true });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('trade.loading');
    expect(loading).not.toContain('trade.noOrdersForPair');
    const failed = renderOrders({ error: 'trade.loadOrdersError' });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('trade.retry');
    expect(failed).not.toContain('trade.noOrdersForPair');
  });
  it('retains last known rows on transient failure and blocks repeat cancel while pending', () => {
    const html = renderOrders({ orders: [order], error: 'temporary read failure', cancelling: true, cancellingId: order.id });
    expect(html).toContain('data-order-id="local-order-1"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('trade.cancelling');
    expect(html).toContain('temporary read failure');
  });
  it('history exposes pair, type, fill and actual terminal status without a cancel action', () => {
    const html = renderOrders({ orders: [{ ...order, status: 'FILLED', remainingQuantity: '0' }], history: true });
    expect(html.match(/<th /g)).toHaveLength(10);
    expect(html).toContain('SHIB/USDT');
    expect(html).toContain('data-status="FILLED"');
    expect(html).not.toContain('cancel-btn');
  });
  it('compact assets totals derive from existing balances and do not hide small nonzero holdings', () => {
    const html = renderAssets({ balances: [{ asset: 'BTC', available: '0.00000001', locked: '0.00000002' }] });
    expect(html).toContain('0.00000001');
    expect(html).toContain('0.00000002');
    expect(html).toContain('0.00000003');
    expect(source('AssetsPanel.tsx')).toContain('compact = false');
    expect(source('AssetsPanel.tsx')).toContain('available.toFixed(6)'); // Existing Futures branch remains.
  });
  function readSession() {
    const requests: { resolve: (value: string) => void; reject: (error: Error) => void }[] = [];
    const request = jest.fn(() => new Promise<string>((resolve, reject) => requests.push({ resolve, reject })));
    const handlers = { accept: jest.fn(), reject: jest.fn(), settled: jest.fn() };
    return { reader: createSpotReadController(request, handlers), request, requests, handlers };
  }
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  it('a GET slower than three 4-second polls still publishes, without overlapping requests', async () => {
    jest.useFakeTimers();
    const session = readSession();
    const first = session.reader.read(true);
    const timer = setInterval(() => { void session.reader.read(); }, 4000);
    try {
      await flush();
      jest.advanceTimersByTime(12000);
      expect(session.request).toHaveBeenCalledTimes(1);
      session.requests[0].resolve('slow but current');
      await first;
      expect(session.handlers.accept).toHaveBeenCalledWith('slow but current');
      expect(session.handlers.settled).toHaveBeenCalledTimes(1);
      expect(session.handlers.reject).not.toHaveBeenCalled();
    } finally { clearInterval(timer); session.reader.pause(); jest.useRealTimers(); }
  });
  it('after cancellation, forced refresh rejects stale rows and awaits one immediate fresh GET', async () => {
    const session = readSession();
    void session.reader.read(true);
    await flush();
    let finished = false;
    const fresh = session.reader.read(true).then(() => { finished = true; });
    void session.reader.read(true); // Multiple mutation refreshes coalesce.
    void session.reader.read(); // An ordinary poll does not add another read.
    expect(session.request).toHaveBeenCalledTimes(1);
    session.requests[0].resolve('pre-cancel rows');
    await flush();
    expect(session.handlers.accept).not.toHaveBeenCalled();
    expect(session.handlers.settled).not.toHaveBeenCalled();
    expect(session.request).toHaveBeenCalledTimes(2);
    expect(finished).toBe(false);
    session.requests[1].resolve('post-cancel rows');
    await fresh;
    expect(session.handlers.accept.mock.calls).toEqual([['post-cancel rows']]);
    expect(session.handlers.settled).toHaveBeenCalledTimes(1);
    expect(finished).toBe(true);
  });
  it('refreshKey cleanup/restart queues fresh data and ignores a late pre-refresh error', async () => {
    const session = readSession();
    void session.reader.read(true);
    await flush();
    session.reader.pause(); session.reader.resume();
    const refreshed = session.reader.read(true);
    session.requests[0].reject(new Error('old request failed'));
    await flush();
    expect(session.handlers.reject).not.toHaveBeenCalled();
    expect(session.request).toHaveBeenCalledTimes(2);
    session.requests[1].resolve('new refresh');
    await refreshed;
    expect(session.handlers.accept.mock.calls).toEqual([['new refresh']]);
  });
  it('an unmount discards queued work and never updates state from a late response', async () => {
    const session = readSession();
    const pending = session.reader.read(true);
    await flush();
    void session.reader.read(true);
    session.reader.pause();
    session.requests[0].resolve('unmounted');
    await pending;
    await session.reader.read(true);
    expect(session.request).toHaveBeenCalledTimes(1);
    expect(session.handlers.accept).not.toHaveBeenCalled();
    expect(session.handlers.reject).not.toHaveBeenCalled();
    expect(session.handlers.settled).not.toHaveBeenCalled();
  });
  it('a synchronous request failure clears the single-flight slot so Retry can recover', async () => {
    const handlers = { accept: jest.fn(), reject: jest.fn(), settled: jest.fn() };
    const request = jest.fn<Promise<string>, []>().mockImplementationOnce(() => { throw new Error('request failed'); }).mockResolvedValue('recovered');
    const reader = createSpotReadController(request, handlers);
    await reader.read(true);
    expect(handlers.reject).toHaveBeenCalledTimes(1);
    await reader.read(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(handlers.accept).toHaveBeenCalledWith('recovered');
  });
  it('continues real sequential cancellations after a failure and reports the actual outcome', async () => {
    const calls: string[] = [];
    let active = false;
    const result = await cancelSpotOrders(['1', '2', '3'], async id => {
      expect(active).toBe(false); active = true; calls.push(id);
      await Promise.resolve(); active = false;
      if (id === '2') throw new Error('Actual API rejection');
    });
    expect(calls).toEqual(['1', '2', '3']);
    expect(result).toEqual({ succeeded: 2, failed: 1 });
  });
  it('Cancel All sends only one real DELETE per OCO group and preserves every standalone order', async () => {
    const orders = [
      { id: 'oco-a-take', ocoGroupId: 'group-a' }, { id: 'limit-1', ocoGroupId: null },
      { id: 'oco-a-stop', ocoGroupId: 'group-a' }, { id: 'oco-b-stop', ocoGroupId: 'group-b' },
      { id: 'limit-2', ocoGroupId: null }, { id: 'oco-b-take', ocoGroupId: 'group-b' },
    ];
    const before = JSON.stringify(orders);
    const live = new Set(orders.map(row => row.id));
    const deleted: string[] = [];
    const result = await cancelSpotOrders(spotOrderCancelIds(orders), async id => {
      if (!live.has(id)) throw new Error('404 ORDER_NOT_FOUND');
      deleted.push(id);
      const row = orders.find(item => item.id === id)!;
      for (const item of orders) if (item.id === id || (row.ocoGroupId !== null && row.ocoGroupId === item.ocoGroupId)) live.delete(item.id);
    });
    expect(deleted).toEqual(['oco-a-take', 'limit-1', 'oco-b-stop', 'limit-2']);
    expect(result).toEqual({ succeeded: 4, failed: 0 });
    expect(live.size).toBe(0);
    expect(JSON.stringify(orders)).toBe(before);
  });
  it('OCO grouping does not hide a genuine API rejection or merge independent groups', async () => {
    const ids = spotOrderCancelIds([{ id: 'a', ocoGroupId: 'one' }, { id: 'b', ocoGroupId: 'one' },
      { id: 'c', ocoGroupId: 'two' }, { id: 'd', ocoGroupId: null }]);
    expect(ids).toEqual(['a', 'c', 'd']);
    const cancel = jest.fn(async (id: string) => { if (id === 'a') throw new Error('real cancellation rejected'); });
    expect(await cancelSpotOrders(ids, cancel)).toEqual({ succeeded: 2, failed: 1 });
    expect(cancel.mock.calls.map(([id]) => id)).toEqual(ids);
  });
  it('preserves existing GET filters, 4-second polling, selected-pair filtering and per-order cancel endpoint', () => {
    const open = source('OpenOrdersPanel.tsx');
    const history = source('OrderHistoryPanel.tsx');
    expect(open).toContain("getMyOrders('PENDING_TRIGGER,OPEN,PARTIALLY_FILLED')");
    expect(history).toContain("getMyOrders('FILLED,CANCELLED')");
    for (const value of [open, history]) {
      expect(value).toContain('setInterval(load, 4000)');
      expect(value).toContain('o.pair === pair');
      expect(value).toContain('reader.current!.pause()');
      expect(value).toContain('void load(true)');
    }
    expect(open).toContain('await api.cancelOrder(orderId)');
    expect(open).toContain('cancelSpotOrders(spotOrderCancelIds(pairOrders)');
    expect(open).toContain('onCount?.(pairOrders.length)');
    expect(open.match(/await load\(true\)/g)).toHaveLength(2);
    expect(source('AssetsPanel.tsx')).toContain('if (compact) return reader.current!.read(fresh)');
    expect(open).toContain("if (result.failed) toast.error(t('trade.cancelOrderError'))");
    expect(source('SpotOrders.css')).not.toMatch(/(?:^|\n)\s*\.(?:orders-table|empty-state|bottom-panel)\s*[{,]/);
  });
  it('keeps the complete shared Futures stylesheet intact and scopes every new override to Spot', () => {
    const pageSource = (file: string) => readFileSync(resolve(__dirname, '../../pages', file), 'utf8').replace(/\r\n/g, '\n');
    const css = pageSource('trade-terminal/TradeTerminal.css');
    const [shared, spot] = css.split('/* Final Spot-only reconciliation.');
    // Re-taken once, from ceb3d8f0…, for the shared authenticated header
    // fix: `.trade-terminal *` blanket-reset margin and padding on the
    // global nav that renders inside this wrapper, collapsing it into the
    // top-left corner on /trade and /futures in production. The reset now
    // carries `:not(:where(.global-header, .global-header *))`, which is
    // zero-specificity and therefore changes nothing about how the terminal
    // itself cascades. That one selector is the entire diff to this section
    // — the assertion below pins it, so the fingerprint cannot be re-taken
    // again to cover a different edit without also deleting that line.
    expect(shared).toContain('.trade-terminal *:not(:where(.global-header, .global-header *)),');
    expect(createHash('sha256').update(shared.trimEnd()).digest('hex')).toBe('873d9210fc4a00220d1746591746d00b5d0198f5b2b2b85e7e87fd1246b5bd82');
    const postcss = req('postcss');
    const rules: string[] = [];
    postcss.parse('/* Final Spot-only reconciliation.' + spot).walkRules((rule: { selectors: string[] }) => rules.push(...rule.selectors));
    expect(rules.length).toBeGreaterThan(20);
    expect(rules.every(selector => selector.startsWith('.trade-terminal.spot-terminal'))).toBe(true);
    expect(spot).toContain('.bottom-tab .badge::before { display: none; content: none; }');
    expect(pageSource('TradePage.tsx')).toContain('className="trade-terminal spot-terminal"');
    expect(pageSource('FuturesPage.tsx')).toContain('className="trade-terminal futures-terminal"');
    expect(pageSource('FuturesPage.tsx')).not.toContain('spot-terminal');
  });
});
