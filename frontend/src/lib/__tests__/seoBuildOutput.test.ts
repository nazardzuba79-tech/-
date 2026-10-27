import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { compileContent } from '../content/compile';
import { publicPages, robotsTxt, sitemapUrls, sitemapXml, unlistedPages } from '../seo/pages';
import { SITE_ORIGIN } from '../seo/site';

/**
 * Issue #632, on the real build output (frontend/dist, from `npm run build
 * --prefix frontend`; skipped when absent). What a crawler reads without
 * running a script: every sitemap URL is a file Pages serves, with exactly
 * that canonical and no noindex; every signed-in or sign-in copy is noindex
 * with no canonical; nothing would switch the SPA fallback off.
 */

const frontend = resolve(__dirname, '../../..');
const dist = resolve(frontend, 'dist');
const built = existsSync(join(dist, 'index.html'));
const run = built ? test : test.skip;

const contentDir = resolve(frontend, 'content');
function readTree(dir: string, files: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) readTree(full, files);
    else files[relative(contentDir, full).split(sep).join('/')] = readFileSync(full, 'utf8');
  }
  return files;
}

/** The file Cloudflare Pages answers an address with: /x/y → x/y.html, / → index.html. */
const fileFor = (url: string) => {
  const path = url.slice(SITE_ORIGIN.length).replace(/^\//, '');
  return join(dist, path ? `${path}.html` : 'index.html');
};
const all = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);

run('sitemap.xml and robots.txt in dist are exactly what the policy produces', () => {
  const compiled = compileContent(readTree(contentDir));
  expect(readFileSync(join(dist, 'sitemap.xml'), 'utf8')).toBe(sitemapXml(sitemapUrls(compiled)));
  expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toBe(robotsTxt());
  // A top-level 404.html would turn off the Pages SPA fallback every signed-in deep link relies on.
  expect(existsSync(join(dist, '404.html'))).toBe(false);
});

run('every sitemap URL is served as a page whose raw head names exactly that URL and is indexable', () => {
  const urls = all(readFileSync(join(dist, 'sitemap.xml'), 'utf8'), /<loc>([^<]+)<\/loc>/g);
  expect(urls.length).toBeGreaterThan(30);
  const titles = new Set<string>();
  for (const url of urls) {
    const file = fileFor(url);
    expect({ url, exists: existsSync(file) }).toEqual({ url, exists: true });
    const html = readFileSync(file, 'utf8');
    expect({ url, canonical: all(html, /<link rel="canonical" href="([^"]+)"/g), ogUrl: all(html, /<meta property="og:url" content="([^"]+)"/g) })
      .toEqual({ url, canonical: [url], ogUrl: [url] });
    expect(html).not.toMatch(/<meta name="robots"/);
    const [title] = all(html, /<title>([^<]+)<\/title>/g);
    expect(title.length).toBeGreaterThan(5);
    titles.add(title);
    const [description] = all(html, /<meta name="description" content="([^"]*)"/g);
    expect(description.length).toBeGreaterThan(20);
    expect(all(html, /<meta property="og:image" content="([^"]+)"/g)).toEqual([`${SITE_ORIGIN}/og-image.png`]);
    // The same app: every static copy loads the one entry module of this build.
    expect(all(html, /<script type="module"[^>]*src="([^"]+)"/g)).toEqual(all(readFileSync(join(dist, 'index.html'), 'utf8'), /<script type="module"[^>]*src="([^"]+)"/g));
  }
  expect(titles.size).toBe(urls.length);
  expect(existsSync(join(dist, 'og-image.png'))).toBe(true);
});

run('old Help copies point at the Academy, and signed-in and sign-in copies are noindex without a canonical', () => {
  const compiled = compileContent(readTree(contentDir));
  for (const page of publicPages(compiled).filter((p) => p.canonical)) {
    const html = readFileSync(join(dist, `${page.path}.html`), 'utf8');
    expect({ page: page.path, canonical: all(html, /<link rel="canonical" href="([^"]+)"/g) }).toEqual({ page: page.path, canonical: [page.canonical] });
  }
  for (const { path, robots } of unlistedPages()) {
    const html = readFileSync(join(dist, `${path}.html`), 'utf8');
    expect({ path, robots: all(html, /<meta name="robots" content="([^"]+)"/g), canonical: /<link rel="canonical"/.test(html), ogUrl: /<meta property="og:url"/.test(html) })
      .toEqual({ path, robots: [robots], canonical: false, ogUrl: false });
  }
});
