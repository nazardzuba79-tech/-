import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, join } from 'path';

/**
 * WHICH STYLESHEET SHIPS THE UTILITIES /register AND /wallet USE?
 *
 * Tailwind writes its generated utilities into whichever stylesheet carries
 * `@tailwind utilities`. `content` only decides WHAT is generated, never
 * WHERE it lands. PR #17 fixed the homepage by giving it a directive of its
 * own; these tests record what that left the other two scanned routes
 * standing on, and fail if that ground moves.
 *
 * Audited on main 42a1546, from the production build plus cold-context
 * browser navigations that visited the route and nothing else:
 *
 *   /register — OWNS what it renders. Every class in `src/pages/register/**`
 *     is a hand-written `vx-auth-*` rule from `auth-shell/auth-shell.css`,
 *     declared by `AuthShell.tsx`, which RegisterPage imports. It uses no
 *     Tailwind utility at all, and rendered identically with the utilities
 *     layer stripped out of the eager stylesheet.
 *
 *   /wallet — DOES NOT own them. `wallet-v3/wallet.css` carries no
 *     directive and the built `WalletPage-*.css` contains none of the 293
 *     utilities the page uses. They reach it only because HomePage is eager,
 *     so the homepage's utilities layer — which Tailwind fills with the
 *     union of everything `content` scans, Wallet included — is in the eager
 *     `index-*.css` on every route. Deleting just those rules from the
 *     shipped eager stylesheet collapsed a cold /wallet exactly as the
 *     homepage collapsed before PR #17: `.gap-3` → `normal`, `.rounded-wlg`
 *     → `0px`, `.bg-panel` → transparent, the responsive holdings grid →
 *     `none`.
 *
 * Nothing is broken for a user today, so nothing here is being restructured
 * — see docs/AI_HANDOFF.md for the measured cost of the two candidate fixes.
 * What these tests add is a loud failure if the dependency is ever removed
 * from under Wallet, instead of a silently unstyled page in production.
 */

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every `.ts`/`.tsx` under a path, tests excluded. */
function sources(...roots: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry));
    } else if (/\.tsx?$/.test(p) && !p.includes('__tests__')) {
      out.push(p);
    }
  };
  for (const root of roots) walk(resolve(frontend, root));
  return out;
}

/**
 * Class names written in `className={...}`. Deliberately literal: it reads
 * quoted segments, so an interpolated `${}` contributes nothing rather than
 * a bogus token.
 */
function classNames(files: string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\}(?=\s*(?:\/?>|\n|\s[a-zA-Z-]+=)))/g)) {
      const literal = match[1] ?? match[2];
      const segments = literal !== undefined
        ? [literal]
        : [...(match[3] ?? '').matchAll(/['"`]([^'"`]*)['"`]/g)].map((m) => m[1]);
      for (const segment of segments) {
        for (const cls of segment.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
          if (cls) found.add(cls);
        }
      }
    }
  }
  return found;
}

/** Hand-written project classes and parse noise — never Tailwind output. */
const PROJECT_CLASS = /^(vx-|wallet-|fo-|ob-|crypto-card|lucide|tab$|state$|num$|group$|disabled$|invalid$|period$|p$|hideZero$|[A-Z]|[a-z]+\.[a-zA-Z])/;
const utilitiesIn = (files: string[]) =>
  [...classNames(files)].filter((c) => !PROJECT_CLASS.test(c) && /^-?[a-z]/.test(c)).sort();

describe('/register owns every rule it renders', () => {
  it('uses no Tailwind utility at all — its whole vocabulary is vx-auth-*', () => {
    // The reason a cold /register was unaffected when the utilities layer
    // was stripped out of the eager stylesheet. If this ever fails, the
    // route has started using utilities it does not ship: either give it a
    // directive of its own, or revert to a `vx-auth-*` rule.
    expect(utilitiesIn(sources('src/pages/register'))).toEqual([]);
  });

  it('reaches auth-shell.css through the component that declares it', () => {
    // Ownership, not luck: AuthShell.tsx imports the stylesheet, RegisterPage
    // imports AuthShell, so the CSS travels in whatever chunk pulls the page
    // in — it does not depend on some other route having been visited first.
    expect(read('src/pages/auth-shell/AuthShell.tsx')).toContain("import './auth-shell.css'");
    expect(read('src/pages/register/RegisterPage.tsx')).toContain("from '../auth-shell/AuthShell'");
    expect(read('src/pages/auth-shell/auth-shell.css')).toContain('.vx-auth-form');
  });

  it('and imports no stylesheet of its own to go stale', () => {
    for (const file of sources('src/pages/register')) {
      expect([...readFileSync(file, 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]).toEqual([]);
    }
  });
});

describe('/wallet does NOT own the utilities it uses', () => {
  it('its stylesheet declares no utilities layer', () => {
    // Recorded, not endorsed. This is the fact the rest of this block
    // guards: Wallet is styled by a layer some other page ships.
    expect(read('src/pages/wallet-v3/wallet.css')).not.toContain('@tailwind');
    expect(read('src/pages/WalletPage.tsx')).toContain("import './wallet-v3/wallet.css'");
  });

  it('but it does use them heavily, including responsive and arbitrary values', () => {
    const used = utilitiesIn(sources('src/pages/WalletPage.tsx', 'src/pages/wallet-v3'));
    expect(used.length).toBeGreaterThan(200);
    for (const utility of ['flex-col', 'gap-5', 'rounded-wlg', 'text-ink-3', 'bg-panel', 'shadow-panel']) {
      expect(used).toContain(utility);
    }
    expect(used.some((c) => c.startsWith('xl:grid-cols-[minmax('))).toBe(true);
  });

  it('so tailwind.config must keep scanning it, or the classes stop existing', () => {
    const config = read('tailwind.config.js');
    expect(config).toContain("'./src/pages/WalletPage.tsx'");
    expect(config).toContain("'./src/pages/wallet-v3/**/*.{ts,tsx}'");
    expect(config).toMatch(/corePlugins:\s*\{\s*preflight:\s*false\s*\}/);
  });

  it('and HomePage must stay eager, because that is what delivers them', () => {
    // The load-bearing line. `home-tailwind-utilities.css` is the only
    // directive on a route that is not lazy, so it is the only reason a
    // cold /wallet is styled. Make HomePage lazy without giving Wallet a
    // layer of its own and /wallet ships unstyled — which is precisely the
    // production bug PR #17 fixed for `/`.
    const app = stripComments(read('src/App.tsx'));
    expect(app).toContain("from './pages/home/HomePage'");
    expect(app).not.toMatch(/lazy\(\(\) => import\([^)]*HomePage/);
    expect(read('src/pages/home/HomePage.tsx')).toContain("import './home-tailwind-utilities.css'");
    expect(read('src/pages/home/home-tailwind-utilities.css')).toMatch(/^@tailwind utilities;$/m);
    expect(app).toMatch(/lazy\(\(\) => import\([^)]*WalletPage/);
  });
});

describe('the utilities layers in this repo are the three we think they are', () => {
  it('exactly three stylesheets carry @tailwind utilities, each named', () => {
    const carriers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.css') && readFileSync(full, 'utf8').includes('@tailwind utilities')) {
          carriers.push(full.slice(full.indexOf('src/')));
        }
      }
    };
    walk(resolve(frontend, 'src'));
    expect(carriers.sort()).toEqual([
      'src/pages/crypto-card-final/crypto-card.css',
      'src/pages/home/home-tailwind-utilities.css',
      'src/pages/settings-arctic/tailwind-utilities.css',
    ]);
  });

  it('Crypto Card is the one scoped layer — the precedent for narrowing another', () => {
    // `@config` points Tailwind at a config that scans only the card, with
    // its own `vc-` prefix. That is why CardPage-*.css carries none of the
    // shared union, and it is the mechanism a Wallet-owned layer would use
    // to avoid duplicating ~44 kB of other pages' utilities into its chunk.
    expect(read('src/pages/crypto-card-final/crypto-card.css'))
      .toContain('@config "../../../tailwind.crypto-card.config.js"');
    expect(read('tailwind.crypto-card.config.js'))
      .toContain("content: ['./src/pages/crypto-card-final/**/*.{ts,tsx}']");
  });
});

/**
 * The assertion that would actually have caught the production bug, applied
 * to Wallet. Skipped rather than failed when `dist` is absent, so `npx jest`
 * on a clean checkout is not red for the wrong reason.
 */
describe('build output: a cold /wallet downloads every utility it uses', () => {
  const distAssets = resolve(frontend, 'dist/assets');
  const built = existsSync(distAssets);
  const chunks = built ? readdirSync(distAssets) : [];
  const eager = chunks.filter((f) => /^index-.*\.css$/.test(f));
  const walletChunk = chunks.filter((f) => /^WalletPage-.*\.css$/.test(f));

  /** Undo CSS escaping so a raw class name matches the emitted selector. */
  const plain = (file: string) => readFileSync(join(distAssets, file), 'utf8')
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\/g, '');

  (built && eager.length ? it : it.skip)('every one of them is in the CSS that route fetches', () => {
    // Eager stylesheet ∪ the route's own chunk — exactly what a browser
    // opening /wallet directly, having visited nothing else, downloads.
    // Deliberately indifferent to WHICH of the two supplies them, so this
    // keeps passing if Wallet is ever given a layer of its own, and fails
    // the moment neither does.
    const available = [...eager, ...walletChunk].map(plain).join('\n');
    const missing = utilitiesIn(sources('src/pages/WalletPage.tsx', 'src/pages/wallet-v3'))
      .filter((utility) => !available.includes(`.${utility}`));
    expect(missing).toEqual([]);
  });

  (built && eager.length ? it : it.skip)('and no Tailwind preflight came with them', () => {
    const css = plain(eager[0]);
    expect(css).not.toMatch(/\*,::before,::after\{box-sizing:border-box/);
    expect(css).not.toMatch(/html\{line-height:1\.5/);
  });
});
