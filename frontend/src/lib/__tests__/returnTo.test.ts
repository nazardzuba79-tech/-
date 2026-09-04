import { isSafeNext, loginPathFor, readNext } from '../returnTo';

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
  });
});
