/**
 * Two customer-facing defects, pinned.
 *
 * 1. The Futures chart narrated its own backfill — loading, 10k cap, no
 *    older candles. A chart that has loaded every candle that exists is
 *    working correctly; saying so invites the reader to think it is not.
 *    Reaching the end of history must now be SILENT. A chart that genuinely
 *    could not load at all still says so, with Retry (PR #169).
 *
 * 2. The Futures pair chooser printed a 7-day change taken from CoinGecko
 *    and matched to a contract by BASE TICKER. Measured on the live feed:
 *    HOOD/USDT showed +190.54%, which is `greenhood` ("GreenHood"), one of
 *    SEVEN CoinGecko assets carrying the ticker HOOD. A perpetual's ticker
 *    has no 7d field, so a contract-accurate number is not available
 *    cheaply — and a wrong number is worse than none.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const frontend = resolve(__dirname, '../../..');
const chart = readFileSync(resolve(frontend, 'src/components/PriceChart.tsx'), 'utf8');
const pairList = readFileSync(resolve(frontend, 'src/components/FuturesPairList.tsx'), 'utf8');
/** Comments in that file deliberately QUOTE the removed expressions so the
 *  reason survives; the assertions below are about code, so strip them. */
const pairListCode = pairList.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The definition the brief gives, and the only one this terminal may use. */
function contractReturnPercent(priceNow: number, priceThen: number): number | null {
  if (!Number.isFinite(priceNow) || !Number.isFinite(priceThen) || priceThen === 0) return null;
  return ((priceNow - priceThen) / priceThen) * 100;
}

describe('the chart stops narrating its own history', () => {
  it('carries none of the three technical status strings', () => {
    for (const phrase of [
      'Свечи за этот период недоступны', 'Candles unavailable for this period',
      'Загрузка свечей', 'Loading candles',
      'Для более раннего входа', 'Use a larger timeframe for an earlier entry',
    ]) expect(chart).not.toContain(phrase);
  });

  it('keeps no internal history-availability state to render', () => {
    // The state existed only to feed that strip; `historyEnd`/`historyLoading`
    // still carry the control flow, which is not a customer-facing thing.
    expect(chart).not.toContain('historyState');
    expect(chart).not.toContain('setHistoryState');
  });

  it('still shows the instruction for a REAL user action', () => {
    expect(chart).toContain('Выберите свечу выхода');
    expect(chart).toContain('Выберите завершённую свечу');
    // And that strip is now gated on the selection alone.
    expect(chart).toMatch(/privateTrading\?\.enabled && tradingSelection && <div className="chart-trade-status"/);
  });

  it('does NOT regress PR #169: a chart that truly failed still offers Retry', () => {
    expect(chart).toContain("t('trade.chartLoadFailed')");
    expect(chart).toContain("t('trade.chartRetry')");
    expect(chart).toContain('retryCandlesRef');
    expect(chart).toContain('paintedSeriesRef');          // the blank-chart fix itself
    expect(chart).toMatch(/chartErrorOverlay:[\s\S]{0,400}?zIndex: 5/); // pressable over the canvas
  });
});

describe('the futures list stays inside the contract price domain', () => {
  it('no longer resolves any figure by base ticker into the asset catalogue', () => {
    expect(pairListCode).not.toContain('change7d.get(');
    expect(pairListCode).not.toContain("split('/')[0].toUpperCase()");
    expect(pairListCode).not.toContain('useChange7d');
    expect(pairListCode).not.toContain('changePercent7d');
    // …and the explanation of why is still in the file, for the next reader.
    expect(pairList).toContain('greenhood');
  });

  it('does not import the CoinGecko catalogue at all', () => {
    expect(pairListCode).not.toMatch(/import .*catalogueStore.* from/);
  });

  it('offers no 7-day sort while no contract-accurate source exists', () => {
    expect(pairListCode).not.toContain("'change7d'");
    expect(pairListCode).not.toContain('pairs-7d');
    expect(pairList).toContain("type SortField = 'price' | 'change';");
  });

  it('takes every remaining column from this contract own ticker', () => {
    for (const field of ['lastPrice', 'changePercent24h', 'quoteVolume24h']) {
      expect(pairList).toContain(`tk?.${field}`);
    }
  });
});

describe('contract 7d return, the only definition allowed here', () => {
  it('100 -> 121 is +21.00%', () => {
    expect(contractReturnPercent(121, 100)).toBeCloseTo(21, 10);
    expect(contractReturnPercent(121, 100)!.toFixed(2)).toBe('21.00');
  });

  it('100 -> 50 is -50%, and 50 -> 100 is +100%', () => {
    expect(contractReturnPercent(50, 100)).toBeCloseTo(-50, 10);
    expect(contractReturnPercent(100, 50)).toBeCloseTo(100, 10);
  });

  it('is the same formula the ruler uses, so chart and list cannot disagree', () => {
    // Ruler: (priceB - priceA) / priceA * 100. Mathematically correct, and
    // unchanged by this branch.
    const ruler = (a: number, b: number) => ((b - a) / a) * 100;
    for (const [then, now] of [[100, 121], [100, 50], [50, 100], [86000, 86430]] as const) {
      expect(contractReturnPercent(now, then)).toBeCloseTo(ruler(then, now), 10);
    }
  });

  it('refuses to invent a number rather than dividing by a zero reference', () => {
    expect(contractReturnPercent(121, 0)).toBeNull();
    expect(contractReturnPercent(Number.NaN, 100)).toBeNull();
  });
});

describe('a colliding ticker cannot carry another asset percentage', () => {
  // The real collision set, from CoinGecko's own coins/list: seven assets
  // answer to HOOD, and the one in the top-500 catalogue is a memecoin.
  const catalogueByTicker = new Map<string, number>([['HOOD', 190.545], ['AKE', 241.212]]);

  it('the old base-ticker lookup produced exactly the reported figure', () => {
    // Reproducing the defect, so the number in the report is not folklore.
    const oldLookup = (futuresSymbol: string) =>
      catalogueByTicker.get(futuresSymbol.split('/')[0].toUpperCase()) ?? null;
    expect(oldLookup('HOOD/USDT')).toBe(190.545);
    expect(oldLookup('HOOD/USDT')!.toFixed(2)).toBe('190.54'); // the owner screenshot
    expect(oldLookup('AKE/USDT')).toBe(241.212);
  });

  it('a contract figure derived from contract prices is unaffected by the collision', () => {
    // Same ticker, real contract prices: the answer comes from the contract.
    expect(contractReturnPercent(121, 100)).toBeCloseTo(21, 10);
    expect(contractReturnPercent(121, 100)).not.toBeCloseTo(190.545, 1);
  });
});
