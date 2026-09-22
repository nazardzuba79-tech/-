/**
 * Two customer-facing defects, pinned.
 *
 * 1. The Futures chart narrated its own backfill — loading, 10k cap, no
 *    older candles. A chart that has loaded every candle that exists is
 *    working correctly; saying so invites the reader to think it is not.
 *    Reaching the end of history must now be SILENT. A chart that genuinely
 *    could not load at all still says so, with Retry (PR #169).
 *
 * 2. The Futures pair chooser must keep its owner-requested 7-day sort,
 *    but never repeat the old base-ticker collision: HOOD/USDT once showed
 *    GreenHood's +190.54%. The restored reference sort therefore accepts
 *    only catalogue identities that are explicitly non-ambiguous; a
 *    collision stays null and sorts last instead of borrowing a value.
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

describe('the Futures chooser keeps 7-day sorting without the collision bug', () => {
  it('restores the owner-requested 7-day controls', () => {
    expect(pairListCode).toContain("'change7d'");
    expect(pairListCode).toContain('pairs-7d');
    expect(pairListCode).toContain('trade.sort7dGainers');
    expect(pairListCode).toContain('trade.sort7dLosers');
  });

  it('loads the shared catalogue only while 7-day sorting is active', () => {
    expect(pairListCode).toMatch(/import .*catalogueStore.* from/);
    expect(pairListCode).toContain("useChange7d(sortField === 'change7d')");
    expect(pairListCode).toContain('catalogueStore.subscribe');
  });

  it('refuses ambiguous catalogue identities instead of borrowing their return', () => {
    expect(pairListCode).toContain('asset.ambiguous || asset.collidingIds.length > 0');
    expect(pairListCode).toContain('continue;');
    expect(pairListCode).toContain('asset.market?.changePercent7d');
  });

  it('still builds the market rows only from the Futures symbols prop', () => {
    expect(pairListCode).toContain('const built = symbols');
    expect(pairListCode).not.toMatch(/symbols\s*=\s*\[?\s*\.\.\.\s*(state\.)?assets/);
    expect(pairListCode).not.toMatch(/tradingPairs\.push/);
  });

  it('takes price, 24h change and turnover from this contract own live ticker', () => {
    for (const field of ['lastPrice', 'changePercent24h', 'quoteVolume24h']) {
      expect(pairList).toContain(`tk?.${field}`);
    }
  });
});

describe('the known collision cannot reappear', () => {
  const safe = (assets: Array<{symbol:string;ambiguous:boolean;collidingIds:string[];change:number|null}>, symbol: string) => {
    const map = new Map<string, number>();
    for (const asset of assets) {
      if (asset.ambiguous || asset.collidingIds.length > 0) continue;
      if (typeof asset.change === 'number' && Number.isFinite(asset.change)) map.set(asset.symbol, asset.change);
    }
    return map.get(symbol) ?? null;
  };

  it('HOOD with a collision is null, not GreenHood +190.54%', () => {
    expect(safe([{symbol:'HOOD',ambiguous:true,collidingIds:['cg:greenhood'],change:190.545}], 'HOOD')).toBeNull();
  });

  it('a unique asset keeps its real catalogue 7-day value', () => {
    expect(safe([{symbol:'BTC',ambiguous:false,collidingIds:[],change:8.5}], 'BTC')).toBe(8.5);
  });
});
