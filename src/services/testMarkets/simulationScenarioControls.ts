/** Version 2 choreography for the EXISTING canonical scheduled ten-second flow.
 * No timeframe-specific paths, clocks, network calls or persisted candles.
 * Version 1 and all historical market paths deliberately do not call this module.
 */
import type { ListingScenario, ScenarioControlsProgram } from '../../shared/listingScenarioControls';
import type { RealismTick } from './simulationRealism';
import { seededRandom } from './simulationRandom';

const HOUR = 3_600_000, MINUTE = 60_000, TICK = 10_000;
type Regime = 'impulse' | 'consolidation' | 'pullback';
export interface ControlledScenarioConfig {
  readonly mode: 'scenario-controls-v2';
  readonly version: 2;
  readonly from: number;
  readonly initialPrice: string;
  readonly controls: ScenarioControlsProgram;
}
const frequencies = { rare: .18, moderate: .5, often: .84 };
const smooth = (x: number) => x * x * (3 - 2 * x);
function noise(seed: string, label: string, at: number, period: number): number {
  const slot = Math.floor(at / period), part = at / period - slot;
  const a = seededRandom(seed, label, slot)() * 2 - 1, b = seededRandom(seed, label, slot + 1)() * 2 - 1;
  return a + (b - a) * smooth(part);
}
function piecewise(u: number, points: readonly (readonly [number, number])[]): number {
  const i = Math.max(0, points.findIndex((point, index) => index > 0 && u <= point[0]) - 1);
  const a = points[i], b = points[Math.min(points.length - 1, i + 1)];
  return a[1] + (b[1] - a[1]) * smooth((u - a[0]) / (b[0] - a[0]));
}
/** These are different movement structures, not ten seeds for the same curve. */
function progress(scenario: ListingScenario | 'AUTO', u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (scenario) {
    case 'WAVES': return u + .09 * Math.sin(6 * Math.PI * u);
    case 'FREQUENT_PULLBACKS': return u + .07 * Math.sin(14 * Math.PI * u) * Math.sin(Math.PI * u);
    case 'COMPRESSION_BREAKOUT': return piecewise(u, [[0, 0], [.55, .075], [.73, .8], [1, 1]]);
    case 'STAIRCASE': return piecewise(u, [[0, 0], [.1, .2], [.28, .2], [.4, .48], [.62, .48], [.73, .8], [.89, .8], [1, 1]]);
    case 'SLOW_START': return u * u;
    case 'FAST_START': return 1 - (1 - u) * (1 - u);
    case 'FALSE_BREAKOUT': return piecewise(u, [[0, 0], [.23, .52], [.42, .18], [.6, .32], [1, 1]]);
    case 'DEEP_RECOVERY': return piecewise(u, [[0, 0], [.39, .76], [.62, .35], [1, 1]]);
    case 'LONG_WICKS': return u + (.055 * Math.sin(10 * Math.PI * u) + .022 * Math.sin(26 * Math.PI * u)) * Math.sin(Math.PI * u);
    default: return u;
  }
}
interface Stage { start: number; end: number; open: number; close: number; regime: Regime; index: number }
function stageAt(config: ControlledScenarioConfig, at: number): Stage {
  let start = config.from, open = Number(config.initialPrice);
  for (const [index, stage] of config.controls.stages.entries()) {
    const end = start + stage.durationHours * HOUR, close = Number(stage.targetPrice);
    if (at < end) return { start, end, open, close, regime: stage.type === 'range' ? 'consolidation' : stage.type === 'pullback' ? 'pullback' : 'impulse', index };
    start = end; open = close;
  }
  return { start, end: Infinity, open, close: open, regime: 'consolidation', index: config.controls.stages.length };
}
function baseline(config: ControlledScenarioConfig, stage: Stage, at: number): number {
  if (stage.open === stage.close) return stage.open;
  const u = (at - stage.start) / (stage.end - stage.start);
  const travelled = progress(config.controls.scenario, u);
  return stage.open * Math.exp(Math.log(stage.close / stage.open) * travelled);
}
/** Smoothly use remaining headroom rather than clipping peaks into a flat shelf. */
function displaced(base: number, shift: number, cap: number): number {
  const odds = base / (cap - base);
  const next = odds * Math.exp(shift);
  return cap * next / (1 + next);
}
function priceAt(config: ControlledScenarioConfig, seed: string, at: number): number {
  if (at <= config.from) return Number(config.initialPrice);
  const p = stageAt(config, at);
  if (at === p.start) return p.open;
  const c = config.controls, t = at - p.start, cap = Number(c.maxPrice);
  const label = `scenario-controls-v2:${p.index}`;
  const envelope = Math.min(1, t / (5 * MINUTE), (p.end - at) / (5 * MINUTE));
  let base = baseline(config, p, at);
  // An episode is a local peak -> local percentage drawdown -> recovery, all
  // part of the same price flow. It cannot leak across a configured endpoint.
  const duration = c.pullbacks.durationMinutes * MINUTE;
  const spacing = duration * ({ rare: 5, moderate: 3, often: 1.4 }[c.pullbacks.frequency]);
  const slot = Math.floor(t / spacing), eventStart = p.start + slot * spacing + 2 * MINUTE;
  const random = seededRandom(seed, label, 'drawdown', slot);
  // "Rare" must still include occasional real counter-moves, not a possible
  // all-green launch caused by missing every seeded event in the first day.
  const occurs = random() < frequencies[c.pullbacks.frequency] || (c.pullbacks.frequency === 'rare' && slot % 6 === 1);
  if (occurs && eventStart + duration < p.end - 5 * MINUTE) {
    const u = (at - eventStart) / duration;
    if (u > 0 && u < 1) {
      const peak = baseline(config, p, eventStart);
      const depth = (Number(c.pullbacks.minDepthPercent) + random() * (Number(c.pullbacks.maxDepthPercent) - Number(c.pullbacks.minDepthPercent))) / 100;
      const trough = peak * (1 - depth), end = baseline(config, p, eventStart + duration);
      base = u <= .38 ? peak + (trough - peak) * smooth(u / .38) : trough + (end - trough) * smooth((u - .38) / .62);
    }
  }
  const intensity = { low: .008, medium: .026, high: .055 }[c.candles.intensity];
  const cluster = .25 + .75 * (noise(seed, label + ':cluster', t, 89 * MINUTE) + 1) / 2;
  const paused = (noise(seed, label + ':pause', t, 23 * MINUTE) + 1) / 2 < frequencies[c.candles.pauseFrequency] * .5;
  const amplitude = intensity * (paused ? .12 : 1) * cluster;
  const move = noise(seed, label + ':medium', t, 13 * MINUTE) * amplitude
    + noise(seed, label + ':fast', t, 83_000) * amplitude * (.5 + c.candles.diversity)
    + noise(seed, label + ':micro', t, 31_000) * amplitude * .4 * c.candles.diversity;
  // The permanent range has no elapsed-time trend or resetting growth cycle.
  const range = p.regime === 'consolidation' ? noise(seed, label + ':range', t, 137 * MINUTE) * intensity * 2.5 : 0;
  return displaced(base, envelope * (move + range), cap);
}

export function controlledScenarioHour(config: ControlledScenarioConfig, seed: string, hour: number): { open: number; ticks: RealismTick[]; regime: Regime } {
  const start = config.from + hour * HOUR, cap = Number(config.controls.maxPrice);
  const open = priceAt(config, seed, start), ticks: RealismTick[] = [];
  let previous = open;
  for (let i = 0; i < 360; i++) {
    const at = start + (i + 1) * TICK, price = priceAt(config, seed, at);
    const random = seededRandom(seed, 'scenario-controls-v2:tick', at);
    const top = Math.max(previous, price), bottom = Math.min(previous, price), move = Math.abs(Math.log(price / previous));
    const c = config.controls;
    const shadowScale = { short: .0005, normal: .002, pronounced: .008 }[c.wicks.length];
    const strong = random() < frequencies[c.wicks.longFrequency] * .15;
    const activity = .4 + random() * (1 + c.candles.diversity);
    const shadow = shadowScale * activity * (strong ? 2 + random() * 5 : random());
    // Sub-tick extrema belong to the canonical interval, so every aggregation
    // sees them. Asymmetric shadows spend only a fraction of available space.
    const high = top + (cap - top) * (1 - Math.exp(-shadow * top / cap * random()));
    const low = bottom * Math.exp(-shadow * random());
    const quoteVolume = (25 + random() * 190) * activity * (1 + Math.min(12, 140 * move));
    ticks.push({ price, high, low, volume: quoteVolume / ((previous + price) / 2), quoteVolume });
    previous = price;
  }
  return { open, ticks, regime: stageAt(config, start + HOUR / 2).regime };
}
