import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { kseniaTrader } from '../kseniaCopyTrading';
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
const notice = evaluate('src/components/PrelaunchNotice.tsx', {
  '../lib/i18n': { useLanguage: () => ({ lang: language }) },
});
const { ReviewDisclosure } = evaluate('src/components/ReviewDisclosure.tsx', { './PrelaunchNotice': notice });

test.each(['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'])('one clear global notice replaces only redundant product labels in %s', lang => {
  language = lang;
  const repeated = React.createElement(ReviewDisclosure, { neutral: React.createElement('p', null, 'Neutral product information') },
    React.createElement('p', null, 'Demonstration catalogue'));
  const html = renderToStaticMarkup(React.createElement(notice.PrelaunchApplication, null,
    React.createElement('main', null, repeated, React.createElement('button', null, 'Copy'))));
  expect((html.match(/class="voltex-prelaunch-notice"/g) ?? [])).toHaveLength(1);
  expect(html).toContain('VOLTEX · DEMO / PRE-LAUNCH');
  expect(html).toContain(notice.PRELAUNCH_COPY[lang]);
  expect(html).toContain('Neutral product information');
  expect(html).not.toContain('Demonstration catalogue');
  expect(html).toContain('<button>Copy</button>');
  // If the global provider is accidentally removed, individual disclosure
  // remains visible rather than silently hiding the modeled-data context.
  expect(renderToStaticMarkup(repeated)).toContain('Demonstration catalogue');
});

test('notice is application-wide, cannot be dismissed, and does not gate auth or routes', () => {
  const app = source('src/App.tsx');
  expect(app.indexOf('<PrelaunchApplication>')).toBeLessThan(app.indexOf('<Routes>'));
  expect(app.indexOf('</PrelaunchApplication>')).toBeGreaterThan(app.indexOf('</Routes>'));
  expect(source('src/components/PrelaunchNotice.tsx')).not.toMatch(/localStorage|sessionStorage|isAdmin|pathname|setTimeout|onClick/);
  expect(source('src/components/prelaunchNotice.css')).not.toMatch(/display:\s*none|opacity:\s*0|visibility:\s*hidden/);
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
  expect(page).toContain('verified: identities.find(i => i.traderId === nazarTrader.id)?.verified ?? false');
});

test('Ksenia identity projection uses only the owner photo and factual KYC state', () => {
  const data = kseniaReviewResponse(createKseniaReviewState());
  const withoutIdentity = kseniaTrader(data);
  expect(withoutIdentity.name).toBe('Ksenia');
  expect(withoutIdentity.verified).toBe(false);
  expect(withoutIdentity.ownerAvatarUrl).toBeNull();
  const withIdentity = kseniaTrader(data, {
    traderId: 'VX-KSENIA', displayName: 'Ksenia', avatarUrl: 'data:image/png;base64,AAAA',
    avatarVersion: 'version', verified: false, premium: true,
  });
  expect(withIdentity.verified).toBe(false);
  expect(withIdentity.ownerAvatarUrl).toBe('data:image/png;base64,AAAA');
  expect(withIdentity.roiAll).toBe(withoutIdentity.roiAll);
  expect(withIdentity.aum).toBe(withoutIdentity.aum);
});
