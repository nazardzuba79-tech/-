import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import ts from 'typescript';
import { cardCopy } from '../../pages/crypto-card-final/data/cardCopy';

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
  expect(html).not.toMatch(/clipPath|transform=|slice|preserveAspectRatio="none"|feGaussianBlur/);
  expect(html).toContain('data-watch-edge-mask="true"');
  expect(html).toContain('data-watch-badge="CHF"');
  expect(html).toContain('viewBox="516 80 928 925"');
  expect(html).toContain('width="1448" height="1086"');
  const png = readFileSync(resolve(frontend, `public${watch.WATCH_CARD_IMAGE}`));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1448, 1086]);
  // Byte-exact owner original: no regenerated wrist, card or badge pixels.
  expect(createHash('sha256').update(png).digest('hex')).toBe('e853ff967008a4d1661ca029fbacb8b0a2531bc9fc4657b18922e760fea3f16b');
  expect(read('src/pages/crypto-card-final/crypto-card.css')).not.toContain('aspect-ratio: 800 / 1150');
  expect(renderToStaticMarkup(React.createElement(cinematic.CinematicCardScene, { kind: 'final', label: 'VOLTEX Card' })))
    .toContain(master.CARD_MASTER.black);
});

test.each(['pos', 'atm'])('%s presents the unchanged Black Signature master without stretching or hiding the ATM card face', kind => {
  const { CardScene } = evaluate('src/pages/crypto-card-final/components/CardScene.tsx', {
    './VoltexCard': master,
    '../useCardCopy': { useCardCopy: () => ({ c: { paymentAlt: 'POS', atmAlt: 'ATM' } }) },
  });
  const html = renderToStaticMarkup(React.createElement(CardScene, { kind }));
  expect(html).toContain(`data-payment-scene="${kind}"`);
  expect(html).toContain(`data-card-slot="black-signature-${kind}"`);
  expect(html.match(new RegExp(master.CARD_MASTER.black, 'g'))).toHaveLength(1);
  expect(html).toContain('maskUnits="userSpaceOnUse"');
  const cardGroup = html.match(new RegExp(`<g[^>]*data-card-slot="black-signature-${kind}"[^>]*>`))![0];
  if (kind === 'atm') expect(cardGroup).not.toContain('mask=');
  else expect(cardGroup).toContain('mask=');
  expect(html).toContain('viewBox="106 78 1369 834" preserveAspectRatio="xMidYMid meet"');
  const size = html.match(/<svg width="([\d.]+)" height="([\d.]+)" viewBox="106 78 1369 834"/);
  expect(size).not.toBeNull();
  expect(Number(size![1]) / Number(size![2])).toBeCloseTo(1369 / 834, 10);
  expect(html).not.toMatch(/preserveAspectRatio="none"|matrix\(|skew|voltex-card-dark/);
  // The source frame and the card share the same responsive coordinate system.
  expect(html).toContain('viewBox="0 0 1200 896" preserveAspectRatio="xMidYMid slice"');
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

test.each(Object.keys(cardCopy) as (keyof typeof cardCopy)[])('%s hero headings share the approved localized slogan and asset', lang => {
  const c = cardCopy[lang];
  expect(cardCopy.ru.heroTitle).toBe('Трать крипту по всему миру');
  if (lang !== 'ru') expect(c.heroTitle).not.toMatch(/[А-Яа-я]/);
  const section = evaluate('src/pages/home/HomeCardSection.tsx', {
    '../crypto-card-final/components/WatchCardVisual': watch,
    './CardBenefitIcon': { CardBenefitIcon: () => null },
    '../../lib/i18n': { useLanguage: () => ({ t: (key: string) => key }) },
    '../crypto-card-final/useCardCopy': { useCardCopy: () => ({ c }) },
    'react-router-dom': { Link: ({ children }: any) => React.createElement('a', null, children) },
  });
  const hero = evaluate('src/pages/crypto-card-final/components/Hero.tsx', {
    './WatchCardVisual': watch, './CinematicCardScene': cinematic,
    '../useCardCopy': { useCardCopy: () => ({ c }) },
  });
  for (const Component of [section.HomeCardSection, hero.Hero]) {
    const html = renderToStaticMarkup(React.createElement(Component));
    const heading = html.match(/<h[12][^>]*>(.*?)<\/h[12]>/)![1];
    expect(heading).toBe(c.heroTitle);
    expect(html.match(/data-card-cinematic="wrist-watch"/g)).toHaveLength(1);
    expect(html).toContain(watch.WATCH_CARD_IMAGE);
    expect(html).not.toMatch(/two-cards-phone|voltex-smartwatch-scene|Тратьте|как фиат|BNB|XRP/);
  }
  expect(read('src/pages/crypto-card-final/components/Hero.tsx')).not.toContain("['USD', 'EUR', 'GBP', 'BTC', 'ETH', 'USDT']");
  const src = read('src/pages/crypto-card-final/components/WatchCardVisual.tsx');
  expect(src).not.toMatch(/fetch\(|useEffect|useAuth|useBalance|axios/);
});

test('approved wrist and local layout polish preserve every other Homepage copy, benefit and CTA', () => {
  const restored = read('src/pages/home/HomeCardSection.tsx').replace(/\r\n/g, '\n')
    .replace("import { useCardCopy } from '../crypto-card-final/useCardCopy';\n", '')
    .replace('  const { c } = useCardCopy();\n', '')
    .replace('gap-8 p-5 sm:p-7', 'gap-8 p-7')
    .replace('lg:gap-7 lg:py-9 lg:pl-3 lg:pr-6', 'lg:gap-6 lg:p-9')
    .replace('<div className="vx-home-card-artwork">\n              <WatchCardVisual />\n            </div>', '<WatchCardVisual />')
    .replace('className="space-y-5"', 'className="space-y-4"')
    .replace('h-[42px] w-[42px]', 'h-[34px] w-[34px]')
    .replace('className="min-w-0 leading-snug"', 'className="leading-snug"')
    .replace('text-[15px] font-semibold text-white', 'text-[13px] font-semibold text-white')
    .replace('mt-1 text-[13px] leading-[1.5] text-[#a7b0bd]', 'mt-[3px] text-[11.5px] text-home-muted')
    .replace("import { WatchCardVisual } from '../crypto-card-final/components/WatchCardVisual';", "import { HomeCryptoCard } from './HomeCryptoCard';")
    .replace('{c.heroTitle}', "{t('home.card.titleTop')}\n              <span className=\"block\">{t('home.card.titleBottom')}</span>")
    .replace('lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.35fr)_minmax(0,0.75fr)]', 'lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,300px)]')
    .replace('The same owner-approved wrist artwork as the Crypto Card hero.', 'The only animated card presentation on the homepage.')
    .replace('<WatchCardVisual />', '<HomeCryptoCard width={320} animated sweepDelay={3.5} hover className="max-w-full" />');
  expect(createHash('sha256').update(restored).digest('hex'))
    .toBe('df56857a1aa2d406fd6bd3ae5ec8d0ca468e7e58c9dba3551e8696311b8431db');
});

test('edge opacity replaces the photo frame without changing any other Homepage CSS', () => {
  const html = renderToStaticMarkup(React.createElement(watch.WatchCardVisual));
  expect(html).not.toMatch(/border-radius|filter=|feGaussianBlur/);
  expect(html).toContain('offset=".16" stop-color="white"');
  expect(html).toContain('offset=".84" stop-color="white"');
  expect(html).toContain('offset=".88" stop-color="white"');
  expect(html.match(/data-watch-badge=/g)).toHaveLength(1);
  expect(html).toContain('fill="#ce263b"');
  expect(html).toContain('stop-color="#1B1D22"');
  expect(html).toContain('stop-color="#6F2634"');
  const css = read('src/pages/home/home.css').replace(/\r\n/g, '\n');
  const local = css.match(/\/\* Homepage Card promo only\.[\s\S]*?(?=\/\* --- ambient hero lighting ---)/)![0];
  expect(local).toContain('.vx-home .vx-home-card-artwork');
  expect(local).not.toContain('vx-home-card-artwork::after');
  expect(local).toContain('overflow: visible');
  expect(local).not.toMatch(/filter:|mask-image:|transform:|url\(/);
  expect(createHash('sha256').update(css.replace(local, '')).digest('hex'))
    .toBe('f2e53a7bd3f0d3e61d5f71d9d12d45ac3bde9149930747d1019b102b70a4f23b');
});

test.each(['world', 'apple', 'ai', 'atm', 'privacy'])('%s uses one consistent decorative icon frame without added visible text', kind => {
  const { CardBenefitIcon } = evaluate('src/pages/home/CardBenefitIcon.tsx');
  const html = renderToStaticMarkup(React.createElement(CardBenefitIcon, { kind }));
  expect(html).toContain('aria-hidden="true" class="vx-home-card-benefit-icon"');
  if (kind === 'apple') expect(html).toContain('/cards/crypto-card-final/apple-pay-mark.svg');
  else expect(html).toContain('<svg');
  if (['world', 'atm', 'privacy'].includes(kind)) expect(html).toContain('stroke-width="1.65"');
  // The official OpenAI SVG keeps its non-visible <title> within aria-hidden.
  expect(html.replace(/<title>.*?<\/title>/g, '').replace(/<[^>]+>/g, '')).toBe('');
});

test('registration alone renders two intact approved masters and the recovered expense phone', () => {
  const registration = evaluate('src/pages/auth-shell/RegistrationCardVisual.tsx', {
    '../crypto-card-final/components/VoltexCard': master,
  });
  const shell = evaluate('src/pages/auth-shell/AuthShell.tsx', {
    './auth-shell.css': {}, './RegistrationCardVisual': registration,
    '../home/HomeCryptoCard': home,
    '../../components/Logo': { Logo: () => null },
    '../../components/LanguageSwitcher': { LanguageSwitcher: () => null },
    '../../lib/i18n': { useLanguage: () => ({ t: (key: string) => key }) },
    'react-router-dom': { Link: ({ children, to }: any) => React.createElement('a', { href: to }, children) },
  });
  const props = { switchPrompt: 'prompt', switchLabel: 'label', switchTo: '/login', children: 'FORM' };
  const login = renderToStaticMarkup(React.createElement(shell.AuthShell, props));
  expect(login).not.toContain('two-cards-phone');
  expect(login).not.toContain(master.CARD_MASTER.titanium);
  expect(login).toContain(master.CARD_MASTER.black);
  const html = renderToStaticMarkup(React.createElement(shell.AuthShell, { ...props, cardVisual: 'registration' }));
  expect(html.match(/data-registration-card-composition="two-cards-phone"/g)).toHaveLength(1);
  expect(html.match(/data-product="smartphone"/g)).toHaveLength(1);
  for (const path of Object.values(master.CARD_MASTER) as string[]) expect(html.split(path)).toHaveLength(2);
  expect(html.match(/data-phone-expense=/g)).toHaveLength(3);
  expect(html).toContain('FORM');
  expect(html).not.toContain('preserveAspectRatio="none"');
  expect(read('src/pages/register/RegisterPage.tsx')).toContain('cardVisual="registration"');
});

test('registration visual opt-in leaves Login, auth forms, routes and default shell byte-exact', () => {
  const hash = (value: string) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
  const shell = read('src/pages/auth-shell/AuthShell.tsx').replace(/\r\n/g, '\n')
    .replace("import { RegistrationCardVisual } from './RegistrationCardVisual';\n", '')
    .replace("  cardVisual?: 'single' | 'registration';\n", '')
    .replace(", children, cardVisual = 'single'", ', children')
    .replace("className={cardVisual === 'registration' ? 'vx-auth-card vx-auth-card-registration' : 'vx-auth-card'}", 'className="vx-auth-card"')
    .replace("{cardVisual === 'registration' ? <RegistrationCardVisual /> : <HomeCryptoCard width={228} />}", '<HomeCryptoCard width={228} />');
  expect(hash(shell)).toBe('80868fe97ddced590f9523c3ae041030898119d469c083aa33c06cdc87742bb0');
  expect(hash(read('src/pages/register/RegisterPage.tsx').replace(/      cardVisual="registration"\r?\n/, '')))
    .toBe('f7a7a607c68e5cdab4493a138e141449e43e3ded5cf0ffbc7ee3cc70fe98d503');
  expect(hash(read('src/pages/AuthPage.tsx'))).toBe('55fd61964ba9471a9a802f30c15b86585b92ea04fb193e04cf3c4f0b44f3419e');
  expect(hash(read('src/pages/register/RegisterPanel.tsx'))).toBe('1f8279c104d5d4dc414d032bc0a7caca2270bbd23b3c6591bc5e3c4111a60943');
  const css = read('src/pages/auth-shell/auth-shell.css').replace(/\r\n/g, '\n')
    .replace(/\/\* Registration alone[\s\S]*?(?=\.vx-auth-card-kicker)/, '')
    .replace('  .vx-auth-card-registration .vx-auth-card-art { margin-left: 0; }\n', '');
  expect(hash(css)).toBe('dce75cb0add4577d9bc93477f7c4f9a54a524ceb5e2b316cf6e08709b678c3b2');
});
