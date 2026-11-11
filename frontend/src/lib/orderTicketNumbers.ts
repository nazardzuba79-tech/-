import BigNumber from 'bignumber.js';
import { readDecimalInput } from './decimalInput';

/** Drafts belong to the input, not to a formatted monetary display. */
export function orderDecimal(raw: string): string | null {
  const parsed = readDecimalInput(raw);
  return parsed.status === 'valid' ? parsed.value : null;
}

export function ticketTotal(quantity: string, price: number): string {
  const amount = orderDecimal(quantity);
  if (amount === null || !Number.isFinite(price) || price <= 0) return '';
  return new BigNumber(amount).times(price).toFixed();
}

/** Input estimate only; the existing execution engine still owns settlement. */
export function ticketQuantity(total: string, price: number): string {
  const amount = orderDecimal(total);
  if (amount === null || !Number.isFinite(price) || price <= 0) return '';
  return new BigNumber(amount).div(price).decimalPlaces(8, BigNumber.ROUND_DOWN).toFixed();
}
