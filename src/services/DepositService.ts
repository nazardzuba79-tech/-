import { PrismaClient, Deposit } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { ChainConfig } from '../config/chains';
import { DepositVerificationError, ProviderUnavailableError, TransferNotFoundError } from './deposit-verifiers';
import { isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testMarkets/testAssetConfig';
import { assertSaneProof, proveTransfer, rememberTreasuryAddress } from './deposits/transferProof';
import { TransferProof } from './deposit-verifiers/proof';
import { PriceSourceWithMeta } from './deposits/depositPolicy';

export { DepositVerificationError } from './deposit-verifiers';
export type PriceSource = PriceSourceWithMeta;

/** What an admin's "check this TXID" shows: the measured proof, and whether
 * the transfer is now in the admin registry. Never a credit or attribution. */
export interface ObservationResult {
  recorded: boolean;
  depositId: string | null;
  status: string | null;
  amount: string;
  confirmations: number;
  finalized: boolean;
  blockTimestamp: string | null;
  recipient: string;
}

/**
 * Detection and client claims. NOTHING in this class changes a balance:
 *   - recordObservation(): proves a transfer on chain and stores/refreshes it
 *     in the admin registry (unattributed unless an admin attributed it).
 *   - submitClaim(): stores a client's "this TXID is mine" as a hint only.
 * Crediting is DepositBatchService.confirm(), behind an admin's explicit
 * confirmation of a whole package that meets the minimum.
 */
export class DepositService {
  constructor(private prisma: PrismaClient, private chainConfig: ChainConfig, private priceSource?: PriceSource) {}

  canonicalHash(value: string): string {
    if (this.chainConfig.type === 'solana') return value;
    return this.chainConfig.type === 'ton' ? value.toLowerCase().replace(/^0x/, '') : value.toLowerCase();
  }

  /** Prove `txHash` on chain and store the result. A CREDITED row is never
   * touched. A proven row whose amount changes is flagged for review, never
   * silently rewritten. Attribution is never set or changed here. */
  async recordObservation(params: { txHash: string; asset: string; source: 'admin_check' | 'incoming_feed' }): Promise<ObservationResult> {
    if (isTestAssetPairOrSymbol(params.asset)) throw new DepositVerificationError(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    const txHash = this.canonicalHash(params.txHash), asset = params.asset.toUpperCase();
    const where = { chain_txHash: { chain: this.chainConfig.chain, txHash } };
    const existing = await this.prisma.deposit.findUnique({ where });
    if (existing && existing.asset !== asset) throw new DepositVerificationError('Transaction already recorded for another asset');
    if (existing?.deletedUserId || existing?.status === 'CREDITED') return this.result(existing, null);

    const proof = await proveTransfer(this.chainConfig, txHash, asset, { recipient: existing?.recipientAddress ?? undefined });
    assertSaneProof(proof);
    await rememberTreasuryAddress(this.prisma, this.chainConfig.chain, proof.recipient);
    const now = new Date();
    if (!existing) {
      const row = await this.prisma.deposit.upsert({ where, update: {}, create: {
        chain: this.chainConfig.chain, txHash, asset, amount: proof.amount.toFixed(), status: 'PENDING',
        confirmations: proof.confirmations, finalized: proof.finalized, verifiedAt: now, lastVerifyAttemptAt: now,
        recipientAddress: proof.recipient, blockNumber: proof.blockNumber === null ? null : BigInt(proof.blockNumber),
        blockTimestamp: proof.blockTimestamp, source: params.source,
      } });
      return this.result(row, proof);
    }
    const row = await applyProof(this.prisma, existing, proof, now);
    return this.result(row, proof);
  }

  /** A client says "this transaction is mine". Stored as a hint for the admin:
   * no chain call, no attribution, no lock on the transfer, no amount echoed.
   * Several clients may claim the same hash; none blocks another. */
  async submitClaim(params: { userId: string; txHash: string; asset: string }): Promise<{ status: 'SUBMITTED' }> {
    if (isTestAssetPairOrSymbol(params.asset)) throw new DepositVerificationError(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    const txHash = this.canonicalHash(params.txHash), asset = params.asset.toUpperCase();
    await this.prisma.depositClaim.upsert({
      where: { userId_chain_txHash: { userId: params.userId, chain: this.chainConfig.chain, txHash } },
      create: { userId: params.userId, chain: this.chainConfig.chain, txHash, asset },
      update: {},
    });
    return { status: 'SUBMITTED' };
  }

  private result(row: Deposit, proof: TransferProof | null): ObservationResult {
    return {
      recorded: true, depositId: row.id, status: row.status, amount: new BigNumber(row.amount.toString()).toFixed(),
      confirmations: proof?.confirmations ?? row.confirmations, finalized: proof?.finalized ?? row.finalized,
      blockTimestamp: (proof?.blockTimestamp ?? row.blockTimestamp)?.toISOString() ?? null,
      recipient: proof?.recipient ?? row.recipientAddress ?? this.chainConfig.treasuryAddress,
    };
  }
}

/**
 * Store a fresh proof on an existing uncredited row, guarded by its revision
 * so a concurrent attribution/credit is never overwritten.
 *   - Unproven row (observed from a feed): the proven amount replaces the
 *     listed one — it was never creditable before being proven.
 *   - Proven row whose proven amount now differs: flagged NEEDS_REVIEW.
 * revision is bumped only when something material changed.
 */
export async function applyProof(db: PrismaClient, row: Deposit, proof: TransferProof, now = new Date()): Promise<Deposit> {
  const proven = proof.amount.toFixed();
  const mismatch = row.verifiedAt !== null && !new BigNumber(row.amount.toString()).isEqualTo(proof.amount);
  const data = mismatch
    ? { verifyError: `Verified amount ${proven} differs from recorded ${new BigNumber(row.amount.toString()).toFixed()}`, lastVerifyAttemptAt: now }
    : {
      amount: proven, confirmations: proof.confirmations, finalized: proof.finalized, verifiedAt: now,
      lastVerifyAttemptAt: now, verifyError: null, recipientAddress: proof.recipient,
      blockNumber: proof.blockNumber === null ? row.blockNumber : BigInt(proof.blockNumber),
      blockTimestamp: proof.blockTimestamp ?? row.blockTimestamp,
    };
  // Once a row is proven final, a deeper confirmation count is not material:
  // it must not invalidate a package an admin is reviewing.
  const material = mismatch || row.verifiedAt === null || row.verifyError !== null
    || !new BigNumber(row.amount.toString()).isEqualTo(proof.amount)
    || row.finalized !== proof.finalized || (!row.finalized && row.confirmations !== proof.confirmations);
  const updated = await db.deposit.updateMany({
    where: { id: row.id, revision: row.revision, deletedUserId: null, status: { not: 'CREDITED' }, batchId: null },
    data: { ...data, ...(material ? { revision: { increment: 1 } } : {}) },
  });
  if (updated.count === 0) return (await db.deposit.findUnique({ where: { id: row.id } })) ?? row;
  return (await db.deposit.findUnique({ where: { id: row.id } }))!;
}

/** Record that a proof attempt failed. Provider trouble changes nothing.
 * "Not found" becomes a review flag only after repeated misses over time;
 * a definitive answer (wrong recipient/contract, failed tx) flags at once. */
export async function recordProofFailure(db: PrismaClient, row: Deposit, error: unknown, now = new Date()): Promise<'provider' | 'retry' | 'flagged'> {
  if (error instanceof ProviderUnavailableError || !(error instanceof DepositVerificationError)) return 'provider';
  const attempts = row.verifyAttempts + 1;
  const firstSeenAgeMs = now.getTime() - row.createdAt.getTime();
  const flag = !(error instanceof TransferNotFoundError) || (attempts >= 5 && firstSeenAgeMs > 30 * 60_000);
  await db.deposit.updateMany({
    where: { id: row.id, revision: row.revision, deletedUserId: null, status: { not: 'CREDITED' }, batchId: null },
    data: { verifyAttempts: attempts, lastVerifyAttemptAt: now,
      ...(flag ? { verifyError: error.message.slice(0, 300), revision: { increment: 1 } } : {}) },
  });
  return flag ? 'flagged' : 'retry';
}
