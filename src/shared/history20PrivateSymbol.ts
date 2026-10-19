/**
 * The reserved tickers of History20 private-test markets, VHX01…VHX99 (as the
 * VHX-NN scenario ids). Pure, so the restricted-asset guards (Render), the
 * listing rules and the Worker can share it: a reserved base stays restricted
 * while its listing is cold, stale, withheld or unpublished.
 */
export const HISTORY20_PRIVATE_SYMBOL = /^VHX\d{2}$/;

/** The restricted settlement unit every private-test market is quoted in. */
export const SIMULATION_QUOTE = 'SIMUSDT' as const;

export const isHistory20PrivateSymbol = (symbol: string): boolean => HISTORY20_PRIVATE_SYMBOL.test(symbol.trim().toUpperCase());
