/** The suffix every History20 model contract carries, and no venue contract the engine trades does. */
export const HISTORY20_CONTRACT_SUFFIX = 'SIMUSDT';
/** Whether a native contract symbol (`VHXTSIMUSDT`, `VHXTSIM/USDT`) is a History20 model contract: a listing ticker, then the suffix. */
export const isHistory20Contract = (symbol: string) => {
  const normalized = symbol.replace(/[-/]USDT$/, 'USDT');
  return normalized.length > HISTORY20_CONTRACT_SUFFIX.length && normalized.endsWith(HISTORY20_CONTRACT_SUFFIX);
};
