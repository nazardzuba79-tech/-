import { seededRandom } from './simulationRandom';
import type { RealismTick } from './simulationRealism';

/** Absolute instants shared by API and edge. Percent gains are from LISTING. */
export interface ScheduledScenarioConfig {
  readonly version: number;
  readonly from: number;
  readonly firstTargetAt: number;
  readonly breakoutAt: number;
  readonly secondTargetAt: number;
  readonly rangeEndAt: number;
  readonly selloffEndAt: number;
  readonly endAt: number;
  readonly firstGainPercent: number;
  readonly secondGainPercent: number;
  /** Typical sideways amplitude, not a clipping boundary for candles/wicks. */
  readonly rangeFraction: number;
  readonly selloffFraction: number;
}

const TICK = 10_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
type Regime = 'impulse' | 'consolidation' | 'pullback';
interface Vertex { at: number; price: number }
interface Phase {
  name: string; from: number; to: number; open: number; close: number;
  regime: Regime; range: boolean; vertices: Vertex[];
}
interface Context { phases: Phase[]; terminal: number }

export function validateScheduledScenario(c: ScheduledScenarioConfig, listingAt: number): void {
  const times = [c.from, c.firstTargetAt, c.breakoutAt, c.secondTargetAt, c.rangeEndAt, c.selloffEndAt, c.endAt];
  if (!Number.isSafeInteger(c.version) || c.version < 1 || !Number.isFinite(listingAt)
    || times.some((t, i) => !Number.isSafeInteger(t) || t % TICK !== 0 || t < listingAt || (i > 0 && t <= times[i - 1]))
    || !Number.isFinite(c.firstGainPercent) || c.firstGainPercent <= -100
    || !Number.isFinite(c.secondGainPercent) || c.secondGainPercent <= c.firstGainPercent
    || !Number.isFinite(c.rangeFraction) || c.rangeFraction <= 0 || c.rangeFraction >= 1
    || !Number.isFinite(c.selloffFraction) || c.selloffFraction <= 0 || c.selloffFraction >= 1) {
    throw new RangeError('Invalid scheduled simulation configuration');
  }
}

/** Release preflight: a schedule may never be introduced retroactively. */
export function assertScheduledScenarioRelease(c: ScheduledScenarioConfig, now: number, leadMs = 5 * MINUTE): void {
  if (!Number.isFinite(now) || !Number.isFinite(leadMs) || leadMs < 0 || now + leadMs >= c.from) {
    throw new RangeError('Scenario activation must be in the future for BOTH API and market-edge releases');
  }
}

// The bounded cache only avoids rebuilding deterministic vertices; it contains
// no clock, cursor, mutable random stream, process state or financial data.
const contexts = new Map<string, Context>();
function context(c: ScheduledScenarioConfig, seed: string, listingAt: number, listingPrice: number, anchor: number): Context {
  validateScheduledScenario(c, listingAt);
  if (![listingPrice, anchor].every(p => Number.isFinite(p) && p > 0)) throw new RangeError('Invalid scenario price');
  const key = JSON.stringify([c, seed, listingAt, listingPrice, anchor]);
  const cached = contexts.get(key);
  if (cached) return cached;
  const first = listingPrice * (1 + c.firstGainPercent / 100);
  const second = listingPrice * (1 + c.secondGainPercent / 100);
  const terminal = second * (1 - c.selloffFraction);
  if (![first, second, terminal].every(p => Number.isFinite(p) && p > 0)) throw new RangeError('Invalid scenario target');
  const rows: Array<[string, number, number, number, number, Regime, boolean]> = [
    ['first-rise', c.from, c.firstTargetAt, anchor, first, 'impulse', false],
    ['first-range', c.firstTargetAt, c.breakoutAt, first, first, 'consolidation', true],
    ['second-rise', c.breakoutAt, c.secondTargetAt, first, second, 'impulse', false],
    ['second-range', c.secondTargetAt, c.rangeEndAt, second, second, 'consolidation', true],
    ['selloff', c.rangeEndAt, c.selloffEndAt, second, terminal, 'pullback', false],
    ['final-range', c.selloffEndAt, c.endAt, terminal, terminal, 'consolidation', true],
    // The scheduled two-week program is complete; retain the terminal market's
    // bounded range instead of resuming the old model or producing zero trades.
    ['terminal-range', c.endAt, Infinity, terminal, terminal, 'consolidation', true],
  ];
  const phases = rows.map(([name, from, to, open, close, regime, range]): Phase => {
    const vertices: Vertex[] = [{ at: from, price: open }];
    if (!range) {
      const random = seededRandom(seed, 'scheduled-structure', c.version, name, from);
      const n = Math.max(6, Math.ceil((to - from) / (18 * MINUTE)));
      // Unequal legs, pauses and counter-trend moves. Endpoint correction changes
      // only this prospective phase; it does not touch the existing market path.
      const weights = Array.from({ length: n }, (_, i) => i > 0 && i < n - 1 && random() < .28
        ? -(.25 + random() * .65) : .3 + random() * 1.8);
      const sum = weights.reduce((a, b) => a + b, 0);
      // Positive total even for unusually many seeded pullbacks.
      if (sum <= .5) weights[n - 1] += .5 - sum;
      const total = weights.reduce((a, b) => a + b, 0);
      let progress = 0;
      for (let i = 1; i <= n; i++) {
        progress += weights[i - 1] / total;
        vertices.push({ at: from + (to - from) * i / n,
          price: i === n ? close : open * Math.exp(Math.log(close / open) * progress) });
      }
    } else vertices.push({ at: to, price: close });
    return { name, from, to, open, close, regime, range, vertices };
  });
  const out = { phases, terminal };
  contexts.set(key, out);
  if (contexts.size > 32) contexts.delete(contexts.keys().next().value as string);
  return out;
}

function noise(seed: string, label: string, at: number, interval: number): number {
  const position = at / interval;
  const slot = Math.floor(position);
  const u = position - slot;
  const a = seededRandom(seed, label, slot)() * 2 - 1;
  const b = seededRandom(seed, label, slot + 1)() * 2 - 1;
  return a + (b - a) * u * u * (3 - 2 * u);
}

/** Irregular flush/recovery events are actual ticks, not cosmetic candle wicks. */
function excursion(seed: string, name: string, elapsed: number, range = false): number {
  const window = 47 * MINUTE;
  const slot = Math.floor(elapsed / window);
  const random = seededRandom(seed, 'scheduled-excursion', name, slot);
  if (random() > .58) return 0;
  const start = (2 + random() * 22) * MINUTE;
  const duration = (4 + random() * 13) * MINUTE;
  const u = (elapsed - slot * window - start) / duration;
  if (u <= 0 || u >= 1) return 0;
  const down = random() < .76;
  let depth = .025 + random() * (down ? .105 : .06);
  const turn = .12 + random() * .24;
  if (range) {
    // Occasional stop runs are deliberately allowed beyond the nominal range.
    // Their fast excursion and slower recovery are real, shared trade ticks.
    const large = random() < .24;
    depth = large ? (down ? .18 + random() * .14 : .12 + random() * .08) : .025 + random() * .085;
  }
  const height = u < turn ? u / turn : (1 - u) / (1 - turn);
  return (down ? -1 : 1) * depth * Math.pow(height, .8);
}

function phaseAt(ctx: Context, at: number): Phase | undefined {
  return ctx.phases.find(p => at >= p.from && at < p.to);
}

function priceAt(c: ScheduledScenarioConfig, seed: string, ctx: Context, anchor: number, at: number): number {
  if (at <= c.from) return anchor;
  const p = phaseAt(ctx, at)!;
  if (at === p.from) return p.open;
  const t = at - p.from;
  const envelope = Math.min(1, t / (8 * MINUTE), (p.to - at) / (8 * MINUTE));
  const label = `${c.version}:${p.name}:${p.from}`;
  const slow = noise(seed, label + ':slow', t, 83 * MINUTE);
  const medium = noise(seed, label + ':medium', t, 17 * MINUTE);
  const fast = noise(seed, label + ':fast', t, 130_000);
  const shock = excursion(seed, label, t, p.range);
  if (p.range) {
    // Volatility clusters breathe between ~7% and ~20% at the owner's .20
    // setting, with a drifting centre. No candle or wick is clipped to a box.
    const width = c.rangeFraction * (.35 + .65 * (noise(seed, label + ':volatility', t, 167 * MINUTE) + 1) / 2);
    const centre = c.rangeFraction * .20 * noise(seed, label + ':centre', t, 263 * MINUTE);
    const base = .78 * slow + .17 * medium + .05 * fast;
    const displacement = centre + Math.log1p(width * base) + shock * (c.rangeFraction / .20);
    return p.open * Math.exp(envelope * displacement);
  }
  const i = Math.min(p.vertices.length - 2,
    Math.floor(t / (p.to - p.from) * (p.vertices.length - 1)));
  const a = p.vertices[i], b = p.vertices[i + 1];
  const u = (at - a.at) / (b.at - a.at);
  const baseline = a.price * Math.exp(Math.log(b.price / a.price) * u);
  // Countermoves must also exist at 1m, not just at the macro leg boundaries.
  // Non-divisor lattice periods avoid repeating the same shape every candle.
  const micro = noise(seed, label + ':micro', t, 37_000);
  const minuteMove = Math.abs(Math.log(b.price / a.price)) * MINUTE / (b.at - a.at);
  const fastAmplitude = Math.min(.09, Math.max(.028, minuteMove * 6));
  return baseline * Math.exp(envelope * (.026 * medium + fastAmplitude * fast + fastAmplitude * .45 * micro + shock));
}

export function scheduledScenarioHour(
  c: ScheduledScenarioConfig, seed: string, listingAt: number, initialPrice: number,
  hour: number, anchorPrice: number, originalOpen: number, original: readonly RealismTick[],
): { open: number; ticks: RealismTick[]; regime: Regime } {
  if (!Number.isSafeInteger(hour) || hour < 0 || original.length !== 360) throw new RangeError('A scenario needs one complete canonical hour');
  const ctx = context(c, seed, listingAt, initialPrice, anchorPrice);
  const start = listingAt + hour * HOUR;
  const open = start <= c.from ? originalOpen : priceAt(c, seed, ctx, anchorPrice, start);
  const ticks: RealismTick[] = [];
  let previous = open;
  for (let i = 0; i < 360; i++) {
    const at = start + (i + 1) * TICK;
    if (at <= c.from) { ticks.push(original[i]); previous = original[i].price; continue; }
    const price = priceAt(c, seed, ctx, anchorPrice, at);
    const p = phaseAt(ctx, at - 1);
    const random = seededRandom(seed, 'scheduled-tick', c.version, at);
    const move = Math.abs(Math.log(price / previous));
    const shadow = (.0001 + random() * .0009) * (1 + Math.min(4, move * 45));
    const endpointEnvelope = p ? Math.min(1, (at - p.from) / MINUTE, (p.to - at) / MINUTE) : 0;
    const longWick = random() < .035 ? .002 + random() * .01 : 0;
    let high = Math.max(previous, price) * (1 + (shadow * random() + longWick * random()) * endpointEnvelope);
    let low = Math.min(previous, price) * (1 - (shadow * random() + longWick * random()) * endpointEnvelope);
    const activity = p?.range ? .68 : p?.regime === 'pullback' ? 1.45 : 1.15;
    const quoteVolume = (25 + random() * 190) * activity * (1 + Math.min(12, 140 * move));
    const volume = quoteVolume / ((previous + price) / 2);
    ticks.push({ price, high, low, volume, quoteVolume });
    previous = price;
  }
  return { open, ticks, regime: phaseAt(ctx, start + HOUR / 2)?.regime ?? 'consolidation' };
}
