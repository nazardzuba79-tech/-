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

test('actual onError removes broken photo, retains initials and geometry, and retries a changed owner URL', () => {
  let photo = '/account-fixture/owner.webp';
  const states: unknown[] = [];
  let cursor = 0;
  const TestAvatar = component((initial: unknown) => {
    const slot = cursor++;
    if (!(slot in states)) states[slot] = initial;
    return [states[slot], (next: unknown) => { states[slot] = next; }];
  }, () => photo);
  const render = (trader = nazarTrader) => { cursor = 0; return TestAvatar({ trader }); };
  const photoNode = (node: any) => React.Children.toArray(node.props.children).find((child: any) => child.type === 'img') as any;
  const original = render();
  expect(original.type).toBe('div');
  expect(original.props.className).toContain('avatar-stack');
  expect(photoNode(original).props.style.opacity).toBe(0);
  expect(renderToStaticMarkup(original)).toContain('>N</span>');
  photoNode(original).props.onError();
  const failed = render();
  expect(failed.props.className).toBe(original.props.className);
  expect(photoNode(failed)).toBeUndefined();
  expect(renderToStaticMarkup(failed)).toContain('>N</span>');
  photo = '/account-fixture/new-owner.webp';
  expect(photoNode(render()).props.src).toBe(photo);
  expect(photoNode(render()).props.style.opacity).toBe(0);
  for (const trader of marketplaceTraders.filter(t => getTraderVisual(t.id).avatarSrc)) {
    states.length = 0;
    const image = render(trader);
    expect(image.type).toBe('img');
    image.props.onError();
    const fallback = render(trader);
    expect(fallback.type).toBe('div');
    expect(fallback.props.className).toContain('avatar-art');
    expect(renderToStaticMarkup(fallback)).toContain('<svg');
    expect(renderToStaticMarkup(fallback)).not.toContain('<img');
  }
});

test('owner-photo rendering preserves every trader figure and excludes catalogue media for real strategies', () => {
  for (const trader of [nazarTrader, ...marketplaceTraders]) {
    const snapshot = Object.fromEntries(Object.entries(trader));
    for (const photo of [null, '/account-fixture/first.webp', '/account-fixture/second.webp']) {
      render(trader, photo);
      render(trader, photo, true);
      // toEqual keeps NaN as NaN; JSON would silently turn it into null.
      expect(trader).toEqual(snapshot);
    }
  }
  // A cold strategy must not inherit fictional catalogue figures while its
  // own ledger is loading. Avatar and identity wiring cannot fill them in.
  for (const field of ['roi7', 'roi30', 'roi90', 'roiAll', 'winRate', 'drawdown', 'copiers', 'aum', 'volume', 'performanceFee'])
    expect(Number.isNaN((nazarTrader as any)[field])).toBe(true);
  const reads = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(ast) === 'trader') reads.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(avatarNode);
  expect([...reads].sort()).toEqual(['id', 'initials', 'ownerAvatarUrl', 'tone']);
});

test('unchanged marketplace hero and demo performance retain their original fingerprints', () => {
  // Keep the byte guards that still represent unchanged code. The approved
  // period panel, loading contexts and hidden trade history are covered by
  // behavioral presentation suites, not obsolete pre-feature hashes.
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const hero = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MarketplaceHero')!;
  expect(digest(hero.getText(ast))).toBe('6711f0146a0a1456b34a21fc6db3d3310c5a9344ab9b4295371455dc60db3258');
  const demo = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/demoPerformance.ts'), 'utf8').replace(/\r\n/g, '\n');
  expect(digest(demo)).toBe('1339781ee31f193dcd7f7fe4a5d8a9257383cf4e0c8a29ffca69101d7cb6bead');
});

test.each([
  ['2026-09-05', '5c960e5e203c3bc9d61e615efd4aa40f6c11e1f989af86308133d2b8a2e1ace2'],
  ['2026-09-06', '2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2'],
])('%s complete canonical response stays byte-identical to the before-avatar snapshot', (date, hash) => {
  const response = toResponse(createReviewSyntheticState(new Date(date + 'T12:00:00Z')));
  expect(createHash('sha256').update(JSON.stringify(response)).digest('hex')).toBe(hash);
});
