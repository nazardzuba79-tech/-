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
