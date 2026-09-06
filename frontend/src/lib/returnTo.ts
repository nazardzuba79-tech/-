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
// Root-relative destinations are origin-independent. A fixed trusted base keeps
// validation pure (also in tests) without trusting Host, next or browser globals.
const INTERNAL_ORIGIN = 'https://voltex-internal.invalid';
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;
const ESCAPED_BYTE = /%[0-9a-f]{2}/i;
const MAX_PATH_DECODES = 8;

/** Only unambiguous same-origin paths; preserve the caller's query/fragment. */
export function isSafeNext(value: string | null): value is string {
  if (!value || !value.startsWith('/') || UNSAFE_CHARACTERS.test(value)) return false;

  try {
    // Reject malformed percent/UTF-8 sequences and escaped control characters
    // before URL parsing can silently discard/normalize them. Decoding here is
    // validation only: a legitimate encoded query is never rewritten.
    if (UNSAFE_CHARACTERS.test(decodeURIComponent(value))) return false;

    let path = value;
    for (let depth = 0; depth < MAX_PATH_DECODES; depth += 1) {
      const destination = new URL(path, INTERNAL_ORIGIN);
      if (destination.origin !== INTERNAL_ORIGIN || !path.startsWith('/') ||
          path.startsWith('//') || destination.pathname.startsWith('//') ||
          UNSAFE_CHARACTERS.test(path)) return false;

      // Routers may decode path segments after URLSearchParams has decoded
      // `next`. Check escaped/nested path forms too, not decoded query data.
      // A literal percent that came from a valid %25 is safe once no encoded
      // bytes remain. Raw malformed escapes were already rejected above.
      if (!ESCAPED_BYTE.test(destination.pathname)) return true;
      const decodedPath = decodeURIComponent(destination.pathname);
      // URL serializes Unicode/spaces back to escaped bytes, so compare to
      // the current input too. Never repeatedly re-decode a stable path.
      if (decodedPath === destination.pathname || decodedPath === path) return true;
      path = decodedPath;
    }
    // Excessively nested encoding is ambiguous, not a legitimate return path.
    // Bound work even when an attacker submits thousands of %25 layers.
    return false;
  } catch {
    return false;
  }
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
