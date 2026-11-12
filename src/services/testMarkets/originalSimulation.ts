import { ORIGINAL_MODEL_VERSION, ORIGINAL_REGIMES, type OriginalRegimeConfig } from '../../shared/originalSimulationRegimes';
import { normal, seededRandom } from './simulationRandom';

interface ModelTick { price: number; high: number; low: number; volume: number; quoteVolume: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const blend = (value: number) => value * value * (3 - 2 * value);

/** Random-access, version-pinned hours. Parameters are authored independently of market datasets. */
export function originalModelHour(config: OriginalRegimeConfig, seed: string, initialPrice: number, hour: number) {
  const regime = ORIGINAL_REGIMES.find(item => item.id === config.id);
  if (!regime || config.version !== ORIGINAL_MODEL_VERSION || config.disclosure !== 'SIMULATED_ORIGINAL_MODEL')
    throw Error('INVALID_ORIGINAL_MODEL');
  if (!Number.isSafeInteger(hour) || hour < 0 || !Number.isFinite(initialPrice) || initialPrice <= 0)
    throw Error('INVALID_ORIGINAL_MODEL_COORDINATES');

  const namespace = `${seed}:${config.version}:${config.id}`;
  const cycleHours = regime.hours;
  const anchor = (at: number): number => {
    const cycle = Math.floor(at / cycleHours);
    const fraction = (at % cycleHours) / cycleHours;
    const random = seededRandom(namespace, 'phase', cycle);
    // Unequal phase durations are stable for this cycle, including on reverse-order requests.
    const durations = regime.levels.slice(1).map(() => .35 + random() * 1.3);
    const total = durations.reduce((a, b) => a + b, 0);
    let elapsed = 0, phase = 0;
    while (phase < durations.length - 1 && elapsed + durations[phase] / total < fraction)
      elapsed += durations[phase++] / total;
    const progress = (fraction - elapsed) / (durations[phase] / total);
    const amplitude = .65 + random() * .7;
    const shape = regime.levels[phase] + (regime.levels[phase + 1] - regime.levels[phase]) * blend(progress);
    const slow = (block: number) => block === 0 ? 0 : .09 * normal(seededRandom(namespace, 'slow', block));
    // Short-memory deviations also move hourly closes. Intrahour noise alone
    // would leave higher intervals tracing an overly smooth phase curve.
    let roughness = 0;
    for (let lag = 0; lag < 8; lag++) {
      roughness += Math.pow(.72, lag) * normal(seededRandom(namespace, 'hour-deviation', at - lag));
    }
    roughness *= regime.noise * 1.8 * (1 - Math.exp(-at / 3));
    // Bounded long-horizon drift prevents overflow and imposes no promised target return.
    const trend = 1.6 * Math.tanh(regime.drift * at / cycleHours / 1.6);
    return trend + shape * amplitude + slow(cycle) * (1 - blend(fraction)) + slow(cycle + 1) * blend(fraction) + roughness;
  };
  const openLog = anchor(hour), closeLog = anchor(hour + 1);
  const random = seededRandom(namespace, 'ticks', hour);
  const cluster = .35 + Math.abs(normal(seededRandom(namespace, 'cluster', Math.floor(hour / 5))));
  const sigma = regime.noise * clamp(cluster, .35, 2.5);
  const changes: number[] = [];
  let momentum = 0, activity = .7;
  for (let i = 0; i < 360; i++) {
    activity = .92 * activity + .08 * (.2 + Math.abs(normal(random)));
    const pause = random() < .13;
    const shock = random() < .018 ? 2 + random() * 3 : 1;
    momentum = regime.persistence * momentum + (pause ? 0 : normal(random) * sigma / 12 * activity * shock);
    changes.push(momentum);
  }
  const correction = (closeLog - openLog - changes.reduce((a, b) => a + b, 0)) / changes.length;
  const open = initialPrice * Math.exp(openLog);
  const ticks: ModelTick[] = [];
  let logPrice = openLog;
  for (let i = 0; i < changes.length; i++) {
    const previous = initialPrice * Math.exp(logPrice);
    const move = changes[i] + correction;
    logPrice = i === 359 ? closeLog : logPrice + move;
    const price = initialPrice * Math.exp(logPrice);
    let high = Math.max(previous, price), low = Math.min(previous, price);
    // Sample two intratick observations. Monotonic samples naturally leave one-sided or absent tails.
    for (let sample = 1; sample <= 2; sample++) {
      const weight = sample / 3;
      const excursion = sigma / 18 * normal(random) * (random() < .07 ? 2.5 : .5);
      const observed = Math.exp(Math.log(previous) * (1 - weight) + Math.log(price) * weight + excursion);
      high = Math.max(high, observed);
      low = Math.min(low, observed);
    }
    const volume = Math.exp(.65 * normal(random)) * (1 + Math.abs(move) / Math.max(sigma / 12, 1e-9))
      * (150 + 220 * cluster) * (random() < .06 ? .06 : 1);
    ticks.push({ price, high, low, volume, quoteVolume: volume * (previous + price) / 2 });
  }
  const boundaries = [open];
  for (let slot = 0; slot < 12; slot++) boundaries.push(ticks[(slot + 1) * 30 - 1].price);
  return { hour, open, regime: 'consolidation' as const, logReturn: closeLog - openLog,
    sigma, cluster, boundaries, cycleTicks: ticks };
}
