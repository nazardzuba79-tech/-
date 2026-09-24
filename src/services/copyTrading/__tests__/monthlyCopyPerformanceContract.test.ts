import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { copyPerformanceRouter } from '../../../api/routes/copyPerformance';
import { CopyPerformanceService } from '../CopyPerformanceService';
import { buildMonthlyPerformance } from '../../../../frontend/src/lib/monthlyCopyPerformance';

/**
 * «Статистика по месяцам», against the bytes the browser actually gets.
 *
 * The table is computed in the browser from the strategy's `dailyResults`.
 * The server already summarises the same history per calendar month with the
 * canonical engine (`summarizeCashflowPeriods`). Here the REAL router is
 * asked over real HTTP, and for BOTH featured traders every month the
 * browser derives must agree with the server's own month — return,
 * drawdown and trade count — and each trader's table must be built from
 * that trader's history alone.
 */

jest.setTimeout(120_000);

function scenarioTable() {
  const rows = new Map<string, any>();
  return {
    copyPerformanceScenario: {
      async findUnique({ where }: any) { const row = rows.get(where.id); return row ? { ...row } : null; },
      async create({ data }: any) { const row = { ...data, revision: 0 }; rows.set(data.id, row); return { ...row }; },
      async updateMany({ where, data }: any) {
        const row = rows.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        rows.set(where.id, { ...row, ...data, revision: row.revision + data.revision.increment });
        return { count: 1 };
      },
    },
    copyStrategyOwner: {
      async findUnique({ where }: any) {
        return { traderId: where.traderId, publicName: where.traderId === 'VX-001' ? 'Nazar' : 'Ksenia',
          ownerUserId: `owner-${where.traderId}`, premium: true };
      },
    },
    user: { async findUnique() { return { avatarUrl: null, kycStatus: 'NOT_STARTED' }; } },
    session: {
      async findUnique({ where }: any) { return { id: where.id, userId: 'viewer', revokedAt: null, lastSeenAt: new Date() }; },
      async update({ where }: any) { return { id: where.id }; },
    },
  } as any;
}

async function marketplace(at: string) {
  const db = scenarioTable();
  const server = express();
  server.use('/api/v1', copyPerformanceRouter(db, new CopyPerformanceService(db, () => new Date(at))));
  const token = jwt.sign({ sub: 'viewer', sid: 'session-1' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
  const response = await request(server).get('/api/v1/copy-trading/marketplace').set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  return JSON.parse(JSON.stringify(response.body));
}

let body: any;
beforeAll(async () => { body = await marketplace('2026-09-24T12:00:00Z'); });

describe.each([['nazar', 'VX-001'], ['ksenia', 'VX-KSENIA']])('%s', (key, traderId) => {
  const strategy = () => body[key];
  const table = () => buildMonthlyPerformance(strategy().dailyResults, strategy().economics?.methodology, strategy().monthly);

  it('is this trader’s own strategy, on the served methodology, with its full daily history', () => {
    expect(strategy().trader.id).toBe(traderId);
    expect(strategy().economics.methodology).toBe('CASH_FLOW_ADJUSTED_SIMPLE_RETURN');
    // The table spans exactly the years the history spans.
    const dates = strategy().dailyResults.map((day: any) => day.date);
    expect(table().years).toEqual([2025, 2026]);
    expect(dates[0] < '2025-09-01').toBe(true);
    expect(dates.at(-1)).toBe('2026-09-24');
  });

  it('agrees with the server’s canonical month on every month: ROI, drawdown and trades', () => {
    const cells = table().cells;
    expect(strategy().monthly.length).toBeGreaterThan(10);
    for (const month of strategy().monthly) {
      const cell = cells[month.period];
      expect(cell).toBeDefined();
      expect(cell.roi).toBeCloseTo(month.roi, 3);
      expect(cell.maximumDrawdown).toBeCloseTo(month.maxDrawdown, 3);
      expect(cell.trades).toBe(month.trades);
    }
    // And there is no month the server does not know.
    const months = Object.keys(cells).filter(k => k.length === 7).sort();
    expect(months).toEqual(strategy().monthly.map((row: any) => row.period).sort());
  });

  it('realised PnL of a month is the sum of that month’s daily realised PnL, and matches the server’s month', () => {
    const cells = table().cells;
    for (const month of strategy().monthly) {
      expect(cells[month.period].realizedPnl).toBeCloseTo(month.pnl, 2);
    }
  });

  it('a year’s total is its own days, summed for the simple return — equal to the sum of its months only because the method is additive', () => {
    const cells = table().cells;
    for (const year of table().years) {
      const days = strategy().dailyResults.filter((day: any) => day.date.startsWith(`${year}-`));
      expect(cells[String(year)].roi).toBeCloseTo(days.reduce((t: number, d: any) => t + d.dailyReturn, 0) * 100, 9);
      const months = Object.values(cells).filter(c => c.year === year && c.month !== null);
      expect(cells[String(year)].roi).toBeCloseTo(months.reduce((t, c) => t + c.roi, 0), 9);
    }
  });

  it('trading days use the server’s own rule (a day with at least one trade)', () => {
    const cells = table().cells;
    for (const month of strategy().monthly) {
      const days = strategy().dailyResults.filter((day: any) => day.date.startsWith(month.period));
      expect(cells[month.period].tradingDays).toBe(days.filter((day: any) => day.numberOfTrades > 0).length);
    }
  });
});

it('Nazar and Ksenia are two different tables, each from its own history', () => {
  const nazar = buildMonthlyPerformance(body.nazar.dailyResults, body.nazar.economics.methodology, body.nazar.monthly);
  const ksenia = buildMonthlyPerformance(body.ksenia.dailyResults, body.ksenia.economics.methodology, body.ksenia.monthly);
  // Different inception months: Ksenia's history starts on 6 August 2025, Nazar's on 21 August.
  expect(nazar.cells['2025-08'].firstDate).not.toBe(ksenia.cells['2025-08'].firstDate);
  expect(nazar.cells['2025-08'].calendarDays).not.toBe(ksenia.cells['2025-08'].calendarDays);
  const differing = Object.keys(nazar.cells).filter(key => ksenia.cells[key] && nazar.cells[key].roi !== ksenia.cells[key].roi);
  expect(differing.length).toBeGreaterThan(10);
  // Ksenia's September carries her reported trade (+7.8 on 16 September) —
  // in her daily history and her server month, never in Nazar's.
  expect(ksenia.cells['2026-09'].roi).toBeCloseTo(body.ksenia.monthly.find((m: any) => m.period === '2026-09').roi, 3);
  expect(nazar.cells['2026-09'].roi).toBeCloseTo(body.nazar.monthly.find((m: any) => m.period === '2026-09').roi, 3);
});

it('the current month is marked as still running, the inception month as started mid-month', () => {
  for (const key of ['nazar', 'ksenia']) {
    const table = buildMonthlyPerformance(body[key].dailyResults, body[key].economics.methodology, body[key].monthly);
    expect(table.latestKey).toBe('2026-09');
    expect(table.cells['2026-09'].partial).toBe(true);
    expect(table.cells['2026-09'].lastDate).toBe('2026-09-24');
    expect(table.cells['2025-08'].partial).toBe(true);
    expect(table.cells['2025-12'].partial).toBe(false);
    expect(table.cells['2025'].partial).toBe(true);
    // Months before the history begins have no cell at all: the screen prints «—».
    expect(table.cells['2025-07']).toBeUndefined();
    expect(table.cells['2026-10']).toBeUndefined();
  }
});
