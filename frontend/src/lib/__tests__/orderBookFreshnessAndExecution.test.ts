import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BOOK_REFRESH_MS, BOOK_STALE_AFTER_MS, BOOK_UNAVAILABLE_AFTER_MS, RECONNECT_GRACE_MS, bookFreshness,
} from '../bookFreshness';

const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
/** Comments state the rules; they must not be able to satisfy them. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const tradePage = strip(read('frontend/src/pages/TradePage.tsx'));
const depth = strip(read('frontend/src/lib/futuresDepth.ts'));
const banner = strip(read('frontend/src/components/ConnectionBanner.tsx'));

/**
 * What the order book is allowed to do to the person reading it.
 *
 * Two independent promises are pinned here, and they pull in opposite
 * directions, which is why both need a guard:
 *
 *   CALM. The book refreshes on a quiet cadence, keeps the last real
 *   snapshot on screen through a refresh, a reconnect and a tab switch, and
 *   does not cry "connection lost" over an ordinary handshake. A threshold
 *   that fires inside normal operation is a false alarm, and a trader who
 *   learns to ignore it will ignore the true one too.
 *
 *   HONEST. Calm is not the same as pretending. A feed that has genuinely
 *   stopped is still labelled, levels too old to be a price are still
 *   dropped rather than aged, and nothing anywhere invents depth to fill a
 *   gap. An empty book means "unknown", never "zero".
 *
 * And one thing that must hold no matter what either of those does:
 * EXECUTION NEVER READS THIS BOOK.
 */

describe('1. the thresholds cannot contradict the cadence', () => {
  it('calls a book stale only after several missed refreshes', () => {
    // The rule: stale must outlast the refresh interval by enough to
    // survive a missed cycle. If the two were close, an ordinary gap
    // between refreshes would read as "out of date" every cycle.
    expect(BOOK_STALE_AFTER_MS).toBeGreaterThan(BOOK_REFRESH_MS);
    expect(BOOK_STALE_AFTER_MS / BOOK_REFRESH_MS).toBeGreaterThanOrEqual(2);
  });

  it('drops levels only well after it has already labelled them', () => {
    expect(BOOK_UNAVAILABLE_AFTER_MS).toBeGreaterThan(BOOK_STALE_AFTER_MS);
  });

  it('gives a reconnect longer than one refresh cycle before saying anything', () => {
    expect(RECONNECT_GRACE_MS).toBeGreaterThan(BOOK_REFRESH_MS);
  });

  it('reads an ordinary gap as live, and a real outage as what it is', () => {
    const now = 1_000_000_000;
    expect(bookFreshness(now, now)).toBe('live');
    // One missed refresh is normal operation, not a fault.
    expect(bookFreshness(now - BOOK_REFRESH_MS - 1, now)).toBe('live');
    expect(bookFreshness(now - BOOK_STALE_AFTER_MS, now)).toBe('stale');
    expect(bookFreshness(now - BOOK_UNAVAILABLE_AFTER_MS, now)).toBe('unavailable');
    // Never seen is not the same as seen and old, but both are "not a price".
    expect(bookFreshness(null, now)).toBe('unavailable');
  });
});

describe('2. the cadence is quiet, and it is the shared one', () => {
  it('polls the Spot fallback on the shared interval, not on a timer of its own', () => {
    expect(tradePage).toContain('BOOK_REFRESH_MS');
    // The old shape: a 2-second interval against a 4-second silence window.
    expect(tradePage).not.toContain('WS_FALLBACK_TIMEOUT_MS');
    expect(tradePage).not.toMatch(/setInterval\([^)]*,\s*2000\s*\)/);
  });

  it('polls the futures fallback on the shared interval too', () => {
    expect(depth).toContain('const FALLBACK_POLL_MS = BOOK_REFRESH_MS;');
    expect(depth).toContain('const STALE_AFTER_MS = BOOK_STALE_AFTER_MS;');
    expect(depth).toContain('const UNAVAILABLE_AFTER_MS = BOOK_UNAVAILABLE_AFTER_MS;');
    // The one-second fallback poll — sixty reads a minute for a panel.
    expect(depth).not.toContain('const FALLBACK_POLL_MS = 1_000;');
  });

  it('suppresses the fallback entirely while the live stream is delivering', () => {
    expect(depth).toContain("if (active.source === 'socket' && active.status === 'live') return;");
    // And never polls for a tab nobody is looking at.
    expect(depth).toContain("if (typeof document !== 'undefined' && document.hidden) return;");
  });
});

describe('3. the last real snapshot stays on screen', () => {
  it('empties the Spot ladder only when the market itself changed', () => {
    expect(tradePage).toContain('if (bookShownPairRef.current !== pair) {');
    // Exactly one place may blank it, and it is inside that guard.
    const blanks = tradePage.match(/setBook\(\{\s*pair,\s*bids:\s*\[\],\s*asks:\s*\[\],\s*asOf:\s*null\s*\}\)/g) ?? [];
    expect(blanks).toHaveLength(1);
    // ...and that one blank sits inside the guard, not somewhere after it.
    const guardAt = tradePage.indexOf('if (bookShownPairRef.current !== pair) {');
    const blankAt = tradePage.indexOf('setBook({ pair, bids: [], asks: [], asOf: null })');
    expect(guardAt).toBeGreaterThan(-1);
    expect(blankAt).toBeGreaterThan(guardAt);
    expect(blankAt - guardAt).toBeLessThan(200);
  });

  it('serves the futures last-good while a new book is still arriving', () => {
    expect(depth).toContain('if (active.lastGood) return { bids: active.lastGood.bids, asks: active.lastGood.asks, ...meta };');
    // A dropped socket labels the book; it does not throw it away. The
    // label now depends on WHY it dropped: inside a reconnect grace this is
    // an expected handshake and says `reconnecting`, which renders without a
    // banner; outside one it is a silent feed and still says `stale`. What
    // this test has always guarded — that `lastGood` is what stays on
    // screen and an empty book is the only thing that reports `connecting`
    // — is unchanged, and the third branch is now pinned too.
    expect(depth).toContain("active.status = active.lastGood === null ? 'connecting'");
    expect(depth).toContain("this.inGrace(active, Date.now()) ? 'reconnecting' : 'stale';");
  });

  it('still drops levels that are too old to be a price, rather than ageing them', () => {
    // Calm must not become dishonest: past `unavailable` the panel shows
    // nothing, and nothing is what "we do not know" looks like.
    expect(depth).toContain("active.status = 'unavailable'");
    expect(depth).toContain('active.lastGood = null;');
    expect(depth).toContain("if (active.status === 'unavailable') return { bids: [], asks: [], ...meta };");
  });

  it('invents no depth anywhere on either path', () => {
    for (const source of [tradePage, depth]) {
      expect(source).not.toMatch(/\blerp\b|\binterpolate\b|\bsynthetic\b|\bfabricat/i);
    }
  });
});

describe('4. coming back to the tab is quiet', () => {
  it('re-reads the Spot book on return without clearing it', () => {
    expect(tradePage).toContain("document.addEventListener('visibilitychange',visible)");
    const handler = tradePage.slice(tradePage.indexOf('const visible=()=>{'));
    const body = handler.slice(0, handler.indexOf('};'));
    expect(body).toContain('refreshBook()');
    // Nothing on this path may blank the ladder or raise anything.
    expect(body).not.toContain('setBook(');
  });

  it('takes the banner down on return instead of raising one', () => {
    expect(banner).toContain("document.addEventListener('visibilitychange', onVisibility)");
    const handler = banner.slice(banner.indexOf('const onVisibility = () => {'));
    const body = handler.slice(0, handler.indexOf('};'));
    expect(body).toContain('setShow(false)');
    expect(body).not.toContain('setShow(true)');
  });

  it('gives a reconnect the shared grace rather than two seconds', () => {
    expect(banner).toContain('const SHOW_AFTER_MS = RECONNECT_GRACE_MS;');
    expect(banner).not.toContain('const SHOW_AFTER_MS = 2000;');
  });

  it('still reports a connection that is genuinely still down', () => {
    // The grace delays the message; it must not delete it.
    expect(banner).toContain('setShow(true)');
    expect(banner).toContain("t('connection.lost')");
  });
});

describe('5. execution never reads the display book', () => {
  /**
   * The promise: a manual MARKET open or close does not wait for, or read
   * from, the panel's 30-second cycle. The visible ladder mirrors a public
   * venue for display; an order is matched on the exchange's own server-side
   * book, read when the order is handled.
   *
   * This is what makes the cadence above safe to slow down. If an order ever
   * priced itself from the browser's copy, a quiet refresh would become a
   * stale fill — so the separation is pinned here rather than assumed.
   */
  const DISPLAY_BOOK = /from '[^']*\/(futuresDepth|krakenSocket|bookFreshness|referenceBook|OrderBookPanel|FuturesReferenceBook)'/;
  const EXECUTION_MODULES = [
    'frontend/src/components/OrderForm.tsx',
    'frontend/src/components/FuturesOrderForm.tsx',
    'frontend/src/components/FuturesPositionsPanel.tsx',
    'frontend/src/components/FuturesPositionProtection.tsx',
    'frontend/src/components/OpenOrdersPanel.tsx',
    'frontend/src/lib/futuresExecution.tsx',
    'frontend/src/lib/nativeDemoApi.ts',
  ];

  it.each(EXECUTION_MODULES)('%s imports no display-book module', (file) => {
    const imports = read(file).split('\n').filter((line) => line.startsWith('import '));
    expect(imports.filter((line) => DISPLAY_BOOK.test(line))).toEqual([]);
  });

  it('sends no level, side or depth from the browser with an order', () => {
    const api = read('frontend/src/lib/api.ts');
    const payload = api.slice(api.indexOf('placeFuturesOrder: (params: {'), api.indexOf('cancelFuturesOrder:'));
    expect(payload).toContain('symbol: string;');
    expect(payload).toContain('quantity: string;');
    // A price is the trader's own LIMIT input, never a level read off the
    // ladder — and nothing resembling a book may travel with the order.
    expect(payload).not.toMatch(/\bbids\b|\basks\b|\blevels\b|\bdepth\b|\bbook\b/i);
  });

  it('prices an ordinary order at the server’s current book, not a captured one', () => {
    const execution = strip(read('frontend/src/lib/futuresExecution.tsx'));
    // `candle` is the one way a captured bar can reach the engine, and it is
    // for a historical trade the trader picked on the chart. Every ordinary
    // order sends null, which means "price this at the current book".
    expect(execution).toContain('candle: null,');
  });

  it('keeps the cadence out of every execution path', () => {
    for (const file of EXECUTION_MODULES) {
      const source = read(file);
      expect(`${file}: ${source.includes('BOOK_REFRESH_MS')}`).toBe(`${file}: false`);
      expect(`${file}: ${source.includes('bookFreshness')}`).toBe(`${file}: false`);
    }
  });
});
