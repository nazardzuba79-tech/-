import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The Futures header's two MARKET-REFERENCE figures.
 *
 * Before this change the header showed Kraken's SPOT quote volume as
 * "24h turnover" and VOLTEX's OWN open interest as the market's — two
 * numbers that answered a different question from the one the label
 * asked. They now come from tracked external derivatives venues.
 *
 * What must NOT move is everything beside them: mark price, the settled
 * funding rate and the countdown are VOLTEX's own, and `/futures/open-
 * interest` stays exactly where it is because internal risk, the
 * Analytics VOLTEX section and future admin views read it.
 *
 * Structural assertions, deliberately: a rendering test cannot prove the
 * ABSENCE of a code path, and "the header stopped reading spot volume" is
 * an absence claim.
 */

const frontend = resolve(__dirname, '../../..');
const repo = resolve(frontend, '..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');
const readRepo = (p: string) => readFileSync(resolve(repo, p), 'utf8').replace(/\r\n/g, '\n');

/** Source with comments stripped: these are claims about executable code,
 *  and the file's own comments discuss the spot volume it no longer uses. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const bar = read('src/components/FuturesTickerBar.tsx');
const barCode = code(bar);

/** The whole open-interest cell: from the opening tag of its
 *  `.ticker-item` div up to the funding cell's label. Anchoring on the
 *  label alone is not enough — the cell computes its value (and its unit)
 *  before it renders the label. */
const openInterestCell = () => {
  const fundingAt = barCode.indexOf("t('futures.headerFunding')");
  const start = barCode.lastIndexOf('<div className="ticker-item">', fundingAt);
  return barCode.slice(start, fundingAt);
};

describe('the header no longer sources market stats from the wrong market', () => {
  it('does not render Kraken spot quote volume as the 24h turnover', () => {
    // The spot ticker is still read for last/change/high/low, which are
    // legitimately reference prices — so `quoteVolume24h` may still be
    // parsed, but it must not reach the turnover cell.
    const turnoverCell = barCode.slice(
      barCode.indexOf("t('futures.headerTurnover24h')"),
      barCode.indexOf("t('futures.openInterest')")
    );
    expect(turnoverCell.length).toBeGreaterThan(0);
    expect(turnoverCell).not.toContain('quoteVolume24h');
    expect(turnoverCell).toContain('turnover24hUsd');
  });

  it('does not render VOLTEX internal open interest as the market figure', () => {
    const oiCell = openInterestCell();
    expect(oiCell.length).toBeGreaterThan(0);
    expect(oiCell).toContain('openInterestBase');
    // `openInterest` is the internal state; it must not feed this cell.
    expect(oiCell).not.toMatch(/openInterest\s*===\s*null/);
    expect(oiCell).not.toContain('openInterest.size');
  });

  it('reads the dedicated lightweight endpoint, not the whole Analytics snapshot', () => {
    expect(barCode).toContain('.getFuturesMarketStats(baseAsset)');
    expect(barCode).not.toContain('getAnalyticsOverview');
    expect(read('src/lib/api.ts')).toContain('`/market/derivatives/${encodeURIComponent(baseAsset)}`');
  });
});

describe('VOLTEX financial values in the header are untouched', () => {
  it('still reads mark price, index and the settled funding rate from the futures services', () => {
    expect(barCode).toContain('.getFuturesMarkPrice(symbol)');
    expect(barCode).toContain('.getFuturesFundingRate(symbol, 1)');
    expect(barCode).toContain('setMarkPrice(parseFloat(res.markPrice))');
    expect(barCode).toContain('setIndexPrice(parseFloat(res.indexPrice))');
  });

  it('never substitutes an external venue figure for a VOLTEX one', () => {
    const markCell = barCode.slice(barCode.indexOf("t('futures.headerFunding')"));
    expect(markCell).not.toMatch(/binance|okx|turnover24hUsd|openInterestBase/i);
    // The external stats reach exactly two cells and nothing else.
    expect((barCode.match(/stats24h/g) ?? []).length).toBeLessThanOrEqual(12);
  });

  it('keeps /futures/open-interest intact for internal risk and Analytics', () => {
    // The endpoint, its route and the client method all still exist — the
    // header simply stopped using it for the MARKET figure.
    expect(readRepo('src/api/routes/futures.ts')).toContain("'/futures/open-interest/:symbol'");
    expect(read('src/lib/api.ts')).toContain('getFuturesOpenInterest');
    expect(readRepo('src/services/AnalyticsDataService.ts')).toContain('openInterestBase');
  });
});

describe('units, and no provider branding', () => {
  it('labels the unit it is actually showing, and never mixes the two', () => {
    const oiCell = openInterestCell();
    // Base units when base units exist, the contract's quote currency
    // otherwise — and the label follows the same condition, so the unit
    // on screen is the unit of the number.
    expect(oiCell).toContain('showBase ? baseAsset : quoteAsset');
    expect(oiCell).toContain('showBase');
  });

  it('names no upstream venue anywhere in the customer-facing header', () => {
    // Comments are stripped from `barCode`, so this covers everything the
    // component can actually render.
    expect(barCode).not.toMatch(/binance|okx|kraken|coingecko|twelvedata/i);
    expect(barCode).not.toContain('marketSource');
    expect(barCode).not.toContain('venueLabel');
    expect(barCode).not.toContain('futures-source');
  });

  it('keeps the contributor lists in the API contract, out of the UI', () => {
    // Provenance is not deleted — it stops at the network boundary, where
    // logs, admin diagnostics and the test suite still read it.
    const api = read('src/lib/api.ts');
    for (const field of ['turnoverVenues', 'openInterestBaseVenues', 'openInterestUsdVenues']) {
      expect(api).toContain(field);
      expect(barCode).not.toContain(field);
    }
    expect(readRepo('src/services/marketData/derivatives/ExternalDerivativesService.ts'))
      .toContain('openInterestBaseVenues');
  });

  it('clears the previous symbol\'s stats immediately on a switch', () => {
    // Two resets: one in the VOLTEX loop, one in the derivatives effect,
    // both before any new read lands. BTC's figures can never sit under
    // an ETH header.
    expect((barCode.match(/setDerivatives\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(barCode).toContain('}, [baseAsset]);');
  });

  it('dims a stale figure rather than presenting it as live', () => {
    expect(barCode).toContain("derivatives.stale ? ' is-stale' : ''");
    expect(read('src/pages/trade-terminal/FuturesTerminal.css')).toContain('.value.is-stale');
  });
});

describe('external stats stay out of financial logic', () => {
  const FINANCIAL = [
    'src/futures/MarkPriceService.ts',
    'src/futures/FundingRateService.ts',
    'src/futures/LiquidationEngine.ts',
    'src/futures/FuturesPositionService.ts',
    'src/futures/marginMath.ts',
    'src/matching-engine/MatchingEngine.ts',
  ];

  it.each(FINANCIAL)('%s never reads tracked-venue statistics', (path) => {
    const source = code(readRepo(path));
    expect(source).not.toMatch(/getFuturesMarketStats|getTrackedTurnover24h|getTrackedOpenInterest|ExternalDerivativesService/);
    expect(source).not.toMatch(/fapi\.binance|www\.okx/i);
  });

  it('the new endpoint is read-only market reference data', () => {
    const route = code(readRepo('src/api/routes/marketData.ts'));
    const block = route.slice(route.indexOf("'/market/derivatives/:baseAsset'"), route.indexOf("'/market/snapshot'"));
    expect(block).not.toMatch(/prisma\.|order|balance|position|withdraw/i);
    expect(block).toContain('getFuturesMarketStats');
    // Bounded before it reaches a provider adapter.
    expect(block).toContain('.slice(0, 12)');
  });
});
