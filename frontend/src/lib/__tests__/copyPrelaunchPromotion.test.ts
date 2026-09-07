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
const { ReviewDisclosure } = evaluate('src/components/ReviewDisclosure.tsx');

test('removed disclosure components have no imports, mounts or fallback content', () => {
  for (const file of ['src/components/ModeledDataLabel.tsx', 'src/components/modeledDataLabel.css', 'test-utils/modeledDataLabel.ts',
    'src/components/PrelaunchNotice.tsx', 'src/components/prelaunchNotice.css']) {
    expect(existsSync(resolve(frontend, file))).toBe(false);
  }
  expect(source('src/pages/copy-trading-bolt/components.tsx')).not.toContain('ModeledDataLabel');
  expect(source('src/App.tsx')).not.toMatch(/PrelaunchApplication|PrelaunchNotice|CopyTradingNotice/);
  const repeated = React.createElement(ReviewDisclosure, { neutral: React.createElement('p', null, 'Neutral product information') },
    React.createElement('p', null, 'Demonstration catalogue'));
  expect(renderToStaticMarkup(repeated)).toBe('');
  expect(renderToStaticMarkup(React.createElement('main', null, repeated, React.createElement('button', null, 'Copy'))))
    .toBe('<main><button>Copy</button></main>');
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
