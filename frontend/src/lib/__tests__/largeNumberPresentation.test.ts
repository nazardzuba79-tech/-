/**
 * LARGE FINANCIAL VALUES MUST STAY READABLE.
 *
 * A seven-figure profit or a five-figure ROI is an ordinary outcome on a
 * leveraged Cross account, and it is exactly where number formatting tends
 * to give up: scientific notation, NaN, Infinity, a value clipped by its own
 * column, or a percent sign that wanders off the card.
 *
 * Every number here goes through the SAME code the terminal uses — the real
 * `privateNumber`, the real `NativeDemoPanel`/`NativeDemoTicket`, the real
 * card renderer — so this fails when the presentation breaks, not when a
 * copy of it does. The arithmetic stays Decimal/BigNumber on the server;
 * these are display invariants only.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
function load(file: string, imports: Record<string, unknown> = {}) {
  const output: any = {};
  const source = readFileSync(resolve(frontend, 'src', file), 'utf8').replace(/import\.meta\.env\.VITE_API_URL/g, 'undefined');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', code)((name: string) => name in imports ? imports[name] : name.endsWith('.css') ? {} : req(name), output);
  return output;
}
const privateApi = load('lib/privateTradingApi.ts', { './api': { getToken: () => 'owner-token' }, './privateTradingError': load('lib/privateTradingError.ts') });
const nativeApi = load('lib/nativeDemoApi.ts', { './api': { getToken: () => 'owner-token' }, './privateTradingApi': privateApi });
const cardRenderer = load('lib/privateResultCard.ts', { './privateTradingApi': privateApi, './privateCardArtwork': load('lib/privateCardArtwork.ts') });

function nodes(node: any): any[] { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function text(node: any): string { return node === null || node === undefined || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children); }
function expand(node: any): any {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
}
function hooksReact() {
  let cursor = 0; const hooks: any[] = [];
  const react = { ...React,
    useState(initial: any) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }]; },
    useRef(initial: any) { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
    useEffect() {}, useCallback(fn: any) { return fn; } };
  return { react, reset: () => { cursor = 0; } };
}
function controls() {
  const h = hooksReact();
  const module = load('pages/private-trading/NativeDemoControls.tsx', { react: h.react, '../../lib/privateTradingApi': privateApi, '../../lib/nativeDemoApi': nativeApi, './PrivateResultCardDialog': { PrivateResultCardDialog: () => null } });
  return { module, h };
}

/** The magnitudes the owner asked for, plus the two that break naive code. */
const CASES = [
  { name: 'profit +1,200,000 USDT', pnl: '1200000', roi: '2400', money: '1,200,000.00', percent: '2,400.00' },
  { name: 'profit +10,000,000 USDT', pnl: '10000000', roi: '20000', money: '10,000,000.00', percent: '20,000.00' },
  { name: 'profit -1,200,000 USDT', pnl: '-1200000', roi: '-2400', money: '-1,200,000.00', percent: '-2,400.00' },
  { name: 'ROI +20,000%', pnl: '250000', roi: '20000', money: '250,000.00', percent: '20,000.00' },
  { name: 'ROI +128,450.75%', pnl: '4820000.5', roi: '128450.75', money: '4,820,000.50', percent: '128,450.75' },
  { name: 'ROI -99,999.99%', pnl: '-8750000.25', roi: '-99999.99', money: '-8,750,000.25', percent: '-99,999.99' },
] as const;

/** Nothing a trader reads may contain these, in any surface. */
const forbidden = (rendered: string) => {
  expect(rendered).not.toMatch(/\d[eE][+-]?\d/);   // scientific notation
  expect(rendered).not.toMatch(/NaN/);
  expect(rendered).not.toMatch(/Infinity|∞/);
  expect(rendered).not.toMatch(/undefined|null/);
};

describe('large financial values in the number formatter', () => {
  test.each(CASES)('$name formats with separators, two decimals and no exponent', ({ pnl, roi, money, percent }) => {
    expect(privateApi.privateNumber(pnl)).toBe(money);
    expect(privateApi.privateNumber(roi)).toBe(percent);
    forbidden(privateApi.privateNumber(pnl) + ' ' + privateApi.privateNumber(roi));
  });
  test('values far past what a trader will ever see still avoid an exponent', () => {
    // 1e21 is where JavaScript's own toString switches to exponential.
    expect(privateApi.privateNumber('1e21')).toBe('1,000,000,000,000,000,000,000.00');
    expect(privateApi.privateNumber('999999999999999999999')).not.toMatch(/[eE]/);
    forbidden(privateApi.privateNumber('1e21'));
  });
  test('a non-finite or unparsable value degrades to a dash, never to NaN or Infinity', () => {
    for (const bad of ['NaN', 'Infinity', '-Infinity', 'abc', '', null, undefined, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(privateApi.privateNumber(bad as any)).toBe('—');
    }
  });
});

describe('large financial values in the positions table and account totals', () => {
  const position = (extra: object = {}) => ({ id: 'p1', symbol: 'BTCUSDT', side: 'LONG', quantity: '1250.5', entryPrice: '50000', markPrice: '51000', lastPrice: '51000', leverage: '50', status: 'OPEN', openedAt: 1_700_000_000_000, closedAt: null, historical: false,
    unrealizedPnl: '0', realizedPnl: '0', netPnl: '0', roiPercent: '0', roiBasis: '1250000', closedRoiBasis: '1250000', fundingNet: '-48250.75', protection: { takeProfit: null, stopLoss: null, quantity: null, triggerBy: 'MARK' }, liquidationPrice: '1875000.5', liquidationStatus: 'ACCOUNT_CROSS_ESTIMATE', ...extra });
  const state = (extra: object = {}) => ({ initialized: true, revision: 9, source: 'DEMO_BALANCE', asOf: 1_700_000_100_000,
    model: { version: 'VOLTEX_NATIVE_CROSS_V2', funding: { longCashflow: '-0.001', shortCashflow: '0.004', unit: 'FRACTION', intervalMs: 28_800_000 } },
    account: { walletBalance: '10000000', initialDeposit: '10000000', unrealizedPnl: '10000000', equity: '20000000', usedMargin: '1250000', orderReserve: '0', available: '18750000', maintenanceMargin: '275000.5', maintenanceRatio: '0.0001', liquidatable: false, deficit: '0' },
    positions: [], history: [], orders: [], events: [], entries: [], ...extra });
  const controller = (extra: object = {}) => ({ requested: true, allowed: true, checked: true, state: state(), error: '', busy: false, card: null, setCard() {}, dialog: null, setDialog() {}, candle: null, setCandle() {}, exitId: null, setExitId() {}, selectedId: null,
    run: async () => true, initialize() {}, showCard() {}, interaction: {}, loader() {}, selectEntry() {}, exitOnChart() {}, fail() {}, pickEntry() {}, ...extra });

  test.each(CASES)('an open position showing $name keeps every cell intact', ({ pnl, roi, money, percent }) => {
    const { module, h } = controls();
    const c = controller({ state: state({ positions: [position({ unrealizedPnl: pnl, roiPercent: roi })] }) });
    h.reset(); const tree = expand(module.NativeDemoPanel({ controller: c }));
    const header = nodes(tree).filter((n: any) => n.type === 'th').map(text);
    const cells = nodes(nodes(tree).filter((n: any) => n.type === 'tr')[1]).filter((n: any) => n.type === 'td').map(text);
    // The table keeps its shape: one cell per column, none collapsed away.
    expect(cells).toHaveLength(header.length);
    expect(cells[header.indexOf('P&L / ROI')]).toContain(`${money} USDT`);
    expect(cells[header.indexOf('P&L / ROI')]).toContain(`${percent}%`);
    // Neighbouring columns still carry their own values — nothing was eaten.
    expect(cells[header.indexOf('Цена ликв.')]).toBe('1,875,000.50');
    expect(cells[header.indexOf('Маржа')]).toBe('1,250,000.00');
    expect(cells[header.indexOf('Funding')]).toBe('-48,250.75');
    forbidden(text(tree));
  });

  test.each(CASES)('closed history on the P&L tab shows $name as the realised result', ({ pnl, roi, money, percent }) => {
    const { module, h } = controls();
    const closed = position({ status: 'CLOSED', closedAt: 1_700_000_050_000, netPnl: pnl, roiPercent: roi, liquidationPrice: null });
    const c = controller({ state: state({ positions: [], history: [closed],
      events: [{ id: 'e1', kind: 'CLOSE', time: 1_700_000_050_000, positionId: 'p1', orderId: null, symbol: 'BTCUSDT', quantity: '1250.5', price: '58000', fee: '3625.25', cashflow: pnl, pricing: 'LAST' }] }) });
    h.reset(); const first = expand(module.NativeDemoPanel({ controller: c }));
    nodes(first).find((n: any) => n.type === 'button' && text(n) === 'P&L').props.onClick();
    h.reset(); const tree = expand(module.NativeDemoPanel({ controller: c }));
    const header = nodes(tree).filter((n: any) => n.type === 'th').map(text);
    const cells = nodes(nodes(tree).filter((n: any) => n.type === 'tr')[1]).filter((n: any) => n.type === 'td').map(text);
    expect(cells).toHaveLength(header.length);
    expect(cells[header.indexOf('P&L / ROI')]).toContain(`${money} USDT`);
    expect(cells[header.indexOf('P&L / ROI')]).toContain(`${percent}%`);
    expect(cells[header.indexOf('Цена выхода')]).toBe('58,000.00');
    forbidden(text(tree));
  });

  test('account totals and the Активы tab carry eight-figure balances unbroken', () => {
    const { module, h } = controls();
    const c = controller({ state: state({ positions: [position({ unrealizedPnl: '10000000', roiPercent: '800' })] }) });
    h.reset(); const ticket = expand(module.NativeDemoTicket({ controller: c, symbol: 'BTC/USDT' }));
    const summary = text(ticket);
    expect(summary).toContain('20,000,000.00 USDT');   // Обеспечение
    expect(summary).toContain('10,000,000.00 USDT');   // Нереализованный P&L
    expect(summary).toContain('18,750,000.00 USDT');   // Доступно
    expect(summary).toContain('275,000.50 USDT');      // Поддерживающая маржа
    forbidden(summary);
    h.reset(); const first = expand(module.NativeDemoPanel({ controller: c }));
    nodes(first).find((n: any) => n.type === 'button' && text(n) === 'Активы').props.onClick();
    h.reset(); const assets = expand(module.NativeDemoPanel({ controller: c }));
    const cells = nodes(nodes(assets).filter((n: any) => n.type === 'tr')[1]).filter((n: any) => n.type === 'td').map(text);
    expect(cells).toEqual(['USDT', '20,000,000.00', '18,750,000.00', '1,250,000.00', '0.00', '10,000,000.00']);
    forbidden(text(assets));
  });
});

describe('large financial values on the P&L card', () => {
  const snapshot = { id: 'c1', symbol: 'BTCUSDT', side: 'LONG', leverage: '50', mode: 'DEMO_LIVE', status: 'OPEN',
    unrealizedPnl: '0', roiPercent: '0', entryPrice: '50000', valuationPrice: '58000', usdPnl: null, asOf: '2026-08-08T12:00:00.000Z', label: 'Симуляция' };
  const rendered = (card: any) => {
    const svg = cardRenderer.privateResultCardSvg(card);
    const { JSDOM } = req('jsdom');
    const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    return { svg, doc, field: (name: string) => doc.querySelector(`[data-field="${name}"]`),
      visible: [...doc.querySelectorAll('text')].map((n: any) => n.textContent).join(' | ') };
  };

  test.each(CASES)('$name renders on the card with a readable USDT and percent', ({ pnl, roi, money, percent }) => {
    const signed = (v: string, f: string) => Number(v) > 0 ? `+${f}` : f;
    const { field, visible } = rendered({ ...snapshot, unrealizedPnl: pnl, roiPercent: roi });
    expect(field('profit-number').textContent).toBe(signed(pnl, money));
    expect(field('roi-number').textContent).toBe(signed(roi, percent));
    // The units stay their own elements, so they can never be clipped away
    // with the digits or collapse into them.
    expect(field('profit-unit').textContent).toBe('USDT');
    expect(field('roi-unit').textContent).toBe('%');
    forbidden(visible);
  });

  test('a long value is fitted to the card instead of running past its edge', () => {
    // textLength + lengthAdjust is what guarantees the glyphs stay inside the
    // box; a value short enough to fit must NOT be squeezed.
    const wide = rendered({ ...snapshot, unrealizedPnl: '98765432109876.54', roiPercent: '-123456789.99' });
    for (const name of ['roi-line', 'profit-number']) {
      const length = Number(wide.field(name)!.getAttribute('textLength'));
      expect(Number.isFinite(length)).toBe(true);
      expect(length).toBeLessThanOrEqual(1080 - 80);   // inside the card, left margin included
    }
    const ordinary = rendered({ ...snapshot, unrealizedPnl: '123.45', roiPercent: '12.34' });
    expect(ordinary.field('profit-number')!.getAttribute('textLength')).toBeNull();
    forbidden(wide.visible);
  });

  test('a big ROI steps its type down so the digits and the percent stay one line', () => {
    const small = rendered({ ...snapshot, roiPercent: '12.34' });
    const huge = rendered({ ...snapshot, roiPercent: '128450.75' });
    const size = (r: any, f: string) => Number(r.field(f)!.getAttribute('font-size'));
    expect(size(huge, 'roi-number')).toBeLessThanOrEqual(size(small, 'roi-number'));
    // Digits and percent are always the same size and share one text element.
    expect(size(huge, 'roi-number')).toBe(size(huge, 'roi-unit'));
    expect(huge.field('roi-unit')!.parentElement).toBe(huge.field('roi-number')!.parentElement);
  });

  test('the card still says nothing about the mode at any magnitude', () => {
    for (const { pnl, roi } of CASES) {
      for (const mode of ['DEMO_LIVE', 'HISTORICAL_REPLAY']) {
        const { svg, visible } = rendered({ ...snapshot, mode, unrealizedPnl: pnl, roiPercent: roi, label: 'x' });
        expect(visible).not.toMatch(/simulation|demo|\btest\b|preview|fixture|симул|демо|тест/i);
        expect(svg).toContain('height="1215"');
      }
    }
  });
});
