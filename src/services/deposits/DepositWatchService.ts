import { PrismaClient, Prisma, Deposit, DepositWatchCursor } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { randomUUID } from 'crypto';
import { notifyDeposit, notifyDepositDigest } from '../TelegramNotifications';
import { ChainConfig } from '../../config/chains';
import { DepositVerificationError, ProviderUnavailableError, TransferNotFoundError } from '../deposit-verifiers';
import { nativeTrxSun, TronDepositVerifier } from '../deposit-verifiers/TronDepositVerifier';
import { ALLOWLISTED_TOKENS } from '../deposit-verifiers/proof';
import { tronAddressHex } from '../deposit-verifiers/tronAddress';
import { applyProof, recordProofFailure } from '../DepositService';
import { recipientFor, rememberTreasuryAddress, treasuryAddresses } from './transferProof';
import { adminOpenAllowed, dueSlot, isDaytime, localTime, nextSlotAt, slotKeyAt, watchScheduleFromEnv } from './depositWatchSchedule';
import { classifyNotice, DigestGroup, DigestKind, digestAckIdFor, digestGroups, digestIdFor, NoticePolicy, noticePolicyFromEnv } from './depositNoticePolicy';

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * PRODUCTION DEPOSIT WATCHER — USDT/TRC20 and native TRX, known treasuries only.
 *
 * It can: read the chain (TronGrid), store newly observed transfers, prove
 * and refresh their confirmations, and report scan progress.
 * It cannot: credit, attribute, touch Balance/FuturesBalance, pay referral,
 * withdraw, sign or send chain transactions. It holds no admin identity: this class
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
  // Anonymous TronGrid traffic is IP-limited. Serial reads also need spacing:
  // a bounded scan must not burst all its requests and repeatedly hit 429.
  // Configured API keys retain their existing provider policy.
  anonymousRequestIntervalMs: 1_000,
  maxVerificationsPerRun: 20,
  /** Proven transfers without a notice record read per run (classification is
   * in memory; individual sends stay bounded by maxVerificationsPerRun). A row
   * becomes a candidate only after a proof, at most maxVerificationsPerRun per
   * run, and summarised rows are closed daily, so the 7-day working set stays
   * far below this; reaching it is logged. */
  maxNoticeCandidatesPerRun: 5000,
  /** An unacknowledged digest older than this can no longer be accepted by the
   * notification Worker (7-day event retention) and is closed as EXPIRED. */
  digestClaimMaxAgeMs: 6 * 24 * 60 * 60_000,
  maxRunMs: 60_000,
  leaseMs: 120_000,
  /** Daytime schedule (Europe/Kyiv): first admin open after 07:00, then
   * 12:00 / 16:00 / 20:00, nothing 22:00–07:00. See depositWatchSchedule.ts. */
  schedule: watchScheduleFromEnv(),
} as const;

/** schedule — a daytime slot (in-process timer or the internal tick);
 * admin_open — the first opening of Admin → Пополнения after 07:00;
 * admin — «Проверить новые поступления», always allowed. */
export type WatchTrigger = 'schedule' | 'admin_open' | 'admin';

export interface WatchRunSummary {
  ran: boolean;
  skipped?: 'LEASE_HELD' | 'PAUSED' | 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'NOT_DUE';
  /** Why an automatic trigger did nothing: NIGHT, BEFORE_FIRST_SLOT, SLOT_DONE, ALREADY_TODAY, RECENT_SCAN. */
  notDueReason?: string;
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
  /** #699 notice accounting for this run. Counts only: no TXID, amount or address.
   * fresh/micro/historical/timeUnknown — proven transfers still without a notice
   * record, by class; sent — individual «Нове надходження» acknowledged;
   * digested — rows closed by a digest (or journalled with the digest off);
   * digest — the digest outcome, or why none was sent. */
  notices?: { fresh: number; micro: number; historical: number; timeUnknown: number; sent: number; digested: number; digest: string | null };
}

interface Trc20ListItem {
  transaction_id?: string;
  to?: string;
  value?: string;
  block_timestamp?: number;
  token_info?: { address?: string };
}

class BudgetExceeded extends Error {}
export const TRX_NATIVE_CURSOR = 'native:TRX';
interface ProofBudget { headBlock?: number; used: number }

export type WatchLimits = { -readonly [K in keyof typeof WATCH]: (typeof WATCH)[K] };

export class DepositWatchService {
  private readonly cfg: WatchLimits;
  constructor(
    private prisma: PrismaClient,
    private resolveChain: (chain: string) => Promise<ChainConfig>,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
    limits: Partial<Omit<WatchLimits, 'chain'>> = {},
    private readonly notifyTransfer: typeof notifyDeposit = notifyDeposit,
    notifyDigest?: typeof notifyDepositDigest,
    private readonly noticePolicy: NoticePolicy = noticePolicyFromEnv(),
  ) {
    this.cfg = { ...WATCH, ...limits };
    // A caller that replaces the transfer notifier (tests, fixtures) and gives
    // no digest notifier must never reach the real notification service.
    this.notifyDigest = notifyDigest ?? (notifyTransfer === notifyDeposit ? notifyDepositDigest : null);
  }
  private readonly notifyDigest: typeof notifyDepositDigest | null;

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
      this.prisma.deposit.count({ where: { chain: WATCH.chain, status: { not: 'CREDITED' }, ignoredAt: null, verifyError: null, OR: [{ verifiedAt: null }, { finalized: false }] } }),
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
      lastAdminOpenRunAt: state?.lastAdminOpenRunAt?.toISOString() ?? null,
      nextScheduledRunAt: state?.enabled ? new Date(nextSlotAt(now, this.cfg.schedule)).toISOString() : null,
      adminOpenDueToday: !!state?.enabled && adminOpenAllowed(now, state?.lastAdminOpenRunAt?.getTime() ?? null, this.cfg.schedule),
      policy: { timeZone: this.cfg.schedule.timeZone, slots: this.cfg.schedule.slotMinutes.map(clock),
        dayStart: clock(this.cfg.schedule.dayStartMinutes), nightStart: clock(this.cfg.schedule.nightStartMinutes),
        dedupeMinutes: this.cfg.schedule.dedupeMs / 60_000, pageSize: this.cfg.pageSize, maxPagesPerRun: this.cfg.maxPagesPerRun, overlapMinutes: this.cfg.overlapMs / 60_000,
        initialBackfillDays: this.cfg.initialBackfillMs / 86_400_000 },
    };
  }

  /** One bounded scan. Automatic triggers (`schedule`, `admin_open`) obey
   * the enabled switch and the daytime schedule; `admin` («Проверить новые
   * поступления») always runs. All share one lease and one cursor. */
  async runOnce(trigger: WatchTrigger): Promise<WatchRunSummary> {
    const startedAt = this.now();
    const owner = randomUUID();
    const summary: WatchRunSummary = {
      ran: false, ok: false, trigger, startedAt: new Date(startedAt).toISOString(), durationMs: 0, providerCalls: 0, providerBytes: 0,
      pagesRead: 0, observed: 0, newTransfers: 0, verified: 0, flagged: 0, error: null, cursors: [], backlog: false, unfinalized: 0,
      needsFollowUp: false, addresses: [],
    };
    const state = await this.ensureState();
    const automatic = trigger !== 'admin';
    if (automatic && !state.enabled) return { ...summary, skipped: 'PAUSED', ok: true };
    // Provider asked us to back off (429 Retry-After): automatic triggers wait.
    const retryUntil = Number((state.providerStatus ?? '').match(/^RATE_LIMITED:(\d+)$/)?.[1] ?? 0);
    if (automatic && retryUntil > startedAt) return { ...summary, skipped: 'RATE_LIMITED', ok: true, needsFollowUp: true };
    // The schedule is enforced here, not by the caller: an early, repeated or
    // night-time automatic trigger costs one state read and nothing else.
    if (automatic) {
      const s = this.cfg.schedule;
      const notDue = (notDueReason: string) => ({ ...summary, skipped: 'NOT_DUE' as const, notDueReason, ok: true });
      if (!isDaytime(localTime(startedAt, s.timeZone), s)) return notDue('NIGHT');
      if (trigger === 'schedule') {
        const slot = dueSlot(startedAt, s);
        if (!slot) return notDue('BEFORE_FIRST_SLOT');
        if (slotKeyAt(state.lastScheduledRunAt?.getTime() ?? null, s) === slot.key) return notDue('SLOT_DONE');
      } else if (!adminOpenAllowed(startedAt, state.lastAdminOpenRunAt?.getTime() ?? null, s)) return notDue('ALREADY_TODAY');
      // Another scan finished moments ago: this trigger is satisfied by it.
      // Mark the slot / today's admin-open as used so it is not retried later.
      if (state.lastSuccessAt && startedAt - state.lastSuccessAt.getTime() < s.dedupeMs) {
        await this.prisma.depositWatchState.update({ where: { id: WATCH.chain },
          data: trigger === 'schedule' ? { lastScheduledRunAt: new Date(startedAt) } : { lastAdminOpenRunAt: new Date(startedAt) } });
        return notDue('RECENT_SCAN');
      }
    }

    const leased = await this.prisma.$executeRaw`
      UPDATE "DepositWatchState" SET "leaseOwner" = ${owner}, "leaseUntil" = ${new Date(startedAt + this.cfg.leaseMs)},
        "lastRunStartedAt" = ${new Date(startedAt)}, "lastRunTrigger" = ${trigger},
        "lastScheduledRunAt" = CASE WHEN ${trigger}::text = 'schedule' THEN ${new Date(startedAt)} ELSE "lastScheduledRunAt" END,
        "lastAdminOpenRunAt" = CASE WHEN ${trigger}::text = 'admin_open' THEN ${new Date(startedAt)} ELSE "lastAdminOpenRunAt" END
      WHERE id = ${WATCH.chain} AND ("leaseUntil" IS NULL OR "leaseUntil" < ${new Date(startedAt)})`;
    if (leased !== 1) return { ...summary, skipped: 'LEASE_HELD', ok: true };
    summary.ran = true;

    let providerStatus: string | null = 'OK';
    try {
      let config: ChainConfig;
      try { config = await this.resolveChain(WATCH.chain); }
      catch { summary.skipped = 'NOT_CONFIGURED'; summary.ok = true; providerStatus = 'NOT_CONFIGURED'; return summary; }
      const fetchProvider = this.counted(summary, config.apiKey ? 0 : this.cfg.anonymousRequestIntervalMs);
      const verifier = new TronDepositVerifier(config, fetchProvider);
      const proofs: ProofBudget = { used: 0 };
      await rememberTreasuryAddress(this.prisma, WATCH.chain, config.treasuryAddress);
      const addresses = await treasuryAddresses(this.prisma, config);
      summary.addresses = addresses;

      // A budget stop is not a failure: it leaves backlog for the next run.
      const bounded = async (phase: () => Promise<void>) => {
        try { await phase(); } catch (error) { if (error instanceof BudgetExceeded) summary.backlog = true; else throw error; }
      };
      try {
        // Native proofs reserve at most half the verification budget, so a
        // native backlog cannot starve the existing USDT proof queue.
        if (config.nativeAsset === 'TRX') {
          const nativeCursors = await this.prisma.depositWatchCursor.findMany({ where: { chain: WATCH.chain, contract: TRX_NATIVE_CURSOR } });
          const last = (address: string) => nativeCursors.find(c => tronAddressHex(c.address) === tronAddressHex(address))?.lastPageAt?.getTime() ?? 0;
          for (const address of [...addresses].sort((a, b) => last(a) - last(b))) {
            await bounded(() => this.scanCursor(config, address, 'TRX', TRX_NATIVE_CURSOR, 6, summary, startedAt, fetchProvider, verifier, proofs));
          }
        }
        await bounded(async () => {
          for (const address of addresses) {
            for (const [asset, token] of Object.entries(config.tokens)) {
              const allowed = ALLOWLISTED_TOKENS.tron[asset];
              if (!allowed || tronAddressHex(token.contractAddress) !== tronAddressHex(allowed.contract) || token.decimals !== allowed.decimals) continue;
              await this.scanCursor(config, address, asset, allowed.contract, allowed.decimals, summary, startedAt, fetchProvider);
            }
          }
        });
        await bounded(() => this.verifyPending(config, verifier, summary, startedAt, proofs));
        await bounded(() => this.notifyVerified(config, summary, startedAt));
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
      summary.unfinalized = await this.prisma.deposit.count({ where: { chain: WATCH.chain, status: { not: 'CREDITED' }, ignoredAt: null, verifyError: null,
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
  private counted(summary: WatchRunSummary, intervalMs: number): typeof fetch {
    let nextRequestAt = 0;
    return (async (input: any, init?: any) => {
      if (summary.providerCalls >= this.cfg.maxProviderCallsPerRun) throw new BudgetExceeded('provider call budget reached');
      const waitMs = nextRequestAt - Date.now();
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      nextRequestAt = Date.now() + intervalMs;
      summary.providerCalls++;
      const res = await this.fetchFn(input, init);
      const text = await res.text();
      summary.providerBytes += Buffer.byteLength(text);
      return { ok: res.ok, status: res.status, headers: res.headers, json: async () => JSON.parse(text), text: async () => text } as Response;
    }) as typeof fetch;
  }

  private async scanCursor(config: ChainConfig, address: string, asset: string, contract: string, decimals: number, summary: WatchRunSummary, startedAt: number, fetchPage: typeof fetch, verifier?: TronDepositVerifier, proofs?: ProofBudget) {
    const native = asset === 'TRX' && contract === TRX_NATIVE_CURSOR;
    const key = { chain_address_contract: { chain: WATCH.chain, address, contract } };
    let cursor = await this.prisma.depositWatchCursor.findUnique({ where: key });
    if (!cursor) {
      // First scan of this address: a bounded backfill, never the whole history.
      await this.prisma.depositWatchCursor.createMany({ data: [{
        chain: WATCH.chain, address, contract, asset, scannedThroughMs: BigInt(startedAt - this.cfg.initialBackfillMs),
      }], skipDuplicates: true });
      cursor = await this.prisma.depositWatchCursor.findUniqueOrThrow({ where: key });
    }
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
      const nativeBudget = Math.max(1, Math.floor(this.cfg.maxVerificationsPerRun / 2));
      const pageSize = native ? Math.min(this.cfg.pageSize, 5, nativeBudget) : this.cfg.pageSize;
      const qs = new URLSearchParams({ only_to: 'true', limit: String(pageSize),
        order_by: 'block_timestamp,asc', min_timestamp: String(cursor.windowStartMs), max_timestamp: String(cursor.windowEndMs) });
      if (native) qs.set('only_confirmed', 'true'); else qs.set('contract_address', contract);
      if (cursor.pageCursor) qs.set('fingerprint', cursor.pageCursor);
      let body: { success?: boolean; data?: any[]; meta?: { fingerprint?: string } };
      try {
        let res: Response;
        try { res = await fetchPage(`${base}/v1/accounts/${address}/transactions${native ? '' : '/trc20'}?${qs}`, { headers, signal: AbortSignal.timeout(10_000) }); }
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
        const nativeContracts = item?.raw_data?.contract;
        if (native && (!Array.isArray(nativeContracts) || nativeContracts.length !== 1 || nativeContracts[0]?.type !== 'TransferContract')) continue;
        const nativeValue = native ? nativeContracts[0]?.parameter?.value : null;
        if (native && (nativeValue?.amount === 0 || nativeValue?.amount === '0')) continue;
        const txHash = String(native ? item?.txID : item?.transaction_id ?? '').toLowerCase();
        const value = native ? nativeTrxSun(nativeValue?.amount) : String(item?.value ?? '');
        if (!/^[0-9a-f]{64}$/.test(txHash) || !/^\d+$/.test(value) || !Number.isSafeInteger(item?.block_timestamp)) {
          const message = 'TronGrid page contains a malformed transfer';
          await this.prisma.depositWatchCursor.update({ where: key, data: { lastError: message, lastErrorAt: new Date(this.now()) } });
          throw new ProviderUnavailableError(message);
        }
        if (tronAddressHex(native ? nativeValue?.to_address : item.to) !== recipientHex) continue; // not ours
        if (!native && item.token_info?.address && tronAddressHex(item.token_info.address) !== contractHex) continue;
        if (native) {
          if (!verifier || !proofs) throw new Error('Native proof context missing');
          if (proofs.used >= nativeBudget) throw new BudgetExceeded('native proof budget reached');
          proofs.headBlock ??= await verifier.headBlock();
          proofs.used++;
          try {
            const proof = await verifier.prove(txHash, 'TRX', { recipient: address, headBlock: proofs.headBlock });
            rows.set(txHash, { chain: WATCH.chain, txHash, asset: 'TRX', status: 'PENDING', source: 'watcher', recipientAddress: address,
              amount: proof.amount.toFixed(), confirmations: proof.confirmations, finalized: proof.finalized,
              blockNumber: proof.blockNumber === null ? null : BigInt(proof.blockNumber), blockTimestamp: proof.blockTimestamp,
              verifiedAt: new Date(this.now()), lastVerifyAttemptAt: new Date(this.now()) });
            summary.verified++;
          } catch (error) {
            if (error instanceof BudgetExceeded || error instanceof ProviderUnavailableError) throw error;
            if (error instanceof TransferNotFoundError) throw new ProviderUnavailableError('Indexed native transaction is not yet available from the node');
            if (!(error instanceof DepositVerificationError)) throw error;
            summary.flagged++; // definitive wrong asset/recipient/execution: no row or notification
          }
          continue;
        }
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
      let inserted: { id: string; amount: Prisma.Decimal; createdAt: Date }[] = [];
      let updated: DepositWatchCursor;
      if (rows.size === 0) updated = await cursorWrite;
      else [inserted, updated] = await this.prisma.$transaction([
        // INSERT RETURNING replaces INSERT; no extra SELECT and only genuinely
        // new rows are returned (overlap pages/unique conflicts return nothing).
        this.prisma.deposit.createManyAndReturn({ data: [...rows.values()], skipDuplicates: true,
          select: { id: true, amount: true, createdAt: true } }), cursorWrite,
      ]);
      summary.observed += rows.size;
      summary.newTransfers += inserted.length;
      cursor = updated;
      // Discovery alone is never a Telegram deposit. Only notifyVerified()
      // may send, after authoritative proof and configured finality checks.
    }
  }

  /** Prove new/unfinalized TRON rows, oldest first, with one head-block read
   * per run. Finalized, proven rows are never re-checked. */
  private async verifyPending(config: ChainConfig, verifier: TronDepositVerifier, summary: WatchRunSummary, startedAt: number, proofs: ProofBudget) {
    const candidates = await this.prisma.deposit.findMany({
      where: { chain: WATCH.chain, status: { not: 'CREDITED' }, batchId: null, ignoredAt: null, verifyError: null,
        OR: [{ verifiedAt: null }, { finalized: false }, { confirmations: { lt: config.minConfirmations } }] },
      orderBy: { createdAt: 'asc' }, take: this.cfg.maxVerificationsPerRun * 3,
    });
    const now = this.now();
    // Back off per row after a miss: 1, 2, 4 ... 60 minutes.
    const due = candidates.filter((r) => {
      const waitMs = r.verifyAttempts === 0 ? 0 : Math.min(60, 2 ** (r.verifyAttempts - 1)) * 60_000;
      return !r.lastVerifyAttemptAt || now - r.lastVerifyAttemptAt.getTime() >= waitMs;
    }).slice(0, Math.max(0, this.cfg.maxVerificationsPerRun - proofs.used));
    if (due.length === 0) return;
    const head = proofs.headBlock ??= await verifier.headBlock();
    for (const row of due) {
      if (this.now() - startedAt > this.cfg.maxRunMs) throw new BudgetExceeded('time budget reached');
      if (!config.tokens[row.asset] && !(row.asset === 'TRX' && config.nativeAsset === 'TRX')) {
        await recordProofFailure(this.prisma, row, new DepositVerificationError(`Unsupported asset on Tron: ${row.asset}`));
        summary.flagged++;
        continue;
      }
      try {
        proofs.used++;
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

  /** Existing AuditLog is the nonfinancial delivery acknowledgement journal.
   * No schema/ledger change. Worker event IDs remain the deposit ID: a crash
   * after Telegram but before this insert replays the SAME durable event,
   * never a second sendMessage. Unacknowledged network outcomes remain due.
   *
   * #699: «new» is decided from the on-chain block time, never from the time
   * the row was inserted. Only a FRESH, non-micro transfer gets its own
   * «Нове надходження». Micro transfers (possible dust) and transfers that
   * were already old when first recorded are summarised in at most one digest
   * per Kyiv day. Every row keeps exactly one `deposit-notice:<id>` record, so
   * a rescan, an API restart or a redeploy can never announce it again.
   * Nothing here credits, attributes, hides or deletes a transfer. */
  private async notifyVerified(config: ChainConfig, summary: WatchRunSummary, startedAt: number) {
    const since = new Date(this.now() - 7 * 24 * 60 * 60_000);
    // `createdAt` only bounds the working set (the Worker keeps an event for 7
    // days after it was recorded). It no longer decides what is new.
    const rows = await this.prisma.$queryRaw<Deposit[]>`
      SELECT d.* FROM "Deposit" d WHERE d.chain = ${WATCH.chain}
        AND d.asset IN ('USDT', 'TRX') AND d.status <> 'CREDITED'
        AND d."verifiedAt" IS NOT NULL AND d.finalized = true AND d."verifyError" IS NULL
        AND d.confirmations >= ${config.minConfirmations} AND d."ignoredAt" IS NULL
        AND d."createdAt" > ${since}
        AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.id = ('deposit-notice:' || d.id))
      ORDER BY d."createdAt", d.id LIMIT ${this.cfg.maxNoticeCandidatesPerRun}`;
    const notices = summary.notices = { fresh: 0, micro: 0, historical: 0, timeUnknown: 0, sent: 0, digested: 0, digest: null as string | null };
    const fresh: Deposit[] = [];
    const summarised: { row: Deposit; kind: DigestKind }[] = [];
    // When each (address, asset) began to be watched: a transfer mined after
    // that arrived while we were watching, however late it was recorded.
    const watched = new Map<string, number>();
    if (rows.length > 0) {
      for (const c of await this.prisma.depositWatchCursor.findMany({ where: { chain: WATCH.chain }, select: { address: true, asset: true, createdAt: true } })) {
        watched.set(`${tronAddressHex(c.address)}|${c.asset}`, c.createdAt.getTime());
      }
    }
    for (const row of rows) {
      const since = row.source === 'watcher' && row.recipientAddress ? watched.get(`${tronAddressHex(row.recipientAddress)}|${row.asset}`) ?? null : null;
      const kind = classifyNotice(row, this.noticePolicy, this.now(), since);
      if (kind === 'FRESH') { fresh.push(row); notices.fresh++; continue; }
      summarised.push({ row, kind });
      if (kind === 'MICRO') notices.micro++; else if (kind === 'HISTORICAL') notices.historical++; else notices.timeUnknown++;
    }
    try {
      // Real, recent receipts first: a digest must never delay them.
      for (const row of fresh.slice(0, this.cfg.maxVerificationsPerRun)) {
        if (this.now() - startedAt > this.cfg.maxRunMs) throw new BudgetExceeded('notification time budget reached');
        try {
          // Recheck the row's recorded recipient against approved current/past
          // treasuries; a public copy-event or catalogue entry grants no trust.
          await recipientFor(this.prisma, config, row.recipientAddress);
          const status = await this.notifyTransfer({ ...row, requiredConfirmations: config.minConfirmations });
          if (!status) continue;
          await this.prisma.auditLog.upsert({ where: { id: `deposit-notice:${row.id}` }, update: {},
            create: { id: `deposit-notice:${row.id}`, userId: null, action: 'DEPOSIT_NOTIFICATION_DELIVERY',
              metadata: { depositId: row.id, asset: row.asset, chain: row.chain, deliveryStatus: status, noticeClass: 'FRESH',
                blockTimestamp: row.blockTimestamp?.toISOString() ?? null } } });
          notices.sent++;
        } catch { console.warn('[notifications]', 'DELIVERY_UNAVAILABLE'); }
      }
      if (this.now() - startedAt > this.cfg.maxRunMs) throw new BudgetExceeded('notification time budget reached');
      try { await this.summariseNotices(config, summarised, notices); }
      catch { notices.digest = 'UNAVAILABLE'; console.warn('[notifications]', 'DIGEST_UNAVAILABLE'); }
    } finally {
      // Counts only. No TXID, amount, address or account ever reaches the log.
      if (rows.length > 0 || notices.digest) console.info('[deposit-watch]', 'notices', JSON.stringify(notices));
      if (rows.length >= this.cfg.maxNoticeCandidatesPerRun) console.warn('[deposit-watch]', 'NOTICE_CANDIDATE_LIMIT_REACHED');
    }
  }

  /** Journal rows that must not be announced as new, with at most ONE Telegram
   * digest per Kyiv day.
   *   claim    `deposit-digest:<chain>:<day>` — written BEFORE the send with the
   *            exact rows and text facts, so a replay is byte-for-byte the same
   *            event and the Worker's durable claim can only answer DUPLICATE;
   *   ack      `deposit-digest-ack:…` + one `deposit-notice:<id>` per row, in
   *            one transaction, only after the Worker reported an outcome.
   * An unacknowledged claim is finished before anything new is claimed. */
  private async summariseNotices(config: ChainConfig, candidates: { row: Deposit; kind: DigestKind }[], notices: NonNullable<WatchRunSummary['notices']>) {
    type Claim = { depositIds: string[]; classes: Record<string, DigestKind>; assets: Record<string, string>; groups: DigestGroup[]; createdAtMs: number };
    const today = localTime(this.now(), this.noticePolicy.timeZone).day;
    const journal = (ids: string[], claim: Pick<Claim, 'classes' | 'assets'>, digestId: string | null, deliveryStatus: string) => ids.map((id) => ({
      id: `deposit-notice:${id}`, userId: null, action: digestId ? 'DEPOSIT_NOTICE_DIGESTED' : 'DEPOSIT_NOTICE_SUPPRESSED',
      metadata: { depositId: id, asset: claim.assets[id] ?? null, chain: WATCH.chain, noticeClass: claim.classes[id] ?? null, digestId, deliveryStatus },
    }));
    const finish = async (digestId: string, claim: Claim, deliveryStatus: string) => {
      await this.prisma.$transaction([
        this.prisma.auditLog.createMany({ data: [{ id: digestAckIdFor(digestId), userId: null, action: 'DEPOSIT_NOTICE_DIGEST_DELIVERY',
          metadata: { digestId, chain: WATCH.chain, deliveryStatus, count: claim.depositIds.length, deliveredDay: today } }], skipDuplicates: true }),
        this.prisma.auditLog.createMany({ data: journal(claim.depositIds, claim, digestId, deliveryStatus), skipDuplicates: true }),
      ]);
      notices.digested += claim.depositIds.length;
      notices.digest = deliveryStatus;
    };
    const notify = this.notifyDigest;
    const deliver = async (digestId: string, claim: Claim): Promise<boolean> => {
      if (this.now() - claim.createdAtMs > this.cfg.digestClaimMaxAgeMs) { await finish(digestId, claim, 'EXPIRED'); return true; }
      const status = notify ? await notify({ id: digestId, createdAt: new Date(claim.createdAtMs), groups: claim.groups }) : null;
      if (!status) { notices.digest = 'PENDING'; return false; }
      // REJECTED: the Worker refuses this exact content, so no retry can ever
      // deliver it. Close it (recorded, visible in the journal) instead of
      // letting it block every later digest.
      if (status === 'REJECTED') console.warn('[notifications]', 'DIGEST_REJECTED');
      await finish(digestId, claim, status);
      return true;
    };

    // 1. An earlier claim without an acknowledgement (crash, Worker outage).
    const open = await this.prisma.$queryRaw<{ id: string; metadata: unknown }[]>`
      SELECT c.id, c.metadata FROM "AuditLog" c WHERE c.action = 'DEPOSIT_NOTICE_DIGEST_CLAIMED'
        AND c.id LIKE ${`deposit-digest:${WATCH.chain}:%`}
        AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.id = replace(c.id, 'deposit-digest:', 'deposit-digest-ack:'))
      ORDER BY c."createdAt", c.id LIMIT 1`;
    if (open.length > 0) {
      // One digest call per run: whatever is new waits for the next run.
      await deliver(open[0].id, open[0].metadata as Claim);
      return;
    }
    if (candidates.length === 0) return;

    // Same recipient rule as an individual alert: only approved treasuries.
    const trusted: { row: Deposit; kind: DigestKind }[] = [];
    for (const candidate of candidates) {
      try { await recipientFor(this.prisma, config, candidate.row.recipientAddress); trusted.push(candidate); }
      catch { /* not a known treasury: left for manual review, never announced */ }
    }
    if (trusted.length === 0) return;
    const facts: Pick<Claim, 'classes' | 'assets'> = {
      classes: Object.fromEntries(trusted.map(({ row, kind }) => [row.id, kind])),
      assets: Object.fromEntries(trusted.map(({ row }) => [row.id, row.asset])),
    };
    const ids = trusted.map(({ row }) => row.id);

    // 2. Digest switched off: journal only. Telegram is never called.
    if (this.noticePolicy.digest === 'off') {
      await this.prisma.auditLog.createMany({ data: journal(ids, facts, null, 'NOT_SENT'), skipDuplicates: true });
      notices.digested += ids.length;
      notices.digest = 'OFF';
      return;
    }

    // No digest notifier (a fixture replaced only the transfer notifier):
    // nothing is claimed and nothing can reach the real notification service.
    if (!notify) { notices.digest = 'NOT_CONFIGURED'; return; }

    // 3. At most one digest MESSAGE per Kyiv day, including a late delivery of
    //    an earlier day's claim; later rows join the next day's digest.
    const digestId = digestIdFor(WATCH.chain, this.now(), this.noticePolicy);
    const deliveredToday = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM "AuditLog" a WHERE a.action = 'DEPOSIT_NOTICE_DIGEST_DELIVERY'
        AND a.id LIKE ${`deposit-digest-ack:${WATCH.chain}:%`} AND a.metadata ->> 'deliveredDay' = ${today} LIMIT 1`;
    if (deliveredToday.length > 0 || await this.prisma.auditLog.findUnique({ where: { id: digestId }, select: { id: true } })) { notices.digest = 'ALREADY_TODAY'; return; }
    const claim: Claim = { depositIds: ids, ...facts, groups: digestGroups(trusted, this.noticePolicy, this.now()), createdAtMs: this.now() };
    await this.prisma.auditLog.create({ data: { id: digestId, userId: null, action: 'DEPOSIT_NOTICE_DIGEST_CLAIMED',
      metadata: { chain: WATCH.chain, ...claim } as unknown as Prisma.InputJsonObject } });
    await deliver(digestId, claim);
  }
}
