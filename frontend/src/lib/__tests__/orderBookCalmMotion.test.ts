import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const book = read('frontend/src/components/FuturesReferenceBook.tsx');
const css = read('frontend/src/pages/trade-terminal/TerminalAccountPanel.css');
/** Comments explain the rules; they must not be able to satisfy them. */
const code = book.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The ladder's flicker, pinned.
 *
 * Measured on a replayed, seeded feed (scripts/qa-orderbook-motion.cjs):
 * keying rows by price tore down and rebuilt 215 rows in 15 seconds — 14.3
 * per second — because a ladder's prices move with the market, so a shifting
 * book handed React a new key for a slot that had not gone anywhere. Every
 * rebuilt row restarted its depth-bar transition from zero, which is the
 * twitch. Keyed by depth slot the same feed remounts nothing at all.
 */
describe('order book rows keep their DOM across a moving ladder', () => {
  it('keys a price row by its depth slot, never by the price in it', () => {
    const rowsFn = code.slice(code.indexOf('const rows = ('), code.indexOf('return <div className="reference-book"'));
    expect(rowsFn).toContain('key={`${side}-${index}`}');
    // The old key. A price in the key is the regression.
    expect(rowsFn).not.toMatch(/key=\{exact\}/);
    expect(rowsFn).not.toMatch(/key=\{[^}]*price[^}]*\}/i);
  });

  it('still renders the level it was given — the slot is identity, not content', () => {
    const rowsFn = code.slice(code.indexOf('const rows = ('), code.indexOf('return <div className="reference-book"'));
    // Price, size and cumulative all still come from the level, and the row
    // still submits the exact price it displays.
    expect(rowsFn).toContain('referencePrice(level.price, step)');
    expect(rowsFn).toContain('referenceQuantity(level.quantity)');
    expect(rowsFn).toContain('referenceQuantity(level.cumulative)');
    expect(rowsFn).toContain('onPickPrice(exact)');
    expect(rowsFn).toContain('level.cumulative / maxDepth');
  });
});

/**
 * The centre price must not move when only its direction changes.
 *
 * The arrow used to be concatenated into the price string, so `↑77,264.70`
 * and `77,264.70` are different widths and the digits slid sideways on a
 * tick that had changed no digit at all.
 */
describe('centre price and its direction arrow hold their position', () => {
  it('renders the arrow as its own element, not as part of the number', () => {
    expect(code).toContain('className="rb-arrow"');
    expect(code).toContain('className="rb-last"');
    // The old shape: a template string that prefixed the glyph onto the price.
    expect(code).not.toMatch(/\$\{direction === 'up' \? '↑'[^}]*\}\$\{referencePrice/);
  });

  it('gives the arrow a fixed width so either glyph, or neither, occupies the same space', () => {
    const arrow = css.slice(css.indexOf('.rb-center .rb-arrow'));
    expect(arrow).toMatch(/width:0\.\d+em/);
    expect(arrow).toContain('text-align:center');
  });

  it('still reports the direction it measured, and still says which price it is', () => {
    expect(code).toContain("setDirection(last > old.price ? 'up' : 'down')");
    expect(code).toContain("t('trade.lastPrice')");
  });
});

/**
 * Depth bars: the reference draws a dark, low-contrast staircase. Ours drew
 * the same geometry at 30% alpha, which reads as a solid block and makes
 * every size change a flash.
 */
describe('depth bars are muted and settle between publishes', () => {
  const rule = css.slice(css.indexOf('.repaired-futures-book .rb-depth {', css.indexOf('Order-book calm')));

  it('draws the bars well under the old 30% alpha', () => {
    const alphas = [...css.matchAll(/rgba\((?:14,203,129|246,70,93),\.(\d+)\)/g)].map((m) => Number('0.' + m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.15);
  });

  it('finishes each bar before the next publish rather than easing through it', () => {
    // The book coalesces to one publish per 300ms; a transition at or above
    // that leaves every bar permanently mid-animation.
    const ms = Number(/transition:transform (\d+)ms/.exec(rule)?.[1]);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
  });

  it('keeps the bar on a transform, so a bar change never re-lays-out the row', () => {
    const rowsFn = code.slice(code.indexOf('const rows = ('), code.indexOf('return <div className="reference-book"'));
    expect(rowsFn).toContain('transform: `scaleX(');
    // A width on the DEPTH bar would lay the row out again on every tick.
    // The buy/sell ratio bar below the ladder is a different element and
    // legitimately uses width — it updates once per publish, not per row.
    expect(rowsFn).not.toMatch(/style=\{\{\s*width:/);
  });
});

/**
 * None of the above may touch what the panel is allowed to say, or how the
 * book itself is maintained. The visual work stops at the DOM.
 */
describe('the data contract is untouched', () => {
  it('still distinguishes stale, unavailable and connecting rather than blanking', () => {
    expect(code).toContain("status === 'stale' ? t('trade.bookStale')");
    expect(code).toContain("status === 'unavailable' ? t('trade.bookUnavailable')");
    expect(code).toContain("t('trade.bookConnecting')");
  });

  it('does not average, interpolate or invent a level anywhere in the panel', () => {
    expect(code).not.toMatch(/\blerp\b|\binterpolate\b|\bsmooth\b|\beas(e|ing)\(/i);
    // Depth still comes from the aggregator, not from a locally held copy.
    expect(code).toContain("aggregateSpotBook(bids, step, 'BUY')");
    expect(code).toContain("aggregateSpotBook(asks, step, 'SELL')");
  });
});

/**
 * The same book everywhere. The Spot panel had the three things the
 * reference does not: rows keyed by price, a 32%-alpha pulse on every
 * changed row, and a depth bar driven by `width`, which lays the row out
 * again on every tick.
 */
describe('the Spot book follows the same rules as the Futures book', () => {
  const spot = read('frontend/src/components/OrderBookPanel.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const index = read('frontend/src/index.css');

  it('keys its rows by depth slot on both sides', () => {
    expect(spot).toContain('key={`sell-${index}`}');
    expect(spot).toContain('key={`buy-${index}`}');
    expect(spot).not.toMatch(/key=\{spotPrecision \? spotLevelPrice/);
  });

  it('no longer pulses a row when its size changes', () => {
    expect(spot).not.toContain('useRowFlash');
    expect(spot).not.toMatch(/book-row-flash/);
    expect(index).not.toMatch(/book-row-flash/);
  });

  it('drives its depth bar with a transform, not a width', () => {
    expect(spot).toContain('transform: `scaleX(${share})`');
    expect(spot).not.toMatch(/style=\{\{\s*width:\s*`\$\{pct\}%`/);
    const rule = css.slice(css.indexOf('.spot-terminal.market-reference.terminal-studio .ob-depth-bar {'));
    expect(rule).toContain('transform-origin:100% 50%');
    expect(rule).toContain('width:100%');
  });

  it('still shows the level it was given and still submits the exact price', () => {
    expect(spot).toContain('level.cumulative / maxDepth');
    expect(spot).toContain('onPick?.(spotStep === undefined ? level.price.toFixed(2) : priceText)');
  });
});

/**
 * Tokens are the MEASURED ones, shared by both panels: the reference's row
 * background, its sell/buy, and a depth tint solved to alpha 0.09.
 */
describe('both panels draw the measured reference tokens', () => {
  const block = css.slice(css.indexOf('ONE book, every terminal'));
  it('uses one depth tint for Futures and Spot, at the measured alpha', () => {
    const tints = [...css.matchAll(/rgba\((246,70,93|14,203,129),\.(\d+)\)/g)].map((m) => m[2]);
    expect(tints.length).toBeGreaterThanOrEqual(4);
    expect(new Set(tints)).toEqual(new Set(['09']));
    // The pre-#121 30% and #121's own .13 are both gone.
    expect(css).not.toMatch(/rgba\((?:20,160,115|200,64,74),\.(?:30|13)\)/);
  });
  it('colours prices with the reference sell/buy and text with its grey scale, on both panels', () => {
    for (const panel of ['.repaired-futures-book', '.spot-terminal.market-reference.terminal-studio']) {
      const part = block.slice(block.indexOf(panel));
      expect(part).toMatch(/#f6465d/);
      expect(part).toMatch(/#0ecb81/);
      expect(part).toMatch(/#eaecef/);
      expect(part).toMatch(/#848e9c/);
    }
  });
});

/** The Futures centre draws the mark beside the last, as the reference does. */
describe('futures centre shows the mark price beside the last', () => {
  it('renders the mark in its own muted slot when the feed has one, and falls back to the spread when it does not', () => {
    expect(code).toContain('className="rb-mark"');
    expect(code).toContain('markPrice !== null && Number.isFinite(markPrice) && markPrice > 0');
    expect(code).toContain("t('trade.spread')");
  });
  it('is fed from the shared quote the page already holds, never a second request', () => {
    const page = read('frontend/src/pages/FuturesPage.tsx');
    expect(page).toContain('markPrice={reference.get(symbol)?.markPrice ?? null}');
    expect(page).not.toMatch(/getFuturesMarkPrice/);
  });
});
