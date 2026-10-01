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
    // Crypto-to-cash only. The geographic directory is not a desk network.
    expect(FROM_CURRENCIES.map(c=>c.code)).toEqual(['USDT','USDC','BTC','ETH']);
    expect(TO_CURRENCIES).toHaveLength(17);
    expect(PAIR_COUNT).toBe(68);
    // «100+ стран в справочнике» and «Более 100 стран»: the directory holds
    // more than a hundred distinct, real ISO regions.
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.length).toBeGreaterThan(100);
    for (const code of COUNTRY_CODES) expect(countryName(code, 'en-US')).not.toBe(code);
  });

  it('collects and reviews exchange parameters before opening existing support, without financial requests', () => {
    const page = read('frontend/src/pages/OtcPage.tsx');
    expect(page).toContain("import { openSupportWidget } from '../lib/supportWidget'");
    expect(page).toContain("import { CountryCombobox } from './otc/CountryCombobox'");
    expect(page).toContain('Параметры OTC-обмена');
    expect(page).toContain('Страна получения');
    expect(page).toContain('Город получения');
    expect(page).toContain('Количество, {asset}');
    expect(page).toContain('Получаете наличными');
    expect(page).toContain('Проверить параметры');
    expect(page).toContain('Продолжить в поддержку');
    expect(page).toContain('Ничего не отправляется автоматически');
    expect(page).toMatch(/onClick=\{openSupportWidget\}/);
    expect(page.indexOf('Проверить параметры')).toBeLessThan(page.indexOf('Продолжить в поддержку'));
    expect(page).not.toMatch(/OtcExchangeForm|CashList|CashDetailPanel|DepositModal|cashRequest|cashDraftKey|savedDraft|\/otc\/(balances|requests)|fetch\(|useEffect|localStorage/);
    // Legacy components are retained and tested in their isolated fixture.
    const form = read('frontend/src/pages/otc/OtcExchangeForm.tsx');
    expect(form).toContain('onClick={openSupportWidget}');
    expect(form).toContain("cashRequest<CashSummary>('/otc/requests',candidate)");
    expect(form).toContain('onClick={onDeposit}');
    expect(page).not.toMatch(/24\/7|T\+0|350\+|340\+/);
    expect(page).toMatch(/<Nav active="\/otc"\s*\/>/);
    expect(page).not.toMatch(/navigate\(|href="\/(deposit|otc)/);
    expect(page).toContain('FIAT_CURRENCIES');
    expect(page).toContain('CRYPTO_CURRENCIES');
    for (const image of ['hero-skyline']) {
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
