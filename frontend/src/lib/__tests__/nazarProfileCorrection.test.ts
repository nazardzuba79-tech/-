import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { createReviewSyntheticState } from '../../../../src/services/copyTrading/reviewSyntheticHistory';
import { toResponse } from '../../../../src/services/copyTrading/SyntheticCopyTradingEngine';
import { selectSyntheticPeriod, syntheticNazaraTrader, formatSyntheticHistoryDate } from '../syntheticCopyTrading';
import { publicSignedUsdt, publicUsdtNumber } from '../copyTradingMoney';
import { dailyReturnChart } from '../dailyReturnChart';
import { isModeledTraderData } from '../modeledCopyData';
import { nazarTrader, formatPercent, formatAccountSize, roiClass, PERIODS } from '../../pages/copy-trading-bolt/traders';

const frontend = resolve(__dirname, '../../..');
const requireFrontend = createRequire(resolve(frontend, 'package.json'));
const React = requireFrontend('react');
const { renderToStaticMarkup } = requireFrontend('react-dom/server');
const source = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8');
const parsed = ts.createSourceFile('components.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['numberLabel', 'signedUsd', 'unsignedPercent', 'durationLabel', 'MetricsPanel', 'DailyReturnChart', 'FollowersPanel', 'Profile'];
const declarations = names.map(name => {
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error(`Missing real component ${name}`);
  return node.getText(parsed);
});
let selectedPeriod = 'ALL';
const empty = () => null;
// Actual profile/readout/follower/histogram markup, with only unrelated children
// stubbed. The period state is selected explicitly; data uses the real adapter.
const deps = {
  ReviewDisclosure: ({ children }: { children: unknown }) => children,
  // This suite isolates finance markup; actual local labels have separate SSR coverage.
  ReviewModeledLabel: empty,
  isModeledTraderData,
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => [initial === '90D' ? selectedPeriod : initial, empty],
  selectSyntheticPeriod, nazarTrader, formatPercent, roiClass, formatAccountSize, PERIODS,
  publicSignedUsdt, publicUsdtNumber, dailyReturnChart, formatSyntheticHistoryDate,
  Avatar: empty, VipBadge: empty, FavoriteButton: empty, CopyButton: empty, ArrowLeft: empty,
  Check: empty, BarChart3: empty, Users: empty, FollowerHistory: empty, TradingProfilePanel: empty,
  ProfilePerformanceChart: ({ period }: { period: string }) => React.createElement('div', { 'data-yellow-period': period }),
};
const compiled = ts.transpileModule(`${declarations.join('\n')}\nexports.Profile=Profile;`, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exportsObject: Record<string, any> = {};
new Function('require', 'exports', ...Object.keys(deps), compiled)(requireFrontend, exportsObject, ...Object.values(deps));
const baseline = toResponse(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')));
const render = () => renderToStaticMarkup(React.createElement(exportsObject.Profile, {
  trader: syntheticNazaraTrader(baseline), synthetic: baseline, onBack: empty,
}));
const plain = (value: string) => value.replace(/\u00a0|\u202f/g, ' ');

test.each(PERIODS)('%s keeps lifetime statistics separate from the selected chart period', period => {
  selectedPeriod = period;
  const html = plain(render());
  const sidebar = html.split('<aside>')[1].split('</aside>')[0];
  expect(sidebar).toContain('ALL · SINCE INCEPTION');
  expect(sidebar).toContain('<span>Win Rate</span><strong>92,7%</strong>');
  expect(sidebar).toContain('<span>Total Trades</span><strong>471</strong>');
  expect(sidebar).toContain('<span>Max Drawdown</span><strong>5,79%</strong>');
  expect(sidebar).toContain('+4 711 027 USDT');
  expect(sidebar).not.toMatch(/Winning Trades|Losing Trades|Trading Days|Weekly Trades/);
  expect(html).toContain(`data-yellow-period="${period}"`);
  expect(html).toContain(formatPercent(selectSyntheticPeriod(baseline, period).roi));
  expect(html).toContain('Дневная доходность');
  expect(html).not.toMatch(/Средняя доходность|Average Return|Средний PnL|plot.average/);
  expect(html).toContain('<h1>Nazar</h1>');
  expect(html).toContain('Доход Nazar');
  expect(html).not.toMatch(/Nazara/);
  expect(html).toContain('7 200 000 USDT');
  expect(html).not.toMatch(/\d[\d ]{3,},\d{2} USDT/);
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
    expect(rects[index][0]).toContain(`${bar.date}: ${bar.returnPct.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`);
  });
  const scale = plot.bars.find(bar => bar.returnPct > 0)!;
  loss.forEach(bar => expect(bar.height / Math.abs(bar.returnPct)).toBeCloseTo(scale.height / scale.returnPct, 10));
});
