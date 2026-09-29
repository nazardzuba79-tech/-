/**
 * Deterministic, seeded market simulation for TEST assets (see
 * `testAssetConfig.ts`). Pure: no I/O, no clock of its own, no Math.random.
 *
 * STRUCTURE
 *
 *   hour regimes → hourly close-to-close returns → 12 × 5m candles per hour
 *   → 30 × 10s ticks per candle → canonical 5m OHLCV (aggregated from ticks)
 *   → any coarser timeframe (aggregated from the canonical 5m candles).
 *
 * Every random draw comes from a generator seeded by (seed, label, index),
 * so an hour's shape never depends on how much history was generated
 * before it, and the same seed and the same instant always give the same
 * candles — on every refresh, on every server.
 *
 * TIME. Nothing is generated past `now`. The candle that contains `now` is
 * built only from the ticks that have already completed, so its high, low
 * and close are exactly what a live market would have shown at that instant
 * and never hint at where it will close. A 5m candle that has closed is the
 * aggregate of all 30 of its ticks — the same numbers the forming candle
 * showed tick by tick.
 *
 * THE FIRST 48 HOURS are one block of 25 impulse, 17 consolidation and 6
 * pullback hours in a seeded order with no long runs of one regime. Impulse
 * hours target +30% close-to-close, pullbacks −4%, consolidations stay
 * within ±0.9%. Individual hours vary; the block is then corrected so its
 * total is exactly 1.30^25 × 0.96^6 ≈ 552.35 — P48 ≈ 0.01 × 552.35 = 5.5235.
 *
 * AFTER 48 HOURS every UTC-aligned simulated day (24h from the listing) is
 * its own block of 12–13 impulse, 8–9 consolidation and 3 pullback hours.
 * The impulse target decays: R(day) = 0.30 for day ≤ 2, else
 * 0.30 × 0.80^(day − 2).
 *
 * REALISM. An asset with a `simulationProfile` keeps every hour anchor above
 * and hands the INSIDE of each hour — how its fixed return is spread over
 * twelve candles, and each candle's wicks — to `simulationRealism.ts`. An
 * asset without one is generated exactly as before.
 * Optional cyclic impulses replace two hours of canonical ticks and rejoin
 * the original price anchor at the end of the second hour. Their fixed
 * cutover preserves every earlier tick, even inside the first shock hour.
 */
import type { TestAssetConfig } from './testAssetConfig';
import { normal, seededRandom } from './simulationRandom';
import { REALISM_PROFILES, isSimulationProfile, realisticHour, realisticTicks, type CandleShape, type RealismParams } from './simulationRealism';
import { cycleForHour, cycleHourTicks, cycleShockClose } from './simulationCycles';
import { NATURAL_WICK_WINDOW_MS, naturalWickCandles, naturalWickLimit, naturalWickWindowAllowed, naturalWickWindowSelected,
  type NaturalWickCandle } from './simulationNaturalWicks';

export { seededRandom };

export const TICK_MS = 10_000;
export const MINUTE_MS = 60_000;
export const CANDLE_MS = 300_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
const TICKS_PER_CANDLE = CANDLE_MS / TICK_MS; // 30
const TICKS_PER_MINUTE = MINUTE_MS / TICK_MS; // 6
const CANDLES_PER_HOUR = HOUR_MS / CANDLE_MS; // 12

export type Regime = 'impulse' | 'consolidation' | 'pullback';

/** One OHLCV candle. `openTime` in epoch ms; `volume` in the base asset, `quoteVolume` in USDT. */
export interface SimCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
}

/** Eight significant figures. Monotonic, so OHLC ordering survives rounding. */
function round(price: number): number {
  return Number(price.toPrecision(8));
}

// ── Regimes and hourly returns ──────────────────────────────────────

/** Impulse-hour target return for a simulated day (1-based). */
export function impulseRate(day: number): number {
  return day <= 2 ? 0.3 : 0.3 * Math.pow(0.8, day - 2);
}

export const PULLBACK_RETURN = -0.04;
const CONSOLIDATION_BAND = 0.009;

interface Block {
  index: number;
  startHour: number;
  regimes: Regime[];
  /** Close-to-close log return of each hour. */
  logReturns: number[];
}

function blockStartHour(index: number): number {
  return index === 0 ? 0 : 48 + (index - 1) * 24;
}

function blockIndexOfHour(hour: number): number {
  return hour < 48 ? 0 : 1 + Math.floor((hour - 48) / 24);
}

export function blockCounts(index: number): Record<Regime, number> {
  if (index === 0) return { impulse: 25, consolidation: 17, pullback: 6 };
  const day = index + 2;
  const impulse = day % 2 === 1 ? 13 : 12; // 12.5 a day on average, as in the first 48h
  return { impulse, consolidation: 24 - impulse - 3, pullback: 3 };
}

function longestRuns(regimes: Regime[]): Record<Regime, number> {
  const longest: Record<Regime, number> = { impulse: 0, consolidation: 0, pullback: 0 };
  let run = 0;
  for (let i = 0; i < regimes.length; i++) {
    run = i > 0 && regimes[i] === regimes[i - 1] ? run + 1 : 1;
    longest[regimes[i]] = Math.max(longest[regimes[i]], run);
  }
  return longest;
}

/**
 * The block's hours in a seeded order that reads like a market: no more
 * than four impulses, three consolidations or two pullbacks in a row, and
 * the listing opens on an impulse.
 */
export function blockSchedule(seed: string, index: number): Regime[] {
  const counts = blockCounts(index);
  const pool: Regime[] = [
    ...Array<Regime>(counts.impulse).fill('impulse'),
    ...Array<Regime>(counts.consolidation).fill('consolidation'),
    ...Array<Regime>(counts.pullback).fill('pullback'),
  ];
  for (let attempt = 0; attempt < 2000; attempt++) {
    const random = seededRandom(seed, 'schedule', index, attempt);
    const order = pool.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const runs = longestRuns(order);
    if (runs.impulse > 4 || runs.consolidation > 3 || runs.pullback > 2) continue;
    if (index === 0 && order[0] !== 'impulse') continue;
    return order;
  }
  // Unreachable in practice; a fixed interleave keeps the contract anyway.
  return pool.map((_, i) => pool[(i * 7) % pool.length]);
}

function buildBlock(seed: string, index: number): Block {
  const startHour = blockStartHour(index);
  const regimes = blockSchedule(seed, index);
  const random = seededRandom(seed, 'returns', index);
  const anchor: number[] = [];
  const logReturns = regimes.map((regime, i) => {
    const day = Math.floor((startHour + i) / 24) + 1;
    const target = regime === 'impulse' ? Math.log(1 + impulseRate(day)) : regime === 'pullback' ? Math.log(1 + PULLBACK_RETURN) : 0;
    anchor.push(target);
    if (regime === 'consolidation') return Math.log(1 + (random() * 2 - 1) * CONSOLIDATION_BAND);
    const spread = regime === 'impulse' ? 0.14 : 0.3;
    return target * (1 + spread * normal(random));
  });
  // Hours vary; the block does not. Spread the difference over the
  // directional hours by size, so the block total is exactly its anchor.
  const difference = logReturns.reduce((a, b) => a + b, 0) - anchor.reduce((a, b) => a + b, 0);
  const weight = logReturns.reduce((sum, value, i) => sum + (regimes[i] === 'consolidation' ? 0 : Math.abs(value)), 0);
  if (weight > 0) {
    for (let i = 0; i < logReturns.length; i++) {
      if (regimes[i] !== 'consolidation') logReturns[i] -= (difference * Math.abs(logReturns[i])) / weight;
    }
  }
  return { index, startHour, regimes, logReturns };
}

// ── Candles and ticks ───────────────────────────────────────────────

/** Volatility clusters: a smooth, seeded level shared by neighbouring hours. */
function clusterFactor(seed: string, hour: number): number {
  let level = 0;
  const weights = [1, 0.8, 0.6, 0.4];
  for (let j = 0; j < weights.length; j++) level += Math.abs(normal(seededRandom(seed, 'cluster', hour - j))) * weights[j];
  return 0.45 + (0.7 * level) / (0.8 * 2.8);
}

function candleSigma(regime: Regime, hourLogReturn: number, cluster: number): number {
  const base = regime === 'impulse' ? Math.max((Math.abs(hourLogReturn) / CANDLES_PER_HOUR) * 1.05, 0.004)
    : regime === 'pullback' ? 0.0055 : 0.0032;
  return base * cluster;
}

/** Twelve 5m close-to-close log returns that sum exactly to the hour's return. */
function hourCandleReturns(seed: string, hour: number, regime: Regime, hourLogReturn: number, sigma: number): number[] {
  const random = seededRandom(seed, 'hour', hour);
  const mu = hourLogReturn / CANDLES_PER_HOUR;
  const steps: number[] = [];
  for (let k = 0; k < CANDLES_PER_HOUR; k++) {
    const body = 0.45 + random() * 1.1; // pauses and full-bodied candles
    const burst = random() < 0.07 ? 2.2 : 1; // breakouts and shakeouts
    steps.push(mu + sigma * body * burst * normal(random));
  }
  const drift = (steps.reduce((a, b) => a + b, 0) - hourLogReturn) / CANDLES_PER_HOUR;
  return steps.map((step) => step - drift);
}

interface Tick { price: number; high: number; low: number; volume: number; quoteVolume: number }

const REGIME_VOLUME: Record<Regime, number> = { impulse: 1.7, consolidation: 0.5, pullback: 1.35 };
const BASE_QUOTE_VOLUME = 5200; // USDT per 5m candle at the listing price

/** Thirty 10s ticks from `open` to `close`, with their own small ranges and volume. */
function candleTicks(seed: string, hour: number, slot: number, regime: Regime, open: number, close: number, sigma: number, cluster: number, initialPrice: number): Tick[] {
  const random = seededRandom(seed, 'ticks', hour, slot);
  const total = Math.log(close / open);
  const tickSigma = (sigma / Math.sqrt(TICKS_PER_CANDLE)) * 1.2;
  const steps: number[] = [];
  for (let i = 0; i < TICKS_PER_CANDLE; i++) steps.push(total / TICKS_PER_CANDLE + tickSigma * normal(random));
  const drift = (steps.reduce((a, b) => a + b, 0) - total) / TICKS_PER_CANDLE;
  const quote = BASE_QUOTE_VOLUME * Math.pow(open / initialPrice, 0.3) * REGIME_VOLUME[regime]
    * (1 + 18 * Math.abs(total) + 0.6 * (cluster - 1)) * Math.exp(0.35 * normal(random));
  const weights = steps.map((step) => Math.exp(0.5 * normal(random)) * (1 + 40 * Math.abs(step - drift)));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const ticks: Tick[] = [];
  let logPrice = Math.log(open);
  let previous = open;
  for (let i = 0; i < TICKS_PER_CANDLE; i++) {
    logPrice += steps[i] - drift;
    const price = i === TICKS_PER_CANDLE - 1 ? close : Math.exp(logPrice);
    const spike = random() < 0.03 ? 3 : 1;
    const high = Math.max(previous, price) * Math.exp(Math.abs(normal(random)) * tickSigma * 0.35 * spike);
    const low = Math.min(previous, price) * Math.exp(-Math.abs(normal(random)) * tickSigma * 0.35 * (random() < 0.03 ? 3 : 1));
    const quoteVolume = (quote * weights[i]) / weightSum;
    ticks.push({ price, high, low, quoteVolume, volume: quoteVolume / ((previous + price) / 2) });
    previous = price;
  }
  return ticks;
}

function candleFromTicks(openTime: number, open: number, ticks: Tick[]): SimCandle {
  let high = open, low = open, volume = 0, quoteVolume = 0;
  for (const tick of ticks) {
    high = Math.max(high, tick.high);
    low = Math.min(low, tick.low);
    volume += tick.volume;
    quoteVolume += tick.quoteVolume;
  }
  const close = ticks.length ? ticks[ticks.length - 1].price : open;
  return {
    openTime,
    open: round(open),
    high: round(Math.max(high, open, close)),
    low: round(Math.min(low, open, close)),
    close: round(close),
    volume: Number(volume.toFixed(4)),
    quoteVolume: Number(quoteVolume.toFixed(2)),
  };
}

// ── The generator ───────────────────────────────────────────────────

interface HourPlan {
  hour: number;
  regime: Regime;
  open: number;
  logReturn: number;
  sigma: number;
  cluster: number;
  /** 13 candle boundaries: open of each 5m candle, then the hour's close. */
  boundaries: number[];
  /** Realism only: the shape of each of the twelve candles. */
  shapes?: CandleShape[];
  /** A cycle's complete canonical hour; boundaries are sampled from it. */
  cycleTicks?: Tick[];
}

/**
 * One simulation per test asset. Completed blocks and completed candles are
 * cached — they are pure functions of the seed — so serving a request costs
 * only the candle that is still forming.
 */
export class TestMarketSimulation {
  private blocks = new Map<number, Block>();
  private hourOpens: number[] = [];
  private closedCandles = new Map<number, SimCandle>();
  private cycleHours = new Map<number, HourPlan>();
  private naturalWindows = new Map<number, NaturalWickCandle[]>();
  /** The profile's parameters, or null for the legacy intra-hour path. */
  private readonly realism: RealismParams | null;
  private readonly realismOffset: number;
  /** The first hour the profile shapes; every earlier hour takes the legacy path. */
  private readonly realismFromHour: number;

  constructor(readonly asset: TestAssetConfig) {
    this.realism = isSimulationProfile(asset.simulationProfile) ? REALISM_PROFILES[asset.simulationProfile] : null;
    this.realismOffset = asset.realismSeedOffset ?? 0;
    this.realismFromHour = asset.realismFrom === undefined ? 0 : Math.max(0, Math.ceil((asset.realismFrom - asset.listingAt) / HOUR_MS));
  }

  private block(index: number): Block {
    let block = this.blocks.get(index);
    if (!block) {
      block = buildBlock(this.asset.seed, index);
      this.blocks.set(index, block);
    }
    return block;
  }

  /** Price at the open of `hour` (0 = the listing hour). */
  private hourOpen(hour: number): number {
    if (this.hourOpens.length === 0) this.hourOpens.push(this.asset.initialPrice);
    while (this.hourOpens.length <= hour) {
      const h = this.hourOpens.length - 1;
      const block = this.block(blockIndexOfHour(h));
      this.hourOpens.push(this.hourOpens[h] * Math.exp(block.logReturns[h - block.startHour]));
    }
    return this.hourOpens[hour];
  }

  private regimeOf(hour: number): Regime {
    const block = this.block(blockIndexOfHour(hour));
    return block.regimes[hour - block.startHour];
  }

  private baselineHourPlan(hour: number): HourPlan {
    const block = this.block(blockIndexOfHour(hour));
    const regime = block.regimes[hour - block.startHour];
    const logReturn = block.logReturns[hour - block.startHour];
    const cluster = clusterFactor(this.asset.seed, hour);
    const sigma = candleSigma(regime, logReturn, cluster);
    const open = this.hourOpen(hour);
    // Both paths start and end the hour on the same anchors, so switching at an hour is seamless.
    const realistic = this.realism && hour >= this.realismFromHour ? realisticHour({
      seed: this.asset.seed, offset: this.realismOffset, hour, regime, logReturn, sigma, params: this.realism,
      trendStep: Math.log(1 + impulseRate(Math.floor(hour / 24) + 1)) / CANDLES_PER_HOUR,
      previousRegime: hour > 0 ? this.regimeOf(hour - 1) : null, nextRegime: this.regimeOf(hour + 1),
    }) : null;
    const steps = realistic ? realistic.steps : hourCandleReturns(this.asset.seed, hour, regime, logReturn, sigma);
    const boundaries = [open];
    let logPrice = Math.log(open);
    for (let k = 0; k < CANDLES_PER_HOUR; k++) {
      logPrice += steps[k];
      // The hour always closes on the base simulation's anchor, whatever happened inside it.
      boundaries.push(k === CANDLES_PER_HOUR - 1 ? this.hourOpen(hour + 1) : Math.exp(logPrice));
    }
    return { hour, regime, open, logReturn, sigma, cluster, boundaries, ...(realistic ? { shapes: realistic.shapes } : {}) };
  }

  hourPlan(hour: number): HourPlan {
    const cycle = cycleForHour(this.asset.cyclicImpulse, this.asset.listingAt, hour);
    if (!cycle) return this.baselineHourPlan(hour);
    const cached = this.cycleHours.get(hour);
    if (cached) return cached;
    const baseline = this.baselineHourPlan(hour);
    const original = Array.from({ length: CANDLES_PER_HOUR }, (_, slot) => this.baselineTicks(baseline, slot)).flat();
    const shockOpen = this.hourOpen(cycle.shockHour);
    const cycleTicks = cycleHourTicks(this.asset.seed, hour, cycle, shockOpen, this.hourOpen(cycle.shockHour + 2), original);
    const open = cycle.phase === 'shock' ? baseline.open : cycleShockClose(shockOpen, cycle.preset);
    const boundaries = [open];
    for (let slot = 0; slot < CANDLES_PER_HOUR; slot++) boundaries.push(cycleTicks[(slot + 1) * TICKS_PER_CANDLE - 1].price);
    const plan = { ...baseline, open, logReturn: Math.log(boundaries[CANDLES_PER_HOUR] / open), boundaries, cycleTicks };
    this.cycleHours.set(hour, plan);
    // A bounded cache does not change the seeded result when an hour is rebuilt.
    if (this.cycleHours.size > 96) this.cycleHours.delete(this.cycleHours.keys().next().value as number);
    return plan;
  }

  private baselineTicks(plan: HourPlan, slot: number): Tick[] {
    const open = plan.boundaries[slot], close = plan.boundaries[slot + 1];
    if (plan.shapes && this.realism) {
      const volumeBase = BASE_QUOTE_VOLUME * Math.pow(open / this.asset.initialPrice, 0.3) * REGIME_VOLUME[plan.regime];
      return realisticTicks(this.asset.seed, this.realismOffset, plan.hour, slot, open, close, plan.shapes[slot],
        plan.cluster, volumeBase, this.realism);
    }
    return candleTicks(this.asset.seed, plan.hour, slot, plan.regime, open, close, plan.sigma, plan.cluster, this.asset.initialPrice);
  }

  private originalTicks(plan: HourPlan, slot: number): Tick[] {
    if (plan.cycleTicks) return plan.cycleTicks.slice(slot * TICKS_PER_CANDLE, (slot + 1) * TICKS_PER_CANDLE);
    const ticks = this.baselineTicks(plan, slot);
    const from = this.asset.wickBoostFrom;
    if (from === undefined || !Number.isFinite(from)) return ticks;
    const candleAt = this.asset.listingAt + plan.hour * HOUR_MS + slot * CANDLE_MS;
    const ceiling = plan.shapes && this.realism ? Math.max(plan.boundaries[slot], plan.boundaries[slot + 1]) * Math.exp(this.realism.maxWick) : Infinity;
    const floor = plan.shapes && this.realism ? Math.min(plan.boundaries[slot], plan.boundaries[slot + 1]) * Math.exp(-this.realism.maxWick) : Number.MIN_VALUE;
    return ticks.map((tick, i) => {
      // Preserve ticks at the cutoff as well; only subsequently completed
      // simulated ranges receive the modest VTA-specific shadow increase.
      if (candleAt + (i + 1) * TICK_MS <= from) return tick;
      const previous = i ? ticks[i - 1].price : plan.boundaries[slot];
      const top = Math.max(previous, tick.price), bottom = Math.min(previous, tick.price);
      return { ...tick, high: Math.min(ceiling, top + (tick.high - top) * 1.55),
        low: Math.max(floor, bottom - (bottom - tick.low) * 1.55) };
    });
  }

  private ticks(plan: HourPlan, slot: number): Tick[] {
    const policy = this.asset.naturalWicks;
    // Cycle extrema are part of the owner's exact shock/recovery contract.
    if (!policy || plan.cycleTicks) return this.originalTicks(plan, slot);
    const index = plan.hour * CANDLES_PER_HOUR + slot;
    const at = this.asset.listingAt + index * CANDLE_MS;
    const windowAt = Math.floor(at / NATURAL_WICK_WINDOW_MS) * NATURAL_WICK_WINDOW_MS;
    const firstWindow = Math.floor(this.asset.listingAt / NATURAL_WICK_WINDOW_MS) * NATURAL_WICK_WINDOW_MS;
    const windowIndex = (windowAt - firstWindow) / NATURAL_WICK_WINDOW_MS;
    if (!naturalWickWindowAllowed(policy, windowAt) || !naturalWickWindowSelected(this.asset.seed, this.realismOffset, windowIndex)) {
      return this.originalTicks(plan, slot);
    }
    let window = this.naturalWindows.get(windowAt);
    if (!window) {
      const first = Math.max(0, Math.ceil((windowAt - this.asset.listingAt) / CANDLE_MS));
      const end = Math.ceil((windowAt + NATURAL_WICK_WINDOW_MS - this.asset.listingAt) / CANDLE_MS);
      const original: NaturalWickCandle[] = [];
      for (let member = first; member < end; member += 1) {
        const hour = Math.floor(member / CANDLES_PER_HOUR), memberSlot = member % CANDLES_PER_HOUR;
        const memberPlan = hour === plan.hour ? plan : this.hourPlan(hour);
        // Non-aligned listings can have a UTC bucket spanning two hour plans.
        // Keep the entire bucket intact if either belongs to an exact cycle.
        if (memberPlan.cycleTicks) return this.originalTicks(plan, slot);
        original.push({ index: member, open: memberPlan.boundaries[memberSlot], close: memberPlan.boundaries[memberSlot + 1],
          maxWick: naturalWickLimit(this.realism?.maxWick), ticks: this.originalTicks(memberPlan, memberSlot) });
      }
      window = naturalWickCandles(this.asset.seed, this.realismOffset, windowIndex, original);
      this.naturalWindows.set(windowAt, window);
      if (this.naturalWindows.size > 96) this.naturalWindows.delete(this.naturalWindows.keys().next().value as number);
    }
    return window.find((candle) => candle.index === index)!.ticks;
  }

  /** Read-only tape of completed canonical ticks; never samples a future tick. */
  recentTrades(now: number, limit = 100) {
    const done = Math.max(0, Math.floor((now - this.asset.listingAt) / TICK_MS));
    const count = Math.min(done, Math.max(0, Math.min(500, Math.floor(limit))));
    const trades: { id: string; timestamp: number; price: string; quantity: string; quoteVolume: string; side: 'BUY' | 'SELL' }[] = [];
    let cachedIndex = -1, ticks: Tick[] = [], plan: HourPlan;
    for (let index = done - 1; index >= done - count; index--) {
      const candleIndex = Math.floor(index / TICKS_PER_CANDLE);
      const slot = candleIndex % CANDLES_PER_HOUR;
      if (cachedIndex !== candleIndex) {
        plan = this.hourPlan(Math.floor(candleIndex / CANDLES_PER_HOUR));
        ticks = this.ticks(plan, slot);
        cachedIndex = candleIndex;
      }
      const offset = index % TICKS_PER_CANDLE, tick = ticks[offset];
      const previous = offset ? ticks[offset - 1].price : plan!.boundaries[slot];
      trades.push({ id: `${this.asset.symbol}:${index + 1}`, timestamp: this.asset.listingAt + (index + 1) * TICK_MS,
        price: String(round(tick.price)), quantity: tick.volume.toFixed(8), quoteVolume: tick.quoteVolume.toFixed(8),
        side: tick.price >= previous ? 'BUY' : 'SELL' });
    }
    return trades;
  }

  /**
   * The canonical 5m series from the listing up to `now`. The last candle
   * is the one forming at `now`, built from completed ticks only. Empty
   * before the listing.
   */
  candles5m(now: number, from = this.asset.listingAt): SimCandle[] {
    const listing = this.asset.listingAt;
    if (now < listing) return [];
    const start = Math.max(listing, listing + Math.floor((from - listing) / CANDLE_MS) * CANDLE_MS);
    const out: SimCandle[] = [];
    let plan: HourPlan | null = null;
    for (let openTime = start; openTime <= now; openTime += CANDLE_MS) {
      const index = (openTime - listing) / CANDLE_MS;
      const hour = Math.floor(index / CANDLES_PER_HOUR);
      const slot = index % CANDLES_PER_HOUR;
      const closed = openTime + CANDLE_MS <= now;
      const cached = closed ? this.closedCandles.get(openTime) : undefined;
      if (cached) { out.push(cached); continue; }
      if (!plan || plan.hour !== hour) plan = this.hourPlan(hour);
      const ticks = this.ticks(plan, slot);
      const done = closed ? TICKS_PER_CANDLE : Math.floor((now - openTime) / TICK_MS);
      const candle = candleFromTicks(openTime, plan.boundaries[slot], ticks.slice(0, done));
      if (closed) this.closedCandles.set(openTime, candle);
      out.push(candle);
    }
    return out;
  }

  /**
   * 1m candles from the same ticks as the canonical 5m series (six ticks
   * each), so five of them always aggregate to exactly their 5m candle. The
   * last one is forming at `now`, from completed ticks only.
   */
  candles1m(now: number, from = this.asset.listingAt): SimCandle[] {
    const listing = this.asset.listingAt;
    if (now < listing) return [];
    const start = Math.max(listing, listing + Math.floor((from - listing) / MINUTE_MS) * MINUTE_MS);
    const out: SimCandle[] = [];
    let plan: HourPlan | null = null;
    let cachedIndex = -1, ticks: Tick[] = [];
    for (let openTime = start; openTime <= now; openTime += MINUTE_MS) {
      const index = Math.floor((openTime - listing) / CANDLE_MS);
      const hour = Math.floor(index / CANDLES_PER_HOUR);
      const slot = index % CANDLES_PER_HOUR;
      if (cachedIndex !== index) {
        if (!plan || plan.hour !== hour) plan = this.hourPlan(hour);
        ticks = this.ticks(plan, slot);
        cachedIndex = index;
      }
      const first = ((openTime - listing - index * CANDLE_MS) / MINUTE_MS) * TICKS_PER_MINUTE;
      const done = Math.min(TICKS_PER_MINUTE, Math.max(0, Math.floor((now - openTime) / TICK_MS)));
      const open = first === 0 ? plan!.boundaries[slot] : ticks[first - 1].price;
      out.push(candleFromTicks(openTime, open, ticks.slice(first, first + done)));
    }
    return out;
  }

  /** The last traded price at `now`, or null before the listing. */
  priceAt(now: number): number | null {
    if (now < this.asset.listingAt) return null;
    const candles = this.candles5m(now, now);
    return candles.length ? candles[candles.length - 1].close : null;
  }
}

// ── Aggregation and statistics ──────────────────────────────────────

export const SIM_INTERVALS: Record<string, number> = {
  '1m': MINUTE_MS,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': HOUR_MS,
  '4h': 4 * HOUR_MS,
  '1d': DAY_MS,
  '1w': 7 * DAY_MS,
};
/** Weekly candles open on Monday 00:00 UTC; 1970-01-05 was a Monday. */
export const SIM_INTERVAL_OFFSETS: Record<string, number> = { '1w': 4 * DAY_MS };

/**
 * Coarser candles from the canonical 5m series, UTC-aligned: open of the
 * first, close of the last, the highest high, the lowest low, summed
 * volume. Every timeframe tells the same history.
 */
export function aggregateCandles(candles: readonly SimCandle[], intervalMs: number, offsetMs = 0): SimCandle[] {
  if (intervalMs === CANDLE_MS) return candles.slice();
  const out: SimCandle[] = [];
  for (const candle of candles) {
    const bucket = Math.floor((candle.openTime - offsetMs) / intervalMs) * intervalMs + offsetMs;
    const last = out[out.length - 1];
    if (!last || last.openTime !== bucket) {
      out.push({ ...candle, openTime: bucket });
      continue;
    }
    last.high = Math.max(last.high, candle.high);
    last.low = Math.min(last.low, candle.low);
    last.close = candle.close;
    last.volume = Number((last.volume + candle.volume).toFixed(4));
    last.quoteVolume = Number((last.quoteVolume + candle.quoteVolume).toFixed(2));
  }
  return out;
}

export interface TestMarketState {
  pair: string;
  symbol: string;
  name: string;
  isTestAsset: true;
  isTradable: boolean;
  listingAt: number;
  initialPrice: number;
  serverTime: number;
  phase: 'pre-listing' | 'live';
  lastPrice: number | null;
  /** Price 24h ago, or the listing price inside the first day. */
  openPrice24h: number | null;
  change24hPercent: number | null;
  high24h: number | null;
  low24h: number | null;
  /** Base-asset volume over the rolling 24h. */
  volume24h: number | null;
  quoteVolume24h: number | null;
}

/**
 * The market's numbers at `now`, every one of them read off the same
 * candles the chart draws: the rolling 24h window is the 5m candles that
 * overlap it, the reference price is the price at `now − 24h` (the listing
 * price during the first day).
 */
export function getCurrentTestMarketState(simulation: TestMarketSimulation, now: number): TestMarketState {
  const asset = simulation.asset;
  const base = {
    pair: asset.pair, symbol: asset.symbol, name: asset.name,
    isTestAsset: true as const, isTradable: asset.isTradable,
    listingAt: asset.listingAt, initialPrice: asset.initialPrice, serverTime: now,
  };
  if (now < asset.listingAt) {
    return { ...base, phase: 'pre-listing', lastPrice: null, openPrice24h: null, change24hPercent: null,
      high24h: null, low24h: null, volume24h: null, quoteVolume24h: null };
  }
  const windowStart = now - DAY_MS;
  const window = simulation.candles5m(now, windowStart);
  const lastPrice = window[window.length - 1].close;
  const openPrice24h = windowStart <= asset.listingAt ? asset.initialPrice : simulation.priceAt(windowStart) as number;
  let high = -Infinity, low = Infinity, volume = 0, quoteVolume = 0;
  for (const candle of window) {
    high = Math.max(high, candle.high);
    low = Math.min(low, candle.low);
    volume += candle.volume;
    quoteVolume += candle.quoteVolume;
  }
  return {
    ...base, phase: 'live', lastPrice, openPrice24h,
    change24hPercent: (lastPrice / openPrice24h - 1) * 100,
    high24h: high, low24h: low,
    volume24h: Number(volume.toFixed(4)), quoteVolume24h: Number(quoteVolume.toFixed(2)),
  };
}

const simulations = new Map<string, TestMarketSimulation>();
/** Distinct configurations kept at once (built-ins, published listings, a few admin previews). */
const MAX_SIMULATIONS = 64;

/**
 * The one shared simulation per test-asset CONFIGURATION. The key is every
 * input that shapes history — pair, seed, listing time, initial price,
 * realism profile, offset and activation — so a managed listing's draft
 * preview and its published market never share (and never corrupt) each
 * other's cached candles. VTA and NRX have one fixed configuration each, so they keep
 * exactly one simulation as before.
 */
export function simulationFor(asset: TestAssetConfig): TestMarketSimulation {
  const cycle = asset.cyclicImpulse;
  const natural = asset.naturalWicks;
  const key = `${asset.pair}|${asset.seed}|${asset.listingAt}|${asset.initialPrice}|${asset.simulationProfile ?? 'legacy'}|${asset.realismSeedOffset ?? 0}|${asset.realismFrom ?? 0}|${cycle ? `${cycle.anchorAt}:${cycle.notBefore}:${cycle.periodHours}` : 'no-cycle'}|${asset.wickBoostFrom ?? 'no-wick-boost'}|${natural ? `${natural.historicalUntil ?? 'no-history'}:${natural.futureFrom}` : 'original-wicks'}`;
  let simulation = simulations.get(key);
  if (!simulation) {
    simulation = new TestMarketSimulation(asset);
    simulations.set(key, simulation);
    if (simulations.size > MAX_SIMULATIONS) simulations.delete(simulations.keys().next().value as string);
  }
  return simulation;
}
