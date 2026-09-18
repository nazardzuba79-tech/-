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
    // The bar width is still the level's own cumulative over a maximum —
    // only WHICH maximum changed, to the one belonging to the row's side.
    expect(rowsFn).toContain('level.cumulative / (side === \'bid\' ? maxBuyDepth : maxSellDepth)');
  });

  /**
   * Each side is scaled against its own deepest level.
   *
   * A single max across both sides made the thinner side unreadable: on the
   * owner's own terminal, bids cumulated to 6.009 against asks' 1.936, so
   * every ask bar was capped at 32% of its track and the ask ladder read as
   * one flat band. The reference terminal scales per side — its asks run
   * 0.038 down to 0.002 and the shortest bar is 0.002/0.038 of the track,
   * not 0.002 measured against the bid side's 0.079.
   */
  it('scales each side against its own deepest level, not a shared one', () => {
    expect(code).toContain('const maxBuyDepth = Math.max(buy[buy.length - 1]?.cumulative ?? 0');
    expect(code).toContain('const maxSellDepth = Math.max(sell[sell.length - 1]?.cumulative ?? 0');
    // The shared maximum is gone, so a lopsided book cannot flatten a side.
    expect(code).not.toMatch(/const maxDepth\s*=/);
    // Neither side's divisor may be built from the other side's levels.
    const buyLine = code.split('\n').find(line => line.includes('const maxBuyDepth'))!;
    const sellLine = code.split('\n').find(line => line.includes('const maxSellDepth'))!;
    expect(buyLine).not.toContain('sell[');
    expect(sellLine).not.toContain('buy[');
    // Still clamped, so a stale or malformed level cannot overflow its row.
    expect(code).toContain('Math.min(1, level.cumulative');
    // The cross-side imbalance is not lost: the ratio strip still reports it.
    expect(code).toContain('visibleDepthRatio(buy, sell)');
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
    const alphas = [...css.matchAll(/rgba\((?:20,160,115|200,64,74),\.(\d+)\)/g)].map((m) => Number('0.' + m[1]));
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
