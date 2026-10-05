/**
 * One deposit window per page.
 *
 * The header owns the deposit dialog. Other buttons on the same page — the
 * Futures account block's «Депозит» — ask the header to open it instead of
 * navigating to the Wallet, so the trader keeps the pair, leverage and the
 * draft on screen and gets the very same dialog the header button opens.
 *
 * Nothing here fetches, stores or logs anything: it only says "open".
 */
export interface DepositRequest {
  /** A suggestion. The dialog uses it only if the catalogue lists that asset. */
  asset?: string;
}

type Listener = (request: DepositRequest) => void;
const listeners = new Set<Listener>();

export function onDepositRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Returns false when no dialog owner is mounted, so the caller can fall back. */
export function requestDeposit(request: DepositRequest = {}): boolean {
  if (!listeners.size) return false;
  for (const listener of [...listeners]) listener(request);
  return true;
}
