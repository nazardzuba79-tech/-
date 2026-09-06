import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';
import { getTraderVisual } from '../../pages/copy-trading-bolt/traderVisuals';
import { marketplaceTraders, nazarTrader } from '../../pages/copy-trading-bolt/traders';
import { createReviewSyntheticState } from '../../../../src/services/copyTrading/canonical/reviewSyntheticHistory';
import { toResponse } from '../../../../src/services/copyTrading/canonical/SyntheticCopyTradingEngine';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const source = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8').replace(/\r\n/g, '\n');
const ast = ts.createSourceFile('components.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const avatarNode = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'Avatar')!;
const contextSource = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/FeaturedAvatarContext.tsx'), 'utf8');
const contextAst = ts.createSourceFile('context.tsx', contextSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hook = contextAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'useFeaturedAvatar')!;
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}}).outputText;
const context = React.createContext(null);
const hookExports: any = {};
new Function('exports', 'useContext', 'FeaturedAvatarContext', compile(hook.getText(contextAst)))(hookExports, React.useContext, context);
const artExports: any = {};
new Function('exports', 'require', compile(readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/TraderAvatarArt.tsx'), 'utf8')))(
  artExports, (name: string) => name === './traderVisuals' ? { getTraderVisual } : req(name));
function component(useState = React.useState, useFeaturedAvatar = hookExports.useFeaturedAvatar) {
  const output: any = {};
  new Function('require', 'exports', 'useState', 'useFeaturedAvatar', 'getTraderVisual', 'nazarTrader', 'TraderAvatarArt',
    compile(avatarNode.getText(ast) + '\nexports.Avatar = Avatar;'))(
    req, output, useState, useFeaturedAvatar, getTraderVisual, nazarTrader, artExports.TraderAvatarArt);
  return output.Avatar;
}
const Avatar = component();
function render(trader: typeof nazarTrader, photo: string | null = null, large = false) {
  return renderToStaticMarkup(React.createElement(context.Provider, { value: photo }, React.createElement(Avatar, { trader, large })));
}

test('actual Avatar consumes FeaturedAvatarContext: owner photo wins at both sizes', () => {
  for (const large of [false, true]) {
    const html = render(nazarTrader, '/account-fixture/unchanged-owner-photo.webp', large);
    expect(html).toContain('src="/account-fixture/unchanged-owner-photo.webp"');
    expect(html).not.toContain('/copy-trading/avatars/');
    expect(html).not.toContain('<svg');
    expect(html).toContain('decoding="async"');
  }
  expect(nazarTrader.name).toBe('Nazar');
});

test('card/profile share one Avatar and identity, ignoring owner photo for fictional IDs', () => {
  expect(source).toContain('<Avatar trader={trader} />');
  expect(source).toContain('<Avatar trader={trader} large />');
  for (const trader of marketplaceTraders) {
    const small = render(trader, '/account-fixture/owner.webp');
    const large = render(trader, '/account-fixture/owner.webp', true);
    expect(small).toBe(large.replace('avatar-large', ''));
    expect(small).not.toContain('/account-fixture/');
    const visual = getTraderVisual(trader.id);
    if (visual.avatarSrc) expect(small).toContain('src="' + visual.avatarSrc + '"');
    else if (visual.mark) expect(small).toContain('<svg');
    else expect(small).toContain('>' + trader.initials + '</div>');
  }
});

test('actual onError removes broken image, retains geometry and retries changed owner URL', () => {
  let failed: string | null = null;
  let photo = '/account-fixture/owner.webp';
  const TestAvatar = component(() => [failed, (value: string) => { failed = value; }], () => photo);
  let element = TestAvatar({ trader: nazarTrader });
  expect(element.type).toBe('img');
  element.props.onError();
  element = TestAvatar({ trader: nazarTrader });
  expect(element.type).toBe('div');
  expect(element.props.children).toBe('N');
  expect(element.props.className).toContain('avatar avatar-gold');
  photo = '/account-fixture/new-owner.webp';
  expect(TestAvatar({ trader: nazarTrader }).props.src).toBe(photo);
  for (const trader of marketplaceTraders.filter(t => getTraderVisual(t.id).avatarSrc)) {
    failed = null;
    TestAvatar({ trader }).props.onError();
    const fallback = TestAvatar({ trader });
    expect(fallback.type).toBe('div');
    expect(fallback.props.className).toContain('avatar-art');
    expect(renderToStaticMarkup(fallback)).toContain('<svg');
    expect(renderToStaticMarkup(fallback)).not.toContain('<img');
  }
});

test('approved yellow chart, histogram, statistics, trades and hero stay source-identical before additive Ksenia wiring', () => {
  const digest = (s: string) => createHash('sha256').update(s).digest('hex');
  // Marketplace/Profile now accept a second canonical ledger. Keep strict
  // fingerprints of the unchanged renderers instead of freezing all wiring.
  for (const [name, hash] of Object.entries({
    ProfilePerformanceChart: '68921d09f3d5a0e24c53e553c89487462f7b0b51a2c1453ce9fc1dd6d19091fe',
    DailyReturnChart: '7460b3ad35cc7191ef47e99cb633c212d01afc6ad68b67b06fdd6eac17fef9a1',
    MetricsPanel: '584b60a9d224f8194e0450717490a62a80c3732ec5790852e55ff3b9980a7053',
    TradingProfilePanel: 'c076b5505d930e2802a6aed17b836b505f6ee5c7a96b1935d905472d6417dcd8',
    TradesPanel: 'f239e1748cbaefdca7c7bf693fee2150565bf5422d0df00dcb0e1c2e49bc5f49',
    MarketplaceHero: '6711f0146a0a1456b34a21fc6db3d3310c5a9344ab9b4295371455dc60db3258',
  })) {
    const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
    // Review-only duplicate-copy wrapper changes no approved chart rendering.
    const renderer = node.getText(ast).replace(/<ReviewDisclosure neutral=[\s\S]*?\n      (<p className="profile-trust">[\s\S]*?<\/p>)\n      <\/ReviewDisclosure>/, '$1');
    expect(digest(renderer)).toBe(hash);
  }
  for (const [file, hash] of Object.entries({
    // Explicitly approved inline blue identity badge; chart styling is unchanged.
    'src/pages/copy-trading-bolt/CopyTradingRefinement.css': 'f391f43bc96c58b2356b3e7590d931a232dc5af366eaab3677a7618462ae267b',
    'src/pages/copy-trading-bolt/traders.ts': '90e35a2b9d37ee079b94ebf37bcc10cdf211028f134d30ca59d53c304ad31aba',
    'src/pages/copy-trading-bolt/demoPerformance.ts': '1339781ee31f193dcd7f7fe4a5d8a9257383cf4e0c8a29ffca69101d7cb6bead',
  })) {
    const contents = readFileSync(resolve(frontend, file), 'utf8').replace(/\r\n/g, '\n');
    // Only optional TypeScript owner-media/identity fields were added to Trader;
    // every runtime business value and fictional avatar mapping stays exact.
    expect(digest(contents
      .replace('  /** Sanitized strategy-owner profile media; never catalogue art. */\n  ownerAvatarUrl?: string | null;\n', '')
      .replace('  /** Bound backend owner verification, distinct from legacy catalogue flags. */\n  identityVerified?: boolean;\n', ''))).toBe(hash);
  }
});

test.each([
  ['2026-09-05', '5c960e5e203c3bc9d61e615efd4aa40f6c11e1f989af86308133d2b8a2e1ace2'],
  ['2026-09-06', '2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2'],
])('%s complete canonical response stays byte-identical to the before-avatar snapshot', (date, hash) => {
  const response = toResponse(createReviewSyntheticState(new Date(date + 'T12:00:00Z')));
  expect(createHash('sha256').update(JSON.stringify(response)).digest('hex')).toBe(hash);
});
