import { Calculator, Info } from 'lucide-react';
import { computePnl, computePositionSize, computeLiquidation, computeRiskReward, computeDca, computeFees, compareDecimal, formatDecimal, formatPercent, normalizeLevels } from './math';
import type { Draft, Market, ToolMode } from './types';

export function calculateTool(mode: ToolMode, draft: Draft, market: Market) {
  if (mode === 'pnl') return { mode: 'pnl' as const, result: computePnl({ ...draft, market }) };
  if (mode === 'size') return { mode: 'size' as const, result: computePositionSize(draft) };
  if (mode === 'liquidation') return { mode: 'liquidation' as const, result: computeLiquidation(draft) };
  if (mode === 'risk-reward') return { mode: 'risk-reward' as const, result: computeRiskReward(draft) };
  if (mode === 'dca') return { mode: 'dca' as const, result: computeDca({ rows: draft.rows, ...(draft.dcaExitEnabled ? { exit: { price: draft.exitPrice, fee: draft.dcaExitFee } } : {}), ...(draft.targetEnabled ? { targetAverage: { price: draft.newPrice, fee: draft.newFee, target: draft.targetAverage } } : {}) }) };
  return { mode: 'fees' as const, result: computeFees({ ...draft, market, funding: market === 'futures' && draft.fundingEnabled ? { notional: draft.fundingNotional, rate: draft.fundingRate, periods: draft.fundingPeriods } : undefined }) };
}
export type Calculation = ReturnType<typeof calculateTool>;
type Line = { label: string; value: string | null; unit?: string; signed?: boolean };
const line = (label: string, value: string | null, unit = 'USDT', signed = false): Line => ({ label, value, unit, signed });
export function resultLines(calculation: Calculation): Line[] {
  if (!calculation.result.ok) return [];
  if (calculation.mode === 'pnl' && calculation.result.ok) { const v = calculation.result.value; return [line('Результат после расходов', v.netPnl, 'USDT', true), line('Прибыль до расходов', v.grossPnl, 'USDT', true), line('Комиссия входа', v.feeOpen), line('Комиссия выхода', v.feeClose), ...(v.roiBasis === 'margin' ? [line('Нетто-расход funding', v.funding)] : []), line('Прочие расходы', v.fixedCosts), line('Количество актива', v.quantity, 'ед.'), line('Номинал позиции', v.notional), line(v.roiBasis === 'margin' ? 'Начальная маржа' : 'Стоимость покупки с комиссией', v.roiBasis === 'margin' ? v.initialMargin : v.purchaseCost), line(v.roiBasis === 'margin' ? 'ROI к начальной марже' : 'Доходность к стоимости покупки', v.roi, '%', true), line('Цена исполнения безубыточности', v.breakEvenExecution), line('Цена выхода безубыточности', v.breakEvenTarget)]; }
  if (calculation.mode === 'size' && calculation.result.ok) { const v = calculation.result.value; return [line('Количество позиции', v.quantity, 'ед.'), line('Бюджет риска', v.riskBudget), line('Плановый убыток по стопу', v.plannedLoss), line('Фактический риск к капиталу', v.actualRisk, '%'), line('Номинал позиции', v.notional), line('Начальная маржа', v.margin), line('Зарезервировано с расходами', v.reserved), line('Количество по риску', v.qRisk, 'ед.'), ...(v.qBudget === null ? [] : [line('Количество по бюджету', v.qBudget, 'ед.')])]; }
  if (calculation.mode === 'liquidation' && calculation.result.ok) { const v = calculation.result.value; return [line('Ориентировочная цена ликвидации', v.liquidationPrice), line('Начальная маржа', v.initialMargin), line('Дополнительная маржа', v.additionalMargin), line('Вычтенные расходы', v.costs), line('Оставшееся обеспечение', v.margin), line('Поддерживающая маржа', v.maintenanceMargin), line('Запас обеспечения', v.buffer), line('Расстояние от входа', v.distancePercent, '%'), line('Порог нулевой маржи', v.zeroMarginPrice)]; }
  if (calculation.mode === 'risk-reward' && calculation.result.ok) { const v = calculation.result.value; return [line('Риск : прибыль', v.ratio, ''), line('Убыток по стопу', v.risk), line('Прибыль по цели', v.reward, 'USDT', true), line('Порог прибыльных исходов', v.breakEvenWinRate, '%'), line('P&L по стопу', v.stopPnl, 'USDT', true), line('P&L по цели', v.targetPnl, 'USDT', true)]; }
  if (calculation.mode === 'dca' && calculation.result.ok) { const v = calculation.result.value; return [line('Средняя стоимость с комиссиями', v.averageCost), line('Средняя цена без комиссий', v.averageBare), line('Количество актива', v.quantity, 'ед.'), line('Сумма покупок без комиссий', v.purchaseSum), line('Комиссии покупок', v.entryFees), line('Полная стоимость', v.costBasis), ...(v.exit ? [line('Стоимость по цене выхода', v.exit.valueBeforeExitFee), line('Комиссия выхода', v.exit.exitFee), line('P&L после расходов', v.exit.netAtTarget, 'USDT', true), line('Цена безубыточности', v.exit.breakEven)] : []), ...(v.targetAverage && ['ready', 'achieved'].includes(v.targetAverage.state) ? [line('Дополнительное количество', v.targetAverage.quantity, 'ед.'), line('Сумма новой покупки без комиссии', v.targetAverage.amountBeforeFee), line('Новые затраты с комиссией', v.targetAverage.totalNewCost), line('Новая средняя стоимость', v.targetAverage.newAverage)] : [])]; }
  if (calculation.mode === 'fees' && calculation.result.ok) { const v = calculation.result.value; return [line('Сумма торговых комиссий', v.feesTotal), line('Комиссия входа', v.feeOpen), ...(v.feeClose === null ? [] : [line('Комиссия выхода', v.feeClose)]), line('Номинал входа', v.notionalEntry), ...(v.notionalExit === null ? [] : [line('Номинал выхода', v.notionalExit)]), ...(v.fundingCost === null ? [] : [line('Расход / поступление funding', v.fundingCost), line('Нетто-расход с финансированием', v.netCost)]), ...(v.feeClose === null ? [line('Вход Maker', v.combinations.MM), line('Вход Taker', v.combinations.TT)] : [line('Maker → Maker', v.combinations.MM), line('Maker → Taker', v.combinations.MT), line('Taker → Maker', v.combinations.TM), line('Taker → Taker', v.combinations.TT)])]; }
  return [];
}
export function exactResultText(calculation: Calculation): string { return ['VOLTEX Trading Tools — расчёт по заданным параметрам', ...resultLines(calculation).map((item) => `${item.label}: ${item.label === 'Риск : прибыль' && item.value !== null ? '1 : ' : ''}${item.value ?? '—'}${item.unit ? ` ${item.unit}` : ''}`)].join('\n'); }
const signClass = (value: string | null) => value === null || compareDecimal(value, '0') === 0 ? '' : compareDecimal(value, '0') > 0 ? 'is-positive' : 'is-negative';
const rendered = (item: Line) => item.value === null ? '—' : item.unit === '%' ? formatPercent(item.value) : formatDecimal(item.value, { signed: item.signed });

export function ToolResults({ calculation, draft }: { calculation: Calculation; draft: Draft }) {
  const { result } = calculation;
  if (!result.ok) return <section className="tt-result tt-result-empty" data-tools-result data-tools-status={result.status} aria-live="polite"><div className="tt-empty-symbol"><Calculator size={30} /></div><h3>{result.status === 'incomplete' ? 'Введите параметры' : 'Проверьте параметры'}</h3><p>{Object.values(result.errors)[0] || 'Укажите значения для расчёта.'}</p><span className="tt-empty-value">—</span><small>Результат появится здесь после заполнения полей.</small></section>;
  const lines = resultLines(calculation);
  const primary = lines[0];
  let notice = '';
  if (calculation.mode === 'pnl' && calculation.result.ok) { const v = calculation.result.value; notice = [v.roiBasis === 'margin' ? 'Сценарий не моделирует принудительную ликвидацию.' : '', v.breakEvenState === 'no_positive_threshold' ? 'При этих параметрах нет положительной цены безубыточности.' : ''].filter(Boolean).join(' '); }
  if (calculation.mode === 'size' && calculation.result.ok) { const v = calculation.result.value; notice = v.message || `${v.theoretical ? 'Теоретическое количество: шаг не задан. ' : 'Количество округлено вниз к заданному шагу. '}${v.limitingFactor === 'budget' ? 'Ограничено бюджетом маржи.' : 'Ограничено риском.'}`; }
  if (calculation.mode === 'liquidation' && calculation.result.ok) notice = calculation.result.value.message || 'Ориентировочно. Модель одной изолированной позиции с фиксированной поддерживающей маржой.';
  if (calculation.mode === 'risk-reward' && calculation.result.ok) notice = calculation.result.value.state === 'target_not_profitable' ? 'Цель не покрывает расходы. Положительное соотношение не рассчитывается.' : 'Порог прибыльных исходов — математическое условие, а не вероятность успеха.';
  if (calculation.mode === 'fees' && calculation.result.ok && calculation.result.value.feeClose === null) notice = 'Расчёт только входа: выход не включён.';
  return <section className="tt-result" data-tools-result data-tools-status={result.status} aria-live="polite" aria-atomic="false">
    <div className={`tt-primary-result${calculation.mode === 'liquidation' ? ' is-estimate' : ''}`}><span>{primary.label}</span><strong className={primary.signed ? signClass(primary.value) : ''}>{calculation.mode === 'risk-reward' && primary.value !== null ? '1 : ' : ''}{rendered(primary)}<small>{primary.unit === '%' || !primary.unit ? '' : primary.unit}</small></strong><p>{calculation.mode === 'liquidation' ? 'Ориентировочно' : 'Расчёт по вашим параметрам'}</p></div>
    {notice && <p className="tt-result-notice"><Info size={15} /><span>{notice}</span></p>}
    <ResultChart calculation={calculation} draft={draft} />
    <dl className="tt-breakdown">{lines.slice(1).map((item) => <div key={item.label}><dt>{item.label}</dt><dd className={item.signed ? signClass(item.value) : ''} title={item.value ?? undefined}>{rendered(item)}{item.unit && item.unit !== '%' && item.value !== null && <small> {item.unit}</small>}</dd></div>)}</dl>
    {calculation.mode === 'dca' && calculation.result.ok && calculation.result.value.targetAverage && <TargetState state={calculation.result.value.targetAverage.state} />}
    <details className="tt-exact"><summary>Точные значения</summary><dl>{lines.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value ?? '—'} {item.unit}</dd></div>)}</dl></details>
  </section>;
}

function TargetState({ state }: { state: string }) {
  const messages: Record<string, string> = { achieved: 'Цель уже достигнута.', no_finite_quantity: 'Для такой целевой средней конечного количества новой покупки нет.', unreachable: 'Целевая средняя недостижима покупками по указанной цене.', not_reduction: 'Укажите цель ниже текущей средней стоимости.' };
  return messages[state] ? <p className="tt-result-notice"><Info size={15} /><span>{messages[state]}</span></p> : null;
}

function ResultChart({ calculation, draft }: { calculation: Calculation; draft: Draft }) {
  if (!calculation.result.ok) return null;
  if (calculation.mode === 'pnl' && calculation.result.ok) {
    const v = calculation.result.value;
    if (v.chart.length < 2) return null;
    const y = (value: string) => 30 + Number(value) * 1.2;
    const x = (value: string) => 30 + Number(value) * 3.4;
    const zeroY = y(v.chartReference.zeroY);
    const markers = [v.chartReference.entryX, v.chartReference.exitX, ...(v.chartReference.breakEvenX === null ? [] : [v.chartReference.breakEvenX])];
    const markerNames = ['Вход', 'Выход', 'Безубыт.'];
    return <figure className="tt-chart"><figcaption>Цена выхода → P&L</figcaption><svg viewBox="0 0 400 192" role="img" aria-label="Расчётный P&L при разных ценах выхода"><line x1="30" x2="370" y1={zeroY} y2={zeroY} className="tt-zero-line" /><text x="6" y={zeroY + 4}>0</text><polyline points={v.chart.map((point) => `${x(point.x)},${y(point.y)}`).join(' ')} className="tt-chart-line" />{markers.map((marker, index) => <g key={index}><line x1={x(marker)} x2={x(marker)} y1="22" y2="153" className={`tt-marker tt-marker-${index}`} /><text x={x(marker)} y={index % 2 ? 185 : 171} textAnchor="middle">{markerNames[index]}</text></g>)}</svg><div className="tt-chart-axis"><span>{formatDecimal(v.chart[0].price)} USDT</span><span>{formatDecimal(v.chart[v.chart.length - 1].price)} USDT</span></div></figure>;
  }
  if (calculation.mode === 'dca' && calculation.result.ok) {
    const values = calculation.result.value.series;
    const normalized = normalizeLevels(values.map((item) => item.average));
    return <figure className="tt-chart"><figcaption>Средняя стоимость после покупки</figcaption><svg viewBox="0 0 400 150" role="img" aria-label="Средняя стоимость после каждой покупки"><polyline className="tt-chart-line" points={normalized.map((value, index) => `${values.length > 1 ? 30 + index / (values.length - 1) * 340 : 200},${110 - Number(value) * .8}`).join(' ')} />{normalized.map((value, index) => <circle key={index} cx={values.length > 1 ? 30 + index / (values.length - 1) * 340 : 200} cy={110 - Number(value) * .8} r="3" className="tt-chart-dot" />)}<text x="30" y="142">Покупка 1</text><text x="370" y="142" textAnchor="end">Покупка {values.length}</text></svg></figure>;
  }
  if (calculation.mode === 'liquidation' && calculation.result.ok && calculation.result.value.liquidationPrice) {
    const v = calculation.result.value;
    const levels = normalizeLevels([v.entry, v.liquidationPrice!]);
    return <figure className="tt-chart"><figcaption>Вход и ориентировочный порог</figcaption><svg viewBox="0 0 400 115" role="img" aria-label="Уровень входа и ориентировочная ликвидация"><line x1="30" y1="50" x2="370" y2="50" className="tt-zero-line" />{levels.map((value, index) => <g key={index}><circle cx={40 + Number(value) * 3.2} cy="50" r="5" className={index ? 'tt-threshold-dot' : 'tt-chart-dot'} /><text x={40 + Number(value) * 3.2} y={index ? 83 : 27} textAnchor={index ? 'middle' : 'middle'}>{index ? 'Порог' : 'Вход'}</text></g>)}</svg></figure>;
  }
  let bars: { label: string; value: string; style?: string }[] = [];
  if (calculation.mode === 'size' && calculation.result.ok) { const v = calculation.result.value; bars = [{ label: 'Бюджет риска', value: v.riskBudget }, { label: 'Плановый убыток', value: v.plannedLoss }]; }
  if (calculation.mode === 'risk-reward' && calculation.result.ok && calculation.result.value.state === 'profitable') { const v = calculation.result.value; bars = [{ label: 'Риск', value: v.risk, style: 'negative' }, { label: 'Прибыль', value: v.reward, style: 'positive' }]; }
  if (calculation.mode === 'fees' && calculation.result.ok) { const v = calculation.result.value; bars = [{ label: 'Вход', value: v.feeOpen }, ...(v.feeClose === null ? [] : [{ label: 'Выход', value: v.feeClose }])]; }
  if (!bars.length) return null;
  const widths = normalizeLevels(['0', ...bars.map((bar) => bar.value)]).slice(1);
  return <div className="tt-bars" aria-label="Сравнение расчётных величин">{bars.map((bar, index) => <div key={bar.label}><span>{bar.label}</span><div className="tt-bar-track"><span className={bar.style ? `is-${bar.style}` : ''} style={{ width: `${widths[index]}%` }} /></div><strong>{formatDecimal(bar.value)} <small>USDT</small></strong></div>)}</div>;
}
