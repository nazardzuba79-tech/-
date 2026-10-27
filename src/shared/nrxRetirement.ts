/** NRX is retired. Historical balances/audit rows stay intact; no new orders. */
export function isRetiredNrx(value: string): boolean {
  const normalized = value.trim().toUpperCase().replace(/[\s/_-]/g, '');
  return normalized === 'NRX' || normalized === 'NRXUSDT';
}
export const NRX_RETIRED_MESSAGE = 'NRX is no longer available for trading.';
