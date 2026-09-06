/** Price-axis display precision, not an exchange tick or order-price rule.
 * Candle API supplies OHLC but no tick size. Keep at least six significant
 * digits of the smallest actual positive quote, with the normal two-decimal
 * floor for larger prices. No candle or indicator value is rounded here.
 */
export function spotChartPriceFormat(candles: readonly { open: number; high: number; low: number; close: number }[]) {
  let reference = Infinity;
  for (const candle of candles) for (const price of [candle.open, candle.high, candle.low, candle.close]) {
    if (Number.isFinite(price) && price > 0) reference = Math.min(reference, price);
  }
  if (!Number.isFinite(reference)) return null;
  const precision = Math.min(20, Math.max(2, 5 - Math.floor(Math.log10(reference))));
  return { type: 'price' as const, precision, minMove: 10 ** -precision, base: 10 ** precision };
}
