import { createHmac } from 'node:crypto';
import { verifyTelegramInitData, telegramAccountLinkingUnavailable } from '../telegramInitData';

const token = '123456:synthetic-local-test-token';
const now = 1750000000;
function signed(extra: Record<string, string> = {}, key = token) {
  const fields = { auth_date: String(now), query_id: 'test-query', user: JSON.stringify({ id: 424242, first_name: 'Fixture' }), ...extra };
  const data = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(key).digest();
  const hash = createHmac('sha256', secret).update(data).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
describe('isolated Telegram verification', () => {
  test('verifies a server-side signed fixture without returning a session', () => {
    expect(verifyTelegramInitData(signed(), token, now)).toEqual({ telegramUserId: '424242', authDate: now, queryId: 'test-query' });
    expect(telegramAccountLinkingUnavailable).toThrow('not enabled');
  });
  test.each([
    ['tampered identity', () => signed().replace('424242', '999999')],
    ['expired', () => signed({ auth_date: String(now - 301) })],
    ['future', () => signed({ auth_date: String(now + 1) })],
    ['bad date', () => signed({ auth_date: 'NaN' })],
    ['duplicate field', () => signed() + '&user=%7B%22id%22%3A1%7D'],
    ['wrong bot', () => signed({}, 'other-bot')],
    ['malformed hash', () => signed().replace(/hash=[^&]+/, 'hash=00')],
    ['bad JSON', () => signed({ user: 'invalid' })],
    ['invalid user id', () => signed({ user: '{"id":-2}' })],
    ['frontend user alone', () => 'user=%7B%22id%22%3A424242%7D'],
    ['oversized', () => 'x'.repeat(8193)],
  ])('rejects %s', (_, make) => expect(() => verifyTelegramInitData(make(), token, now)).toThrow('Invalid Telegram'));
  test('rejects missing token and unsafe freshness configuration', () => {
    expect(() => verifyTelegramInitData(signed(), '', now)).toThrow();
    expect(() => verifyTelegramInitData(signed(), token, now, Infinity)).toThrow();
  });
});
