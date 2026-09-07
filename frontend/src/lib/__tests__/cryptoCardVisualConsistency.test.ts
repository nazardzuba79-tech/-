import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(frontend, path), 'utf8');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
function evaluate(file: string, overrides: Record<string, unknown> = {}) {
  const code = ts.transpileModule(read(file), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const output: Record<string, any> = {};
  new Function('require', 'exports', code)((name: string) => overrides[name] ?? req(name), output);
  return output;
}
const master = evaluate('src/pages/crypto-card-final/components/VoltexCard.tsx');
const home = evaluate('src/pages/home/HomeCryptoCard.tsx', { '../crypto-card-final/components/VoltexCard': master });
const watch = evaluate('src/pages/crypto-card-final/components/WatchCardVisual.tsx');
const cinematic = evaluate('src/pages/crypto-card-final/components/CinematicCardScene.tsx', { './VoltexCard': master, './WatchCardVisual': watch });

test.each([228, 320])('Homepage/auth %spx renders the real approved master with automatic height', width => {
  const html = renderToStaticMarkup(React.createElement(home.HomeCryptoCard, { width }));
  expect(html).toContain(master.CARD_MASTER.black);
  expect(html).toContain('alt="VOLTEX Black Signature"');
  expect(html).toContain('width:100%;height:auto;object-fit:contain');
  expect(html).not.toMatch(/voltex-card-dark|voltex-cards-phone/);
  expect(read('src/pages/auth-shell/AuthShell.tsx')).toContain('<HomeCryptoCard width={228}');
});

test('hero uses the reference wrist artwork without distorting its watch or circular badges', () => {
  const html = renderToStaticMarkup(React.createElement(cinematic.CinematicCardScene, { kind: 'hero', label: 'VOLTEX Card' }));
  expect(html).toContain('data-card-cinematic="wrist-watch"');
  expect(html).toContain(watch.WATCH_CARD_IMAGE);
  expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
  expect(html).not.toMatch(/clipPath|<mask|transform=|slice|preserveAspectRatio="none"/);
  expect(html).toContain('viewBox="480 80 960 925"');
  expect(html).toContain('width="1448" height="1086"');
  const png = readFileSync(resolve(frontend, `public${watch.WATCH_CARD_IMAGE}`));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1448, 1086]);
  expect(createHash('sha256').update(png).digest('hex')).toBe('ac18b001ae9bb5f370efae95953c7d6deda508679882b4220b7b687e41b39013');
  expect(read('src/pages/crypto-card-final/crypto-card.css')).not.toContain('aspect-ratio: 800 / 1150');
  expect(renderToStaticMarkup(React.createElement(cinematic.CinematicCardScene, { kind: 'final', label: 'VOLTEX Card' })))
    .toContain(master.CARD_MASTER.black);
});

test('all active frontend modules are free of the superseded card art and phone backgrounds', () => {
  const files = (dir: string): string[] => readdirSync(resolve(frontend, dir), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? files(dir + '/' + entry.name) : [dir + '/' + entry.name]);
  const active = files('src').filter(file => /\.(tsx|ts|css)$/.test(file) && !file.includes('__tests__'));
  expect(active.filter(file => /voltex-card-dark\.png|voltex-cards-phone-(hero|register)\.webp/.test(read(file)))).toEqual([]);
});

test('Homepage uses unchanged official payment branding and consistent product-specific artwork', () => {
  const icons = read('src/pages/home/CardBenefitIcon.tsx');
  const section = read('src/pages/home/HomeCardSection.tsx');
  expect(section).not.toMatch(/BrainCircuitIcon|FingerprintIcon|GlobeIcon|LandmarkIcon|function AppleMark/);
  expect(section).toContain('<CardBenefitIcon kind={key}');
  expect(icons).toContain('SiOpenai');
  expect(icons).toContain('/cards/crypto-card-final/apple-pay-mark.svg');
  expect(createHash('sha256').update(readFileSync(resolve(frontend, 'public/cards/crypto-card-final/apple-pay-mark.svg'))).digest('hex'))
    .toBe('66baf110b86c1f1ae01a0e28985970d3827465e6aba6be54d5142a6d1eaa803c');
});

test('both hero headings render the exact approved slogan and share the same asset', () => {
  expect(watch.CARD_HERO_SLOGAN).toBe('Трать крипту по всему миру');
  const section = evaluate('src/pages/home/HomeCardSection.tsx', {
    '../crypto-card-final/components/WatchCardVisual': watch,
    './CardBenefitIcon': { CardBenefitIcon: () => null },
    '../../lib/i18n': { useLanguage: () => ({ t: (key: string) => key }) },
    'react-router-dom': { Link: ({ children }: any) => React.createElement('a', null, children) },
  });
  const hero = evaluate('src/pages/crypto-card-final/components/Hero.tsx', {
    './WatchCardVisual': watch, './CinematicCardScene': cinematic,
    '../useCardCopy': { useCardCopy: () => ({ c: { benefitCashback: 'cashback', benefitFees: 'fees', benefitLimit: 'limit' } }) },
  });
  for (const Component of [section.HomeCardSection, hero.Hero]) {
    const html = renderToStaticMarkup(React.createElement(Component));
    expect(html.match(/Трать крипту по всему миру/g)).toHaveLength(1);
    expect(html.match(/data-card-cinematic="wrist-watch"/g)).toHaveLength(1);
    expect(html).toContain(watch.WATCH_CARD_IMAGE);
    expect(html).not.toMatch(/two-cards-phone|voltex-smartwatch-scene|Тратьте|как фиат|BNB|XRP/);
  }
  const src = read('src/pages/crypto-card-final/components/WatchCardVisual.tsx');
  expect(src).not.toMatch(/fetch\(|useEffect|useAuth|useBalance|axios/);
});

test('wrist change preserves all other Homepage copy, benefits, CTAs and surrounding layout', () => {
  const restored = read('src/pages/home/HomeCardSection.tsx').replace(/\r\n/g, '\n')
    .replace("import { CARD_HERO_SLOGAN, WatchCardVisual } from '../crypto-card-final/components/WatchCardVisual';", "import { HomeCryptoCard } from './HomeCryptoCard';")
    .replace('{CARD_HERO_SLOGAN}', "{t('home.card.titleTop')}\n              <span className=\"block\">{t('home.card.titleBottom')}</span>")
    .replace('lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.35fr)_minmax(0,0.75fr)]', 'lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,300px)]')
    .replace('The same owner-approved wrist artwork as the Crypto Card hero.', 'The only animated card presentation on the homepage.')
    .replace('<WatchCardVisual />', '<HomeCryptoCard width={320} animated sweepDelay={3.5} hover className="max-w-full" />');
  expect(createHash('sha256').update(restored).digest('hex'))
    .toBe('df56857a1aa2d406fd6bd3ae5ec8d0ca468e7e58c9dba3551e8696311b8431db');
});
