import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { createReviewSyntheticState } from '../../../../src/services/copyTrading/canonical/reviewSyntheticHistory';
import { toResponse } from '../../../../src/services/copyTrading/canonical/SyntheticCopyTradingEngine';
import { selectSyntheticPeriod, syntheticNazaraTrader, formatSyntheticHistoryDate } from '../syntheticCopyTrading';
import { publicSignedUsdt, publicUsdtNumber } from '../copyTradingMoney';
import { dailyReturnChart } from '../dailyReturnChart';
import { nazarTrader, formatPercent, formatAccountSize, roiClass, PERIODS } from '../../pages/copy-trading-bolt/traders';
import { VerifiedBadge } from '../../../test-utils/verifiedBadge';
import { isModeledTraderData } from '../modeledCopyData';
import { periodRatioFacts } from '../syntheticCopyTrading';
import { languageModule } from '../../../test-utils/languageStub';
import { liveMetricModule } from '../../../test-utils/copyPresentation';

const frontend = resolve(__dirname, '../../..');
const requireFrontend = createRequire(resolve(frontend, 'package.json'));
const React = requireFrontend('react');
const { renderToStaticMarkup } = requireFrontend('react-dom/server');
const source = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8');
const parsed = ts.createSourceFile('components.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['localizedDuration', 'periodLabelKey', 'numberLabel', 'signedUsd', 'unsignedPercent', 'durationLabel', 'fallbackMetrics', 'MetricsPanel', 'DailyReturnChart', 'FollowersPanel', 'Profile'];
const declarations = names.map(name => {
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error(`Missing real component ${name}`);
  return node.getText(parsed);
});
let selectedPeriod = 'ALL';
let stateCursor = 0;
const empty = () => null;
// Actual profile/readout/follower/histogram markup, with only unrelated children
// stubbed. The period state is selected explicitly; data uses the real adapter.
const deps = {
  isModeledTraderData, periodRatioFacts,
  ...languageModule('ru'), ...liveMetricModule(),
  useFiguresPending: () => false, useEffect: () => {},
  useMemo: (fn: () => unknown) => fn(),
  // Render the settled analytics phase; copyFirstLoad exercises the real
  // 16 ms transition and confirms that the first identity paint is retained.
  useState: (initial: unknown) => [stateCursor++ === 0 ? true : initial === '90D' ? selectedPeriod : initial, empty],
  selectSyntheticPeriod, nazarTrader, formatPercent, roiClass, formatAccountSize, PERIODS,
  publicSignedUsdt, publicUsdtNumber, dailyReturnChart, formatSyntheticHistoryDate,
  Avatar: empty, VipBadge: empty, FavoriteButton: empty, CopyButton: empty, ArrowLeft: empty,
  Check: empty, BarChart3: empty, Users: empty, FollowerHistory: empty, TradingProfilePanel: empty, VerifiedBadge,
  MonthlyPerformanceLauncher: empty,
  ProfilePerformanceChart: ({ period }: { period: string }) => React.createElement('div', { 'data-yellow-period': period }),
};
const compiled = ts.transpileModule(`${declarations.join('\n')}\nexports.Profile=Profile;`, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exportsObject: Record<string, any> = {};
new Function('require', 'exports', ...Object.keys(deps), compiled)(requireFrontend, exportsObject, ...Object.values(deps));
const baseline = toResponse(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')));
const render = (trader = syntheticNazaraTrader(baseline), synthetic: typeof baseline | null = baseline) => {
  stateCursor = 0;
  return renderToStaticMarkup(React.createElement(exportsObject.Profile, { trader, synthetic, onBack: empty }));
};
const plain = (value: string) => value.replace(/\u00a0|\u202f/g, ' ');

test.each(PERIODS)('%s displays its selected-period statistics while the hero retains lifetime identity facts', period => {
  selectedPeriod = period;
  const before = JSON.stringify(baseline);
  const html = plain(render());
  const { JSDOM } = requireFrontend('jsdom');
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const panel = document.querySelector('.profile-metrics-panel')!;
  const value = (id: string) => panel.querySelector(`[data-metric="${id}"] strong`)!.textContent;
  const selected = selectSyntheticPeriod(baseline, period);
  expect(panel.getAttribute('data-period')).toBe(period);
  expect(panel.querySelector('h2')!.textContent).toBe('Эффективность');
  expect(value('roi')).toBe(formatPercent(selected.roi));
  expect(value('masterPnl')).toBe(plain(publicSignedUsdt(selected.pnl)));
  expect(value('followersPnl')).toBe(plain(publicSignedUsdt(selected.followerPnl)));
  expect(value('totalTrades')!.replace(/\s/g, '')).toBe(String(selected.totalTrades));
  expect(value('winRate')).toBe(`${selected.winRate.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
  expect(value('maxDrawdown')).toBe(`${selected.maximumDrawdown.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
  expect(panel.querySelectorAll('[data-metric]')).toHaveLength(16);
  const hero = document.querySelector('.trader-hero-metrics')!.textContent;
  expect(hero).toContain('7 200 000 USDT');
  expect(hero).toContain('5,79%');
  expect(html).toContain(`data-yellow-period="${period}"`);
  expect(html).toContain('Дневная доходность');
  expect(html).not.toMatch(/Средняя доходность|Average Return|plot.average|NaN|Nazara/);
  expect(html).toContain('<h1 class="trader-display-name">Nazar</h1>');
  expect(html).toContain('Доход Nazar');
  expect(html).not.toMatch(/\d[\d ]{3,},\d{2} USDT/);
  expect(JSON.stringify(baseline)).toBe(before);
  dom.window.close();
});

test.each([true, false, undefined])('actual profile shows identityVerified=%s only inline with its heading', identityVerified => {
  const trader = { ...syntheticNazaraTrader(baseline), identityVerified, verified: true };
  const before = JSON.stringify({ trader, baseline });
  const html = render(trader);
  expect((html.match(/class="copy-verified-badge"/g) ?? [])).toHaveLength(identityVerified === true ? 1 : 0);
  if (identityVerified === true) {
    expect(html).toMatch(/<h1 class="trader-display-name">Nazar<svg class="copy-verified-badge"[\s\S]*?<\/svg><\/h1>/);
    expect(html).toContain('fill="#1d9bf0"');
  }
  expect(html.match(/<div class="profile-avatar-wrap">[\s\S]*?<\/div>/)?.[0]).not.toContain('copy-verified-badge');
  expect(html).not.toContain('class="verified-badge"');
  expect(JSON.stringify({ trader, baseline })).toBe(before);
});

test('public name ignores stale legacy response names without renaming identifiers', () => {
  expect(nazarTrader.name).toBe('Nazar');
  expect(baseline.trader.name).toBe('Nazar');
  expect(syntheticNazaraTrader({ ...baseline, trader: { ...baseline.trader, name: 'Nazara' } }).name).toBe('Nazar');
});

test('USDT grouping, signs and small amounts are presentation only', () => {
  const before = JSON.stringify(baseline);
  expect(plain(publicSignedUsdt(1_113_907.03))).toBe('+1 113 907 USDT');
  expect(plain(publicSignedUsdt(-1_113_907.03))).toBe('−1 113 907 USDT');
  expect(plain(publicUsdtNumber(1000.49))).toBe('1 000');
  expect(publicUsdtNumber(999.49)).toBe('999,49');
  expect(publicUsdtNumber(null)).toBe('—');
  expect(publicSignedUsdt(NaN)).toBe('—');
  baseline.trades.forEach(trade => publicSignedUsdt(trade.netPnl));
  expect(baseline.trades.some(trade => trade.netPnl !== Math.round(trade.netPnl))).toBe(true);
  expect(JSON.stringify(baseline)).toBe(before);
});

test('actual histogram markup uses the same uncapped signed geometry and canonical tooltips', () => {
  selectedPeriod = 'ALL';
  const html = render();
  const data = selectSyntheticPeriod(baseline, 'ALL');
  const plot = dailyReturnChart(data.daily, data.methodology);
  const loss = plot.bars.filter(bar => bar.returnPct < 0);
  const rects = [...html.matchAll(/<rect[^>]*class="daily-loss"[^>]*><title>(.*?)<\/title><\/rect>/g)];
  expect(rects).toHaveLength(loss.length);
  loss.forEach((bar, index) => {
    expect(rects[index][0]).toContain(`height="${bar.height}"`);
    expect(rects[index][0]).toContain(`${bar.date}: ${bar.returnPct.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
  });
  const scale = plot.bars.find(bar => bar.returnPct > 0)!;
  loss.forEach(bar => expect(bar.height / Math.abs(bar.returnPct)).toBeCloseTo(scale.height / scale.returnPct, 10));
});
