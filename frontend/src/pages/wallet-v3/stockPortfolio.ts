import type { LedgerRow } from './useWalletData';
import type { State } from '../stocks/global/types';

function amount(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

/** Read-only projection. Stocks USDT is never silently treated as USD collateral. */
export function stockPortfolioRows(input: unknown, receivedAt = Date.now()): LedgerRow[] {
  if (!input || typeof input !== 'object') return [];
  const state = input as Partial<State>;
  if (state.schema !== 2 || state.account?.mode !== 'isolated-paper' || !state.positions) return [];
  const assets = new Map((state.catalogue ?? []).map(asset => [asset.id, asset]));
  const rows: LedgerRow[] = [];
  for (const position of Object.values(state.positions)) {
    if (!position || position.currency !== 'USDT') continue;
    const quantity = amount(position.quantity);
    if (quantity === null || quantity <= 0) continue;
    const instrumentId = position.instrumentId;
    if (typeof instrumentId !== 'string' || !instrumentId) continue;
    const asset = assets.get(instrumentId);
    const quote = state.quotes?.[instrumentId];
    const fresh = Boolean(quote && quote.status?.USDT === 'READY'
      && Number.isFinite(quote.timestamp) && quote.timestamp <= receivedAt
      && receivedAt - quote.timestamp <= 30_000);
    const mark = fresh ? amount(quote?.prices?.USDT?.sell) : null;
    const value = mark === null ? null : mark * quantity;
    const total = value !== null && Number.isFinite(value) ? value : null;
    const reserved = amount(position.reserved) ?? 0;
    const available = amount(position.available) ?? Math.max(0, quantity - reserved);
    rows.push({
      symbol: asset?.asset || asset?.ticker || instrumentId,
      name: asset?.name || instrumentId,
      total: quantity,
      walletBalance: quantity,
      available,
      locked: reserved,
      priceUsd: null,
      changePercent24h: null,
      valueUsd: null,
      spendable: false,
      collateralEnabled: false,
      collateralToggleable: false,
      priced: false,
      stockPosition: { instrumentId, entryUSDT: amount(position.average), valueUSDT: total, markAt: fresh ? (quote?.timestamp ?? null) : null },
    });
  }
  return rows;
}
