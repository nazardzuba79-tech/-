import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { copyPerformanceRouter } from '../../../api/routes/copyPerformance';
import { CopyPerformanceService } from '../CopyPerformanceService';
import { validStrategy } from '../../../../frontend/src/lib/copyMarketplaceStore';

/**
 * THE MARKETPLACE ENDPOINT, AS THE BROWSER ACTUALLY MEETS IT.
 *
 * `copyTradingCriticalPath.test.ts` drives the client against sections built
 * from the service. This file closes the loop from the other end: it stands
 * the REAL router up on a real express app, makes a real HTTP request, and
 * feeds the bytes that come back to the REAL client validator.
 *
 * That is what makes the contract two-sided. A backend change that alters
 * the payload's shape cannot be merged by loosening the client, and a client
 * change that tightens the validator cannot be merged without a backend that
 * still satisfies it — either way, both ends have to move together, here.
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

/** The REAL router behind the REAL `requireAuth`, reached with a real signed
 *  bearer token. Auth is not stubbed out and not relaxed: a request without a
 *  token still gets a 401, which the last case here proves. */
function app(service: CopyPerformanceService) {
  const server = express();
  server.use('/api/v1', copyPerformanceRouter(scenarioTable(), service));
  return server;
}
const bearer = () => `Bearer ${jwt.sign({ sub: 'viewer', sid: 'session-1' },
  process.env.JWT_SECRET as string, { expiresIn: '1h' })}`;
const get = (server: express.Express) =>
  request(server).get('/api/v1/copy-trading/marketplace').set('Authorization', bearer());

const service = (now = () => new Date('2026-09-21T12:00:00Z')) =>
  new CopyPerformanceService(scenarioTable(), now);

it('the wire payload passes the client validator for BOTH traders', async () => {
  const response = await get(app(service()));
  expect(response.status).toBe(200);
  const body = JSON.parse(JSON.stringify(response.body)); // exactly what JSON transport leaves
  expect(body.errors).toEqual({});
  expect(validStrategy(body.nazar, 'VX-001')).toBe(true);
  expect(validStrategy(body.ksenia, 'VX-KSENIA')).toBe(true);
  // The clock here is 21 September — past the reported week — so 7D is the
  // engine's own rolling window again, and the reported figure stays where it
  // belongs: on the weekly row for 13-19 September.
  expect(body.ksenia.analytics.roi7).not.toBe(61.9);
  expect(body.ksenia.weekly.find((week: any) => week.period === '2026-09-13').roi).toBe(61.9);
  expect(body.ksenia.reportedWeeks[0].appliedToVisibleWeeklyRoi).toBe(false);
  // And the executions never left the building.
  expect(body.nazar.trades).toEqual([]);
  expect(body.ksenia.trades).toEqual([]);
  expect(JSON.stringify(body)).not.toContain('entryPrice');
});

it('a section that fails never takes its peers off the wire', async () => {
  const broken = service();
  const real = broken.get.bind(broken);
  (broken as any).get = (strategy: string) => strategy === 'ksenia'
    ? Promise.reject(new Error('stored state failed to decode')) : real(strategy as any);
  const response = await get(app(broken));
  expect(response.status).toBe(200);                          // NOT 503: one section is fine
  expect(response.body.errors).toEqual({ ksenia: 'temporarily_unavailable' });
  expect(response.body.ksenia).toBeNull();
  expect(validStrategy(response.body.nazar, 'VX-001')).toBe(true);
  // And the visitor is told nothing about why.
  expect(JSON.stringify(response.body)).not.toContain('decode');
});

it('every section is logged, by name and outcome, with nothing identifying in the line', async () => {
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const broken = service();
    const real = broken.get.bind(broken);
    (broken as any).get = (strategy: string) => strategy === 'ksenia'
      ? Promise.reject(new Error('stored state failed to decode')) : real(strategy as any);
    await get(app(broken));

    const lines = [...info.mock.calls, ...error.mock.calls].map(call => String(call[0]));
    const structured = lines.filter(line => line.startsWith('copy_marketplace.'));
    expect(structured.some(l => /^copy_marketplace\.nazar\.ok request_id=\S+ duration_ms=\d+$/.test(l))).toBe(true);
    expect(structured.some(l => /^copy_marketplace\.identities\.ok request_id=\S+ duration_ms=\d+$/.test(l))).toBe(true);
    expect(structured.some(l => /^copy_marketplace\.ksenia\.error request_id=\S+ duration_ms=\d+ error_class=Error$/.test(l))).toBe(true);
    // One request, one id, across all three lines.
    expect(new Set(structured.map(l => l.match(/request_id=(\S+)/)![1])).size).toBe(1);
    // NOTHING SENSITIVE. The bearer token, the account and any figure from
    // the payload stay out of the log, and so does the error's own text.
    for (const line of structured) {
      expect(line).not.toMatch(/Bearer|Authorization|token|viewer|decode|@/i);
      expect(line).not.toContain('61.9');
    }
  } finally { info.mockRestore(); error.mockRestore(); }
});

/**
 * INVARIANT 10 — A TIME BUDGET, NOT A BENCHMARK.
 *
 * Measured on this machine: a COLD response (empty scenario table, the whole
 * history replayed) costs ~2.1s for Nazar and ~1.2s for Ksenia, sequentially,
 * because the generation is synchronous CPU work — `Promise.allSettled` does
 * not overlap it and worker threads would be the only thing that could. A
 * WARM response is ~0ms plus a few ms of post-processing, since the service
 * caches each UTC-day projection and coalesces concurrent callers.
 *
 * So concurrency is deliberately LEFT ALONE: parallelising a 3.3s once-per-
 * process cost, inside a client that waits fifteen seconds, would be a
 * rewrite bought with nothing.
 *
 * The thresholds below are generous on purpose. They are not here to notice
 * that a response got 200ms slower — that would be a flaky test on shared CI
 * hardware. They are here to fail when something has HUNG or regressed by an
 * order of magnitude: a cold response that outruns the client's own fifteen
 * second abort can never reach a card at all, and a warm response that takes
 * seconds means the day cache has stopped working.
 */
it('the endpoint stays inside the client\'s own fifteen-second abort window', async () => {
  const svc = service();
  const server = app(svc);

  const cold = Date.now();
  const first = await get(server);
  const coldMs = Date.now() - cold;
  expect(first.status).toBe(200);
  // The client abandons at 15s. A cold generation that reaches it is a card
  // that can never load, whatever else is healthy.
  expect(coldMs).toBeLessThan(12_000);

  const warm = Date.now();
  const second = await get(server);
  const warmMs = Date.now() - warm;
  expect(second.status).toBe(200);
  // Measured at a few ms. Seconds here means the per-UTC-day cache is gone
  // and every viewer is paying the cold cost.
  expect(warmMs).toBeLessThan(2_000);
  expect(validStrategy(second.body.nazar, 'VX-001')).toBe(true);
  expect(validStrategy(second.body.ksenia, 'VX-KSENIA')).toBe(true);
});

it('the endpoint is still closed to a request with no session', async () => {
  // Nothing in this task relaxes auth. A marketplace that answered an
  // anonymous caller would be a far worse bug than a card that will not load.
  const anonymous = await request(app(service())).get('/api/v1/copy-trading/marketplace');
  expect(anonymous.status).toBe(401);
  expect(anonymous.body.nazar).toBeUndefined();
  expect(anonymous.body.ksenia).toBeUndefined();
});
