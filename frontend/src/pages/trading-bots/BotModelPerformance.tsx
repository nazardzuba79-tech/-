import { useState } from 'react';
import type { BotPeriod } from '../../../../src/shared/thomasPerformance';
import { presentationPeriod } from '../../lib/tradingBotsPresentation';
import { Sparkline } from './BotSparkline';
import { monthlyPercent } from '../../lib/monthlyCopyPerformance';

// An ordinal illustration only. No trade history, account balances, calendar dates or
// PnL may be inferred from this model, and it must never enter a verified return API.
export const MODEL_FIRST_YEAR = [131.42, 176.91, 143.15, 161.33, 127.68, 185.41, 149.22, 138.79, 172.81, 155.26, 184.03, 166.72] as const;
export const MODEL_SECOND_YEAR = [120.71, 146.38, 173.54, 135.92, 188.67, 154.23, 162.85, 128.49, 185.76, 141.63, 169.48] as const;

// The owner requests an arithmetic SUM of the displayed monthly percentage values.
// It is deliberately named a sum of model indices rather than a compounded investment ROI.
export function summedModelPercent(values: readonly number[]): number {
  return Math.round(values.reduce((sum, value) => sum + Math.round(value * 100), 0)) / 100;
}

const display = (n: number) => monthlyPercent(n).text;

export function BotModelPerformance({ cardRoi, dailySeries, period }: { cardRoi: number; dailySeries: readonly number[]; period: BotPeriod }) {
  const [selectedYear, setSelectedYear] = useState<0 | 1>(1);
  const years = [MODEL_FIRST_YEAR, [...MODEL_SECOND_YEAR, cardRoi]] as const;
  const first = summedModelPercent(years[0]), second = summedModelPercent(years[1]);
  const total = summedModelPercent([...years[0], ...years[1]]);
  const values = years[selectedYear];
  const shortWindow = period === '7D' || period === '30D';
  const months = [...years[0], ...years[1]];
  const series = shortWindow ? presentationPeriod(dailySeries, period === '7D' ? 7 : 30)
    : months.slice(period === '90D' ? -3 : period === '1Y' ? -12 : 0);
  return <>
    <section className="vb-model-trend" aria-label="График модельной доходности">
      <h4>{shortWindow ? 'Модельная доходность от начала периода' : 'Доходность по условным месяцам'}</h4>
      <Sparkline key={period} series={series} name="Thomas Quant AI" large
        unit={shortWindow ? 'День' : 'Месяц'} firstPoint={shortWindow ? 0 : months.length - series.length + 1}/>
    </section>
    <section className="vb-model-months" aria-label="Модельная доходность по месяцам">
    <div className="vb-model-head">
      <div>
        <span className="vb-model-eyebrow">АНАЛИТИКА СТРАТЕГИИ · СЦЕНАРИЙ</span>
        <h3>Результаты модели по месяцам</h3>
        <p>24 условных месяца, без календарных дат. Последний месяц синхронизирован с карточкой Thomas Quant AI.</p>
      </div>
      <span className="vb-model-method">Иллюстрация · не история сделок</span>
    </div>

    <div className="vb-model-summary" aria-label="Сводка сумм модельных месячных процентов">
      <div><span>Год 1 · сумма месяцев</span><strong>{display(first)}</strong><small>12 модельных периодов</small></div>
      <div><span>Год 2 · сумма месяцев</span><strong>{display(second)}</strong><small>12 модельных периодов</small></div>
      <div className="vb-model-total"><span>Весь период · сумма</span><strong>{display(total)}</strong><small>24 модельных периода</small></div>
    </div>

    <div className="vb-model-switch" role="group" aria-label="Выбор года модели">
      <button type="button" aria-pressed={selectedYear === 0} onClick={() => setSelectedYear(0)}>Год 1</button>
      <button type="button" aria-pressed={selectedYear === 1} onClick={() => setSelectedYear(1)}>Год 2</button>
    </div>

    <div className="vb-model-chart" role="img" aria-label={'Сравнение двенадцати модельных месяцев. Значения от ' + display(Math.min(...values)) + ' до ' + display(Math.max(...values))}>
      {values.map((roi, i) => <span key={i} className="vb-model-column" title={'Период ' + (i + 1) + ': ' + display(roi)}>
        <span style={{ height: (18 + (roi - 120) / 70 * 82) + '%' }} />
      </span>)}
    </div>
    <ol className="vb-model-rows">{values.map((roi, index) =>
      <li key={index}><span>Месяц {String(index + 1).padStart(2, '0')}</span><strong>{display(roi)}</strong></li>)}</ol>
    <p className="vb-model-caveat">
      Сводка показывает сумму месячных процентов. Капитализация и PnL в USDT в неё не входят.
    </p>
  </section></>;
}
