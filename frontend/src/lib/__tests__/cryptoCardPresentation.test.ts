import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import * as ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const pageDirectory = resolve(frontend, 'src/pages/crypto-card-final');
const componentDirectory = resolve(pageDirectory, 'components');
const componentFiles = readdirSync(componentDirectory).filter(name => name.endsWith('.tsx'));
const read = (relative: string) => readFileSync(resolve(frontend, relative), 'utf8');
const component = (name: string) => read(`src/pages/crypto-card-final/components/${name}.tsx`);
const parse = (source: string) => ts.createSourceFile('presentation.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function nodes(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return found;
}

type Element = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
function elements(root: ts.Node, name?: string): Element[] {
  return nodes(root, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && (!name || node.tagName.getText() === name)) as Element[];
}

function attribute(element: Element, name: string): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText() === name) as ts.JsxAttribute | undefined;
}

function attributeText(element: Element, name: string): string | undefined {
  const value = attribute(element, name)?.initializer;
  return value && ts.isStringLiteral(value) ? value.text : undefined;
}

function property(root: ts.Node, name: string): ts.PropertyAssignment | undefined {
  return nodes(root, node => ts.isPropertyAssignment(node) && node.name.getText().replace(/['"]/g, '') === name)[0] as ts.PropertyAssignment | undefined;
}

test('the landing preserves the approved archive section order inside the existing exchange chrome', () => {
  const page = parse(read('src/pages/CardPage.tsx'));
  // Approved archive App.tsx sequence, recorded here so tests do not need a local ZIP extraction.
  const approved = ['Header', 'Hero', 'PaymentSection', 'AtmSection', 'SubscriptionsSection', 'CurrencySection',
    'HowItWorksSection', 'GlobalUseSection', 'ControlSecuritySection', 'CardChoiceSection', 'FeesSection', 'FaqSection', 'FinalCtaFooter'];
  expect(elements(page).map(element => element.tagName.getText()).filter(name => approved.includes(name))).toEqual(approved);
  expect(elements(page, 'Nav').map(element => attributeText(element, 'active'))).toEqual(['/card']);
  expect(elements(page, 'Footer')).toHaveLength(1);
  expect(elements(page, 'MotionConfig').map(element => attributeText(element, 'reducedMotion'))).toEqual(['user']);
  const imports = nodes(page, ts.isImportDeclaration) as ts.ImportDeclaration[];
  expect(imports.some(item => ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text === '../components/Nav')).toBe(true);
});

test('final approved marketing copy and monthly Black Signature limit are explicit HTML, not an old placeholder', () => {
  expect(component('Hero')).toContain('Карта,<br />которой можно<br />платить каждый день');
  expect(component('Hero')).toContain('Оплачивайте покупки, онлайн-сервисы и подписки, а также снимайте наличные во всем мире.');
  expect(component('Hero')).not.toContain('Презентация программы.');
  const hero = parse(component('Hero'));
  const lists = nodes(hero, ts.isArrayLiteralExpression) as ts.ArrayLiteralExpression[];
  const benefits = ['До 20% кешбека.', 'Без комиссий.', '$1 млн в месяц.'];
  expect(lists.some(list => JSON.stringify(list.elements.map(item => ts.isStringLiteral(item) ? item.text : null)) === JSON.stringify(benefits))).toBe(true);
  expect(component('PaymentSection')).toContain('До 20%');
  const blackLimit = elements(parse(component('FeesSection')), 'ValueCell')
    .find(element => attributeText(element, 'tier') === 'Black Signature' && attributeText(element, 'value') === '$1 000 000');
  expect(blackLimit).toBeDefined();
  expect(attributeText(blackLimit!, 'caption')).toBe('в месяц');

  const activeSources = [read('src/pages/CardPage.tsx'), ...componentFiles.map(name => component(name.slice(0, -4))),
    ...readdirSync(resolve(pageDirectory, 'data')).filter(name => name.endsWith('.ts')).map(name => readFileSync(resolve(pageDirectory, 'data', name), 'utf8'))];
  for (const source of activeSources) {
    expect(source).not.toMatch(/asset\s*placeholder|card\s*placeholder|дневной\s+лимит|\$?\s*[15]\s*млн\s*в\s*(?:день|сутки)|до\s*\$1\s*млн/i);
  }
});

test('approved physical masters are actual RGBA PNGs at their supplied dimensions', () => {
  for (const filename of ['voltex-black-signature-final.png', 'voltex-titanium-final.png']) {
    const file = resolve(frontend, 'public/cards/crypto-card-final', filename);
    expect(existsSync(file)).toBe(true);
    const data = readFileSync(file);
    expect([...data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(data.toString('ascii', 12, 16)).toBe('IHDR');
    expect([data.readUInt32BE(16), data.readUInt32BE(20)]).toEqual([1580, 996]);
    expect(data[25]).toBe(6); // True-colour with alpha, not a flattened replacement.
  }
  const source = component('VoltexCard');
  expect(source).toContain('/cards/crypto-card-final/voltex-');
  expect(source).toContain('-final.png');
  expect(elements(parse(source), 'img')).toHaveLength(1);
});

test('all literal presentation image URLs point to present production assets with valid format signatures', () => {
  const paths = new Set<string>();
  for (const name of componentFiles) {
    const source = component(name.slice(0, -4));
    for (const match of source.matchAll(/['"](\/cards\/crypto-card-final\/[^'"\s]+\.(?:jpg|png|webp))['"]/g)) paths.add(match[1]);
  }
  expect(paths.size).toBeGreaterThanOrEqual(8); // Six scenes plus both cropped phone/card composites.
  expect(paths.has('/cards/crypto-card-final/voltex-cards-phone-hero.webp')).toBe(true);
  expect(paths.has('/cards/crypto-card-final/voltex-cards-phone-register.webp')).toBe(true);
  for (const asset of paths) {
    const file = resolve(frontend, `public${asset}`);
    expect(existsSync(file)).toBe(true);
    const data = readFileSync(file);
    if (asset.endsWith('.jpg')) expect([...data.subarray(0, 3)]).toEqual([255, 216, 255]);
    if (asset.endsWith('.webp')) {
      expect(data.toString('ascii', 0, 4)).toBe('RIFF');
      expect(data.toString('ascii', 8, 12)).toBe('WEBP');
    }
  }
});

test('product links target actual sections, including both visible application CTAs', () => {
  const ids = new Set<string>();
  const targets: string[] = [];
  for (const name of componentFiles) {
    const source = parse(component(name.slice(0, -4)));
    for (const element of elements(source)) {
      const id = attributeText(element, 'id');
      if (id) ids.add(id);
      const href = attributeText(element, 'href');
      if (href?.startsWith('#')) targets.push(href.slice(1));
    }
    // The Header renders its anchors from a data array rather than literal JSX.
    for (const node of nodes(source, ts.isPropertyAssignment) as ts.PropertyAssignment[]) {
      if (node.name.getText() === 'href' && ts.isStringLiteral(node.initializer) && node.initializer.text.startsWith('#')) targets.push(node.initializer.text.slice(1));
    }
  }
  expect(targets).toContain('apply');
  expect(targets).toContain('possibilities');
  for (const target of targets) expect(ids.has(target)).toBe(true);
  expect(attributeText(elements(parse(component('FinalCtaFooter')), 'section')[0], 'id')).toBe('apply');
  expect(elements(parse(component('FinalCtaFooter')), 'CardWaitlist')).toHaveLength(1);
});

test('the production card route retains RequireAuth and only the isolated review explicitly opts out of actions', () => {
  const production = parse(read('src/App.tsx'));
  const routes = elements(production, 'Route').filter(element => attributeText(element, 'path') === '/card');
  expect(routes).toHaveLength(1);
  const content = attribute(routes[0], 'element')?.initializer;
  expect(content).toBeDefined();
  expect(elements(content!, 'RequireAuth')).toHaveLength(1);
  expect(elements(content!, 'CardPage')).toHaveLength(1);
  expect(attribute(elements(content!, 'CardPage')[0], 'reviewOnly')).toBeUndefined();
  expect(elements(parse(read('src/components/Nav.tsx')), 'Link').filter(element => attributeText(element, 'to') === '/card')).toHaveLength(2);

  const review = parse(read('src/review/main.tsx'));
  const reviewRoute = elements(review, 'Route').find(element => attributeText(element, 'path') === '/card');
  expect(reviewRoute).toBeDefined();
  const reviewCard = elements(attribute(reviewRoute!, 'element')!.initializer!, 'CardPage')[0];
  const reviewFlag = attribute(reviewCard, 'reviewOnly');
  expect(reviewFlag).toBeDefined();
  expect(reviewFlag?.initializer === undefined || (ts.isJsxExpression(reviewFlag.initializer)
    && reviewFlag.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword)).toBe(true);
  const footer = elements(parse(read('src/pages/CardPage.tsx')), 'FinalCtaFooter')[0];
  const forwarded = attribute(footer, 'reviewOnly')?.initializer;
  expect(forwarded && ts.isJsxExpression(forwarded) && forwarded.expression && ts.isIdentifier(forwarded.expression)
    ? forwarded.expression.text : null).toBe('reviewOnly');
});

test('the archive utility layer is prefixed and scoped without global Tailwind preflight', () => {
  const config = parse(read('tailwind.crypto-card.config.js'));
  const prefix = property(config, 'prefix')?.initializer;
  const scope = property(config, 'important')?.initializer;
  expect(prefix && ts.isStringLiteral(prefix) ? prefix.text : null).toBe('vc-');
  expect(scope && ts.isStringLiteral(scope) ? scope.text : null).toBe('.crypto-card-page');
  expect(property(config, 'preflight')?.initializer.kind).toBe(ts.SyntaxKind.FalseKeyword);
  const content = property(config, 'content')?.initializer;
  expect(content && ts.isArrayLiteralExpression(content) && content.elements.every(item => ts.isStringLiteral(item) && item.text.includes('crypto-card-final/'))).toBe(true);
  const css = read('src/pages/crypto-card-final/crypto-card.css');
  expect(css).toContain('@tailwind utilities');
  expect(css).not.toMatch(/@tailwind\s+base|@import[^;]*tailwindcss\/base/);
  expect(css).not.toMatch(/(?:^|\})\s*(?:html|body|:root|\*)\s*[{,]/m);
  expect(css).toContain('prefers-reduced-motion');
});
