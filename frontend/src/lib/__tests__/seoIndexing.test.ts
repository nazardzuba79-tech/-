import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { createRequire } from 'module';
import { compileContent, withPageHead } from '../content/compile';
import { legalPages, publicPages, robotsTxt, sitemapUrls, sitemapXml, unlistedPages, withRobots } from '../seo/pages';
import {
  ADMIN_PAGES, LEGACY_HELP, PRIVATE_ROUTES, ROBOTS_PRIVATE, ROBOTS_UNLISTED, SITE_ORIGIN, UNPROMOTED_ROUTES, UTILITY_ROUTES,
  canonicalFor, robotsFor,
} from '../seo/site';
import { applyRouteSeo } from '../seo/head';

/**
 * Issue #632: what search engines may index, and under which address. Public
 * Academy, Help and legal pages each have one canonical on voltextech.net and
 * are listed in sitemap.xml; signed-in, admin and sign-in addresses are never
 * listed and carry noindex. These tests keep the policy, the router, the
 * Pages headers and the static output in step.
 */

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');

const contentDir = resolve(frontend, 'content');
function readTree(dir: string, files: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) readTree(full, files);
    else files[relative(contentDir, full).split(sep).join('/')] = readFileSync(full, 'utf8');
  }
  return files;
}
const compiled = compileContent(readTree(contentDir));
const urls = sitemapUrls(compiled);

describe('address policy', () => {
  test('public pages are their own canonical on the main domain, from any spelling', () => {
    expect(canonicalFor('/')).toBe(`${SITE_ORIGIN}/`);
    expect(canonicalFor('/academy/futures/perpetual')).toBe(`${SITE_ORIGIN}/academy/futures/perpetual`);
    expect(canonicalFor('/Academy/Futures/Perpetual/?utm_source=x#top')).toBe(`${SITE_ORIGIN}/academy/futures/perpetual`);
    expect(canonicalFor('/legal/terms')).toBe(`${SITE_ORIGIN}/legal/terms`);
    expect(canonicalFor('/help/status')).toBe(`${SITE_ORIGIN}/help/status`);
    for (const path of ['/', '/academy', '/legal/terms']) expect(robotsFor(path)).toBeNull();
  });

  test('old Help addresses name the Academy page the app redirects them to', () => {
    for (const [from, to] of Object.entries(LEGACY_HELP)) expect(canonicalFor(from)).toBe(SITE_ORIGIN + to);
    expect(canonicalFor('/help/anything-else')).toBe(`${SITE_ORIGIN}/academy/faq`);
  });

  test('signed-in, admin, sign-in, unconfirmed-licence, referral and unknown addresses claim no canonical', () => {
    for (const path of ['/wallet', '/trade?pair=BTC_USDT', '/futures', '/admin', '/admin/users/42', '/stocks/AAPL', '/markets?view=analytics', '/legal/licenses']) {
      expect({ path, robots: robotsFor(path), canonical: canonicalFor(path) }).toEqual({ path, robots: ROBOTS_PRIVATE, canonical: null });
    }
    for (const path of ['/login?next=%2Fwallet', '/register']) {
      expect({ path, robots: robotsFor(path), canonical: canonicalFor(path) }).toEqual({ path, robots: ROBOTS_UNLISTED, canonical: null });
    }
    for (const path of ['/ABC123', '/legal/unknown', '/does/not/exist']) expect(canonicalFor(path)).toBeNull();
    // A prefix is not a match: /trades or /walletx are not the signed-in /trade and /wallet.
    expect(robotsFor('/walletx')).toBeNull();
  });
});

describe('the router and the Pages headers agree with the policy', () => {
  const app = read('src/App.tsx');

  test('every signed-in route in App.tsx, and every redirect into one, is private', () => {
    const guarded = [...app.matchAll(/<Route path="(\/[^"]+)" element=\{<RequireAuth>/g)].map((m) => m[1]);
    expect(guarded.length).toBeGreaterThan(10);
    for (const path of guarded) expect({ path, robots: robotsFor(path) }).toEqual({ path, robots: ROBOTS_PRIVATE });
    for (const [, path, target] of app.matchAll(/<Route path="(\/[^"]+)" element=\{<Navigate to="([^"]+)"/g)) {
      if (robotsFor(target)) expect({ path, robots: robotsFor(path) }).toEqual({ path, robots: robotsFor(target) });
      else expect(canonicalFor(path)).toBe(canonicalFor(target));
    }
    const admin = app.slice(app.indexOf('<Route path="/admin"'), app.indexOf('</Route>', app.indexOf('<Route path="/admin"')));
    const children = [...admin.matchAll(/<Route path="([a-z-]+)" /g)].map((m) => m[1]);
    expect(children.sort()).toEqual([...ADMIN_PAGES].sort());
  });

  test('_headers keeps the cache contract first and adds X-Robots-Tag exactly where the policy says', () => {
    const headers = read('public/_headers');
    const rules = [...headers.matchAll(/^(\/\S*)\n((?:[ \t]+\S.*\n?)+)/gm)].map((m) => ({ path: m[1], body: m[2].trim() }));
    expect(rules.slice(0, 2)).toEqual([
      { path: '/*', body: 'Cache-Control: no-cache' },
      { path: '/assets/*', body: 'Cache-Control: public, max-age=31536000, immutable' },
    ]);
    const robotsRules = rules.slice(2);
    expect(robotsRules.every((rule) => /^X-Robots-Tag: /.test(rule.body))).toBe(true);
    const expected = new Map<string, string>([
      ...[...PRIVATE_ROUTES, ...UNPROMOTED_ROUTES].map((route) => [route, ROBOTS_PRIVATE] as [string, string]),
      ['/stocks/*', ROBOTS_PRIVATE], ['/admin/*', ROBOTS_PRIVATE],
      ...UTILITY_ROUTES.map((route) => [route, ROBOTS_UNLISTED] as [string, string]),
    ]);
    expect(new Map(robotsRules.map((rule) => [rule.path, rule.body.replace('X-Robots-Tag: ', '')]))).toEqual(expected);
  });
});

describe('sitemap.xml and robots.txt', () => {
  test('lists the home page and every public Academy, Help and legal page once, and nothing else', () => {
    expect(urls[0]).toBe(`${SITE_ORIGIN}/`);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
      expect(url).not.toMatch(/[?#]/);
      const path = url.slice(SITE_ORIGIN.length) || '/';
      expect({ url, canonical: canonicalFor(path), robots: robotsFor(path) }).toEqual({ url, canonical: url, robots: null });
    }
    const { articles, sections } = compiled.academy.ru;
    for (const article of articles) expect(urls).toContain(`${SITE_ORIGIN}/academy/${article.section}/${article.slug}`);
    for (const section of sections.filter((s) => s.id !== 'glossary')) expect(urls).toContain(`${SITE_ORIGIN}/academy/${section.id}`);
    for (const page of ['academy', 'academy/learn', 'academy/knowledge', 'academy/faq', 'academy/glossary', 'help/status',
      'legal/terms', 'legal/privacy', 'legal/risk', 'legal/about', 'legal/support']) expect(urls).toContain(`${SITE_ORIGIN}/${page}`);
    for (const path of [...Object.keys(LEGACY_HELP), ...PRIVATE_ROUTES, ...UTILITY_ROUTES, ...UNPROMOTED_ROUTES, '/admin/users']) {
      expect(urls).not.toContain(SITE_ORIGIN + path);
    }
    expect(urls.length).toBe(1 + publicPages(compiled).filter((page) => !page.canonical).length);
  });

  test('the XML is a well-formed sitemaps.org urlset with absolute <loc>s and no guessed <lastmod>', () => {
    const xml = sitemapXml([...urls, `${SITE_ORIGIN}/a?b=1&c=<2>`]);
    const doc = new JSDOM(xml, { contentType: 'application/xml' }).window.document;
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    expect(doc.documentElement.namespaceURI).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
    const locs = [...doc.getElementsByTagName('loc')].map((loc: Element) => loc.textContent);
    expect(locs).toEqual([...urls, `${SITE_ORIGIN}/a?b=1&c=<2>`]);
    expect(xml).not.toContain('lastmod');
  });

  test('robots.txt blocks nothing public and points at the sitemap', () => {
    const txt = robotsTxt();
    expect(txt).toMatch(/^User-agent: \*\nDisallow:\n\nSitemap: https:\/\/voltextech\.net\/sitemap\.xml\n$/m);
    expect(txt.split('\n').filter((line) => /^(Dis)?allow:/i.test(line))).toEqual(['Disallow:']);
  });
});

describe('static heads', () => {
  const index = read('index.html');
  const head = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);

  test('index.html is the home page: canonical, og:url and an absolute raster og:image on the main domain', () => {
    expect(head(index, /<link rel="canonical" href="([^"]+)"/g)).toEqual([`${SITE_ORIGIN}/`]);
    expect(head(index, /<meta property="og:url" content="([^"]+)"/g)).toEqual([`${SITE_ORIGIN}/`]);
    expect(head(index, /<meta property="og:image" content="([^"]+)"/g)).toEqual([`${SITE_ORIGIN}/og-image.png`]);
    expect(head(index, /<meta name="twitter:image" content="([^"]+)"/g)).toEqual([`${SITE_ORIGIN}/og-image.png`]);
    expect(index).not.toMatch(/<meta name="robots"/);
    const png = readFileSync(resolve(frontend, 'public/og-image.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  test('the seven interface languages share one URL per page, so no hreflang alternates are declared', () => {
    expect(index).not.toMatch(/hreflang/i);
    expect(sitemapXml(urls)).not.toMatch(/hreflang|xhtml:link/i);
  });

  test('a public page gets its own title, description and canonical; an old Help copy names the Academy page', () => {
    const terms = withPageHead(index, legalPages().find((page) => page.path === 'legal/terms')!);
    expect(head(terms, /<title>([^<]+)<\/title>/g)).toEqual(['Условия использования — VOLTEX']);
    expect(head(terms, /<link rel="canonical" href="([^"]+)"/g)).toEqual([`${SITE_ORIGIN}/legal/terms`]);
    expect(head(terms, /<meta property="og:url" content="([^"]+)"/g)).toEqual([`${SITE_ORIGIN}/legal/terms`]);
    const fees = withPageHead(index, publicPages(compiled).find((page) => page.path === 'help/fees')!);
    expect(head(fees, /<link rel="canonical" href="([^"]+)"/g)).toEqual([`${SITE_ORIGIN}/academy/knowledge`]);
    const titles = publicPages(compiled).filter((page) => !page.canonical).map((page) => page.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('an unlisted copy carries its robots directive and no canonical or og:url', () => {
    const wallet = withRobots(index, ROBOTS_PRIVATE);
    expect(head(wallet, /<meta name="robots" content="([^"]+)"/g)).toEqual([ROBOTS_PRIVATE]);
    expect(wallet).not.toMatch(/<link rel="canonical"|<meta property="og:url"/);
    const paths = unlistedPages().map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const { path, robots } of unlistedPages()) expect({ path, robots }).toEqual({ path, robots: robotsFor(`/${path}`) });
  });
});

test('in the app, moving between pages keeps canonical, og:url and robots in step with the address', () => {
  const dom = new JSDOM(read('index.html').replace(/<script[\s\S]*?<\/script>/g, ''));
  const doc: Document = dom.window.document;
  const state = () => ({
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    ogUrl: doc.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
    robots: doc.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
  });
  applyRouteSeo(doc, '/academy/faq');
  expect(state()).toEqual({ canonical: `${SITE_ORIGIN}/academy/faq`, ogUrl: `${SITE_ORIGIN}/academy/faq`, robots: null });
  applyRouteSeo(doc, '/wallet');
  expect(state()).toEqual({ canonical: null, ogUrl: null, robots: ROBOTS_PRIVATE });
  applyRouteSeo(doc, '/login');
  expect(state()).toEqual({ canonical: null, ogUrl: null, robots: ROBOTS_UNLISTED });
  applyRouteSeo(doc, '/');
  expect(state()).toEqual({ canonical: `${SITE_ORIGIN}/`, ogUrl: `${SITE_ORIGIN}/`, robots: null });
  expect(doc.querySelectorAll('link[rel="canonical"], meta[property="og:url"]').length).toBe(2);
});
