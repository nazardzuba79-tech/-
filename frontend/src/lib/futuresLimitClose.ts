/**
 * Quantity precision of the «Лимитный» (limit close) dialog.
 *
 * With the contract's rules the dialog follows them exactly. Without them —
 * the real engine publishes none — the dialog used to take the position's
 * OWN decimals as the quantity step, so a 0.01 BTC position had a step of
 * 0.01 and the 25 %/50 % stops rounded a partial close down to 0 (2026-10-13
 * audit; the owner's «partial close through Limit» report). A share of the
 * position may legitimately be finer than the size it is cut from: here it
 * keeps three decimals beyond the size's own (capped at eight), while the
 * ± keys still move by one unit of the size, and the engine validates the
 * rest.
 */
export interface LimitClosePrecision {
  /** Decimals a quantity is written and validated with. */
  qtyDecimals: number;
  /** The grid a quantity must sit on (the contract's step, or 10^-qtyDecimals). */
  step: number;
  /** What the ± keys add or remove. */
  nudgeStep: number;
}

export const decimalsOf = (value: string | number | null | undefined): number =>
  value === null || value === undefined ? 0 : (String(value).split('.')[1] ?? '').length;

const unitOf = (decimals: number) => Number((10 ** -decimals).toFixed(decimals));

export function limitClosePrecision(size: string | number, qtyStep: string | number | null | undefined): LimitClosePrecision {
  if (qtyStep !== null && qtyStep !== undefined && Number(qtyStep) > 0) {
    const qtyDecimals = Math.min(8, decimalsOf(qtyStep));
    return { qtyDecimals, step: Number(qtyStep), nudgeStep: Number(qtyStep) };
  }
  const sizeDecimals = Math.min(8, decimalsOf(size));
  const qtyDecimals = Math.min(8, sizeDecimals + 3);
  return { qtyDecimals, step: unitOf(qtyDecimals), nudgeStep: unitOf(sizeDecimals) };
}

/** A quantity the way the engine spells it: `7`, `0.23`, `3750000` — the
 *  precision without trailing zeros. */
export function quantityText(value: number, qtyDecimals: number): string {
  return value.toFixed(qtyDecimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** `pct` % of the position, rounded DOWN onto the step so a 50 % close of an
 *  odd size never asks for more than exists; 100 % is the size itself. */
export function shareOfPosition(size: string, pct: number, precision: LimitClosePrecision): string {
  if (pct >= 100) return size;
  const raw = Number(size) * (pct / 100);
  if (!(precision.step > 0)) return quantityText(raw, precision.qtyDecimals);
  // Count the steps in integer units of the precision: `raw / step` alone is
  // not exact in binary floating point (0.005 / 0.00001 → 499.99999999999994),
  // and the share itself is floored, never rounded up, onto that grid.
  const unit = 10 ** precision.qtyDecimals;
  const rawUnits = Math.floor(raw * unit + 1e-6);
  const stepUnits = Math.max(1, Math.round(precision.step * unit));
  const steps = Math.floor(rawUnits / stepUnits);
  return quantityText((steps * stepUnits) / unit, precision.qtyDecimals);
}
