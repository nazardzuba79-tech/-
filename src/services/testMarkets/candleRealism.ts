/**
 * Candle realism: a presentation layer on top of the test-market model.
 *
 *   base simulation → market profile → intrabar realism → OHLC candles
 *
 * The model (testMarketSimulation.ts) decides everything that matters: the
 * regime of every hour and every hour's close-to-close return. Those fix
 * every hourly anchor price, the block totals, the listing schedule and the
 * final price. This layer never touches any of that. Inside one hour it only
 * changes HOW the hour's fixed move is travelled, and how the candles look
 * on the way:
 *
 *   - compression: a quiet run of small bodies and narrow ranges;
 *   - impulse: a full-bodied bar in the hour's direction, usually out of a
 *     quiet run, sometimes two in a row;
 *   - counter: a short counter-trend series (a local pullback) that the rest
 *     of the hour makes back;
 *   - wick: a small body under one long shadow (rejection, a flush that is
 *     bought back, a stop hunt, a sweep of the quiet range);
 *   - normal: the model's own candle.
 *
 * A profile is only a set of numbers for these behaviours (see PROFILES).
 * Guarantees, all covered by tests:
 *   - an hour's twelve 5m returns still sum exactly to the hour's return, so
 *     every hour opens and closes on the model's anchor, whatever the profile;
 *   - a long shadow is the extreme of a single 10s tick (its high or low),
 *     never a trade price, so the tape and the last price follow the path;
 *   - the layer draws from its own seeded stream, leaving the model's streams
 *     untouched: with realism off the output is byte-for-byte the model's,
 *     and the same seed and profile always give the same candles;
 *   - a shadow sits on one tick inside its candle, so a forming candle shows
 *     it only after that tick has passed, and nothing leaks from the future.
 */
import type { Regime } from './testMarketSimulation';

export const SIMULATION_PROFILES = ['CALM_TREND', 'IMPULSE_TREND', 'PULLBACK_TREND', 'COMPRESSION_BREAKOUT'] as const;
export type SimulationProfile = typeof SIMULATION_PROFILES[number];

/**
 * The profile of the N-th listing (1-based): the four profiles in a fixed
 * cycle. Listing #1 → CALM_TREND, #2 → IMPULSE_TREND, #3 → PULLBACK_TREND,
 * #4 → COMPRESSION_BREAKOUT, #5 → CALM_TREND, and so on without end.
 */
export function profileForListingOrdinal(ordinal: number): SimulationProfile {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error('Listing ordinal must be a positive integer');
  return SIMULATION_PROFILES[(ordinal - 1) % SIMULATION_PROFILES.length];
}

export function isSimulationProfile(value: unknown): value is SimulationProfile {
  return typeof value === 'string' && (SIMULATION_PROFILES as readonly string[]).includes(value);
}

export interface CandleRealismConfig {
  /** Chance an hour has an impulse bar (sideways hours: a third of it). */
  impulseChance: number;
  /** Extra impulse body, in units of the candle's model volatility. */
  impulseBodyFactor: number;
  /** Chance an impulse runs for a second bar. */
  impulseRunChance: number;
  /** Chance, per candle, of a long shadow (raised after an impulse and at a pullback's end). */
  longWickChance: number;
  /** Long-shadow length, in units of the candle's model volatility. */
  wickSizeFactor: number;
  /** Chance a directional hour contains a short counter-trend series. */
  pullbackChance: number;
  /** Length range of that series, in 5m bars. */
  pullbackLength: readonly [number, number];
  /** Size of each counter-trend bar, in units of the candle's model volatility. */
  pullbackDepth: number;
  /** Chance an hour contains a quiet run before its move. */
  compressionChance: number;
  /** Length range of the quiet run, in 5m bars. */
  compressionLength: readonly [number, number];
  /** Share of the model's body a quiet bar keeps. */
  compressionBody: number;
  /** Chance the quiet run ends with a shadow swept beyond its range, against the coming move. */
  sweepChance: number;
  /** Chance of a one- or two-bar pause right after an impulse. */
  postImpulsePauseChance: number;
  /** Chance an hour holds a second quiet-run → push structure. */
  secondStructureChance: number;
  /** Size spread of ordinary bodies (log-normal σ): 0 keeps the model's sizes. */
  bodyDispersion: number;
  /** Tick-level volatility multiplier for the whole profile. */
  volatilityFactor: number;
  /** Changes the realism pattern without changing the model's history. */
  realismSeedOffset: string;
}

export const PROFILES: Readonly<Record<SimulationProfile, Readonly<CandleRealismConfig>>> = Object.freeze({
  /** Calm trend: mostly small and medium candles, short shadows, few strong pushes, brief pauses. */
  CALM_TREND: {
    impulseChance: 0.3, impulseBodyFactor: 1.4, impulseRunChance: 0.1,
    longWickChance: 0.05, wickSizeFactor: 1.8,
    pullbackChance: 0.2, pullbackLength: [1, 2], pullbackDepth: 0.8,
    compressionChance: 0.45, compressionLength: [2, 3], compressionBody: 0.35,
    sweepChance: 0, postImpulsePauseChance: 0.25, secondStructureChance: 0.15, bodyDispersion: 0.35,
    volatilityFactor: 0.9, realismSeedOffset: 'realism-v1',
  },
  /** Impulse trend: frequent big trend candles out of short consolidations, long shadows on some bars. */
  IMPULSE_TREND: {
    impulseChance: 0.8, impulseBodyFactor: 3.6, impulseRunChance: 0.35,
    longWickChance: 0.1, wickSizeFactor: 3.2,
    pullbackChance: 0.3, pullbackLength: [1, 2], pullbackDepth: 1.1,
    compressionChance: 0.7, compressionLength: [2, 4], compressionBody: 0.2,
    sweepChance: 0.2, postImpulsePauseChance: 0.35, secondStructureChance: 0.45, bodyDispersion: 0.55,
    volatilityFactor: 1.1, realismSeedOffset: 'realism-v1',
  },
  /** Pullback trend: counter-trend series, rejection candles, longer shadows, then back on the path. */
  PULLBACK_TREND: {
    impulseChance: 0.5, impulseBodyFactor: 2.4, impulseRunChance: 0.2,
    longWickChance: 0.15, wickSizeFactor: 3.6,
    pullbackChance: 0.75, pullbackLength: [2, 4], pullbackDepth: 1.6,
    compressionChance: 0.3, compressionLength: [2, 3], compressionBody: 0.3,
    sweepChance: 0.35, postImpulsePauseChance: 0.2, secondStructureChance: 0.15, bodyDispersion: 0.45,
    volatilityFactor: 1.05, realismSeedOffset: 'realism-v1',
  },
  /** Compression → breakout: long quiet ranges, a sweep beyond them, strong breakouts, a pause after. */
  COMPRESSION_BREAKOUT: {
    impulseChance: 0.85, impulseBodyFactor: 4.2, impulseRunChance: 0.35,
    longWickChance: 0.06, wickSizeFactor: 2.8,
    pullbackChance: 0.12, pullbackLength: [1, 2], pullbackDepth: 0.9,
    compressionChance: 0.92, compressionLength: [3, 6], compressionBody: 0.12,
    sweepChance: 0.6, postImpulsePauseChance: 0.55, secondStructureChance: 0.3, bodyDispersion: 0.3,
    volatilityFactor: 0.9, realismSeedOffset: 'realism-v1',
  },
});

/** Per-asset setting: a profile name, and optionally field overrides; `false` → the plain model. */
export interface CandleRealismSetting { profile?: SimulationProfile; overrides?: Partial<CandleRealismConfig> }

export function resolveCandleRealism(profile: SimulationProfile | undefined, setting: CandleRealismSetting | false | undefined): CandleRealismConfig | null {
  if (setting === false) return null;
  const name = setting?.profile ?? profile ?? 'CALM_TREND';
  return { ...PROFILES[name], ...(setting?.overrides ?? {}) };
}

export type CandleMode = 'normal' | 'impulse' | 'counter' | 'wick' | 'compression';

/** How one 5m candle is drawn. `noise` scales its tick-level wiggle; `spike` is one long shadow on one tick. */
export interface CandleShape {
  mode: CandleMode;
  noise: number;
  spike: { tick: number; side: 'up' | 'down'; size: number } | null;
}

export const PLAIN_SHAPE: Readonly<CandleShape> = Object.freeze({ mode: 'normal', noise: 1, spike: null });

/** Standard normal from the realism stream, clamped like the model's. */
function gaussian(random: () => number): number {
  let u = random();
  while (u <= Number.EPSILON) u = random();
  return Math.max(-3.2, Math.min(3.2, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())));
}

const NOISE_SCALE: Record<CandleMode, number> = { normal: 1, impulse: 1.1, counter: 1, wick: 0.85, compression: 0.35 };

/**
 * Reshape one hour. `steps` are the model's twelve 5m log returns (summing to
 * the hour's return); the result sums to the same total. `sigma` is the
 * model's per-candle volatility for the hour. `random` must be the realism
 * stream for this hour, never one of the model's own streams.
 */
export function shapeHour(random: () => number, regime: Regime, steps: readonly number[], sigma: number,
  config: CandleRealismConfig, ticksPerCandle: number): { steps: number[]; shapes: CandleShape[] } {
  const n = steps.length;
  const total = steps.reduce((a, b) => a + b, 0);
  const modes: CandleMode[] = Array(n).fill('normal');
  const direction = regime === 'impulse' ? 1 : regime === 'pullback' ? -1 : random() < 0.5 ? 1 : -1;
  const between = ([min, max]: readonly [number, number]) => min + Math.floor(random() * (max - min + 1));
  const spikes: (CandleShape['spike'])[] = Array(n).fill(null);

  // 1. A quiet run, then (often) the push out of it, and sometimes a pause after. Up to two per hour.
  const compressionChance = config.compressionChance * (regime === 'consolidation' ? 1.2 : regime === 'pullback' ? 0.7 : 1);
  const impulseChance = config.impulseChance * (regime === 'consolidation' ? 0.35 : 1);
  const structures = random() < config.secondStructureChance ? 2 : 1;
  for (let structure = 0; structure < structures; structure++) {
    let impulseAt = -1;
    if (random() < compressionChance) {
      const length = Math.min(between(config.compressionLength), n - 2);
      const starts: number[] = [];
      for (let s = 0; s + length < n; s++) if (modes.slice(s, s + length + 1).every((m) => m === 'normal')) starts.push(s);
      if (starts.length) {
        const start = starts[Math.floor(random() * starts.length)];
        for (let k = start; k < start + length; k++) modes[k] = 'compression';
        impulseAt = start + length;
        // A sweep beyond the quiet range, against the move that follows.
        if (random() < config.sweepChance) spikes[start + length - 1] = { tick: 0, side: direction > 0 ? 'down' : 'up', size: 0.75 };
      }
    }
    if (random() < impulseChance) {
      if (impulseAt < 0) {
        const free = modes.map((m, k) => (m === 'normal' ? k : -1)).filter((k) => k >= 0);
        if (!free.length) continue;
        impulseAt = free[Math.floor(random() * free.length)];
      }
      modes[impulseAt] = 'impulse';
      let last = impulseAt;
      if (regime !== 'consolidation' && last + 1 < n && modes[last + 1] === 'normal' && random() < config.impulseRunChance) modes[++last] = 'impulse';
      if (random() < config.postImpulsePauseChance) {
        const pause = 1 + (random() < 0.5 ? 1 : 0);
        for (let k = last + 1; k <= last + pause && k < n; k++) if (modes[k] === 'normal') modes[k] = 'compression';
      }
    }
  }

  // 2. A short counter-trend series inside a directional hour, on free bars.
  if (regime !== 'consolidation' && random() < config.pullbackChance) {
    const length = between(config.pullbackLength);
    const starts: number[] = [];
    for (let s = 0; s + length <= n; s++) if (modes.slice(s, s + length).every((m) => m === 'normal')) starts.push(s);
    if (starts.length) {
      const start = starts[Math.floor(random() * starts.length)];
      for (let k = start; k < start + length; k++) modes[k] = 'counter';
      // The pullback often ends on a rejection: a shadow against it, then back to the path.
      if (random() < 0.5) spikes[start + length - 1] = { tick: 0, side: direction > 0 ? 'down' : 'up', size: 1 };
    }
  }

  // 3. Long shadows where a market would print them.
  for (let k = 0; k < n; k++) {
    if (modes[k] === 'compression' || spikes[k]) continue;
    const afterImpulse = k > 0 && modes[k - 1] === 'impulse';
    const pullbackEnd = regime === 'pullback' && k >= n - 3;
    const chance = config.longWickChance * (afterImpulse ? 3 : pullbackEnd ? 2 : 1) * (modes[k] === 'impulse' ? 0.6 : 1);
    if (random() >= chance) continue;
    // Profit-taking above a push up, a flush bought back under a push down, either side in a range.
    const up = afterImpulse || modes[k] === 'impulse' ? direction > 0
      : regime === 'impulse' ? random() < 0.6 : regime === 'pullback' ? random() < 0.3 : random() < 0.5;
    if (modes[k] === 'normal') modes[k] = 'wick';
    spikes[k] = { tick: 0, side: up ? 'up' : 'down', size: modes[k] === 'impulse' ? 0.6 : 1 };
  }

  // 4. Returns: quiet bars give up most of their move, wick bars keep a small
  // body, counter bars step against the hour, impulses get an extra push in
  // its direction; ordinary bars and impulses carry the balance, so the hour
  // still closes exactly where the model says.
  const next = steps.map((step, k) => {
    switch (modes[k]) {
      case 'compression': return step * config.compressionBody;
      case 'wick': return step * 0.4;
      case 'counter': return -direction * config.pullbackDepth * sigma * (0.7 + 0.6 * random());
      case 'impulse': return step + direction * config.impulseBodyFactor * sigma * (0.8 + 0.6 * random());
      default: return step * Math.exp(config.bodyDispersion * gaussian(random) - config.bodyDispersion ** 2 / 2);
    }
  });
  let payers = modes.map((m, k) => (m === 'normal' || m === 'impulse' ? k : -1)).filter((k) => k >= 0);
  if (!payers.length) payers = modes.map((m, k) => (m !== 'compression' ? k : -1)).filter((k) => k >= 0);
  if (!payers.length) payers = [n - 1];
  const residual = total - next.reduce((a, b) => a + b, 0);
  for (const k of payers) next[k] += residual / payers.length;

  // 5. Shapes: noise per mode and profile, shadow length in model volatility,
  // and a wick-dominant bar keeps its shadow at least twice its body.
  const shapes = modes.map((mode, k): CandleShape => {
    const spike = spikes[k];
    if (!spike) return { mode, noise: NOISE_SCALE[mode] * config.volatilityFactor, spike: null };
    let size = config.wickSizeFactor * sigma * (0.9 + 1.4 * random()) * spike.size;
    if (mode === 'wick') size = Math.max(size, 2.2 * Math.abs(next[k]));
    return { mode, noise: NOISE_SCALE[mode] * config.volatilityFactor, spike: { tick: 3 + Math.floor(random() * (ticksPerCandle - 6)), side: spike.side, size } };
  });
  return { steps: next, shapes };
}
