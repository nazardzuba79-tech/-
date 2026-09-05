export const SYNTHETIC_COPY_CONFIG = {
  stateId: 'nazara-v1',
  seed: 20260902,
  initialCapital: 100_000,
  initialHistoryDays: 90,
  // 729 wins / 750 trades = exactly 97.2% in the fresh 90-day scenario.
  initialTradeCount: 750,
  targetWinRate: 0.972,
  minWinRate: 0.965,
  maxWinRate: 0.98,
  // Only the initial 90-day scenario total is calibrated. Shorter ROI and
  // drawdown values must follow its ledger, not conflicting window targets.
  targetRoi90: 8.41,
  minRoi90: 8,
  maxRoi90: 9.2,
  targetProfitFactor: 4.6,
  minProfitFactor: 3.5,
  maxProfitFactor: 6,
  tradesPerDay: { min: 4, max: 12 },
  winningRiskR: { min: 0.65, max: 1.08 },
  losingRiskR: { min: -1.38, max: -0.9 },
  followerCount: 32,
  symbols: [
    { symbol: 'BTCUSDT', weight: 30, price: 62_000 },
    { symbol: 'ETHUSDT', weight: 24, price: 2_450 },
    { symbol: 'SOLUSDT', weight: 15, price: 145 },
    { symbol: 'XRPUSDT', weight: 9, price: 0.58 },
    { symbol: 'BNBUSDT', weight: 9, price: 570 },
    { symbol: 'SUIUSDT', weight: 5, price: 0.92 },
    { symbol: 'DOGEUSDT', weight: 5, price: 0.11 },
    { symbol: 'TONUSDT', weight: 3, price: 5.4 },
  ],
} as const;

export type SyntheticCopyConfig = typeof SYNTHETIC_COPY_CONFIG;
