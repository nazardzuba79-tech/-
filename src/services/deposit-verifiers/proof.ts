import BigNumber from 'bignumber.js';

/** What one on-chain check proved about one transaction's payment to one
 * treasury address in one asset. Every field is measured, none assumed. */
export interface TransferProof {
  amount: BigNumber;
  /** Measured from the chain head; never a configured placeholder. */
  confirmations: number;
  blockNumber: number | null;
  /** Block time as reported by the chain; null when not reported. */
  blockTimestamp: Date | null;
  /** The network's own irreversibility signal (TRON: solidified block).
   * Chains without such a signal set it from confirmations >= minimum. */
  finalized: boolean;
  /** Recipient the proof was checked against. */
  recipient: string;
}

/** Contracts this exchange accepts per network. A token called "USDT" at any
 * other address is not USDT. Mainnet only: the TRON USDT contract below does
 * not exist on the Shasta/Nile test networks. */
export const ALLOWLISTED_TOKENS: Record<string, Record<string, { contract: string; decimals: number }>> = {
  tron: { USDT: { contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 } },
};
