import type { FinancialStatistics } from "../types/strategy";

/**
 * A separate illustrative trade sequence for the 24-month Thomas presentation.
 * It does NOT represent real orders, fills, backtests, account activity, or
 * independently verified performance.
 *
 * Assumptions: 1,000 hypothetical trades over two years; 971 winning, 29 losing
 * (97.1% winning); every losing trade has a -10% return on the then-current
 * notional account equity; the uniform positive trade return is SOLVED rather
 * than guessed so terminal compounded return equals the supplied scenario
 * aggregate, currently +7,348%. 25 single losses and one four-loss cluster
 * are explicitly scheduled below to make the sample reproducible.
 *
 * Sharpe and Sortino use 0% benchmark and 500 equal-spaced trades/year. This
 * is the convention for this constructed sample, NOT validated market risk.
 */
export const THOMAS_RISK_ASSUMPTIONS = {
  trades: 1000,
  years: 2,
  lossPerTrade: -0.10,
  riskFreePerTrade: 0,
} as const;

export function calculateThomasRiskScenario(
  monthlyReturns: readonly number[],
  exampleWinRate: number,
): FinancialStatistics | null {
  const { trades, years, lossPerTrade, riskFreePerTrade } = THOMAS_RISK_ASSUMPTIONS;
  if (monthlyReturns.length !== 24 || !monthlyReturns.every(Number.isFinite)
      || exampleWinRate !== 97.1) return null;

  const targetReturnPct = monthlyReturns.reduce((sum, month) => sum + month, 0);
  const terminalFactor = 1 + targetReturnPct / 100;
  const losingTrades = 29;
  const winningTrades = trades - losingTrades;
  if (terminalFactor <= 0) return null;

  const positiveReturn = Math.expm1(
    (Math.log(terminalFactor) - losingTrades * Math.log1p(lossPerTrade))
      / winningTrades,
  );
  if (!Number.isFinite(positiveReturn) || positiveReturn <= 0) return null;

  const lossPositions = new Set([
    ...Array.from({ length: 25 }, (_, index) => 15 + index * 37),
    700, 701, 702, 703,
  ]);
  if (lossPositions.size !== losingTrades) return null;

  let capital = 100;
  let peak = capital;
  let maxDrawdownPct = 0;
  let maxDrawdownCapital = 0;
  let grossProfits = 0;
  let grossLosses = 0;
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let sum = 0;
  let sumSquared = 0;
  let sumDownsideSquares = 0;

  for (let index = 0; index < trades; index++) {
    const losing = lossPositions.has(index);
    const tradeReturn = losing ? lossPerTrade : positiveReturn;
    const cashPnl = capital * tradeReturn;

    if (cashPnl > 0) grossProfits += cashPnl;
    else grossLosses -= cashPnl;

    capital += cashPnl;
    peak = Math.max(peak, capital);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peak - capital) / peak);
    maxDrawdownCapital = Math.max(maxDrawdownCapital, peak - capital);

    sum += tradeReturn;
    sumSquared += tradeReturn * tradeReturn;
    const downside = Math.min(0, tradeReturn - riskFreePerTrade);
    sumDownsideSquares += downside * downside;

    if (losing) {
      consecutiveLosses++;
      consecutiveWins = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    } else {
      consecutiveWins++;
      consecutiveLosses = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
    }
  }

  const mean = sum / trades;
  const sampleVariance = Math.max(0, (sumSquared - trades * mean * mean) / (trades - 1));
  const sampleStd = Math.sqrt(sampleVariance);
  const downsideDeviation = Math.sqrt(sumDownsideSquares / trades);
  const annualization = Math.sqrt(trades / years);
  const cagr = (capital / 100) ** (1 / years) - 1;

  if (sampleStd === 0 || downsideDeviation === 0 || grossLosses === 0
      || maxDrawdownPct === 0 || maxDrawdownCapital === 0) return null;

  return {
    sharpeRatio: (mean - riskFreePerTrade) / sampleStd * annualization,
    sortinoRatio: (mean - riskFreePerTrade) / downsideDeviation * annualization,
    calmarRatio: cagr / maxDrawdownPct,
    profitFactor: grossProfits / grossLosses,
    recoveryFactor: (capital - 100) / maxDrawdownCapital,
    annualizedVolatility: sampleStd * annualization * 100,
    avgWinPct: positiveReturn * 100,
    avgLossPct: lossPerTrade * 100,
    expectancyPct: mean * 100,
    maxConsecutiveWins,
    maxConsecutiveLosses,
  };
}
