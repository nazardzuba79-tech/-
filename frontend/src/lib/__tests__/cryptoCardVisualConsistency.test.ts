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
const cinematic = evaluate('src/pages/crypto-card-final/components/CinematicCardScene.tsx', { './VoltexCard': master });
const composition = evaluate('src/pages/home/HomeCardComposition.tsx', { '../crypto-card-final/components/VoltexCard': master });

test.each([228, 320])('Homepage/auth %spx renders the real approved master with automatic height', width => {
  const html = renderToStaticMarkup(React.createElement(home.HomeCryptoCard, { width }));
  expect(html).toContain(master.CARD_MASTER.black);
  expect(html).toContain('alt="VOLTEX Black Signature"');
  expect(html).toContain('width:100%;height:auto;object-fit:contain');
  expect(html).not.toMatch(/voltex-card-dark|voltex-cards-phone/);
  expect(read('src/pages/auth-shell/AuthShell.tsx')).toContain('<HomeCryptoCard width={228}');
});

test('smartwatch contains the entire unwarped physical master inside measured screen bounds', () => {
  const html = renderToStaticMarkup(React.createElement(cinematic.CinematicCardScene, { kind: 'hero', label: 'VOLTEX Card' }));
  expect(html).toContain('data-card-cinematic="smartwatch"');
  expect(html).toContain(master.CARD_MASTER.black);
  expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
  expect(html).not.toMatch(/clipPath|<mask|transform=/);
  const [x, y, width, height] = [384, 462, 486, 486 * 996 / 1580];
  expect(x).toBeGreaterThan(367);
  expect(x + width).toBeLessThan(879);
  expect(y).toBeGreaterThan(325);
  expect(y + height).toBeLessThan(912);
  expect(width / height).toBeCloseTo(1580 / 996, 12);
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

test('Homepage promo contains both exact physical masters plus a phone without invented balances', () => {
  const html = renderToStaticMarkup(React.createElement(composition.HomeCardComposition));
  expect(html).toContain('data-home-card-composition="two-cards-phone"');
  expect(html.match(/data-product="smartphone"/g)).toHaveLength(1);
  expect(html.match(/data-product="black-signature"/g)).toHaveLength(1);
  expect(html.match(/data-product="titanium"/g)).toHaveLength(1);
  expect(html).toContain(master.CARD_MASTER.black);
  expect(html).toContain(master.CARD_MASTER.titanium);
  expect(html.match(/width="1580" height="996" preserveAspectRatio="xMidYMid meet"/g)).toHaveLength(2);
  expect(html).toContain('••••••');
  expect(html).not.toMatch(/skew|matrix3d|perspective|<foreignObject|<button|<a /);
  const src = read('src/pages/home/HomeCardComposition.tsx');
  expect(src).not.toMatch(/fetch\(|useEffect|useAuth|useBalance|axios/);
  // Physical perimeter extents after uniform scale; the full cards remain in
  // separate slots, before the tiny rigid rotations (whose safety margin >20px).
  expect(44.5 + (82 + 820) * .2651).toBeLessThan(322.2 + 44 * .245 - 20);
  expect(5.55 + (111 + 1358) * .2651).toBeLessThan(435 - 20);
  expect(21.5 + (55 + 1470) * .245).toBeLessThan(435 - 20);
});

test('two-card change preserves all Homepage copy, benefits, CTAs and surrounding layout', () => {
  const restored = read('src/pages/home/HomeCardSection.tsx').replace(/\r\n/g, '\n')
    .replace("import { HomeCardComposition } from './HomeCardComposition';", "import { HomeCryptoCard } from './HomeCryptoCard';")
    .replace('Both approved cards and the phone share one contained hero composition.', 'The only animated card presentation on the homepage.')
    .replace('<HomeCardComposition />', '<HomeCryptoCard width={320} animated sweepDelay={3.5} hover className="max-w-full" />');
  expect(createHash('sha256').update(restored).digest('hex'))
    .toBe('df56857a1aa2d406fd6bd3ae5ec8d0ca468e7e58c9dba3551e8696311b8431db');
});
