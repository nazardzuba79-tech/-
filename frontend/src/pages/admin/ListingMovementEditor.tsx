import { useState } from 'react';
import {
  MOVEMENT_SCENARIOS, formatMovementPrice, movementDuration, movementGainFromPrice, movementPriceFromGain,
  normalizeMovementDecimal, parseMovementHours, movementStageMoment, selectMovementScenario, type ListingMovement, type MovementFrequency,
} from './listingMovementModel';

const FREQUENCIES: { value: MovementFrequency; label: string }[] = [{ value: 'rare', label: 'Редко' }, { value: 'moderate', label: 'Умеренно' }, { value: 'often', label: 'Часто' }];
const STAGES = [{ value: 'growth', label: 'Рост' }, { value: 'range', label: 'Боковик' }, { value: 'pullback', label: 'Откат' }, { value: 'recovery', label: 'Восстановление' }] as const;

function Frequency({ value, onChange, field }: { value: MovementFrequency; onChange: (value: MovementFrequency) => void; field: string }) {
  return <select value={value} onChange={e => onChange(e.target.value as MovementFrequency)} data-field={field}>{FREQUENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>;
}

export function ListingMovementEditor({ value, initialPrice, listingAt, locked, onChange }: {
  value: ListingMovement; initialPrice: string; listingAt: string | null; locked: boolean; onChange: (value: ListingMovement) => void;
}) {
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [durationUnit, setDurationUnit] = useState<'hours' | 'days'>('days');
  const [stageUnits, setStageUnits] = useState<Record<number, 'hours' | 'days'>>({});
  const [gainText, setGainText] = useState<{ price: string; initial: string; text: string } | null>(null);
  const maxGain = gainText?.price === value.maxPrice && gainText.initial === initialPrice ? gainText.text : movementGainFromPrice(initialPrice, value.maxPrice);
  const selected = MOVEMENT_SCENARIOS.find(item => item.id === value.scenario);
  const totalHours = movementDuration(value);
  const updateStage = (index: number, changes: Partial<ListingMovement['stages'][number]>) => onChange({ ...value, stages: value.stages.map((stage, i) => i === index ? { ...stage, ...changes } : stage) });

  return <fieldset className="listing-movement" disabled={locked} data-movement-editor>
    <legend>Движение цены</legend>
    <p className="listing-hint">Настройки сохраняются на сервере. Черновик и предпросмотр не запускают рынок и не зачисляют средства.</p>
    <div className="listing-scenario-choice">
      <label>Сценарий движения<select value={value.scenario} onChange={e => onChange(selectMovementScenario(value, e.target.value as ListingMovement['scenario']))} data-field="scenario">
        <option value="AUTO">Выбрать автоматически</option>
        {MOVEMENT_SCENARIOS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select><small>{selected?.description ?? 'При сохранении сервер выберет один сценарий. Он останется тем же при обновлении страницы.'}</small></label>
      <button type="button" onClick={() => setScenarioOpen(open => !open)} aria-expanded={scenarioOpen} data-scenario-gallery>{scenarioOpen ? 'Скрыть варианты' : 'Сравнить 10 сценариев'}</button>
    </div>
    {scenarioOpen && <div className="listing-scenario-cards" data-scenario-options>
      {MOVEMENT_SCENARIOS.map((item, index) => <button type="button" key={item.id} onClick={() => onChange(selectMovementScenario(value, item.id))} aria-pressed={value.scenario === item.id} data-select-scenario={item.id}>
        <span className="listing-scenario-number">{String(index + 1).padStart(2, '0')}</span><span><b>{item.name}</b><small>{item.description}</small></span>
      </button>)}
      <p className="listing-hint">Для свечного примера выберите вариант, сохраните черновик и нажмите «Предпросмотр». Генерируется только выбранный сценарий.</p>
    </div>}
    <div className="listing-grid">
      <label>Рост за первые 24 часа, %<input inputMode="decimal" value={value.first24hGainPercent} data-field="first24hGainPercent" onChange={e => {
        const gain = normalizeMovementDecimal(e.target.value); let elapsed = 0;
        onChange({ ...value, first24hGainPercent: gain, stages: value.stages.map(stage => { elapsed += stage.durationHours; return elapsed === 24 ? { ...stage, targetPrice: movementPriceFromGain(initialPrice, gain) } : stage; }) });
      }} /><small>От начальной цены, ровно через 24 часа. Не повторяется каждый день.</small><strong data-day-one-price>Цена через 24 часа: {formatMovementPrice(movementPriceFromGain(initialPrice, value.first24hGainPercent))} USDT</strong></label>
      <label>Продолжительность роста<div className="listing-input-unit"><input inputMode="decimal" value={Number.isFinite(totalHours) ? totalHours / (durationUnit === 'days' ? 24 : 1) : ''} data-field="growthDuration" onChange={e => {
        const total = parseMovementHours(e.target.value, durationUnit);
        if (total === 24 && value.stages[0]?.durationHours === 24) { onChange({ ...value, stages: [value.stages[0]] }); return; }
        if (value.stages.length === 1 && value.stages[0].durationHours === 24 && total > 24) {
          onChange({ ...value, stages: [...value.stages, { type: 'range', durationHours: total - 24, targetPrice: value.stages[0].targetPrice }] }); return;
        }
        const other = value.stages.slice(0, -1).reduce((sum, stage) => sum + stage.durationHours, 0);
        updateStage(value.stages.length - 1, { durationHours: total - other });
      }} /><select aria-label="Единица продолжительности роста" value={durationUnit} data-field="growthDurationUnit" onChange={e => setDurationUnit(e.target.value as 'hours' | 'days')}><option value="hours">часов</option><option value="days">дней</option></select></div><small>Всего {formatMovementPrice(totalHours)} ч. Изменение продолжительности меняет последний этап.</small></label>
      <label>Максимальный рост от начальной цены, %<input inputMode="decimal" value={maxGain} data-field="maxGainPercent" onChange={e => {
        const text = normalizeMovementDecimal(e.target.value), price = movementPriceFromGain(initialPrice, text);
        setGainText({ price, initial: initialPrice, text }); onChange({ ...value, maxPrice: price });
      }} /><small>Общий верхний предел относительно начальной цены, а не цены первых суток.</small></label>
      <label>Максимальная цена, USDT<input inputMode="decimal" value={value.maxPrice} data-field="maxPrice" onChange={e => { setGainText(null); onChange({ ...value, maxPrice: normalizeMovementDecimal(e.target.value) }); }} /><small>Единственная сохранённая граница, включая верхние тени. Не округляется вверх.</small><strong data-maximum-price>{formatMovementPrice(value.maxPrice)} USDT</strong></label>
      <label className="listing-wide">Поведение после завершения роста<select value={value.afterGrowth} data-field="afterGrowth" onChange={() => {}}><option value="range">Боковик без дальнейшего направленного роста</option></select><small>Цена продолжает колебаться, но новый этап роста автоматически не начинается. Предусмотрен запас до максимума для теней.</small></label>
    </div>
    <details className="listing-settings-details" data-movement-stages id="listing-section-stages">
      <summary>Этапы движения <span>{value.stages.length} · {formatMovementPrice(totalHours)} ч</span></summary>
      <p className="listing-hint">Цели задаются в USDT. Процент рядом всегда рассчитан от начальной цены. Один этап должен завершаться ровно через 24 часа с целью первых суток.</p>
      <div className="listing-stages">
        {value.stages.map((stage, index) => {
          const before = value.stages.slice(0, index).reduce((sum, item) => sum + item.durationHours, 0), unit = stageUnits[index] ?? 'hours';
          return <div key={index} className="listing-stage" data-stage={index}>
            <h4>Этап {index + 1}</h4><div className="listing-grid">
              <label>Тип движения<select value={stage.type} data-field={`stageType-${index}`} onChange={e => updateStage(index, { type: e.target.value as typeof stage.type })}>{STAGES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Длительность<div className="listing-input-unit"><input inputMode="decimal" value={Number.isFinite(stage.durationHours) ? stage.durationHours / (unit === 'days' ? 24 : 1) : ''} data-field={`stageDuration-${index}`} onChange={e => updateStage(index, { durationHours: parseMovementHours(e.target.value, unit) })} /><select aria-label={`Единица длительности этапа ${index + 1}`} value={unit} onChange={e => setStageUnits({ ...stageUnits, [index]: e.target.value as 'hours' | 'days' })}><option value="hours">часов</option><option value="days">дней</option></select></div></label>
              <label>Целевая цена, USDT<input inputMode="decimal" value={stage.targetPrice} data-field={`stageTarget-${index}`} onChange={e => updateStage(index, { targetPrice: normalizeMovementDecimal(e.target.value) })} /><small>Целевой рост от начальной цены: {formatMovementPrice(movementGainFromPrice(initialPrice, stage.targetPrice))}%</small></label>
              <div className="listing-stage-time"><span>Начало: {movementStageMoment(listingAt, before)}</span><span>Окончание: {movementStageMoment(listingAt, before + stage.durationHours)}</span><small>{formatMovementPrice(stage.durationHours)} ч · {formatMovementPrice(stage.durationHours / 24)} дней</small></div>
            </div>
            {value.stages.length > 1 && <button type="button" onClick={() => onChange({ ...value, stages: value.stages.filter((_, i) => i !== index) })} data-remove-stage={index}>Убрать этап</button>}
          </div>;
        })}
      </div>
      <button type="button" disabled={value.stages.length >= 12} onClick={() => onChange({ ...value, stages: [...value.stages, { type: 'range', durationHours: 24, targetPrice: value.stages[value.stages.length - 1]?.targetPrice ?? initialPrice }] })} data-add-stage>Добавить этап</button>
    </details>
    <details className="listing-settings-details" data-movement-advanced id="listing-section-advanced">
      <summary>Точная настройка свечей <span>Откаты, колебания и тени</span></summary>
      <h3>Откаты</h3><p className="listing-hint">Глубина отката считается от локальной вершины, а не от начальной цены монеты.</p>
      <div className="listing-grid">
        <label>Частота откатов<Frequency value={value.pullbacks.frequency} field="pullbackFrequency" onChange={frequency => onChange({ ...value, pullbacks: { ...value.pullbacks, frequency } })} /></label>
        <label>Длительность откатов, минут<input inputMode="numeric" value={value.pullbacks.durationMinutes} data-field="pullbackDuration" onChange={e => onChange({ ...value, pullbacks: { ...value.pullbacks, durationMinutes: Number(e.target.value) } })} /></label>
        <label>Минимальная глубина отката, %<input inputMode="decimal" value={value.pullbacks.minDepthPercent} data-field="pullbackMin" onChange={e => onChange({ ...value, pullbacks: { ...value.pullbacks, minDepthPercent: normalizeMovementDecimal(e.target.value) } })} /></label>
        <label>Максимальная глубина отката, %<input inputMode="decimal" value={value.pullbacks.maxDepthPercent} data-field="pullbackMax" onChange={e => onChange({ ...value, pullbacks: { ...value.pullbacks, maxDepthPercent: normalizeMovementDecimal(e.target.value) } })} /></label>
      </div>
      <h3>Свечи</h3><div className="listing-grid">
        <label>Сила колебаний<select value={value.candles.intensity} data-field="candleIntensity" onChange={e => onChange({ ...value, candles: { ...value.candles, intensity: e.target.value as ListingMovement['candles']['intensity'] } })}><option value="low">Низкая</option><option value="medium">Средняя</option><option value="high">Высокая</option></select></label>
        <label>Разнообразие размеров свечей<input type="range" min="0" max="1" step="0.05" value={value.candles.diversity} data-field="candleDiversity" onChange={e => onChange({ ...value, candles: { ...value.candles, diversity: Number(e.target.value) } })} /><small>{Math.round(value.candles.diversity * 100)}% · различие маленьких и больших свечей</small></label>
        <label>Паузы между сильными движениями<Frequency value={value.candles.pauseFrequency} field="candlePauses" onChange={pauseFrequency => onChange({ ...value, candles: { ...value.candles, pauseFrequency } })} /></label>
      </div>
      <h3>Тени свечей</h3><div className="listing-grid">
        <label>Длина теней<select value={value.wicks.length} data-field="wickLength" onChange={e => onChange({ ...value, wicks: { ...value.wicks, length: e.target.value as ListingMovement['wicks']['length'] } })}><option value="short">Короткие</option><option value="normal">Обычные</option><option value="pronounced">Выраженные</option></select></label>
        <label>Частота длинных теней<Frequency value={value.wicks.longFrequency} field="longWickFrequency" onChange={longFrequency => onChange({ ...value, wicks: { ...value.wicks, longFrequency } })} /></label>
      </div>
      <p className="listing-hint">Настройки задают характер движения, не одинаковый размер каждой свечи. Объёмы — модельная активность, не реальные сделки.</p>
    </details>
  </fieldset>;
}
