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
  // 2026-09-24: the owner first approved the HTML concept's lighter palette,
  // then found it too light beside the reference and asked for the
  // reference's dark theme 1:1 — page #0b0e11, panel #181a20, line #2b3139,
  // buy #0ecb81 (the green the terminal shipped with). The accent stays
  // VOLTEX gold. Still one block, still read by all three terminals —
  // which is the property pinned here.
  for (const token of ['--bg-primary:#0b0e11', '--accent-yellow:#f0b90b',
    '--color-buy:#0ecb81', '--color-sell:#f6465d', '--panel:#181a20', '--border-color:#2b3139']) {
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

it('Spot and CFD carry the final Futures instrument identity hierarchy', () => {
  const spot = read('src/components/TickerBar.tsx');
  expect(spot).toContain('className="pair-cluster"');
  expect(spot).toContain('className="pair-markets-btn"');
  expect(spot).toContain('<CryptoIcon symbol={baseAsset} size={24} />');
  expect(spot).toContain('className="pair-identity"');
  expect(spot).toContain('className="pair-asset"');

  const cfd = read('src/components/CfdTickerBar.tsx');
  expect(cfd).toContain('<CfdInstrumentIcon symbol={symbol} compact />');
  expect(cfd).toContain('cfd-pair-cluster');
  expect(cfd).toContain('cfd-instrument-identity');

  const css = read(SYSTEM);
  expect(css).toContain('INSTRUMENT IDENTITY PARITY');
  expect(css).toContain('ORDER-TICKET PARITY');
  expect(css).toContain('font-size:16px; line-height:20px; font-weight:600');
  expect(css).toContain('min-height:50px; height:50px; border-radius:999px');
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

it('Spot and CFD carry the Futures TradingView surface, value for value', () => {
  // Owner, 2026-09-25: «Внидряй цей дезайн і на спот, і на CFD» — the
  // surface approved on Futures (#258). Pinned against the Futures sheet
  // itself, so the three terminals cannot drift apart in either direction.
  const archive = read('src/pages/trade-terminal/ArchiveTerminalPreview.css');
  const css = read(SYSTEM);
  const P = '.trade-terminal.trade-terminal.vx-terminal.vx-terminal.vx-terminal.vx-terminal.vx-terminal';
  // The rule for `selector` that declares `needle` — a selector such as the
  // Futures root heads several rules in its sheet.
  const block = (source: string, selector: string, needle = '--') => {
    for (let at = source.indexOf(`${selector} {`); at >= 0; at = source.indexOf(`${selector} {`, at + 1)) {
      const body = source.slice(at, source.indexOf('}', at));
      if (body.includes(needle)) return body;
    }
    throw new Error(`no rule for ${selector} declaring ${needle}`);
  };
  const gradient = (text: string) => text.match(/background:\s*(linear-gradient\([^;]*\))\s*!important/)?.[1];

  const futuresRoot = block(archive, '#archive-terminal-preview', 'linear-gradient');
  const spotCfdRoot = block(css, P, 'linear-gradient');
  expect(gradient(spotCfdRoot)).toBeDefined();
  expect(gradient(spotCfdRoot)).toBe(gradient(futuresRoot));
  // The panels' hairline is the Futures one. The token block names the
  // Futures id inside :is(), which outweighs any number of classes; without
  // !important the hairlines stay #2b3139.
  const hairline = futuresRoot.match(/--border:\s*([^;]+);/)?.[1];
  expect(hairline).toBe('rgba(255,255,255,.12)');
  expect(spotCfdRoot).toContain(`--border: ${hairline} !important`);
  // The bottom panel sits under that same line, as on Futures.
  expect(block(css, `${P} :is(.bottom-panel, .cfd-bottom-panel)`, 'box-shadow')).toContain('box-shadow: 0 -1px 0 var(--border)');

  // Both charts paint nothing of their own and take the Futures chart tokens.
  const futuresChart = block(archive, '#archive-terminal-preview .terminal-chart-shell');
  const spotCfdChart = block(css, `${P} :is(.terminal-chart-shell, .cfd-chart)`);
  for (const token of ['--voltex-plot-background: rgba(0,0,0,0)', '--voltex-candle-up: #ffffff',
    '--voltex-candle-down: #ff9800', '--voltex-axis-text: #ffffff', '--voltex-axis-border: rgba(0,0,0,0)']) {
    expect(futuresChart).toContain(token);
    expect(spotCfdChart).toContain(token);
  }
  // «Синій колір ні, обєм залишаємо як і зараз є на біржі»: the CFD volume
  // takes exactly the colours PriceChart already draws on Spot and Futures.
  const priceChart = read('src/components/PriceChart.tsx');
  expect(priceChart).toContain("'rgba(234,236,239,0.5)' : 'rgba(247,166,0,0.5)'");
  expect(spotCfdChart).toContain('--voltex-volume-up: rgba(234,236,239,0.5)');
  expect(spotCfdChart).toContain('--voltex-volume-down: rgba(247,166,0,0.5)');

  // The header captions take the Futures caption grey.
  // The later of the sheet's rules for the captions is the one that wins.
  const captionRules = archive.split('#archive-terminal-preview .ticker-bar .label {').slice(1).map(r => r.slice(0, r.indexOf('}')));
  const futuresCaption = captionRules[captionRules.length - 1]?.match(/color:\s*(#[0-9a-f]{6})/i)?.[1];
  expect(futuresCaption).toBe('#71757a');
  expect(css).toContain(`${P} :is(.ticker-bar .label, .cfd-ticker-metric > span:first-child) { color: ${futuresCaption}; font-weight: 400; }`);

  // Fields stay visible on the gradient, as on the Futures ticket.
  expect(css).toMatch(/:is\(\.order-form-area \.input-group, \.pairs-section input, \.cfd-input, \.cfd-instruments-area input\) \{\s*background: rgba\(255,255,255,\.06\) !important; border: 1px solid rgba\(255,255,255,\.13\) !important;/);
  // The bottom panel keeps its own flat surface.
  expect(css).toMatch(/\.cfd-bottom-panel \.cfd-tabs\) \{\s*background: #101014 !important;/);
});

it('the CFD chart reads its paint from the stylesheet, with its old colours as fallbacks', () => {
  const chart = read('src/components/CfdChart.tsx');
  for (const [token, fallback] of [['--voltex-candle-up', '#12c98d'], ['--voltex-candle-down', '#ef5350'],
    ['--voltex-axis-border', '#2b2e36'], ['--voltex-axis-text', '#aeb9c4'], ['--voltex-plot-background', '#101014'],
    ['--voltex-volume-up', 'rgba(18,201,141,.28)'], ['--voltex-volume-down', 'rgba(239,83,80,.28)']]) {
    expect(chart).toContain(`token('${token}','${fallback}')`);
  }
  // No literal paint left behind the tokens.
  expect(chart).toContain('upColor:up,downColor:down,borderVisible:false,wickUpColor:up,wickDownColor:down');
  expect(chart).toContain('color:bar.close>=bar.open?volumeUpRef.current:volumeDownRef.current');
  expect(chart).not.toContain("borderColor:'#2b2e36'");
});
