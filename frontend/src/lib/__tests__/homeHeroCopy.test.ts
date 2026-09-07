import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(resolve(frontend, file), 'utf8');
const source = read('src/lib/i18n.tsx');
const rows = (key: string) => [...source.matchAll(new RegExp(`'${key.replace(/\./g, '\\.')}': '([^']*)'`, 'g'))].map(match => match[1]);
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');

test('all seven languages retain the approved headline, institutional positioning and crypto-card description', () => {
  expect(rows('home.hero.titleTop')).toEqual(Array(7).fill('OWN YOUR FUTURE.'));
  expect(rows('home.hero.titleBottom')).toEqual(Array(7).fill(''));
  expect(rows('home.hero.badge')).toEqual(rows('marketing.eyebrow'));
  expect(rows('home.hero.badgeShort')[0]).toBe('Биржа институционального уровня');
  expect(rows('home.hero.subtitle')[0]).toBe('Ваш доступ к мировым рынкам и свободе.');
  expect(rows('home.hero.description')[0]).toBe('Торговля, инвестиции и криптокарта VOLTEX — в одной системе.');
  expect(rows('home.hero.description')).toHaveLength(7);
  for (const description of rows('home.hero.description')) expect(description).toContain('VOLTEX');
  expect(rows('home.hero.subtitle').every(Boolean)).toBe(true);
  expect(source).not.toContain('Рынок сложный.');
  expect(source).not.toContain('Интерфейс — нет.');
  expect(source).not.toContain('с реальными рыночными данными и единым кошельком');
});

test.each(['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'])('%s renders one headline and separate supporting copy without changing CTA targets or terminal previews', lang => {
  const index = ['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'].indexOf(lang);
  const code = ts.transpileModule(read('src/pages/home/HomeHero.tsx'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const output: Record<string, any> = {};
  const overrides: Record<string, unknown> = {
    '../../lib/i18n': { useLanguage: () => ({ t: (key: string) => rows(key)[index] }) },
    './TerminalPreview': { TerminalPreview: () => React.createElement('div', { 'data-preview': 'terminal' }) },
    './PhonePreview': { PhonePreview: () => React.createElement('div', { 'data-preview': 'phone' }) },
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
  };
  new Function('require', 'exports', code)((name: string) => overrides[name] ?? req(name), output);
  const html = renderToStaticMarkup(React.createElement(output.HomeHero, { market: {} }));
  expect(html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1]).toBe('OWN YOUR FUTURE.');
  expect(html).toContain(rows('home.hero.subtitle')[index]);
  expect(html).toContain(rows('home.hero.description')[index]);
  expect(html).not.toContain('<span class="block text-gold-500"></span>');
  expect(html).toContain('href="/trade"');
  expect(html).toContain('href="/markets"');
  expect(html.match(/data-preview="terminal"/g)).toHaveLength(1);
  expect(html.match(/data-preview="phone"/g)).toHaveLength(1);
});
