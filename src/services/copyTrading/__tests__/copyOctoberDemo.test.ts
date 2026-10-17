import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { copyPerformanceRouter } from '../../../api/routes/copyPerformance';
import { CopyPerformanceService } from '../CopyPerformanceService';
import { MarketplaceSnapshots } from '../marketplaceSnapshot';
import { CopyMarketplaceStore } from '../../../../frontend/src/lib/copyMarketplaceStore';
import { selectSyntheticPeriod, syntheticNazaraTrader, syntheticPerformancePoints } from '../../../../frontend/src/lib/syntheticCopyTrading';
import { kseniaTrader } from '../../../../frontend/src/lib/kseniaCopyTrading';
import { demoRoiFor } from '../../../../frontend/src/lib/copyDemoRoi';

jest.setTimeout(180_000);
const strategies = [['nazar', 'VX-001', 179], ['ksenia', 'VX-KSENIA', 132]] as const;
const periods = ['7D', '30D', '90D', 'ALL'] as const;

test('18–22 October: API → persisted snapshot → frontend stays dynamic, restart-safe and financially isolated', async () => {
  const rows = new Map<string, any>();
  const financialWrites = jest.fn(() => { throw new Error('Financial writes are forbidden in this scenario'); });
  const db: any = {
    copyPerformanceScenario: {
      async findUnique({ where }: any) { return rows.get(where.id) ?? null; },
      async create({ data }: any) {
        if (rows.has(data.id)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        const row = { ...data, revision: 0 }; rows.set(data.id, row); return { ...row };
      },
      async updateMany({ where, data }: any) {
        const row = rows.get(where.id);
        if (!row || row.revision !== where.revision) return { count: 0 };
        rows.set(where.id, { ...row, ...data, revision: row.revision + data.revision.increment });
        return { count: 1 };
      },
    },
    copyStrategyOwner: { findUnique: async () => null },
    user: { findUnique: async () => null, update: financialWrites, updateMany: financialWrites },
    session: {
      findUnique: async ({ where }: any) => ({ id: where.id, userId: 'fixture-viewer', revokedAt: null, lastSeenAt: new Date() }),
      update: async ({ where }: any) => ({ id: where.id }),
    },
    wallet: { update: financialWrites }, balance: { update: financialWrites },
    ledgerEntry: { create: financialWrites }, transaction: { create: financialWrites },
    order: { create: financialWrites }, trade: { create: financialWrites }, $transaction: financialWrites,
  };
  let day = '2026-10-18';
  const now = () => new Date(`${day}T12:00:00Z`);
  let service = new CopyPerformanceService(db, now);
  let snapshots = new MarketplaceSnapshots(db, service, { now, build: null, inlineBudgetMs: 120_000 });
  let server = express().use('/api/v1', copyPerformanceRouter(db, service, snapshots));
  const token = `Bearer ${jwt.sign({ sub: 'fixture-viewer', sid: 'fixture-session' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`;
  const get = async () => {
    const result = await request(server).get('/api/v1/copy-trading/marketplace').set('Authorization', token);
    expect(result.status).toBe(200); return result.body;
  };
  const store = new CopyMarketplaceStore(get, () => 'fixture-viewer', () => now().getTime(), null);
  const evidence: any[] = [];
  const previous: Record<string, any> = {};
  let lastPayload: any;
  for (const date of [18, 19, 20, 21, 22]) {
    day = `2026-10-${date}`;
    await store.refresh(); // same mounted store: no browser reload
    const state = store.getState();
    const payload = await get();
    lastPayload = payload;
    for (const [key, id, roi] of strategies) {
      const wire = state[key]!;
      const ledger = await service.get(key);
      expect(wire.simulation.simulatedAt.slice(0, 10)).toBe(day);
      expect(state.stale[key]).toBe(false);
      expect(wire.analytics).toEqual(payload[key].analytics);
      const trade = ledger.trades.filter(t => t.closedAt.slice(0, 10) === day);
      expect(trade).toHaveLength(1);
      const before = JSON.stringify(wire);
      const demo = demoRoiFor(id, '7D', wire, now().getTime());
      expect(demo?.roi).toBe(date < 22 ? roi : undefined);
      expect(JSON.stringify(wire)).toBe(before);
      const viewTrader = key === 'nazar' ? syntheticNazaraTrader(wire) : kseniaTrader(wire as any);
      const metrics: Record<string, any> = {};
      for (const period of periods) {
        const view = selectSyntheticPeriod(wire, period);
        const card = { '7D': viewTrader.roi7, '30D': viewTrader.roi30, '90D': viewTrader.roi90, ALL: viewTrader.roiAll }[period];
        const daily = view.daily;
        expect(view.roi).toBeCloseTo(daily.reduce((sum, row) => sum + row.dailyReturn * 100, 0), 6);
        expect(card).toBeCloseTo(view.roi, 3);
        expect(view.pnl).toBeCloseTo(daily.reduce((sum, row) => sum + row.realizedPnl, 0), 2);
        expect(view.pnl).toBeCloseTo(wire.economics!.periods[period].masterPnl, 2);
        expect(view.followerPnl).toBe(wire.economics!.periods[period].netFollowersPnl);
        expect(syntheticPerformancePoints(view, 'ROI').at(-1)!.value).toBeCloseTo(view.roi, 6);
        metrics[period] = { roi: view.roi, pnl: view.pnl, followerPnl: view.followerPnl,
          winRate: view.winRate, drawdown: view.maximumDrawdown, trades: view.totalTrades };
      }
      if (previous[key]) {
        expect(ledger.trades.length).toBe(previous[key].trades.length + 1);
        const byId = new Map(ledger.trades.map(trade => [trade.id, trade]));
        for (const oldTrade of previous[key].trades) expect(byId.get(oldTrade.id)).toEqual(oldTrade);
        for (const period of periods) {
          expect(metrics[period].roi).not.toBe(previous[key].metrics[period].roi);
          expect(metrics[period].pnl).not.toBe(previous[key].metrics[period].pnl);
        }
      }
      previous[key] = { trades: ledger.trades, metrics };
      evidence.push({ day, strategy: key, demo: demo ?? null, metrics,
        aum: wire.analytics.aum, copiers: wire.analytics.activeFollowers,
        ledgerTrades: ledger.trades.length, newTradeId: trade[0].id });
      expect((await service.get(key)).trades).toEqual(ledger.trades);
    }
    if (process.env.COPY_DEMO_EVIDENCE_DIR) {
      mkdirSync(process.env.COPY_DEMO_EVIDENCE_DIR, { recursive: true });
      writeFileSync(resolve(process.env.COPY_DEMO_EVIDENCE_DIR, `payload-${day}.json`), JSON.stringify(payload));
    }
  }
  // A new process uses the same persisted rows: no re-seeding or duplicate day.
  const rowsBeforeRestart = JSON.stringify([...rows]);
  snapshots.stop();
  service = new CopyPerformanceService(db, now);
  snapshots = new MarketplaceSnapshots(db, service, { now, build: null, inlineBudgetMs: 120_000 });
  server = express().use('/api/v1', copyPerformanceRouter(db, service, snapshots));
  const restarted = await get();
  for (const [key, id] of strategies) {
    expect(restarted[key]).toEqual(lastPayload[key]);
    expect((await service.get(key)).trades).toEqual(previous[key].trades);
    expect(demoRoiFor(id, '7D', restarted[key], now().getTime())).toBeUndefined();
  }
  expect(JSON.stringify([...rows])).toBe(rowsBeforeRestart);
  expect(financialWrites).not.toHaveBeenCalled();
  expect([...rows.keys()].sort()).toEqual(['ksenia-performance-v1', 'ksenia-performance-v1:marketplace',
    'nazar-performance-v8', 'nazar-performance-v8:marketplace']);
  snapshots.stop();
  if (process.env.COPY_DEMO_EVIDENCE_DIR)
    writeFileSync(resolve(process.env.COPY_DEMO_EVIDENCE_DIR, 'daily-audit.json'), JSON.stringify(evidence, null, 2));
});
