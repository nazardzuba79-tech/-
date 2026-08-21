import BigNumber from 'bignumber.js';

/** One implementation per ChainType — see createVerifier() in index.ts. */
export interface DepositVerifier {
  /**
   * Verifies on-chain that `txHash` actually paid the configured treasury
   * address in `asset`, and returns how much and how many confirmations it
   * currently has. Throws DepositVerificationError for anything that means
   * the deposit can't be credited (not found, wrong recipient, wrong asset).
   */
  verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }>;
}
