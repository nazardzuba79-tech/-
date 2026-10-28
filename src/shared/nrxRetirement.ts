/** NRX is retired. Historical balances/audit rows stay intact; no new orders. */
export function isRetiredNrx(value: string): boolean {
  const normalized = value.trim().toUpperCase().replace(/[_-]/g, '/');
  return normalized.split('/').some(symbol => symbol.trim() === 'NRX')
    || ['NRXUSDT', 'NRXSIMUSDT'].includes(normalized.replace(/\s/g, ''));
}
export const NRX_RETIRED_MESSAGE = 'NRX is no longer available for trading.';
