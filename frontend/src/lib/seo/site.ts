/**
 * What search engines may index on VOLTEX, and under which address. Shared by
 * the build (static page heads, sitemap.xml, robots.txt — frontend/contentPlugin.ts)
 * and by the app, which keeps the same canonical and robots values while a
 * visitor moves between pages (RouteSeo). Pure: no DOM and no content
 * compiler, so it is safe in the browser bundle and in Jest.
 *
 * One public address per page, on https://voltextech.net. ru.voltextech.net
 * serves the same build as an alternative way in; its pages name the main
 * domain as canonical instead of redirecting, so RU deep links, registration,
 * invitations and the session keep working there. The seven interface
 * languages share one URL per page (the choice lives in the browser), so there
 * are no language alternates to declare with hreflang.
 */
export const SITE_ORIGIN = 'https://voltextech.net';
export const OG_IMAGE_URL = `${SITE_ORIGIN}/og-image.png`;

/** Signed-in areas: every RequireAuth route in App.tsx, the admin console,
 * the client redirects into them, and the flag-gated Stocks section. */
export const PRIVATE_ROUTES = [
  '/trade', '/futures', '/markets', '/banking', '/earn', '/settings', '/card', '/wallet', '/otc',
  '/dashboard', '/copy-trading', '/arbitrage', '/tools', '/trading-bots', '/analytics', '/stocks', '/admin',
] as const;
export const ADMIN_PAGES = ['wallets', 'users', 'kyc', 'withdrawals', 'otc', 'deposits', 'audit-log', 'listings'] as const;
/** Public, but not content: sign-in and sign-up (also reached with ?next= and referral query strings). */
export const UTILITY_ROUTES = ['/login', '/register'] as const;
/** Public, but kept out of search with the page's own noindex, nofollow
 * (LicencesPage): it shows supplied images whose details are not confirmed in
 * official registers (licenses.reviewNotice). */
export const UNPROMOTED_ROUTES = ['/legal/licenses'] as const;
/** Old Help addresses that the app redirects into the Academy (HelpPage). */
export const LEGACY_HELP: Readonly<Record<string, string>> = {
  '/help': '/academy/faq',
  '/help/faq': '/academy/faq',
  '/help/fees': '/academy/knowledge',
  '/help/rules': '/academy/knowledge',
};
export const LEGAL_DOCS = ['terms', 'privacy', 'risk', 'about', 'support'] as const;

export const ROBOTS_PRIVATE = 'noindex, nofollow';
export const ROBOTS_UNLISTED = 'noindex, follow';

export function normalizePath(pathname: string): string {
  const path = `/${pathname.split(/[?#]/)[0]}`.replace(/\/{2,}/g, '/');
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}

const within = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** The robots directive for an address, or null where the default (index, follow) applies. */
export function robotsFor(pathname: string): string | null {
  const path = normalizePath(pathname).toLowerCase();
  if (PRIVATE_ROUTES.some((route) => within(path, route)) || (UNPROMOTED_ROUTES as readonly string[]).includes(path)) return ROBOTS_PRIVATE;
  if ((UTILITY_ROUTES as readonly string[]).includes(path)) return ROBOTS_UNLISTED;
  return null;
}

/** The absolute canonical URL of a public page, or null where none is claimed
 * (private and sign-in pages, referral codes, unknown addresses). */
export function canonicalFor(pathname: string): string | null {
  if (robotsFor(pathname)) return null;
  const path = normalizePath(pathname).toLowerCase();
  if (path === '/') return `${SITE_ORIGIN}/`;
  if (LEGACY_HELP[path]) return SITE_ORIGIN + LEGACY_HELP[path];
  if (path.startsWith('/help/')) return SITE_ORIGIN + (path === '/help/status' ? path : '/academy/faq');
  if (within(path, '/academy')) return SITE_ORIGIN + path;
  const legal = /^\/legal\/([a-z-]+)$/.exec(path);
  if (legal && (LEGAL_DOCS as readonly string[]).includes(legal[1])) return SITE_ORIGIN + path;
  return null;
}
