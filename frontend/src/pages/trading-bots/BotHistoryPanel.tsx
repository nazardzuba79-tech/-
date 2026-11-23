import { useEffect, useState } from 'react';
import { addBrowserActivityListener, isBrowserInactive, removeBrowserActivityListener } from '../../lib/browserActivity';
import { request } from '../../lib/api';
import { monthlyPercent } from '../../lib/monthlyCopyPerformance';
import { BOT_PERIODS, THOMAS_STRATEGY, type BotHistory, type BotPeriod } from '../../../../src/shared/thomasPerformance';
import { MonthlyPerformanceDialog } from '../copy-trading-bolt/CopyMonthlyPerformanceModal';
import { Sparkline } from './BotSparkline';

type HistoryState = { data?: BotHistory; error?: boolean };
export function useBotHistory() {
  const [state, setState] = useState<HistoryState>({});
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden || isBrowserInactive()) return;
      pending = true;
      try {
        const data = await request<BotHistory>('/trading-bots/range/performance', { signal: controller.signal });
        if (data.status !== 'unavailable' && (data.status !== 'verified' || data.botId !== 'range' ||
          data.strategyId !== THOMAS_STRATEGY || !data.monthly || !BOT_PERIODS.every(p => data.periods?.[p]?.series?.length))) {
          throw Error('Invalid performance response');
        }
        if (!controller.signal.aborted) setState({ data });
      } catch {
        if (!controller.signal.aborted) setState({ error: true });
      } finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    addBrowserActivityListener(refresh);
    return () => {
      controller.abort(); clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      removeBrowserActivityListener(refresh);
    };
  }, []);
  return state;
}

const labels = { '7D': '7Д', '30D': '30Д', '90D': '90Д', '1Y': '1Р', ALL: 'Всё время' };
const money = (n: number | null) => n === null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 8 }) + ' USDT';

// Presentation assumptions only. These ordinal scenarios never enter the verified calendar or PnL.
const illustrativeMonths = [120.71, 146.38, 173.54, 135.92, 188.67, 154.23, 162.85, 128.49, 185.76, 141.63, 169.48];

function ModelMonths({ cardRoi }: { cardRoi: number }) {
  return <section className="vb-model-months" aria-label="Модельная доходность по месяцам">
    <h3>Модельная доходность по месяцам</h3>
    <p>Иллюстрация на 12 условных месяцев. Последний месяц соответствует модели в карточке.</p>
    <ol>{[...illustrativeMonths, cardRoi].map((roi, index) =>
      <li key={index}><span>Месяц {index + 1}</span><strong>{monthlyPercent(roi).text}</strong></li>)}</ol>
  </section>;
}

export function BotHistoryPanel({ history, modelRoi }: { history: HistoryState; modelRoi: number }) {
  const [period, setPeriod] = useState<BotPeriod>('30D');
  const [calendar, setCalendar] = useState(false);
  const data = history.data?.status === 'verified' ? history.data : null;
  const stats = data?.periods[period];
  return <section className="vb-history" aria-label="История доходности">
    <h3>История доходности</h3>
    <div className="vb-periods" role="group" aria-label="Период графика">{BOT_PERIODS.map(key =>
      <button key={key} type="button" aria-pressed={period === key} onClick={() => setPeriod(key)}>{labels[key]}</button>)}</div>
    {data && stats ? <>
      <p>С начала стратегии · {data.inceptionDate}<br/>Данные на {data.asOf.replace('T', ' ').slice(0, 16)} UTC</p>
      <strong className="vb-roi">{monthlyPercent(stats.roi).text}</strong>
      <Sparkline series={stats.series} name="Thomas Quant AI" verified large/>
      <small>{stats.firstDate} — {stats.lastDate} UTC</small>
      <dl className="vb-metrics vb-modal-metrics">
        <div><dt>Чистый PnL за период</dt><dd>{money(stats.netPnl)}</dd></div>
        <div><dt>Чистый PnL за всё время</dt><dd>{money(data.periods.ALL.netPnl)}</dd></div>
        <div><dt>Реализованный PnL до комиссий</dt><dd>{money(stats.realizedPnl)}</dd></div>
        <div><dt>Изменение нереализованного PnL</dt><dd>{money(stats.unrealizedChange)}</dd></div>
        <div><dt>Комиссии</dt><dd>{money(stats.fees)}</dd></div>
        <div><dt>Закрытые сделки</dt><dd>{stats.trades}</dd></div>
        <div><dt>Прибыльные сделки</dt><dd>{stats.winRate === null ? '—' : stats.winRate.toFixed(2) + '%'}</dd></div>
        <div><dt>Макс. просадка</dt><dd>{stats.drawdown.toFixed(2)}%</dd></div>
      </dl>
      <p>Чистый PnL учитывает комиссии и исключает ввод и вывод средств. ROI рассчитан по дневной доходности с учётом денежных потоков. Просадка измерена по дневным значениям.</p>
      <button type="button" className="monthly-performance-open" onClick={() => setCalendar(true)}>Помесячная доходность</button>
      {calendar && <MonthlyPerformanceDialog table={data.monthly} trader={{id: data.strategyId, name: 'Thomas Quant AI'}}
        allTimeRoi={data.periods.ALL.roi} onClose={() => setCalendar(false)}/>}
    </> : <p role="status">{history.error ? 'Не удалось загрузить историю доходности.' :
      history.data ? 'Подтверждённой истории этой стратегии пока нет.' : 'Загрузка истории доходности…'}</p>}
    {history.data?.status === 'unavailable' && <ModelMonths cardRoi={modelRoi}/>}
  </section>;
}
