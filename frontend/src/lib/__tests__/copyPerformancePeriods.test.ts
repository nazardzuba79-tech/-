import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { CopyMarketplaceStore } from '../copyMarketplaceStore';
import { CopyPerformanceService } from '../../../../src/services/copyTrading/CopyPerformanceService';
import { marketplaceSection } from '../../../../src/services/copyTrading/marketplaceSnapshot';
import { selectSyntheticPeriod, type SyntheticCopyTradingResponse } from '../syntheticCopyTrading';
import { privateStrategyView } from '../copyMarketplacePrivacy';
import { formatPercent } from '../../pages/copy-trading-bolt/traders';
import { publicSignedUsdt } from '../copyTradingMoney';
import { languageModule } from '../../../test-utils/languageStub';

/**
 * «Эффективность» IN THE REAL PAGE: the selected period's figures, in the
 * viewer's language, and a skeleton only while a request is in flight.
 *
 * The page, its components and the marketplace store are the real modules;
 * only the transport, unrelated chrome and the language provider are
 * substituted — the language by the SHIPPED dictionaries.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const { createRoot } = req('react-dom/client');

let language = 'ru';
let store: CopyMarketplaceStore;
let session: string | null = 'viewer';
const fetchSpy = jest.fn();
const cache = new Map<string, any>();
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix) && statSync(file + suffix).isFile()) { file += suffix; break; }
  if (cache.has(file)) return cache.get(file);
  const exports: any = {}; cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const requireFrom = (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/Nav')) return { Nav: () => null };
    if (name.endsWith('/Footer')) return { Footer: () => null };
    if (name === 'sonner') return { Toaster: () => null, toast: { success: jest.fn() } };
    if (name.endsWith('/api')) return { getToken: () => session, api: { getPortfolioHistory: async () => ({ points: [] }) } };
    if (name.endsWith('/lib/i18n')) return { useLanguage: () => languageModule(language).useLanguage() };
    if (name.endsWith('/useCopyMarketplace')) return { useCopyMarketplace: () => React.useSyncExternalStore(store.subscribe, store.getState, store.getState) };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  };
  new Function('exports', 'require', code)(exports, requireFrom);
  return exports;
}

let Page: any;
let payload: any;
let sections: Record<'nazar' | 'ksenia', SyntheticCopyTradingResponse>;
let dom: any; let root: any; let host: HTMLElement;
let resolvePayload: (value: unknown) => void;
const flush = () => new Promise<void>(done => setImmediate(done));
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

beforeAll(async () => {
  const rows = new Map();
  const db = { copyPerformanceScenario: {
    findUnique: async ({ where }: any) => rows.get(where.id) || null,
    create: async ({ data }: any) => { const row = { ...data, revision: 0 }; rows.set(data.id, row); return row; },
  } };
  const service = new CopyPerformanceService(db as never, () => new Date('2026-09-28T12:00:00Z'));
  const nazar = marketplaceSection('nazar', await service.get('nazar'));
  const ksenia = marketplaceSection('ksenia', await service.get('ksenia'));
  payload = { nazar, ksenia, identities: [null, null], generatedAt: '2026-09-28T12:00:00.000Z', errors: {} };
  sections = { nazar: privateStrategyView(JSON.parse(JSON.stringify(nazar))), ksenia: privateStrategyView(JSON.parse(JSON.stringify(ksenia))) };
  Page = load(resolve(frontend, 'src/pages/CopyTradingPage.tsx')).CopyTradingPage;
}, 120_000);

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/copy-trading' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: fetchSpy });
  dom.window.scrollTo = jest.fn();
  session = 'viewer'; language = 'ru'; fetchSpy.mockClear();
  store = new CopyMarketplaceStore((signal: AbortSignal) => new Promise((resolveIt, reject) => {
    resolvePayload = resolveIt;
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }), () => session, () => Date.parse('2026-09-28T12:00:00Z'), null);
  host = dom.window.document.getElementById('root')!; root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); session = null; store.getState(); });
  dom.window.close();
});

const mount = () => act(async () => { root.render(React.createElement(Page)); await flush(); });
const answer = () => act(async () => { resolvePayload(JSON.parse(JSON.stringify(payload))); await flush(); });
const card = (id: string) => host.querySelector(`[data-trader-id="${id}"]`)!;
async function openProfile(id: string) {
  await act(async () => (card(id).querySelector('.card-view-button') as HTMLButtonElement).click());
  await act(async () => { await sleep(40); });
}
async function choose(period: string) {
  await act(async () => { (host.querySelector(`.profile-periods [data-period="${period}"]`) as HTMLButtonElement).click(); await flush(); });
}
function panel() {
  const node = host.querySelector('.profile-metrics-panel')!;
  const rows = Array.from(node.querySelectorAll('[data-metric]')).map(row => ({
    id: row.getAttribute('data-metric')!, label: row.querySelector('span')!.textContent!,
    value: row.querySelector('strong')!.textContent!.replace(/ | /g, ' '),
  }));
  return { node, period: node.getAttribute('data-period'), heading: node.querySelector('h2')!.textContent,
    window: node.querySelector('.profile-panel-heading span')!.textContent, units: node.querySelector('.profile-metrics-units')!.textContent,
    rows, values: Object.fromEntries(rows.map(row => [row.id, row.value])), text: node.textContent! };
}

const RUSSIAN_LABELS = ['ROI', 'P&L мастера', 'P&L подписчиков', '% успешных сделок', 'Макс. просадка', 'Сред. P&L',
  'Коэффициент P/L', 'Сред. сделок в неделю', 'Сред. время удержания', 'Волатильность ROI', 'Коэффициент Шарпа',
  'Коэффициент Сортино', 'Посл. сделка', 'Всего сделок', 'С прибылью', 'С убытком'];
const ENGLISH_WORDS = /\b(Win|Rate|Drawdown|Average|Avg|Profit|Factor|Weekly|Trades?|Holding|Volatility|Sharpe|Sortino|Total|Winning|Losing|Performance|Rolling|Window|Since|Inception|Last|Units|Master|Followers)\b/;
const PERIODS = ['7D', '30D', '90D', 'ALL'] as const;

describe.each([['VX-001', 'nazar'], ['VX-KSENIA', 'ksenia']] as const)('%s profile', (id, key) => {
  test('every period shows ITS OWN figures — pressing 90Д never leaves 7Д figures under a new label', async () => {
    await mount(); await answer(); await openProfile(id);
    const seen: Record<string, ReturnType<typeof panel>> = {};
    for (const period of PERIODS) {
      await choose(period);
      const view = panel(); seen[period] = view;
      const expected = selectSyntheticPeriod(sections[key], period);
      expect(view.period).toBe(period);
      expect(view.values.roi).toBe(formatPercent(expected.roi));
      expect(view.values.masterPnl).toBe(publicSignedUsdt(expected.pnl).replace(/ | /g, ' '));
      expect(view.values.followersPnl).toBe(publicSignedUsdt(expected.followerPnl).replace(/ | /g, ' '));
      expect(view.values.totalTrades.replace(/\s/g, '')).toBe(String(expected.totalTrades));
      expect(view.values.winningTrades.replace(/\s/g, '')).toBe(String(expected.winningTrades));
      expect(view.values.losingTrades.replace(/\s/g, '')).toBe(String(expected.losingTrades));
      expect(view.values.lastTrade).toBe('28.09.2026');
      expect(view.text).not.toMatch(/NaN|undefined/);
    }
    for (const metric of ['roi', 'masterPnl', 'followersPnl', 'totalTrades'])
      expect(new Set(PERIODS.map(period => seen[period].values[metric])).size).toBe(4);
    // 7D has no losing trade and no losing day: the ratios are unbounded,
    // said as ∞ with the reason, never a made-up finite number.
    const week = selectSyntheticPeriod(sections[key], '7D');
    expect(week.losingTrades).toBe(0);
    expect(seen['7D'].values.profitFactor).toBe('∞');
    expect(seen['7D'].values.sortino).toBe('∞');
  });

  test('ru: every label in «Эффективность» is Russian; ROI, P&L and USDT stay as they are', async () => {
    await mount(); await answer(); await openProfile(id);
    expect(Array.from(host.querySelectorAll('.profile-periods button')).map(b => b.textContent)).toEqual(['7 д.', '30 д.', '90 д.', 'Всё время']);
    for (const period of PERIODS) {
      await choose(period);
      const view = panel();
      expect(view.heading).toBe('Эффективность');
      expect(view.rows.map(row => row.label)).toEqual(RUSSIAN_LABELS);
      expect(view.units).toBe('Единицы измерения: USDT');
      expect(view.window).toBe(period === 'ALL' ? 'Всё время · С момента запуска'
        : `${{ '7D': '7 д.', '30D': '30 д.', '90D': '90 д.' }[period]} · скользящий период`);
      const words = view.text.replace(/ROI|P&L|P\/L|USDT/g, '');
      expect(words).not.toMatch(ENGLISH_WORDS);
    }
  });

  test('switching language changes words only: same numbers, same period, no request', async () => {
    await mount(); await answer(); await openProfile(id);
    await choose('30D');
    const russian = panel();
    const requestsBefore = fetchSpy.mock.calls.length;
    const stateBefore = store.getState();
    for (const next of ['en', 'zh', 'es', 'hi', 'ja', 'ko', 'ru']) {
      language = next;
      await act(async () => { root.render(React.createElement(Page)); await flush(); });
      const view = panel();
      expect(view.period).toBe('30D');
      // Numbers are presentation-identical in every language; only unit
      // WORDS may differ (the holding time's «ч»/«мин» are words).
      const figures = (value: string) => value.replace(/[^\d,.+\-−∞—%]/g, '');
      expect(view.rows.map(row => figures(row.value))).toEqual(russian.rows.map(row => figures(row.value)));
      expect(view.rows.filter(row => row.id !== 'holdingTime').map(row => row.value))
        .toEqual(russian.rows.filter(row => row.id !== 'holdingTime').map(row => row.value));
      expect(view.rows.find(row => row.id === 'roi')!.label).toBe('ROI');
      expect(view.rows.find(row => row.id === 'masterPnl')!.label).toContain('P&L');
      expect(view.units).toContain('USDT');
      if (next === 'en') {
        expect(view.heading).toBe('Performance');
        expect(view.rows.map(row => row.label)).toContain('Win rate');
      }
    }
    expect(fetchSpy.mock.calls.length).toBe(requestsBefore);
    expect(store.getState()).toBe(stateBefore);
  });
});

test('a skeleton only while the request is in flight; afterwards an honest «—», never an eternal loader', async () => {
  await mount();
  // In flight: both featured cards reserve their metrics as skeletons.
  for (const id of ['VX-001', 'VX-KSENIA']) {
    expect(card(id).querySelectorAll('.copy-metric-skeleton').length).toBeGreaterThan(0);
    expect(card(id).textContent).toContain('Загрузка…');
  }
  // The attempt ends WITHOUT data (the server's 503, a timeout, a refusal).
  await act(async () => { resolvePayload({ nazar: null, ksenia: null, identities: null, generatedAt: '2026-09-28T12:00:00.000Z',
    errors: { nazar: 'temporarily_unavailable', ksenia: 'temporarily_unavailable', identities: 'temporarily_unavailable' } }); await flush(); });
  expect(store.getState().settled).toBe(true);
  for (const id of ['VX-001', 'VX-KSENIA']) {
    const node = card(id);
    expect(node.querySelectorAll('.copy-metric-skeleton')).toHaveLength(0);
    expect(node.querySelectorAll('[data-unavailable]').length).toBeGreaterThan(0);
    expect(node.textContent).toContain('—');
    expect(node.textContent).toContain('Данные недоступны');
    expect(node.textContent).not.toContain('Загрузка…');
    expect(node.textContent).not.toMatch(/NaN|\b0(?:[.,]0+)?%/);
  }
  await openProfile('VX-001');
  const profile = host.querySelector('.trader-profile-page')!;
  expect(profile.querySelectorAll('.copy-metric-skeleton')).toHaveLength(0);
  expect(profile.querySelectorAll('[data-unavailable]').length).toBeGreaterThan(5);
});
