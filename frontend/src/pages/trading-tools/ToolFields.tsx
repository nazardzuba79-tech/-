import { useId, type ReactNode } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { Draft, FieldName, Market, ToolMode } from './types';

export type DraftUpdate = <K extends keyof Draft>(key: K, value: Draft[K]) => void;
type ErrorMap = Record<string, string>;
type Props = { mode: ToolMode; market: Market; draft: Draft; errors: ErrorMap; update: DraftUpdate };

export function Segment<T extends string>({ label, value, options, onChange, field }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; field?: string }) {
  return <div className="tt-control"><span className="tt-label">{label}</span><div className="tt-segment" role="group" aria-label={label}>{options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} data-tools-field={field} data-tools-value={option.value} className={value === option.value ? 'is-active' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></div>;
}

export function ToolFields({ mode, market, draft: d, errors, update }: Props) {
  const field = (name: FieldName, label: string, unit = 'USDT', hint?: string, errorKey: string = name) => <ToolField key={name} name={name} label={label} unit={unit} hint={hint} value={d[name]} error={d.touched.includes(name) ? errors[errorKey] : undefined} onChange={(value) => update(name, value)} />;
  const side = <Segment label="Направление" field="side" value={d.side} options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} onChange={(value) => update('side', value)} />;
  const extra = (children: ReactNode) => <details className="tt-advanced"><summary>Дополнительные параметры<ChevronDown size={16} aria-hidden="true" /></summary><p>Ставки заданы пользователем. Нулевые расходы — допущение для расчёта.</p><div className="tt-field-grid">{children}</div></details>;
  if (mode === 'pnl') return <>
    {market === 'futures' && side}
    <div className="tt-field-grid">{field('entry', 'Цена входа')}{field('exit', 'Цена выхода')}</div>
    <Segment label="Источник количества" field="quantityMode" value={d.quantityMode} options={[{ value: 'quantity', label: 'Количество' }, { value: 'margin', label: market === 'spot' ? 'Сумма покупки' : 'Начальная маржа' }]} onChange={(value) => update('quantityMode', value)} />
    <div className="tt-field-grid">{d.quantityMode === 'quantity' ? field('quantity', 'Количество актива', 'ед.') : field('margin', market === 'spot' ? 'Сумма покупки до комиссии' : 'Начальная маржа', 'USDT', 'Не включает комиссию входа')}{market === 'futures' && field('leverage', 'Плечо', '×')}</div>
    {extra(<>{field('feeEntry', 'Комиссия входа', '%')}{field('feeExit', 'Комиссия выхода', '%')}{field('slipEntry', 'Проскальзывание входа', '%')}{field('slipExit', 'Проскальзывание выхода', '%')}{market === 'futures' && field('funding', 'Нетто-расход funding', 'USDT', 'Минус означает поступление')}{field('fixedCosts', 'Прочие расходы')}</>)}
  </>;
  if (mode === 'size') return <>{side}<div className="tt-field-grid">{field('capital', 'Капитал для расчёта')}{field('riskPercent', 'Риск на сценарий', '%')}{field('entry', 'Цена входа')}{field('stop', 'Цена стопа')}{field('leverage', 'Плечо', '×')}</div>{extra(<>{field('feeEntry', 'Комиссия входа', '%')}{field('feeStop', 'Комиссия выхода по стопу', '%')}{field('slipEntry', 'Проскальзывание входа', '%')}{field('slipStop', 'Проскальзывание стопа', '%')}{field('fixedCosts', 'Резерв расходов')}{field('budget', 'Бюджет маржи', 'USDT', 'Необязательно')}{field('step', 'Шаг количества', 'ед.', 'Необязательно; округление вниз')}</>)}</>;
  if (mode === 'liquidation') return <><div className="tt-scope-note">Изолированная линейная позиция · USDT</div>{side}<div className="tt-field-grid">{field('entry', 'Цена входа')}{field('quantity', 'Количество актива', 'ед.')}{field('leverage', 'Плечо', '×')}{field('maintenanceRate', 'Ставка поддерживающей маржи', '%', 'Укажите ставку для своей модели')}</div>{extra(<>{field('additionalMargin', 'Дополнительная маржа')}{field('costs', 'Уже вычтенные расходы')}</>)}</>;
  if (mode === 'risk-reward') return <>{side}<div className="tt-field-grid">{field('entry', 'Цена входа')}{field('quantity', 'Количество актива', 'ед.')}{field('stop', 'Цена стопа')}{field('target', 'Цена цели')}</div>{extra(<>{field('feeEntry', 'Комиссия входа', '%')}{field('feeStop', 'Комиссия по стопу', '%')}{field('feeTarget', 'Комиссия по цели', '%')}{field('slipEntry', 'Проскальзывание входа', '%')}{field('slipStop', 'Проскальзывание стопа', '%')}{field('slipTarget', 'Проскальзывание цели', '%')}{field('fixedCosts', 'Фиксированные расходы')}</>)}</>;
  if (mode === 'dca') return <>
    <p className="tt-scope-note">Покупки одного актива · комиссия дополнительно в USDT</p>
    <div className="tt-purchases">{d.rows.map((row, index) => {
      const setRow = (key: keyof typeof row, value: string) => update('rows', d.rows.map((item) => item.id === row.id ? { ...item, [key]: value } : item));
      const rowError = (key: string) => errors[`rows.${index}.${key}`] || errors[`rows[${index}].${key}`];
      return <fieldset className="tt-purchase" key={row.id} data-tools-row={index}><legend>Покупка {index + 1}</legend><button className="tt-row-remove" type="button" aria-label={`Удалить покупку ${index + 1}`} disabled={d.rows.length === 1} onClick={() => update('rows', d.rows.filter((item) => item.id !== row.id))}><Trash2 size={15} /></button>
        <Segment label={`Способ ввода покупки ${index + 1}`} value={row.mode} options={[{ value: 'quantity', label: 'Количество' }, { value: 'amount', label: 'Сумма' }]} onChange={(value) => setRow('mode', value)} />
        <div className="tt-field-grid"><ToolField name={`rows.${index}.price`} label="Цена покупки" unit="USDT" value={row.price} error={d.touched.includes('rows') ? rowError('price') : undefined} onChange={(value) => setRow('price', value)} /><ToolField name={`rows.${index}.${row.mode}`} label={row.mode === 'quantity' ? 'Количество' : 'Сумма покупки без комиссии'} unit={row.mode === 'quantity' ? 'ед.' : 'USDT'} value={row[row.mode]} error={d.touched.includes('rows') ? rowError(row.mode) : undefined} onChange={(value) => setRow(row.mode, value)} /><ToolField name={`rows.${index}.fee`} label="Комиссия покупки" unit="%" value={row.fee} error={d.touched.includes('rows') ? rowError('fee') : undefined} onChange={(value) => setRow('fee', value)} /></div>
      </fieldset>;
    })}</div>
    <button type="button" className="tt-add-row" data-tools-action="add-row" disabled={d.rows.length >= 50} onClick={() => update('rows', [...d.rows, { id: Math.max(...d.rows.map((row) => row.id)) + 1, mode: 'quantity', price: '', quantity: '', amount: '', fee: '0' }])}><Plus size={16} />Добавить покупку <small>{d.rows.length} / 50</small></button>
    {errors.rows && <p className="tt-field-error" role="status">{errors.rows}</p>}
    <details className="tt-advanced"><summary>Оценка по цене выхода<ChevronDown size={16} /></summary><Toggle label="Учесть предполагаемый выход" checked={d.dcaExitEnabled} onChange={(value) => update('dcaExitEnabled', value)} field="dcaExitEnabled" />{d.dcaExitEnabled && <div className="tt-field-grid">{field('exitPrice', 'Цена выхода', 'USDT', undefined, 'exit.price')}{field('dcaExitFee', 'Комиссия выхода', '%', undefined, 'exit.fee')}</div>}</details>
    <details className="tt-advanced"><summary>Покупка для целевой средней<ChevronDown size={16} /></summary><Toggle label="Рассчитать дополнительную покупку" checked={d.targetEnabled} onChange={(value) => update('targetEnabled', value)} field="targetEnabled" />{d.targetEnabled && <div className="tt-field-grid">{field('newPrice', 'Цена новой покупки', 'USDT', undefined, 'targetAverage.price')}{field('newFee', 'Комиссия новой покупки', '%', undefined, 'targetAverage.fee')}{field('targetAverage', 'Целевая средняя стоимость', 'USDT', undefined, 'targetAverage.target')}</div>}</details>
  </>;
  return <>
    <Segment label="Способ ввода" field="inputMode" value={d.inputMode} options={[{ value: 'quantity', label: 'Количество и цены' }, { value: 'notional', label: 'Номиналы' }]} onChange={(value) => update('inputMode', value)} />
    <div className="tt-field-grid">{d.inputMode === 'quantity' ? <>{field('quantity', 'Количество актива', 'ед.')}{field('entry', 'Цена входа')}</> : field('notionalEntry', 'Номинал входа')}</div>
    <Toggle label="Учесть выход" field="includeExit" checked={d.includeExit} onChange={(value) => update('includeExit', value)} />
    {d.includeExit && <div className="tt-field-grid">{d.inputMode === 'quantity' ? field('exit', 'Цена выхода') : field('notionalExit', 'Номинал выхода')}</div>}
    <div className="tt-field-grid"><Segment label="Исполнение входа" field="entryRole" value={d.entryRole} options={[{ value: 'maker', label: 'Maker' }, { value: 'taker', label: 'Taker' }]} onChange={(value) => update('entryRole', value)} />{d.includeExit && <Segment label="Исполнение выхода" field="exitRole" value={d.exitRole} options={[{ value: 'maker', label: 'Maker' }, { value: 'taker', label: 'Taker' }]} onChange={(value) => update('exitRole', value)} />}{field('makerRate', 'Ставка Maker', '%')}{field('takerRate', 'Ставка Taker', '%')}</div>
    <p className="tt-help">Ставки заданы пользователем. Сразу исполненный лимитный ордер может быть Taker.</p>
    {market === 'futures' && <details className="tt-advanced"><summary>Финансирование (funding)<ChevronDown size={16} /></summary><Toggle label="Учесть финансирование" field="fundingEnabled" checked={d.fundingEnabled} onChange={(value) => update('fundingEnabled', value)} />{d.fundingEnabled && <>{side}<div className="tt-field-grid">{field('fundingNotional', 'Номинал для funding', 'USDT', undefined, 'funding.notional')}{field('fundingRate', 'Знаковая ставка за период', '%', undefined, 'funding.rate')}{field('fundingPeriods', 'Количество периодов', '', 'Целое число от нуля', 'funding.periods')}</div><p className="tt-help">При неизменных номинале и ставке во всех указанных периодах. Плюс — расход, минус — поступление.</p></>}</details>}
  </>;
}

export function Toggle({ label, checked, onChange, field }: { label: string; checked: boolean; onChange: (value: boolean) => void; field: string }) {
  return <label className="tt-toggle"><input type="checkbox" checked={checked} data-tools-field={field} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

export function ToolField({ name, label, unit, hint, value, error, onChange }: { name: string; label: string; unit: string; hint?: string; value: string; error?: string; onChange: (value: string) => void }) {
  const id = useId();
  return <label className={`tt-field${error ? ' has-error' : ''}`} htmlFor={id}><span className="tt-label">{label}</span><span className="tt-input-shell"><input id={id} aria-label={label} data-tools-field={name} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={value} placeholder="Введите значение" onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} /><span aria-hidden="true">{unit}</span></span>{hint && <small id={`${id}-hint`}>{hint}</small>}{error && <small id={`${id}-error`} className="tt-field-error">{error}</small>}</label>;
}
