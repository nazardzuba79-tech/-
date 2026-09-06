/** Input estimates only: the unchanged backend validates/executes all orders. */
export function positiveOrderNumber(value: string | number | null): number | null {
  if (value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function orderFundingPrice(family: string, execution: string, price: string, trigger: string, takeProfit: string, stopLimit: string, market: number | null): number {
  if (family === 'OCO') return Math.max(positiveOrderNumber(takeProfit) ?? 0, positiveOrderNumber(stopLimit) ?? 0);
  if (family === 'LIMIT' || (family !== 'MARKET' && execution === 'LIMIT')) return positiveOrderNumber(price) ?? 0;
  // The existing OrderService reserves 2% for BUY market execution. Not a fee.
  const reference = family === 'MARKET' ? positiveOrderNumber(market) : positiveOrderNumber(trigger);
  if (reference === null) return 0;
  const exact = decimalRatio(reference);
  const numerator = exact.numerator * 102n;
  const denominator = exact.denominator * 100n;
  const scale = denominator.toString().length - 1;
  const digits = numerator.toString().padStart(scale + 1, '0');
  let funding = Number(`${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
  if (!Number.isFinite(funding) || funding === 0) return funding;
  // Decimal 2% reservation must not become slightly smaller through binary
  // arithmetic. Round the input estimate up only if its decimal representation
  // is below the exact reservation used by OrderService.
  const represented = decimalRatio(funding);
  if (represented.numerator * denominator < numerator * represented.denominator) {
    funding += Math.max(Number.MIN_VALUE, funding * Number.EPSILON);
  }
  return funding;
}

export function balancePercentageQuantity(balance: number, percent: number, price = 1): string {
  if (!Number.isFinite(balance) || balance < 0 || !Number.isFinite(percent) || !Number.isFinite(price) || price <= 0) return '';
  // Convert the actual input decimals (including scientific notation) before
  // arithmetic. Floating-point multiply/floor can round a tiny-token 100%
  // quantity UP and cause the unchanged backend to reject its funding cost.
  const funds = decimalRatio(balance);
  const share = decimalRatio(Math.min(100, Math.max(0, percent)));
  const fundingPrice = decimalRatio(price);
  const units = funds.numerator * share.numerator * fundingPrice.denominator * 100000000n
    / (funds.denominator * share.denominator * fundingPrice.numerator * 100n);
  // Integer division floors nonnegative values exactly to eight input decimals.
  // This changes neither backend financial precision nor settlement rules.
  return `${units / 100000000n}.${(units % 100000000n).toString().padStart(8, '0')}`;
}

function decimalRatio(value: number): { numerator: bigint; denominator: bigint } {
  const [mantissa, exponent = '0'] = value.toString().split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  const coefficient = BigInt(integer + fraction);
  const scale = fraction.length - Number(exponent);
  return scale >= 0
    ? { numerator: coefficient, denominator: 10n ** BigInt(scale) }
    : { numerator: coefficient * 10n ** BigInt(-scale), denominator: 1n };
}
