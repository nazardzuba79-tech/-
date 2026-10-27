/** Pure, deterministic DTO/math shared by the listing validator and simulation. No IO. */
import type { HistoricalMoveProgram } from './listingHistoricalReplay';
export const LISTING_SCENARIOS = ['CALM', 'WAVES', 'FREQUENT_PULLBACKS', 'COMPRESSION_BREAKOUT', 'STAIRCASE', 'SLOW_START', 'FAST_START', 'FALSE_BREAKOUT', 'DEEP_RECOVERY', 'LONG_WICKS'] as const;
export type ListingScenario = typeof LISTING_SCENARIOS[number];
export type ScenarioFrequency = 'rare' | 'moderate' | 'often';
export interface ScenarioControlsProgram {
  kind: 'scenario-controls-v2';
  scenario: ListingScenario | 'AUTO';
  first24hGainPercent: string;
  /** The only persisted upper boundary. Percentage is derived, never a second limit. */
  maxPrice: string;
  stages: Array<{ type: 'growth' | 'range' | 'pullback' | 'recovery'; durationHours: number; targetPrice: string }>;
  afterGrowth: 'range' | 'historical';
  /** Offline, source-attributed 1-hour shape, never live provider prices. */
  historical?: HistoricalMoveProgram;
  pullbacks: { frequency: ScenarioFrequency; minDepthPercent: string; maxDepthPercent: string; durationMinutes: number };
  candles: { intensity: 'low' | 'medium' | 'high'; diversity: number; pauseFrequency: ScenarioFrequency };
  wicks: { length: 'short' | 'normal' | 'pronounced'; longFrequency: ScenarioFrequency };
}

/**
 * V2-only historical validator lives in this inert module because the
 * installed NRX v1 trajectory guard forbids importing runtime code here.
 * Keep the pure data validation in sync with listingHistoricalReplay.ts.
 */
function validateHistoricalMoveProgram(program: HistoricalMoveProgram): void {
  if (!program || program.version !== 1 || !Array.isArray(program.clips)
    || program.clips.length < 1 || program.clips.length > 3)
    throw new Error('Добавьте от одного до трёх исторических отрезков');
  let count = 0;
  for (const clip of program.clips) {
    if (!['BTC/USDT','ETH/USDT','SOL/USDT'].includes(clip.source)
        || clip.resolution !== '1h' || clip.provenance !== 'USER_SUPPLIED_UNVERIFIED'
        || !/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/.test(clip.sourceStart)
        || !Number.isFinite(Date.parse(clip.sourceStart))
        || new Date(clip.sourceStart).toISOString() !== clip.sourceStart)
      throw new Error('Неизвестное историческое движение или источник');
    if (!Array.isArray(clip.bars) || clip.bars.length < 24 || clip.bars.length > 2400)
      throw new Error('Отрезок должен содержать от 24 до 2400 последовательных часов');
    count += clip.bars.length;
    for (const bar of clip.bars) {
      if (!Array.isArray(bar) || bar.length !== 3 || !bar.every(Number.isSafeInteger))
        throw new Error('Неправильные исторические коэффициенты OHLC');
      const [hi,lo,close] = bar;
      if (hi < Math.max(0,close) || lo > Math.min(0,close) || lo <= -1000000
          || hi > 4000000 || close <= -1000000 || close > 4000000)
        throw new Error('Неверные границы исторической свечи');
    }
  }
  if (count > 4800) throw new Error('Не более 4800 часов в цепочке');
}
function historicalReplayBounds(program: HistoricalMoveProgram, anchor: number) {
  validateHistoricalMoveProgram(program);
  if (!(anchor > 0) || !Number.isFinite(anchor)) throw new Error('Некорректная цена соединения');
  let close=anchor, min=anchor,max=anchor;
  for(const clip of program.clips) for(const [h,l,c] of clip.bars) {
    min=Math.min(min,close*(1+l/1000000));
    max=Math.max(max,close*(1+h/1000000));
    close*=1+c/1000000;
    if (!Number.isFinite(close) || close<1e-8 || close>1e9)
      throw new Error('Исторический отрезок выходит за поддерживаемую точность цены');
  }
  return {min,max,close};
}

export function normalizeScenarioDecimal(input: string): string {
  const text = input.trim().replace(',', '.');
  if (!/^\d{1,18}(?:\.\d{1,10})?$/.test(text)) throw new RangeError('Введите положительное число, не более 10 знаков после запятой');
  const [whole, fraction = ''] = text.split('.');
  const clean = fraction.replace(/0+$/, '');
  return `${BigInt(whole)}${clean ? `.${clean}` : ''}`;
}
const SCALE = 10000000000n;
function units(input: string): bigint {
  const [whole, fraction = ''] = normalizeScenarioDecimal(input).split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(10, '0'));
}
function decimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(10, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / SCALE}${fraction ? `.${fraction}` : ''}`;
}
/** Downward asset-precision quantization: a hard maximum is never rounded up. */
export function exactPriceFromGain(initialPrice: string, gainPercent: string): string {
  return decimal(units(initialPrice) * (100n * SCALE + units(gainPercent)) / (100n * SCALE));
}
export function exactGainFromPrice(initialPrice: string, price: string): string {
  const initial = units(initialPrice);
  if (initial <= 0n) throw new RangeError('Начальная цена должна быть больше нуля');
  return decimal((units(price) - initial) * 100n * SCALE / initial);
}
export function exactPriceFraction(price: string, numerator: number, denominator = 100): string {
  return decimal(units(price) * BigInt(numerator) / BigInt(denominator));
}

export function defaultScenarioControls(initialPrice: string, scenario: ListingScenario | 'AUTO' = 'CALM', first24hGainPercent = '1725', maxPrice = exactPriceFromGain(initialPrice, '9247'), growthHours = 168): ScenarioControlsProgram {
  const calm = scenario === 'CALM', frequent = scenario === 'FREQUENT_PULLBACKS', deep = scenario === 'DEEP_RECOVERY', shadows = scenario === 'LONG_WICKS';
  return {
    kind: 'scenario-controls-v2', scenario, first24hGainPercent: normalizeScenarioDecimal(first24hGainPercent), maxPrice: normalizeScenarioDecimal(maxPrice),
    stages: [{ type: 'growth', durationHours: 24, targetPrice: exactPriceFromGain(initialPrice, first24hGainPercent) },
      ...(growthHours > 24 ? [{ type: 'growth' as const, durationHours: growthHours - 24, targetPrice: exactPriceFraction(maxPrice, 86) }] : [])],
    afterGrowth: 'range',
    pullbacks: { frequency: calm ? 'rare' : frequent || deep ? 'often' : 'moderate', minDepthPercent: calm ? '0.5' : deep ? '8' : frequent ? '3' : '2', maxDepthPercent: calm ? '3' : deep ? '22' : frequent ? '12' : '8', durationMinutes: 45 },
    candles: { intensity: calm ? 'low' : shadows ? 'high' : 'medium', diversity: calm ? .3 : shadows ? .9 : .65, pauseFrequency: calm ? 'rare' : 'moderate' },
    wicks: { length: calm ? 'short' : shadows ? 'pronounced' : 'normal', longFrequency: calm ? 'rare' : shadows ? 'often' : 'moderate' },
  };
}

export function validateScenarioControls(program: ScenarioControlsProgram, initialPrice: string): void {
  const initial = units(initialPrice), cap = units(program.maxPrice), first = units(exactPriceFromGain(initialPrice, program.first24hGainPercent));
  // Ten decimal asset precision still needs enough distinct prices for actual
  // candles. Very large decimals must survive the generator's numeric DTO.
  for (const value of [initialPrice, program.maxPrice, ...program.stages.map(stage => stage.targetPrice)]) {
    const canonical = normalizeScenarioDecimal(value);
    if (Number(value) < .00000001 || Number(value) > 1000000000 || normalizeScenarioDecimal(Number(value).toFixed(10)) !== canonical) {
      throw new RangeError('Цена не помещается в точность актива: используйте значения от 0,00000001 до 1000000000 с меньшим числом знаков');
    }
  }
  if (initial <= 0n || cap <= initial) throw new RangeError('Максимальная цена должна быть выше начальной цены');
  if (first >= cap) throw new RangeError('Цель за первые сутки выше максимальной цены');
  if (Number(program.first24hGainPercent) <= 0 || Number(program.first24hGainPercent) > 100000) throw new RangeError('Рост за первые сутки должен быть больше нуля и не выше 100000%');
  if (units(program.pullbacks.minDepthPercent) > units(program.pullbacks.maxDepthPercent)) throw new RangeError('Минимальная глубина отката не может быть больше максимальной');
  let elapsed = 0, previous = initial, foundDayOne = false;
  for (const [index, stage] of program.stages.entries()) {
    elapsed += stage.durationHours;
    const target = units(stage.targetPrice);
    // An explicit final DEEP_RECOVERY peak may touch the hard boundary once.
    // All intermediate endpoints and every other scenario retain wick headroom.
    // The canonical generator then retreats into a bounded moving range.
    const terminalPeak = program.scenario === 'DEEP_RECOVERY' && program.afterGrowth === 'range'
      && index === program.stages.length - 1 && stage.type === 'recovery' && target === cap;
    if (target <= 0n || (!terminalPeak && (target > cap * 97n / 100n || target + 2n >= cap))) throw new RangeError('Цель этапа должна оставлять не менее 3% до максимальной цены для колебаний и теней');
    if ((stage.type === 'growth' || stage.type === 'recovery') && target <= previous) throw new RangeError('Цена в конце роста или восстановления должна быть выше цены в начале этапа');
    if (stage.type === 'range' && target !== previous) throw new RangeError('Для боковика цена в начале и конце этапа должна совпадать');
    if (stage.type === 'pullback' && target >= previous) throw new RangeError('Цена в конце отката должна быть ниже цены в начале этапа');
    if (elapsed === 24) { foundDayOne = true; if (target !== first) throw new RangeError('Цель этапа в конце первых суток не совпадает с ростом за первые 24 часа'); }
    previous = target;
  }
  if (!foundDayOne) throw new RangeError('Один из этапов должен заканчиваться ровно через 24 часа с целью первых суток');
  if (elapsed < 24 || elapsed > 720) throw new RangeError('Общая продолжительность роста должна быть от 24 до 720 часов');
  if (program.afterGrowth === 'historical') {
    if (!program.historical) throw new RangeError('Для истории загрузите CSV с проверенными часовыми свечами');
    validateHistoricalMoveProgram(program.historical);
    if (program.stages[program.stages.length - 1]?.type !== 'pullback')
      throw new RangeError('Перед историческим сценарием необходим заключительный этап падения');
    const bounds = historicalReplayBounds(program.historical, Number(program.stages[program.stages.length - 1].targetPrice));
    if (bounds.max >= Number(program.maxPrice) * 0.995)
      throw new RangeError('Исторический отрезок превышает общий лимит цены: выберите другой фрагмент');
    if (bounds.min < 1e-8)
      throw new RangeError('Историческое движение выходит за точность актива');
  } else if (program.historical) {
    throw new RangeError('Исторические свечи должны сохраняться только в историческом режиме');
  }
}
