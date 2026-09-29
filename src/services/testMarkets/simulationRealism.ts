/**
 * INTRABAR REALISM — how a simulated market's candles LOOK, never where the
 * market goes.
 *
 *   base simulation: hour anchors and regimes   (testMarketSimulation.ts, unchanged)
 *   → profile: REALISM_PROFILES[simulationProfile]
 *   → hour choreography: how the hour's FIXED return is spread over its twelve
 *     5m candles — impulses, short pullbacks, compression → breakout, pin bars
 *   → intrabar path: 30 ticks per candle, with wick excursions that leave the
 *     body and come back before the close
 *   → OHLC (candleFromTicks in testMarketSimulation.ts, unchanged)
 *
 * What a profile can never change (all tested):
 *   - the twelve steps of an hour sum to that hour's return and the last one
 *     lands exactly on the next hour's open, so every hour boundary — every
 *     block and day anchor, P48, the long-run trajectory and the final price —
 *     is identical for every profile and for the legacy path;
 *   - an excursion starts and ends inside its candle: it moves high/low, never
 *     open or close;
 *   - every draw comes from seededRandom(seed, 'realism', offset, …): the same
 *     pair + seed + profile + offset + time gives the same candles everywhere.
 *
 * Profiles share the SAME random streams; only their parameters differ, so
 * comparing two profiles on one seed compares character, not luck.
 */
import type { Regime } from './testMarketSimulation';
import { normal, seededRandom } from './simulationRandom';

export const SIMULATION_PROFILES = ['CALM_TREND', 'IMPULSE_TREND', 'PULLBACK_TREND', 'COMPRESSION_BREAKOUT'] as const;
export type SimulationProfile = (typeof SIMULATION_PROFILES)[number];

export function isSimulationProfile(value: unknown): value is SimulationProfile {
  return typeof value === 'string' && (SIMULATION_PROFILES as readonly string[]).includes(value);
}

/** The profile of the n-th simulated listing, 0-based: #1 CALM_TREND, #2 IMPULSE_TREND, #3 PULLBACK_TREND, #4 COMPRESSION_BREAKOUT, #5 CALM_TREND… */
export function profileForOrdinal(ordinal: number): SimulationProfile {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new RangeError('ordinal must be a non-negative integer');
  return SIMULATION_PROFILES[ordinal % SIMULATION_PROFILES.length];
}

type Range = readonly [number, number];
/** How a trending hour spends its move. */
export type TrendPattern = 'steady' | 'burst' | 'pullback' | 'compression';
export type HourPattern = TrendPattern | 'breakout' | 'range' | 'coil';

export interface RealismParams {
  /** Pattern weights for an impulse-regime hour and for a pullback-regime (counter-trend) hour. */
  trendPatterns: Readonly<Record<TrendPattern, number>>;
  counterPatterns: Readonly<Record<TrendPattern, number>>;
  /** Chance that an impulse hour right after a consolidation hour opens with a breakout — and that consolidation coils into it. */
  breakoutAfterRange: number;
  /** 'burst': the impulse candle(s) carry this share of the hour's move, after at least `impulseEarliestSlot` ordinary candles. */
  impulseShare: Range;
  impulseEarliestSlot: number;
  /** 'pullback': a counter-trend run this deep (share of the hour's move) and this long (candles). */
  pullbackDepth: Range;
  pullbackLength: Range;
  /** 'compression': this many narrow candles (noise `compressionNoise`), then a breakout carrying `breakoutShare`. */
  compressionDuration: Range;
  compressionNoise: number;
  breakoutShare: Range;
  /** Candle noise of trending hours, in units of the hour's candle sigma. */
  bodyNoise: number;
  /** Candle noise of consolidation hours, as a share of the day's typical impulse step (a range that breathes with the trend). */
  rangeNoise: number;
  /** How unevenly a share of the move falls on candles: 0 = similar bodies, 1 = a few large and many small. */
  bodyVariety: number;
  /** Size of an ordinary shadow relative to the candle's scale. */
  shadowSize: Range;
  /** Per candle: an ordinary shadow, a long wick, a pin bar (small body, long wick), a wick sweep out of a narrow range, a long wick right after an impulse. */
  shadowChance: number;
  longWickChance: number;
  rejectionChance: number;
  sweepChance: number;
  afterImpulseWickChance: number;
  /** Wick height relative to the candle's scale; the tick-level shadow factor (legacy: 0.35); the largest wick, in log units. */
  wickSizeFactor: number;
  tickWickFactor: number;
  maxWick: number;
  /** Clustered unevenness of volatility inside an hour (0 = even). */
  localVolatilityFactor: number;
  /** Heavy tails: chance and size of an outsized candle move. */
  tailChance: number;
  tailFactor: number;
}

const profile = (params: RealismParams): Readonly<RealismParams> => Object.freeze(params);

export const REALISM_PROFILES: Readonly<Record<SimulationProfile, Readonly<RealismParams>>> = Object.freeze({
  /** Smooth trend: small and medium candles, short shadows, rare impulses, short pauses. */
  CALM_TREND: profile({
    trendPatterns: { steady: 0.72, burst: 0.14, pullback: 0.08, compression: 0.06 },
    counterPatterns: { steady: 0.8, burst: 0.1, pullback: 0.1, compression: 0 },
    breakoutAfterRange: 0.15,
    impulseShare: [0.22, 0.34], impulseEarliestSlot: 2,
    pullbackDepth: [0.1, 0.22], pullbackLength: [2, 3],
    compressionDuration: [4, 6], compressionNoise: 0.6, breakoutShare: [0.28, 0.42],
    bodyNoise: 0.75, rangeNoise: 0.3, bodyVariety: 0.3,
    shadowSize: [0.1, 0.4], shadowChance: 0.4, longWickChance: 0.05, rejectionChance: 0.03, sweepChance: 0.03, afterImpulseWickChance: 0.2,
    wickSizeFactor: 0.55, tickWickFactor: 0.3, maxWick: 0.06,
    localVolatilityFactor: 0.2, tailChance: 0.03, tailFactor: 1.6,
  }),
  /** Strong trend candles: a few ordinary bars, then an impulse; consolidation → breakout; occasional big wicks. */
  IMPULSE_TREND: profile({
    trendPatterns: { steady: 0.1, burst: 0.42, pullback: 0.23, compression: 0.25 },
    counterPatterns: { steady: 0.35, burst: 0.35, pullback: 0.2, compression: 0.1 },
    breakoutAfterRange: 0.55,
    impulseShare: [0.38, 0.62], impulseEarliestSlot: 3,
    pullbackDepth: [0.18, 0.35], pullbackLength: [2, 3],
    compressionDuration: [4, 7], compressionNoise: 0.4, breakoutShare: [0.45, 0.65],
    bodyNoise: 0.9, rangeNoise: 0.6, bodyVariety: 0.75,
    shadowSize: [0.3, 1.1], shadowChance: 0.7, longWickChance: 0.22, rejectionChance: 0.1, sweepChance: 0.15, afterImpulseWickChance: 0.6,
    wickSizeFactor: 1.35, tickWickFactor: 0.45, maxWick: 0.11,
    localVolatilityFactor: 0.4, tailChance: 0.07, tailFactor: 2.2,
  }),
  /** The trend holds, but through short counter-trend runs, false breakouts, rejections and long shadows. */
  PULLBACK_TREND: profile({
    trendPatterns: { steady: 0.12, burst: 0.16, pullback: 0.6, compression: 0.12 },
    counterPatterns: { steady: 0.35, burst: 0.25, pullback: 0.35, compression: 0.05 },
    breakoutAfterRange: 0.25,
    impulseShare: [0.3, 0.5], impulseEarliestSlot: 2,
    pullbackDepth: [0.25, 0.5], pullbackLength: [2, 4],
    compressionDuration: [4, 6], compressionNoise: 0.5, breakoutShare: [0.35, 0.55],
    bodyNoise: 1.0, rangeNoise: 0.7, bodyVariety: 0.5,
    shadowSize: [0.3, 1.2], shadowChance: 0.75, longWickChance: 0.28, rejectionChance: 0.16, sweepChance: 0.1, afterImpulseWickChance: 0.45,
    wickSizeFactor: 1.5, tickWickFactor: 0.5, maxWick: 0.13,
    localVolatilityFactor: 0.35, tailChance: 0.06, tailFactor: 2.0,
  }),
  /** Narrow ranges with small bodies and local wick sweeps, then a strong breakout and a short settle. */
  COMPRESSION_BREAKOUT: profile({
    trendPatterns: { steady: 0.12, burst: 0.18, pullback: 0.08, compression: 0.62 },
    counterPatterns: { steady: 0.4, burst: 0.2, pullback: 0.1, compression: 0.3 },
    breakoutAfterRange: 0.7,
    impulseShare: [0.4, 0.6], impulseEarliestSlot: 4,
    pullbackDepth: [0.12, 0.25], pullbackLength: [2, 3],
    compressionDuration: [6, 9], compressionNoise: 0.28, breakoutShare: [0.5, 0.72],
    bodyNoise: 0.8, rangeNoise: 0.12, bodyVariety: 0.5,
    shadowSize: [0.15, 0.6], shadowChance: 0.45, longWickChance: 0.08, rejectionChance: 0.05, sweepChance: 0.3, afterImpulseWickChance: 0.3,
    wickSizeFactor: 0.9, tickWickFactor: 0.4, maxWick: 0.09,
    localVolatilityFactor: 0.3, tailChance: 0.04, tailFactor: 1.8,
  }),
});

// ── One hour ─────────────────────────────────────────────────────────

const CANDLES = 12;
const TICKS = 30;

export type CandleKind = 'normal' | 'impulse' | 'counter' | 'coil' | 'stabilize' | 'pinUp' | 'pinDown' | 'doji';

/** A wick: from the body out to `height` (log units) at tick `peak` and back, entirely inside the candle. */
export interface Excursion { side: 1 | -1; height: number; peak: number; rise: number; fall: number }

export interface CandleShape {
  kind: CandleKind;
  /** The candle's noise scale, log units. */
  scale: number;
  /** Tick noise relative to `scale` (clean impulse bodies are quieter). */
  intrabar: number;
  /** Volume multiplier. */
  volume: number;
  excursions: Excursion[];
}

export interface HourContext {
  seed: string;
  /** realismSeedOffset: another offset re-rolls the look, never the anchors. */
  offset: number;
  hour: number;
  regime: Regime;
  previousRegime: Regime | null;
  nextRegime: Regime | null;
  /** The hour's close-to-close log return, fixed by the base simulation. */
  logReturn: number;
  /** The base simulation's candle sigma for the hour (regime × volatility cluster). */
  sigma: number;
  /** The day's typical impulse step per 5m candle (log units), from the base simulation's impulse rate. */
  trendStep: number;
  params: RealismParams;
}

export interface RealisticHour { pattern: HourPattern; steps: number[]; shapes: CandleShape[] }

/** Body weight of each kind when a share of the move is spread over candles. */
const KIND_WEIGHT: Record<CandleKind, number> = {
  normal: 1, impulse: 1, counter: 1, coil: 1, stabilize: 0.35, pinUp: 0.18, pinDown: 0.18, doji: 0.12,
};
const KIND_VOLUME: Record<CandleKind, Range> = {
  normal: [0.9, 1.1], impulse: [1.5, 2.3], counter: [1, 1.2], coil: [0.5, 0.6], stabilize: [0.8, 0.9],
  pinUp: [1.15, 1.35], pinDown: [1.15, 1.35], doji: [0.75, 0.85],
};

const lerp = ([a, b]: Range, t: number) => a + (b - a) * t;
const integer = (random: () => number, [low, high]: Range) => Math.round(low) + Math.floor(random() * (Math.round(high) - Math.round(low) + 1));

function pick<T extends string>(weights: Readonly<Record<T, number>>, u: number): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  for (const [key, w] of entries) {
    acc += w / total;
    if (u < acc) return key;
  }
  return entries[entries.length - 1][0];
}

/** Whether this impulse hour breaks out of the consolidation hour before it. Both hours ask the same question. */
function breaksOut(seed: string, offset: number, hour: number, params: RealismParams): boolean {
  return seededRandom(seed, 'realism', offset, 'breakout', hour)() < params.breakoutAfterRange;
}

/**
 * The hour's twelve 5m steps (summing to its return) and the shape of each
 * candle. Pure: the same context always gives the same hour.
 */
export function realisticHour(ctx: HourContext): RealisticHour {
  const { seed, offset, hour, regime, logReturn, sigma, params: P } = ctx;
  const random = seededRandom(seed, 'realism', offset, 'hour', hour);
  const dir: 1 | -1 = logReturn >= 0 ? 1 : -1;
  const kinds: CandleKind[] = Array<CandleKind>(CANDLES).fill('normal');
  const share: number[] = Array<number>(CANDLES).fill(0);
  const boost: number[] = Array<number>(CANDLES).fill(1);
  const quiet: number[] = Array<number>(CANDLES).fill(1);
  const slots = [...Array(CANDLES).keys()];

  const spread = (targets: number[], total: number) => {
    if (!targets.length) return;
    // Even jitter blended with an exponential draw: a few large bodies, many small ones.
    const g = targets.map((slot) => KIND_WEIGHT[kinds[slot]] * boost[slot]
      * ((1 - P.bodyVariety) * (0.45 + random() * 1.1) + P.bodyVariety * -Math.log(1 - 0.995 * random())));
    const sum = g.reduce((a, b) => a + b, 0);
    targets.forEach((slot, i) => { share[slot] += (total * g[i]) / sum; });
  };
  /** Ordinary candles that become pin bars (rejections) or dojis. */
  const markRejections = (targets: number[], dojiChance = 0) => {
    for (const slot of targets) {
      if (kinds[slot] !== 'normal') continue;
      const u = random();
      if (u < P.rejectionChance) kinds[slot] = random() < 0.5 ? 'pinUp' : 'pinDown';
      else if (u < P.rejectionChance + dojiChance) kinds[slot] = 'doji';
    }
  };
  const settleAfter = (from: number, count: number) => {
    for (let s = from; s < Math.min(CANDLES, from + count); s++) kinds[s] = 'stabilize';
    // Profit-taking right after the impulse: a long wick in the direction of the move.
    if (from < CANDLES && random() < P.afterImpulseWickChance) kinds[from] = dir > 0 ? 'pinUp' : 'pinDown';
  };

  let pattern: HourPattern;
  const u = random();
  if (regime === 'consolidation') {
    pattern = ctx.nextRegime === 'impulse' && breaksOut(seed, offset, hour + 1, P) ? 'coil' : 'range';
  } else if (regime === 'impulse' && ctx.previousRegime === 'consolidation' && breaksOut(seed, offset, hour, P)) {
    pattern = 'breakout';
  } else {
    pattern = pick(regime === 'impulse' ? P.trendPatterns : P.counterPatterns, u);
  }

  switch (pattern) {
    case 'steady': {
      markRejections(slots);
      spread(slots, 1);
      break;
    }
    case 'burst': {
      const two = random() < 0.2;
      const last = CANDLES - (two ? 3 : 2);
      const at = integer(random, [Math.min(P.impulseEarliestSlot, last), last]);
      const impulse = lerp(P.impulseShare, random());
      kinds[at] = 'impulse';
      share[at] = two ? 0.7 * impulse : impulse;
      if (two) { kinds[at + 1] = 'impulse'; share[at + 1] = 0.3 * impulse; }
      for (let s = 0; s < at; s++) quiet[s] = 0.8; // a few ordinary bars, then the impulse
      const after = at + (two ? 2 : 1);
      if (after < CANDLES && random() < P.afterImpulseWickChance) kinds[after] = dir > 0 ? 'pinUp' : 'pinDown';
      const others = slots.filter((s) => kinds[s] !== 'impulse');
      markRejections(others);
      spread(others, 1 - impulse);
      break;
    }
    case 'pullback': {
      const length = integer(random, P.pullbackLength);
      const start = integer(random, [2, CANDLES - length - 2]);
      const depth = lerp(P.pullbackDepth, random());
      const run = slots.slice(start, start + length);
      run.forEach((s) => { kinds[s] = 'counter'; });
      // The local extreme fails first (false breakout), the pullback ends on a rejection the other way.
      if (random() < Math.min(0.9, 0.2 + 3 * P.rejectionChance)) kinds[start - 1] = dir > 0 ? 'pinUp' : 'pinDown';
      const end = start + length;
      if (random() < 0.55) kinds[end] = dir > 0 ? 'pinDown' : 'pinUp';
      const resume = kinds[end] === 'normal' ? end : end + 1;
      if (resume < CANDLES) boost[resume] = 1.8; // …and the trend resumes
      const others = slots.filter((s) => kinds[s] !== 'counter');
      markRejections(others);
      spread(run, -depth);
      spread(others, 1 + depth);
      break;
    }
    case 'compression': {
      const coil = Math.min(integer(random, P.compressionDuration), CANDLES - 3);
      for (let s = 0; s < coil; s++) { kinds[s] = 'coil'; quiet[s] = P.compressionNoise * (1 - (0.55 * s) / coil); }
      kinds[coil] = 'impulse';
      settleAfter(coil + 1, integer(random, [1, 2]));
      const drift = lerp([0, 0.1], random());
      const breakout = lerp(P.breakoutShare, random());
      share[coil] = breakout;
      spread(slots.slice(0, coil), drift);
      const rest = slots.slice(coil + 1);
      markRejections(rest);
      spread(rest, 1 - drift - breakout);
      break;
    }
    case 'breakout': {
      const at = random() < 0.7 ? 0 : 1;
      if (at === 1) { kinds[0] = 'coil'; quiet[0] = P.compressionNoise * 0.5; }
      kinds[at] = 'impulse';
      settleAfter(at + 1, integer(random, [1, 2]));
      const breakout = lerp(P.breakoutShare, random());
      share[at] = breakout;
      if (at === 1) spread([0], 0.02);
      const rest = slots.slice(at + 1);
      markRejections(rest);
      spread(rest, 1 - breakout - (at === 1 ? 0.02 : 0));
      break;
    }
    case 'range':
    case 'coil': {
      markRejections(slots, P.longWickChance);
      if (pattern === 'coil') {
        // The range narrows into the breakout of the next hour.
        for (let s = 0; s < CANDLES; s++) quiet[s] = 1 - (0.65 * s) / (CANDLES - 1);
        for (let s = 5; s < CANDLES; s++) if (kinds[s] === 'normal') kinds[s] = 'coil';
      }
      spread(slots, 1);
      break;
    }
  }

  // Candle noise: kind × clustered local volatility × heavy tails, zero-sum so the hour keeps its return.
  // A consolidation hour's scale follows the day's trend, so a range breathes like the market around it.
  const unit = regime === 'consolidation' ? Math.max(0.8 * sigma, ctx.trendStep * P.rangeNoise) : sigma;
  const base = regime === 'consolidation' ? 1 : P.bodyNoise;
  let level = normal(random);
  const scale = kinds.map((kind, k) => {
    if (k > 0) level = 0.65 * level + 0.76 * normal(random);
    const clustered = Math.max(-2, Math.min(2, level));
    const local = Math.exp(P.localVolatilityFactor * clustered - (P.localVolatilityFactor * P.localVolatilityFactor) / 2);
    const own = kind === 'impulse' ? 0.3
      : kind === 'pinUp' || kind === 'pinDown' || kind === 'doji' ? 0.3
      : kind === 'coil' ? (regime === 'consolidation' ? base : 1)
      : kind === 'stabilize' ? 0.5 * base
      : kind === 'counter' ? 0.6 * base
      : base * (0.7 + 0.6 * random());
    return unit * own * quiet[k] * local;
  });
  const noise = scale.map((s) => s * normal(random) * (random() < P.tailChance ? P.tailFactor : 1));
  const scaleSum = scale.reduce((a, b) => a + b, 0);
  const noiseSum = noise.reduce((a, b) => a + b, 0);
  for (let k = 0; k < CANDLES; k++) noise[k] -= (noiseSum * scale[k]) / scaleSum;
  // Noise never walks the path far from the hour's own shape.
  let walk = 0, farthest = 0;
  for (const n of noise) { walk += n; farthest = Math.max(farthest, Math.abs(walk)); }
  const limit = Math.max(0.3 * Math.abs(logReturn), 3 * unit);
  if (farthest > limit) for (let k = 0; k < CANDLES; k++) noise[k] *= limit / farthest;
  const steps = share.map((w, k) => logReturn * w + noise[k]);

  // Wicks.
  const cap = Math.min(P.maxWick, 4 * unit);
  const timing = (style: 'wick' | 'sharp' | 'late') => {
    const rise = style === 'wick' ? integer(random, [3, 7]) : style === 'sharp' ? integer(random, [1, 2]) : integer(random, [2, 3]);
    const fall = style === 'wick' ? integer(random, [2, 5]) : style === 'sharp' ? integer(random, [1, 2]) : integer(random, [2, 3]);
    const [low, high] = style === 'late' ? [22, 26] : style === 'sharp' ? [3, 26] : [5, 24];
    const peak = Math.max(rise, Math.min(TICKS - 1 - fall, integer(random, [low, high])));
    return { peak, rise, fall };
  };
  const shapes = kinds.map((kind, k): CandleShape => {
    const body = Math.abs(steps[k]);
    const own = Math.max(body, scale[k], 0.3 * unit);
    const excursions: Excursion[] = [];
    const wick = (side: 1 | -1, height: number, style: 'wick' | 'sharp' | 'late') => {
      excursions.push({ side, height: Math.min(cap, height), ...timing(style) });
    };
    if (kind === 'pinUp' || kind === 'pinDown') {
      wick(kind === 'pinUp' ? 1 : -1, P.wickSizeFactor * unit * lerp([1.2, 2.6], random()), 'wick');
    } else if (kind === 'doji') {
      const size = Math.max(own, 0.5 * unit) * P.wickSizeFactor;
      wick(1, size * lerp([0.8, 1.6], random()), 'wick');
      wick(-1, size * lerp([0.8, 1.6], random()), 'wick');
    } else if (kind === 'impulse') {
      // Impulses close near their extreme; some leave a short wick at the top.
      if (random() < 0.35) wick(steps[k] >= 0 ? 1 : -1, body * lerp([0.08, 0.3], random()), 'late');
    } else {
      const u = random();
      const sweep = kind === 'coil' ? P.sweepChance : regime === 'consolidation' ? 0.5 * P.sweepChance : 0;
      if (u < sweep) {
        // A quick stab out of a narrow range and straight back.
        wick(random() < 0.5 ? 1 : -1, P.wickSizeFactor * unit * lerp([0.5, 1.2], random()), 'sharp');
      } else if (u < sweep + P.longWickChance) {
        wick(random() < 0.5 ? 1 : -1, P.wickSizeFactor * own * lerp([1, 2.4], random()), 'wick');
      } else if (u < sweep + P.longWickChance + P.shadowChance) {
        // An ordinary shadow: most live candles have one.
        wick(random() < 0.5 ? 1 : -1, own * lerp(P.shadowSize, random()), 'wick');
      }
    }
    const reach = excursions.reduce((sum, e) => sum + e.height, 0);
    return {
      kind,
      scale: scale[k],
      intrabar: kind === 'impulse' ? 0.5 : kind === 'coil' ? 0.8 : 1,
      volume: lerp(KIND_VOLUME[kind], random()) * (1 + 6 * reach),
      excursions,
    };
  });
  return { pattern, steps, shapes };
}

// ── One candle's ticks ───────────────────────────────────────────────

export interface RealismTick { price: number; high: number; low: number; volume: number; quoteVolume: number }

/** Height of the excursions at tick i (0 = the open, TICKS = the close — both always 0). */
function excursionAt(excursions: readonly Excursion[], i: number): number {
  let lift = 0;
  for (const e of excursions) {
    const reach = i <= e.peak ? 1 - (e.peak - i) / e.rise : 1 - (i - e.peak) / e.fall;
    if (reach > 0) lift += e.side * e.height * reach;
  }
  return lift;
}

/**
 * Thirty 10s ticks from `open` to `close` along the candle's shape. The last
 * tick IS the close; excursions are zero at both ends, so they shape the
 * wicks and the tape without moving open or close. No tick, and no tick's own
 * shadow, ever reaches further than `maxWick` beyond the body.
 */
export function realisticTicks(
  seed: string, offset: number, hour: number, slot: number,
  open: number, close: number, shape: CandleShape, cluster: number, volumeBase: number,
  { tickWickFactor, maxWick }: Pick<RealismParams, 'tickWickFactor' | 'maxWick'>,
): RealismTick[] {
  const random = seededRandom(seed, 'realism', offset, 'ticks', hour, slot);
  const total = Math.log(close / open);
  const tickSigma = (shape.scale / Math.sqrt(TICKS)) * 1.2 * shape.intrabar;
  const steps: number[] = [];
  for (let i = 0; i < TICKS; i++) steps.push(total / TICKS + tickSigma * normal(random));
  const drift = (steps.reduce((a, b) => a + b, 0) - total) / TICKS;
  const quote = volumeBase * (1 + 18 * Math.abs(total) + 0.6 * (cluster - 1)) * shape.volume * Math.exp(0.35 * normal(random));
  const weights = steps.map((step, i) => Math.exp(0.5 * normal(random))
    * (1 + 40 * Math.abs(step - drift + excursionAt(shape.excursions, i + 1) - excursionAt(shape.excursions, i))));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const ceiling = Math.max(open, close) * Math.exp(maxWick);
  const floor = Math.min(open, close) * Math.exp(-maxWick);
  const ticks: RealismTick[] = [];
  let bridge = 0;
  let previous = open;
  for (let i = 0; i < TICKS; i++) {
    bridge += steps[i] - drift;
    const price = i === TICKS - 1 ? close
      : Math.min(ceiling, Math.max(floor, Math.exp(Math.log(open) + bridge + excursionAt(shape.excursions, i + 1))));
    const shadow = tickSigma * tickWickFactor;
    const high = Math.min(ceiling, Math.max(previous, price) * Math.exp(Math.abs(normal(random)) * shadow * (random() < 0.03 ? 3 : 1)));
    const low = Math.max(floor, Math.min(previous, price) * Math.exp(-Math.abs(normal(random)) * shadow * (random() < 0.03 ? 3 : 1)));
    const quoteVolume = (quote * weights[i]) / weightSum;
    ticks.push({ price, high, low, quoteVolume, volume: quoteVolume / ((previous + price) / 2) });
    previous = price;
  }
  return ticks;
}
