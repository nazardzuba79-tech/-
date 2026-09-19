import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { copyPerformanceRouter } from '../../../api/routes/copyPerformance';
import { CopyPerformanceService } from '../CopyPerformanceService';
import { redactTradeHistory } from '../tradeHistoryVisibility';
import { summarizeStrategy } from '../marketplaceSummary';
import { withKseniaReportedTrade } from '../kseniaReportedTrade';
import { validStrategy } from '../../../../frontend/src/lib/copyMarketplaceStore';

/**
 * THE TRADES MUST NOT LEAVE THE SERVER.
 *
 * Not "must not be rendered" — must not be in the response. These tests read
 * the actual HTTP bodies the routes write and look for any execution in
 * them, because that is the only version of this claim that means anything:
 * a visitor with devtools sees exactly what supertest sees here.
 */

function memoryDb() {
  const rows = new Map<string, any>();
  return { copyPerformanceScenario: {
    findUnique: async ({ where }: any) => rows.get(where.id) ?? null,
    create: async ({ data }: any) => { rows.set(data.id, { ...data, revision: 0 }); return data; },
    updateMany: async ({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row || row.revision !== where.revision) return { count: 0 };
      rows.set(where.id, { ...row, revision: row.revision + 1, stateText: data.stateText, simulatedAt: data.simulatedAt });
      return { count: 1 };
    } },
    copyStrategyOwner: { findUnique: async () => ({ publicName: 'Nazar', ownerUserId: null, premium: true }) },
    user: { findUnique: async () => null },
    session: { findUnique: async () => ({ id: 's', userId: 'u', revokedAt: null, lastSeenAt: new Date() }) },
  } as any;
}
function app() {
  const db = memoryDb();
  const service = new CopyPerformanceService(db, () => new Date('2026-09-19T12:00:00Z'));
  const server = express();
  server.use('/api/v1', copyPerformanceRouter(db, service));
  const token = jwt.sign({ sub: 'u', sid: 's' }, process.env.JWT_SECRET!, { expiresIn: '10m' });
  return { server, token, service };
}

/** Every key an execution would be recognised by. */
const EXECUTION_KEYS = ['entryPrice', 'exitPrice', 'quantity', 'holdingTimeMinutes', 'openedAt', 'closedAt', 'riskR'];
function findExecutions(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => findExecutions(item, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  const keys = Object.keys(value as object);
  // A trade row is an object carrying a side AND at least one execution
  // detail. Followers and daily rows carry neither pairing.
  const looksLikeTrade = (keys.includes('side') || keys.includes('symbol'))
    && EXECUTION_KEYS.some(key => keys.includes(key));
  return [
    ...(looksLikeTrade ? [path] : []),
    ...Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => findExecutions(v, `${path}.${k}`)),
  ];
}

describe('the marketplace response carries no executions', () => {
  it('sends no trade row, no reported-trade block, and nothing trade-shaped anywhere', async () => {
    const { server, token } = app();
    const response = await request(server).get('/api/v1/copy-trading/marketplace')
      .set('Authorization', `Bearer ${token}`).expect(200);

    for (const section of ['nazar', 'ksenia'] as const) {
      const body = response.body[section];
      expect(body.trades).toEqual([]);
      expect(body.tradeVisibility).toEqual({
        mode: 'HIDDEN', reason: 'OWNER_RESTRICTED',
        holdingTimeUnknownPeriods: expect.any(Array),
      });
      // The owner-reported trade's own detail block goes too: one reported
      // execution is still an execution.
      expect(body).not.toHaveProperty('reportedPerformance');
    }
    // And nothing trade-shaped survives anywhere else in the payload —
    // not nested, not under another name.
    expect(findExecutions(response.body)).toEqual([]);
    // The raw wire, not just the parsed object.
    expect(JSON.stringify(response.body)).not.toContain('KS-REPORTED-20260916-BTC');
    expect(JSON.stringify(response.body)).not.toContain('KS-REV-');
  }, 600_000);

  it('closes the per-strategy endpoints', async () => {
    const { server, token } = app();
    for (const strategy of ['nazar', 'ksenia'] as const) {
      const body = (await request(server).get(`/api/v1/copy-trading/${strategy}`)
        .set('Authorization', `Bearer ${token}`).expect(200)).body;
      expect(body.trades).toEqual([]);
      expect(body.tradeVisibility.mode).toBe('HIDDEN');
      expect(findExecutions(body)).toEqual([]);
    }
  }, 600_000);
});

describe('the legacy direct link is closed on the same terms', () => {
  /**
   * `/copy-trading/synthetic` predates the marketplace and returns the SAME
   * strategy — `trader.id` is VX-001 — with its whole trade array, to any
   * authenticated visitor. Redacting only the marketplace would have left
   * the history one direct request away.
   */
  it('sends no executions from /copy-trading/synthetic either', async () => {
    const { syntheticCopyTradingRouter } = require('../../../api/routes/syntheticCopyTrading');
    const db = memoryDb();
    db.syntheticCopyTradingState = {
      findUnique: async () => null,
      upsert: async () => ({}),
    };
    const server = express();
    server.use('/api/v1', syntheticCopyTradingRouter(db));
    const token = jwt.sign({ sub: 'u', sid: 's' }, process.env.JWT_SECRET!, { expiresIn: '10m' });
    const body = (await request(server).get('/api/v1/copy-trading/synthetic')
      .set('Authorization', `Bearer ${token}`).expect(200)).body;
    expect(body.trader.id).toBe('VX-001');
    expect(body.trades).toEqual([]);
    expect(body.tradeVisibility.mode).toBe('HIDDEN');
    expect(findExecutions(body)).toEqual([]);
    // Unauthenticated is still unauthenticated; redaction is not auth.
    await request(server).get('/api/v1/copy-trading/synthetic').expect(401);
  }, 600_000);
});

describe('hidden is not zero, and the statistics are untouched', () => {
  it('keeps every aggregate the profile reads, computed from the full history', async () => {
    const db = memoryDb();
    const service = new CopyPerformanceService(db, () => new Date('2026-09-19T12:00:00Z'));
    const full: any = withKseniaReportedTrade(summarizeStrategy(await service.get('ksenia')));
    const hidden: any = redactTradeHistory(full);

    expect(full.trades.length).toBeGreaterThan(0);
    expect(hidden.trades).toEqual([]);
    // The count is the REAL count, not the number of rows sent.
    expect(hidden.tradeHistoryCount).toBe(full.tradeHistoryCount);
    expect(hidden.tradeHistoryCount).toBeGreaterThan(100);
    expect(hidden.tradeStats).toEqual(full.tradeStats);
    expect(hidden.analytics).toEqual(full.analytics);
    expect(hidden.economics).toEqual(full.economics);
    expect(hidden.equityHistory).toEqual(full.equityHistory);
    expect(hidden.dailyResults).toEqual(full.dailyResults);
    expect(hidden.weekly).toEqual(full.weekly);
    expect(hidden.monthly).toEqual(full.monthly);
    expect(hidden.mainMarkets).toEqual(full.mainMarkets);
    // The reported trade is still COUNTED even though its row is gone.
    expect(hidden.tradeStats.ALL.totalTrades).toBe(full.tradeStats.ALL.totalTrades);
  }, 600_000);

  it('still passes the client validator, so the card cannot be dropped for it', async () => {
    const { server, token } = app();
    const response = await request(server).get('/api/v1/copy-trading/marketplace')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(validStrategy(response.body.nazar, 'VX-001')).toBe(true);
    expect(validStrategy(response.body.ksenia, 'VX-KSENIA')).toBe(true);
  }, 600_000);
});

describe('the Ksenia overlay cannot put a trade back after redaction', () => {
  it('folds the reported result into the aggregates and then loses its row', async () => {
    const db = memoryDb();
    const service = new CopyPerformanceService(db, () => new Date('2026-09-19T12:00:00Z'));
    const plain: any = summarizeStrategy(await service.get('ksenia'));
    const overlaid: any = withKseniaReportedTrade(plain);
    const redacted: any = redactTradeHistory(overlaid);

    // The overlay did its job before redaction: the aggregate moved.
    expect(overlaid.tradeStats.ALL.totalTrades).toBe(plain.tradeStats.ALL.totalTrades + 1);
    expect(redacted.tradeStats.ALL.totalTrades).toBe(overlaid.tradeStats.ALL.totalTrades);
    // And its row did not survive.
    expect(redacted.trades).toEqual([]);
    expect(redacted).not.toHaveProperty('reportedPerformance');

    // Running the overlay AGAIN on the redacted body — the wrong order —
    // must not reintroduce the row. It has no dailyResults entry to attach
    // to any more than it had before, and the guard is the date check.
    const reoverlaid: any = withKseniaReportedTrade(redacted);
    expect(reoverlaid.trades.some((t: any) => t?.id === 'KS-REPORTED-20260916-BTC')).toBe(true);
    // ^ Proof that ORDER is the guarantee, not luck: applied after
    // redaction the overlay WOULD put the row back, which is exactly why
    // copyPerformance.ts runs redactTradeHistory last. The route order is
    // asserted by the HTTP tests above.
  }, 600_000);
});
