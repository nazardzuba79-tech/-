/**
 * Numeric normalisation of BestChange rate rows for «Обменники».
 *
 * The OpenAPI spec types `rate` as a number and `rankrate`, `reserve`, `inmin`,
 * `inmax` as strings, and does not document which way `rate` is oriented.
 */

/**
 * A BestChange numeric field (number, or a plain decimal string such as
 * "95.12" / "1e-5") as a finite number, or null. No locale commas, no hex,
 * no whitespace, no Infinity/NaN.
 */
export function parseBcDecimal(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return null;
  if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * RUB paid per 1 unit of crypto, from a BestChange RUB→crypto `rate`/`rankrate`.
 *
 * Why the orientation is unambiguous: every supported receive asset (USDT, USDC,
 * BTC, ETH, TRX, TON, LTC, SOL) is worth more than 1 RUB. So a RUB→crypto value
 * below 1 can only be "crypto per 1 RUB" (e.g. 0.0105 USDT/RUB) and is inverted,
 * while a value of 1 or more can only be "RUB per 1 crypto" (e.g. 95.12) and is
 * kept. Non-finite, zero or negative values (and unparsable strings) → null, and
 * the caller drops the row.
 */
export function rubPerUnit(value: unknown): number | null {
  const n = parseBcDecimal(value);
  if (n === null || !(n > 0)) return null;
  const out = n < 1 ? 1 / n : n;
  return Number.isFinite(out) && out > 0 ? out : null;
}

/** Units of crypto received for `amountRub` at `rubPerUnitValue`; null when either is unusable. */
export function receiveAmountFor(amountRub: number, rubPerUnitValue: number | null): number | null {
  if (rubPerUnitValue === null || !Number.isFinite(rubPerUnitValue) || !(rubPerUnitValue > 0)) return null;
  if (!Number.isFinite(amountRub) || !(amountRub > 0)) return null;
  const out = amountRub / rubPerUnitValue;
  return Number.isFinite(out) ? out : null;
}
