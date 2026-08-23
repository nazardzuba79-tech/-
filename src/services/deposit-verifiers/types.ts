import BigNumber from 'bignumber.js';

/** One recent transfer to the treasury address, for the admin's manual-credit
 * feed — display-only. Confirmations here are best-effort; the authoritative
 * check happens again in verify() at the moment an admin actually credits it,
 * so a stale/approximate number here can never cause a bad credit. */
export interface IncomingTransfer {
  txHash: string;
  asset: string;
  amount: string;
  confirmations: number;
}

/** One implementation per ChainType — see createVerifier() in index.ts. */
export interface DepositVerifier {
  /**
   * Verifies on-chain that `txHash` actually paid the configured treasury
   * address in `asset`, and returns how much and how many confirmations it
   * currently has. Throws DepositVerificationError for anything that means
   * the deposit can't be credited (not found, wrong recipient, wrong asset).
   */
  verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }>;

  /**
   * Recent transfers TO the treasury address, across every configured asset
   * on this chain — powers the admin deposits feed (no client-submitted tx
   * hash needed). Best-effort: a provider error here should surface to the
   * caller, not silently return an empty list, so the admin knows the feed
   * is incomplete rather than assuming "no new deposits".
   */
  listIncoming(): Promise<IncomingTransfer[]>;
}
