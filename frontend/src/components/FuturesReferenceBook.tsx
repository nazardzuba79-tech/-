import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { useMarketTicker } from '../lib/useMarketData';
import { krakenSocket, type LiveTrade } from '../lib/krakenSocket';
import { aggregateSpotBook, formatSpotBookNumber, spotBookMetrics, spotGroupSteps, spotLevelPrice,
  type SpotBookLevel, type SpotDepthLevel } from '../lib/spotOrderBook';
import { referencePrice, referenceQuantity, referenceRowCount, visibleDepthRatio } from '../lib/referenceBook';

/** Futures presentation only. External reference feed and price-pick contract stay unchanged. */
export function FuturesReferenceBook({ bids, asks, pair, onPickPrice }: {
  bids: SpotBookLevel[]; asks: SpotBookLevel[]; pair: string; onPickPrice: (price: string) => void;
}) {
  const { t } = useLanguage();
  const [base, quote] = pair.split('/');
  const [tab, setTab] = useState<'book' | 'trades'>('book');
  const [mode, setMode] = useState<'both' | 'bids' | 'asks'>('both');
  const [selection, setSelection] = useState<{ pair: string; step: number } | null>(null);
  const [height, setHeight] = useState(472);
  const body = useRef<HTMLDivElement>(null);
  const metrics = useMemo(() => spotBookMetrics(bids, asks), [bids, asks]);
  // Freeze the available grid after the first valid snapshot, without carrying it across pairs.
  const grid = useRef<{ pair: string; steps: number[] } | null>(null);
  if (grid.current?.pair !== pair) grid.current = null;
  if (!grid.current && metrics.mid !== null) grid.current = { pair, steps: spotGroupSteps(metrics.mid) };
  const steps = grid.current?.steps ?? spotGroupSteps(null);
  const step = selection?.pair === pair && steps.includes(selection.step) ? selection.step : steps[0];
  const count = referenceRowCount(height, mode === 'both');
  const buy = useMemo(() => aggregateSpotBook(bids, step, 'BUY').slice(0, count), [bids, step, count]);
  const sell = useMemo(() => aggregateSpotBook(asks, step, 'SELL').slice(0, count), [asks, step, count]);
  const maxDepth = Math.max(buy[buy.length - 1]?.cumulative ?? 0, sell[sell.length - 1]?.cumulative ?? 0, Number.MIN_VALUE);
  const ratio = metrics.mid === null ? null : visibleDepthRatio(buy, sell);
  const { ticker, error, stale } = useMarketTicker(pair, 4000);
  const rawLast = Number(ticker?.lastPrice);
  const last = !error && !stale && Number.isFinite(rawLast) && rawLast > 0 ? rawLast : null;
  const previous = useRef<{ pair: string; price: number | null }>({ pair, price: null });
  const [direction, setDirection] = useState<'up' | 'down' | ''>('');
  useEffect(() => {
    const old = previous.current;
    if (old.pair !== pair || last === null) setDirection('');
    else if (old.price !== null && old.price !== last) setDirection(last > old.price ? 'up' : 'down');
    previous.current = { pair, price: last };
  }, [pair, last]);
  useEffect(() => {
    if (!body.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(body.current);
    return () => observer.disconnect();
  }, [tab]);

  const [tape, setTape] = useState<{ pair: string; rows: LiveTrade[] }>({ pair, rows: [] });
  useEffect(() => {
    if (tab !== 'trades') return;
    let active = true;
    setTape({ pair, rows: [] });
    const release = krakenSocket.subscribeTrades(pair, trade => {
      if (!active || !Number.isFinite(Number(trade.price)) || Number(trade.price) <= 0 ||
          !Number.isFinite(Number(trade.quantity)) || Number(trade.quantity) <= 0 || !Number.isFinite(trade.time)) return;
      setTape(current => ({ pair, rows: [trade, ...(current.pair === pair ? current.rows : [])
        .filter(row => row.id !== trade.id)].sort((a, b) => b.time - a.time).slice(0, 30) }));
    });
    return () => { active = false; release(); };
  }, [pair, tab]);

  const rows = (levels: SpotDepthLevel[], side: 'bid' | 'ask') => levels.map(level => {
    const exact = spotLevelPrice(level.price, step);
    const price = referencePrice(level.price, step);
    return <button type="button" className={`rb-row ${side}`} key={exact}
      aria-label={`${side === 'bid' ? 'Bid' : 'Ask'} ${exact}`} onClick={() => onPickPrice(exact)}>
      <i className="rb-depth" style={{ width: `${level.cumulative / maxDepth * 100}%` }} />
      <span title={exact}>{price}</span>
      <span title={`${level.quantity} ${base}`}>{referenceQuantity(level.quantity)}</span>
      <span title={`${level.cumulative} ${base}`}>{referenceQuantity(level.cumulative)}</span>
    </button>;
  });

  return <div className="reference-book">
    <div className="rb-tabs" role="tablist" aria-label={t('trade.orderBook')}>
      <button type="button" role="tab" aria-selected={tab === 'book'} onClick={() => setTab('book')}>{t('trade.orderBook')}</button>
      <button type="button" role="tab" aria-selected={tab === 'trades'} onClick={() => setTab('trades')}>{t('trade.trades')}</button>
      <span className="rb-source" title="Kraken · external market reference">Kraken</span>
    </div>
    {tab === 'book' ? <>
      <div className="rb-controls">
        <div className="rb-modes" role="group" aria-label={t('trade.orderBook')}>
          {(['both', 'bids', 'asks'] as const).map(value => <button type="button" key={value}
            aria-label={value === 'both' ? `${t('trade.buy')} / ${t('trade.sell')}` : t(value === 'bids' ? 'trade.buy' : 'trade.sell')}
            aria-pressed={mode === value} onClick={() => setMode(value)}>
            <svg viewBox="0 0 24 20" aria-hidden="true">{[0, 1, 2, 3].map(i => <g key={i}>
              <path d={`M2 ${3 + i * 4}h7`} stroke={value === 'asks' || (value === 'both' && i < 2) ? '#ef454a' : '#20b985'} strokeWidth="3" />
              <path d={`M12 ${3 + i * 4}h10`} stroke="currentColor" strokeWidth="2" /></g>)}</svg>
          </button>)}
        </div>
        <select aria-label={t('trade.groupBy')} value={step} onChange={event => {
          const next = Number(event.target.value); if (steps.includes(next)) setSelection({ pair, step: next });
        }}>{steps.map(value => <option key={value} value={value}>{spotLevelPrice(value, value)}</option>)}</select>
      </div>
      <div className="rb-columns"><span>{t('trade.price')}<small>({quote})</small></span><span>{t('trade.quantity')}<small>({base})</small></span><span title="Cumulative base quantity">{t('trade.sum')}<small>({base})</small></span></div>
      <div className={`rb-body rb-${mode}`} ref={body}>
        {mode !== 'bids' && <div className="rb-stack rb-asks">{rows(sell, 'ask')}</div>}
        <div className="rb-center">
          <strong className={last === null ? '' : direction} title={last === null ? 'Mid · (best bid + best ask) / 2' : t('trade.lastPrice')}>{last !== null ? `${direction === 'up' ? '↑' : direction === 'down' ? '↓' : ''}${referencePrice(last)}` : metrics.mid !== null ? referencePrice(metrics.mid) : '—'}</strong>
          {last === null && metrics.mid !== null && <small className="rb-mid-label" title="(best bid + best ask) / 2">Mid</small>}
          <span title={t('trade.spread')}>{t('trade.spread')} {metrics.spread !== null ? formatSpotBookNumber(metrics.spread) : '—'}</span>
        </div>
        {mode !== 'asks' && <div className="rb-stack rb-bids">{rows(buy, 'bid')}</div>}
      </div>
      <div className="rb-ratio" data-available={ratio !== null} title="Buy / sell quantity in the displayed depth window; not a position ratio">
        {ratio !== null && <i style={{ width: `${ratio}%` }} />}
        <span><b>B</b> {ratio === null ? '—' : `${Math.round(ratio)}%`}</span>
        <span>{ratio === null ? '—' : `${100 - Math.round(ratio)}%`} <b>S</b></span>
      </div>
    </> : <>
      <div className="rb-columns"><span>{t('trade.price')}<small>({quote})</small></span><span>{t('trade.quantity')}<small>({base})</small></span><span>{t('trade.time')}</span></div>
      <div className="rb-tape" role="tabpanel">
        {tape.pair === pair && tape.rows.length ? tape.rows.map(trade => <div className={`rb-row ${trade.side === 'BUY' ? 'bid' : 'ask'}`} key={trade.id}>
          <span title={trade.price}>{referencePrice(Number(trade.price))}</span><span title={trade.quantity}>{referenceQuantity(Number(trade.quantity))}</span>
          <span>{new Date(trade.time).toLocaleTimeString('en-GB', { hour12: false })}</span>
        </div>) : <div className="rb-empty">—</div>}
      </div>
    </>}
  </div>;
}
