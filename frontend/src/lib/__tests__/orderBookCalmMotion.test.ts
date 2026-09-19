import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const book = read('frontend/src/components/FuturesReferenceBook.tsx');
const spot = read('frontend/src/components/OrderBookPanel.tsx');
const terminal = read('frontend/src/pages/trade-terminal/TradeTerminal.css');
const index = read('frontend/src/index.css');
const css = read('frontend/src/pages/trade-terminal/TerminalAccountPanel.css');
const premium = read('frontend/src/pages/trade-terminal/TerminalPremium.css');
const reference = read('frontend/src/pages/trade-terminal/ReferenceFuturesTerminal.css');
/** The two sheets that paint the bar on the terminal the owner looks at: the
 * rule here, and the palette token it resolves to. ReferenceFuturesTerminal
 * still carries the pre-fix 30% fallback for designs this panel never uses,
 * and is deliberately out of scope. */
const SHEETS = [css, premium];
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
    // Swept by rule rather than by colour literal: the palette re-values the
    // bar (--buy-dim / --sell-dim in TerminalPremium.css, which paints it on
    // the Futures terminal), and a re-valued palette must not be able to
    // bring the weight back up. Every alpha that can reach a depth bar is
    // collected — the backgrounds declared on `.rb-depth` in any terminal
    // sheet, and the two dim tokens those rules resolve to.
    const declared = SHEETS.flatMap((sheet) =>
      [...sheet.matchAll(/\.rb-depth[^{]*\{([^}]*)\}/g)].flatMap((rule) => [
        ...rule[1].matchAll(/rgba\([^)]*,\s*\.(\d+)\)/g),
      ]),
    );
    const tokens = [...premium.matchAll(/--(?:buy|sell)-dim:\s*rgba\([^)]*,\s*\.(\d+)\)/g)];
    const alphas = [...declared, ...tokens].map((m) => Number('0.' + m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.15);
  });

  /**
   * NO EASING AT ALL — and this assertion replaces one that asked only for a
   * SHORT ease, which was not enough and is worth recording why.
   *
   * The owner supplied a screen recording of Binance Futures. Cropping its
   * order book and diffing consecutive frames gives 5 repaints in 2.0s —
   * 2.5 per second, mean gap 425ms — and BETWEEN them the panel is
   * bit-identical. That is the whole character of a calm book: it is not a
   * smoother animation, it is no animation.
   *
   * Measured here with a 140ms ease still in place (scripts/qa-orderbook-calm.cjs,
   * fixed replayed feed): the ladder's CONTENT changed 2.33 times a second
   * while its PIXELS changed 4.22 times a second. Nearly half the motion
   * carried no new information — it was the tail of the previous bar still
   * arriving, which is what "the numbers squeak" describes.
   *
   * The sweep is over EVERY terminal sheet, not one rule in one file. The
   * previous version checked a single rule, and that is exactly how a 140ms
   * transition in TerminalAccountPanel.css — the sheet Futures loads last —
   * survived the transition being removed from ReferenceFuturesTerminal.css
   * and kept the ladder moving.
   */
  it('does not ease the bar at all: no sheet may animate a depth bar', () => {
    const sheets = [
      ['TerminalAccountPanel.css', css],
      ['TerminalPremium.css', premium],
      ['ReferenceFuturesTerminal.css', reference],
      ['TradeTerminal.css', terminal],
    ] as const;
    const offenders: string[] = [];
    for (const [name, sheet] of sheets) {
      for (const match of sheet.matchAll(/\.rb-depth[^{]*\{([^}]*)\}/g)) {
        const body = match[1];
        if (/transition\s*:/.test(body) && !/transition\s*:\s*none/.test(body)) {
          offenders.push(`${name}: ${body.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // And the sheet that loads last says so explicitly, so a later edit that
    // re-adds one elsewhere is still overridden rather than silently winning.
    expect(rule).toMatch(/transition\s*:\s*none/);
  });

  it('does not ease the buy/sell ratio bar either', () => {
    const ratio = /\.rb-ratio\s*>\s*i\s*\{([^}]*)\}/.exec(reference)?.[1] ?? '';
    expect(ratio).not.toMatch(/transition\s*:/);
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
  /**
   * Three states, still told apart. What changed is how the FIRST of them
   * is presented, and the change is deliberate: a book that has not arrived
   * yet is not a fault, and announcing it in a coloured band was the
   * loudest thing on the panel at the one moment the panel knew least. The
   * owner photographed exactly that. Waiting now draws a quiet placeholder
   * ladder; a book that HAD data and stopped, and a book that is gone, are
   * still named, because those are facts a trader needs.
   */
  it('still tells stale and unavailable apart, and still names them', () => {
    expect(code).toContain("t('trade.bookStale')");
    expect(code).toContain("t('trade.bookUnavailable')");
    // `status` is still the three-valued thing it was; nothing collapsed it.
    expect(code).toContain("status === 'stale'");
    expect(code).toContain("status === 'unavailable'");
  });

  it('draws a placeholder ladder while waiting instead of an alarm or a blank', () => {
    expect(code).toContain('const waiting = !bids.length && !asks.length');
    expect(code).toContain('is-placeholder');
    // The waiting state renders the ladder's real shape...
    expect(code).toMatch(/waiting \? placeholders\('ask'\) : rows\(sell, 'ask'\)/);
    expect(code).toMatch(/waiting \? placeholders\('bid'\) : rows\(buy, 'bid'\)/);
    // ...and a placeholder is an em dash, never a zero and never a price.
    const fn = code.slice(code.indexOf('const placeholders ='), code.indexOf('const rows = ('));
    expect(fn).toContain('—');
    expect(fn).not.toMatch(/\b0\b/);
    // Nothing is announced before there has ever been a book.
    expect(code).toContain("status === 'stale' && !waiting");
  });

  it('does not average, interpolate or invent a level anywhere in the panel', () => {
    expect(code).not.toMatch(/\blerp\b|\binterpolate\b|\bsmooth\b|\beas(e|ing)\(/i);
    // Depth still comes from the aggregator, not from a locally held copy.
    expect(code).toContain("aggregateSpotBook(bids, step, 'BUY')");
    expect(code).toContain("aggregateSpotBook(asks, step, 'SELL')");
  });
});


/**
 * The same rules on the Spot ladder.
 *
 * The futures book was calmed first; Spot kept both faults and had one of
 * its own. It keyed rows by price — so a moving ladder remounted them, the
 * same tear-down the block above exists to stop — and on top of that it
 * pulsed every changed row through a 32 %-alpha keyframe on EVERY publish,
 * which is a flash the reference terminal does not have at all. One book
 * everywhere means the Spot panel obeys the rules the futures panel already
 * does.
 */
describe('the Spot ladder obeys the same rules as the futures one', () => {
  const spotCode = spot.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('keys a Spot row by its depth slot, never by the price in it', () => {
    expect(spotCode).toContain('key={`sell-${index}`}');
    expect(spotCode).toContain('key={`buy-${index}`}');
    // The old price keys, in either of the two forms the panel used.
    expect(spotCode).not.toContain('key={spotPrecision ? spotLevelPrice(level.price, groupStep)');
    expect(spotCode).not.toMatch(/key=\{level\.price/);
  });

  it('no longer pulses a row when its quantity changes', () => {
    // The hook, its class names and its keyframes are DELETED, not disabled:
    // a dormant flash is one prop away from coming back.
    expect(spotCode).not.toContain('useRowFlash');
    expect(spotCode).not.toContain('FLASH_DURATION_MS');
    expect(spotCode).not.toContain('book-row-flash');
    expect(index).not.toContain('book-row-flash');
    expect(index).not.toContain('@keyframes book-row-flash-up');
    expect(index).not.toContain('@keyframes book-row-flash-down');
  });

  it('keeps the Spot bar on a transform, so a size change never re-lays-out the row', () => {
    expect(spotCode).toContain('transform: `scaleX(');
    expect(spotCode).not.toMatch(/style=\{\{\s*width:/);
    // And the sheet has to agree: a right-anchored full-width strip, with
    // the transition on transform rather than on width.
    const rule = /\.trade-terminal \.ob-depth-bar \{[^}]*\}/.exec(terminal)?.[0] ?? '';
    expect(rule).toContain('left: 0');
    expect(rule).toContain('transform-origin: 100% 50%');
    expect(rule).toMatch(/transition: transform/);
    expect(rule).not.toMatch(/transition:[^;]*width/);
  });

  it('still shows real levels and invents none', () => {
    expect(spotCode).not.toMatch(/\blerp\b|\binterpolate\b|\bsmooth\b/i);
    // Depth is still cumulative over the aggregated levels it was handed.
    expect(spotCode).toContain('function withDepth(');
    expect(spotCode).toContain('running += l.quantity');
  });
});
