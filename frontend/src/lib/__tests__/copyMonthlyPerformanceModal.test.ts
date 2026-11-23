import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as monthly from '../monthlyCopyPerformance';
import * as money from '../copyTradingMoney';

/**
 * «Статистика по месяцам» in a real DOM: the one dialog, mounted from its own
 * source with React, opened and clicked through as a visitor would — with
 * every network entry point of the window watched. Opening it, choosing
 * months and moving between years must never reach the network: the table is
 * the profile's own payload, rearranged in memory.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const read = (file: string) => readFileSync(resolve(frontend, 'src', file), 'utf8');

function load(file: string, imports: Record<string, unknown>) {
  const out: any = {};
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', code)((name: string) => (name in imports ? imports[name] : name.endsWith('.css') ? {} : req(name)), out);
  return out;
}

const icon = () => null;
const modal = () => load('pages/copy-trading-bolt/CopyMonthlyPerformanceModal.tsx', {
  react: React, 'react-dom': req('react-dom'), 'lucide-react': { CalendarDays: icon, X: icon },
  '../../lib/monthlyCopyPerformance': monthly, '../../lib/copyTradingMoney': money,
});

const series = (from: string, days: number, dailyReturn: (index: number) => number) =>
  Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10);
    const value = dailyReturn(index);
    return { date, startEquity: 100, endEquity: 100, realizedPnl: value * 10_000, dailyReturn: value, drawdown: 0, numberOfTrades: index % 3 ? 1 : 0 };
  });
const strategy = (id: string, name: string, from: string, days: number, dailyReturn: (index: number) => number) => ({
  trader: { id, name, vip: true },
  economics: { methodology: 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN' },
  dailyResults: series(from, days, dailyReturn),
  monthly: [],
}) as any;
// Two traders, two different histories — both crossing the year boundary.
const NAZAR = strategy('VX-001', 'Nazar', '2025-11-21', 80, index => (index % 4 === 0 ? -0.004 : 0.003));
const KSENIA = strategy('VX-KSENIA', 'Ksenia', '2025-12-06', 60, index => (index % 5 === 0 ? -0.01 : 0.006));

let dom: any;
let root: any;
let network: string[];
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/copy-trading', pretendToBeVisual: true });
  network = [];
  const record = (kind: string) => (...args: unknown[]) => { network.push(`${kind} ${String(args[0] ?? args[1] ?? '')}`); return Promise.reject(new Error('no network in this test')); };
  dom.window.fetch = record('fetch');
  const open = dom.window.XMLHttpRequest.prototype.open;
  dom.window.XMLHttpRequest.prototype.open = function (...args: any[]) { network.push(`xhr ${args[1]}`); return open.apply(this, args); };
  dom.window.navigator.sendBeacon = (url: string) => { network.push(`beacon ${url}`); return true; };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    fetch: dom.window.fetch, IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(dom.window.document.getElementById('root'));
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  dom.window.close();
  for (const key of ['window', 'document', 'HTMLElement', 'fetch', 'IS_REACT_ACT_ENVIRONMENT']) delete (globalThis as any)[key];
});

const $ = (selector: string) => dom.window.document.querySelector(selector);
const $$ = (selector: string) => [...dom.window.document.querySelectorAll(selector)] as any[];
const click = (element: any) => React.act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const text = (element: any) => element?.textContent.replace(/\s+/g, ' ').trim();
const cellFor = (label: string) => $$('.mcp-cell').find(button => button.getAttribute('aria-label').startsWith(label));

async function openFor(synthetic: any) {
  const { MonthlyPerformanceLauncher } = modal();
  await React.act(async () => root.render(React.createElement(MonthlyPerformanceLauncher, { synthetic })));
  expect(text($('.monthly-performance-open'))).toBe('Статистика по месяцам');
  await click($('.monthly-performance-open'));
  return $('dialog.copy-monthly-dialog');
}

it('opens, switches months and years, and closes — without one network request', async () => {
  const dialog = await openFor(NAZAR);
  expect(dialog).not.toBeNull();
  expect(text(dialog.querySelector('h2'))).toBe('Помесячная доходность');
  expect(text(dialog.querySelector('.mcp-header p'))).toBe('Результаты по месяцам с накопительным итогом');
  expect($$('.mcp-table thead th').map(text)).toEqual(['Месяц', '2025', '2026']);
  expect($$('.mcp-table tbody th').map(text)).toEqual(['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']);
  expect(text($('.mcp-table tfoot th'))).toBe('Итог');
  // Opens on the latest month with data.
  expect(text($('.mcp-detail h3'))).toBe('Февраль 2026');

  await click(cellFor('Ноябрь 2025'));
  expect(text($('.mcp-detail h3'))).toBe('Ноябрь 2025');
  expect(text($('.mcp-coverage'))).toBe('Стратегия ведётся с 21.11.2025');
  await click(cellFor('2025 · Итог'));
  expect(text($('.mcp-detail h3'))).toBe('2025 · Итог');
  expect(text($('.mcp-detail dt'))).toBe('ROI за год');
  await click(cellFor('Январь 2026'));
  expect(text($('.mcp-detail h3'))).toBe('Январь 2026');
  await click(cellFor('2026 · Итог'));
  expect(text($('.mcp-detail h3'))).toBe('2026 · Итог');

  // Esc (the dialog's cancel event) closes it.
  await React.act(async () => { dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })); });
  expect($('dialog.copy-monthly-dialog')).toBeNull();

  expect(network).toEqual([]);
});

it('prints «—» for every month outside the history, and the real figure inside it', async () => {
  await openFor(NAZAR);
  const rows = $$('.mcp-table tbody tr');
  const cells = (row: any) => [...row.querySelectorAll('td')].map(text);
  // 2025: only November and December have history.
  expect(rows.slice(0, 10).map((row: any) => cells(row)[0])).toEqual(Array(10).fill('—'));
  expect(cells(rows[10])[0]).toMatch(/^[+-]\d+\.\d{2}%$/);
  // 2026: January and February only (the history ends 8 February).
  expect(cells(rows[0])[1]).toMatch(/^[+-]\d+\.\d{2}%$/);
  expect(rows.slice(2).map((row: any) => cells(row)[1])).toEqual(Array(10).fill('—'));
  expect(network).toEqual([]);
});

it('shows every detail figure the history supports, and each figure from the chosen period', async () => {
  await openFor(NAZAR);
  await click(cellFor('Декабрь 2025'));
  const table = monthly.buildMonthlyPerformance(NAZAR.dailyResults, NAZAR.economics.methodology, NAZAR.monthly);
  const december = table.cells['2025-12'];
  const figures = Object.fromEntries($$('.mcp-detail dl > div').map(row => [text(row.querySelector('dt')), text(row.querySelector('dd'))]));
  expect(figures).toEqual({
    'ROI за месяц': monthly.monthlyPercent(december.roi).text,
    'Реализованный PnL': money.publicSignedUsdt(december.realizedPnl),
    'Торговых дней': String(december.tradingDays),
    'Сделок': String(december.trades),
    'Прибыльных дней': String(december.profitableDays),
    'Убыточных дней': String(december.losingDays),
    'Макс. просадка': `${december.maximumDrawdown.toFixed(2)}%`,
  });
  expect(december.calendarDays).toBe(31);
  expect(text($('.mcp-coverage'))).toBeUndefined();
});

it('the same component shows Nazar’s figures on Nazar and Ksenia’s on Ksenia', async () => {
  const nazar = await openFor(NAZAR);
  expect(nazar.getAttribute('data-trader-id')).toBe('VX-001');
  expect(text($('.mcp-trader'))).toBe('Nazar · VX-001');
  const nazarDecember = text(cellFor('Декабрь 2025'));
  expect(cellFor('Ноябрь 2025')).toBeDefined();
  await React.act(async () => root.unmount());

  root = createRoot(dom.window.document.getElementById('root'));
  const ksenia = await openFor(KSENIA);
  expect(ksenia.getAttribute('data-trader-id')).toBe('VX-KSENIA');
  expect(text($('.mcp-trader'))).toBe('Ksenia · VX-KSENIA');
  // Ksenia's history starts in December: her November is empty, and her
  // December is her own figure, not Nazar's.
  expect(cellFor('Ноябрь 2025')).toBeUndefined();
  const expected = monthly.monthlyPercent(monthly.buildMonthlyPerformance(KSENIA.dailyResults, KSENIA.economics.methodology).cells['2025-12'].roi).text;
  expect(text(cellFor('Декабрь 2025'))).toBe(expected);
  expect(text(cellFor('Декабрь 2025'))).not.toBe(nazarDecember);
  expect(network).toEqual([]);
});

it('renders nothing for a trader without a daily history', async () => {
  const { MonthlyPerformanceLauncher } = modal();
  await React.act(async () => root.render(React.createElement(MonthlyPerformanceLauncher, { synthetic: null })));
  expect($('.monthly-performance-entry')).toBeNull();
  await React.act(async () => root.render(React.createElement(MonthlyPerformanceLauncher, { synthetic: { ...NAZAR, dailyResults: [] } })));
  expect($('.monthly-performance-entry')).toBeNull();
});

describe('wiring', () => {
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const profile = read('pages/copy-trading-bolt/components.tsx');

  it('the profile hands the dialog ITS OWN strategy — the one whose trader id matches the page', () => {
    const body = profile.slice(profile.indexOf('export function Profile('), profile.indexOf('function MarketplaceHero('));
    expect(body).toContain('const liveSynthetic = synthetic?.trader.id === trader.id ? synthetic : null;');
    expect(body).toContain('<MonthlyPerformanceLauncher synthetic={liveSynthetic} />');
    // Inside the «Статистика» tab, not «Сделки».
    const statistics = body.slice(body.indexOf("activeTab === 'statistics'"), body.indexOf('<TradesPanel'));
    expect(statistics).toContain('<MonthlyPerformanceLauncher synthetic={liveSynthetic} />');
  });

  it('neither the dialog nor its arithmetic can reach the network or the store', () => {
    for (const file of ['pages/copy-trading-bolt/CopyMonthlyPerformanceModal.tsx', 'lib/monthlyCopyPerformance.ts']) {
      const code = strip(read(file));
      expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
      expect(code).not.toMatch(/lib\/api['"]|useCopyMarketplace|copyMarketplaceStore|import\s*\(/);
    }
  });

  it('the table is rebuilt only when the strategy itself changes', () => {
    const code = strip(read('pages/copy-trading-bolt/CopyMonthlyPerformanceModal.tsx'));
    expect(code).toContain('useMemo(() => buildMonthlyPerformance(synthetic.dailyResults, synthetic.economics?.methodology, synthetic.monthly),');
    expect(code).toContain('[synthetic.dailyResults, synthetic.economics?.methodology, synthetic.monthly]');
  });
});
