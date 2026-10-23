import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readDictionaries } from '../../../test-utils/i18nSource';
const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const modal = read('frontend/src/pages/wallet-v3/ConversionModal.tsx');
const history = read('frontend/src/pages/wallet-v3/TransactionHistory.tsx');
const walletPage = read('frontend/src/pages/WalletPage.tsx');
const overview = read('frontend/src/pages/wallet-v3/WalletOverview.tsx');
const strip = read('frontend/src/pages/wallet-v3/PortfolioStrip.tsx');
describe('wallet conversion UI safety boundaries', () => {
  test('default-OFF keeps Convert controls disabled and cannot mount the modal', () => {
    expect(walletPage).toContain("import.meta.env.VITE_WALLET_CONVERSION_ENABLED === 'true'");
    expect(walletPage).toContain("onConvert={WALLET_CONVERSION_ENABLED ? () => setModal('convert') : undefined}");
    expect(walletPage).toContain('{WALLET_CONVERSION_ENABLED && <ConversionModal');
    expect(overview).toContain('disabled={!onConvert}');
    expect(strip).toContain('disabled={!onConvert}');
    // Switched off, the button is simply inactive: no «not available» note (owner, 2026-10-22, PR #582).
    for (const source of [overview, strip, walletPage]) expect(source).not.toMatch(/convertUnavailable|title=\{!onConvert/);
  });
  test('quote and confirmation are separate explicit actions; zero fee and decimal strings', () => {
    expect(modal).toContain('api.quoteConversion({ fromAsset: from, toAsset: to, amount })');
    expect(modal).toContain('api.confirmConversion(id)');
    expect(modal).toContain('wallet.conversion.fee'); expect(modal).toContain('0%');
    // Debit and credit are both shown before confirmation; the rate is the market rate of the two USD prices.
    expect(modal).toContain("label={t('wallet.conversion.pay')} value={`${quote.fromAmount} ${quote.fromAsset}`}");
    expect(modal).toContain("label={t('wallet.conversion.receive')} value={`${quote.toAmount} ${quote.toAsset}`}");
    expect(modal).toContain('new BigNumber(quote.fromPriceUsd).div(quote.toPriceUsd)');
    // An amount finer than the source asset keeps is refused before any request (the server refuses it too).
    expect(modal).toContain('(new BigNumber(amount).decimalPlaces() ?? 0) > source.scale');
    expect(modal).toMatch(/const valid = [^;]*!tooPrecise/);
    // A blocked account reads as a refusal, never as an unknown outcome that invites a retry.
    expect(modal).toMatch(/'ACCOUNT_BLOCKED'\]\.includes\(code\)/);
    expect(modal).not.toMatch(/parseFloat|parseInt|\bNumber\(amount\)|setInterval|setTimeout/);
  });
  test('persist pending ID before sending; recovery uses receipt and SAME ID, no automatic retry', () => {
    expect(modal.indexOf('sessionStorage.setItem(PENDING_KEY, id)')).toBeLessThan(modal.indexOf('api.confirmConversion(id)'));
    expect(modal).toContain('api.getConversionReceipt(pending)');
    expect(modal).toContain('confirm(pending)'); expect(modal).toContain('locked.current');
    expect(modal).toContain('if (receipt) applied(receipt); else setError');
    expect(modal).toContain('catch { setError');
  });
  test('history retains exact decimal units, masks both conversion legs, preserves real deposit states and explorers', () => {
    expect(history).toContain('api.getMyDeposits()'); expect(history).toContain('api.getWalletActivity()');
    expect(history).toContain('Promise.allSettled'); expect(history).toContain('wallet.txPartial');
    expect(history).toContain("status === 'CREDITED'"); expect(history).toContain("status === 'BELOW_MINIMUM'");
    expect(history).toContain('https://tronscan.org/#/transaction/'); expect(history).toContain('https://blockstream.info/tx/');
    expect(history).toContain('amount: string'); expect(history).not.toMatch(/amount: Number\(/);
    expect(history).toContain('hidden ? MASK'); expect(history).toContain('r.toAmount');
    expect(history).not.toMatch(/performedByAdminId|rejectionReason|\.reason\b|DEMO_BALANCE_ADJUSTED/);
  });
  test('all seven languages explain zero-fee funding conversion and ambiguous outcomes', () => {
    const dictionaries = readDictionaries();
    for (const dict of Object.values(dictionaries)) {
      for (const key of ['wallet.conversion.title', 'wallet.conversion.unknown', 'wallet.conversion.check', 'wallet.conversion.retry', 'wallet.conversion.pay',
        'wallet.conversion.quoteFailed', 'wallet.conversion.denied', 'wallet.txCredit', 'wallet.txDebit', 'wallet.txPartial']) expect(dict[key]).toBeTruthy();
      expect(dict['wallet.conversion.subtitle']).toContain('0%');
      expect(dict['wallet.conversion.places']).toContain('{asset}'); expect(dict['wallet.conversion.places']).toContain('{places}');
      expect(dict['wallet.conversion.unavailable']).toBeUndefined();
    }
    // Errors say what happened and what to do — never that the product is «unavailable».
    for (const [lang, word] of [['en', /unavailable/i], ['ru', /недоступн/i], ['es', /disponible/i], ['zh', /不可用/], ['ja', /できません。後で/], ['ko', /수 없습니다\. 나중/], ['hi', /उपलब्ध नहीं/]] as const) {
      for (const key of ['wallet.conversion.quoteFailed', 'wallet.txPartial']) expect(dictionaries[lang][key]).not.toMatch(word);
    }
  });
});
