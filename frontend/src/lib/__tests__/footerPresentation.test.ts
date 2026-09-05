import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(resolve(frontend, 'src', file), 'utf8');
const footerSource = read('components/Footer.tsx');
const footer = ts.createSourceFile('Footer.tsx', footerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function nodes(predicate: (node: ts.Node) => boolean): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(footer);
  return result;
}

type Element = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
function elements(name: string): Element[] {
  return nodes(node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && node.tagName.getText() === name) as Element[];
}

function attributeText(element: Element, name: string) {
  const attribute = element.attributes.properties.find(prop => ts.isJsxAttribute(prop)
    && prop.name.getText() === name) as ts.JsxAttribute | undefined;
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : undefined;
}

function style(name: string) {
  const property = nodes(node => ts.isPropertyAssignment(node) && node.name.getText() === name)[0] as ts.PropertyAssignment;
  expect(property).toBeDefined();
  expect(ts.isObjectLiteralExpression(property.initializer)).toBe(true);
  return Object.fromEntries((property.initializer as ts.ObjectLiteralExpression).properties.map(item => {
    expect(ts.isPropertyAssignment(item)).toBe(true);
    const field = item as ts.PropertyAssignment;
    const value = field.initializer;
    return [field.name.getText(), ts.isStringLiteral(value) ? value.text : Number(value.getText())];
  }));
}

test('shared Footer keeps the original Logo, five real legal links and both localized notices', () => {
  expect(elements('Logo')).toHaveLength(1);
  expect(elements('nav')).toHaveLength(1);
  expect(elements('Link').map(link => attributeText(link, 'to'))).toEqual([
    '/legal/about', '/legal/terms', '/legal/privacy', '/legal/risk', '/legal/support',
  ]);
  const keys = nodes(node => ts.isCallExpression(node) && node.expression.getText() === 't')
    .map(node => ((node as ts.CallExpression).arguments[0] as ts.StringLiteral).text);
  expect(keys).toEqual(['footer.about', 'footer.terms', 'footer.privacy', 'footer.risk',
    'footer.support', 'footer.riskWarning', 'footer.rights']);
  expect(footerSource).toContain("import { Logo } from './Logo'");
});

test('social placeholders and their unused container are removed, not merely hidden', () => {
  expect(footerSource).not.toMatch(/SocialRow|SocialIcon|styles\.social|socialIcon|footer\.social|nav\.botsSoon/);
  expect(elements('svg')).toHaveLength(0); // The only mark is the existing Logo component.
  expect(elements('path')).toHaveLength(0);
  expect(elements('button')).toHaveLength(0);
  expect(style('top')).toMatchObject({ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' });
});

test('legal links naturally wrap on small screens without a reserved social column', () => {
  expect(style('links')).toMatchObject({ display: 'flex', flexWrap: 'wrap', minWidth: 0, maxWidth: '100%', columnGap: 20, rowGap: 8 });
  expect(style('links')).not.toHaveProperty('width');
  expect(style('top')).not.toHaveProperty('gridTemplateColumns');
  expect(style('link')).toMatchObject({ color: 'var(--text-secondary)', lineHeight: 1.5 });
  expect(style('footer')).not.toHaveProperty('background');
  expect(style('footer')).not.toHaveProperty('--text-primary');
});

test('light profile footer supplies Logo contrast and background tokens without retheming the dark header', () => {
  const css = read('pages/copy-trading-bolt/CopyTradingRefinement.css');
  const block = css.match(/\.copytrading-bolt-root\.profile-view\s*>\s*footer\s*\{([^}]+)\}/)?.[1];
  expect(block).toBeDefined();
  expect(block).toMatch(/--text-primary:\s*var\(--profile-ink\)/);
  expect(block).toMatch(/--bg:\s*#f3f5f8/);
  expect(block).toMatch(/--text-secondary:\s*var\(--profile-muted\)/);
  expect(block).toMatch(/--text-tertiary:\s*var\(--profile-muted\)/);
  const themeRules = [...css.matchAll(/([^{}]+)\{([^{}]*--(?:text-primary|bg)\s*:[^{}]*)\}/g)];
  expect(themeRules).toHaveLength(1);
  expect(themeRules[0][1].trim().split('\n').at(-1)).toBe('.copytrading-bolt-root.profile-view > footer');
  const logo = read('components/Logo.tsx');
  expect(logo).toContain('stroke="var(--text-primary)"');
  expect(logo).toContain('fill="var(--text-primary)"');
  expect(logo).toContain('stroke="var(--bg)"');
});
