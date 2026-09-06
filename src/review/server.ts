import express from 'express';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { createKseniaReviewState, advanceKseniaReview, kseniaReviewResponse } from '../services/copyTrading/kseniaReview';
import { resolveStrategyOwner, KSENIA_EXTERNAL_OWNER_ID, PUBLIC_STRATEGIES } from '../services/copyTrading/strategyOwner';
import type { CashflowReviewState } from '../services/copyTrading/reviewEconomicsTypes';

/** Dedicated entry point, never src/index.ts. No matching, wallet, auth,
 * deposit or copy-execution service is even imported. Only allowlisted GETs. */
export function assertReviewDatabase(env: NodeJS.ProcessEnv) {
  const url = new URL(env.DATABASE_URL ?? 'invalid:');
  if (env.VOLTEX_ISOLATED_REVIEW !== 'true' || url.hostname !== 'dpg-daei409t0dsc73aat5jg-a'
    || url.pathname !== '/voltex_review_db' || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Review backend refuses any database except the authorized isolated Render database');
  }
}
// A JSON string inside JSONB preserves JavaScript numeric tokens exactly through
// Prisma's JSON transport. A nested JSON object may round IEEE-754 tail digits.
// Legacy object rows remain readable without regenerating published history.
export function encodeReviewState(state: CashflowReviewState): string { return JSON.stringify(state); }
export function decodeReviewState(value: unknown): CashflowReviewState {
  return (typeof value === 'string' ? JSON.parse(value) : value) as CashflowReviewState;
}
export async function startReviewBackend() {
  assertReviewDatabase(process.env);
  // Direct URL derives from the already-validated staging URL, never an inherited
  // production .env or pooled Neon connection. No credentials printed.
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, stdio: 'inherit' });
  const db = new PrismaClient();
  await db.$connect();
  for (const [traderId, publicName, externalOwnerUserId] of [
    ['VX-001', 'Nazar', process.env.REVIEW_NAZAR_OWNER_USER_ID ?? null],
    ['VX-KSENIA', 'Ksenia', KSENIA_EXTERNAL_OWNER_ID],
  ] as const) {
    await db.copyStrategyOwner.upsert({ where: { traderId }, update: {}, create: { traderId, publicName, externalOwnerUserId, premium: true } });
  }
  const scenarioId = 'ksenia-review-v1';
  const stored = await db.copyReviewScenario.findUnique({ where: { id: scenarioId } });
  let state = stored ? decodeReviewState(stored.state) : createKseniaReviewState();
  if (!stored) await db.copyReviewScenario.create({ data: { id: scenarioId, state: encodeReviewState(state) } });
  else if (typeof stored.state !== 'string') await db.copyReviewScenario.update({ where: { id: scenarioId }, data: { state: encodeReviewState(state) } });
  let advancing: Promise<void> | null = null;
  async function calendar() {
    if (advancing) return advancing;
    advancing = (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const missing = Math.max(0, Math.round((Date.parse(today) - Date.parse(state.simulatedAt.slice(0, 10))) / 86400000));
      if (!missing) return;
      // One free instance is the review deployment contract. Atomic DB update
      // before publication and persisted deterministic prefixes survive restart.
      let next = state;
      for (let days = missing; days > 0; days -= 365) next = advanceKseniaReview(next, Math.min(days, 365));
      await db.copyReviewScenario.update({ where: { id: scenarioId }, data: { state: encodeReviewState(next) } });
      state = next;
    })().finally(() => { advancing = null; });
    return advancing;
  }
  await calendar();
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.use((req, res, next) => { if (!['GET', 'HEAD'].includes(req.method)) { res.status(403).json({ error: 'Isolated review: account operations disabled' }); return; } next(); });
  app.get('/health', async (_req, res) => {
    try { await db.$queryRaw`SELECT 1`; res.json({ status: 'ok', environment: 'isolated-review', database: 'voltex-review-db', commit: process.env.RENDER_GIT_COMMIT ?? 'local', productionConnection: false }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.get('/api/v1/copy-trading/identities', async (_req, res) => {
    try { res.json({ identities: await Promise.all(PUBLIC_STRATEGIES.map(id => resolveStrategyOwner(db, id))) }); }
    catch { res.status(503).json({ error: 'Public strategy identity temporarily unavailable' }); }
  });
  app.get('/api/v1/copy-trading/ksenia', async (_req, res) => {
    try { await calendar(); res.json(kseniaReviewResponse(state)); }
    catch { res.status(503).json({ error: 'Review strategy temporarily unavailable' }); }
  });
  app.use((_req, res) => { res.status(404).json({ error: 'Review route unavailable' }); });
  const server = app.listen(Number(process.env.PORT ?? 10000), '0.0.0.0');
  process.once('SIGTERM', () => { server.close(() => { void db.$disconnect().finally(() => process.exit(0)); }); });
  return server;
}
if (require.main === module) void startReviewBackend().catch(() => { console.error('Isolated review backend startup failed; inspect staging build/migration status.'); process.exit(1); });
