// Requests begun under an earlier login may finish after the next login.
// Fence reads AND writes without exposing credentials in ledger or browser storage keys.
export class StockSessionFence {
  private generation = 0;
  constructor(private readonly credential: () => string | null) {}
  invalidate() { this.generation++; }
  capture(eligible: () => boolean = () => true) {
    const generation = this.generation, credential = this.credential();
    const headers: Record<string, string> = credential ? { Authorization: `Bearer ${credential}` } : {};
    const current = () => generation === this.generation && credential === this.credential() && eligible();
    return {
      headers,
      current,
      reject: (clear: () => void) => { if (credential && current()) clear(); },
    };
  }
}
export const pendingOrderKey = (accountId?: string) => `voltex.stocks.global.pending.v2${accountId ? '.' + accountId : ''}`;

// Recovery reads never call this helper. An explicit repeat of the same order
// reuses its ID after an unknown outcome, scoped to the authenticated account.
export function rememberStockOrder(storage: Pick<Storage, 'getItem' | 'setItem'>, accountId: string | undefined,
  signature: string, createId: () => string) {
  const key = pendingOrderKey(accountId); let pending: { id: string; signature: string } | null = null;
  try { pending = JSON.parse(storage.getItem(key) || 'null'); } catch { /* Retain no malformed pending record. */ }
  if (pending?.signature !== signature || typeof pending.id !== 'string' || !pending.id) pending = { id: createId(), signature };
  storage.setItem(key, JSON.stringify(pending)); return { key, id: pending.id };
}
