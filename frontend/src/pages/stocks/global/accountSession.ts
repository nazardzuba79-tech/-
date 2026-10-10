// Requests begun under an earlier login may finish after the next login.
// Fence reads AND writes without exposing credentials in ledger or browser storage keys.
export class StockSessionFence {
  private generation = 0;
  constructor(private readonly credential: () => string | null) {}
  invalidate() { this.generation++; }
  capture() {
    const generation = this.generation, credential = this.credential();
    const headers: Record<string, string> = credential ? { Authorization: `Bearer ${credential}` } : {};
    return {
      headers,
      current: () => generation === this.generation && credential === this.credential(),
    };
  }
}
export const pendingOrderKey = (accountId?: string) => `voltex.stocks.global.pending.v2.${accountId || 'legacy'}`;
