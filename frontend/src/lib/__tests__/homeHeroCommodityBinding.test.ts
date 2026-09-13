import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '../../pages/home/HomeHeroAssets.tsx'), 'utf8');

test('homepage commodity cards bind to real CFD rows without fabricated oil', () => {
  expect(source).toContain("row.symbol === 'XAUUSD'");
  expect(source).toContain("row.symbol === 'WTIUSD'");
  expect(source).toContain("row.symbol === 'XBRUSD'");
  expect(source).toContain("englishLabels ? 'GOLD'");
  expect(source).toContain("englishLabels ? 'OIL'");
  expect(source).not.toMatch(/key:\s*'oil'[\s\S]{0,120}price:\s*null/);
  expect(source).toContain("oil?.symbol === 'XBRUSD' ? 'XBR/USD' : 'WTI/USD'");
});
