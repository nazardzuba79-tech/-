/**
 * Where to send someone who asked for a page they have to be signed in for.
 *
 * The guard used to bounce them to "/", which for a signed-out visitor is
 * the homepage — so clicking Рынки, Торговля, Фьючерсы, a market row's
 * Торговать button or a footer product link simply put them back where
 * they started, with no sign-in prompt and nothing to indicate why. They
 * now land on the login screen, and the page they actually wanted is
 * carried along and opened once they are in.
 */
const NEXT_PARAM = 'next';

/** Only same-origin paths: never an absolute or protocol-relative URL. */
export function isSafeNext(value: string | null): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//');
}

export function loginPathFor(location: { pathname: string; search?: string }): string {
  const target = `${location.pathname}${location.search ?? ''}`;
  if (target === '/' || target.startsWith('/login') || target.startsWith('/register')) return '/login';
  return `/login?${NEXT_PARAM}=${encodeURIComponent(target)}`;
}

/** The validated destination carried on a /login or /register URL, if any. */
export function readNext(search: string): string | null {
  const value = new URLSearchParams(search).get(NEXT_PARAM);
  return isSafeNext(value) ? value : null;
}
