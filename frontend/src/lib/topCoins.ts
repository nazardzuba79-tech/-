// A curated allowlist of well-established coins, used to keep the
// top-gainers ticker to recognizable large/mid-cap assets instead of
// obscure microcaps. This is NOT a live CoinMarketCap top-500 ranking —
// no CMC/market-cap data source is wired into this app (only Kraken, for
// prices) — it's a static, honestly-approximate stand-in covering the
// coins that would realistically appear in a real top-500-by-market-cap
// list and that Kraken actually lists. Revisit if/when a real market-cap
// feed gets integrated.
export const TOP_COINS = new Set([
  'BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'USDC', 'ADA', 'DOGE', 'TRX',
  'TON', 'AVAX', 'SHIB', 'DOT', 'LINK', 'BCH', 'NEAR', 'LTC', 'MATIC', 'ICP',
  'DAI', 'UNI', 'LEO', 'ETC', 'XLM', 'ATOM', 'XMR', 'OKB', 'FIL', 'HBAR',
  'APT', 'CRO', 'IMX', 'ARB', 'VET', 'OP', 'MKR', 'INJ', 'RUNE', 'GRT',
  'AAVE', 'ALGO', 'QNT', 'SAND', 'MANA', 'EGLD', 'FLOW', 'THETA', 'XTZ', 'EOS',
  'AXS', 'CHZ', 'KAVA', 'NEO', 'FTM', 'ZEC', 'DASH', 'COMP', 'SNX', 'ENJ',
  'CAKE', 'GALA', 'CRV', 'LDO', 'STX', 'RPL', 'KSM', 'BAT', 'ZIL', 'ONE',
  'WAVES', 'IOTA', '1INCH', 'SUSHI', 'YFI', 'ANKR', 'CELO', 'GMX', 'DYDX', 'BLUR',
  'PEPE', 'WIF', 'BONK', 'FLOKI', 'SUI', 'SEI', 'TIA', 'JUP', 'PYTH', 'STRK',
  'ORDI', 'RNDR', 'FET', 'AGIX', 'OCEAN', 'AR', 'MINA', 'ROSE', 'GLMR', 'ASTR',
  'KDA', 'ZRX', 'BAL', 'REN', 'STORJ', 'SKL', 'CTSI', 'API3', 'BAND', 'OXT',
  'NANO', 'ICX', 'ONT', 'QTUM', 'SC', 'DGB', 'RVN', 'ZEN', 'LSK', 'ARDR',
]);
