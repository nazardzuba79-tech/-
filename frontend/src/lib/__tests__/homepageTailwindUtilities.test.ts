import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

/**
 * The homepage must OWN the Tailwind utilities it uses.
 *
 * The production bug this locks: `HomePage.tsx` and its sections are
 * written in Tailwind utilities (`flex`, `flex-col`, `gap-5`, `pb-7`,
 * `grid`, `md:grid-cols-*`, `text-home-muted`, …), and tailwind.config.js
 * has always scanned `./src/pages/home/**`, so those utilities were
 * generated. What was missing is where they were EMITTED: Tailwind writes
 * them into whichever stylesheet carries `@tailwind utilities`, and only
 * Settings and Crypto Card carried one.
 *
 * While everything shipped in a single monolithic stylesheet that was
 * invisible — the homepage silently borrowed utilities emitted for other
 * routes. Route code splitting moved those files into lazy chunks that `/`
 * never loads, and the borrowed styles went with them, so voltextech.net
 * served a homepage with `.vx-home` chrome and no layout at all.
 *
 * Measured on the production build before the fix: the eager `index-*.css`
 * contained ZERO occurrences of `flex-col`, `gap-5`, `pb-7` or
 * `grid-cols-1`, and a browser on a cold `/` computed `display: block` for
 * `.flex-col` and `gap: normal` for `.gap-5`.
 *
 * These tests assert the dependency is explicit and local, so it cannot be
 * broken again by moving another route's CSS.
 */

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');
const HOME_CSS = 'src/pages/home/home.css';
/** The homepage's own utilities layer, mirroring settings-arctic's. */
const HOME_UTILITIES_CSS = 'src/pages/home/home-tailwind-utilities.css';

/** Utilities the homepage genuinely uses — the ones that broke. */
const REQUIRED_UTILITIES = ['flex-col', 'gap-5', 'pb-7', 'grid-cols-1'];

describe('the homepage owns its Tailwind utilities', () => {
  it('1. HomePage imports its own homepage CSS', () => {
    const page = read('src/pages/home/HomePage.tsx');
    expect(page).toContain("import './home.css'");
    expect(existsSync(resolve(frontend, HOME_CSS))).toBe(true);
  });

  it('2. HomePage imports a homepage-owned stylesheet declaring @tailwind utilities', () => {
    const page = read('src/pages/home/HomePage.tsx');
    expect(page).toContain("import './home-tailwind-utilities.css'");
    expect(existsSync(resolve(frontend, HOME_UTILITIES_CSS))).toBe(true);
    expect(read(HOME_UTILITIES_CSS)).toMatch(/^@tailwind utilities;$/m);
  });

  it('2b. the utilities layer is imported AFTER home.css, so a utility wins ties', () => {
    // The `:where(.vx-home)` block in home.css is the homepage's
    // zero-specificity stand-in for the preflight that is deliberately
    // switched off — but the ordinary `.vx-home` rules there score 0,1,0,
    // the same as a utility. Order is what breaks those ties, and CSS is
    // emitted in import order.
    const page = read('src/pages/home/HomePage.tsx');
    expect(page.indexOf("import './home.css'"))
      .toBeLessThan(page.indexOf("import './home-tailwind-utilities.css'"));
  });

  it('2c. home.css itself is untouched by this fix — no design drift', () => {
    // The approved homepage design is fingerprinted by two preservation
    // suites. A build-plumbing fix must not perturb it, which is exactly
    // why the directive lives in its own file.
    expect(read(HOME_CSS)).not.toContain('@tailwind');
  });

  it('3. tailwind.config scans the homepage sources', () => {
    const config = read('tailwind.config.js');
    expect(config).toContain("'./src/pages/home/**/*.{ts,tsx}'");
  });

  it('4. preflight stays disabled — this ships utilities, never a global reset', () => {
    const config = read('tailwind.config.js');
    expect(config).toMatch(/corePlugins:\s*\{\s*preflight:\s*false\s*\}/);
    expect(config).not.toMatch(/preflight:\s*true/);
  });

  it('the homepage keeps its own scoped stand-in for the disabled preflight', () => {
    // Removing this while preflight is off would give the homepage bare
    // browser chrome on buttons and inputs.
    const css = read(HOME_CSS);
    expect(css).toContain(':where(.vx-home) button');
  });
});

describe('the homepage does not borrow another route\'s stylesheet', () => {
  it('6. Settings and Crypto Card still own their own utilities, and are lazy', () => {
    // The bug was the homepage depending on THESE. They keep their
    // directives — the fix adds one, it does not move one.
    expect(read('src/pages/settings-arctic/tailwind-utilities.css')).toContain('@tailwind utilities;');
    expect(read('src/pages/crypto-card-final/crypto-card.css')).toContain('@tailwind utilities;');

    const app = read('src/App.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const page of ['SettingsPage', 'CardPage']) {
      expect(app).toMatch(new RegExp(`lazy\\(\\(\\) => import\\([^)]*${page}`));
    }
  });

  it('7. route splitting is intact: the homepage is eager, the rest are not', () => {
    const app = read('src/App.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(app).toContain("from './pages/home/HomePage'");
    for (const page of ['TradePage', 'FuturesPage', 'WalletPage', 'CopyTradingPage']) {
      expect(app).toMatch(new RegExp(`lazy\\(\\(\\) => import\\([^)]*${page}`));
    }
  });

  it('no homepage file imports another route\'s stylesheet', () => {
    // The homepage DOES reuse Crypto Card COMPONENTS (VoltexCard,
    // WatchCardVisual, useCardCopy) and that is fine — those files import
    // no CSS of their own. What must never happen is the homepage reaching
    // for another route's stylesheet, which is exactly the coupling that
    // broke: `crypto-card.css` is imported only by the lazy CardPage and
    // `tailwind-utilities.css` only by the lazy SettingsPage, so neither
    // reaches a cold `/`.
    const dir = resolve(frontend, 'src/pages/home');
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(join(dir, file), 'utf8');
      const cssImports = [...src.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1]);
      for (const imported of cssImports) {
        // Homepage-local only: `./something.css`. Anything with a `../`
        // segment would be reaching into another route's stylesheet, which
        // is precisely the coupling that broke production.
        expect(imported.startsWith('./')).toBe(true);
        expect(imported).not.toContain('..');
      }
    }
  });

  it('the two borrowed stylesheets are still reachable ONLY from their lazy pages', () => {
    const importers = (needle: string) => {
      const found: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!/\.tsx?$/.test(entry.name) || full.includes('__tests__')) continue;
          // Match the FILENAME at a path boundary. Without the boundary,
          // `tailwind-utilities.css` also matches the homepage's own
          // `home-tailwind-utilities.css`, and the assertion silently
          // stops meaning what it says.
          const src = readFileSync(full, 'utf8');
          if (src.match(new RegExp(`import\\s+['"][^'"]*[/']${needle.replace('.', '\\.')}['"]`))) {
            found.push(full.slice(full.indexOf('src/')));
          }
        }
      };
      walk(resolve(frontend, 'src'));
      return found;
    };
    expect(importers('crypto-card.css')).toEqual(['src/pages/CardPage.tsx']);
    expect(importers('tailwind-utilities.css')).toEqual(['src/pages/SettingsPage.tsx']);
  });
});

/**
 * The build-output assertion. Skipped rather than failed when `dist` is
 * absent, so `npx jest` on a clean checkout is not red for the wrong
 * reason — but it runs in any pipeline that builds first, which is where a
 * regression would actually show up.
 */
describe('5. the built EAGER stylesheet carries the homepage utilities', () => {
  const distAssets = resolve(frontend, 'dist/assets');
  const built = existsSync(distAssets);
  const indexCss = built
    ? readdirSync(distAssets).filter((f) => /^index-.*\.css$/.test(f))
    : [];

  (built && indexCss.length ? it : it.skip)('index-*.css contains the utilities `/` needs', () => {
    // One eager stylesheet is what a cold `/` downloads; every homepage
    // utility has to be in it, because no other CSS is fetched.
    expect(indexCss).toHaveLength(1);
    const css = readFileSync(join(distAssets, indexCss[0]), 'utf8');
    for (const utility of REQUIRED_UTILITIES) {
      expect(css).toContain(utility);
    }
    // A responsive variant, proving the `md:` breakpoints ship too.
    expect(css).toMatch(/@media[^{]*\{[^}]*\.md\\:/);
  });

  (built && indexCss.length ? it : it.skip)('and still carries no Tailwind preflight reset', () => {
    const css = readFileSync(join(distAssets, indexCss[0]), 'utf8');
    // Signature preflight rules. Their absence is what keeps Trade,
    // Futures and Admin free of a global element reset.
    expect(css).not.toMatch(/\*,::before,::after\{box-sizing:border-box/);
    expect(css).not.toMatch(/html\{line-height:1\.5/);
  });
});
