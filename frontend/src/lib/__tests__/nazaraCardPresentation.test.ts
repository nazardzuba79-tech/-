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
import { VerifiedBadge } from '../../../test-utils/verifiedBadge';
import { isModeledTraderData } from '../modeledCopyData';
import { restoreCopyButtonDepositUx } from '../../../test-utils/copyDepositUx';

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
  MiniPerformanceChart: empty, Users: empty, Check: empty, ChevronRight: empty, VerifiedBadge,
  isModeledTraderData,
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

  test('VIP remains independent and identity verification never inherits the static catalogue flag', () => {
    expect(render('ALL')).not.toContain('aria-label="Верифицирован"');
    expect(render('ALL', { ...trader, identityVerified: true })).toContain('aria-label="Верифицирован"');
    const plain = render('ALL', { ...trader, vip: false, verified: false });
    expect(plain).not.toContain('vip-badge');
    expect(plain).not.toContain('aria-label="Верифицирован"');
    expect(render('ALL')).not.toMatch(/#1|лучший в мире|гарантирован/i);
  });

  test.each([true, false, undefined])('the real card renders identityVerified=%s beside the name, never over the avatar', identityVerified => {
    const html = render('ALL', { ...trader, verified: true, identityVerified });
    expect((html.match(/class="copy-verified-badge"/g) ?? [])).toHaveLength(identityVerified === true ? 1 : 0);
    if (identityVerified === true) {
      expect(html).toMatch(/<div class="nazara-name trader-display-name"><h3>Nazar<\/h3><svg class="copy-verified-badge"/);
      expect(html).toContain('fill="#1d9bf0"');
      expect(html).toContain('stroke="#fff"');
    }
    expect(html.match(/<div class="avatar-wrap">[\s\S]*?<\/div>/)?.[0]).not.toContain('copy-verified-badge');
    expect(html).not.toContain('class="verified-badge"');
  });

  test('ordinary marketplace cards use the same real inline SVG, without hardcoded flagship names', () => {
    const ordinary = marketplaceTraders.find(item => item.id !== nazarTrader.id)!;
    const html = render('90D', { ...ordinary, name: 'Renamed trader', identityVerified: true });
    expect(html).toMatch(/<div class="trader-display-name"><h3>Renamed trader<\/h3><svg class="copy-verified-badge"/);
    expect((html.match(/class="copy-verified-badge"/g) ?? [])).toHaveLength(1);
    expect(render('90D', { ...ordinary, verified: true, identityVerified: undefined })).not.toContain('copy-verified-badge');
  });

  test('Nazar VIP and the real verified badge share the name row, without a second status line', () => {
    const html = render('90D', { ...trader, identityVerified: true });
    expect(html).toMatch(/class="nazara-name trader-display-name"><h3>Nazar<\/h3><svg[\s\S]*?<\/svg><span class="vip-badge">VIP<\/span><\/div>/);
    expect(html).not.toContain('nazara-status');
    expect((html.match(/class="vip-badge"/g) ?? [])).toHaveLength(1);
    expect(render('90D', { ...trader, vip: false })).not.toContain('vip-badge');
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
  CopyButton: '1bddd664b4399d46c990ac64e9fda6bcb441c0db17f3c5a8670ccebbf5d49670',
  MetricsPanel: '584b60a9d224f8194e0450717490a62a80c3732ec5790852e55ff3b9980a7053',
  ProfilePerformanceChart: '68921d09f3d5a0e24c53e553c89487462f7b0b51a2c1453ce9fc1dd6d19091fe',
  MiniPerformanceChart: 'e2ea6405405bd0ff8e3f5058eacb2a37e32a518b7fba34e6fc0029d5d51215a8',
}))('%s remains byte-equivalent to approved V8', (name, hash) => {
  // CopyButton's fingerprint includes the unavailable Ksenia fee guard.
  // Strip only the added Ksenia chart-unavailable guard so the historical
  // ProfilePerformanceChart failure remains visible, rather than blessing it.
  // The only mini-chart change is admitting Ksenia's separate ledger. Strip
  // that additive condition to compare all approved Nazar geometry verbatim.
  const original = name === 'CopyButton' ? restoreCopyButtonDepositUx(body(name)) : body(name);
  const renderer = original.replace(" || trader.id === 'VX-KSENIA'", '').replace(" && trader.id !== 'VX-KSENIA'", '')
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

test('copy-card polish retains disabled/Following states and uses scoped, readable desktop/mobile styles', () => {
  const css = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/CopyTradingRefinement.css'), 'utf8');
  expect(css).toMatch(/\.trader-card-nazara \.button-copy:not\(:disabled\):not\(\.button-copy-active\)\s*\{[^}]*color: #241900;[^}]*background: linear-gradient/);
  expect(css).toMatch(/\.button-copy:focus-visible[\s\S]*?outline: 2px solid #f6ca6a/);
  expect(css).toContain('.button-copy-active:not(:disabled)');
  expect(css).toContain('.button-copy:disabled');
  const polish = css.split('/* Owner-requested card polish only;')[1].split('@media (hover: hover)')[0];
  expect(polish).not.toMatch(/profile-view|mini-performance-chart|mini-chart|opacity:|pointer-events:/);
  expect(polish).toContain('width: min(1440px, calc(100vw - 64px))');
  expect(polish).toContain('@media (max-width: 600px)');
  expect(polish).toContain('font-size: 11px; line-height: 1.5; text-transform: none; color: #bbc1cb');
  // Exact profile styling from production 9635e53: not an updated visual target.
  const normalized = css.replace(/\r\n/g, '\n');
  expect(createHash('sha256').update(normalized.slice(normalized.indexOf('.copytrading-bolt-root.profile-view {'))).digest('hex')).toBe('0a00205098d3db61e20e7e729e78d79bd6c66e3ba9e09eeae60553b4b7f78f38');
});
