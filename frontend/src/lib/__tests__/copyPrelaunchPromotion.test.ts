import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { kseniaTrader } from '../kseniaCopyTrading';
import { VerifiedBadge } from '../../../test-utils/verifiedBadge';
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
const notice = evaluate('src/components/CopyTradingNotice.tsx', {
  '../lib/i18n': { useLanguage: () => ({ lang: language }) },
});
const { ReviewDisclosure } = evaluate('src/components/ReviewDisclosure.tsx', { './CopyTradingNotice': notice });

test.each(['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'])('one contextual Copy notice replaces only redundant product labels in %s', lang => {
  language = lang;
  const repeated = React.createElement(ReviewDisclosure, { neutral: React.createElement('p', null, 'Neutral product information') },
    React.createElement('p', null, 'Demonstration catalogue'));
  const redundant = React.createElement(ReviewDisclosure, null, 'Repeated modeled-results explanation');
  const html = renderToStaticMarkup(React.createElement(notice.CopyTradingNoticeScope, null,
    React.createElement('main', null, repeated, redundant, React.createElement('button', null, 'Copy'))));
  expect(Object.keys(notice.COPY_TRADING_NOTICE_COPY).sort()).toEqual(['en', 'es', 'hi', 'ja', 'ko', 'ru', 'zh']);
  expect(typeof notice.COPY_TRADING_NOTICE_COPY[lang]).toBe('string');
  expect(notice.COPY_TRADING_NOTICE_COPY[lang].trim().length).toBeGreaterThan(20);
  expect((html.match(/class="copy-trading-notice"/g) ?? [])).toHaveLength(1);
  expect((html.match(/data-copy-trading-notice/g) ?? [])).toHaveLength(1);
  expect(html).toContain(notice.COPY_TRADING_NOTICE_COPY[lang]);
  expect(html).not.toMatch(/voltex-prelaunch|DEMO \/ PRE-LAUNCH|--prelaunch-notice-height/);
  expect(html).toContain('Neutral product information');
  expect(html).not.toContain('Demonstration catalogue');
  expect(html).not.toContain('Repeated modeled-results explanation');
  expect(html).toContain('<button>Copy</button>');
  // A standalone profile must still fail open if its contextual notice scope
  // is absent; duplicate suppression never silently removes all disclosure.
  expect(renderToStaticMarkup(repeated)).toContain('Demonstration catalogue');
  expect(renderToStaticMarkup(redundant)).toBe('Repeated modeled-results explanation');
});

test('notice is Copy-only, non-sticky, cannot be dismissed, and does not gate auth or routes', () => {
  const app = source('src/App.tsx');
  expect(app).not.toMatch(/PrelaunchApplication|PrelaunchNotice|CopyTradingNotice|voltex-prelaunch/);
  expect(existsSync(resolve(frontend, 'src/components/PrelaunchNotice.tsx'))).toBe(false);
  expect(existsSync(resolve(frontend, 'src/components/prelaunchNotice.css'))).toBe(false);
  const page = source('src/pages/CopyTradingPage.tsx');
  expect((page.match(/<CopyTradingNoticeScope>/g) ?? [])).toHaveLength(1);
  expect((page.match(/<\/CopyTradingNoticeScope>/g) ?? [])).toHaveLength(1);
  expect(page.indexOf('<CopyTradingNoticeScope>')).toBeLessThan(page.indexOf('<CopyEligibilityProvider'));
  expect(page.indexOf('</CopyTradingNoticeScope>')).toBeGreaterThan(page.indexOf('</CopyEligibilityProvider>'));
  expect(page.indexOf('<CopyTradingNoticeScope>')).toBeLessThan(page.indexOf('<Marketplace '));
  expect(page.indexOf('</CopyTradingNoticeScope>')).toBeGreaterThan(page.indexOf('<Profile '));
  expect(source('src/components/CopyTradingNotice.tsx')).not.toMatch(/localStorage|sessionStorage|isAdmin|pathname|setTimeout|onClick|ResizeObserver/);
  const css = source('src/components/copyTradingNotice.css');
  expect(css).not.toMatch(/display:\s*none|opacity:\s*0|visibility:\s*hidden|position:\s*(?:fixed|sticky)|prelaunch-notice-height|global-header|nav-mobile-menu/);
  expect(css).toContain('.copytrading-bolt-root');
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
});
