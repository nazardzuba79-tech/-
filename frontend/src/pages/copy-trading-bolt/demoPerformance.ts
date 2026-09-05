import type { ChartData, Period, Trader } from './traders';

/**
 * ILLUSTRATIVE CATALOGUE DATA, NOT VERIFIED INVESTMENT RETURNS.
 *
 * The non-Nazara aliases have ROI inputs, not a trade ledger. This model gives
 * each alias one fixed, normalized daily equity history consistent with those
 * inputs. It cannot establish trade win rates, fees, fills or follower profit.
 * Nazara must continue using the existing backend synthetic ledger instead.
 */
export const DEMO_PERFORMANCE_AS_OF = '2026-09-05';
export const DEMO_PERFORMANCE_SOURCE = 'illustrative-catalogue' as const;
export type DemoCurveStyle = 'steady' | 'choppy' | 'breakout' | 'recovery';
export type DemoEquityPoint = Readonly<{ day: number; date: string; equity: number }>;

export type DemoPerformance = {
  source: typeof DEMO_PERFORMANCE_SOURCE;
  style: DemoCurveStyle;
  period: Period;
  equity: readonly DemoEquityPoint[];
  /** Normalized growth of 10,000 units, not an actual account balance. */
  rebasedEquity: number[];
  dailyReturns: number[];
  roi: number;
  maximumDrawdown: number;
  annualizedVolatility: number;
  /** Zero risk-free rate, 365 daily observations per annualization year. */
  sharpe: number | null;
  /** Zero target return; downside deviation includes all daily observations. */
  sortino: number | null;
  tradingDays: number;
};

const DAY_MS = 86_400_000;
const INITIAL_EQUITY = 10_000;
const WINDOWS: Record<Exclude<Period, 'ALL'>, number> = { '7D': 7, '30D': 30, '90D': 90 };
const historyCache = new Map<string, readonly DemoEquityPoint[]>();

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function randomSequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Presentation character only: no independent return targets are added here. */
export function demoCurveStyle(trader: Trader): DemoCurveStyle {
  if (['VX-003', 'VX-007', 'VX-010', 'VX-015', 'VX-025', 'VX-027', 'VX-030'].includes(trader.id)) return 'breakout';
  if (['VX-012', 'VX-019', 'VX-021', 'VX-028'].includes(trader.id)) return 'recovery';
  if (trader.category === 'futures' || trader.category === 'swing' || trader.risk === 'Very High') return 'choppy';
  return 'steady';
}

function assertCatalogueTrader(trader: Trader) {
  if (trader.id === 'VX-001') throw new Error('Nazara must use its existing synthetic trade ledger, not the catalogue curve model.');
  if (![trader.roiAll, trader.roi90, trader.roi30, trader.roi7].every(value => Number.isFinite(value) && value > -100)
    || !Number.isFinite(trader.activeMonths) || trader.activeMonths <= 0) {
    throw new Error('Illustrative catalogue history requires positive duration and finite ROI greater than -100%.');
  }
}

/** Fixed snapshot: Date.now() is deliberately never used to rewrite old history. */
export function getDemoEquityHistory(trader: Trader): readonly DemoEquityPoint[] {
  assertCatalogueTrader(trader);
  const style = demoCurveStyle(trader);
  const cacheKey = [trader.id, trader.activeMonths, trader.roiAll, trader.roi90, trader.roi30, trader.roi7, trader.risk, style].join('|');
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;

  const totalDays = Math.max(90, Math.round(trader.activeMonths * 30.44));
  const endEquity = INITIAL_EQUITY * (1 + trader.roiAll / 100);
  const anchors = [
    { day: 0, equity: INITIAL_EQUITY },
    { day: totalDays - 90, equity: endEquity / (1 + trader.roi90 / 100) },
    { day: totalDays - 30, equity: endEquity / (1 + trader.roi30 / 100) },
    { day: totalDays - 7, equity: endEquity / (1 + trader.roi7 / 100) },
    { day: totalDays, equity: endEquity },
  ].filter((point, index, values) => {
    if (index && point.day === values[index - 1].day) {
      if (Math.abs(point.equity - values[index - 1].equity) > 1e-7) {
        throw new Error('ALL and 90D anchors disagree for a catalogue history of 90 days or less.');
      }
      return false;
    }
    return true;
  });

  const random = randomSequence(hash(`${trader.id}:catalogue-history-v1`));
  // The daily signed variation must exceed the drift on some sessions even
  // for a strongly profitable book. The prior tiny noise made steady aliases
  // monotonic, falsely giving them zero drawdown and extreme Sharpe ratios.
  // This changes the actual equity path, never a displayed metric or its cap.
  const riskNoise = { Low: 0.018, Moderate: 0.075, High: 0.11, 'Very High': 0.14 }[trader.risk];
  const noiseAmplitude = riskNoise * ({ steady: 0.7, choppy: 1.2, breakout: 0.25, recovery: 0.8 }[style]);
  const asOf = Date.parse(`${DEMO_PERFORMANCE_AS_OF}T00:00:00Z`);
  const dateForDay = (day: number) => new Date(asOf - (totalDays - day) * DAY_MS).toISOString().slice(0, 10);
  const history: DemoEquityPoint[] = [Object.freeze({ day: 0, date: dateForDay(0), equity: INITIAL_EQUITY })];

  for (let segment = 1; segment < anchors.length; segment++) {
    const start = anchors[segment - 1];
    const end = anchors[segment];
    const length = end.day - start.day;
    const logReturn = Math.log(end.equity / start.equity);
    // Bursts differ by alias and segment; there is no shared last-day spike.
    const burstCenter = (0.2 + random() * 0.6) * Math.max(0, length - 1);
    const burstWidth = 0.65 + random() * 0.55;
    const phase = random() * Math.PI * 2;
    const weights = Array.from({ length }, (_, day) => {
      const base = 0.7 + random() * 0.6 + Math.sin(day * 0.43 + phase) * 0.15;
      if (style !== 'breakout' || length < 20) return base;
      return base * 0.12 + 18 * Math.exp(-0.5 * ((day - burstCenter) / burstWidth) ** 2);
    });
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const noise = weights.map(() => (random() - 0.5) * noiseAmplitude);
    const noiseMean = noise.reduce((sum, value) => sum + value, 0) / length;
    let cumulativeLog = 0;
    for (let day = 1; day <= length; day++) {
      cumulativeLog += logReturn * weights[day - 1] / weightTotal + noise[day - 1] - noiseMean;
      // A bounded temporary setback returns exactly to zero at each anchor.
      const recovery = style === 'recovery' ? -Math.sqrt(riskNoise) * 0.2 * Math.sin(Math.PI * day / length) ** 2 : 0;
      const equity = day === length ? end.equity : start.equity * Math.exp(cumulativeLog + recovery);
      history.push(Object.freeze({ day: start.day + day, date: dateForDay(start.day + day), equity }));
    }
  }
  const immutableHistory = Object.freeze(history);
  historyCache.set(cacheKey, immutableHistory);
  return immutableHistory;
}

/** Every period is a tail slice of the exact same equity points, never regenerated. */
export function selectDemoPerformance(trader: Trader, period: Period): DemoPerformance {
  const fullHistory = getDemoEquityHistory(trader);
  const equity = period === 'ALL' ? fullHistory : fullHistory.slice(-WINDOWS[period] - 1);
  const opening = equity[0].equity;
  const closing = equity[equity.length - 1].equity;
  const dailyReturns = equity.slice(1).map((point, index) => point.equity / equity[index].equity - 1);
  const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (dailyReturns.length - 1) : 0;
  const deviation = Math.sqrt(variance);
  const downside = Math.sqrt(dailyReturns.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / dailyReturns.length);
  let peak = opening;
  let drawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.equity);
    drawdown = Math.max(drawdown, (peak - point.equity) / peak);
  }
  return {
    source: DEMO_PERFORMANCE_SOURCE,
    style: demoCurveStyle(trader), period, equity,
    rebasedEquity: equity.map(point => point.equity / opening * INITIAL_EQUITY),
    dailyReturns,
    roi: (closing / opening - 1) * 100,
    maximumDrawdown: drawdown * 100,
    annualizedVolatility: deviation * Math.sqrt(365) * 100,
    sharpe: deviation > 1e-12 ? mean / deviation * Math.sqrt(365) : null,
    sortino: downside > 1e-12 ? mean / downside * Math.sqrt(365) : null,
    tradingDays: dailyReturns.length,
  };
}

/** Same normalized curve for both card and profile. No invented market/BTC lines. */
export function demoChartData(trader: Trader, period: Period): ChartData {
  const selected = selectDemoPerformance(trader, period);
  const values = selected.rebasedEquity;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = (high - low) * 0.1 || INITIAL_EQUITY * 0.01;
  const min = low - padding;
  const max = high + padding;
  const points = values.map((value, index) => ({ x: index / (values.length - 1) * 900, y: 245 - (value - min) / (max - min) * 225 }));
  const linePath = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  return {
    linePath, areaPath: `${linePath} L900 245 L0 245 Z`,
    marketPath: '', btcPath: '',
    yLabels: Array.from({ length: 4 }, (_, index) => `${Math.round(max - (max - min) * index / 3).toLocaleString('en-US')}`),
    xLabels: Array.from({ length: 6 }, (_, index) => {
      const date = selected.equity[Math.round(index / 5 * (selected.equity.length - 1))].date;
      return new Date(`${date}T00:00:00Z`).toLocaleDateString('ru-RU', {
        day: '2-digit', month: '2-digit', ...(period === 'ALL' ? { year: 'numeric' as const } : {}), timeZone: 'UTC',
      });
    }),
    endY: points[points.length - 1].y,
  };
}
