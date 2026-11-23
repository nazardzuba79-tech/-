import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { botHistoryReader, buildBotHistory } from '../tradingBotPerformance';

const fixture = require('../../../scripts/qa-thomas-snapshot.cjs');
const owner = '00000000-0000-4000-8000-000000000722';

it('reconciles all five UTC windows, exact cash flows, fees and compounded monthly/yearly returns', () => {
  const input = fixture(owner);
  const result = buildBotHistory(input, owner);
  if (result.status !== 'verified') throw Error('missing fixture history');
  const monthly = result.monthly;
  expect(monthly.years).toEqual([2024, 2025]);
  expect(Object.keys(monthly.cells).filter(key => key.length === 7)).toHaveLength(24);
  expect(monthly.cells['2024-02']).toMatchObject({ roi: 0, trades: 0, partial: false });
  expect(monthly.cells['2024-04'].roi).toBeLessThan(0);
  expect(monthly.cells['2025-12'].partial).toBe(true);
  expect(monthly.cells['2023-12']).toBeUndefined();
  for (const period of Object.values(result.periods)) {
    const days = input.days.filter((d: {date: string}) => d.date >= period.firstDate);
    let growth = 1, peak = 1, drawdown = 0, pnl = 0, gross = 0, fees = 0;
    for (const [index,d] of days.entries()) {
      const profit = Number(d.closing) - Number(d.opening) - Number(d.externalFlow);
      growth *= 1 + profit / Number(d.opening);
      peak = Math.max(peak, growth);
      drawdown = Math.max(drawdown, 100 * (1 - growth / peak));
      pnl += profit; fees += Number(d.fees); gross += Number(d.realizedGross);
      expect(period.series[index + 1]).toBeCloseTo(100 * (growth - 1), 9);
    }
    expect(period.roi).toBeCloseTo(period.series[days.length], 10);
    expect(period.drawdown).toBeCloseTo(drawdown, 10);
    expect(period).toMatchObject({ netPnl: pnl, realizedPnl: gross, fees });
  }
  for (const yr of monthly.years) {
    const cells = Object.values(monthly.cells).filter(c => c.year === yr && c.month !== null);
    const growth = cells.reduce((v,c) => v * (1 + c.roi/100), 1);
    expect(monthly.cells[String(yr)].roi).toBeCloseTo(100 * (growth-1), 9);
  }
  expect(result.periods.ALL.roi).toBeCloseTo(100 * ((1+monthly.cells['2024'].roi/100) * (1+monthly.cells['2025'].roi/100)-1), 9);
  expect(result.periods['7D'].series).toHaveLength(8);
  expect(result.periods['30D'].series).toHaveLength(31);
  expect(result.periods['90D'].series).toHaveLength(91);
  expect(result.periods['1Y'].series).toHaveLength(366);
});

it('rejects incomplete, foreign, future or unreconciled publications and preserves unknown breakdowns', () => {
  const input = fixture(owner, '2024-01-03');
  for (const change of [
    { strategyId: 'other' }, { pair: 'ETH/USDT' }, { creatorUserId: 'other' }, { asOf: '2099-01-01T00:00:00Z' },
    { days: [] }, { days: [input.days[0], input.days[2]] }, { days: input.days.slice(1) },
    { days: [{...input.days[0], fees: '9'}, ...input.days.slice(1)] },
    { days: [input.days[0], {...input.days[1], opening: '45'}, input.days[2]] },
  ]) expect(() => buildBotHistory({...input,...change},owner)).toThrow();
  input.days[1].realizedGross = null;
  const result = buildBotHistory(input, owner);
  if (result.status !== 'verified') throw Error('missing fixture history');
  expect(result.periods.ALL.realizedPnl).toBeNull();
  expect(result.monthly.cells['2024-01'].realizedPnl).toBeNull();
});

it('reads approved persisted snapshots, coalesces readers and rejects a bad replacement after expiry', async () => {
  expect(await botHistoryReader(undefined,owner)()).toEqual({ status: 'unavailable' });
  const dir = await mkdtemp(join(tmpdir(), 'thomas-qa-'));
  const path = join(dir, 'aggregate.json');
  const clock = jest.spyOn(Date,'now').mockReturnValue(Date.UTC(2026,10,22));
  try {
    await writeFile(path,JSON.stringify(fixture(owner,'2024-01-02')));
    const read = botHistoryReader(path,owner);
    const one = read();
    expect(read()).toBe(one);
    const first = await one;
    expect(await botHistoryReader(path,owner)()).toEqual(first);
    await writeFile(path + '.next', JSON.stringify(fixture(owner,'2024-01-03')));
    await rename(path + '.next',path);
    clock.mockReturnValue(Date.UTC(2026,10,22,0,1));
    expect(await read()).not.toEqual(first);
    await writeFile(path,'{}');
    clock.mockReturnValue(Date.UTC(2026,10,22,0,2));
    await expect(read()).rejects.toThrow();
  } finally { clock.mockRestore(); await rm(dir,{ recursive:true, force:true }); }
});
