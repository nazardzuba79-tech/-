/**
 * The ONE display formatter for the P&L result card.
 *
 * Presentation only. Every value it receives is already frozen by the server
 * snapshot; nothing here rounds a number that anything downstream will compute
 * with, and nothing here is used by position, PnL, ROI, fee or liquidation
 * maths. It exists because the card used to print every price with a fixed two
 * decimals, which turned a real AKE entry of 0.0040783 into `0.00` — a price
 * that is not merely ugly but wrong, and the same rule made a sub-cent
 * contract indistinguishable from a zero.
 *
 * Prices therefore get ADAPTIVE precision, and the two figures that genuinely
 * are currency amounts — PnL in USDT and ROI in percent — keep their fixed two
 * decimals. One module, so a price cannot be formatted one way in one text
 * node and another way in the next.
 */

/** A finite number, or null for anything that cannot be shown as one. */
function finite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  // Reject anything that is not a plain decimal, exponent included: the card
  // must never print `1e-7`, so a value that only exists in that form is
  // rendered through the normal path below rather than passed through.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** Groups the integer part in thousands. The fraction is never grouped. */
function group(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A plain, ungrouped decimal string for `value` with EXACTLY `decimals`
 * places — never scientific notation, whatever the magnitude.
 *
 * `Intl.NumberFormat` rather than `toFixed`, for two independent reasons.
 *
 * ROUNDING: this card previously formatted through `privateNumber`, which is
 * `Intl`, and `Intl` rounds half away from zero while `toFixed` follows the
 * binary value. They disagree in the last place — a ROI of -0.575 shows as
 * -0.58 under one and -0.57 under the other. Changing which number a trader
 * sees is not a formatting change, so the rounding of the previous release is
 * kept exactly. A test pins that case.
 *
 * RANGE: at 1e21 and above `toFixed` returns `"1e+21"`, which then splits on
 * `.` into nonsense. `Intl` renders the full positional form at every
 * magnitude the card can reach. A test pins that too.
 */
function plain(value: number, decimals: number): string {
  const places = Math.max(0, Math.min(100, Math.trunc(decimals)));
  return new Intl.NumberFormat('en-US', {
    useGrouping: false, minimumFractionDigits: places, maximumFractionDigits: places,
  }).format(value);
}

/** Drops trailing fraction zeros, and the point when nothing is left. */
function trim(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** Splits a sign off a non-negative body, normalising -0 to 0. */
function split(value: number): { negative: boolean; magnitude: number } {
  // `-0 < 0` is false, so negative zero arrives here as positive and can
  // never print as "-0.00". Math.abs then removes the sign bit itself.
  const negative = value < 0;
  return { negative, magnitude: Math.abs(value) };
}

/**
 * A PRICE, with precision chosen from its magnitude.
 *
 * | magnitude        | rule                            | example                  |
 * |------------------|---------------------------------|--------------------------|
 * | >= 1000          | 2 decimals, grouped             | 85166.05315 -> 85,166.05 |
 * | >= 1 and < 1000  | up to 6 decimals, trimmed       | 100.000000 -> 100        |
 * | < 1              | 5 significant digits, trimmed   | 0.0040783 -> 0.0040783   |
 *
 * The sub-1 band counts significant digits rather than decimal places, which
 * is the whole point: 0.05, 0.004 and 0.0000012 need 2, 3 and 7 decimals
 * respectively to carry the same amount of information, and a single fixed
 * width cannot serve all three.
 */
export function cardPrice(value: unknown): string {
  const number = finite(value);
  if (number === null) return '—';
  const { negative, magnitude } = split(number);
  if (magnitude === 0) return '0';

  let body: string;
  if (magnitude >= 1000) {
    body = plain(magnitude, 2);
  } else if (magnitude >= 1) {
    body = trim(plain(magnitude, 6));
  } else {
    // Significant digits begin at the first non-zero decimal place. For
    // 0.0040783 that is the third, so 5 significant digits need 7 decimals.
    const leadingZeros = Math.max(0, -Math.floor(Math.log10(magnitude)) - 1);
    body = trim(plain(magnitude, leadingZeros + SIGNIFICANT_DIGITS_BELOW_ONE));
    // A value that rounds away entirely is not shown as a bare 0: that is the
    // original bug in a smaller font. Fall back to enough places to keep it.
    if (Number(body) === 0) body = trim(plain(magnitude, 18));
  }

  const [integer, fraction] = body.split('.');
  const grouped = fraction === undefined ? group(integer) : `${group(integer)}.${fraction}`;
  // Re-check the sign AFTER rounding so a value that became zero loses it.
  return negative && Number(body) !== 0 ? `-${grouped}` : grouped;
}
const SIGNIFICANT_DIGITS_BELOW_ONE = 5;

/**
 * A signed amount at exactly two decimals — PnL, in USDT.
 *
 * The sign is explicit because the card's whole subject is direction, but a
 * value that ROUNDS to zero gets no sign: `-0.00` states a loss the number
 * does not actually show.
 */
export function cardSignedAmount(value: unknown): string {
  const number = finite(value);
  if (number === null) return '—';
  const { negative, magnitude } = split(number);
  const body = plain(magnitude, 2);
  const [integer, fraction] = body.split('.');
  const grouped = `${group(integer)}.${fraction}`;
  if (Number(body) === 0) return grouped;
  return `${negative ? '-' : '+'}${grouped}`;
}

/** The same rule as `cardSignedAmount`, for ROI. The `%` is drawn separately. */
export const cardSignedPercent = cardSignedAmount;

/**
 * Leverage as a trader writes it: `10x`, never `10.00x`. A fractional
 * leverage keeps the places it actually uses.
 */
export function cardLeverage(value: unknown): string {
  const number = finite(value);
  if (number === null) return '—';
  const { negative, magnitude } = split(number);
  const body = trim(plain(magnitude, 2));
  const [integer, fraction] = body.split('.');
  const grouped = fraction === undefined ? group(integer) : `${group(integer)}.${fraction}`;
  return `${negative && Number(body) !== 0 ? '-' : ''}${grouped}x`;
}
