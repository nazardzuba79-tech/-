export class DepositVerificationError extends Error {}

/** The provider could not answer (network, timeout, HTTP 429/5xx, malformed
 * body). Says nothing about the transfer itself: never "no deposit", never a
 * reason to flag a transfer, never an empty success. */
export class ProviderUnavailableError extends DepositVerificationError {
  constructor(message: string, readonly retryAfterMs: number | null = null) { super(message); }
}

/** The chain does not (yet) show this transaction. Can be temporary right
 * after a send; repeated over time it becomes a definitive problem. */
export class TransferNotFoundError extends DepositVerificationError {}
