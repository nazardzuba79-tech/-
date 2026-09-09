import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

/**
 * The frontend half of the data-driven market universe.
 *
 * The old `MAX_PERP_MARKETS = 40` was written as a listing rule but the
 * reason it existed was rendering: the market panels put every row in the
 * DOM and became unusable past a few dozen. Removing it from the backend
 * without fixing that would have moved the problem rather than solved it,
 * so these are the assertions that make removing it safe.
 *
 * Structural, deliberately: "the frontend never calls Bybit directly" and
 * "no per-row fetch exists" are ABSENCE claims, and a rendering test
 * cannot prove the absence of a code path.
 */

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');

/** Executable code only. These files' comments legitimately discuss the
 *  upstreams they do NOT call, so a naive substring search would match the
 *  prose documenting the absence. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(frontend, dir))) {
    const rel = join(dir, entry);
    if (statSync(resolve(frontend, rel)).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') sources(rel, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

const allSources = sources('src');
const pairList = code(read('src/components/FuturesPairList.tsx'));

// ── 26. The browser never talks to a venue ──────────────────────────

describe('the frontend never calls a venue directly', () => {
  it('found sources to scan', () => {
    expect(allSources.length).toBeGreaterThan(50);
  });

  it('contains no direct upstream market API host', () => {
    // Everything goes through the VOLTEX backend, so the browser cannot
    // leak a user's IP to a venue, cannot be geo-blocked independently of
    // the server, and cannot bypass the shared cache.
    const offenders: string[] = [];
    for (const file of allSources) {
      for (const [n, line] of code(read(file)).split('\n').entries()) {
        if (/api\.bybit\.com|api\.binance\.com|fapi\.binance\.com|www\.okx\.com|api\.kraken\.com|api\.coingecko\.com/i.test(line)) {
          offenders.push(`${file}:${n + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads the market universe from the VOLTEX API, if at all', () => {
    const api = code(read('src/lib/api.ts'));
    expect(api).not.toMatch(/bybit/i);
    // The base URL is VOLTEX's own; nothing overrides it per provider.
    expect(api).toContain("const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'");
  });
});

// ── 21. 500+ markets render without 500 rows in the DOM ─────────────

describe('the futures market list scales', () => {
  it('renders through a window rather than mounting every row', () => {
    expect(pairList).toContain('useWindowedRows');
    expect(pairList).toContain('rows.slice(windowed.start, windowed.end)');
    // Spacers keep the real scroll height, so the scrollbar is honest.
    expect(pairList).toContain('windowed.padTop');
    expect(pairList).toContain('windowed.padBottom');
  });

  it('has no hardcoded market-count ceiling', () => {
    expect(pairList).not.toMatch(/slice\(0,\s*\d+\)/);
    expect(pairList).not.toMatch(/MAX_PERP_MARKETS|\b40\b/);
  });

  it('takes its symbols from the backend listing, never from a local list', () => {
    const page = code(read('src/pages/FuturesPage.tsx'));
    expect(page).toContain('getFuturesConfig');
    expect(page).toContain('setSymbols(cfg.symbols)');
  });
});

describe('the window survives the list shrinking under it', () => {
  it('clamps the window against the CURRENT row count, not just against zero', () => {
    // Filtering 520 rows down to 6 while scrolled leaves a stale
    // scrollTop, so an unclamped window starts past the end of the
    // shortened list and renders NOTHING. A search box does this on every
    // keystroke; caught in browser QA at 520 markets.
    const hook = code(read('src/lib/useWindowedRows.ts'));
    expect(hook).toContain('const maxStart = Math.max(0, total - span)');
    expect(hook).toContain('Math.min(maxStart,');
  });

  it('renders a screenful before the container has been measured', () => {
    // A first paint with zero rows is a visible flash.
    const hook = code(read('src/lib/useWindowedRows.ts'));
    expect(hook).toContain('viewport > 0 ? Math.ceil(viewport / height) : 24');
  });
});

// ── 15. No fake zero at scale ───────────────────────────────────────

describe('no fake zero in the market list', () => {
  it('carries an unpriced market as null, never as 0', () => {
    // At 500+ contracts most of the tail has no reference quote at any
    // moment. A 0 would render as a price AND sort as the cheapest market
    // on the exchange.
    expect(pairList).not.toContain('parseFloat(tk.lastPrice) || 0');
    expect(pairList).not.toContain('parseFloat(tk.quoteVolume24h) || 0');
    expect(pairList).toContain('lastPrice: number | null');
    expect(pairList).toContain("r.lastPrice !== null ? formatPrice(r.lastPrice) : '—'");
  });

  it('sorts unpriced markets last in BOTH directions', () => {
    expect(pairList).toContain('if (a === null && b === null) return 0');
    expect(pairList).toContain('if (a === null) return 1');
    expect(pairList).toContain('if (b === null) return -1');
  });
});

// ── 22-23. Heavy per-instrument data follows the SELECTED symbol ────

describe('candles and order book are fetched for the selected symbol only', () => {
  it('requests candles for one pair, inside a symbol-keyed effect', () => {
    const chart = code(read('src/components/PriceChart.tsx'));
    const calls = chart.match(/getExternalCandles\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(chart).toContain('getExternalCandles(pair, interval, CANDLE_FETCH_LIMIT)');
    // Never a sweep over a symbol list.
    expect(chart).not.toMatch(/symbols\.map\([^)]*getExternalCandles/);
  });

  it('requests the order book for one symbol only', () => {
    const page = code(read('src/pages/FuturesPage.tsx'));
    const calls = page.match(/getExternalOrderBook\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(page).toContain('getExternalOrderBook(symbol)');
    expect(page).not.toMatch(/symbols\.map\([^)]*getExternalOrderBook/);
  });

  it('reads all list prices from the ONE shared snapshot, not per row', () => {
    // The pair list uses the shared store; there is no per-symbol ticker
    // request anywhere in it.
    expect(pairList).toContain('useMarketTickers(4000)');
    expect(pairList).not.toContain('getExternalTicker(');
    expect(pairList).not.toMatch(/\.map\([^)]*api\./);
  });
});

// ── 28. Spot and Futures stay separate surfaces ─────────────────────

describe('spot and futures symbol isolation', () => {
  it('the futures list is driven by the futures listing, the spot list is not', () => {
    const spot = code(read('src/components/PairListSidebar.tsx'));
    expect(spot).not.toContain('getFuturesConfig');
    expect(pairList).not.toContain('getAssetCatalogue');
  });

  it('drawings stay keyed per market type and symbol', () => {
    // Widening the universe must not let BTC's drawings appear on a newly
    // listed contract.
    const drawings = code(read('src/lib/chartDrawings.ts'));
    expect(drawings).toContain('voltex.drawings');
    expect(drawings).toMatch(/market/);
  });
});
