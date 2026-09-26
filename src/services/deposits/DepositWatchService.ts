import { PrismaClient, Prisma, Deposit, DepositWatchCursor } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { randomUUID } from 'crypto';
import { ChainConfig } from '../../config/chains';
import { DepositVerificationError, ProviderUnavailableError } from '../deposit-verifiers';
import { TronDepositVerifier } from '../deposit-verifiers/TronDepositVerifier';
import { ALLOWLISTED_TOKENS } from '../deposit-verifiers/proof';
import { tronAddressHex } from '../deposit-verifiers/tronAddress';
import { applyProof, recordProofFailure } from '../DepositService';
import { recipientFor, rememberTreasuryAddress, treasuryAddresses } from './transferProof';

/**
 * PRODUCTION DEPOSIT WATCHER — USDT/TRC20 only.
 *
 * It can: read the chain (TronGrid), store newly observed transfers, prove
 * and refresh their confirmations, and report scan progress.
 * It cannot: credit, attribute, touch Balance/FuturesBalance, pay referral,
 * withdraw, sign or send anything. It holds no admin identity: this class
 * has no path to DepositBatchService and never writes userId.
 *
 * Scan model per (network, treasury address, token contract) cursor:
 *   scannedThroughMs  every transfer with block time <= it is stored.
 *   window            [scannedThrough - OVERLAP, min(+MAX_WINDOW, now - LAG)],
 *                     fixed once chosen and persisted before the first page.
 *   pageCursor        the provider's fingerprint inside the window, persisted
 *                     in the SAME transaction as that page's rows, so a crash
 *                     re-reads at most one page (deduplicated by chain+txHash)
 *                     and never skips one. The cursor moves to windowEnd only
 *                     after the window's last page is stored.
 * Pages are read oldest-first inside a window; at most MAX_PAGES per run.
 * Unfinished windows (backlog) continue next run and are reported as lag.
 * A provider error or malformed page stops the run with the cursor where it
 * was: never an empty success. Concurrent runs are excluded by a DB lease.
 */
/** DEPOSIT_WATCHER_INTERVAL_MINUTES, default 360 (4 automatic scans a day).
 * Values under 60 minutes are ignored: frequent polling is not the design. */
export function watcherIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const minutes = Number(env.DEPOSIT_WATCHER_INTERVAL_MINUTES ?? 360);
  return (Number.isFinite(minutes) && minutes >= 60 ? minutes : 360) * 60_000;
}

export const WATCH = {
  chain: 'tron',
  pageSize: 200,
  overlapMs: 10 * 60_000,
  minWindowAdvanceMs: 60_000,
  safetyLagMs: 2 * 60_000,
  maxWindowMs: 24 * 60 * 60_000,
  initialBackfillMs: 7 * 24 * 60 * 60_000,
  maxPagesPerRun: 10,
  maxProviderCallsPerRun: 40,
  maxVerificationsPerRun: 20,
  maxRunMs: 60_000,
  leaseMs: 120_000,
  /** Automatic cadence (default 6 h = 4 scans a day). The server refuses a
   * scheduled run sooner than this, whoever triggers it. */
  scheduleIntervalMs: watcherIntervalMs(),
} as const;

export interface WatchRunSummary {
  ran: boolean;
  skipped?: 'LEASE_HELD' | 'PAUSED' | 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'NOT_DUE';
  ok: boolean;
  trigger: string;
  startedAt: string;
  durationMs: number;
  providerCalls: number;
  providerBytes: number;
  pagesRead: number;
  observed: number;
  newTransfers: number;
  verified: number;
  flagged: number;
  error: string | null;
  cursors: { address: string; asset: string; scannedThrough: string; lagMs: number; windowInProgress: boolean; lastError: string | null }[];
  backlog: boolean;
  unfinalized: number;
  needsFollowUp: boolean;
  addresses: string[];
}

interface Trc20ListItem {
  transaction_id?: string;
  to?: string;
  value?: string;
  block_timestamp?: number;
  token_info?: { address?: string };
}

class BudgetExceeded extends Error {}

export type WatchLimits = { -readonly [K in keyof typeof WATCH]: (typeof WATCH)[K] };

export class DepositWatchService {
  private readonly cfg: WatchLimits;
  constructor(
    private prisma: PrismaClient,
    private resolveChain: (chain: string) => Promise<ChainConfig>,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
    limits: Partial<Omit<WatchLimits, 'chain'>> = {},
  ) { this.cfg = { ...WATCH, ...limits }; }

  async ensureState() {
    await this.prisma.depositWatchState.createMany({ data: [{ id: WATCH.chain }], skipDuplicates: true });
    return this.prisma.depositWatchState.findUniqueOrThrow({ where: { id: WATCH.chain } });
  }

  async setEnabled(enabled: boolean, adminId: string) {
    await this.ensureState();
    await this.prisma.$transaction([
      this.prisma.depositWatchState.update({ where: { id: WATCH.chain }, data: { enabled } }),
      this.prisma.auditLog.create({ data: { userId: adminId, action: enabled ? 'DEPOSIT_WATCH_RESUMED' : 'DEPOSIT_WATCH_PAUSED', metadata: { chain: WATCH.chain } } }),
    ]);
  }

  /** Watcher status for the admin: stored state only, no provider call. */
  async status() {
    const [state, cursors, unverified] = await Promise.all([
      this.prisma.depositWatchState.findUnique({ where: { id: WATCH.chain } }),
      this.prisma.depositWatchCursor.findMany({ where: { chain: WATCH.chain }, orderBy: { createdAt: 'asc' } }),
      this.prisma.deposit.count({ where: { chain: WATCH.chain, status: { not: 'CREDITED' }, verifyError: null, OR: [{ verifiedAt: null }, { finalized: false }] } }),
    ]);
    const now = this.now();
    return {
      chain: WATCH.chain,
      enabled: state?.enabled ?? false,
      running: !!state?.leaseUntil && state.leaseUntil.getTime() > now,
      lastRunStartedAt: state?.lastRunStartedAt?.toISOString() ?? null,
      lastRunFinishedAt: state?.lastRunFinishedAt?.toISOString() ?? null,
      lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
      lastRunOk: state?.lastRunOk ?? null,
      lastRunTrigger: state?.lastRunTrigger ?? null,
      lastRunSummary: state?.lastRunSummary ?? null,
      providerStatus: state?.providerStatus ?? null,
      unverifiedOrUnfinalized: unverified,
      cursors: cursors.map((c) => ({
        address: c.address, asset: c.asset,
        scannedThrough: new Date(Number(c.scannedThroughMs)).toISOString(),
        lagMs: Math.max(0, now - Number(c.scannedThroughMs)),
        windowInProgress: c.windowEndMs !== null,
        windowStart: c.windowStartMs === null ? null : new Date(Number(c.windowStartMs)).toISOString(),
        windowEnd: c.windowEndMs === null ? null : new Date(Number(c.windowEndMs)).toISOString(),
        lastError: c.lastError, lastErrorAt: c.lastErrorAt?.toISOString() ?? null,
      })),
      lastScheduledRunAt: state?.lastScheduledRunAt?.toISOString() ?? null,
      nextScheduledRunAt: state?.enabled ? new Date((state.lastScheduledRunAt?.getTime() ?? now) + (state.lastScheduledRunAt ? this.cfg.scheduleIntervalMs : 0)).toISOString() : null,
      policy: { intervalMinutes: Math.round(this.cfg.scheduleIntervalMs / 60_000), pageSize: this.cfg.pageSize, maxPagesPerRun: this.cfg.maxPagesPerRun, overlapMinutes: this.cfg.overlapMs / 60_000,
        initialBackfillDays: this.cfg.initialBackfillMs / 86_400_000 },
    };
  }

  /** One bounded scan. `schedule` runs only when enabled; `admin` (an admin's
   * explicit «Проверить сейчас») runs even while paused. */
  async runOnce(trigger: 'schedule' | 'admin'): Promise<WatchRunSummary> {
    const startedAt = this.now();
    const owner = randomUUID();
    const summary: WatchRunSummary = {
      ran: false, ok: false, trigger, startedAt: new Date(startedAt).toISOString(), durationMs: 0, providerCalls: 0, providerBytes: 0,
      pagesRead: 0, observed: 0, newTransfers: 0, verified: 0, flagged: 0, error: null, cursors: [], backlog: false, unfinalized: 0,
      needsFollowUp: false, addresses: [],
    };
    const state = await this.ensureState();
    if (trigger === 'schedule' && !state.enabled) return { ...summary, skipped: 'PAUSED', ok: true };
    // Cadence is enforced here, not by the caller: an early or repeated
    // scheduled trigger costs one state read and nothing else.
    const tolerance = Math.min(5 * 60_000, this.cfg.scheduleIntervalMs / 10);
    if (trigger === 'schedule' && state.lastScheduledRunAt && startedAt - state.lastScheduledRunAt.getTime() < this.cfg.scheduleIntervalMs - tolerance) {
      return { ...summary, skipped: 'NOT_DUE', ok: true };
    }
    const retryUntil = Number((state.providerStatus ?? '').match(/^RATE_LIMITED:(\d+)$/)?.[1] ?? 0);
    if (trigger === 'schedule' && retryUntil > startedAt) return { ...summary, skipped: 'RATE_LIMITED', ok: true, needsFollowUp: true };

    const leased = await this.prisma.$executeRaw`
      UPDATE "DepositWatchState" SET "leaseOwner" = ${owner}, "leaseUntil" = ${new Date(startedAt + this.cfg.leaseMs)},
        "lastRunStartedAt" = ${new Date(startedAt)}, "lastRunTrigger" = ${trigger},
        "lastScheduledRunAt" = CASE WHEN ${trigger}::text = 'schedule' THEN ${new Date(startedAt)} ELSE "lastScheduledRunAt" END
      WHERE id = ${WATCH.chain} AND ("leaseUntil" IS NULL OR "leaseUntil" < ${new Date(startedAt)})`;
    if (leased !== 1) return { ...summary, skipped: 'LEASE_HELD', ok: true };
    summary.ran = true;

    let providerStatus: string | null = 'OK';
    try {
      let config: ChainConfig;
      try { config = await this.resolveChain(WATCH.chain); }
      catch { summary.skipped = 'NOT_CONFIGURED'; summary.ok = true; providerStatus = 'NOT_CONFIGURED'; return summary; }
      const verifier = new TronDepositVerifier(config, this.counted(summary));
      await rememberTreasuryAddress(this.prisma, WATCH.chain, config.treasuryAddress);
      const addresses = await treasuryAddresses(this.prisma, config);
      summary.addresses = addresses;

      // A budget stop is not a failure: it leaves backlog for the next run.
      const bounded = async (phase: () => Promise<void>) => {
        try { await phase(); } catch (error) { if (error instanceof BudgetExceeded) summary.backlog = true; else throw error; }
      };
      try {
        await bounded(async () => {
          for (const address of addresses) {
            for (const [asset, token] of Object.entries(config.tokens)) {
              const allowed = ALLOWLISTED_TOKENS.tron[asset];
              if (!allowed || tronAddressHex(token.contractAddress) !== tronAddressHex(allowed.contract) || token.decimals !== allowed.decimals) continue;
              await this.scanCursor(config, address, asset, allowed.contract, allowed.decimals, summary, startedAt);
            }
          }
        });
        await bounded(() => this.verifyPending(config, verifier, summary, startedAt));
        summary.ok = true;
      } catch (error) {
        {
          summary.error = error instanceof Error ? error.message.slice(0, 300) : 'Unknown watcher error';
          if (error instanceof ProviderUnavailableError && error.retryAfterMs) {
            providerStatus = `RATE_LIMITED:${this.now() + Math.min(error.retryAfterMs, 15 * 60_000)}`;
          } else providerStatus = error instanceof ProviderUnavailableError ? 'UNAVAILABLE' : 'ERROR';
        }
      }
      const cursors = await this.prisma.depositWatchCursor.findMany({ where: { chain: WATCH.chain }, orderBy: { createdAt: 'asc' } });
      const now = this.now();
      summary.cursors = cursors.map((c) => ({ address: c.address, asset: c.asset, scannedThrough: new Date(Number(c.scannedThroughMs)).toISOString(),
        lagMs: Math.max(0, now - Number(c.scannedThroughMs)), windowInProgress: c.windowEndMs !== null, lastError: c.lastError }));
      summary.backlog = summary.backlog || cursors.some((c) => c.windowEndMs !== null
        || now - Number(c.scannedThroughMs) > this.cfg.maxWindowMs + this.cfg.safetyLagMs);
      summary.unfinalized = await this.prisma.deposit.count({ where: { chain: WATCH.chain, status: { not: 'CREDITED' }, verifyError: null,
        OR: [{ verifiedAt: null }, { finalized: false }] } });
      summary.needsFollowUp = !summary.ok || summary.backlog || summary.unfinalized > 0;
      return summary;
    } finally {
      summary.durationMs = this.now() - startedAt;
      await this.prisma.depositWatchState.updateMany({
        where: { id: WATCH.chain, leaseOwner: owner },
        data: { leaseOwner: null, leaseUntil: null, lastRunFinishedAt: new Date(this.now()), lastRunOk: summary.ok,
          ...(summary.ok && !summary.skipped ? { lastSuccessAt: new Date(this.now()) } : {}),
          lastRunSummary: summary as unknown as Prisma.InputJsonObject, providerStatus },
      });
    }
  }

  /** fetch wrapper: counts calls/bytes and enforces the per-run budget. */
  private counted(summary: WatchRunSummary): typeof fetch {
    return (async (input: any, init?: any) => {
      if (summary.providerCalls >= this.cfg.maxProviderCallsPerRun) throw new BudgetExceeded('provider call budget reached');
      summary.providerCalls++;
      const res = await this.fetchFn(input, init);
      const text = await res.text();
      summary.providerBytes += Buffer.byteLength(text);
      return { ok: res.ok, status: res.status, headers: res.headers, json: async () => JSON.parse(text), text: async () => text } as Response;
    }) as typeof fetch;
  }

  private async scanCursor(config: ChainConfig, address: string, asset: string, contract: string, decimals: number, summary: WatchRunSummary, startedAt: number) {
    const key = { chain_address_contract: { chain: WATCH.chain, address, contract } };
    let cursor = await this.prisma.depositWatchCursor.findUnique({ where: key });
    if (!cursor) {
      // First scan of this address: a bounded backfill, never the whole history.
      await this.prisma.depositWatchCursor.createMany({ data: [{
        chain: WATCH.chain, address, contract, asset, scannedThroughMs: BigInt(startedAt - this.cfg.initialBackfillMs),
      }], skipDuplicates: true });
      cursor = await this.prisma.depositWatchCursor.findUniqueOrThrow({ where: key });
    }
    const fetchPage = this.counted(summary);
    const base = config.apiUrl ?? 'https://api.trongrid.io';
    const headers: Record<string, string> = config.apiKey ? { 'TRON-PRO-API-KEY': config.apiKey } : {};

    while (true) {
      if (this.now() - startedAt > this.cfg.maxRunMs || summary.pagesRead >= this.cfg.maxPagesPerRun) throw new BudgetExceeded('page budget reached');
      if (cursor.windowEndMs === null) {
        const through = Number(cursor.scannedThroughMs);
        const end = Math.min(through + this.cfg.maxWindowMs, this.now() - this.cfg.safetyLagMs);
        // Caught up: a new window opens only once enough new time exists, so
        // a run never re-reads the overlap again and again for milliseconds.
        if (end - through < this.cfg.minWindowAdvanceMs) return;
        cursor = await this.prisma.depositWatchCursor.update({ where: key, data: {
          windowStartMs: BigInt(Math.max(0, through - this.cfg.overlapMs)), windowEndMs: BigInt(end), pageCursor: null, pagesInWindow: 0,
        } });
      }
      const qs = new URLSearchParams({ only_to: 'true', limit: String(this.cfg.pageSize), contract_address: contract,
        order_by: 'block_timestamp,asc', min_timestamp: String(cursor.windowStartMs), max_timestamp: String(cursor.windowEndMs) });
      if (cursor.pageCursor) qs.set('fingerprint', cursor.pageCursor);
      let body: { success?: boolean; data?: Trc20ListItem[]; meta?: { fingerprint?: string } };
      try {
        let res: Response;
        try { res = await fetchPage(`${base}/v1/accounts/${address}/transactions/trc20?${qs}`, { headers }); }
        catch (error) {
          if (error instanceof BudgetExceeded) throw error;
          throw new ProviderUnavailableError(`Failed to reach TronGrid API: ${(error as Error).message}`);
        }
        if (!res.ok) {
          const retryAfter = Number(res.headers?.get?.('retry-after'));
          throw new ProviderUnavailableError(`TronGrid API responded with HTTP ${res.status}`,
            res.status === 429 ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000) : null);
        }
        try { body = (await res.json()) as typeof body; } catch { throw new ProviderUnavailableError('TronGrid returned an unreadable page'); }
        if (body?.success === false || !Array.isArray(body?.data)) throw new ProviderUnavailableError('TronGrid returned a malformed page');
      } catch (error) {
        if (!(error instanceof BudgetExceeded)) {
          await this.prisma.depositWatchCursor.update({ where: key, data: { lastError: (error as Error).message.slice(0, 300), lastErrorAt: new Date(this.now()) } });
        }
        throw error;
      }
      summary.pagesRead++;

      // Validate the whole page before storing any of it.
      const recipientHex = tronAddressHex(address);
      const contractHex = tronAddressHex(contract);
      const rows = new Map<string, Prisma.DepositCreateManyInput>();
      for (const item of body.data!) {
        const txHash = String(item?.transaction_id ?? '').toLowerCase();
        const value = String(item?.value ?? '');
        if (!/^[0-9a-f]{64}$/.test(txHash) || !/^\d+$/.test(value) || !Number.isSafeInteger(item?.block_timestamp)) {
          const message = 'TronGrid page contains a malformed transfer';
          await this.prisma.depositWatchCursor.update({ where: key, data: { lastError: message, lastErrorAt: new Date(this.now()) } });
          throw new ProviderUnavailableError(message);
        }
        if (tronAddressHex(item.to) !== recipientHex) continue; // not to this address: not ours
        if (item.token_info?.address && tronAddressHex(item.token_info.address) !== contractHex) continue;
        const listed = new BigNumber(value).shiftedBy(-decimals);
        const prior = rows.get(txHash);
        rows.set(txHash, {
          chain: WATCH.chain, txHash, asset, status: 'PENDING', source: 'watcher', recipientAddress: address,
          // Listed (unproven) amount; replaced by the proven sum before the row can ever be credited.
          amount: prior ? new BigNumber(prior.amount as string).plus(listed).toFixed() : listed.toFixed(),
          confirmations: 0, finalized: false, blockTimestamp: new Date(item.block_timestamp!),
        });
      }
      const next = typeof body.meta?.fingerprint === 'string' && body.meta.fingerprint && body.data!.length > 0 ? body.meta.fingerprint : null;
      if (next && next === cursor.pageCursor) throw new ProviderUnavailableError('TronGrid pagination did not advance');
      const cursorWrite = this.prisma.depositWatchCursor.update({ where: key, data: next
        ? { pageCursor: next, pagesInWindow: { increment: 1 }, lastPageAt: new Date(this.now()), lastError: null }
        : { scannedThroughMs: cursor.windowEndMs!, windowStartMs: null, windowEndMs: null, pageCursor: null, pagesInWindow: 0,
          lastPageAt: new Date(this.now()), lastError: null } });
      // Rows and progress commit together; an empty page only moves progress.
      let inserted = { count: 0 };
      let updated: DepositWatchCursor;
      if (rows.size === 0) updated = await cursorWrite;
      else [inserted, updated] = await this.prisma.$transaction([this.prisma.deposit.createMany({ data: [...rows.values()], skipDuplicates: true }), cursorWrite]);
      summary.observed += rows.size;
      summary.newTransfers += inserted.count;
      cursor = updated;
    }
  }

  /** Prove new/unfinalized TRON rows, oldest first, with one head-block read
   * per run. Finalized, proven rows are never re-checked. */
  private async verifyPending(config: ChainConfig, verifier: TronDepositVerifier, summary: WatchRunSummary, startedAt: number) {
    const candidates = await this.prisma.deposit.findMany({
      where: { chain: WATCH.chain, status: { not: 'CREDITED' }, batchId: null, verifyError: null,
        OR: [{ verifiedAt: null }, { finalized: false }, { confirmations: { lt: config.minConfirmations } }] },
      orderBy: { createdAt: 'asc' }, take: this.cfg.maxVerificationsPerRun * 3,
    });
    const now = this.now();
    // Back off per row after a miss: 1, 2, 4 ... 60 minutes.
    const due = candidates.filter((r) => {
      const waitMs = r.verifyAttempts === 0 ? 0 : Math.min(60, 2 ** (r.verifyAttempts - 1)) * 60_000;
      return !r.lastVerifyAttemptAt || now - r.lastVerifyAttemptAt.getTime() >= waitMs;
    }).slice(0, this.cfg.maxVerificationsPerRun);
    if (due.length === 0) return;
    const head = await verifier.headBlock();
    for (const row of due) {
      if (this.now() - startedAt > this.cfg.maxRunMs) throw new BudgetExceeded('time budget reached');
      if (!config.tokens[row.asset]) {
        await recordProofFailure(this.prisma, row, new DepositVerificationError(`Unsupported asset on Tron: ${row.asset}`));
        summary.flagged++;
        continue;
      }
      try {
        const recipient = await recipientFor(this.prisma, config, row.recipientAddress);
        const proof = await verifier.prove(row.txHash, row.asset, { recipient, headBlock: head });
        const after = await applyProof(this.prisma, row as Deposit, proof, new Date(this.now()));
        if (after.verifyError) summary.flagged++; else summary.verified++;
      } catch (error) {
        if (error instanceof BudgetExceeded) throw error;
        const outcome = await recordProofFailure(this.prisma, row, error, new Date(this.now()));
        if (outcome === 'provider') throw error;
        if (outcome === 'flagged') summary.flagged++;
      }
    }
  }
}
