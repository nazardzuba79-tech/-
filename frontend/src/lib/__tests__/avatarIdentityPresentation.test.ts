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
  let state: Array<string | null> = [];
  let cursor = 0;
  let photo = '/account-fixture/owner.webp';
  const Avatar = component(() => {
    const index = cursor++;
    return [state[index] ?? null, (value: string) => { state[index] = value; }];
  }, () => photo);
  const TestAvatar = (props: { trader: typeof nazarTrader }) => { cursor = 0; return Avatar(props); };
  const image = (element: any): any => element?.type === 'img' ? element
    : React.Children.toArray(element?.props?.children).map(image).find(Boolean);
  let element = TestAvatar({ trader: nazarTrader });
  expect(image(element).props.src).toBe(photo);
  image(element).props.onError();
  element = TestAvatar({ trader: nazarTrader });
  expect(element.type).toBe('div');
  expect(image(element)).toBeUndefined();
  expect(renderToStaticMarkup(element)).toContain('>N</span>');
  expect(element.props.className).toContain('avatar avatar-gold');
  photo = '/account-fixture/new-owner.webp';
  expect(image(TestAvatar({ trader: nazarTrader })).props.src).toBe(photo);
  for (const trader of marketplaceTraders.filter(t => getTraderVisual(t.id).avatarSrc)) {
    state = [];
    TestAvatar({ trader }).props.onError();
    const fallback = TestAvatar({ trader });
    expect(fallback.type).toBe('div');
    expect(fallback.props.className).toContain('avatar-art');
    expect(renderToStaticMarkup(fallback)).toContain('<svg');
    expect(renderToStaticMarkup(fallback)).not.toContain('<img');
  }
});

test('merged-main chart, statistics, trades and hero renderers remain unchanged', () => {
  const digest = (s: string) => createHash('sha256').update(s).digest('hex');
  // Source guards rebased to merged main 22ac04b99f02a6501692cee4b8c507577becf914.
  // Financial response fixtures and behavior assertions remain independent and unchanged.
  for (const [name, hash] of Object.entries({
    ProfilePerformanceChart: '24c6a535402e26da9c28c15bd8a15cacb6c92f43925375fc8d8066a112552e26',
    DailyReturnChart: 'b834aa91ebe97f004af61fa3ed03d48a7e9d7a1c2e72159fd4e72eb5a4d50d2a',
    MetricsPanel: 'f424ee9670736a84d0e04907964213b18cfd903feec7c778437ca2c795de8dd9',
    TradingProfilePanel: 'b8a53ed558adf63716b2f92f95be57005b9421c6f34e6dcd19c529437a376f87',
    TradesPanel: 'b4f7cc439367880c75b164b7a5e234ef15aeb7de9b34a35268772b92f9ece18d',
    MarketplaceHero: '6711f0146a0a1456b34a21fc6db3d3310c5a9344ab9b4295371455dc60db3258',
  })) {
    const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
    const renderer = node.getText(ast);
    expect(digest(renderer)).toBe(hash);
  }
  for (const [file, hash] of Object.entries({
    // Owner-requested marketplace polish; profile/chart rules remain frozen below.
    'src/pages/copy-trading-bolt/CopyTradingRefinement.css': 'b4fb1a79751466da631fa7105f3fcc1472d943b5edeb7220e227ab04ecc0f742',
    'src/pages/copy-trading-bolt/traders.ts': '0cf4f66b5c72b556e3d2c5976376b5f0955dff49a9b653913d27324ec96ec2c1',
    'src/pages/copy-trading-bolt/demoPerformance.ts': '1339781ee31f193dcd7f7fe4a5d8a9257383cf4e0c8a29ffca69101d7cb6bead',
  })) {
    const contents = readFileSync(resolve(frontend, file), 'utf8').replace(/\r\n/g, '\n');
    expect(digest(contents)).toBe(hash);
  }
});

test.each([
  ['2026-09-05', '5c960e5e203c3bc9d61e615efd4aa40f6c11e1f989af86308133d2b8a2e1ace2'],
  ['2026-09-06', '2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2'],
])('%s complete canonical response stays byte-identical to the before-avatar snapshot', (date, hash) => {
  const response = toResponse(createReviewSyntheticState(new Date(date + 'T12:00:00Z')));
  expect(createHash('sha256').update(JSON.stringify(response)).digest('hex')).toBe(hash);
});
