/**
 * Optional deterministic two-hour events for a simulated asset. The first
 * hour sells off and partially recovers; the next returns to the ORIGINAL
 * second-hour anchor after an upper-wick excursion. Other hours are untouched.
 * Everything is an actual canonical tick, including the low and the peak.
 */
import { normal, seededRandom } from './simulationRandom';

export interface CyclicImpulseConfig {
  /** First shock hour, aligned to an hour from the asset's listing. */
  anchorAt: number;
  /** Fixed cutover. Ticks already completed at this instant are preserved. */
  notBefore: number;
  /** Start-to-start spacing. A cycle occupies two hours. */
  periodHours: number;
}

export interface CyclicImpulsePreset {
  name: string;
  /** Low = shock-hour open × (1 − dropFraction). */
  dropFraction: number;
  /** Fraction of the absolute drop recovered before the shock hour closes. */
  recoveryFraction: number;
  /** Timing within the still-unshown part of the shock hour. */
  lowAt: number;
  reboundAt: number;
  /** Fraction of the partial rebound given back in a second, shallower dip. */
  retestDepth: number;
  /** Recovery-hour high above its larger body endpoint. */
  upperWickFraction: number;
  peakAt: number;
}

/** Ten intentionally different scenarios; the first is exactly 0.60 → 0.80. */
export const CYCLIC_IMPULSE_PRESETS: readonly Readonly<CyclicImpulsePreset>[] = Object.freeze([
  { name: 'deep-flush', dropFraction: 0.40, recoveryFraction: 0.50, lowAt: 0.24, reboundAt: 0.59, retestDepth: 0.28, upperWickFraction: 0.11, peakAt: 0.68 },
  { name: 'fast-rejection', dropFraction: 0.28, recoveryFraction: 0.40, lowAt: 0.18, reboundAt: 0.52, retestDepth: 0.18, upperWickFraction: 0.07, peakAt: 0.57 },
  { name: 'double-dip', dropFraction: 0.32, recoveryFraction: 0.55, lowAt: 0.29, reboundAt: 0.55, retestDepth: 0.44, upperWickFraction: 0.14, peakAt: 0.74 },
  { name: 'late-flush', dropFraction: 0.38, recoveryFraction: 0.35, lowAt: 0.43, reboundAt: 0.69, retestDepth: 0.22, upperWickFraction: 0.09, peakAt: 0.63 },
  { name: 'shallow-grind', dropFraction: 0.24, recoveryFraction: 0.30, lowAt: 0.36, reboundAt: 0.64, retestDepth: 0.34, upperWickFraction: 0.06, peakAt: 0.80 },
  { name: 'capitulation-rebound', dropFraction: 0.45, recoveryFraction: 0.60, lowAt: 0.21, reboundAt: 0.62, retestDepth: 0.19, upperWickFraction: 0.18, peakAt: 0.71 },
  { name: 'stepped-recovery', dropFraction: 0.35, recoveryFraction: 0.45, lowAt: 0.33, reboundAt: 0.58, retestDepth: 0.38, upperWickFraction: 0.12, peakAt: 0.60 },
  { name: 'deep-retest', dropFraction: 0.42, recoveryFraction: 0.25, lowAt: 0.27, reboundAt: 0.53, retestDepth: 0.46, upperWickFraction: 0.16, peakAt: 0.77 },
  { name: 'brief-dislocation', dropFraction: 0.26, recoveryFraction: 0.35, lowAt: 0.17, reboundAt: 0.66, retestDepth: 0.26, upperWickFraction: 0.08, peakAt: 0.54 },
  { name: 'delayed-reclaim', dropFraction: 0.36, recoveryFraction: 0.50, lowAt: 0.40, reboundAt: 0.72, retestDepth: 0.31, upperWickFraction: 0.13, peakAt: 0.83 },
].map((preset) => Object.freeze(preset)));

const CYCLE_HOUR_MS = 3_600_000;
const CYCLE_TICK_MS = 10_000;
const HOUR_TICKS = CYCLE_HOUR_MS / CYCLE_TICK_MS;

export interface CycleHour {
  index: number;
  shockHour: number;
  phase: 'shock' | 'recovery';
  /** Number of original ticks retained in the shock hour. */
  protectedTicks: number;
  preset: Readonly<CyclicImpulsePreset>;
}

/** No clock reads. Invalid or too-late cutovers never create half an event. */
export function cycleForHour(config: CyclicImpulseConfig | undefined, listingAt: number, hour: number): CycleHour | null {
  if (!config || !Number.isFinite(config.anchorAt) || !Number.isFinite(config.notBefore)
    || !Number.isSafeInteger(config.periodHours) || config.periodHours < 2) return null;
  const anchorHour = (config.anchorAt - listingAt) / CYCLE_HOUR_MS;
  if (!Number.isSafeInteger(anchorHour) || anchorHour < 0 || !Number.isSafeInteger(hour) || hour < anchorHour) return null;
  const index = Math.floor((hour - anchorHour) / config.periodHours);
  const shockHour = anchorHour + index * config.periodHours;
  const phase = hour - shockHour;
  if (phase > 1) return null;
  const shockAt = listingAt + shockHour * CYCLE_HOUR_MS;
  // Ceil also protects an in-progress 10s tick if a cutover is not tick-aligned.
  const protectedTicks = Math.max(0, Math.ceil((config.notBefore - shockAt) / CYCLE_TICK_MS));
  // A low, rebound and retest need distinct ticks. Never fabricate a recovery
  // hour for a shock that could not happen before its hour ended.
  if (protectedTicks > HOUR_TICKS - 6) return null;
  return { index, shockHour, phase: phase === 0 ? 'shock' : 'recovery', protectedTicks,
    preset: CYCLIC_IMPULSE_PRESETS[index % CYCLIC_IMPULSE_PRESETS.length] };
}

export interface CycleTick { price: number; high: number; low: number; volume: number; quoteVolume: number }
interface Vertex { tick: number; price: number }

/** The changed shock close; the following hour opens at precisely this value. */
export function cycleShockClose(shockOpen: number, preset: Readonly<CyclicImpulsePreset>): number {
  return shockOpen * (1 - preset.dropFraction * (1 - preset.recoveryFraction));
}

export function cycleHourTicks(
  seed: string, hour: number, cycle: CycleHour, shockOpen: number,
  recoveryClose: number, original: readonly CycleTick[],
): CycleTick[] {
  if (original.length !== HOUR_TICKS) throw new RangeError('A cycle needs one complete canonical hour');
  const { preset: P, phase } = cycle;
  const shockClose = cycleShockClose(shockOpen, P);
  const start = phase === 'shock' ? cycle.protectedTicks : 0;
  const open = phase === 'shock' ? (start ? original[start - 1].price : shockOpen) : shockClose;
  const count = HOUR_TICKS - start;
  let vertices: Vertex[];
  if (phase === 'shock') {
    const low = shockOpen * (1 - P.dropFraction);
    const lowTick = start + Math.max(1, Math.min(count - 3, Math.round(count * P.lowAt)));
    const reboundTick = Math.max(lowTick + 1, Math.min(HOUR_TICKS - 2, start + Math.round(count * P.reboundAt)));
    const retestTick = Math.max(reboundTick + 1, Math.min(HOUR_TICKS - 1, start + Math.round(count * 0.84)));
    const rebound = low + (shockClose - low) * 0.92;
    vertices = [
      { tick: start, price: open }, { tick: lowTick, price: low },
      { tick: reboundTick, price: rebound },
      { tick: retestTick, price: low + (rebound - low) * (1 - P.retestDepth) },
      { tick: HOUR_TICKS, price: shockClose },
    ];
  } else {
    const peak = Math.max(open, recoveryClose) * (1 + P.upperWickFraction);
    const peakTick = Math.round(HOUR_TICKS * P.peakAt);
    vertices = [
      { tick: 0, price: open },
      { tick: Math.round(peakTick * 0.42), price: open + (recoveryClose - open) * 0.34 },
      { tick: peakTick, price: peak },
      { tick: Math.round(peakTick + (HOUR_TICKS - peakTick) * 0.58), price: recoveryClose + (peak - recoveryClose) * 0.23 },
      { tick: HOUR_TICKS, price: recoveryClose },
    ];
  }
  const floor = Math.min(...vertices.map((v) => v.price));
  const ceiling = Math.max(...vertices.map((v) => v.price));
  const random = seededRandom(seed, 'cyclic-impulse-v1', cycle.index, hour, phase);
  const out = original.slice(0, start);
  let previous = open, segment = 0;
  for (let tick = start + 1; tick <= HOUR_TICKS; tick++) {
    while (segment + 1 < vertices.length - 1 && tick > vertices[segment + 1].tick) segment++;
    const a = vertices[segment], b = vertices[segment + 1];
    const progress = (tick - a.tick) / (b.tick - a.tick);
    const logMove = Math.log(b.price / a.price);
    const noise = Math.min(0.005, Math.max(0.00035, Math.abs(logMove) * 0.045))
      * normal(random) * Math.sin(Math.PI * progress);
    const price = tick === b.tick ? b.price
      : Math.min(ceiling, Math.max(floor, a.price * Math.exp(logMove * progress + noise)));
    const move = Math.abs(Math.log(price / previous));
    const shadow = 0.00045 * (0.5 + random()) * (1 + Math.min(5, 30 * move));
    const high = Math.min(ceiling, Math.max(previous, price) * Math.exp(shadow * Math.abs(normal(random))));
    const low = Math.max(floor, Math.min(previous, price) * Math.exp(-shadow * Math.abs(normal(random))));
    const quoteVolume = original[tick - 1].quoteVolume * (phase === 'shock' ? 1.25 : 1.4) * (1 + 65 * move);
    out.push({ price, high, low, quoteVolume, volume: quoteVolume / ((previous + price) / 2) });
    previous = price;
  }
  return out;
}
