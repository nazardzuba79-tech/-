import fs from 'fs';
import path from 'path';
import { cardCopy } from '../../pages/crypto-card-final/data/cardCopy';

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
  const source = fs.readFileSync(path.join(__dirname, '../i18n.tsx'), 'utf8');
  expect(source).not.toMatch(/^\s*'card\.[^']+'/m);
  expect(source.match(/'home\.card\.name':/g)).toHaveLength(7);
  expect(source.match(/'authShell\.card\.title':/g)).toHaveLength(7);
  expect(source.match(/'authShell\.benefit\.card\.title':/g)).toHaveLength(7);
});
