import { PrismaClient, Deposit } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { loadChainConfig, ChainType } from '../../config/chains';
import { MIN_DEPOSIT_USD } from '../../config/limits';
import {
  baseRowState, DepositRowState, isPackageEligible, meetsMinimum, packageKey, packageToken,
  PriceSourceWithMeta, sumAmounts, UsdValuation, valueInUsd, isNetworkConfirmed,
} from './depositPolicy';

const DEFAULT_MIN_CONFIRMATIONS: Record<ChainType, number> = { evm: 12, bitcoin: 2, tron: 19, solana: 32, ton: 3 };
/** The uncredited registry is small by nature; the cap only bounds a flood
 * of dust. Counts are always exact (COUNT queries), never this list's length. */
export const QUEUE_ROW_CAP = 2000;

export function minConfirmationsFor(chain: string): number {
  try { return loadChainConfig(chain).minConfirmations; }
  catch {
    const type: ChainType = (['bitcoin', 'tron', 'solana', 'ton'] as const).find((t) => t === chain) ?? 'evm';
    return DEFAULT_MIN_CONFIRMATIONS[type];
  }
}

export interface QueueRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  chain: string;
  asset: string;
  txHash: string;
  amount: string;
  confirmations: number;
  minConfirmations: number;
  finalized: boolean;
  verified: boolean;
  networkConfirmed: boolean;
  verifyError: string | null;
  recipientAddress: string | null;
  blockTimestamp: string | null;
  firstDetectedAt: string;
  creditedAt: string | null;
  batchId: string | null;
  revision: number;
  source: string | null;
  state: DepositRowState;
  claims: { userId: string; email: string | null; at: string }[];
  ignoredAt: string | null;
  ignoredReason: string | null;
  ignoredNote: string | null;
  ignoredByAdminId: string | null;
}

/** One approved credit and the exact transfers it booked («Зачисленные»). */
export interface CreditedBatchView {
  id: string;
  userId: string;
  userEmail: string | null;
  chain: string;
  asset: string;
  totalAmount: string;
  createdAt: string;
  approvedByAdminId: string;
  transfers: { id: string; txHash: string; amount: string; confirmations: number; blockTimestamp: string | null }[];
}

export interface DepositPackageView {
  key: string;
  userId: string;
  userEmail: string | null;
  chain: string;
  asset: string;
  /** Proven, network-confirmed, uncredited transfers: the only ones counted. */
  transfers: QueueRow[];
  total: string;
  /** Same owner/asset/network but not yet confirmed by the network: shown
   * separately, never part of `total`. */
  unconfirmedTotal: string;
  unconfirmedCount: number;
  minDepositUsd: number;
  usdValue: string | null;
  usdPolicy: UsdValuation['policy'];
  priceUsd: string | null;
  pricedAt: string | null;
  minimumReached: boolean;
  /** Pegged assets: in asset units. Priced assets: in USD (remainingUsd). */
  remaining: string | null;
  remainingUsd: string | null;
  state: 'AWAITING_TOPUP' | 'READY' | 'NEEDS_REVIEW';
  reviewReason: UsdValuation['reason'];
  token: string;
}

export interface DepositQueue {
  asOf: string;
  minDepositUsd: number;
  counts: Record<DepositRowState, number> & { uncreditedTotal: number; truncated: boolean };
  packageCounts: { AWAITING_TOPUP: number; READY: number; NEEDS_REVIEW: number };
  packages: DepositPackageView[];
  rows: QueueRow[];
  creditedBatches: CreditedBatchView[];
}

type RowWithUser = Deposit & { user: { email: string } | null };

function toRow(d: RowWithUser, minConfirmations: number, claims: QueueRow['claims']): QueueRow {
  return {
    id: d.id, userId: d.userId, userEmail: d.user?.email ?? null, chain: d.chain, asset: d.asset, txHash: d.txHash,
    amount: new BigNumber(d.amount.toString()).toFixed(), confirmations: d.confirmations, minConfirmations,
    finalized: d.finalized, verified: d.verifiedAt !== null, networkConfirmed: isNetworkConfirmed(d, minConfirmations),
    verifyError: d.verifyError, recipientAddress: d.recipientAddress,
    blockTimestamp: d.blockTimestamp?.toISOString() ?? null, firstDetectedAt: d.createdAt.toISOString(),
    creditedAt: d.creditedAt?.toISOString() ?? null, batchId: d.batchId, revision: d.revision, source: d.source,
    ignoredAt: d.ignoredAt?.toISOString() ?? null, ignoredReason: d.ignoredReason, ignoredNote: d.ignoredNote, ignoredByAdminId: d.ignoredByAdminId,
    state: baseRowState(d, minConfirmations) === 'PACKAGE' ? 'AWAITING_TOPUP' : baseRowState(d, minConfirmations) as DepositRowState,
    claims,
  };
}

/** Build one user's package from their uncredited rows. Pure given a price. */
export async function buildPackage(
  userId: string, userEmail: string | null, chain: string, asset: string,
  rows: RowWithUser[], prices: PriceSourceWithMeta, claimsFor: (d: Deposit) => QueueRow['claims'] = () => [],
): Promise<DepositPackageView> {
  const min = minConfirmationsFor(chain);
  const mine = rows.filter((r) => r.userId === userId && r.chain === chain && r.asset === asset.toUpperCase()
    && r.status !== 'CREDITED' && r.batchId === null && !r.ignoredAt);
  const eligible = mine.filter((r) => isPackageEligible(r, min));
  const unconfirmed = mine.filter((r) => !r.verifyError && !isNetworkConfirmed(r, min));
  const total = sumAmounts(eligible);
  const valuation = await valueInUsd(asset, total, prices);
  const reached = meetsMinimum(valuation.usd);
  const state: DepositPackageView['state'] = valuation.usd === null ? 'NEEDS_REVIEW' : reached ? 'READY' : 'AWAITING_TOPUP';
  const remainingUsd = valuation.usd === null ? null : BigNumber.max(0, new BigNumber(MIN_DEPOSIT_USD).minus(valuation.usd));
  const transfers = eligible.map((r) => ({ ...toRow(r, min, claimsFor(r)), state: state as DepositRowState }));
  return {
    key: packageKey(userId, chain, asset), userId, userEmail, chain, asset: asset.toUpperCase(), transfers,
    total: total.toFixed(), unconfirmedTotal: sumAmounts(unconfirmed).toFixed(), unconfirmedCount: unconfirmed.length,
    minDepositUsd: MIN_DEPOSIT_USD, usdValue: valuation.usd?.toFixed() ?? null, usdPolicy: valuation.policy,
    priceUsd: valuation.priceUsd?.toFixed() ?? null, pricedAt: valuation.pricedAt?.toISOString() ?? null,
    minimumReached: reached,
    remaining: remainingUsd === null ? null : valuation.policy === 'USD_PEGGED_POLICY' ? remainingUsd.toFixed() : null,
    remainingUsd: remainingUsd?.toFixed() ?? null,
    state, reviewReason: valuation.reason, token: packageToken(userId, chain, asset, eligible),
  };
}

/**
 * The admin registry, read-only: every uncredited transfer with its derived
 * state, and every user's package. No chain or provider call, no write.
 */
export class DepositQueueService {
  constructor(private prisma: PrismaClient, private prices: PriceSourceWithMeta) {}

  async load(options: { creditedLimit?: number } = {}): Promise<DepositQueue> {
    const [uncredited, uncreditedTotal, creditedCount, credited, batches] = await Promise.all([
      this.prisma.deposit.findMany({
        where: { status: { not: 'CREDITED' } }, orderBy: { createdAt: 'asc' }, take: QUEUE_ROW_CAP,
        include: { user: { select: { email: true } } },
      }),
      this.prisma.deposit.count({ where: { status: { not: 'CREDITED' } } }),
      this.prisma.deposit.count({ where: { status: 'CREDITED' } }),
      this.prisma.deposit.findMany({
        where: { status: 'CREDITED' }, orderBy: [{ creditedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: options.creditedLimit ?? 50, include: { user: { select: { email: true } } },
      }),
      options.creditedLimit === 0 ? Promise.resolve([]) : this.prisma.depositBatch.findMany({
        orderBy: { createdAt: 'desc' }, take: 30,
        include: { deposits: { orderBy: { createdAt: 'asc' }, select: { id: true, txHash: true, amount: true, confirmations: true, blockTimestamp: true } } },
      }),
    ]);
    const batchEmails = batches.length === 0 ? [] : await this.prisma.user.findMany({
      where: { id: { in: [...new Set(batches.map((b) => b.userId))] } }, select: { id: true, email: true },
    });
    const claimRows = uncredited.length === 0 ? [] : await this.prisma.depositClaim.findMany({
      where: { txHash: { in: uncredited.map((d) => d.txHash) } }, orderBy: { createdAt: 'asc' },
    });
    const claimUsers = claimRows.length === 0 ? [] : await this.prisma.user.findMany({
      where: { id: { in: [...new Set(claimRows.map((c) => c.userId))] } }, select: { id: true, email: true },
    });
    const emailOf = new Map(claimUsers.map((u) => [u.id, u.email]));
    const claimsFor = (d: Deposit) => claimRows.filter((c) => c.chain === d.chain && c.txHash === d.txHash)
      .map((c) => ({ userId: c.userId, email: emailOf.get(c.userId) ?? null, at: c.createdAt.toISOString() }));

    const groups = new Map<string, RowWithUser[]>();
    for (const d of uncredited) {
      if (!d.userId || d.batchId || d.ignoredAt) continue;
      const key = packageKey(d.userId, d.chain, d.asset);
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    const packages: DepositPackageView[] = [];
    for (const rows of groups.values()) {
      const [first] = rows;
      const pkg = await buildPackage(first.userId!, first.user?.email ?? null, first.chain, first.asset, rows, this.prices, claimsFor);
      if (pkg.transfers.length > 0) packages.push(pkg);
    }
    const stateById = new Map(packages.flatMap((p) => p.transfers.map((t) => [t.id, t.state] as const)));
    const rows = [...uncredited, ...credited].map((d) => {
      const row = toRow(d, minConfirmationsFor(d.chain), d.status === 'CREDITED' ? [] : claimsFor(d));
      return { ...row, state: stateById.get(d.id) ?? (row.state === 'AWAITING_TOPUP' ? 'AWAITING_CONFIRMATIONS' : row.state) };
    });
    const counts = { CREDITED: creditedCount, NEEDS_REVIEW: 0, UNATTRIBUTED: 0, AWAITING_CONFIRMATIONS: 0, AWAITING_TOPUP: 0, READY: 0, IGNORED: 0,
      uncreditedTotal, truncated: uncreditedTotal > uncredited.length };
    // Rows of a package that cannot be valued already carry NEEDS_REVIEW.
    for (const r of rows) if (r.state !== 'CREDITED') counts[r.state]++;
    // Package counters count PACKAGES (one per user + asset + network), not transfers.
    const packageCounts = {
      AWAITING_TOPUP: packages.filter((p) => p.state === 'AWAITING_TOPUP').length,
      READY: packages.filter((p) => p.state === 'READY').length,
      NEEDS_REVIEW: packages.filter((p) => p.state === 'NEEDS_REVIEW').length,
    };
    const emailOfBatchUser = new Map(batchEmails.map((u) => [u.id, u.email]));
    const creditedBatches: CreditedBatchView[] = batches.map((b) => ({
      id: b.id, userId: b.userId, userEmail: emailOfBatchUser.get(b.userId) ?? null, chain: b.chain, asset: b.asset,
      totalAmount: new BigNumber(b.totalAmount.toString()).toFixed(), createdAt: b.createdAt.toISOString(), approvedByAdminId: b.approvedByAdminId,
      transfers: b.deposits.map((d) => ({ id: d.id, txHash: d.txHash, amount: new BigNumber(d.amount.toString()).toFixed(),
        confirmations: d.confirmations, blockTimestamp: d.blockTimestamp?.toISOString() ?? null })),
    }));
    return { asOf: new Date().toISOString(), minDepositUsd: MIN_DEPOSIT_USD, counts, packageCounts, packages, rows, creditedBatches };
  }
}
