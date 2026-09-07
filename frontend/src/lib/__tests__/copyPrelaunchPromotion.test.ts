import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { kseniaTrader } from '../kseniaCopyTrading';
import { VerifiedBadge } from '../../../test-utils/verifiedBadge';
import { isModeledResponse, isModeledTraderData } from '../modeledCopyData';
import { marketplaceTraders } from '../../pages/copy-trading-bolt/traders';
import { createKseniaReviewState, kseniaReviewResponse } from '../../../../src/services/copyTrading/canonical/kseniaReview';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const source = (path: string) => readFileSync(resolve(frontend, path), 'utf8');
let language = 'ru';
function evaluate(path: string, overrides: Record<string, unknown> = {}) {
  const code = ts.transpileModule(source(path), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const output: Record<string, any> = {};
  const load = (name: string) => name.endsWith('.css') ? {} : overrides[name] ?? req(name);
  new Function('exports', 'require', code)(output, load);
  return output;
}
const label = evaluate('src/components/ModeledDataLabel.tsx', {
  '../lib/i18n': { useLanguage: () => ({ lang: language }) },
});
const { ReviewDisclosure } = evaluate('src/components/ReviewDisclosure.tsx');

test.each([
  ['ru', 'Модельные данные'], ['en', 'Modeled data'], ['zh', '模拟数据'],
  ['es', 'Datos modelados'], ['hi', 'मॉडल किए गए डेटा'], ['ja', 'モデルデータ'], ['ko', '모델 데이터'],
])('source-aware label is local to its figures and neutral product copy survives in %s', (lang, text) => {
  language = lang;
  const repeated = React.createElement(ReviewDisclosure, { neutral: React.createElement('p', null, 'Neutral product information') },
    React.createElement('p', null, 'Demonstration catalogue'));
  const redundant = React.createElement(ReviewDisclosure, null, 'Repeated modeled-results explanation');
  const modeled = isModeledResponse({ simulation: { seed: 1, simulatedAt: '2026-09-06T12:00:00Z', mode: 'REAL_TIME' } });
  const html = renderToStaticMarkup(React.createElement('main', null,
    React.createElement(label.ModeledDataLabel, { modeled }), repeated, redundant, React.createElement('button', null, 'Copy')));
  expect(Object.keys(label.MODELED_DATA_LABEL).sort()).toEqual(['en', 'es', 'hi', 'ja', 'ko', 'ru', 'zh']);
  expect(label.MODELED_DATA_LABEL[lang]).toBe(text);
  expect(html).toContain(`<small class="modeled-data-label">${text}</small>`);
  expect((html.match(/class="modeled-data-label"/g) ?? [])).toHaveLength(1);
  expect(html).not.toMatch(/copy-trading-notice|data-copy-trading-notice|voltex-prelaunch|DEMO \/ PRE-LAUNCH|--prelaunch-notice-height/);
  expect(html).toContain('Neutral product information');
  expect(html).not.toContain('Demonstration catalogue');
  expect(html).not.toContain('Repeated modeled-results explanation');
  expect(html).toContain('<button>Copy</button>');
  // No context or wrapper is needed: only neutral information remains.
  expect(renderToStaticMarkup(repeated)).toBe('<p>Neutral product information</p>');
  expect(renderToStaticMarkup(redundant)).toBe('');
  const fixture = marketplaceTraders.find(trader => trader.id !== 'VX-001' && trader.id !== 'VX-KSENIA')!;
  expect(renderToStaticMarkup(React.createElement(label.ModeledDataLabel, {
    modeled: isModeledTraderData(fixture),
  }))).toBe(`<small class="modeled-data-label">${text}</small>`);
  for (const value of [undefined, false, isModeledResponse(null), isModeledResponse({ provenance: 'LIVE' }),
    isModeledTraderData(fixture, { trader: { id: fixture.id }, provenance: 'REAL_EXECUTION' })]) {
    expect(renderToStaticMarkup(React.createElement(label.ModeledDataLabel, { modeled: value }))).toBe('');
  }
});

test('no global/contextual banner remains; tiny labels cannot gate routes, eligibility or auth', () => {
  const app = source('src/App.tsx');
  expect(app).not.toMatch(/PrelaunchApplication|PrelaunchNotice|CopyTradingNotice|voltex-prelaunch/);
  expect(existsSync(resolve(frontend, 'src/components/PrelaunchNotice.tsx'))).toBe(false);
  expect(existsSync(resolve(frontend, 'src/components/prelaunchNotice.css'))).toBe(false);
  expect(existsSync(resolve(frontend, 'src/components/CopyTradingNotice.tsx'))).toBe(false);
  expect(existsSync(resolve(frontend, 'src/components/copyTradingNotice.css'))).toBe(false);
  const page = source('src/pages/CopyTradingPage.tsx');
  expect(page).not.toMatch(/CopyTradingNoticeScope|PrelaunchApplication/);
  expect(source('src/components/ModeledDataLabel.tsx')).not.toMatch(/localStorage|sessionStorage|isAdmin|pathname|setTimeout|onClick|ResizeObserver/);
  expect(source('src/components/ReviewDisclosure.tsx')).not.toMatch(/createContext|useContext|CopyTradingNotice/);
  const css = source('src/components/modeledDataLabel.css');
  expect(css).not.toMatch(/display:\s*none|opacity:\s*0|visibility:\s*hidden|position:\s*(?:fixed|sticky)|prelaunch-notice-height|global-header|nav-mobile-menu/);
  expect(css).toContain('.copytrading-bolt-root');
  expect(css).toContain('font-size: 10px');
  expect(css).not.toMatch(/padding:|border:|background:|(?:^|[;{]\s*)height:/);
});

test.each([0, -1, 19_999.99, 20_000, 20_000.01, 100_000, NaN, Infinity])('copy eligibility comes solely from the finite deposit threshold: %s', amount => {
  const { CopyEligibilityProvider } = evaluate('src/pages/copy-trading-bolt/CopyEligibilityContext.tsx');
  for (const isAdmin of [false, true]) {
    const node = CopyEligibilityProvider({ depositUsd: amount, isAdmin, children: null });
    expect(node.props.value.eligible).toBe(Number.isFinite(amount) && amount >= 20_000);
    expect(node.props.value.depositUsd).toBe(amount);
  }
});

test('normal API paths replace review-only sources without altering token or request behavior', () => {
  const api = source('src/lib/api.ts');
  expect(api).toContain("getNazarCopyTrading: () => request<SyntheticCopyTradingResponse>('/copy-trading/nazar')");
  expect(api).toContain("getKseniaCopyTrading: () => request<import('./kseniaCopyTrading').KseniaResponse>('/copy-trading/ksenia')");
  expect(api).toContain("('/copy-trading/identities')");
  expect(api).not.toMatch(/reviewReadPath|reviewMarketData|review-api|review-synthetic\.json|exchange-api-review/);
  const page = source('src/pages/CopyTradingPage.tsx');
  expect(page).toContain('api.getNazarCopyTrading()');
  expect(page).toContain('api.getKseniaCopyTrading()');
  expect(page).not.toMatch(/getSyntheticCopyTrading|advanceSimulation|resetSimulation|isAdmin|import\.meta\.env\.MODE/);
  expect(page).toContain('window.setInterval');
  expect(page).toContain('new Date().toISOString().slice(0, 10)');
});

test('owner media never falls back to a viewer or an unrelated administrator', () => {
  const context = source('src/pages/copy-trading-bolt/FeaturedAvatarContext.tsx');
  expect(context).not.toMatch(/getFeaturedTraderAvatar|getMe|getToken|useEffect/);
  const { FeaturedAvatarProvider } = evaluate('src/pages/copy-trading-bolt/FeaturedAvatarContext.tsx');
  expect(FeaturedAvatarProvider({ ownerAvatar: null, children: null }).props.value).toBeNull();
  expect(FeaturedAvatarProvider({ ownerAvatar: 'data:image/png;base64,dGVzdA==', children: null }).props.value).toBe('data:image/png;base64,dGVzdA==');
  const page = source('src/pages/CopyTradingPage.tsx');
  expect(page).toContain('ownerAvatar={identities.find(i => i.traderId === nazarTrader.id)?.avatarUrl ?? null}');
  expect(page).toContain('withStrategyIdentityVerification(');
  expect(page).toContain('syntheticNazaraTrader(synthetic), identities.find(i => i.traderId === nazarTrader.id)');
  expect(page).not.toMatch(/identityVerified:\s*true/);
});

test('Ksenia identity projection uses only the owner photo and factual KYC state', () => {
  const data = kseniaReviewResponse(createKseniaReviewState());
  const before = JSON.stringify(data);
  const withoutIdentity = kseniaTrader(data);
  expect(withoutIdentity.name).toBe('Ksenia');
  expect(withoutIdentity.verified).toBe(false);
  expect(withoutIdentity.identityVerified).toBe(false);
  expect(renderToStaticMarkup(React.createElement(VerifiedBadge, { verified: withoutIdentity.identityVerified }))).toBe('');
  expect(withoutIdentity.ownerAvatarUrl).toBeNull();
  const withIdentity = kseniaTrader(data, {
    traderId: 'VX-KSENIA', displayName: 'Ksenia', avatarUrl: 'data:image/png;base64,AAAA',
    avatarVersion: 'version', verified: false, premium: true,
  });
  expect(withIdentity.verified).toBe(false);
  expect(withIdentity.identityVerified).toBe(false);
  expect(renderToStaticMarkup(React.createElement(VerifiedBadge, { verified: withIdentity.identityVerified }))).toBe('');
  expect(withIdentity.ownerAvatarUrl).toBe('data:image/png;base64,AAAA');
  expect(withIdentity.roiAll).toBe(withoutIdentity.roiAll);
  expect(withIdentity.aum).toBe(withoutIdentity.aum);
  expect(isModeledTraderData(withIdentity, data)).toBe(true);
  expect(isModeledTraderData(withIdentity, { ...data, provenance: 'LIVE_API' })).toBe(false);
  expect(JSON.stringify(data)).toBe(before);
});
