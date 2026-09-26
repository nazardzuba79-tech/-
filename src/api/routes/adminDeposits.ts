import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { ChainConfig } from '../../config/chains';
import { createVerifier } from '../../services/deposit-verifiers';
import { DepositService, DepositVerificationError, PriceSource } from '../../services/DepositService';
import { ProviderUnavailableError, TransferNotFoundError } from '../../services/deposit-verifiers';
import { DepositQueueService } from '../../services/deposits/DepositQueueService';
import { DepositBatchError, DepositBatchService } from '../../services/deposits/DepositBatchService';
import { DepositAttributionError, DepositAttributionService } from '../../services/deposits/DepositAttributionService';
import { DepositWatchService } from '../../services/deposits/DepositWatchService';
import { TreasuryWalletService } from '../../services/TreasuryWalletService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { KNOWN_CHAINS, TX_HASH_PATTERN, resolveChainConfig } from './deposits';

/**
 * Admin deposit registry. Detection, attribution, the minimum and the credit
 * are separate actions:
 *   - discovery (watcher / «Проверить TXID» / other-network feed) stores
 *     proven transfers, unattributed;
 *   - «Привязать к пользователю» sets the owner (audited, no balance change);
 *   - a user's package (one asset, one network, confirmed uncredited
 *     transfers) becomes reviewable at 300 USD;
 *   - only «Подтвердить зачисление» on a package credits, via
 *     DepositBatchService, which re-proves every transfer on chain.
 * The legacy one-transfer manual-credit endpoint is closed.
 */
export function adminDepositsRouter(prisma: PrismaClient, priceSource: PriceSource, options: {
  watch?: DepositWatchService;
  onWatcherToggle?: (enabled: boolean, lastScheduledRunAt: number | null) => void;
} = {}): Router {
  const router = Router();
  const treasuryWallets = new TreasuryWalletService(prisma);
  const resolveChain = (chain: string) => resolveChainConfig(treasuryWallets, chain);
  const queue = new DepositQueueService(prisma, priceSource);
  const batches = new DepositBatchService(prisma, priceSource, resolveChain);
  const attribution = new DepositAttributionService(prisma);
  const watch = options.watch ?? new DepositWatchService(prisma, resolveChain);

  // Every unresolved deposit, plus recent credited history. A burst of credited
  // transfers must never push an older BELOW_MINIMUM out of the work queue.
  router.get('/admin/deposits', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    try {
      const [unresolved, credited] = await Promise.all([
        prisma.deposit.findMany({ where: { status: { not: 'CREDITED' } }, orderBy: { createdAt: 'desc' }, include: { user: { select: { email: true } } } }),
        prisma.deposit.findMany({ where: { status: 'CREDITED' }, orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { email: true } } } }),
      ]);
      const deposits = [...unresolved, ...credited];
      res.json(
        deposits.map((d) => ({
          id: d.id,
          userId: d.userId,
          userEmail: d.user?.email ?? null,
          asset: d.asset,
          chain: d.chain,
          txHash: d.txHash,
          amount: d.amount.toString(),
          confirmations: d.confirmations,
          status: d.status,
          createdAt: d.createdAt,
        }))
      );
    } catch { res.status(503).json({ error: 'Failed to load deposit history' }); }
  });

  // Tiny admin-user-list helper: only the newest deposit per user from the
  // last 24 hours. The old UI downloaded the full /admin/deposits payload
  // (all unresolved + up to 200 credited rows, with tx hashes/emails/etc.)
  // just to draw a small "+amount asset" badge beside a user.
  //
  // DISTINCT ON keeps the reduction inside Postgres, so Neon sends Render
  // one narrow row per user rather than the full deposit history.
  router.get('/admin/deposits/recent-by-user', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    try {
      const rows = await prisma.$queryRaw<Array<{
        userId: string;
        amount: { toString(): string };
        asset: string;
        createdAt: Date;
      }>>`
        SELECT DISTINCT ON ("userId")
          "userId", "amount", "asset", "createdAt"
        FROM "Deposit"
        WHERE "userId" IS NOT NULL
          AND "createdAt" >= ${cutoff}
        ORDER BY "userId", "createdAt" DESC
      `;
      res.json(rows.map((row) => ({
        userId: row.userId,
        amount: row.amount.toString(),
        asset: row.asset,
        createdAt: row.createdAt,
      })));
    } catch {
      res.status(503).json({ error: 'Failed to load recent deposits' });
    }
  });

  // THE USERS PAGE'S WORK QUEUE, in one small read: counts for the summary
  // cards and each user's deposit package (sum of confirmed uncredited
  // transfers per asset/network) with its state. No history, no provider
  // calls. The page re-reads this every ~25 s while visible; crediting is
  // the package confirmation below.
  router.get('/admin/user-activity', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    try {
      const [totalUsers, newUsers24h, pendingKyc, q] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.user.count({ where: { kycStatus: 'PENDING' } }),
        queue.load({ creditedLimit: 0 }),
      ]);
      const unconfirmedByUser = new Map<string, number>();
      for (const r of q.rows) if (r.userId && r.state === 'AWAITING_CONFIRMATIONS') unconfirmedByUser.set(r.userId, (unconfirmedByUser.get(r.userId) ?? 0) + 1);
      res.set('Cache-Control', 'private, no-store');
      res.json({
        asOf: q.asOf,
        totalUsers,
        newUsers24h,
        pendingKyc,
        minDepositUsd: q.minDepositUsd,
        counts: q.counts,
        packages: q.packages.map((p) => ({
          key: p.key, userId: p.userId, chain: p.chain, asset: p.asset, state: p.state, total: p.total,
          transferCount: p.transfers.length, unconfirmedTotal: p.unconfirmedTotal, unconfirmedCount: p.unconfirmedCount,
          remaining: p.remaining, remainingUsd: p.remainingUsd, minimumReached: p.minimumReached,
          latestAt: p.transfers.reduce((m, t) => (t.firstDetectedAt > m ? t.firstDetectedAt : m), ''),
        })),
        awaitingConfirmationsByUser: Object.fromEntries(unconfirmedByUser),
      });
    } catch {
      res.status(503).json({ error: 'Failed to load admin activity' });
    }
  });

  // The whole registry for Admin → Пополнения: every uncredited transfer with
  // its derived state, every package, recent credits, exact counts and the
  // watcher's stored status. Database only — never a provider call.
  router.get('/admin/deposit-queue', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    try {
      const [q, watcher] = await Promise.all([queue.load(), watch.status()]);
      res.set('Cache-Control', 'private, no-store');
      res.json({ ...q, watcher });
    } catch {
      res.status(503).json({ error: 'Failed to load deposit queue' });
    }
  });

  const attributeSchema = z.object({ userId: z.string().uuid().nullable(), reassign: z.boolean().optional() });
  router.post('/admin/deposits/:id/attribute', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = attributeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      res.json(await attribution.attribute({ adminId: req.userId!, depositId: req.params.id, userId: parsed.data.userId, reassign: parsed.data.reassign }));
    } catch (err) {
      if (err instanceof DepositAttributionError) {
        const status = err.code === 'NOT_FOUND' || err.code === 'USER_NOT_FOUND' ? 404 : err.code === 'NOT_ADMIN' ? 403 : 409;
        return res.status(status).json({ error: err.message, code: err.code });
      }
      console.error(err);
      res.status(500).json({ error: 'Failed to attribute deposit' });
    }
  });

  // «Проверить TXID»: prove one transaction on chain, show the result and
  // store it in the registry. Never attributes, never credits.
  const checkSchema = z.object({ chain: z.string().min(1), txHash: z.string().min(1), asset: z.string().min(1) });
  router.post('/admin/deposits/check-tx', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const parsed = checkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    let config: ChainConfig;
    try { config = await resolveChainConfig(treasuryWallets, parsed.data.chain); }
    catch { return res.status(404).json({ error: `Unknown or unconfigured chain: ${parsed.data.chain}` }); }
    if (!TX_HASH_PATTERN[config.type].test(parsed.data.txHash)) return res.status(400).json({ error: 'invalid transaction hash for this network' });
    try {
      const result = await new DepositService(prisma, config, priceSource).recordObservation({ txHash: parsed.data.txHash, asset: parsed.data.asset, source: 'admin_check' });
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof ProviderUnavailableError) return res.status(503).json({ ok: false, reason: 'PROVIDER_UNAVAILABLE', error: 'Проверка сети сейчас недоступна. Это не значит, что перевода нет.' });
      if (err instanceof TransferNotFoundError) return res.status(200).json({ ok: false, reason: 'NOT_FOUND', error: err.message });
      if (err instanceof DepositVerificationError) return res.status(200).json({ ok: false, reason: 'REJECTED', error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to check transaction' });
    }
  });

  const packageQuery = z.object({ userId: z.string().uuid(), chain: z.string().min(1), asset: z.string().min(1) });
  router.get('/admin/deposit-packages/preview', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const parsed = packageQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await batches.preview(parsed.data));
    } catch (err) {
      console.error(err);
      res.status(503).json({ error: 'Failed to load deposit package' });
    }
  });

  // The ONLY credit endpoint. Amounts, statuses and the admin identity come
  // from the server; the body only names the reviewed package.
  const confirmSchema = packageQuery.extend({
    depositIds: z.array(z.string().uuid()).min(1).max(500),
    token: z.string().regex(/^[0-9a-f]{64}$/),
    idempotencyKey: z.string().uuid(),
  });
  router.post('/admin/deposit-packages/confirm', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = confirmSchema.strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      res.json(await batches.confirm({ ...parsed.data, adminId: req.userId! }));
    } catch (err) {
      if (err instanceof DepositBatchError) {
        const status = err.code === 'PROVIDER_UNAVAILABLE' || err.code === 'CHAIN_UNAVAILABLE' ? 503 : err.code === 'NOT_ADMIN' ? 403 : 409;
        return res.status(status).json({ error: err.message, code: err.code, details: err.details ?? null });
      }
      console.error(err);
      res.status(500).json({ error: 'Failed to credit deposit package' });
    }
  });

  router.get('/admin/deposit-watch', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    try { res.set('Cache-Control', 'private, no-store').json(await watch.status()); }
    catch { res.status(503).json({ error: 'Failed to load watcher status' }); }
  });

  // «Проверить новые поступления»: one bounded scan now, on an admin's
  // request, even while automatic scans are paused. Same cursor and lease as
  // the schedule (never two at once, never a skipped or doubled page); it does
  // not move the automatic schedule. Never credits.
  router.post('/admin/deposit-watch/run', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    try { res.json(await watch.runOnce('admin')); }
    catch (err) { console.error(err); res.status(503).json({ error: 'Watcher run failed' }); }
  });

  router.post('/admin/deposit-watch/enabled', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      await watch.setEnabled(parsed.data.enabled, req.userId!);
      const status = await watch.status();
      options.onWatcherToggle?.(parsed.data.enabled, status.lastScheduledRunAt ? Date.parse(status.lastScheduledRunAt) : null);
      res.json(status);
    } catch { res.status(503).json({ error: 'Failed to update watcher' }); }
  });

  // Recent transfers to the treasury address that aren't recorded as a
  // Deposit yet — real on-chain data (see each verifier's listIncoming),
  // not anything the client submitted.
  router.get('/admin/deposits/incoming', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const failedChains = new Set<string>();
    const configuredChains: string[] = [];
    for (const chain of KNOWN_CHAINS) {
      let config: ChainConfig;
      try { config = await resolveChainConfig(treasuryWallets, chain); }
      catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!message.startsWith('No treasury address configured') && !message.startsWith('Missing required env var:')) failedChains.add(chain);
        continue;
      }
      configuredChains.push(chain);
      try {
        const transfers = await createVerifier(config).listIncoming();
        const service = new DepositService(prisma, config, priceSource);
        const seen = new Set<string>();
        for (const transfer of transfers) {
          // Multiple events for the same transaction/asset need one verification.
          // The verifier supplies the authoritative total; list amounts do not.
          const key = `${transfer.txHash}:${transfer.asset}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try { await service.recordObservation({ txHash: transfer.txHash, asset: transfer.asset, source: 'incoming_feed' }); }
          catch (error) { if (!(error instanceof DepositVerificationError) || error instanceof ProviderUnavailableError) failedChains.add(chain); }
        }
      } catch { failedChains.add(chain); }
    }
    try {
      // Persisted observations survive provider outages and recent-feed windows.
      // No amount/minimum filter, and ignored transfers still remain in history.
      const [deposits, ignored] = await Promise.all([
        prisma.deposit.findMany({ where: { userId: null, status: { not: 'CREDITED' } }, orderBy: { createdAt: 'desc' } }),
        prisma.ignoredIncomingTransfer.findMany({ select: { chain: true, txHash: true } }),
      ]);
      const ignoredKeys = new Set(ignored.map(d => `${d.chain}:${d.txHash}`));
      const transfers = deposits.filter(d => !ignoredKeys.has(`${d.chain}:${d.txHash}`)).map(d => ({
        chain: d.chain, txHash: d.txHash, asset: d.asset, amount: d.amount.toString(),
        confirmations: d.confirmations, status: d.status, timestamp: d.createdAt.toISOString(),
      }));
      if (req.query.includeStatus === 'true') return res.json({ transfers, failedChains: [...failedChains], configuredChains });
      // Older clients must not interpret a failed provider as an empty success.
      if (failedChains.size) return res.status(503).json({ error: 'Incoming transfers are temporarily incomplete' });
      res.json(transfers);
    } catch { res.status(503).json({ error: 'Failed to load recorded incoming transfers' }); }
  });
  const ignoreSchema = z.object({
    chain: z.string().min(1),
    txHash: z.string().min(1),
  });

  // Marks a listed-but-not-ours transfer (e.g. old unrelated activity on a
  // reused treasury address) as permanently excluded from the feed above —
  // for entries that will never get credited because they aren't actually
  // this exchange's deposits.
  router.post('/admin/deposits/ignore', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const parsed = ignoreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { chain, txHash } = parsed.data;

    await prisma.ignoredIncomingTransfer.upsert({
      where: { chain_txHash: { chain, txHash } },
      create: { chain, txHash },
      update: {},
    });

    res.json({ status: 'ignored' });
  });

  // CLOSED. The old one-transfer credit bypassed the package minimum. Every
  // credit now goes through /admin/deposit-packages/confirm. Kept as an
  // explicit refusal so an old browser tab cannot credit anything.
  router.post('/admin/deposits/manual-credit', requireAuth(prisma), requireAdmin(prisma), (_req, res) => {
    res.status(410).json({ error: 'Зачисление отдельного перевода отключено. Используйте «Проверить и зачислить» для пакета пользователя.', code: 'USE_PACKAGE_CONFIRM' });
  });

  return router;
}
