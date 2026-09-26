import { PrismaClient, Prisma } from '@prisma/client';
import { ChainConfig } from '../../config/chains';
import { createVerifier, DepositVerificationError } from '../deposit-verifiers';
import { TronDepositVerifier } from '../deposit-verifiers/TronDepositVerifier';
import { TransferProof } from '../deposit-verifiers/proof';
import { tronAddressHex } from '../deposit-verifiers/tronAddress';

type Db = PrismaClient | Prisma.TransactionClient;

/** Canonical comparison form of an address on a chain. */
export function normalizeAddress(chain: ChainConfig['type'], address: string): string {
  if (chain === 'tron') return tronAddressHex(address) ?? `invalid:${address}`;
  if (chain === 'evm') return address.toLowerCase();
  return address;
}

/** Remember an address as one of this chain's treasury addresses (current or
 * past). Idempotent. Old addresses are never removed from history. */
export async function rememberTreasuryAddress(db: Db, chain: string, address: string): Promise<void> {
  if (!address) return;
  await db.treasuryAddressHistory.upsert({ where: { chain_address: { chain, address } }, create: { chain, address }, update: {} });
}

/** Every address this chain has used as treasury (current first). */
export async function treasuryAddresses(db: Db, config: ChainConfig): Promise<string[]> {
  const history = await db.treasuryAddressHistory.findMany({ where: { chain: config.chain }, orderBy: { firstSeenAt: 'asc' } });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of [config.treasuryAddress, ...history.map((h) => h.address)]) {
    const key = normalizeAddress(config.type, address);
    if (!address || seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

/** The recipient a stored transfer must be proven against: its recorded
 * address when that is (or was) one of ours, else the current treasury for
 * legacy rows that never recorded one. Anything else is refused. */
export async function recipientFor(db: Db, config: ChainConfig, recorded: string | null): Promise<string> {
  if (!recorded) return config.treasuryAddress;
  const wanted = normalizeAddress(config.type, recorded);
  const known = await treasuryAddresses(db, config);
  const match = known.find((a) => normalizeAddress(config.type, a) === wanted);
  if (!match) throw new DepositVerificationError('Recorded recipient is not a known treasury address');
  return match;
}

/**
 * One on-chain proof for any configured chain. TRON uses the node-level proof
 * (solidified block, SUCCESS receipt, decoded logs). The other chains reuse
 * their existing verifier; they report no irreversibility signal, so
 * `finalized` there means "confirmations >= the configured minimum" and they
 * are NOT covered by the watcher (manual/admin paths only).
 */
export async function proveTransfer(
  config: ChainConfig,
  txHash: string,
  asset: string,
  options: { recipient?: string; headBlock?: number; fetchFn?: typeof fetch } = {},
): Promise<TransferProof> {
  const recipient = options.recipient ?? config.treasuryAddress;
  if (config.type === 'tron') {
    return new TronDepositVerifier(config, options.fetchFn ?? fetch).prove(txHash, asset, { recipient, headBlock: options.headBlock });
  }
  const { amount, confirmations } = await createVerifier({ ...config, treasuryAddress: recipient }).verify(txHash, asset);
  return { amount, confirmations, blockNumber: null, blockTimestamp: null, finalized: confirmations >= config.minConfirmations, recipient };
}

/** Sanity limits on any proof before it is stored or credited. */
export function assertSaneProof(proof: TransferProof): void {
  if (!proof.amount.isFinite() || !proof.amount.isGreaterThan(0) || (proof.amount.decimalPlaces() ?? 0) > 18
    || !Number.isSafeInteger(proof.confirmations) || proof.confirmations < 0) {
    throw new DepositVerificationError('Invalid verified transfer');
  }
}
