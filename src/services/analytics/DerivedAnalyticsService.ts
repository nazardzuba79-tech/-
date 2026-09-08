import type { MarketDataGateway } from '../marketData/MarketDataGateway';
import type { MarketCandle } from '../KrakenMarketDataService';
import type { CoinCategory, CoinRanking } from '../CoinGeckoService';
import type { CachedValue } from '../marketData/ProviderCache';
import { available, unavailable, type Availability } from '../marketData/types';

/**
 * Analytics that are DERIVED from data this system already fetches, not
 * bought from a new provider.
 *
 * Realized volatility, cross-asset correlation and sector performance are
 * all arithmetic over series the gateway is already caching for the
 * charts and the catalogue. That is the whole reason they can exist in
 * this phase with a zero-cost provider budget: no new vendor, no key, and
 * — critically — no extra provider sweep, because every read below goes
 * through the same cached gateway calls `/markets` and the terminals make.
 *
 * Two boundaries are load-bearing:
 *
 * **Derived is labelled derived.** Every value carries the series it came
 * from ("Derived from Kraken OHLC", "Derived from CoinGecko catalogue")
 * and the exact window and sample count. A statistic without its window is
 * not comparable with anything.
 *
 * **Realized is not implied.** Everything here is computed from realised
 * prices that already happened. Implied volatility needs an options
 * surface, which no configured provider supplies, so it stays unavailable
 * rather than being approximated by this.
 */

/**
 * Hourly closes, 30 days of them, are the single series behind both
 * volatility and correlation.
 *
 * One frequency for every window means the numbers are comparable with
 * each other and the annualisation factor is constant. It is also one
 * cached gateway series per asset rather than one per window.
 */
const CANDLE_INTERVAL = '1h';
const CANDLE_LIMIT = 720;
/** Hourly periods in a 365-day year — the annualisation factor. */
const PERIODS_PER_YEAR = 24 * 365;

/**
 * Windows, in hourly observations, with the minimum real returns each one
 * needs before it may report anything.
 *
 * The minimums are deliberately below the nominal length: an exchange
 * gaps candles during outages and thin hours, and refusing a 30-day
 * volatility because two hours are missing would be pedantic. Refusing it
 * on 40 observations would not be — an annualised figure from a fifth of
 * its window is a different statistic wearing the same label.
 */
const VOL_WINDOWS = [
  { key: '24h' as const, observations: 24, minimum: 20 },
  { key: '7d' as const, observations: 168, minimum: 120 },
  { key: '30d' as const, observations: 720, minimum: 500 },
];

/** Correlation lookback and the minimum overlapping observations two
 *  assets need before a coefficient is reported at all. */
const CORRELATION_OBSERVATIONS = 720;
const CORRELATION_MINIMUM = 240;

/** A sector needs enough constituents that it describes a sector rather
 *  than one coin's day. */
const SECTOR_MIN_CONSTITUENTS = 3;

export type VolatilityWindowKey = '24h' | '7d' | '30d';

export interface VolatilityWindow {
  window: VolatilityWindowKey;
  /** Annualised realized volatility, in percent. Null when the window did
   *  not have enough real observations — never 0, which would read as a
   *  motionless market. */
  annualizedPercent: number | null;
  /** Real log returns actually used. Shown, so a reader can judge it. */
  samples: number;
}

export interface RealizedVolatilityValue {
  baseAsset: string;
  pair: string;
  interval: string;
  /** Stated in the payload so the UI never has to describe the maths. */
  method: 'log_return_stddev_annualized';
  windows: VolatilityWindow[];
}

export interface CorrelationPair {
  a: string;
  b: string;
  /** Pearson correlation of LOG RETURNS — not of price levels, which
   *  would report a spurious ~1 for any two assets that both drifted up. */
  correlation: number;
  samples: number;
}

export interface CorrelationsValue {
  /** Assets that actually produced a usable series. */
  assets: string[];
  interval: string;
  lookbackHours: number;
  pairs: CorrelationPair[];
  method: 'pearson_log_returns';
}

export interface SectorPerformance {
  category: CoinCategory;
  /** Weighted 24h return of the constituents that reported one. */
  changePercent24h: number;
  /** Constituents that CONTRIBUTED. An asset with no reported return is
   *  excluded from both the figure and this count — it is not folded in
   *  as a zero. */
  constituents: number;
  weighting: 'market_cap' | 'equal';
}

export interface SectorRotationValue {
  window: '24h';
  sectors: SectorPerformance[];
  /** Catalogue rows examined, so a reader can see the base of the sample. */
  universe: number;
}

/** Natural-log returns of a close series. Non-positive or non-finite
 *  closes break the logarithm and are skipped rather than substituted. */
export function logReturns(candles: MarketCandle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]?.close;
    const curr = candles[i]?.close;
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0 || curr <= 0) continue;
    out.push(Math.log(curr / prev));
  }
  return out;
}

/** Sample standard deviation (n-1). Null below two observations, where it
 *  is undefined rather than zero. */
export function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Pearson correlation. Null when either series is flat, where the
 *  coefficient is undefined — a zero denominator is not a zero
 *  correlation. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return null;
  const r = num / Math.sqrt(da * db);
  if (!Number.isFinite(r)) return null;
  // Floating-point error can push a perfect fit a hair past 1.
  return Math.max(-1, Math.min(1, r));
}

export class DerivedAnalyticsService {
  constructor(private readonly gateway: MarketDataGateway) {}

  /**
   * Annualised realized volatility for one asset across three windows.
   *
   * σ_annual = stddev(ln(cₜ / cₜ₋₁)) × √(24 × 365) × 100
   *
   * Every window is cut from the SAME hourly series, so the three are
   * directly comparable and cost one cached candle read between them.
   */
  async getRealizedVolatility(pair: string): Promise<Availability<RealizedVolatilityValue>> {
    const candles = await this.gateway.getCandles(pair, CANDLE_INTERVAL, CANDLE_LIMIT);
    if (!candles.available) return candles;

    const returns = logReturns(candles.value);
    const windows: VolatilityWindow[] = VOL_WINDOWS.map(({ key, observations, minimum }) => {
      const slice = returns.slice(-observations);
      const sd = slice.length >= minimum ? sampleStdDev(slice) : null;
      return {
        window: key,
        annualizedPercent: sd === null ? null : sd * Math.sqrt(PERIODS_PER_YEAR) * 100,
        samples: slice.length,
      };
    });

    if (windows.every((w) => w.annualizedPercent === null)) {
      return unavailable('no_data', 'Not enough real candle history to compute realized volatility.');
    }
    return available({
      value: {
        baseAsset: pair.split('/')[0] ?? pair,
        pair,
        interval: CANDLE_INTERVAL,
        method: 'log_return_stddev_annualized',
        windows,
      },
      source: candles.source,
      fetchedAt: candles.fetchedAt,
      stale: candles.stale,
    });
  }

  /**
   * Pairwise correlation of hourly log returns across the given pairs.
   *
   * Series are aligned on candle TIMESTAMP before differencing, so two
   * assets with different gap patterns are compared on the hours they
   * actually share rather than by index — which would silently correlate
   * Tuesday against Wednesday.
   */
  async getCorrelations(pairs: string[]): Promise<Availability<CorrelationsValue>> {
    const series = await Promise.all(
      pairs.map(async (pair) => {
        const candles = await this.gateway.getCandles(pair, CANDLE_INTERVAL, CANDLE_LIMIT);
        if (!candles.available) return null;
        const closes = new Map<number, number>();
        for (const c of candles.value.slice(-CORRELATION_OBSERVATIONS)) {
          if (Number.isFinite(c.close) && c.close > 0) closes.set(c.time, c.close);
        }
        return { pair, asset: pair.split('/')[0] ?? pair, closes, meta: candles };
      })
    );
    const usable = series.filter((s): s is NonNullable<typeof s> => s !== null && s.closes.size > 1);
    if (usable.length < 2) {
      return unavailable('no_data', 'At least two assets with real candle history are needed for a correlation.');
    }

    const out: CorrelationPair[] = [];
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        const left = usable[i];
        const right = usable[j];
        // Shared timestamps only, in time order.
        const times = [...left.closes.keys()].filter((t) => right.closes.has(t)).sort((x, y) => x - y);
        const ra: number[] = [];
        const rb: number[] = [];
        for (let k = 1; k < times.length; k++) {
          // Consecutive shared hours only: a return computed across a gap
          // is a multi-hour move wearing a one-hour label.
          if (times[k] - times[k - 1] !== 3600) continue;
          ra.push(Math.log(left.closes.get(times[k])! / left.closes.get(times[k - 1])!));
          rb.push(Math.log(right.closes.get(times[k])! / right.closes.get(times[k - 1])!));
        }
        if (ra.length < CORRELATION_MINIMUM) continue;
        const r = pearson(ra, rb);
        if (r === null) continue;
        out.push({ a: left.asset, b: right.asset, correlation: r, samples: ra.length });
      }
    }

    if (out.length === 0) {
      return unavailable('no_data', 'No asset pair had enough overlapping hourly observations.');
    }
    return available({
      value: {
        assets: usable.map((s) => s.asset),
        interval: CANDLE_INTERVAL,
        lookbackHours: CORRELATION_OBSERVATIONS,
        pairs: out,
        method: 'pearson_log_returns',
      },
      source: usable[0].meta.source,
      fetchedAt: Math.min(...usable.map((s) => s.meta.fetchedAt)),
      stale: usable.some((s) => s.meta.stale),
    });
  }

  /**
   * 24h sector performance from the catalogue this system already holds.
   *
   * Reuses the cached CoinGecko catalogue read — the same one `/markets`
   * makes — so Analytics adds no provider sweep of its own.
   *
   * Weighting is market-cap where every contributing constituent reports
   * one, and equal otherwise; the payload says which, because a
   * cap-weighted and an equal-weighted sector return are different
   * numbers and a reader must not have to guess. A constituent with no
   * reported 24h change is EXCLUDED — folding it in as 0% would drag the
   * sector toward flat on the strength of missing data.
   */
  async getSectorRotation(catalogue: CachedValue<CoinRanking[]>): Promise<Availability<SectorRotationValue>> {
    const rankings = catalogue.value;
    if (rankings.length === 0) {
      return unavailable('no_data', 'The asset catalogue is empty.');
    }
    const byCategory = new Map<CoinCategory, CoinRanking[]>();
    for (const coin of rankings) {
      for (const category of coin.categories ?? []) {
        const bucket = byCategory.get(category) ?? [];
        bucket.push(coin);
        byCategory.set(category, bucket);
      }
    }

    const sectors: SectorPerformance[] = [];
    for (const [category, coins] of byCategory) {
      const contributing = coins.filter(
        (c) => typeof c.changePercent24h === 'number' && Number.isFinite(c.changePercent24h)
      );
      if (contributing.length < SECTOR_MIN_CONSTITUENTS) continue;

      const capped = contributing.filter((c) => typeof c.marketCap === 'number' && Number.isFinite(c.marketCap) && c.marketCap > 0);
      const useCap = capped.length === contributing.length;
      let change: number;
      if (useCap) {
        const total = capped.reduce((s, c) => s + (c.marketCap as number), 0);
        change = capped.reduce((s, c) => s + (c.changePercent24h as number) * ((c.marketCap as number) / total), 0);
      } else {
        change = contributing.reduce((s, c) => s + (c.changePercent24h as number), 0) / contributing.length;
      }
      sectors.push({
        category,
        changePercent24h: change,
        constituents: contributing.length,
        weighting: useCap ? 'market_cap' : 'equal',
      });
    }

    if (sectors.length === 0) {
      return unavailable('no_data', 'No sector had enough constituents reporting a 24h return.');
    }
    sectors.sort((a, b) => b.changePercent24h - a.changePercent24h);
    return available({
      value: { window: '24h', sectors, universe: rankings.length },
      source: 'coingecko',
      // The CATALOGUE's own fetch time, not this computation's. The
      // arithmetic is instant; the data is as old as the cached sweep.
      fetchedAt: catalogue.fetchedAt,
      stale: catalogue.stale,
    });
  }
}
