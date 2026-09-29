import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { copyPerformanceRouter } from '../../../api/routes/copyPerformance';
import { CopyPerformanceService } from '../CopyPerformanceService';
import { MarketplaceSnapshots } from '../marketplaceSnapshot';
import { DAILY_PROGRESSION_EFFECTIVE_FROM } from '../canonical/dailyProgression';
import { validStrategy } from '../../../../frontend/src/lib/copyMarketplaceStore';
import { privateStrategyView } from '../../../../frontend/src/lib/copyMarketplacePrivacy';
import { periodRatioFacts, selectSyntheticPeriod, syntheticNazaraTrader, syntheticPerformancePoints,
  type SyntheticCopyTradingResponse } from '../../../../frontend/src/lib/syntheticCopyTrading';
import { kseniaTrader, type KseniaResponse } from '../../../../frontend/src/lib/kseniaCopyTrading';
import { buildMonthlyPerformance } from '../../../../frontend/src/lib/monthlyCopyPerformance';

/**
 * ONE LEDGER → EVERY PERIOD → EVERY SURFACE, ACROSS A REAL DAY BOUNDARY.
 *
 *   TRADES → LEDGER → DAILY RESULTS / EQUITY → 7D / 30D / 90D / ALL
 *          → CARD / PROFILE / CHART / MONTHLY
 *
 * Day N is read, the clock moves to N+1, and the next trading event is
 * produced by the REAL path — `CopyPerformanceService` appending the day to
 * the persisted row, served through the real marketplace router — exactly as
 * a visitor's request produces it. Every period is then re-derived here,
 * independently, from the ledger's own daily rows, and every surface must
 * agree with that derivation to the cent. Raw numbers, never formatted text.
 */

jest.setTimeout(300_000);

const DAY_N = '2026-09-28';
const DAY_N1 = '2026-09-29';
const PERIODS = ['7D', '30D', '90D', 'ALL'] as const;
type Period = typeof PERIODS[number];
const WINDOW: Record<Exclude<Period, 'ALL'>, number> = { '7D': 7, '30D': 30, '90D': 90 };
const STRATEGIES = [{ key: 'nazar', id: 'VX-001' }, { key: 'ksenia', id: 'VX-KSENIA' }] as const;

function world() {
  const rows = new Map<string, any>();
  const db = {
    copyPerformanceScenario: {
      async findUnique({ where }: any) { const row = rows.get(where.id); return row ? { ...row } : null; },
      async create({ data }: any) { const row = { ...data, revision: 0 }; rows.set(data.id, row); return { ...row }; },
      async updateMany({ where, data }: any) {
        const row = rows.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        rows.set(where.id, { ...row, ...data, revision: row.revision + data.revision.increment }); return { count: 1 };
      },
    },
    copyStrategyOwner: { async findUnique({ where }: any) { return { traderId: where.traderId, publicName: where.traderId === 'VX-001' ? 'Nazar' : 'Ksenia', ownerUserId: null, premium: true }; } },
    user: { async findUnique() { return { avatarUrl: null, kycStatus: 'NOT_STARTED' }; } },
    session: { async findUnique({ where }: any) { return { id: where.id, userId: 'viewer', revokedAt: null, lastSeenAt: new Date() }; },
      async update({ where }: any) { return { id: where.id }; } },
  } as any;
  const clock = { day: DAY_N };
  const now = () => new Date(`${clock.day}T12:00:00Z`);
  const service = new CopyPerformanceService(db, now);
  // A generous budget stands for a host that does the day's work in time,
  // so the first request of the new day carries it (the slow-host path is
  // pinned separately in marketplaceSnapshot.test.ts).
  const snapshots = new MarketplaceSnapshots(db, service, { now, build: null, inlineBudgetMs: 120_000 });
  const server = express().use('/api/v1', copyPerformanceRouter(db, service, snapshots));
  const token = `Bearer ${jwt.sign({ sub: 'viewer', sid: 'session-1' }, process.env.JWT_SECRET as string, { expiresIn: '1h' })}`;
  return { clock, service, server, token };
}

/** Everything a visitor's browser is left with, and the ledger behind it. */
async function snapshot(w: ReturnType<typeof world>) {
  const response = await request(w.server).get('/api/v1/copy-trading/marketplace').set('Authorization', w.token);
  expect(response.status).toBe(200);
  const body = JSON.parse(JSON.stringify(response.body));
  const out: Record<string, any> = {};
  for (const s of STRATEGIES) {
    expect(validStrategy(body[s.key], s.id)).toBe(true);
    const wire = privateStrategyView(body[s.key]) as SyntheticCopyTradingResponse;
    const ledger = await w.service.get(s.key);
    out[s.key] = { wire, ledger };
  }
  return out;
}

/** The independent derivation: period slices of the ledger's own daily rows. */
function derive(daily: SyntheticCopyTradingResponse['dailyResults'], period: Period) {
  const end = daily[daily.length - 1].date;
  const cutoff = period === 'ALL' ? '' : new Date(Date.parse(`${end}T00:00:00Z`) - WINDOW[period] * 86_400_000).toISOString().slice(0, 10);
  const slice = daily.filter(day => day.date > cutoff);
  return {
    days: slice.length,
    roi: slice.reduce((sum, day) => sum + day.dailyReturn, 0) * 100,
    pnl: slice.reduce((sum, day) => sum + day.realizedPnl, 0),
    trades: slice.reduce((sum, day) => sum + ((day as any).numberOfTrades ?? 0), 0),
  };
}

let before: Record<string, any>;
let after: Record<string, any>;
beforeAll(async () => {
  const w = world();
  before = await snapshot(w);
  w.clock.day = DAY_N1;
  after = await snapshot(w);
});

describe.each(STRATEGIES)('$key: day N → day N+1', ({ key, id }) => {
  const b = () => before[key]; const a = () => after[key];

  it('records the raw day-N figures for every period (and they are the ledger\'s own)', () => {
    const raw: Record<string, unknown> = {};
    for (const period of PERIODS) {
      const view = selectSyntheticPeriod(b().wire, period);
      const expected = derive(b().wire.dailyResults, period);
      raw[period] = { roi: view.roi, pnl: view.pnl, trades: view.totalTrades };
      expect(view.roi).toBeCloseTo(expected.roi, 6);
      expect(view.pnl).toBeCloseTo(expected.pnl, 2);
      // Ksenia's review economics publish period ROI rounded to 4 decimals;
      // 3 decimals is well below the 2 the page prints.
      expect(b().wire.economics!.periods[period].roi).toBeCloseTo(expected.roi, 3);
      expect(b().wire.economics!.periods[period].masterPnl).toBeCloseTo(expected.pnl, 2);
    }
    expect(b().wire.simulation.simulatedAt.slice(0, 10)).toBe(DAY_N);
    // Printed so the owner can read the day-N numbers the test started from.
    console.info(`${key} day N ${DAY_N}: ${JSON.stringify(raw)}`);
  });

  it('the ledger gains exactly one closed trade, dated N+1, and the old history is untouched', () => {
    expect(DAY_N >= DAILY_PROGRESSION_EFFECTIVE_FROM).toBe(true);
    const oldTrades = b().ledger.trades; const newTrades = a().ledger.trades;
    expect(newTrades.length - oldTrades.length).toBe(1);
    const added = newTrades.filter((trade: any) => trade.closedAt.slice(0, 10) === DAY_N1);
    expect(added).toHaveLength(1);
    const byId = new Map(newTrades.map((trade: any) => [trade.id, trade]));
    for (const trade of oldTrades) expect(JSON.stringify(byId.get(trade.id))).toBe(JSON.stringify(trade));
    // Daily results and equity: one more row each, the prefix byte-identical.
    const oldDaily = b().wire.dailyResults; const newDaily = a().wire.dailyResults;
    expect(newDaily).toHaveLength(oldDaily.length + 1);
    expect(newDaily.at(-1).date).toBe(DAY_N1);
    expect(JSON.stringify(newDaily.slice(0, oldDaily.length))).toBe(JSON.stringify(oldDaily));
    const oldEquity = b().wire.equityHistory; const newEquity = a().wire.equityHistory;
    expect(newEquity).toHaveLength(oldEquity.length + 1);
    expect(newEquity.at(-1).date).toBe(DAY_N1);
    expect(JSON.stringify(newEquity.slice(0, oldEquity.length))).toBe(JSON.stringify(oldEquity));
    // The new day's P&L IS that trade's net P&L: one trade, one day.
    expect(newDaily.at(-1).numberOfTrades).toBe(1);
    expect(newDaily.at(-1).realizedPnl).toBeCloseTo(added[0].netPnl, 2);
    // And the trade count everywhere is the ledger's real count.
    expect(a().wire.tradeHistoryCount).toBe(b().wire.tradeHistoryCount + 1);
  });

  it('ALL takes the new trade: P&L grows by exactly its net P&L, ROI by exactly the day\'s return', () => {
    const newDay = a().wire.dailyResults.at(-1);
    const allBefore = selectSyntheticPeriod(b().wire, 'ALL'); const allAfter = selectSyntheticPeriod(a().wire, 'ALL');
    expect(allAfter.pnl - allBefore.pnl).toBeCloseTo(newDay.realizedPnl, 2);
    expect(allAfter.roi - allBefore.roi).toBeCloseTo(newDay.dailyReturn * 100, 6);
    expect(allAfter.totalTrades - allBefore.totalTrades).toBe(1);
    // Nothing old leaves ALL.
    expect(allAfter.calendarDays).toBe(allBefore.calendarDays + 1);
  });

  it.each(['7D', '30D', '90D'] as const)('%s is re-derived from its own rolling window (new day in, oldest day out)', period => {
    const days = WINDOW[period];
    const dailyAfter = a().wire.dailyResults;
    const view = selectSyntheticPeriod(a().wire, period);
    const expected = derive(dailyAfter, period);
    expect(view.calendarDays).toBe(days);
    expect(view.roi).toBeCloseTo(expected.roi, 6);
    expect(view.pnl).toBeCloseTo(expected.pnl, 2);
    expect(view.daily.at(-1)!.date).toBe(DAY_N1);
    // The change is exactly (new day) − (the day that left the window).
    const dailyBefore = b().wire.dailyResults;
    const dropped = dailyBefore[dailyBefore.length - days];
    const change = view.roi - selectSyntheticPeriod(b().wire, period).roi;
    expect(change).toBeCloseTo((dailyAfter.at(-1).dailyReturn - dropped.dailyReturn) * 100, 6);
    const pnlChange = view.pnl - selectSyntheticPeriod(b().wire, period).pnl;
    expect(pnlChange).toBeCloseTo(dailyAfter.at(-1).realizedPnl - dropped.realizedPnl, 2);
  });

  it('every period is recalculated — not only 7D', () => {
    for (const period of PERIODS) {
      expect(selectSyntheticPeriod(a().wire, period).roi).not.toBe(selectSyntheticPeriod(b().wire, period).roi);
      expect(a().wire.economics!.periods[period].roi).not.toBe(b().wire.economics!.periods[period].roi);
    }
    // No period is a multiple of another: each is its own window's sum.
    const p = (period: Period) => a().wire.economics!.periods[period].roi;
    expect(p('30D')).not.toBeCloseTo(p('7D') * 30 / 7, 3);
    expect(p('90D')).not.toBeCloseTo(p('30D') * 3, 3);
  });

  it.each(PERIODS)('%s: card, profile, chart and economics read one set of aggregates', period => {
    const data = a().wire;
    const view = selectSyntheticPeriod(data, period);
    const economics = data.economics!.periods[period];
    const trader = id === 'VX-001' ? syntheticNazaraTrader(data) : kseniaTrader(data as KseniaResponse);
    const cardRoi = { '7D': trader.roi7, '30D': trader.roi30, '90D': trader.roi90, ALL: trader.roiAll }[period];
    expect(cardRoi).toBe(economics.roi);                          // card
    expect(view.roi).toBeCloseTo(economics.roi, 3);                // profile (published at 4 dp)
    expect(view.pnl).toBeCloseTo(economics.masterPnl, 2);
    expect(view.followerPnl).toBe(economics.netFollowersPnl);
    expect(view.maximumDrawdown).toBe(economics.maximumDrawdown);
    expect(view.sharpe).toBe(economics.sharpe);
    expect(view.sortino).toBe(economics.sortino);
    expect(view.profitFactor).toBe(economics.profitFactor);
    const roiLine = syntheticPerformancePoints(view, 'ROI');      // chart
    expect(roiLine.at(-1)!.value).toBeCloseTo(view.roi, 6);
    expect(roiLine.at(-1)!.date).toBe(DAY_N1);
    const pnlLine = syntheticPerformancePoints(view, 'PnL');
    expect(pnlLine.at(-1)!.value).toBeCloseTo(view.pnl, 2);
    // Counts are integers and the win rate is theirs: wins over resolved
    // (non-zero) trades, the canonical v8 rule, never a separate number.
    const stats = data.tradeStats![period];
    for (const count of [view.totalTrades, view.winningTrades, view.losingTrades]) expect(Number.isInteger(count)).toBe(true);
    expect(view.totalTrades).toBe(stats.totalTrades);
    expect(view.winRate).toBeCloseTo(view.winningTrades / (view.winningTrades + view.losingTrades) * 100, 9);
    // «Сред. сделок в неделю» is an AVERAGE, so it may be fractional.
    expect(view.averageTradesPerWeek).toBeCloseTo(view.totalTrades / view.calendarDays * 7, 9);
    // ∞ only where the denominator really is zero, from this period's data.
    const facts = periodRatioFacts(view);
    expect(facts.profitFactorUnbounded).toBe(view.profitFactor === null && view.losingTrades === 0 && view.winningTrades > 0);
    expect(facts.sortinoUnbounded).toBe(view.sortino === null && view.daily.every(day => day.dailyReturn >= 0));
    expect(facts.lastTradeDate).toBe(DAY_N1);
    // 0.00% drawdown exactly when the period's daily index never fell.
    let peak = 100; let index = 100; let deepest = 0;
    for (const day of view.daily) { index += day.dailyReturn * 100; peak = Math.max(peak, index); deepest = Math.max(deepest, (peak - index) / peak * 100); }
    expect(view.maximumDrawdown).toBeCloseTo(deepest, 6);
  });

  it('the monthly table reads the same daily history and takes the new day', () => {
    const month = DAY_N1.slice(0, 7);
    const tableBefore = buildMonthlyPerformance(b().wire.dailyResults, b().wire.economics!.methodology, b().wire.monthly as any);
    const tableAfter = buildMonthlyPerformance(a().wire.dailyResults, a().wire.economics!.methodology, a().wire.monthly as any);
    const newDay = a().wire.dailyResults.at(-1);
    expect(tableAfter.cells[month].lastDate).toBe(DAY_N1);
    expect(tableAfter.cells[month].roi - tableBefore.cells[month].roi).toBeCloseTo(newDay.dailyReturn * 100, 6);
    expect(tableAfter.cells[month].realizedPnl - tableBefore.cells[month].realizedPnl).toBeCloseTo(newDay.realizedPnl, 2);
    // Every earlier month is unchanged.
    for (const [cellKey, cell] of Object.entries(tableBefore.cells)) {
      if (cellKey === month || cellKey === month.slice(0, 4)) continue;
      expect(JSON.stringify(tableAfter.cells[cellKey])).toBe(JSON.stringify(cell));
    }
  });
});

it('Ksenia\'s +61.9% stays on its own reported week and is carried into no rolling period', () => {
  for (const snap of [before, after]) {
    const data = snap.ksenia.wire;
    expect(data.weekly.find((week: any) => week.period === '2026-09-13').roi).toBe(61.9);
    for (const period of PERIODS) expect(data.economics.periods[period].roi).not.toBe(61.9);
    expect(data.analytics.roi7).not.toBe(61.9);
  }
});

it('the current cadence is exactly one closed trade per strategy per UTC day', () => {
  for (const s of STRATEGIES) {
    const daily = after[s.key].wire.dailyResults.filter((day: any) => day.date >= DAILY_PROGRESSION_EFFECTIVE_FROM);
    expect(daily.length).toBeGreaterThanOrEqual(8);
    for (const day of daily) expect(day.numberOfTrades).toBe(1);
  }
});
