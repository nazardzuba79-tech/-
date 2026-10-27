"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LISTING_SCENARIOS = void 0;
exports.normalizeScenarioDecimal = normalizeScenarioDecimal;
exports.exactPriceFromGain = exactPriceFromGain;
exports.exactGainFromPrice = exactGainFromPrice;
exports.exactPriceFraction = exactPriceFraction;
exports.defaultScenarioControls = defaultScenarioControls;
exports.validateScenarioControls = validateScenarioControls;
/** Pure, deterministic DTO/math shared by the listing validator and simulation. No IO. */
exports.LISTING_SCENARIOS = ['CALM', 'WAVES', 'FREQUENT_PULLBACKS', 'COMPRESSION_BREAKOUT', 'STAIRCASE', 'SLOW_START', 'FAST_START', 'FALSE_BREAKOUT', 'DEEP_RECOVERY', 'LONG_WICKS'];
function normalizeScenarioDecimal(input) {
    const text = input.trim().replace(',', '.');
    if (!/^\d{1,18}(?:\.\d{1,10})?$/.test(text))
        throw new RangeError('Введите положительное число, не более 10 знаков после запятой');
    const [whole, fraction = ''] = text.split('.');
    const clean = fraction.replace(/0+$/, '');
    return `${BigInt(whole)}${clean ? `.${clean}` : ''}`;
}
const SCALE = 10000000000n;
function units(input) {
    const [whole, fraction = ''] = normalizeScenarioDecimal(input).split('.');
    return BigInt(whole) * SCALE + BigInt(fraction.padEnd(10, '0'));
}
function decimal(value) {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const fraction = (absolute % SCALE).toString().padStart(10, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${absolute / SCALE}${fraction ? `.${fraction}` : ''}`;
}
/** Downward asset-precision quantization: a hard maximum is never rounded up. */
function exactPriceFromGain(initialPrice, gainPercent) {
    return decimal(units(initialPrice) * (100n * SCALE + units(gainPercent)) / (100n * SCALE));
}
function exactGainFromPrice(initialPrice, price) {
    const initial = units(initialPrice);
    if (initial <= 0n)
        throw new RangeError('Начальная цена должна быть больше нуля');
    return decimal((units(price) - initial) * 100n * SCALE / initial);
}
function exactPriceFraction(price, numerator, denominator = 100) {
    return decimal(units(price) * BigInt(numerator) / BigInt(denominator));
}
function defaultScenarioControls(initialPrice, scenario = 'CALM', first24hGainPercent = '1725', maxPrice = exactPriceFromGain(initialPrice, '9247'), growthHours = 168) {
    const calm = scenario === 'CALM', frequent = scenario === 'FREQUENT_PULLBACKS', deep = scenario === 'DEEP_RECOVERY', shadows = scenario === 'LONG_WICKS';
    return {
        kind: 'scenario-controls-v2', scenario, first24hGainPercent: normalizeScenarioDecimal(first24hGainPercent), maxPrice: normalizeScenarioDecimal(maxPrice),
        stages: [{ type: 'growth', durationHours: 24, targetPrice: exactPriceFromGain(initialPrice, first24hGainPercent) },
            ...(growthHours > 24 ? [{ type: 'growth', durationHours: growthHours - 24, targetPrice: exactPriceFraction(maxPrice, 86) }] : [])],
        afterGrowth: 'range',
        pullbacks: { frequency: calm ? 'rare' : frequent || deep ? 'often' : 'moderate', minDepthPercent: calm ? '0.5' : deep ? '8' : frequent ? '3' : '2', maxDepthPercent: calm ? '3' : deep ? '22' : frequent ? '12' : '8', durationMinutes: 45 },
        candles: { intensity: calm ? 'low' : shadows ? 'high' : 'medium', diversity: calm ? .3 : shadows ? .9 : .65, pauseFrequency: calm ? 'rare' : 'moderate' },
        wicks: { length: calm ? 'short' : shadows ? 'pronounced' : 'normal', longFrequency: calm ? 'rare' : shadows ? 'often' : 'moderate' },
    };
}
function validateScenarioControls(program, initialPrice) {
    const initial = units(initialPrice), cap = units(program.maxPrice), first = units(exactPriceFromGain(initialPrice, program.first24hGainPercent));
    // Ten decimal asset precision still needs enough distinct prices for actual
    // candles. Very large decimals must survive the generator's numeric DTO.
    for (const value of [initialPrice, program.maxPrice, ...program.stages.map(stage => stage.targetPrice)]) {
        const canonical = normalizeScenarioDecimal(value);
        if (Number(value) < .00000001 || Number(value) > 1000000000 || normalizeScenarioDecimal(Number(value).toFixed(10)) !== canonical) {
            throw new RangeError('Цена не помещается в точность актива: используйте значения от 0,00000001 до 1000000000 с меньшим числом знаков');
        }
    }
    if (initial <= 0n || cap <= initial)
        throw new RangeError('Максимальная цена должна быть выше начальной цены');
    if (first >= cap)
        throw new RangeError('Цель за первые сутки выше максимальной цены');
    if (Number(program.first24hGainPercent) <= 0 || Number(program.first24hGainPercent) > 100000)
        throw new RangeError('Рост за первые сутки должен быть больше нуля и не выше 100000%');
    if (units(program.pullbacks.minDepthPercent) > units(program.pullbacks.maxDepthPercent))
        throw new RangeError('Минимальная глубина отката не может быть больше максимальной');
    let elapsed = 0, previous = initial, foundDayOne = false;
    for (const [index, stage] of program.stages.entries()) {
        elapsed += stage.durationHours;
        const target = units(stage.targetPrice);
        // Only the explicit final DEEP_RECOVERY peak may touch the cap.
        // Every previously valid program keeps the existing headroom behavior.
        const terminalPeak = program.scenario === 'DEEP_RECOVERY' && program.afterGrowth === 'range'
            && index === program.stages.length - 1 && stage.type === 'recovery' && target === cap;
        if (target <= 0n || (!terminalPeak && (target > cap * 97n / 100n || target + 2n >= cap)))
            throw new RangeError('Цель этапа должна оставлять не менее 3% до максимальной цены для колебаний и теней');
        if ((stage.type === 'growth' || stage.type === 'recovery') && target <= previous)
            throw new RangeError('Цена в конце роста или восстановления должна быть выше цены в начале этапа');
        if (stage.type === 'range' && target !== previous)
            throw new RangeError('Для боковика цена в начале и конце этапа должна совпадать');
        if (stage.type === 'pullback' && target >= previous)
            throw new RangeError('Цена в конце отката должна быть ниже цены в начале этапа');
        if (elapsed === 24) {
            foundDayOne = true;
            if (target !== first)
                throw new RangeError('Цель этапа в конце первых суток не совпадает с ростом за первые 24 часа');
        }
        previous = target;
    }
    if (!foundDayOne)
        throw new RangeError('Один из этапов должен заканчиваться ровно через 24 часа с целью первых суток');
    if (elapsed < 24 || elapsed > 720)
        throw new RangeError('Общая продолжительность роста должна быть от 24 до 720 часов');
}
//# sourceMappingURL=listingScenarioControls.js.map