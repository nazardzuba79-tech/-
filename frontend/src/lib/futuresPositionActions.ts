/** Display precision only. Closing always uses the position ID and server size. */
export function formatPositionQuantity(size: string, symbol: string): string {
  if (symbol.split('/')[0] !== 'BTC') return size;
  const value = Number(size);
  return size.trim() && Number.isFinite(value) ? value.toFixed(3) : '—';
}
