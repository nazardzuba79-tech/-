import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { COUNTRY_CODES, FROM_CURRENCIES, PAIR_COUNT, TIERS, TO_CURRENCIES, countryName } from '../../pages/otc/otcConfig';

/**
 * The OTC page from the owner's OTC.zip (2026-09-30). The figures under its
 * hero are counted from these lists, so the lists are what is pinned here,
 * together with the two places the page's buttons lead.
 */
const root = join(__dirname, '../../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('OTC page', () => {
  it('keeps the tiers and minimums of the design', () => {
    expect(TIERS.map(t => [t.id, t.name, t.minUsd])).toEqual([
      ['otc-convert', 'OTC Convert', 10_000],
      ['cash-exchange', 'Cash Exchange', 50_000],
      ['private-otc', 'Private OTC', 100_000],
    ]);
    expect(TIERS.filter(t => t.accent).map(t => t.id)).toEqual(['cash-exchange']);
  });

  it('counts the pairs and countries it claims under the hero', () => {
    // «340+ валютных пар»: 21 «from» (4 crypto + 17 fiat) against 17 fiat
    // «to», less the 17 same-currency pairs. The design said 350+; the page
    // shows what the form can actually express.
    expect(FROM_CURRENCIES).toHaveLength(21);
    expect(TO_CURRENCIES).toHaveLength(17);
    expect(PAIR_COUNT).toBe(340);
    // «100+ стран в справочнике» and «Более 100 стран»: the directory holds
    // more than a hundred distinct, real ISO regions.
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.length).toBeGreaterThan(100);
    for (const code of COUNTRY_CODES) expect(countryName(code, 'en-US')).not.toBe(code);
  });

  it('opens the real deposit window and the support form, not invented routes', () => {
    const page = read('frontend/src/pages/OtcPage.tsx');
    expect(page).toContain("import { DepositModal } from '../components/DepositModal'");
    expect(page).toContain('onClick={openSupportWidget}');
    expect(page).toContain('<Nav active="/otc" />');
    expect(page).not.toMatch(/navigate\(|href="\/(deposit|otc)/);
    for (const image of ['hero-skyline', 'convert-orbit', 'currency-globe', 'private-network']) {
      expect(page).toContain(`/media/otc/${image}.webp`);
      expect(existsSync(join(root, `frontend/public/media/otc/${image}.webp`))).toBe(true);
    }
    // Assets live outside /otc so the SPA route never meets a directory.
    expect(existsSync(join(root, 'frontend/public/otc'))).toBe(false);
    // Still behind sign-in.
    expect(read('frontend/src/App.tsx')).toMatch(/path="\/otc" element=\{<RequireAuth><OtcPage \/><\/RequireAuth>\}/);
  });

  it('keeps its stylesheet to its own classes', () => {
    const css = read('frontend/src/pages/otc/otc.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/(^|})\s*([^{}@]+?)\s*\{/g)].map(m => m[2].trim()).filter(s => !/^(from|to|\d)/.test(s));
    expect(selectors.length).toBeGreaterThan(40);
    // Commas inside :where( … ) or :is( … ) do not start a new selector.
    const split = (group: string) => group.split(/,(?![^(]*\))/).map(s => s.trim());
    for (const group of selectors) for (const selector of split(group)) {
      expect({ selector, scoped: /^(:where\(\.vx-otc|\.vx-otc|\.otc-)/.test(selector) }).toEqual({ selector, scoped: true });
    }
  });
});
