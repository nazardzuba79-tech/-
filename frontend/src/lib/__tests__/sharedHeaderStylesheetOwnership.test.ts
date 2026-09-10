import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';

/**
 * WHO IS ALLOWED TO STYLE THE SHARED AUTHENTICATED HEADER?
 *
 * The production defect this file guards: on /futures and /trade the whole
 * navigation collapsed into the top-left corner — logo and links crushed
 * together, no horizontal padding, no vertical centring — while every other
 * authenticated route rendered it correctly.
 *
 * Nothing was wrong with the header's own CSS. `.global-header` in the
 * eager `index.css` still said `padding: 0 28px`, `.nav-item` still said
 * `padding: 0 11px; margin: 8px 0`. They were being overridden:
 *
 *   .trade-terminal *,
 *   .trade-terminal *::before,
 *   .trade-terminal *::after { margin: 0; padding: 0; box-sizing: border-box; }
 *
 * The shared <header class="global-header"> renders INSIDE
 * `div.trade-terminal` on both terminals (see TradePage/FuturesPage), so a
 * bare `.trade-terminal *` reached it. Both selectors score 0,1,0, and
 * `TradeTerminal.css` travels in a LAZY route chunk that the browser loads
 * AFTER the eager `index.css` — so it won every tie, on those two routes
 * only, because no other route loads that chunk.
 *
 * Two invariants keep that from coming back, and both are tested here:
 *
 *   1. No route stylesheet may MOVE the shared header. A page-root blanket
 *      reset either excludes the header or declares nothing that can shift
 *      a box.
 *   2. The shared header may not DEPEND on a route stylesheet either. Every
 *      structural class it renders is declared in the eager `index.css`,
 *      which `main.tsx` imports directly, so the header is identical on a
 *      cold load of any route and after any client navigation. A lazy
 *      stylesheet must never be the reason the nav looks right.
 */

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');

/** The eager stylesheet — `main.tsx` imports it, so it is on every route. */
const EAGER_SHEET = 'src/index.css';

/** Every `.css` under `src`, repo-relative, sorted. */
function stylesheets(): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else if (p.endsWith('.css')) out.push(relative(frontend, p));
  };
  walk(resolve(frontend, 'src'));
  return out.sort();
}

/**
 * Top-level selector preludes and their declaration blocks, comments and
 * strings removed first so a `content: "{"` cannot confuse brace counting.
 * At-rule bodies (`@media`) are descended into; the at-rule itself is not
 * a selector, so it is dropped.
 */
function rules(css: string): { selector: string; declarations: string }[] {
  const src = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const out: { selector: string; declarations: string }[] = [];
  let buf = '';
  const stack: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      if (prelude.startsWith('@')) {
        stack.push('@');
        continue;
      }
      // A rule body: consume it whole (nesting is not used in this repo's
      // hand-written CSS, so the matching brace is the next one).
      let depth = 1;
      let body = '';
      while (++i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
        body += src[i];
      }
      out.push({ selector: prelude.replace(/\s+/g, ' '), declarations: body });
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

/** Splits a selector list on top-level commas — commas inside `:not()`,
 *  `:where()` or `:is()` belong to that pseudo-class, not to the list. */
function selectorList(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of selector) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; } else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Compounds of a single complex selector, combinators dropped. */
function compounds(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && /[\s>+~]/.test(ch)) { if (buf) out.push(buf); buf = ''; } else buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Properties that move a box. A reset that sets any of these on the header
 * is the defect; `box-sizing`, `border-*`, `outline` and Tailwind's `--tw-*`
 * variables are not, which is why every other page-root reset in this repo
 * (`.vx-wallet *`, `.markets-bolt-root *`, `.copytrading-bolt-root *`,
 * `:where(.crypto-card-page) *`, `.vx-home *`, `.vx-auth *`) is allowed to
 * stay exactly as it is.
 */
const MOVES_A_BOX =
  /(^|;)\s*(margin|padding|display|position|height|width|gap|flex|grid|order|float|align-[a-z]+|justify-[a-z]+|place-[a-z]+|top|right|bottom|left|inset|font-size|line-height|transform|visibility)\b/;

const EXCLUDES_HEADER = /:not\(\s*:where\([^)]*\.global-header[^)]*\)\s*\)/;

describe('no route stylesheet may move the shared authenticated header', () => {
  /**
   * A page-root blanket reset: `<one compound> *`. Deeper universals
   * (`.markets-bolt-root .highlight-row > *:not(:first-child)`) target a
   * specific inner container and cannot reach a header that is a child of
   * the page root, so they are not in scope here.
   */
  const pageRootResets = () => {
    const found: { file: string; selector: string; declarations: string }[] = [];
    for (const file of stylesheets()) {
      if (file === EAGER_SHEET) continue;
      for (const rule of rules(read(file))) {
        for (const sel of selectorList(rule.selector)) {
          const parts = compounds(sel);
          if (parts.length !== 2) continue;
          if (!/^\*/.test(parts[1])) continue;
          found.push({ file, selector: sel, declarations: rule.declarations });
        }
      }
    }
    return found;
  };

  it('finds the page-root resets this repo actually ships', () => {
    // A guard on the guard: if the scanner silently stops matching, the
    // assertions below would pass over an empty list.
    const files = [...new Set(pageRootResets().map((r) => r.file))].sort();
    expect(files).toEqual([
      'src/pages/auth-shell/auth-shell.css',
      'src/pages/copy-trading-bolt/CopyTradingBolt.css',
      'src/pages/crypto-card-final/crypto-card.css',
      'src/pages/home/home.css',
      'src/pages/markets-bolt/MarketsBolt.css',
      'src/pages/trade-terminal/TradeTerminal.css',
      'src/pages/wallet-v3/wallet.css',
    ]);
  });

  it('and none of them shifts a box without excluding the header', () => {
    const offenders = pageRootResets()
      .filter((r) => MOVES_A_BOX.test(r.declarations) && !EXCLUDES_HEADER.test(r.selector))
      .map((r) => `${r.file}: ${r.selector}`);
    // This is the assertion that fails on the production defect: before the
    // fix it reported `.trade-terminal *`, `.trade-terminal *::before` and
    // `.trade-terminal *::after`, all three setting `margin: 0; padding: 0`.
    expect(offenders).toEqual([]);
  });

  it('the terminal reset keeps its own scope, at unchanged specificity', () => {
    const css = read('src/pages/trade-terminal/TradeTerminal.css');
    // Still a real reset — the fix narrows it, it does not delete it.
    expect(css).toMatch(/\.trade-terminal \*:not\(:where\(\.global-header, \.global-header \*\)\)/);
    expect(css).toMatch(/margin: 0;\s*\n\s*padding: 0;\s*\n\s*box-sizing: border-box;/);
    // `:where()` contributes zero specificity, so the selector still scores
    // exactly 0,1,0 and everything inside the terminal cascades as before.
    // A bare `:not(.global-header, .global-header *)` would raise it to
    // 0,2,0 and start winning ties it used to lose.
    for (const sel of selectorList(
      rules(css).find((r) => r.selector.includes('.trade-terminal *'))!.selector,
    )) {
      expect(sel).toContain(':not(:where(');
    }
  });

  it('because the header really does render inside those page wrappers', () => {
    // The structural fact that makes all of the above load-bearing. If a
    // page ever stops nesting the shared Nav, that is fine — but it is not
    // what any of this is relying on.
    const nested: [string, string][] = [
      ['src/pages/FuturesPage.tsx', 'trade-terminal futures-terminal'],
      ['src/pages/TradePage.tsx', 'trade-terminal spot-terminal'],
      ['src/pages/TradePage.tsx', 'trade-terminal cfd-terminal'],
      ['src/pages/WalletPage.tsx', 'vx-wallet'],
      ['src/pages/CopyTradingPage.tsx', 'copytrading-bolt-root'],
      ['src/pages/markets-bolt/components.tsx', 'markets-bolt-root'],
    ];
    for (const [file, wrapper] of nested) {
      const src = read(file);
      const open = src.indexOf(wrapper);
      expect(open).toBeGreaterThan(-1);
      expect(src.indexOf('<Nav', open)).toBeGreaterThan(open);
    }
  });
});

/**
 * The classes the shared header renders inside its own <header> element.
 * The mobile drawer and the burger are included: they are part of the same
 * component and the same production defect surface. The ticker strip and
 * BottomNav are NOT — Nav renders them as siblings after </header>, and
 * routes deliberately restyle them (see `.trade-terminal .market-ticker-static`
 * and `.settings-arctic-root .bottom-nav-liquid-glass`).
 */
const HEADER_CLASSES = [
  'global-header', 'top-nav-bar', 'header-left', 'header-brand', 'brand-separator',
  'main-nav', 'nav-desktop-links', 'nav-item', 'nav-item-wrap', 'nav-dropdown',
  'nav-secondary', 'nav-admin', 'nav-chevron', 'nav-active',
  'header-actions', 'nav-desktop-right', 'deposit-button', 'header-extra-action',
  'top-nav-profile-wrap', 'top-nav-profile-btn', 'top-nav-profile-menu',
  'top-nav-profile-avatar', 'header-icon', 'profile-control',
  'mobile-menu', 'nav-burger', 'nav-mobile-menu',
];

describe('the shared authenticated header does not depend on a lazy stylesheet', () => {
  it('every class it renders is a class Nav.tsx actually writes', () => {
    const nav = read('src/components/Nav.tsx');
    for (const cls of HEADER_CLASSES) expect(nav).toContain(cls);
  });

  it('and Nav imports no stylesheet of its own — index.css carries it', () => {
    expect(read('src/main.tsx')).toContain("import './index.css'");
    for (const file of ['Nav', 'BottomNav', 'LanguageSwitcher', 'TopGainersTicker', 'DepositModal', 'Logo']) {
      expect(read(`src/components/${file}.tsx`)).not.toMatch(/import\s+['"][^'"]+\.css['"]/);
    }
  });

  it('the layout the production defect destroyed is declared there, eagerly', () => {
    const css = read(EAGER_SHEET);
    const rule = (selector: string) =>
      rules(css).find((r) => selectorList(r.selector).includes(selector))?.declarations ?? '';
    expect(rule('.global-header')).toMatch(/padding:\s*0 28px/);
    expect(rule('.global-header')).toMatch(/height:\s*64px/);
    expect(rule('.global-header')).toMatch(/align-items:\s*stretch/);
    expect(rule('.nav-item')).toMatch(/padding:\s*0 11px/);
    expect(rule('.nav-item')).toMatch(/margin:\s*8px 0/);
    expect(rule('.main-nav')).toMatch(/display:\s*flex/);
  });

  it('and no route stylesheet declares a rule whose subject is a header class', () => {
    const subjects: string[] = [];
    for (const file of stylesheets()) {
      if (file === EAGER_SHEET) continue;
      for (const rule of rules(read(file))) {
        for (const sel of selectorList(rule.selector)) {
          const last = compounds(sel).pop() ?? '';
          // Only the SUBJECT counts. `.trade-terminal *:not(:where(.global-header…))`
          // names a header class in order to stay away from it.
          for (const cls of HEADER_CLASSES) {
            if (new RegExp(`\\.${cls}(?![\\w-])`).test(last.replace(/:(not|where|is)\([^)]*\)/g, ''))) {
              subjects.push(`${file}: ${sel}`);
            }
          }
        }
      }
    }
    // One documented leftover, on a page that renders no shared Nav at all:
    // auth-shell.css styles `.header-icon` under `.vx-auth-work`, the login
    // shell. Recorded here rather than silently allowed, so the list cannot
    // grow without someone deciding it should.
    //
    // `.copytrading-bolt-root .mobile-menu` used to be on this list too, on
    // the reasoning that a `display: grid !important` in the archive's own
    // `max-width: 760px` block put the burger back. The audit measured that
    // and it was false: index.css shows the burger from 860px down, so
    // between 761px and 860px the hide won and /copy-trading had NO header
    // navigation at all — `.main-nav` hidden by the media query, the burger
    // hidden by the route chunk. Both archive rules are gone; the exception
    // is not documented any more because there is nothing left to document.
    expect([...new Set(subjects)].sort()).toEqual([
      'src/pages/auth-shell/auth-shell.css: .vx-auth-work .header-icon',
      'src/pages/auth-shell/auth-shell.css: .vx-auth-work .header-icon:hover',
    ]);
  });

  it('and the shared burger is index.css\'s alone, at every width', () => {
    // The specific regression: a route chunk may not decide whether the
    // shared header's burger is shown. Nothing outside the eager stylesheet
    // may set `display` on `.mobile-menu` — not to hide it, and not with an
    // `!important` that puts it back, which is what made the gap between
    // the two media queries invisible in review.
    const offenders: string[] = [];
    for (const file of stylesheets()) {
      if (file === EAGER_SHEET) continue;
      for (const rule of rules(read(file))) {
        if (!/(^|;)\s*display\s*:/.test(rule.declarations)) continue;
        for (const sel of selectorList(rule.selector)) {
          if (/\.(mobile-menu|nav-burger|main-nav|nav-mobile-menu)(?![\w-])/.test(sel)) offenders.push(`${file}: ${sel}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The same two invariants against the real emitted CSS, which is where a
 * Tailwind layer or a postcss plugin could reintroduce either one without
 * touching a source file. Skipped rather than failed when `dist` is absent,
 * so `npx jest` on a clean checkout is not red for the wrong reason — the
 * repo's other build-output block does the same.
 */
describe('build output: the shipped chunks agree', () => {
  const distAssets = resolve(frontend, 'dist/assets');
  const built = existsSync(distAssets);
  const chunks = built ? readdirSync(distAssets).filter((f) => f.endsWith('.css')) : [];
  const eager = chunks.filter((f) => /^index-.*\.css$/.test(f));

  (built && eager.length ? it : it.skip)('the eager chunk still ships the header layout', () => {
    const css = readFileSync(join(distAssets, eager[0]), 'utf8');
    expect(css).toMatch(/\.global-header\{[^}]*padding:0 28px/);
    expect(css).toMatch(/\.nav-item\{[^}]*padding:0 11px/);
  });

  (built && eager.length ? it : it.skip)('and no lazy chunk blanket-resets it', () => {
    const offenders: string[] = [];
    for (const chunk of chunks) {
      if (eager.includes(chunk)) continue;
      for (const rule of rules(readFileSync(join(distAssets, chunk), 'utf8'))) {
        for (const sel of selectorList(rule.selector)) {
          const parts = compounds(sel);
          if (parts.length !== 2 || !/^\*/.test(parts[1])) continue;
          if (MOVES_A_BOX.test(rule.declarations) && !EXCLUDES_HEADER.test(sel)) {
            offenders.push(`${chunk}: ${sel}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
