import { useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import { groupTrades, layoutTradeGroups, type TradeGroup } from './tradeMarkers';
import type { Candle, Fill } from './types';

export default function TradeMarkers({ chart, id, interval, candles, fills }: {
  chart: IChartApi | null; id: string; interval: string; candles: Candle[]; fills: Fill[];
}) {
  const rail = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const groups = useMemo(() => groupTrades(id, interval, candles, fills), [id, interval, candles, fills]);
  const [positioned, setPositioned] = useState<Array<TradeGroup & { x: number }>>([]);
  const [selected, setSelected] = useState<TradeGroup | null>(null);
  useEffect(() => {
    if (!chart || !rail.current) return;
    const update = () => setPositioned(layoutTradeGroups(groups,
      time => chart.timeScale().timeToCoordinate(time as Time), chart.timeScale().width(), 44));
    const observer = new ResizeObserver(update);
    observer.observe(rail.current);
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    update();
    return () => { observer.disconnect(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(update); };
  }, [chart, groups]);
  useEffect(() => { setSelected(null); }, [id, interval]);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    else if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);
  const close = () => { setSelected(null); trigger.current?.focus(); };
  return <>
    <div className="vxg-trade-rail" ref={rail} aria-label="Сделки на графике">
      {!positioned.length && <span className="vxg-trade-rail-empty">Сделки в видимом периоде: 0</span>}
      {positioned.map(group => <button key={group.time} style={{ left: group.x }}
        aria-label={`Сделки: ${group.fills.length}, ${new Date(group.time * 1000).toLocaleString('ru-RU')}`}
        title="Детали сделок" onClick={event => { trigger.current = event.currentTarget; setSelected(group); }}>
        {group.fills.some(fill => fill.side === 'BUY') && <span className="up" aria-hidden="true">↑</span>}
        {group.fills.some(fill => fill.side === 'SELL') && <span className="down" aria-hidden="true">↓</span>}
        {group.fills.length > 1 && <small>{group.fills.length}</small>}
      </button>)}
    </div>
    <dialog className="vxg-trade-details" ref={dialog} aria-labelledby="vxg-trade-title"
      onCancel={close} onClose={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header><strong id="vxg-trade-title">Детали сделок · {selected?.fills.length}</strong><button autoFocus onClick={close} aria-label="Закрыть детали сделок">×</button></header>
      <div>{selected?.fills.map(fill => <article key={fill.id}>
        <div><b className={fill.side === 'BUY' ? 'up' : 'down'}>{fill.side === 'BUY' ? '↑ Покупка' : '↓ Продажа'}</b><time dateTime={new Date(fill.timestamp).toISOString()}>{new Date(fill.timestamp).toLocaleString('ru-RU')}</time></div>
        <dl><dt>Инструмент</dt><dd>{fill.instrumentId}</dd><dt>Количество</dt><dd>{fill.quantity}</dd><dt>Цена исполнения</dt><dd>{fill.price} {fill.currency}</dd><dt>Цена источника</dt><dd>{fill.nativePrice} {id.startsWith('MOEX:') ? 'RUB' : 'USDT'}</dd><dt>Результат</dt><dd>{fill.side === 'SELL' ? `${fill.realized} ${fill.currency}` : 'Покупка · PnL при продаже'}</dd></dl>
      </article>)}</div>
    </dialog>
  </>;
}
