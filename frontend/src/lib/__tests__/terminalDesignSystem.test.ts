import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * ONE TERMINAL DESIGN SYSTEM, AND FUTURES UNTOUCHED BY IT.
 *
 * Measured on main before this existed: ten of the eleven core tokens differed
 * between the approved Futures terminal and Spot/CFD, because the palette was
 * declared inside ArchiveTerminalPreview.css under `#archive-terminal-preview`
 * and nothing else could reach it. Ten stylesheets in that folder define
 * `--bg-primary`; whichever loaded last for a page won, and the three
 * terminals had landed on different answers.
 *
 * These cases pin the structure of the fix rather than its pixels — the
 * browser harness (scripts/qa-spot-cfd-terminal.cjs) measures the pixels, at
 * five viewports, against Futures itself.
 */

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8');
const SYSTEM = 'src/pages/trade-terminal/VoltexTerminalSystem.css';

it('the palette is declared once, and both terminals read that one block', () => {
  const css = read(SYSTEM);
  // The ID branch is what keeps Futures exactly where it was: `:is()` takes
  // the HIGHEST specificity among its arguments, so the id still weighs 100,
  // which is what decided the winner among those ten stylesheets before.
  expect(css).toMatch(/:is\(#archive-terminal-preview,\s*\.trade-terminal\.vx-terminal\)/);
  // 2026-09-24: the values are the owner-approved lighter palette of the
  // HTML concept (canvas #171c25, panel #1d232e, line #2e3644, buy
  // #2ebd85); the accent stays VOLTEX gold. Still one block, still read by
  // all three terminals — which is the property pinned here.
  for (const token of ['--bg-primary:#171c25', '--accent-yellow:#f0b90b',
    '--color-buy:#2ebd85', '--color-sell:#f6465d', '--panel:#1d232e', '--border-color:#2e3644']) {
    expect(css).toContain(token);
  }
  // …and the copy it replaced is gone, so there is nothing to drift against.
  const archive = read('src/pages/trade-terminal/ArchiveTerminalPreview.css');
  expect(archive).not.toMatch(/--bg-primary:\s*#080a0f/);
  expect(archive).not.toMatch(/--accent-yellow:\s*#f0b90b/);
});

it('Futures is unreachable from the shared Spot/CFD rules', () => {
  // The guarantee that Futures cannot break is structural, not a promise:
  // every rule below the token block is scoped to `.vx-terminal`, and the
  // Futures root does not carry it.
  const futures = read('src/pages/FuturesPage.tsx');
  const futuresRoot = futures.match(/className=\{`trade-terminal[^`]*`\}/)?.[0] ?? '';
  expect(futuresRoot).not.toContain('vx-terminal');
  expect(futures).toContain("import './trade-terminal/VoltexTerminalSystem.css'");

  const trade = read('src/pages/TradePage.tsx');
  expect(trade).toContain("import './trade-terminal/VoltexTerminalSystem.css'");
  expect(trade).toMatch(/trade-terminal spot-terminal[^"]*vx-terminal/);
  expect(trade).toMatch(/trade-terminal cfd-terminal[^"]*vx-terminal/);
});

it('the shared rules carry enough weight to actually apply', () => {
  // Not pedantry. This folder layers by specificity — MarketReferenceTerminal
  // writes `.trade-terminal.trade-terminal.market-reference`, TerminalStudio
  // repeats its marker five times — and because both pages import the shared
  // file, Vite hoists it into a chunk served BEFORE the page's own sheets, so
  // every tie is lost. With a two-class prefix, Spot's strip measured 70px and
  // transparent, i.e. completely unchanged. Seven clears the folder's highest.
  const rules = read(SYSTEM).split('\n').filter(l => l.trim().startsWith('.trade-terminal') && l.includes('vx-terminal'));
  expect(rules.length).toBeGreaterThan(10);
  for (const rule of rules) {
    expect(rule.match(/\.vx-terminal/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  }
});

it('no Futures-only trading concept leaks into the Spot or CFD shells', () => {
  // Design consistency was the ask; business-logic mixing explicitly was not.
  // Spot has no leverage, no liquidation price and no funding, so the shell
  // must not render controls implying it does — a fake control on a trading
  // screen is worse than an inconsistent one.
  const trade = read('src/pages/TradePage.tsx');
  for (const forbidden of ['liquidationPrice', 'fundingRate', 'isolatedMargin', 'crossMargin']) {
    expect(trade).not.toContain(forbidden);
  }
  // The shared stylesheet must not smuggle them in either.
  const css = read(SYSTEM);
  for (const cls of ['.fo-mlWrap', '.liq-price', '.funding-countdown', '.leverage-slider']) {
    expect(css).not.toContain(cls);
  }
});

it('the shared sheet styles, and never lays out, the shells it does not own', () => {
  // The Futures terminal is a three-column grid whose track map is written
  // against its own DOM; Spot and CFD are flex compositions with different
  // children, and CFD has no order book at all. Copying that grid across
  // would not make them consistent — it would break them.
  const spotCfdRules = read(SYSTEM)
    .split('}').filter(block => block.includes('.vx-terminal'));
  const layout = spotCfdRules.filter(b => /grid-template-columns|grid-area/.test(b)
    && !/ticker|cfd-selected-instrument|cfd-ticker-metric/.test(b));
  expect(layout).toEqual([]);
});
