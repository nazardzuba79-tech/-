import BigNumber from 'bignumber.js';
import type { HistoricalProgram } from './listingHistoricalImport';

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
  terminalPeak?: 'bounded-v1';
  kind: 'scenario-controls-v2';
  scenario: MovementScenario | 'AUTO';
  first24hGainPercent: string;
  maxPrice: string;
  stages: { type: 'growth' | 'range' | 'pullback' | 'recovery'; durationHours: number; targetPrice: string }[];
  afterGrowth: 'range' | 'historical';
  historical?: HistoricalProgram;
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
  for (const [index, stage] of program.stages.entries()) {
    if (!Number.isFinite(stage.durationHours) || stage.durationHours <= 0) return 'Продолжительность каждого этапа должна быть больше нуля.';
    elapsed += stage.durationHours;
    const terminalPeak = (program.terminalPeak === 'bounded-v1' && stage === program.stages[program.stages.length - 1] && decimal(stage.targetPrice).isEqualTo(decimal(program.maxPrice))) || program.scenario === 'DEEP_RECOVERY' && program.afterGrowth === 'range'
      && index === program.stages.length - 1 && stage.type === 'recovery'
      && decimal(stage.targetPrice).isEqualTo(decimal(program.maxPrice));
    if (!decimal(stage.targetPrice).isGreaterThan(0) || (!terminalPeak && decimal(stage.targetPrice).isGreaterThanOrEqualTo(decimal(program.maxPrice)))) return 'Цель этапа должна быть положительной и ниже максимальной цены — оставьте запас для теней.';
    if (elapsed === 24) {
      hasDayOne = true;
      if (!decimal(stage.targetPrice).isEqualTo(first)) return 'Цель этапа через 24 часа не совпадает с ростом за первые сутки.';
    }
  }
  if (!hasDayOne) return 'Один из этапов должен завершаться ровно через 24 часа, с целью первых суток.';
  if (program.afterGrowth === 'historical') {
    if (!program.historical?.clips.length) return 'Загрузите хотя бы один исторический CSV для продолжения.';
    if (program.stages[program.stages.length - 1]?.type !== 'pullback') return 'История может начаться только после заключительного отката.';
    const hours = program.historical.clips.reduce((n,clip)=>n+clip.bars.length,0);
    if (hours > 4800 || program.historical.clips.length > 3) return 'Максимум 4800 часов в трёх отрезках.';
    let anchor = decimal(program.stages[program.stages.length-1].targetPrice);
    let top = anchor;
    for (const clip of program.historical.clips) {
      for (const [h,l,close] of clip.bars) {
        if (!Number.isSafeInteger(h) || !Number.isSafeInteger(l) || !Number.isSafeInteger(close)) return 'Некорректные исторические свечи.';
        top=BigNumber.max(top,anchor.times(new BigNumber(1).plus(h/1000000)));
        anchor=anchor.times(new BigNumber(1).plus(close/1000000));
        if (!anchor.isFinite() || !anchor.isGreaterThan(0)) return 'Исторический отрезок выводит цену за допустимые пределы.';
      }
    }
    if (top.isGreaterThanOrEqualTo(decimal(program.maxPrice).times('.995'))) return 'Историческое движение превышает лимит цены или не оставляет запас для теней.';
  } else if (program.historical) return 'Исторический набор должен быть выключен вместе с историческим режимом.';
  return null;
}

// ── Historical continuation (PR #518): switching in and out, and what it will do ──

/** The fall the editor appends when the historical continuation is chosen: 24 h down to 45 % of the previous target. */
export function defaultHistoricalPullback(previousTarget: string): ListingMovement['stages'][number] {
  return { type: 'pullback', durationHours: 24, targetPrice: decimal(previousTarget).times('.45').decimalPlaces(10, BigNumber.ROUND_DOWN).toFixed() };
}

/** GROWTH → FALL → historical rhythm: the default fall is added when the program does not end on one (and there is room). */
export function withHistoricalContinuation(value: ListingMovement): ListingMovement {
  let stages = value.stages;
  if (stages[stages.length - 1]?.type !== 'pullback' && movementDuration(value) <= 696 && stages.length < 24) {
    stages = [...stages, defaultHistoricalPullback(stages[stages.length - 1].targetPrice)];
  }
  return { ...value, afterGrowth: 'historical', historical: value.historical ?? { version: 1, clips: [] }, stages };
}

/**
 * Back to the ordinary range after all stages: the historical fragments
 * leave the program, and the fall the editor added for them goes too while it
 * is still exactly the default one. A fall the admin changed stays.
 */
export function withoutHistoricalContinuation(value: ListingMovement): { movement: ListingMovement; removedDefaultFall: boolean } {
  const { historical: _dropped, ...rest } = value;
  const stages = value.stages, last = stages[stages.length - 1], previous = stages[stages.length - 2];
  const removedDefaultFall = Boolean(previous && last && last.type === 'pullback' && last.durationHours === 24
    && last.targetPrice === defaultHistoricalPullback(previous.targetPrice).targetPrice);
  return { movement: { ...rest, afterGrowth: 'range', stages: removedDefaultFall ? stages.slice(0, -1) : stages }, removedDefaultFall };
}

export interface HistoricalPlanFragment {
  source: string;
  sourceStart: string;
  hours: number;
  /** Close of the fragment against its first open, and its extremes against that open, in percent. */
  changePercent: number;
  highPercent: number;
  lowPercent: number;
  /** Prices in USDT on this listing: where the fragment starts and ends. */
  startPrice: number;
  endPrice: number;
}
export interface HistoricalPlan {
  fragments: HistoricalPlanFragment[];
  hours: number;
  startPrice: number;
  endPrice: number;
  lowPrice: number;
  highPrice: number;
  /** The replay keeps the 0.5 % headroom below the maximum price the server requires. */
  withinMaxPrice: boolean;
}

/**
 * What the historical continuation will do to THIS listing's price, from the
 * fall's target onwards: the same relative moves the server replays (hourly
 * close compounded, hourly high/low against the hour's open). Display only;
 * the server validates again on save.
 */
export function historicalPlan(program: ListingMovement): HistoricalPlan | null {
  const clips = program.afterGrowth === 'historical' ? program.historical?.clips ?? [] : [];
  const anchor = Number(program.stages[program.stages.length - 1]?.targetPrice);
  if (!clips.length || !(anchor > 0)) return null;
  let price = anchor, low = anchor, high = anchor;
  const fragments = clips.map((clip) => {
    const start = price;
    let clipLow = start, clipHigh = start;
    for (const [h, l, c] of clip.bars) {
      clipHigh = Math.max(clipHigh, price * (1 + h / 1_000_000));
      clipLow = Math.min(clipLow, price * (1 + l / 1_000_000));
      price *= 1 + c / 1_000_000;
    }
    low = Math.min(low, clipLow); high = Math.max(high, clipHigh);
    return { source: clip.source, sourceStart: clip.sourceStart, hours: clip.bars.length,
      changePercent: (price / start - 1) * 100, highPercent: (clipHigh / start - 1) * 100, lowPercent: (clipLow / start - 1) * 100,
      startPrice: start, endPrice: price };
  });
  return { fragments, hours: fragments.reduce((n, f) => n + f.hours, 0), startPrice: anchor, endPrice: price, lowPrice: low, highPrice: high,
    withinMaxPrice: high < Number(program.maxPrice) * .995 };
}

/** One line for a list or a select: «BTC с 2018-01-01, 90 дн. → ETH с 2021-01-01, 90 дн.». */
export function historicalModelLabel(program: ListingMovement | undefined | null): string | null {
  const clips = program?.afterGrowth === 'historical' ? program.historical?.clips ?? [] : [];
  if (!clips.length) return null;
  return clips.map(clip => {
    const hours = clip.bars.length;
    return `${clip.source.split('/')[0]} с ${clip.sourceStart.slice(0, 10)}, ${hours % 24 === 0 ? `${hours / 24} дн.` : `${hours} ч`}`;
  }).join(' → ');
}

/**
 * Candles of the WHOLE historical continuation, straight from its relative
 * hourly moves (hour open compounded, high/low against it), grouped by
 * `hoursPerCandle` from `startMs` (the end of the stages). The server adds
 * the model's ten-second path and wicks on top; these show the replay's shape
 * without asking it to compute up to 4800 hours. Display only.
 */
export function historicalPlanCandles(program: ListingMovement, startMs: number, hoursPerCandle = 24) {
  const clips = program.afterGrowth === 'historical' ? program.historical?.clips ?? [] : [];
  let price = Number(program.stages[program.stages.length - 1]?.targetPrice);
  const candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  if (!clips.length || !(price > 0) || !Number.isFinite(startMs)) return candles;
  let hour = 0;
  for (const clip of clips) for (const [h, l, c] of clip.bars) {
    const open = price, close = open * (1 + c / 1_000_000);
    const high = open * (1 + h / 1_000_000), low = open * (1 + l / 1_000_000);
    if (hour % hoursPerCandle === 0) candles.push({ time: (startMs + hour * 3_600_000) / 1000, open, high, low, close, volume: 0 });
    else { const last = candles[candles.length - 1]; last.high = Math.max(last.high, high); last.low = Math.min(last.low, low); last.close = close; }
    price = close; hour++;
  }
  return candles;
}
