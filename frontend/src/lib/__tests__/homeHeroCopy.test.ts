import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { readAllLocales } from '../../../test-utils/i18nSource';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(resolve(frontend, file), 'utf8');
// Every language's dictionary, so `rows()` still returns seven values.
const source = readAllLocales();
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
  expect(rows('home.hero.description')[0]).toBe('Торговля, инвестиции, VOLTEX Crypto Card и возможность копировать лучших трейдеров мира — в одной системе.');
  expect(rows('home.hero.description')).toHaveLength(7);
  for (const description of rows('home.hero.description')) expect(description).toContain('VOLTEX');
  expect(rows('home.hero.subtitle').every(Boolean)).toBe(true);
  expect(source).not.toContain('Рынок сложный.');
  expect(source).not.toContain('Интерфейс — нет.');
  expect(source).not.toContain('с реальными рыночными данными и единым кошельком');
});

test('Crypto Card product naming stays English throughout every supported UI language', () => {
  expect(rows('nav.card')).toEqual(Array(7).fill('Crypto Card'));
  expect(rows('home.card.name')).toEqual(Array(7).fill('VOLTEX Crypto Card'));
  for (const key of ['marketing.heroPerk2', 'home.hero.description', 'home.faq.q6']) {
    expect(rows(key)).toHaveLength(7);
    for (const text of rows(key)) expect(text).toContain('Crypto Card');
  }
  expect(source).not.toMatch(/крипто[ -]?карт|加密卡|tarjeta cripto|क्रिप्टो कार्ड|暗号資産カード|クリプトカード|크립토 카드/i);
});

test.each(['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'])('%s renders one headline and separate supporting copy without changing CTA targets or terminal previews', lang => {
  const index = ['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'].indexOf(lang);
  const code = ts.transpileModule(read('src/pages/home/HomeSapphireHero.tsx'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const output: Record<string, any> = {};
  const overrides: Record<string, unknown> = {
    '../../components/CryptoIcon': { CryptoIcon: () => null },
    '../../components/Logo': { LogoMark: () => null },
    './LiveValue': { LiveValue: () => React.createElement('span', {}, '—') },
    './TerminalPreview': { PreviewCandles: () => null },
    './useHomeMarket': { byVolume: () => [], formatPriceValue: String },
    '../../lib/i18n': { useLanguage: () => ({ lang, t: (key: string) => rows(key)[index] }) },
    // The requested laptop/globe replaces the old phone overlay. Keep the
    // existing copy/CTA guarantees while isolating this renderer from streams.
    './HeroReferenceScene': { HeroReferenceScene: () => React.createElement('div', { 'data-preview': 'terminal' }) },
    './HomeHeroAssets': { HomeHeroAssets: () => React.createElement('div', { 'data-preview': 'assets' }) },
    './HomeSapphireTape': { HomeSapphireTape: () => React.createElement('div', { 'data-preview': 'tape' }) },
    './useHeroStream': { useHeroStream: (market: unknown) => market },
    './HomeMotion': { MotionStage: ({ children }: any) => React.createElement('div', {}, children) },
    './globalHeroCopy': { globalHeroCopy: { [lang]: { pause: 'Pause', resume: 'Resume', globe: 'Global markets' } } },
    './hero-reference.css': {},
    'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
  };
  new Function('require', 'exports', code)((name: string) => overrides[name] ?? req(name), output);
  const html = renderToStaticMarkup(React.createElement(output.HomeSapphireHero, { market: { tickers: [], hero: { candles: [], trades: [] } } }));
  const heading = html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, '');
  expect(heading).toBe('OWN YOUR FUTURE.');
  expect(html).toContain(rows('home.hero.subtitle')[index]);
  expect(html).toContain(rows('home.hero.description')[index]);
  expect(html).not.toContain('<span class="block text-gold-500"></span>');
  expect(html).toContain('href="/trade"');
  expect(html).toContain('href="/markets"');
  expect(html.match(/id="home-live-terminal"/g)).toHaveLength(1);
  expect(html.match(/data-preview="assets"/g)).toHaveLength(1);
  expect(html.match(/data-preview="tape"/g)).toHaveLength(1);
  expect(html).not.toContain('data-preview="phone"');
});
