import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const registryRead = jest.fn(() => ({ logoUrl: 'https://example.invalid/canonical-btc.png' }));
const exportsOfIcon: Record<string, any> = {};
const code = ts.transpileModule(readFileSync(resolve(frontend, 'src/components/CryptoIcon.tsx'), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('require', 'exports', code)((name: string) => {
  if (name === '../lib/assetMetadataStore') return { assetMetadataStore: { get: registryRead } };
  if (name === '../lib/testMarkets') return { managedListingLogo: (symbol: string) => symbol === 'TYVN' ? '' : undefined };
  if (name.endsWith('.svg')) return { default: name };
  return req(name);
}, exportsOfIcon);
const icon = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(exportsOfIcon.CryptoIcon, props));

beforeEach(() => registryRead.mockClear());

test.each([20, 24])('TYVN uses the approved monogram in the existing %ipx slot without a registry lookup', size => {
  const html = icon({ symbol: 'TYVN', size });
  expect(html).toContain('<svg');
  expect(html).toContain('aria-label="TYVN"');
  expect(html).toContain(`width="${size}" height="${size}"`);
  expect(html).toContain('href="/brand/tyvn/teryvane-approved-variant-3.webp"');
  expect(html).not.toContain('>T</div>');
  expect(registryRead).not.toHaveBeenCalled();
});

test('metadata-only TYVN reference rows never inherit the exchange listing logo', () => {
  expect(icon({ symbol: 'TYVN', metadataOnly: true })).not.toContain('teryvane-approved');
});

test('BTC registry identity and existing VTA/NRX logos are preserved', () => {
  expect(icon({ symbol: 'BTC' })).toContain('https://example.invalid/canonical-btc.png');
  expect(registryRead).toHaveBeenCalledWith('BTC');
  expect(icon({ symbol: 'VTA' })).toContain('voltora-logo.svg');
  expect(icon({ symbol: 'NRX' })).toContain('neurix-logo.svg');
});
