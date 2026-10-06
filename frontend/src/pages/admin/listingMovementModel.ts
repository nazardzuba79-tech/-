import BigNumber from 'bignumber.js';

export const MOVEMENT_SCENARIOS = [
  { id: 'CALM', name: 'Спокойный рост', description: 'Плавное движение с небольшими откатами и короткими тенями.' },
  { id: 'WAVES', name: 'Рост волнами', description: 'Чередование подъёмов и спокойных снижений с восстановлением.' },
  { id: 'FREQUENT_PULLBACKS', name: 'Рост с частыми откатами', description: 'Рост регулярно прерывается заметными короткими откатами.' },
  { id: 'COMPRESSION_BREAKOUT', name: 'Сжатие и пробой', description: 'Узкий диапазон сменяется ускорением и выходом к новой цене.' },
  { id: 'STAIRCASE', name: 'Рост ступенями с боковиками', description: 'Короткие подъёмы разделены продолжительными паузами.' },
  { id: 'SLOW_START', name: 'Медленный старт и ускорение', description: 'Спокойное начало постепенно переходит в сильное движение.' },
  { id: 'FAST_START', name: 'Быстрый старт и замедление', description: 'Активный начальный подъём становится более спокойным.' },
  { id: 'FALSE_BREAKOUT', name: 'Ложный пробой и продолжение роста', description: 'После временного выхода из диапазона цена возвращается и продолжает рост.' },
  { id: 'DEEP_RECOVERY', name: 'Глубокий откат и восстановление', description: 'Выраженное снижение от локальной вершины сменяется восстановлением.' },
  { id: 'LONG_WICKS', name: 'Неровный рост с длинными тенями', description: 'Неравномерные импульсы и разные по длине верхние и нижние тени.' },
] as const;
export type MovementScenario = typeof MOVEMENT_SCENARIOS[number]['id'];
export type MovementFrequency = 'rare' | 'moderate' | 'often';
export interface ListingMovement {
  kind: 'scenario-controls-v2';
  scenario: MovementScenario | 'AUTO';
  first24hGainPercent: string;
  maxPrice: string;
  stages: { type: 'growth' | 'range' | 'pullback' | 'recovery'; durationHours: number; targetPrice: string }[];
  afterGrowth: 'range';
  pullbacks: { frequency: MovementFrequency; minDepthPercent: string; maxDepthPercent: string; durationMinutes: number };
  candles: { intensity: 'low' | 'medium' | 'high'; diversity: number; pauseFrequency: MovementFrequency };
  wicks: { length: 'short' | 'normal' | 'pronounced'; longFrequency: MovementFrequency };
}
export interface LegacyListingProgram {
  kind: 'capped-growth-range-v1'; first24hGainPercent: number; maxGainPercent: number; peakAfterHours: number; rangeFraction: number;
}
export type ListingProgram = ListingMovement | LegacyListingProgram;
export const normalizeMovementDecimal = (value: string) => value.trim().replace(',', '.');
const decimal = (value: string) => new BigNumber(normalizeMovementDecimal(value));
export function movementPriceFromGain(initial: string, gain: string): string {
  const result = decimal(initial).times(decimal(gain).dividedBy(100).plus(1));
  return result.isFinite() ? result.decimalPlaces(10, BigNumber.ROUND_DOWN).toFixed() : '';
}
export function movementGainFromPrice(initial: string, target: string): string {
  const result = decimal(target).dividedBy(decimal(initial)).minus(1).times(100);
  return result.isFinite() ? result.decimalPlaces(10, BigNumber.ROUND_DOWN).toFixed() : '';
}
export function formatMovementPrice(value: string | number): string {
  const result = decimal(String(value));
  return result.isFinite() ? result.toFixed().replace('.', ',') : '—';
}
export function movementDuration(program: ListingMovement): number { return program.stages.reduce((total, stage) => total + stage.durationHours, 0); }
export function parseMovementHours(value: string, unit: 'hours' | 'days' = 'hours'): number {
  const text = normalizeMovementDecimal(value);
  if (!/^\d+(?:\.\d*)?$/.test(text)) return NaN;
  const hours = Number(text) * (unit === 'days' ? 24 : 1);
  return Number.isFinite(hours) && hours <= 720 ? hours : NaN;
}
export function movementStageMoment(start: string | null, hours: number): string {
  if (!start) return 'После выбора даты запуска';
  const instant = Date.parse(start) + hours * 3_600_000;
  if (!Number.isFinite(hours) || hours < 0 || hours > 720 || !Number.isFinite(instant) || Math.abs(instant) > 8_640_000_000_000_000) return 'Проверьте длительность этапа';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(instant) + ' UTC';
}

/** New drafts only. Existing saved programs are never rebuilt on opening the form. */
export function newListingMovement(initial = '1', scenario: ListingMovement['scenario'] = 'CALM'): ListingMovement {
  return selectMovementScenario({
    kind: 'scenario-controls-v2', scenario, first24hGainPercent: '1725', maxPrice: movementPriceFromGain(initial || '1', '9247'),
    stages: [
      { type: 'growth', durationHours: 24, targetPrice: movementPriceFromGain(initial || '1', '1725') },
      { type: 'growth', durationHours: 144, targetPrice: decimal(movementPriceFromGain(initial || '1', '9247')).times('.86').decimalPlaces(10, BigNumber.ROUND_DOWN).toFixed() },
    ], afterGrowth: 'range',
    pullbacks: { frequency: 'moderate', minDepthPercent: '2', maxDepthPercent: '8', durationMinutes: 45 },
    candles: { intensity: 'medium', diversity: .65, pauseFrequency: 'moderate' },
    wicks: { length: 'normal', longFrequency: 'moderate' },
  }, scenario);
}

export function selectMovementScenario(program: ListingMovement, scenario: ListingMovement['scenario']): ListingMovement {
  const frequent = scenario === 'FREQUENT_PULLBACKS' || scenario === 'DEEP_RECOVERY';
  const calm = scenario === 'CALM';
  return { ...program, scenario,
    pullbacks: { ...program.pullbacks, frequency: frequent ? 'often' : calm ? 'rare' : 'moderate', minDepthPercent: calm ? '0.5' : scenario === 'DEEP_RECOVERY' ? '8' : frequent ? '3' : '2', maxDepthPercent: scenario === 'DEEP_RECOVERY' ? '22' : calm ? '3' : frequent ? '12' : '8' },
    candles: { intensity: calm ? 'low' : scenario === 'LONG_WICKS' ? 'high' : 'medium', diversity: calm ? .3 : scenario === 'LONG_WICKS' ? .9 : .65, pauseFrequency: calm ? 'rare' : 'moderate' },
    wicks: { length: scenario === 'LONG_WICKS' ? 'pronounced' : calm ? 'short' : 'normal', longFrequency: scenario === 'LONG_WICKS' ? 'often' : calm ? 'rare' : 'moderate' },
  };
}

export function rebaseListingMovement(program: ListingMovement, previousInitial: string, nextInitial: string): ListingMovement {
  let previous = decimal(previousInitial);
  const next = decimal(nextInitial);
  if (!next.isFinite() || !next.isGreaterThan(0)) return program;
  if (!previous.isFinite() || !previous.isGreaterThan(0)) {
    let elapsed = 0;
    const boundary = program.stages.find(stage => { elapsed += stage.durationHours; return elapsed === 24; });
    previous = boundary ? decimal(boundary.targetPrice).dividedBy(decimal(program.first24hGainPercent).dividedBy(100).plus(1)) : new BigNumber(1);
  }
  if (!previous.isFinite() || !previous.isGreaterThan(0)) return program;
  const rescale = (price: string) => decimal(price).times(next).dividedBy(previous).decimalPlaces(10, BigNumber.ROUND_DOWN).toFixed();
  let elapsed = 0;
  return { ...program, maxPrice: rescale(program.maxPrice), stages: program.stages.map(stage => {
    elapsed += stage.durationHours;
    return { ...stage, targetPrice: elapsed === 24 ? movementPriceFromGain(nextInitial, program.first24hGainPercent) : rescale(stage.targetPrice) };
  }) };
}

/** UI mirrors the server's actionable rules; server validation remains authoritative. */
export function validateListingMovement(initial: string, program: ListingMovement): string | null {
  if (!decimal(initial).isGreaterThan(0) || !decimal(program.maxPrice).isGreaterThan(0)) return 'Укажите положительную начальную и максимальную цену.';
  const first = decimal(movementPriceFromGain(initial, program.first24hGainPercent));
  if (first.isGreaterThan(decimal(program.maxPrice))) return 'Цель за первые сутки выше максимальной цены';
  if (decimal(program.pullbacks.minDepthPercent).isGreaterThan(decimal(program.pullbacks.maxDepthPercent))) return 'Минимальная глубина отката не может быть больше максимальной';
  let elapsed = 0, hasDayOne = false;
  for (const stage of program.stages) {
    if (!Number.isFinite(stage.durationHours) || stage.durationHours <= 0) return 'Продолжительность каждого этапа должна быть больше нуля.';
    elapsed += stage.durationHours;
    if (!decimal(stage.targetPrice).isGreaterThan(0) || decimal(stage.targetPrice).isGreaterThanOrEqualTo(decimal(program.maxPrice))) return 'Цель этапа должна быть положительной и ниже максимальной цены — оставьте запас для теней.';
    if (elapsed === 24) {
      hasDayOne = true;
      if (!decimal(stage.targetPrice).isEqualTo(first)) return 'Цель этапа через 24 часа не совпадает с ростом за первые сутки.';
    }
  }
  if (!hasDayOne) return 'Один из этапов должен завершаться ровно через 24 часа, с целью первых суток.';
  return null;
}
