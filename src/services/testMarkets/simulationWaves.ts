/**
 * POST-LISTING WAVE STRUCTURE — how a test asset's HOURS are arranged inside
 * each block, never where the block ends.
 *
 * The base simulation (testMarketSimulation.ts) fixes every block's total:
 * the first 48 hours, then each simulated day. Its hours are drawn one by one
 * (impulse / consolidation / pullback), so a block reads as a staircase: long
 * runs of green hours, pullbacks of a fixed −4% and an almost entirely green
 * 4h chart. This layer keeps each block's total EXACTLY and re-arranges the
 * hours it covers into market phases:
 *
 *   launch (price discovery) → impulse leg → correction (partial profit
 *   taking, a flush that is partly bought back) or a short pause →
 *   accumulation (a range) → breakout into the next impulse leg → …
 *
 * Leg lengths, depths and sizes are seeded, so no pattern repeats at a fixed
 * interval. An impulse leg may hold a red hour; a long correction may hold a
 * relief bounce. A correction gives back a share of the leg before it, capped
 * in price terms, so a pullback reads like profit taking, not a collapse.
 *
 * What it can never change (all tested):
 *   - a block's total log return, so every block and day anchor — the price at
 *     48h and at the end of every later day — is identical to the base path;
 *   - any hour before `fromHour`: the suffix it re-arranges starts there and
 *     carries exactly the return the base path still had left in that block;
 *   - determinism: every draw comes from seededRandom(seed, 'waves', …).
 *
 * Every timeframe is still aggregated from the one canonical 5m series, so
 * 15m, 1h and 4h tell the same history.
 */
import type { Regime } from './testMarketSimulation';
import type { SimulationProfile } from './simulationRealism';
import { normal, seededRandom } from './simulationRandom';

/** Opt-in configuration (TestAssetConfig.marketStructure). */
export interface MarketStructureConfig {
  /** First instant the structure applies (epoch ms). Rounded up to the next listing hour; earlier hours keep the base path. */
  from: number;
}

export type WavePhase = 'launch' | 'impulse' | 'breakout' | 'dip' | 'correction' | 'bounce' | 'accumulation';

/** One re-arranged hour. */
export interface WaveHour {
  phase: WavePhase;
  regime: Regime;
  logReturn: number;
  /** Intra-hour character (simulationRealism.ts) for this hour. */
  profile: SimulationProfile;
  /** Multiplies the hour's candle volatility (price discovery is wider, ranges are calmer). */
  volatility: number;
  /** Multiplies the hour's volume. */
  volume: number;
  /** A sharp sell-off inside the hour that is partly bought back: a long lower wick. */
  flush: boolean;
  /** Aggressive buying exhausts inside the hour: a long upper wick. */
  exhaustion: boolean;
  /**
   * The block's typical impulse step per 5m candle (log units). A range's
   * candles breathe in proportion to the moves around it, so accumulation
   * between +30% hours is not drawn as a flat line.
   */
  trendStep: number;
}

type LegKind = 'impulse' | 'correction' | 'pause' | 'accumulation';
interface Leg { kind: LegKind; hours: number }

const integer = (random: () => number, low: number, high: number) => low + Math.floor(random() * (high - low + 1));
const between = (random: () => number, low: number, high: number) => low + (high - low) * random();

/**
 * The leg after `previous`. An impulse is followed by a correction, a short
 * pause or a range — and at most two impulse legs (with a pause between
 * them) run before a correction or a range of 3+ hours, long enough to own
 * at least one 4h candle, so the 4h chart shows the struggle too.
 */
function nextLeg(random: () => number, previous: LegKind, impulsesSinceRest: number): Leg {
  if (previous === 'impulse') {
    if (impulsesSinceRest < 2 && random() < 0.25) return { kind: 'pause', hours: integer(random, 1, 2) };
    return random() < 0.6 ? { kind: 'correction', hours: integer(random, 4, 7) } : { kind: 'accumulation', hours: integer(random, 4, 7) };
  }
  if (previous === 'correction') {
    return random() < 0.45 ? { kind: 'accumulation', hours: integer(random, 3, 6) } : { kind: 'impulse', hours: integer(random, 2, 5) };
  }
  return { kind: 'impulse', hours: integer(random, 2, 5) };
}

/** The legs filling `length` hours; a block that starts at the listing opens with price discovery. */
function legsFor(random: () => number, length: number, launch: boolean): Leg[] {
  const legs: Leg[] = [];
  let used = 0;
  let impulses = 0;
  if (launch) {
    legs.push({ kind: 'impulse', hours: Math.min(length, 3) });
    used = legs[0].hours;
    impulses = 1;
  }
  // A later block does not always open with an impulse: the day boundary is
  // invisible to the market, so it may open mid-correction or in a range.
  const u = random();
  const opening: LegKind = u < 0.4 ? 'accumulation' : u < 0.7 ? 'impulse' : 'correction';
  while (used < length) {
    const leg = nextLeg(random, legs.length ? legs[legs.length - 1].kind : opening, impulses);
    if (leg.kind === 'impulse') impulses += 1;
    if (leg.kind === 'correction' || leg.kind === 'accumulation') impulses = 0;
    leg.hours = Math.min(leg.hours, length - used);
    legs.push(leg);
    used += leg.hours;
  }
  return legs;
}

/** Hour weight inside an impulse leg: it builds, peaks in the middle and fades. */
const legCurve = (i: number, n: number) => (n <= 2 ? 1 : 0.7 + 0.6 * Math.sin((Math.PI * (i + 0.5)) / n));

/** Impulse hours vary in character: clean bursts, trends through pullbacks, coils that break out. */
function impulseProfile(random: () => number): SimulationProfile {
  const u = random();
  // Every trending hour already pauses on 15m (pauseInsideHour); on top, some run in clean
  // bursts, many trend through short pullbacks, a few coil first.
  return u < 0.65 ? 'IMPULSE_TREND' : u < 0.9 ? 'PULLBACK_TREND' : 'COMPRESSION_BREAKOUT';
}

/** A draft hour: impulse hours carry a weight `up`; every other hour carries an absolute log return. */
interface Draft extends Omit<WaveHour, 'logReturn' | 'trendStep'> { up: number; fixed: number; leg: number }

/**
 * `length` hours (relative hours `start` … `start + length − 1` of block
 * `blockIndex`) whose log returns sum EXACTLY to `total`.
 *
 * Pass 1 sizes an impulse hour so the block total holds; pass 2 turns every
 * correction, dip and bounce into an absolute move (a correction capped at
 * −15%…−45% in price), keeps ranges absolute, and re-solves the impulse size
 * on what is left. A last proportional nudge removes floating error.
 */
export function waveHours(seed: string, blockIndex: number, start: number, length: number, total: number): WaveHour[] {
  if (length <= 0) return [];
  const random = seededRandom(seed, 'waves', blockIndex, start);
  const launch = blockIndex === 0 && start === 0;
  const legs = legsFor(random, length, launch);

  // Relative plan: impulse weights, and corrections as a share of the leg before them.
  const drafts: Draft[] = [];
  const share: number[] = []; // retrace in units of an impulse hour (negative) or bounce (positive)
  const caps: number[] = [];  // per correction leg: deepest allowed give-back, log units
  let lastLegGain = 1;
  legs.forEach((leg, legIndex) => {
    const n = leg.hours;
    if (leg.kind === 'impulse') {
      const isLaunch = launch && legIndex === 0;
      // A red hour interrupts a long leg (always from four hours) — never its first or last hour.
      const dipAt = isLaunch ? 1 : n >= 4 || (n === 3 && random() < 0.4) ? integer(random, 1, n - 2) : -1;
      const weights = Array.from({ length: n }, (_, i) => legCurve(i, n) * Math.exp(0.35 * normal(random)) * (isLaunch && i === 0 ? 1.4 : 1));
      const gain = weights.reduce((a, b) => a + b, 0);
      const breakout = !isLaunch && legIndex > 0 && legs[legIndex - 1].kind === 'accumulation';
      for (let i = 0; i < n; i++) {
        const isDip = i === dipAt;
        const phase: WavePhase = isLaunch ? 'launch' : isDip ? 'dip' : i === 0 && breakout ? 'breakout' : 'impulse';
        drafts.push({
          phase, regime: isDip ? 'pullback' : 'impulse', leg: legIndex, fixed: 0,
          up: isDip ? 0 : weights[i],
          profile: isLaunch ? 'PULLBACK_TREND' : isDip ? 'PULLBACK_TREND' : phase === 'breakout' ? 'COMPRESSION_BREAKOUT' : impulseProfile(random),
          // Trending hours are wide enough that their 15m candles pause and dip, not climb a ladder.
          volatility: isLaunch ? [2.2, 1.9, 1.7][i] ?? 1.6 : phase === 'breakout' ? 1.6 : isDip ? 1.2 : between(random, 1.5, 2.1),
          volume: isLaunch ? [1.9, 1.5, 1.3][i] ?? 1.2 : phase === 'breakout' ? 2.1 : isDip ? 1.15 : 1.05 + 0.25 * legCurve(i, n),
          flush: isDip && random() < 0.55,
          exhaustion: !isDip && (i === n - 1 || (isLaunch && i === 0)) && random() < 0.75,
        });
        // Early profit taking gives back part of the leg so far.
        share.push(isDip ? -between(random, 0.15, 0.35) * (gain / n) * (isLaunch ? 1.4 : 1) : 0);
        caps.push(between(random, 0.05, 0.12));
      }
      lastLegGain = gain;
    } else if (leg.kind === 'correction' || leg.kind === 'pause') {
      // Partial profit taking: 30–55% of the last leg, or one or two red hours.
      const depth = leg.kind === 'pause' ? between(random, 0.1, 0.22) : between(random, 0.3, 0.55);
      const cap = leg.kind === 'pause' ? between(random, 0.04, 0.12) : between(random, 0.15, 0.45);
      // Longer corrections hold a relief bounce more often than not.
      const bounceAt = n >= 3 && random() < (n >= 5 ? 0.75 : 0.5) ? integer(random, 1, n - 1) : -1;
      const weights = Array.from({ length: n }, (_, i) => (i === bounceAt ? 0 : Math.exp(0.4 * normal(random))));
      const sum = weights.reduce((a, b) => a + b, 0) || 1;
      const flushAt = integer(random, 0, n - 1);
      for (let i = 0; i < n; i++) {
        const isBounce = i === bounceAt;
        drafts.push({
          phase: isBounce ? 'bounce' : leg.kind === 'pause' ? 'dip' : 'correction',
          regime: isBounce ? 'impulse' : 'pullback', leg: legIndex, up: 0, fixed: 0,
          profile: 'PULLBACK_TREND', volatility: isBounce ? 1 : 1.1, volume: isBounce ? 0.95 : 1.2,
          flush: !isBounce && (i === flushAt || random() < 0.2), exhaustion: isBounce && random() < 0.5,
        });
        share.push(isBounce ? between(random, 0.15, 0.35) * depth * lastLegGain : -(depth * lastLegGain * weights[i]) / sum);
        caps.push(cap);
      }
    } else {
      // Accumulation: a range that breathes, drifting slightly, on lower volume.
      const drift = between(random, -0.007, 0.006);
      for (let i = 0; i < n; i++) {
        // A range right after a leg opens on profit taking; the last hours coil flat
        // into the breakout; the hours between swing both ways.
        const coil = i >= n - 2;
        const takeProfit = i === 0 && legIndex > 0 && legs[legIndex - 1].kind === 'impulse';
        drafts.push({
          phase: 'accumulation', regime: 'consolidation', leg: legIndex, up: 0,
          fixed: takeProfit ? -between(random, 0.01, 0.035)
            : coil ? between(random, -0.008, 0.008) : drift + between(random, 0.012, 0.04) * (random() < 0.5 ? -1 : 1),
          profile: coil ? 'COMPRESSION_BREAKOUT' : 'PULLBACK_TREND',
          volatility: 0.9, volume: 0.6 + 0.2 * random(), flush: random() < 0.12, exhaustion: false,
        });
        share.push(0);
        caps.push(0);
      }
    }
  });

  const sumUp = drafts.reduce((a, d) => a + d.up, 0);
  const sumShare = share.reduce((a, b) => a + b, 0);
  const sumRange = drafts.reduce((a, d) => a + d.fixed, 0);
  // A floor on the typical impulse hour keeps late, slow blocks from going flat.
  const impulseHours = drafts.filter((d) => d.up > 0).length || 1;
  const minUnit = (0.02 * impulseHours) / Math.max(sumUp, 1e-9);

  // Pass 1: the impulse size that would carry the block on its own.
  const unit1 = sumUp + sumShare > 0 ? Math.max(minUnit, (total - sumRange) / (sumUp + sumShare)) : minUnit;
  // Pass 2: corrections, dips and bounces become absolute and capped by leg.
  const legTotals = new Map<number, number>();
  drafts.forEach((d, i) => { if (share[i] < 0) legTotals.set(d.leg, (legTotals.get(d.leg) ?? 0) + share[i] * unit1); });
  drafts.forEach((d, i) => {
    if (share[i] === 0) return;
    const legTotal = legTotals.get(d.leg) ?? 0;
    const cap = Math.log(1 - caps[i]);
    const scale = share[i] < 0 && legTotal < cap ? cap / legTotal : 1;
    d.fixed += share[i] * unit1 * scale;
  });
  const fixed = drafts.reduce((a, d) => a + d.fixed, 0);
  let unit = sumUp > 0 ? (total - fixed) / sumUp : 0;
  if (unit < minUnit && sumUp > 0) {
    // A slow or falling block: rallies stay rallies (at least the minimum
    // size) and every falling hour — corrections, profit taking, a range's
    // downward drift — deepens together to carry the block's total.
    const giveBack = drafts.reduce((a, d) => a + Math.min(0, d.fixed), 0);
    const extra = total - fixed - minUnit * sumUp;
    if (giveBack < 0 && extra < 0 && extra / giveBack <= 6) {
      const deepen = 1 + extra / giveBack;
      drafts.forEach((d) => { if (d.fixed < 0) d.fixed *= deepen; });
      unit = minUnit;
    }
  }
  const raw = drafts.map((d) => unit * d.up + d.fixed);
  // No single hour runs away from the rest of the block: an impulse hour is
  // capped at 1.8× the block's typical impulse hour, the excess carried by the
  // other impulse hours (a few passes converge).
  const rising = raw.map((value, i) => (drafts[i].up > 0 ? i : -1)).filter((i) => i >= 0);
  if (rising.length > 1) {
    const cap = (1.8 * rising.reduce((sum, i) => sum + Math.max(raw[i], 0), 0)) / rising.length;
    for (let pass = 0; pass < 6; pass++) {
      let excess = 0;
      for (const i of rising) if (raw[i] > cap) { excess += raw[i] - cap; raw[i] = cap; }
      const room = rising.filter((i) => raw[i] < cap);
      const roomSum = room.reduce((sum, i) => sum + Math.max(raw[i], 1e-9), 0);
      if (excess <= 0 || !room.length) break;
      for (const i of room) raw[i] += (excess * Math.max(raw[i], 1e-9)) / roomSum;
    }
  }
  // Exact: the remaining block total holds to floating precision.
  const error = raw.reduce((a, b) => a + b, 0) - total;
  const weight = raw.reduce((sum, value) => sum + Math.abs(value), 0) || 1;
  const trendStep = Math.max(0.004, (unit * sumUp) / impulseHours / 12);
  return drafts.map(({ up: _up, fixed: _fixed, leg: _leg, ...hour }, i) => ({
    ...hour, trendStep, logReturn: raw[i] - (error * Math.abs(raw[i])) / weight,
  }));
}

const BUCKET = 3; // 5m candles per 15m candle

/**
 * A strong trending hour rarely climbs its four 15m candles in a straight
 * line: in most of them one (sometimes two) of those candles, never the
 * first, becomes a pause that closes a little lower, and the move it gave up
 * is carried by the others. The
 * hour's total is unchanged. Only for hours whose 15m candles align with
 * the hour (`aligned`); anything else is returned as is.
 */
export function pauseInsideHour(seed: string, hour: number, wave: WaveHour, steps: readonly number[], aligned: boolean): number[] {
  const out = steps.slice();
  const total = out.reduce((a, b) => a + b, 0);
  if (!aligned || out.length !== 4 * BUCKET || wave.regime !== 'impulse' || total <= 0.02) return out;
  const random = seededRandom(seed, 'waves', 'pause', hour);
  // Most trending hours pause; some run straight through (then the next one usually pauses).
  if (random() < 0.22) return capCandles(out, out.map((_, slot) => slot), total);
  const buckets = [1, 2, 3];
  const first = buckets[Math.floor(random() * buckets.length)];
  const chosen = new Set([first]);
  if (total > 0.25 && random() < 0.25) chosen.add(buckets.filter((b) => b !== first)[Math.floor(random() * 2)]);
  let removed = 0;
  for (const bucket of chosen) {
    const slots = [0, 1, 2].map((i) => bucket * BUCKET + i);
    const sum = slots.reduce((a, slot) => a + out[slot], 0);
    // A pause that closes a little lower: a small red candle, never a green step.
    const target = total * between(random, -0.07, -0.01);
    const delta = target - sum;
    const weights = slots.map(() => 0.4 + random());
    const weightSum = weights.reduce((a, b) => a + b, 0);
    slots.forEach((slot, i) => { out[slot] += (delta * weights[i]) / weightSum; });
    removed -= delta;
  }
  // The others carry what the pause gave up — spread over their rising candles,
  // flattened (square root) so no single candle turns into a spike.
  const others = out.map((_, slot) => slot).filter((slot) => !chosen.has(Math.floor(slot / BUCKET)));
  const weights = others.map((slot) => Math.sqrt(Math.max(out[slot], 0)) + 0.25 * Math.sqrt(Math.abs(total) / out.length));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  others.forEach((slot, i) => { out[slot] += (removed * weights[i]) / weightSum; });
  return capCandles(out, others, total);
}

/**
 * No single 5m candle carries more than 35% of its hour's move, and no 15m
 * candle more than half of it: a breakout stays dramatic without one bar that
 * doubles the price. The excess goes to the hour's other rising candles
 * (outside the capped 15m candle); the total is unchanged.
 */
function capCandles(steps: number[], slots: number[], total: number): number[] {
  const spread = (excess: number, targets: number[]) => {
    if (excess <= 0 || !targets.length) return;
    const weights = targets.map((slot) => Math.max(steps[slot], 0) + 0.02 * total);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    targets.forEach((slot, i) => { steps[slot] += (excess * weights[i]) / weightSum; });
  };
  const candleCap = 0.35 * total, bucketCap = 0.5 * total;
  const bucketOf = (slot: number) => Math.floor(slot / BUCKET);
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    let excess = 0;
    for (const slot of slots) if (steps[slot] > candleCap) { excess += steps[slot] - candleCap; steps[slot] = candleCap; changed = true; }
    spread(excess, slots.filter((slot) => steps[slot] < candleCap));
    for (let bucket = 0; bucket < steps.length / BUCKET; bucket++) {
      const members = slots.filter((slot) => bucketOf(slot) === bucket);
      const sum = members.reduce((a, slot) => a + steps[slot], 0);
      if (sum <= bucketCap) continue;
      const rising = members.filter((slot) => steps[slot] > 0);
      const risingSum = rising.reduce((a, slot) => a + steps[slot], 0);
      const cut = sum - bucketCap;
      rising.forEach((slot) => { steps[slot] -= (cut * steps[slot]) / risingSum; });
      spread(cut, slots.filter((slot) => bucketOf(slot) !== bucket));
      changed = true;
    }
    if (!changed) break;
  }
  return steps;
}
