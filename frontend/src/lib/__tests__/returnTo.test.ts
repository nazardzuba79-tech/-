import { isSafeNext, loginPathFor, readNext } from '../returnTo';

const legitimateDestinations = [
  '/', '/trade', '/card', '/settings', '/copy-trading', '/wallet',
  '/futures?pair=BTC%2FUSDT', '/trade?pair=BTC%2FUSDT',
  '/trade?pair=BTC/USDT&side=buy', '/settings?tab=security#two-factor',
  '/settings?label=100%25&name=%D0%9D%D0%B0%D0%B7%D0%B0%D1%80',
  '/a%20b', '/a b', '/caf%C3%A9', '/café', '/%D0%A0%D0%B8%D0%BD%D0%BA%D0%B8', '/Ринки',
  '/offer%25', '/offer%25text', '/settings?literal=%2525',
  '/admin/users/known-user-id',
];

const rejectedDestinations = [
  'https://evil.example', 'http://evil.example', '//evil.example',
  '/\\evil.example', '\\evil.example', '\\\\evil.example', '\\/evil.example',
  '/\\/evil.example', '///evil.example',
  '/%5cevil.example', '/%2Fevil.example', '/%2f%5cevil.example',
  '/%255cevil.example', '/%252fevil.example', '/%25255cevil.example',
  '/safe/..//evil.example', '/%2e%2e//evil.example',
  '/safe/../%2f%2fevil.example',
  '\n//evil.example', '/\n/evil.example', '/\r/evil.example', '/\t/evil.example',
  '/trade\u0000', '/trade\u007f', '/trade?value=\n',
  '/%00evil.example', '/%0A/evil.example', '/%250a/evil.example',
  '/trade?value=%0D%0Aevil',
  '/trade%', '/trade%2', '/trade%GG', '/%C0%AF%5Cevil.example',
  '/%E0%A4%A', '/trade?pair=%ED%A0%80',
  ' https://evil.example', ' /trade', 'javascript:alert(1)', 'data:text/html,hello',
  'trade', '?next=/trade', '#/trade', '',
];

/**
 * The auth guard used to send every signed-out visitor to "/", which for
 * them is the homepage — so every product link on that homepage silently
 * did nothing. These are the rules that replaced it: carry the requested
 * path to the login screen, and only ever return to a path on this origin.
 */
describe('returnTo', () => {
  describe('loginPathFor', () => {
    it('carries the requested path and query string', () => {
      expect(loginPathFor({ pathname: '/trade', search: '?pair=BTC/USDT' })).toBe(
        '/login?next=%2Ftrade%3Fpair%3DBTC%2FUSDT'
      );
    });

    it('carries a plain path with no query string', () => {
      expect(loginPathFor({ pathname: '/markets' })).toBe('/login?next=%2Fmarkets');
    });

    it('does not ask to return to the homepage or to an auth screen', () => {
      expect(loginPathFor({ pathname: '/' })).toBe('/login');
      expect(loginPathFor({ pathname: '/login', search: '?next=%2Fwallet' })).toBe('/login');
      expect(loginPathFor({ pathname: '/register' })).toBe('/login');
    });
  });

  describe('readNext', () => {
    it('returns the decoded destination', () => {
      expect(readNext('?next=%2Ffutures%3Fpair%3DSOL%2FUSDT')).toBe('/futures?pair=SOL/USDT');
    });

    it('returns null when there is none', () => {
      expect(readNext('')).toBeNull();
      expect(readNext('?other=1')).toBeNull();
    });

    // An open redirect: the whole point of validating this value.
    it.each([
      'https://evil.example/steal',
      '//evil.example/steal',
      'javascript:alert(1)',
      'trade',
    ])('refuses %s as a destination', (value) => {
      expect(isSafeNext(value)).toBe(false);
      expect(readNext(`?next=${encodeURIComponent(value)}`)).toBeNull();
    });

    it('accepts an ordinary same-origin path', () => {
      expect(isSafeNext('/wallet')).toBe(true);
    });

    it.each(legitimateDestinations)('preserves internal destination exactly: %s', (value) => {
      expect(isSafeNext(value)).toBe(true);
      expect(readNext(`?next=${encodeURIComponent(value)}`)).toBe(value);
    });

    it.each(rejectedDestinations)('rejects ambiguous or external destination: %s', (value) => {
      expect(isSafeNext(value)).toBe(false);
      expect(readNext(`?next=${encodeURIComponent(value)}`)).toBeNull();
    });

    it('rejects encoded backslashes after URLSearchParams decoding', () => {
      expect(readNext('?next=%2F%5Cevil.example')).toBeNull();
      expect(readNext('?next=%2F%255Cevil.example')).toBeNull();
      expect(readNext('?next=%2F%25255Cevil.example')).toBeNull();
    });

    it('rejects every literal and encoded ASCII control character', () => {
      for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
        const control = String.fromCharCode(code);
        const escaped = `%${code.toString(16).padStart(2, '0')}`;
        for (const value of [`/${control}evil.example`, `/trade?value=${control}`, `/${escaped}evil.example`]) {
          expect(isSafeNext(value)).toBe(false);
          expect(readNext(`?next=${encodeURIComponent(value)}`)).toBeNull();
        }
      }
    });

    it('does not accept even an absolute URL matching the validation base', () => {
      expect(isSafeNext('https://voltex-internal.invalid/trade')).toBe(false);
    });

    it('fails closed with bounded work for deeply nested encoded authority paths', () => {
      const value = `/%${'25'.repeat(2_000)}5cevil.example`;
      expect(isSafeNext(value)).toBe(false);
      expect(readNext(`?next=${encodeURIComponent(value)}`)).toBeNull();
    });
  });

  describe('shared login push / registration replace destination policy', () => {
    it.each(['login push', '2FA push', 'registration replace', 'already authenticated replace'])(
      '%s receives only the validated internal destination or existing fallback', () => {
        // These callers all consume readNext before applying their own push or
        // replace option. Both History methods therefore receive the same safe
        // root-relative URL; browser integration also exercises both methods.
        for (const value of rejectedDestinations) {
          const target = readNext(`?next=${encodeURIComponent(value)}`) ?? '/trade';
          expect(target).toBe('/trade');
          expect(new URL(target, 'https://app.example/login').origin).toBe('https://app.example');
        }
        for (const value of legitimateDestinations) {
          const target = readNext(`?next=${encodeURIComponent(value)}`) ?? '/trade';
          expect(target).toBe(value);
          expect(new URL(target, 'https://app.example/login').origin).toBe('https://app.example');
        }
      },
    );
  });
});
