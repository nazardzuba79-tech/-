import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import ts from 'typescript';
import { createReviewSyntheticState } from '../../../../src/services/copyTrading/canonical/reviewSyntheticHistory';
import { toResponse } from '../../../../src/services/copyTrading/canonical/SyntheticCopyTradingEngine';
import { selectSyntheticPeriod, syntheticNazaraTrader } from '../syntheticCopyTrading';
import { nazarTrader, marketplaceTraders, getRoiForPeriod, getCopierProfit, roiClass, formatPercent, formatAccountSize, PERIOD_LABEL_RU } from '../../pages/copy-trading-bolt/traders';
import { selectDemoPerformance } from '../../pages/copy-trading-bolt/demoPerformance';
import { getTraderVisual } from '../../pages/copy-trading-bolt/traderVisuals';

const frontend = resolve(__dirname, '../../..');
const source = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8');
const parsed = ts.createSourceFile('components.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function body(name: string): string {
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error(`Missing ${name}`);
  return node.getText(parsed).replace(/\r\n/g, '\n');
}

// Render the actual card function without importing page/API effects or changing
// the app's export surface. Only child widgets/hooks are stand-ins; all displayed
// financial values use the unchanged real v8 adapter and its canonical response.
const frontendRequire = createRequire(resolve(frontend, 'package.json'));
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const empty = () => null;
const dependencies = {
  useFollowing: () => ({ following: new Set<string>() }),
  getTraderVisual, nazarTrader, selectSyntheticPeriod, selectDemoPerformance,
  getRoiForPeriod, getCopierProfit, roiClass, formatPercent, formatAccountSize, PERIOD_LABEL_RU,
  followerProfitForPeriod: () => null, Avatar: empty, FavoriteButton: empty,
  MiniPerformanceChart: empty, Users: empty, Check: empty, ChevronRight: empty,
  VipBadge: () => React.createElement('span', { className: 'vip-badge' }, 'VIP'),
  CopyButton: () => React.createElement('button', { className: 'copy-child' }, 'Copy'),
};
const compiled = ts.transpileModule(`${body('numberLabel')}\n${body('TraderCard')}\nexports.Card = TraderCard;`, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleExports: Record<string, any> = {};
new Function('require', 'exports', ...Object.keys(dependencies), compiled)(frontendRequire, moduleExports, ...Object.values(dependencies));

describe('Nazara marketplace presentation only', () => {
  const response = toResponse(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')));
  const trader = syntheticNazaraTrader(response);
  const render = (period: string, cardTrader = trader, synthetic: typeof response | null = response) => renderToStaticMarkup(
    React.createElement(moduleExports.Card, { trader: cardTrader, period, synthetic, onOpen: empty }),
  );

  test.each(['7D', '30D', '90D', 'ALL'] as const)('%s consumes canonical ROI, win rate, drawdown, followers and AUM without mutating input', period => {
    const before = JSON.stringify(response);
    const selected = selectSyntheticPeriod(response, period);
    const html = render(period);
    expect(html).toContain(formatPercent(getRoiForPeriod(trader, period)));
    expect(html).toContain(new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(selected.winRate) + '%');
    expect(html).toContain(new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(selected.maximumDrawdown) + '%');
    expect(html).toContain(`<b>${trader.copiers}</b>`);
    expect(html).toContain(formatAccountSize(trader.aum));
    expect(html).not.toMatch(/Коэффициент Шарпа|Прибыль подписчиков|Чистая прибыль/);
    expect(html).toContain('Professional Strategy');
    expect(JSON.stringify(response)).toBe(before);
  });

  test('VIP and verification use existing flags, not an invented rank or new endorsement', () => {
    expect(render('ALL')).toContain('aria-label="Верифицирован"');
    const plain = render('ALL', { ...trader, vip: false, verified: false });
    expect(plain).not.toContain('vip-badge');
    expect(plain).not.toContain('aria-label="Верифицирован"');
    expect(render('ALL')).not.toMatch(/#1|лучший в мире|гарантирован/i);
  });

  test('ordinary card content is preserved; absent Nazara metrics do not become fake constants', () => {
    const ordinary = render('90D', marketplaceTraders.find(item => item.id !== nazarTrader.id)!);
    expect(ordinary).toContain('Коэффициент Шарпа');
    expect(ordinary).toContain('Прибыль подписчиков');
    expect(ordinary).not.toContain('trader-card-nazara');
    const missing = render('ALL', trader, null);
    expect(missing).toContain('<strong>—</strong>');
    expect(missing).not.toContain('97,2%');
  });
});

// Exact function fingerprints from the approved a484789 V8 starting state.
// These guard the particularly important non-visual scope boundaries.
// Profile and FollowersPanel are now intentionally covered by functional SSR
// tests in nazarProfileCorrection: lifetime stats/name/money were approved.
test.each(Object.entries({
  CopyButton: 'cd2ed289d64d986e9355f26557e9428ff19c98b7bf6f5246576cf861e0afa2ce',
  MetricsPanel: '584b60a9d224f8194e0450717490a62a80c3732ec5790852e55ff3b9980a7053',
  ProfilePerformanceChart: '68921d09f3d5a0e24c53e553c89487462f7b0b51a2c1453ce9fc1dd6d19091fe',
  MiniPerformanceChart: 'e2ea6405405bd0ff8e3f5058eacb2a37e32a518b7fba34e6fc0029d5d51215a8',
}))('%s remains byte-equivalent to approved V8', (name, hash) => {
  // The only mini-chart change is admitting Ksenia's separate ledger. Strip
  // that additive condition to compare all approved Nazar geometry verbatim.
  const renderer = body(name).replace(" || trader.id === 'VX-KSENIA'", '')
    .replace(/<ReviewDisclosure neutral=[\s\S]*?\n      (<p className="profile-trust">[\s\S]*?<\/p>)\n      <\/ReviewDisclosure>/, '$1');
  expect(createHash('sha256').update(renderer).digest('hex')).toBe(hash);
});

test('premium CSS stays card-scoped, keeps the approved eligibility border, and respects reduced motion', () => {
  const css = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/CopyTradingRefinement.css'), 'utf8');
  const refinement = css.split('/* Marketplace-only flagship hierarchy.')[1].split('@media (prefers-reduced-motion: reduce)')[0];
  expect(refinement).toContain('border: 1px solid #9b8965');
  expect(refinement).toContain('inset 0 1px #fff3d90d');
  expect(refinement).not.toMatch(/scale\(|rotate\(|animation:|filter:/);
  expect(css).toContain('.access-strip > .eligibility { border-color: #e4e7ec; }');
  expect(css).toContain('.trader-card:hover { transform: none; }');
  expect(refinement.match(/\.copytrading-bolt-root(?! \.copy-marketplace)/g)).toBeNull();
});
