import { resolveCatalogueEdge } from '../depositCatalogueEdge';

describe('Deposit catalogue edge origin (build-time)', () => {
  test('unset or invalid keeps the Render route; only https (or a loopback test Worker) is accepted', () => {
    for (const value of [undefined, '', '   ', 'not a url', 'http://deposit.voltextech.net', 'javascript:alert(1)',
      'https://user:pass@deposit.voltextech.net', 'https://deposit.voltextech.net/?x=1', 'https://deposit.voltextech.net/#x', 'http://localhost:8791']) {
      expect(resolveCatalogueEdge(value)).toBeNull();
    }
    expect(resolveCatalogueEdge('https://deposit.voltextech.net/')).toBe('https://deposit.voltextech.net');
    expect(resolveCatalogueEdge('http://127.0.0.1:8791')).toBe('http://127.0.0.1:8791');
  });

  test('the customer read has no Render fallback and sends no credentials', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '../depositCatalogue.ts'), 'utf8') as string;
    expect(source).toMatch(/DEPOSIT_CATALOGUE_EDGE \? edgeCatalogue\(\) : catalogueRequest/);
    expect(source).toMatch(/credentials: 'omit'/);
    expect(source).not.toMatch(/edgeCatalogue\(\)\.catch/);
    expect(source).not.toMatch(/VITE_.*TOKEN/);
  });
});
