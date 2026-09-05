import { createInitialState, advanceState, toResponse } from '../../../../src/services/copyTrading/SyntheticCopyTradingEngine';
import { formatSyntheticHistoryDate, syntheticAumMilestones, syntheticMainMarkets, syntheticChartData } from '../syntheticCopyTrading';

const now = new Date('2026-09-05T12:00:00Z');

test('ALL labels include inception years and milestones use actual recorded counts and capital', () => {
  const response = toResponse(createInitialState(now));
  const milestones = syntheticAumMilestones(response.aumHistory);
  expect(milestones.map(point => point.followerCount)).toEqual([2, 6, 12, 17, 25, 32]);
  for (const point of milestones) {
    expect(response.aumHistory.find(snapshot => snapshot.date === point.date))
      .toEqual({ date: point.date, aum: point.aum, followerCount: point.followerCount });
  }
  expect(syntheticChartData(response, 'ALL').xLabels[0]).toBe('21.08.2025');
  expect(syntheticChartData(response, 'ALL').xLabels[4]).toBe('05.09.2026');
  expect(formatSyntheticHistoryDate('2025-12-31')).toBe('31.12.2025');
});

test('milestones preserve inception after advancing and never invent missing legacy counts', () => {
  const initial = createInitialState(now);
  const advanced = advanceState(initial, 90);
  expect(syntheticAumMilestones(advanced.aumHistory).slice(0, -1))
    .toEqual(syntheticAumMilestones(initial.aumHistory).slice(0, -1));
  expect(syntheticAumMilestones(advanced.aumHistory).at(-1)?.date).toBe('2026-12-04');
  expect(syntheticAumMilestones([{ date: '2026-01-31', aum: 100 }, { date: '2026-02-28', aum: 200 }])
    .every(point => point.followerCount === undefined)).toBe(true);
  expect(syntheticAumMilestones([])).toEqual([]);
});

test('Main Markets includes XRP from the actual strategy ledger, without duplicate or fictitious markets', () => {
  const state = createInitialState(now);
  expect(syntheticMainMarkets(state.trades)).toEqual(['BTC', 'ETH', 'SOL', 'XRP']);
  expect(syntheticMainMarkets([{ symbol: 'XRPUSDT' }, { symbol: 'BTCUSDT' }, { symbol: 'BTCUSDT' }]))
    .toEqual(['BTC', 'XRP']);
  expect(syntheticMainMarkets([{ symbol: 'BTC/USDT' }])).toEqual(['BTC']);
  expect(syntheticMainMarkets([])).toEqual([]);
});
