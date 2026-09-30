/**
 * Forward-only VTA lifecycle after the initial launch run:
 * one final downside flush that fully reclaims, then a bounded accumulation
 * range, then the normal seeded growth regimes resume from the accumulated
 * price instead of jumping back to the old absolute price path.
 */
import { normal, seededRandom } from './simulationRandom';

export interface AccumulationPhaseConfig {
  /** Hour-aligned start of the final flush. */
  anchorAt: number;
  /** Exact intrahour low relative to the flush-hour open, e.g. 0.25 = -25%. */
  flushFraction: number;
  /** Number of complete hours after the flush that stay in accumulation. */
  accumulationHours: number;
  /** Slowly varying total peak-to-trough band width. */
  minBandFraction: number;
  maxBandFraction: number;
}

export type AccumulationPhase = 'flush' | 'accumulation' | 'final-growth';

export interface AccumulationHour {
  phase: AccumulationPhase;
  relativeHour: number;
  startHour: number;
}

const HOUR_MS = 3_600_000;
const TICK_MS = 10_000;
const HOUR_TICKS = HOUR_MS / TICK_MS;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function accumulationForHour(
  config: AccumulationPhaseConfig | undefined,
  listingAt: number,
  hour: number,
): AccumulationHour | null {
  if (!config || !Number.isFinite(config.anchorAt) || !Number.isSafeInteger(hour)
    || !Number.isSafeInteger(config.accumulationHours) || config.accumulationHours < 1
    || !(config.flushFraction > 0 && config.flushFraction < 0.8)
    || !(config.minBandFraction > 0 && config.maxBandFraction >= config.minBandFraction && config.maxBandFraction < 1)) return null;
  const startHour = (config.anchorAt - listingAt) / HOUR_MS;
  if (!Number.isSafeInteger(startHour) || startHour < 0 || hour < startHour) return null;
  const relativeHour = hour - startHour;
  if (relativeHour === 0) return { phase: 'flush', relativeHour, startHour };
  if (relativeHour <= config.accumulationHours) return { phase: 'accumulation', relativeHour, startHour };
  return { phase: 'final-growth', relativeHour, startHour };
}

function bandWidth(seed: string, config: AccumulationPhaseConfig, hour: number): number {
  const phaseRandom = seededRandom(seed, 'accumulation-band-phase-v1');
  const phase = phaseRandom() * Math.PI * 2;
  const middle = (config.minBandFraction + config.maxBandFraction) / 2;
  const amplitude = (config.maxBandFraction - config.minBandFraction) / 2;
  // Slow enough that the range expands/contracts instead of snapping.
  return middle + amplitude * Math.sin(phase + hour * Math.PI / 24);
}

/**
 * Close factor relative to the pre-flush anchor. The walk is deterministic,
 * mean reverting and always contained by a slowly varying 15-30%-style band.
 * hour=0 and the flush close are exactly 1.
 */
export function accumulationFactor(seed: string, config: AccumulationPhaseConfig, hour: number): number {
  if (hour <= 0) return 1;
  const targetHour = Math.min(hour, config.accumulationHours);
  let factor = 1;
  for (let i = 1; i <= targetHour; i++) {
    const width = bandWidth(seed, config, i);
    const half = width / 2;
    const random = seededRandom(seed, 'accumulation-walk-v1', i);
    const meanReversion = (1 - factor) * 0.18;
    const noise = normal(random) * Math.max(0.0045, half * 0.12);
    // Keep closes slightly inside the band; wicks may test its outer edge.
    factor = clamp(factor + meanReversion + noise, 1 - half * 0.88, 1 + half * 0.88);
  }
  return factor;
}

export interface PhaseTick {
  price: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
}

/**
 * One exact final flush: trades down to open*(1-flushFraction), never trades
 * above the opening anchor, and closes back exactly at the opening anchor.
 */
export function flushHourTicks(
  seed: string,
  hour: number,
  open: number,
  flushFraction: number,
  original: readonly PhaseTick[],
): PhaseTick[] {
  if (original.length !== HOUR_TICKS) throw new RangeError('Flush hour needs one complete canonical hour');
  const floor = open * (1 - flushFraction);
  const vertices = [
    { tick: 0, price: open },
    { tick: 86, price: open * 0.88 },
    { tick: 134, price: floor },
    { tick: 222, price: open * 0.91 },
    { tick: 286, price: open * 0.84 },
    { tick: HOUR_TICKS, price: open },
  ];
  const random = seededRandom(seed, 'final-flush-v1', hour);
  const out: PhaseTick[] = [];
  let previous = open;
  let segment = 0;
  for (let tick = 1; tick <= HOUR_TICKS; tick++) {
    while (segment + 1 < vertices.length - 1 && tick > vertices[segment + 1].tick) segment++;
    const a = vertices[segment], b = vertices[segment + 1];
    const progress = (tick - a.tick) / (b.tick - a.tick);
    const logMove = Math.log(b.price / a.price);
    const noise = Math.min(0.0035, Math.max(0.00025, Math.abs(logMove) * 0.03))
      * normal(random) * Math.sin(Math.PI * progress);
    const price = tick === b.tick ? b.price : clamp(a.price * Math.exp(logMove * progress + noise), floor, open);
    const move = Math.abs(Math.log(price / previous));
    const shadow = 0.00035 * (0.5 + random()) * (1 + Math.min(4, 25 * move));
    const high = Math.min(open, Math.max(previous, price) * Math.exp(shadow * Math.abs(normal(random))));
    const low = Math.max(floor, Math.min(previous, price) * Math.exp(-shadow * Math.abs(normal(random))));
    const quoteVolume = original[tick - 1].quoteVolume * 1.35 * (1 + 55 * move);
    out.push({ price, high, low, quoteVolume, volume: quoteVolume / ((previous + price) / 2) });
    previous = price;
  }
  // Exact contract points.
  out[133] = { ...out[133], price: floor, low: floor };
  out[HOUR_TICKS - 1] = { ...out[HOUR_TICKS - 1], price: open, high: Math.max(out[HOUR_TICKS - 1].high, open) };
  return out;
}
