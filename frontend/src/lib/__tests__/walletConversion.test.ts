import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readDictionaries } from '../../../test-utils/i18nSource';
const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const modal = read('frontend/src/pages/wallet-v3/ConversionModal.tsx');
const history = read('frontend/src/pages/wallet-v3/TransactionHistory.tsx');
describe('wallet conversion UI safety boundaries', () => {
  test('quote and confirmation are separate explicit actions; zero fee and decimal strings', () => {
    expect(modal).toContain('api.quoteConversion({ fromAsset: from, toAsset: to, amount })');
    expect(modal).toContain('api.confirmConversion(id)');
    expect(modal).toContain('wallet.conversion.fee'); expect(modal).toContain('0%');
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
      for (const key of ['wallet.conversion.title', 'wallet.conversion.unknown', 'wallet.conversion.check', 'wallet.conversion.retry', 'wallet.txCredit', 'wallet.txDebit', 'wallet.txPartial']) expect(dict[key]).toBeTruthy();
      expect(dict['wallet.conversion.subtitle']).toContain('0%');
    }
  });
});
