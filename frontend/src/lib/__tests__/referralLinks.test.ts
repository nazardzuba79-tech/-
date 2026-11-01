import { buildReferralLink, isReferralRegion, readReferralRegion, REFERRAL_REGION_STORAGE_KEY } from '../referralLinks';
import { readDictionaries } from '../../../test-utils/i18nSource';

test('five-character public aliases and legacy codes retain the existing direct path', () => {
  for (const code of ['9BB77', '9BB77B42']) {
    expect(buildReferralLink(code, 'ru')).toBe(`https://ru.voltextech.net/${code}`);
    expect(buildReferralLink(code, 'world')).toBe(`https://voltextech.net/${code}`);
  }
});

test('both trusted origins contain the exact same personal API code', () => {
  const code = 'VLTXa234';
  expect(buildReferralLink(code, 'world')).toBe('https://voltextech.net/VLTXa234');
  expect(buildReferralLink(code, 'ru')).toBe('https://ru.voltextech.net/VLTXa234');
  expect(new URL(buildReferralLink(code, 'world')!).pathname).toBe(new URL(buildReferralLink(code, 'ru')!).pathname);
});

test.each([undefined, null, '', 'x'.repeat(33), '../register', '//evil.test', 'A/B', 'ABC?host=evil.test', '%2Fbad', 'https://evil.test', ' ABCD', 'ABCD\n'])('invalid API code %p cannot become a shared link', value => {
  expect(buildReferralLink(value, 'world')).toBeNull();
  expect(buildReferralLink(value, 'ru')).toBeNull();
});

test.each(['https://evil.test', '__proto__', 'constructor', '', null, undefined])('arbitrary region %p is not a destination', value => {
  expect(isReferralRegion(value)).toBe(false);
  expect(buildReferralLink('ABCD2345', value as any)).toBe(value === undefined ? 'https://voltextech.net/ABCD2345' : null);
});

const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); });
test.each(['world', 'ru', 'https://evil.test', '__proto__', null])('stored region %p uses only the two approved values', stored => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: jest.fn((key: string) => { expect(key).toBe(REFERRAL_REGION_STORAGE_KEY); return stored; }) } });
  expect(readReferralRegion()).toBe(stored === 'ru' ? 'ru' : 'world');
});

test('unavailable storage defaults safely without breaking dev, SSR or registration', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage denied'); } });
  expect(readReferralRegion()).toBe('world');
  expect(buildReferralLink('ABCD2345')).toBe('https://voltextech.net/ABCD2345');
});

test('all seven locales label the same two regions without an unverified VPN claim', () => {
  const dictionaries = readDictionaries();
  for (const dictionary of Object.values(dictionaries)) {
    for (const key of ['settings.referralRegion', 'settings.referralWorld', 'settings.referralRussia', 'settings.referralCopy', 'settings.referralLinkUnavailable']) {
      expect(typeof dictionary[key]).toBe('string');
      expect(dictionary[key].length).toBeGreaterThan(0);
      expect(dictionary[key]).not.toMatch(/VPN/i);
    }
  }
  expect(dictionaries.ru['settings.referralWorld']).toBe('Для всего мира');
  expect(dictionaries.ru['settings.referralRussia']).toBe('Для России');
});
