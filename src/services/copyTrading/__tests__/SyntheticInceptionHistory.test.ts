import { selectSyntheticPeriod } from '../../../../frontend/src/lib/syntheticCopyTrading';
import { addUtcDays, dayDiff } from '../analytics';
import { advanceState, createInitialState, toResponse } from '../SyntheticCopyTradingEngine';
import { MemorySyntheticStateStore, SyntheticCopyTradingService } from '../SyntheticCopyTradingService';
import type { SyntheticCopyState } from '../types';

const NOW = new Date('2026-09-05T12:00:00Z');
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('synthetic since-inception history and follower cohorts', () => {
  test('ALL starts 12 calendar months plus 15 days ago and derives +3727% from one ledger', () => {
    const state = createInitialState(NOW);
    const response = toResponse(state);
    const all = selectSyntheticPeriod(response, 'ALL');
    const recent = selectSyntheticPeriod(response, '90D');

    expect(state.initialEquityDate).toBe('2025-08-21');
    const opening = Number((4_711_027 / 37.27).toFixed(4));
    expect(opening).toBe(126_402.6563);
    expect(state.equityHistory[0]).toEqual({ date: '2025-08-21', equity: opening });
    expect(state.equityHistory.at(-1)).toEqual({ date: '2026-09-05', equity: 4_837_429.6563 });
    expect(state.dailyResults).toHaveLength(380);
    expect(all.equity).toHaveLength(381);
    expect(all.tradingDays).toBe(380);
    expect(all.totalTrades).toBe(3250);
    expect(all.winningTrades).toBe(3159);
    expect(all.losingTrades).toBe(91);
    expect(all.winRate).toBe(97.2);
    // Four-decimal opening equity represents the requested ratio to better
    // than 0.00001 percentage point; published ROI correctly rounds to 3727.
    expect(all.roi).toBeCloseTo(3727, 5);
    expect(all.roi).toBeCloseTo(all.pnl / opening * 100, 8);
    expect(all.pnl).toBe(4_711_027);
    expect(response.analytics.allTime.roi).toBe(3727);
    expect(response.analytics.allTime.pnl).toBe(all.pnl);
    expect(response.analytics.masterPnl).toBe(all.pnl);
    expect(sum(state.trades.map(trade => trade.netPnl))).toBeCloseTo(all.pnl, 3);
    expect(sum(state.dailyResults.map(day => day.realizedPnl))).toBeCloseTo(all.pnl, 3);
    expect(recent.equity[0]).toEqual(state.equityHistory.at(-91));
    expect(recent.roi).toBeCloseTo(recent.pnl / recent.equity[0].equity * 100, 8);
    expect(recent.roi).not.toBe(841);
    expect(recent.pnl).toBeCloseTo(4_837_429.6563 - recent.equity[0].equity, 3);
    expect(all.pnl - recent.pnl).toBeCloseTo(recent.equity[0].equity - opening, 3);
    expect(recent.trades.every(trade => all.trades.some(item => item.id === trade.id))).toBe(true);
    expect(new Set(state.trades.map(trade => trade.id)).size).toBe(state.trades.length);
  });

  test.each([
    ['2026-03-01', '2025-02-14'],
    ['2028-02-29', '2027-02-13'],
    ['2025-03-31', '2024-03-16'],
    ['2027-02-15', '2026-01-31'],
  ])('calendar inception for %s is %s, not a fixed 375-day lookback', (today, inception) => {
    const state = createInitialState(new Date(`${today}T12:00:00Z`));
    expect(state.initialEquityDate).toBe(inception);
    expect(state.dailyResults).toHaveLength(dayDiff(inception, today));
    expect(state.dailyResults[0].date).toBe(addUtcDays(inception, 1));
    expect(state.equityHistory.at(-1)!.date).toBe(today);
    expect(toResponse(state).analytics.allTime.roi).toBe(3727);
    expect(toResponse(state).analytics.winRate).toBe(97.2);
  });

  test('2 → 6 → 12 → 17 → 25 → 32 follows actual join dates and capital allocations', () => {
    const state = createInitialState(NOW);
    const milestones = [
      ['2025-08-21', 2], ['2025-08-27', 2], ['2025-08-28', 6],
      ['2025-09-21', 12], ['2025-10-21', 17], ['2026-02-21', 25],
      ['2026-09-05', 32],
    ] as const;
    for (const [date, count] of milestones) {
      const eligible = state.followers.filter(follower => follower.copyStartDate <= date && follower.active);
      const snapshot = state.aumHistory.find(point => point.date === date)!;
      expect(eligible).toHaveLength(count);
      expect(snapshot.followerCount).toBe(count);
      expect(snapshot.aum).toBeCloseTo(sum(eligible.map(follower => follower.allocatedCapital)), 2);
    }
    expect(state.followers.every(follower => follower.copyStartDate >= state.initialEquityDate
      && follower.copyStartDate <= state.equityHistory.at(-1)!.date)).toBe(true);
    expect(new Set(state.followers.map(follower => follower.copyStartDate)).size).toBeGreaterThan(14);
    expect(state.aumHistory).toHaveLength(state.equityHistory.length);
    for (const [index, snapshot] of state.aumHistory.entries()) {
      const eligible = state.followers.filter(follower => follower.active && follower.copyStartDate <= snapshot.date);
      expect(snapshot.date).toBe(state.equityHistory[index].date);
      expect(snapshot.followerCount).toBe(eligible.length);
      expect(snapshot.aum).toBeCloseTo(sum(eligible.map(follower => follower.allocatedCapital)), 2);
      if (index) {
        expect(snapshot.followerCount).toBeGreaterThanOrEqual(state.aumHistory[index - 1].followerCount!);
        expect(snapshot.aum).toBeGreaterThanOrEqual(state.aumHistory[index - 1].aum);
      }
    }
    expect(state.aumHistory[0].aum).toBeLessThan(state.aumHistory.at(-1)!.aum);
    expect(state.aumHistory.at(-1)!.aum).toBe(7_200_000);
    expect(state.followers).toEqual(createInitialState(NOW).followers);
  });

  test('month-end cohort milestones clamp without spilling into the following month', () => {
    const state = createInitialState(new Date('2027-02-15T12:00:00Z'));
    expect(state.initialEquityDate).toBe('2026-01-31');
    for (const [date, count] of [['2026-02-28', 12], ['2026-03-31', 17], ['2026-07-31', 25]] as const) {
      expect(state.followers.filter(follower => follower.copyStartDate <= date)).toHaveLength(count);
      expect(state.aumHistory.find(point => point.date === date)!.followerCount).toBe(count);
    }
  });

  test('each follower earns only eligible trade PnL against opening join-day equity, never retroactive ALL ROI', () => {
    const state = createInitialState(NOW);
    const response = toResponse(state);
    let roundedFollowerPnl = 0;
    for (const follower of state.followers) {
      const eligible = state.trades.filter(trade => trade.closedAt.slice(0, 10) >= follower.copyStartDate);
      const opening = [...state.equityHistory].reverse().find(point => point.date < follower.copyStartDate)
        ?? state.equityHistory[0];
      const scale = follower.allocatedCapital / opening.equity;
      const expected = sum(eligible.map(trade => scale * (trade.netPnl * follower.copyRatio
        - Math.abs(trade.netPnl) * (follower.slippageBps / 10_000 + follower.latencyMs / 50_000_000))));
      expect(follower.copiedTrades).toBe(eligible.length);
      expect(follower.realizedPnl).toBeCloseTo(expected, 2);
      expect(follower.currentEquity).toBeCloseTo(follower.allocatedCapital + expected, 2);
      expect(follower.roi).toBeCloseTo(expected / follower.allocatedCapital * 100, 3);
      if (follower.copyStartDate > state.initialEquityDate) {
        expect(follower.copiedTrades).toBeLessThan(state.trades.length);
        expect(eligible.some(trade => trade.closedAt.slice(0, 10) === follower.copyStartDate)).toBe(true);
        expect(Math.abs(follower.realizedPnl - follower.allocatedCapital * 37.27)).toBeGreaterThan(1);
      }
      roundedFollowerPnl += follower.realizedPnl + follower.unrealizedPnl;
    }
    expect(response.analytics.allTime.followersPnl).toBeCloseTo(roundedFollowerPnl, 2);
    expect(response.analytics.aum).toBeCloseTo(sum(state.followers.map(follower => follower.allocatedCapital)), 2);
    expect(response.analytics.aum).not.toBeCloseTo(sum(state.followers.map(follower => follower.currentEquity)), 0);
  });

  test('+90 appends the same high-activity regime without resetting inception, AUM or any historical trade', () => {
    const initial = createInitialState(NOW);
    const advanced = advanceState(initial, 90);
    expect(advanced.initialEquityDate).toBe(initial.initialEquityDate);
    expect(initial.continuationTemplateStart).toBe(290);
    expect(advanced.continuationTemplateStart).toBe(initial.continuationTemplateStart);
    expect(advanced.trades.slice(0, initial.trades.length)).toEqual(initial.trades);
    expect(advanced.dailyResults.slice(0, initial.dailyResults.length)).toEqual(initial.dailyResults);
    expect(advanced.equityHistory.slice(0, initial.equityHistory.length)).toEqual(initial.equityHistory);
    expect(advanced.aumHistory.slice(0, initial.aumHistory.length)).toEqual(initial.aumHistory);
    const template = initial.dailyResults.slice(-90);
    for (let offset = 0; offset < 90; offset++) {
      const index = initial.dailyResults.length + offset;
      const drift = 1 + 0.12 * Math.sin(index * 0.71) + 0.06 * Math.cos(index * 0.19);
      expect(advanced.dailyResults[index].realizedPnl).toBeCloseTo(template[offset].realizedPnl * drift, 3);
      expect(advanced.aumHistory[index + 1].followerCount).toBe(32);
      expect(advanced.aumHistory[index + 1].aum).toBe(7_200_000);
    }
    const response = toResponse(advanced);
    const originalIds = new Set(initial.trades.map(trade => trade.id));
    for (const period of ['7D', '30D', '90D', 'ALL'] as const) {
      const selected = selectSyntheticPeriod(response, period);
      expect(selected.daily).toHaveLength(period === 'ALL' ? 470 : Number(period.slice(0, -1)));
      expect(selected.pnl).toBeCloseTo(sum(selected.trades.map(trade => trade.netPnl)), 2);
      if (period !== 'ALL') expect(selected.trades.every(trade => !originalIds.has(trade.id))).toBe(true);
      else {
        expect(selected.totalTrades).toBeGreaterThan(initial.trades.length);
        expect(selected.pnl).toBeGreaterThan(4_711_027);
        expect(selected.roi).toBeGreaterThan(3727);
        expect(selected.equity[0]).toEqual(initial.equityHistory[0]);
      }
    }
    expect(response.analytics.allTime.followersPnl).toBeGreaterThan(toResponse(initial).analytics.allTime.followersPnl);
  });

  test.each([3, 4] as const)('persisted v%i keeps its original inception and join-day basis until an explicit reset', async version => {
    const stored: SyntheticCopyState = { ...createInitialState(NOW), version, mode: 'FAST_FORWARD' };
    const store = new MemorySyntheticStateStore(stored);
    const service = new SyntheticCopyTradingService(store, () => NOW);
    const save = jest.spyOn(store, 'save');
    expect(await service.get()).toEqual(toResponse(stored));
    expect(save).not.toHaveBeenCalled();
    await service.advance(7);
    const advanced: SyntheticCopyState = (await store.load())!;
    expect(advanced.version).toBe(version);
    expect(advanced.initialEquityDate).toBe(stored.initialEquityDate);
    expect(advanced.equityHistory.slice(0, stored.equityHistory.length)).toEqual(stored.equityHistory);
    expect(advanced.trades.slice(0, stored.trades.length)).toEqual(stored.trades);
    for (const follower of advanced.followers) {
      const basis = ([...advanced.equityHistory].reverse().find(point => version >= 4
        ? point.date < follower.copyStartDate : point.date <= follower.copyStartDate) ?? advanced.equityHistory[0]).equity;
      const expected = sum(advanced.trades.filter(trade => trade.closedAt.slice(0, 10) >= follower.copyStartDate)
        .map(trade => follower.allocatedCapital / basis * (trade.netPnl * follower.copyRatio
          - Math.abs(trade.netPnl) * (follower.slippageBps / 10_000 + follower.latencyMs / 50_000_000))));
      expect(follower.realizedPnl).toBeCloseTo(expected, 2);
    }
    expect((await service.reset()).analytics.allTime.roi).toBe(3727);
    expect((await store.load())!.version).toBe(6);
  });
});
