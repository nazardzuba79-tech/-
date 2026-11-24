import { BOT_CATALOGUE, botPresentation, maxDrawdown, nextPresentationWeek, presentationPeriod, presentationWeek, validBotBudget } from '../tradingBotsPresentation';

describe('presentation bot catalogue — synthetic, stable weekly scenarios', () => {
  it('contains seven distinct strategies with distinct minimums starting at $2,500', () => {
    expect(BOT_CATALOGUE).toHaveLength(7);
    expect(new Set(BOT_CATALOGUE.map(b => b.id)).size).toBe(7);
    const minimums = BOT_CATALOGUE.map(b => b.minimum);
    expect(Math.min(...minimums)).toBe(2500);
    expect(new Set(minimums).size).toBe(7);
  });
  it('preserves the XRP strategy identity, weekly return and chart endpoint after the rename', () => {
    const bot = BOT_CATALOGUE.find(entry => entry.id === 'range')!;
    expect(bot).toMatchObject({ name: 'Thomas Quant AI', symbol: 'XRP / USDT', creatorName: 'Thomas', category: 'trend' });
    const stats = botPresentation(bot, presentationWeek(Date.parse('2026-11-22T12:00:00Z')));
    expect(stats.roi).toBe(180.26);
    expect(stats.series[stats.series.length - 1]).toBe(stats.roi);
  });
  it('changes only at Monday 00:00 UTC, including the year boundary', () => {
    const sunday = Date.parse('2026-12-27T23:59:59.999Z');
    expect(presentationWeek(sunday + 1)).toBe(presentationWeek(sunday) + 1);
    expect(nextPresentationWeek(sunday)).toBe(sunday + 1);
    expect(presentationWeek(Date.parse('2026-12-28T00:00:00Z'))).toBe(presentationWeek(Date.parse('2027-01-03T23:59:59Z')));
    expect(() => presentationWeek(NaN)).toThrow(RangeError);
  });
  it.each(BOT_CATALOGUE)('$name remains within the requested monthly model range over 104 weeks', bot => {
    for (let week = 0; week < 104; week++) {
      const first = botPresentation(bot, week), again = botPresentation(bot, week);
      expect(first).toEqual(again);
      if (bot.id === 'range') expect(first.roi).toBe(180.26);
      expect(first.roi).toBeGreaterThanOrEqual(120);
      expect(first.roi).toBeLessThanOrEqual(217);
      expect(first.series[0]).toBe(0);
      expect(first.series[first.series.length - 1]).toBe(first.roi);
      expect(first.winRate).toBe(Math.round(first.wins / first.trades * 10000) / 100);
      expect(first.drawdown).toBe(maxDrawdown(first.series));
      expect(botPresentation(bot, week + 1)).not.toEqual(first);
    }
  });
  it('uses seven different model chart trajectories rather than one copied ascending graph', () => {
    const curves = BOT_CATALOGUE.map(bot => botPresentation(bot, 46).series);
    const normalized = curves.map(points => points.map((point, i) =>
      i === 0 ? 0 : Math.round(point / points[points.length - 1] * 1000)).join(','));
    expect(new Set(normalized).size).toBe(BOT_CATALOGUE.length);
    for (const id of ['atlas', 'sol', 'delta', 'range', 'breakout']) {
      const bot = BOT_CATALOGUE.find(value => value.id === id)!;
      const points = botPresentation(bot, 46).series;
      expect(points.some((point, index) => index > 0 && point < points[index - 1])).toBe(true);
    }
  });
  it('computes drawdown from equity, not percentage-point differences', () => {
    expect(maxDrawdown([0, 100, 50, 200])).toBe(25);
    expect(maxDrawdown([0, 10, 20])).toBe(0);
  });
  it('normalizes a seven-day window to its own starting equity', () => {
    const series = Array.from({ length: 31 }, (_, i) => i * 10);
    expect(presentationPeriod(series, 30)).toEqual(series);
    const week = presentationPeriod(series, 7);
    expect(week[0]).toBe(0);
    expect(week[7]).toBe(21.21);
    expect(series[30]).toBe(300);
  });
  it.each(['', ' ', '-1', '2499.99', 'Infinity', 'NaN', '1e8', '2500.001', '2500x'])('rejects invalid budget %j', value => {
    expect(validBotBudget(value, 2500)).toBe(false);
  });
  it.each(['2500', '2500.01', '15000.50'])('accepts a complete budget %s', value => {
    expect(validBotBudget(value, 2500)).toBe(true);
  });
});
