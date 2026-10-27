/** Pure, deterministic DTO/math shared by the listing validator and simulation. No IO. */
import type { HistoricalMoveProgram } from './listingHistoricalReplay';
import type { HistoricalGrowthProgram } from './listingHistoricalGrowth';
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
  /**
   * `historical-window`: the growth itself follows a scaled historical window
   * (listingHistoricalGrowth.ts) INSTEAD of the stages, which must then be
   * empty. Absent: the programmed stages (and, optionally, the hourly
   * continuation after them). The two are mutually exclusive.
   */
  growth?: 'historical-window';
  historicalGrowth?: HistoricalGrowthProgram;
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

/* Historical growth window (voltex.historical-growth.v1). Inert copy of the
 * structural rules: the reference module adds the logs checksum on save. */
export const HISTORICAL_GROWTH_LIMITS = { minRows: 30, maxRows: 1500, minPeakPercent: 7248, maxPeakPercent: 15324, logScale: 100000000, maxAbsLog: 2000000000 } as const;

export function validateHistoricalGrowthStructure(program: HistoricalGrowthProgram): void {
  const L = HISTORICAL_GROWTH_LIMITS;
  if (!program || program.format !== 'voltex.historical-growth.v1' || program.scenarioVersion !== 1
      || typeof program.scenarioId !== 'string' || !/^VHX-\d{2}-[A-Z0-9]{2,10}$/.test(program.scenarioId)
      || program.rights !== 'HISTORICAL_RIGHTS_UNVERIFIED')
    throw new RangeError('Неизвестный формат исторического окна роста');
  const s = program.source;
  const reference = !!s && s.dataKind === 'daily_reference' && s.provider === 'Coin Metrics' && s.quote === 'USD' && s.metric === 'PriceUSD' && s.license === 'CC-BY-NC-4.0';
  const ohlc = !!s && s.dataKind === 'exchange_ohlcv' && s.provider === 'Binance Vision' && s.quote === 'USDT' && s.metric === 'spot daily OHLCV'
    && s.license === 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms';
  if (!s || (!reference && !ohlc) || typeof s.asset !== 'string' || !/^[A-Z0-9]{2,10}$/.test(s.asset) || s.timeframe !== '1d'
      || typeof s.sliceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(s.sliceSha256))
    throw new RangeError('Источник исторического окна описан не полностью');
  const c = program.clock;
  if (!c || c.mode !== 'REAL_TIME' || c.sourceStepSeconds !== 86400 || c.scenarioStepSeconds !== 86400)
    throw new RangeError('Историческое окно работает только в реальном времени: сутки источника = сутки сценария');
  // v1 = straight-line baseline, v2 = seeded bridge; each only for its data kind.
  if (ohlc ? program.intrabar !== 'SEEDED_OHLC_PATH_V1' && program.intrabar !== 'SEEDED_BRIDGE_OHLC_V2'
    : program.intrabar !== 'LOG_LINEAR_REFERENCE_V1' && program.intrabar !== 'SEEDED_BRIDGE_REFERENCE_V2')
    throw new RangeError('Модель внутри суток не соответствует типу данных');
  const target = program.targetPeakGrowthPercent;
  if (typeof target !== 'string' || !/^\d{4,5}(?:\.\d{1,2})?$/.test(target) || Number(target) < L.minPeakPercent || Number(target) > L.maxPeakPercent)
    throw new RangeError('Пик сценария должен быть от +7248% до +15324% от начальной цены');
  const n = program.targetNormalization;
  if (n !== undefined && (n.version !== 1 || n.method !== 'LOG_AMPLITUDE_OWNER_CAP'
      || n.sourceTargetPeakGrowthPercent !== '15324' || n.maxTargetPeakGrowthPercent !== '15000'
      || Object.keys(n).sort().join(',') !== 'maxTargetPeakGrowthPercent,method,sourceTargetPeakGrowthPercent,version'
      || target !== '15000' || program.scenarioId !== 'VHX-09-MATIC' || s.asset !== 'MATIC'
      || s.sliceSha256 !== '82ff2bd811e39eed37f01d72c3c204e46b7d9d9a7775a788c6a1710a351615eb'))
    throw new RangeError('Неверная версия нормализации цели History20');
  const rows = program.logs, width = ohlc ? 4 : 1;
  if (!Array.isArray(rows) || rows.length < L.minRows || rows.length > L.maxRows)
    throw new RangeError('Историческое окно: от 30 до 1500 суток источника');
  const day = (text: unknown) => {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
    const at = Date.parse(text + 'T00:00:00.000Z');
    return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === text ? at : NaN;
  };
  const first = day(s.firstDate), last = day(s.lastDate);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last - first !== (rows.length - 1) * 86400000)
    throw new RangeError('Даты исторического окна не совпадают с числом суток: пропуски не допускаются');
  let max = -Infinity;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== width || !row.every(v => Number.isSafeInteger(v) && Math.abs(v) <= L.maxAbsLog))
      throw new RangeError('Неверные значения исторического окна');
    if (ohlc && (row[1] < Math.max(row[0], row[3]) || row[2] > Math.min(row[0], row[3]))) throw new RangeError('Неверная свеча OHLC в историческом окне');
    max = Math.max(max, ohlc ? row[1] : row[0]);
  }
  if (rows[0][0] !== 0) throw new RangeError('Первое значение окна должно совпадать с опорной ценой');
  if (!(max > 0)) throw new RangeError('Максимум окна должен быть выше первой цены');
}

/** Scenario level: no stages, no hourly continuation, the cap is exactly P0 · (1 + G/100). */
function validateHistoricalWindowControls(program: ScenarioControlsProgram, initialPrice: string): void {
  if (program.growth !== 'historical-window' || !program.historicalGrowth)
    throw new RangeError('Выберите историческое окно роста или вернитесь к этапам');
  if (program.stages.length !== 0 || program.afterGrowth !== 'range' || program.historical !== undefined || program.first24hGainPercent !== '0')
    throw new RangeError('Историческое окно заменяет этапы: этапы, продолжение по часовым свечам и рост за первые сутки не задаются');
  validateHistoricalGrowthStructure(program.historicalGrowth);
  const canonical = normalizeScenarioDecimal(initialPrice);
  if (Number(initialPrice) < .00000001 || Number(initialPrice) > 1000000000 || normalizeScenarioDecimal(Number(initialPrice).toFixed(10)) !== canonical)
    throw new RangeError('Цена не помещается в точность актива: используйте значения от 0,00000001 до 1000000000 с меньшим числом знаков');
  if (normalizeScenarioDecimal(program.maxPrice) !== exactPriceFromGain(initialPrice, program.historicalGrowth.targetPeakGrowthPercent))
    throw new RangeError('Максимальная цена исторического окна должна быть ровно P0 · (1 + G/100)');
  if (Number(program.maxPrice) > 1000000000) throw new RangeError('Пик исторического окна выходит за поддерживаемую точность цены');
  const g = program.historicalGrowth, ohlc = g.source.dataKind === 'exchange_ohlcv';
  let max = -Infinity, min = Infinity;
  for (const row of g.logs) { max = Math.max(max, ohlc ? row[1] : row[0]); min = Math.min(min, ohlc ? row[2] : row[0]); }
  const alpha = Math.log(1 + Number(g.targetPeakGrowthPercent) / 100) / (max / HISTORICAL_GROWTH_LIMITS.logScale);
  if (!(alpha > 0) || !Number.isFinite(alpha) || Number(initialPrice) * Math.exp(alpha * min / HISTORICAL_GROWTH_LIMITS.logScale) < 1e-8)
    throw new RangeError('Историческое окно выходит за точность актива');
}

export function validateScenarioControls(program: ScenarioControlsProgram, initialPrice: string): void {
  if (program.growth !== undefined || program.historicalGrowth !== undefined) { validateHistoricalWindowControls(program, initialPrice); return; }
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
