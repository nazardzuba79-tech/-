import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, X } from 'lucide-react';
import type { SyntheticCopyTradingResponse } from '../../lib/syntheticCopyTrading';
import { buildMonthlyPerformance, monthKey, monthlyPercent, MONTH_NAMES_RU, type MonthlyPerformanceCell } from '../../lib/monthlyCopyPerformance';
import { publicSignedUsdt } from '../../lib/copyTradingMoney';
import './CopyMonthlyPerformance.css';

/**
 * «Статистика по месяцам» for any featured trader — ONE component, fed the
 * profile's own strategy (Nazar's on his profile, Ksenia's on hers).
 *
 * Everything is derived in memory from the payload the profile already
 * holds: opening the dialog, choosing another month or another year sends
 * nothing over the network and reads nothing from the database. The table
 * is rebuilt only when the strategy object itself changes.
 */

const shownDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const count = (value: number | null) => (value === null ? '—' : value.toLocaleString('ru-RU'));

function Percent({ value, strong = false }: { value: number; strong?: boolean }) {
  const { text, tone } = monthlyPercent(value);
  return strong ? <strong className={`mcp-${tone}`}>{text}</strong> : <span className={`mcp-${tone}`}>{text}</span>;
}

function periodTitle(cell: MonthlyPerformanceCell) {
  return cell.month === null ? `${cell.year} · Итог` : `${MONTH_NAMES_RU[cell.month - 1]} ${cell.year}`;
}

function coverageNote(cell: MonthlyPerformanceCell, latestDate: string, firstDate: string) {
  if (!cell.partial) return null;
  if (cell.lastDate === latestDate) return `Период ещё идёт · данные по ${shownDate(cell.lastDate)}`;
  if (cell.firstDate === firstDate) return `Стратегия ведётся с ${shownDate(cell.firstDate)}`;
  return `Данные с ${shownDate(cell.firstDate)} по ${shownDate(cell.lastDate)}`;
}

export function CopyMonthlyPerformanceModal({ synthetic, onClose }: { synthetic: SyntheticCopyTradingResponse; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const table = useMemo(() => buildMonthlyPerformance(synthetic.dailyResults, synthetic.economics?.methodology, synthetic.monthly),
    [synthetic.dailyResults, synthetic.economics?.methodology, synthetic.monthly]);
  const [selected, setSelected] = useState<string | null>(table.latestKey);
  const current = (selected && table.cells[selected]) || (table.latestKey ? table.cells[table.latestKey] : undefined);
  const { firstDate, latestDate } = useMemo(() => {
    const years = table.years.map(String).map(year => table.cells[year]).filter(Boolean);
    return { firstDate: years[0]?.firstDate ?? '', latestDate: years[years.length - 1]?.lastDate ?? '' };
  }, [table]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.querySelector<HTMLButtonElement>('.mcp-close')?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const simple = table.methodology === 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN';
  const choose = (key: string) => setSelected(key);
  const cellButton = (key: string, strong = false) => {
    const cell = table.cells[key];
    if (!cell) return <span className="mcp-empty" aria-label="Нет данных">—</span>;
    return (
      <button type="button" className={`mcp-cell${current?.key === key ? ' mcp-selected' : ''}${cell.partial ? ' mcp-partial' : ''}`}
        aria-pressed={current?.key === key} aria-label={`${periodTitle(cell)}: ${monthlyPercent(cell.roi).text}`}
        onClick={() => choose(key)}>
        <Percent value={cell.roi} strong={strong} />
      </button>
    );
  };

  return createPortal(
    <dialog ref={dialogRef} className="copy-monthly-dialog" aria-labelledby={titleId} data-trader-id={synthetic.trader.id}
      onClick={event => { event.stopPropagation(); if (event.target === dialogRef.current) onClose(); }}
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="mcp-shell">
        <header className="mcp-header">
          <div>
            <span className="mcp-trader">{synthetic.trader.name} · {synthetic.trader.id}</span>
            <h2 id={titleId}>Помесячная доходность</h2>
            <p>Результаты по месяцам с накопительным итогом</p>
          </div>
          <button type="button" className="mcp-close" aria-label="Закрыть" onClick={onClose}><X size={18} /></button>
        </header>

        {table.years.length === 0 ? <p className="mcp-none">Истории по дням пока нет.</p> : (
          <div className="mcp-body">
            <div className="mcp-table-wrap" tabIndex={0} role="region" aria-label="Доходность по месяцам и годам">
              <table className="mcp-table">
                <thead>
                  <tr><th scope="col">Месяц</th>{table.years.map(year => <th key={year} scope="col">{year}</th>)}</tr>
                </thead>
                <tbody>
                  {MONTH_NAMES_RU.map((name, index) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      {table.years.map(year => <td key={year}>{cellButton(monthKey(year, index + 1))}</td>)}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><th scope="row">Итог</th>{table.years.map(year => <td key={year}>{cellButton(String(year), true)}</td>)}</tr>
                </tfoot>
              </table>
            </div>

            {current && (
              <section className="mcp-detail" aria-live="polite" aria-label={`Подробности: ${periodTitle(current)}`}>
                <h3>{periodTitle(current)}</h3>
                {coverageNote(current, latestDate, firstDate) && <p className="mcp-coverage">{coverageNote(current, latestDate, firstDate)}</p>}
                <dl>
                  <div><dt>{current.month === null ? 'ROI за год' : 'ROI за месяц'}</dt><dd><Percent value={current.roi} strong /></dd></div>
                  <div><dt>Реализованный PnL</dt><dd className={`mcp-${current.realizedPnl > 0 ? 'positive' : current.realizedPnl < 0 ? 'negative' : 'neutral'}`}>{publicSignedUsdt(current.realizedPnl)}</dd></div>
                  <div><dt>Торговых дней</dt><dd>{count(current.tradingDays)}</dd></div>
                  <div><dt>Сделок</dt><dd>{count(current.trades)}</dd></div>
                  <div><dt>Прибыльных дней</dt><dd>{count(current.profitableDays)}</dd></div>
                  <div><dt>Убыточных дней</dt><dd>{count(current.losingDays)}</dd></div>
                  <div><dt>Макс. просадка</dt><dd>{`${current.maximumDrawdown.toFixed(2)}%`}</dd></div>
                </dl>
              </section>
            )}
          </div>
        )}

        <p className="mcp-note">
          {simple
            ? 'ROI месяца и года — сумма дневных доходностей за период, без реинвестирования, как в дневной доходности профиля.'
            : 'ROI месяца и года — произведение дневных факторов за период (time-weighted), не сумма месячных процентов.'}
          {' '}«—» — месяц без истории, «*» — месяц или год покрыт не полностью. Нажмите на месяц или итог года, чтобы увидеть подробности.
        </p>
      </div>
    </dialog>, document.body,
  );
}

/** The entry on the profile's «Статистика» tab. Renders nothing for a
 * trader without a daily history, so only featured strategies show it. */
export function MonthlyPerformanceLauncher({ synthetic }: { synthetic?: SyntheticCopyTradingResponse | null }) {
  const [open, setOpen] = useState(false);
  if (!synthetic?.dailyResults?.length) return null;
  return (
    <section className="profile-panel monthly-performance-entry">
      <div className="profile-panel-heading">
        <div><span>Monthly Returns · %</span><h2>Помесячная доходность</h2></div>
        <button type="button" className="monthly-performance-open" onClick={() => setOpen(true)}>
          <CalendarDays size={16} aria-hidden="true" /> Статистика по месяцам
        </button>
      </div>
      {open && <CopyMonthlyPerformanceModal synthetic={synthetic} onClose={() => setOpen(false)} />}
    </section>
  );
}
