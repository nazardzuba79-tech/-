import fs from 'fs';
import path from 'path';
import { readAllLocales } from '../../../test-utils/i18nSource';
import { cardCopy } from '../../pages/crypto-card-final/data/cardCopy';
import { getCardFaq } from '../../pages/crypto-card-final/data/faq';

test('fee promises identify VOLTEX in every locale and reuse the existing FAQ item', () => {
  for (const copy of Object.values(cardCopy)) {
    for (const value of [copy.benefitFees, copy.voltexFeeZero, copy.voltexMarkupZero]) {
      expect(value).toContain('0%');
      expect(value).toContain('VOLTEX');
    }
    expect(copy.feesNote).toContain('VOLTEX');
    const faq = getCardFaq(copy);
    expect(faq).toHaveLength(7);
    expect(faq.filter(item => item.question === copy.faqFeesQ)).toEqual([
      { question: copy.faqFeesQ, answer: copy.faqFeesA },
    ]);
  }
  expect(cardCopy.ru.faqFeesA).toBe('Нет. Выпуск и обслуживание карты бесплатны. VOLTEX также не взимает собственную комиссию за покупки, снятие наличных и конвертацию валют.');
  expect(cardCopy.ru.feesNote).toContain('VOLTEX не взимает собственную комиссию за покупки, снятие наличных и конвертацию. Возможные комиссии стороннего банка, банкомата или платёжной системы, если они применяются, определяются их условиями.');
});

test('Crypto Card has complete nonempty copy in all seven supported languages', () => {
  expect(Object.keys(cardCopy).sort()).toEqual(['en', 'es', 'hi', 'ja', 'ko', 'ru', 'zh']);
  const keys = Object.keys(cardCopy.ru).sort();
  for (const copy of Object.values(cardCopy)) {
    expect(Object.keys(copy).sort()).toEqual(keys);
    expect(Object.values(copy).every(value => typeof value === 'string' && value.trim().length > 0)).toBe(true);
  }
  for (const [lang, copy] of Object.entries(cardCopy)) {
    if (lang === 'ru') continue;
    expect(copy.heroTitle).not.toBe(cardCopy.ru.heroTitle);
    expect(copy.appVerificationRequired).not.toBe(cardCopy.ru.appVerificationRequired);
  }
});

test('localized product copy retains both thresholds and their OR relationship without inventing a volume period', () => {
  const eitherWord: Record<string, RegExp> = {
    ru: /или/, en: /\bor\b/, zh: /或/, es: /\bo\b/, hi: /या/, ja: /または/, ko: /또는/,
  };
  for (const [lang, copy] of Object.entries(cardCopy)) {
    for (const text of [copy.eligibilityLead, copy.appFinancialRequired]) {
      const normalized = text.replace(/[\s,]/g, '');
      expect(normalized).toContain('5000');
      expect(normalized).toContain('50000');
      expect(text).toMatch(eitherWord[lang]);
      expect(text).not.toMatch(/30|90|180|staking|стейкинг/i);
    }
    expect(copy.faqDifferenceA).toContain('Titanium');
    expect(copy.faqDifferenceA).toContain('Visa');
    expect(copy.faqDifferenceA).toContain('Black Signature');
    expect(copy.faqDifferenceA).toContain('Mastercard');
    expect(copy.faqDifferenceA).toContain('10–15%');
    expect(copy.faqDifferenceA).toContain('15–20%');
    expect(copy.faqDifferenceA.replace(/[\s,]/g, '')).toContain('1000000');
  }
});

test('all localized dictionaries reject obsolete products and availability claims', () => {
  for (const copy of Object.values(cardCopy)) {
    const text = Object.values(copy).join('\n');
    expect(text).not.toMatch(/Icy White|Rose Gold|Voltex VIP|VIP Card|8%|500.?000|90.day|staking|стейкинг|waitlist|coming soon|лист ожидания|скоро|Apple Music|JPY|XRP/i);
    expect(copy.benefitLimit).not.toMatch(/up to|hasta|до|最高|最大|최대|तक/i);
    expect(copy.appSubmitted).not.toMatch(/issued|activated|shipped|выпущена|активирована|отправлена клиенту/i);
  }
});

test('the obsolete global card namespace is removed without dropping Home or Auth card copy', () => {
  // The dictionaries moved one-per-file; this still asserts all seven.
  const source = readAllLocales();
  expect(source).not.toMatch(/^\s*'card\.[^']+'/m);
  expect(source.match(/'home\.card\.name':/g)).toHaveLength(7);
  expect(source.match(/'authShell\.card\.title':/g)).toHaveLength(7);
  expect(source.match(/'authShell\.benefit\.card\.title':/g)).toHaveLength(7);
});
