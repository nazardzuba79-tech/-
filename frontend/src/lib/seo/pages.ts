import { seoPages, type CompiledContent, type SeoPage } from '../content/compile';
import { legalMeta } from './legalMeta';
import {
  ADMIN_PAGES, LEGAL_DOCS, PRIVATE_ROUTES, ROBOTS_PRIVATE, ROBOTS_UNLISTED, SITE_ORIGIN, UNPROMOTED_ROUTES, UTILITY_ROUTES,
  canonicalFor, robotsFor,
} from './site';

/**
 * Build-time list of what the static site tells search engines (used by
 * frontend/contentPlugin.ts). Academy and Help come from seoPages() as before;
 * this adds the legal pages, the static copies that keep signed-in and
 * sign-in addresses out of search, sitemap.xml and robots.txt.
 */

export function legalPages(): SeoPage[] {
  return LEGAL_DOCS.map((doc) => ({ path: `legal/${doc}`, ...legalMeta(doc) }));
}

/** Every public page with its own static head (index.html itself is the home page). */
export function publicPages(content: CompiledContent): SeoPage[] {
  return [...seoPages(content), ...legalPages()];
}

/** Addresses whose static copy carries a robots directive and no canonical. */
export function unlistedPages(): { path: string; robots: string }[] {
  return [
    ...PRIVATE_ROUTES.map((route) => ({ path: route.slice(1), robots: ROBOTS_PRIVATE })),
    ...ADMIN_PAGES.map((page) => ({ path: `admin/${page}`, robots: ROBOTS_PRIVATE })),
    ...UNPROMOTED_ROUTES.map((route) => ({ path: route.slice(1), robots: ROBOTS_PRIVATE })),
    ...UTILITY_ROUTES.map((route) => ({ path: route.slice(1), robots: ROBOTS_UNLISTED })),
  ];
}

/** index.html for an address that stays out of search: the robots meta, and no canonical or og:url claim. */
export function withRobots(indexHtml: string, robots: string): string {
  return indexHtml
    .replace(/\s*<link rel="canonical"[^>]*>/, '')
    .replace(/\s*<meta property="og:url"[^>]*>/, '')
    .replace(/(<meta name="description"[^>]*>)/, `$1\n    <meta name="robots" content="${robots}" />`);
}

/**
 * The sitemap: the home page and every public page that is its own canonical,
 * home first, then in address order. Throws when the app's runtime policy
 * (lib/seo/site.ts) would describe a listed page differently, so the static
 * and the rendered head can never disagree.
 */
export function sitemapUrls(content: CompiledContent): string[] {
  const urls = new Set<string>([`${SITE_ORIGIN}/`]);
  for (const page of publicPages(content)) {
    const self = `${SITE_ORIGIN}/${page.path}`;
    const runtime = canonicalFor(`/${page.path}`);
    if (robotsFor(`/${page.path}`)) throw new Error(`Static page ${page.path} is marked unlisted by lib/seo/site.ts`);
    if (runtime !== (page.canonical ?? self)) throw new Error(`Canonical mismatch for ${page.path}: static ${page.canonical ?? self}, app ${runtime}`);
    if (!page.canonical) urls.add(self);
  }
  const [home, ...rest] = [...urls];
  return [home, ...rest.sort()];
}

const xmlEscape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** No <lastmod>: the content has no trustworthy per-page change dates, and a guessed one misleads crawlers. */
export function sitemapXml(urls: string[]): string {
  const body = urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function robotsTxt(): string {
  return [
    '# VOLTEX. Every page may be crawled. Signed-in areas and the sign-in screens',
    '# are kept out of search results by their robots meta and X-Robots-Tag, not',
    '# here: robots.txt is public and is not access control.',
    'User-agent: *',
    'Disallow:',
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
}
