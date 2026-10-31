import { normalizeStrategySocial as normalize, publicStrategySocials } from '../copyStrategySocials';
test('canonical optional independent profile URLs', () => {
  expect(normalize('xUrl', 'twitter.com/Test_User')).toBe('https://x.com/test_user');
  expect(normalize('xUrl', '@Owner')).toBe('https://x.com/owner');
  expect(normalize('telegramUrl', 'https://t.me/Owner_name/')).toBe('https://t.me/owner_name');
  expect(normalize('telegramUrl', '@Owner_name')).toBe('https://t.me/owner_name');
  expect(normalize('xUrl', '')).toBeNull(); expect(normalize('telegramUrl', null)).toBeNull();
});
test.each(['javascript:alert(1)', 'data:text/html,x', 'tg://resolve?domain=tester', 'http://x.com/tester', 'https://evil.invalid/tester', 'https://x.com@evil.invalid/tester', 'https://evil@x.com/tester', 'https://x.com:443/tester', 'https://t.me/+invite', 'https://t.me/joinchat', 'https://t.me/share', 'https://x.com/intent', 'https://x.com/tester?redirect=evil', 'https://x.com/tester#x', 'https://x.com/%74ester', 'https://x.com/tester\n', 'https://x.com\\evil', '@' + 'a'.repeat(256), {}, 10, undefined])('rejects unsafe or malformed input %p', value => {
  expect(() => normalize('xUrl', value)).toThrow();
  expect(() => normalize('telegramUrl', value)).toThrow();
});
test('other VIP and generic profile data never grant permission', () => {
  for (const id of ['VX-VIP-3', 'VX-VIP-4', 'VX-002', 'vx-001', 'VX-001 ']) expect(publicStrategySocials(id, { xUrl: 'https://x.com/owner', telegramUrl: 'https://t.me/owner' })).toEqual({ xUrl: null, telegramUrl: null });
  expect(publicStrategySocials('VX-001', { xUrl: 'javascript:x', telegramUrl: '@owner' })).toEqual({ xUrl: null, telegramUrl: 'https://t.me/owner' });
});
