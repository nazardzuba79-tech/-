import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';

const root = resolve(__dirname, '../../..');
const req = createRequire(resolve(root, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const source = readFileSync(resolve(root, 'src/components/ReviewDisclosure.tsx'), 'utf8');
function render(mode: string, neutral?: unknown) {
  const out: any = {};
  expect(source).not.toContain('import.meta.env');
  const code = ts.transpileModule(source.replace('import.meta.env.MODE', JSON.stringify(mode)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('exports', code)(out);
  return renderToStaticMarkup(React.createElement(out.ReviewDisclosure, { neutral }, React.createElement('p', null, 'synthetic disclosure')));
}
test('review removes the entire duplicate paragraph with no empty DOM or spacing node', () => {
  expect(render('review')).toBe('');
  expect(render('review', React.createElement('p', null, 'Neutral methodology'))).toBe('<p>Neutral methodology</p>');
});
test.each(['production', 'development'])('%s cannot restore the old fallback disclosure', mode => {
  expect(render(mode)).toBe('');
  expect(render(mode, React.createElement('p', null, 'Neutral methodology'))).toBe('<p>Neutral methodology</p>');
});
test('all seven homepage translations remain behind the same removed review element', () => {
  const homepage = readFileSync(resolve(root, 'src/pages/home/HomeCopyTrading.tsx'), 'utf8');
  expect(homepage).toMatch(/<ReviewDisclosure><p[^>]*>\{t\('home.copy.disclaimer'\)\}<\/p><\/ReviewDisclosure>/);
  const dictionaries = readFileSync(resolve(root, 'src/lib/i18n.tsx'), 'utf8');
  expect(dictionaries.match(/'home.copy.disclaimer':/g)).toHaveLength(7);
  expect(homepage.match(/<ReviewModeledLabel modeled=/g)).toHaveLength(2);
});

const modeledSource = readFileSync(resolve(root, 'src/components/ReviewModeledLabel.tsx'), 'utf8');
function renderModeledLabel(lang: string, modeled: unknown) {
  const out: any = {};
  expect(modeledSource).not.toContain('import.meta.env.MODE');
  const code = ts.transpileModule(modeledSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', code)((id: string) => {
    if (id === '../lib/i18n') return { useLanguage: () => ({ lang }) };
    return req(id);
  }, out);
  return renderToStaticMarkup(React.createElement(out.ReviewModeledLabel, { modeled }));
}

const labels = {
  ru: 'Модельные данные', en: 'Modeled data', zh: '模拟数据',
  es: 'Datos modelados', hi: 'मॉडल किए गए डेटा', ja: 'モデル化データ', ko: '모델링 데이터',
};
test.each(Object.entries(labels))('actual review label renders concise local provenance in %s', (lang, label) => {
  expect(renderModeledLabel(lang, true)).toBe(`<small class="review-modeled-label">${label}</small>`);
});
test.each(Object.keys(labels))('%s real/missing source has no label or spacing placeholder in any environment', lang => {
  for (const modeled of [false, undefined, null, 'true', 1]) expect(renderModeledLabel(lang, modeled)).toBe('');
});

test('tiny source-aware labels accompany actual figures, never the whole grid or a chart renderer', () => {
  const components = readFileSync(resolve(root, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8');
  const parsed = ts.createSourceFile('components.tsx', components, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = parsed.statements.filter(ts.isFunctionDeclaration);
  expect(components.match(/<ReviewModeledLabel modeled=/g)).toHaveLength(3);
  for (const name of ['MarketplaceHero', 'TraderCard', 'Profile']) {
    const declaration = functions.find(fn => fn.name?.text === name);
    expect(declaration).toBeDefined();
    expect(declaration!.getText(parsed).match(/<ReviewModeledLabel modeled=/g)).toHaveLength(1);
  }
  for (const name of ['Marketplace', 'MetricsPanel', 'MiniPerformanceChart', 'ProfilePerformanceChart', 'DailyReturnChart']) {
    expect(functions.find(fn => fn.name?.text === name)!.getText(parsed)).not.toContain('ReviewModeledLabel');
  }
  const profile = functions.find(fn => fn.name?.text === 'Profile')!.getText(parsed);
  // Persistent profile-level provenance remains present on both Statistics and
  // Trades; no math/chart component receives the presentation-only addition.
  const tabsAt = profile.indexOf('<nav className="profile-primary-tabs"');
  expect(tabsAt).toBeGreaterThan(0);
  expect(profile.indexOf('<ReviewModeledLabel modeled=')).toBeLessThan(tabsAt);
  expect(profile).toContain('modeled={isModeledTraderData(trader, liveSynthetic)}');
  expect(components).toContain('modeled={isModeledTraderData(trader, synthetic)}');
  expect(components).toContain('map(item => preserveModeledSource(item, { ...item, drawdown:');
});

test('review shell has neither top notice nor a reserved-height offset; local label styles remain Copy-scoped', () => {
  const shell = readFileSync(resolve(root, 'src/review/main.tsx'), 'utf8');
  const css = readFileSync(resolve(root, 'src/review/review.css'), 'utf8');
  expect(shell).not.toMatch(/review-notice|ISOLATED VISUAL REVIEW|VOLTEX · REVIEW|Copy Trading figures are synthetic|useLocation/);
  expect(shell).not.toContain('<aside');
  expect(shell).not.toContain('ReviewModeledLabel');
  expect(css).not.toMatch(/review-notice|31px|100dvh|\.trade-terminal/);
  expect(css).toContain('.copytrading-bolt-root .review-modeled-label');
  expect(css).toContain('.copytrading-bolt-root.profile-view .review-modeled-label');
  expect(css).toContain('.vx-home #copy-trading .review-modeled-label');
  expect(css).not.toMatch(/position:\s*(fixed|sticky|absolute)|(?:^|[;{])\s*height:|padding-top:/);
  expect(shell).toContain('<Route path="/card" element={<CardPage reviewOnly />} />');
  expect(shell).toContain('This screen requires an authenticated staging backend');
});

// Exact normalized-byte fingerprints from the owner-requested 0a9c902 review
// baseline. Removing presentation banners must not open account APIs or change
// production entry points, deployment/build workflows, or isolated review policy.
function restoreReviewPresentationHook(source: string) {
  // The separately approved synthetic-session replay opts in only at the
  // Nazar build/runtime snapshot. Preserve the original config hash after
  // reversing these exact additions; no proxy, CSP or write guard is masked.
  const replacements: [string, string][] = [
    ["import { REVIEW_SYNTHETIC_STATE_ID } from '../src/services/copyTrading/reviewSyntheticHistory';", "import { createReviewSyntheticState, REVIEW_SYNTHETIC_STATE_ID } from '../src/services/copyTrading/reviewSyntheticHistory';"],
    ["import { createNazarPresentationState, NAZAR_PRESENTATION_REVISION } from '../src/services/copyTrading/nazarPresentation';\n", ''],
    ['const synthetic = createNazarPresentationState(new Date());', 'const synthetic = createReviewSyntheticState(new Date());'],
    ['version: synthetic.version, presentationRevision: NAZAR_PRESENTATION_REVISION,', 'version: synthetic.version,'],
    ['const calendar = createReviewCalendarClock(undefined, createNazarPresentationState);', 'const calendar = createReviewCalendarClock();'],
  ];
  for (const [from, to] of replacements) {
    expect(source.split(from)).toHaveLength(2);
    source = source.replace(from, to);
  }
  return source;
}

test.each(Object.entries({
  'src/lib/reviewPolicy.ts': 'c8da1f077c0048d574fefde081c71839ae186380f01500b0a754c59db11cc341',
  'src/lib/api.ts': 'e0a6aab944a153263655312931ea869066ab92c024db687d1d4ba7f7bcc47932',
  'vite.review.config.ts': 'aac9d1df9060657fccd6616fe950180dc05f4046b4c5fcd22cf5e974a652a541',
  'scripts/workflow.mjs': 'b7410cc6194920e39ce14187190dfa4ef1d8dec685bd7d8808c1afbcaae7bda4',
  '../.github/workflows/android-build.yml': '4b30aef5b8d3419967bc34fe0afb93b438c27458b543f6322f555bf8f86951c0',
  'src/App.tsx': 'd35577d9e261e2fad189d1f65e32891a9afbddc35745966eb0286e0db89825c1',
  'src/main.tsx': '4d197f3765e5d8a5e315d35b73ed13799cd21279c477e0b9d422868fcfa3b525',
}))('%s remains exactly isolated from the banner removal', (file, hash) => {
  let contents = readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');
  if (file === 'vite.review.config.ts') contents = restoreReviewPresentationHook(contents);
  expect(createHash('sha256').update(contents).digest('hex')).toBe(hash);
});

test('homepage cards, data, charts and layout preserve the exact starting implementation', () => {
  let homepage = readFileSync(resolve(root, 'src/pages/home/HomeCopyTrading.tsx'), 'utf8').replace(/\r\n/g, '\n');
  for (const addition of [
    "import { ReviewModeledLabel } from '../../components/ReviewModeledLabel';\n",
    "import { isModeledAggregate, isModeledTraderData } from '../../lib/modeledCopyData';\n",
    '          <ReviewModeledLabel modeled={isModeledTraderData(trader)} />\n',
    '                <ReviewModeledLabel modeled={isModeledAggregate(HOME_COPY_TRADERS)} />\n',
  ]) {
    expect(homepage.split('\n').filter(line => line + '\n' === addition)).toHaveLength(1);
    homepage = homepage.replace('\n' + addition, '\n');
  }
  expect(homepage).not.toContain('ReviewModeledLabel');
  expect(createHash('sha256').update(homepage).digest('hex')).toBe('8902f401ec8c8452c86fc5a4b616f7b7a4e45588763926b076011df78823f200');
});
