import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import type { FuturesTrade, FuturesDepthStatus } from '../lib/futuresDepth';

import { aggregateSpotBook, formatSpotBookNumber, spotBookMetrics, spotGroupSteps, spotLevelPrice,
  type SpotBookLevel, type SpotDepthLevel } from '../lib/spotOrderBook';
import { referencePrice, referenceQuantity, referenceRowCount, visibleDepthRatio, REFERENCE_ROW_HEIGHT, REFERENCE_CENTER_HEIGHT } from '../lib/referenceBook';

/** Exact-contract Futures presentation; price picking never submits an order. */
export function FuturesReferenceBook({ bids, asks, pair, onPickPrice, lastPrice = null, trades = [], status = 'live' }: {
  bids: SpotBookLevel[]; asks: SpotBookLevel[]; pair: string; lastPrice?:number|null; trades?:FuturesTrade[];
  /** What the feed says these levels currently are. See futuresDepth. */
  status?: FuturesDepthStatus;
  onPickPrice: (price: string) => void;
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
  // The selected-contract execution stream is more current than the shared ticker snapshot.
  const latestTrade = trades[0];
  const tradePrice = Number(latestTrade?.price);
  const freshTrade = latestTrade && latestTrade.time <= Date.now() + 1000 && Date.now() - latestTrade.time <= 30000;
  const last = freshTrade && Number.isFinite(tradePrice) && tradePrice > 0 ? tradePrice
    : lastPrice !== null && Number.isFinite(lastPrice) && lastPrice > 0 ? lastPrice : null;
  const previous = useRef<{ pair: string; price: number | null }>({ pair, price: null });
  const [direction, setDirection] = useState<'up' | 'down' | ''>('');
  useEffect(() => {
    const old = previous.current;
    if (old.pair !== pair || last === null) setDirection('');
    else if (old.price !== null && old.price !== last) setDirection(last > old.price ? 'up' : 'down');
    previous.current = { pair, price: last };
  }, [pair, last]);
  /**
   * What the panel is allowed to say about itself.
   *
   * Three states that used to be one empty table. `stale` still draws the
   * levels — a book from a few seconds ago is worth more than a blank panel
   * during a reconnect — and says they are not updating. `unavailable`
   * draws nothing, because there is nothing: an absent book is never shown
   * as zero depth.
   */
  const feed = status === 'stale' ? t('trade.bookStale')
    : status === 'unavailable' ? t('trade.bookUnavailable')
    : status === 'connecting' && !bids.length && !asks.length ? t('trade.bookConnecting')
    : null;

  useEffect(() => {
    if (!body.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(body.current);
    return () => observer.disconnect();
  }, [tab]);

  const rows = (levels: SpotDepthLevel[], side: 'bid' | 'ask') => levels.map(level => {
    const exact = spotLevelPrice(level.price, step);
    const price = referencePrice(level.price, step);
    return <button type="button" className={`rb-row ${side}`} key={exact}
      aria-label={`${side === 'bid' ? 'Bid' : 'Ask'} ${exact}`} onClick={() => onPickPrice(exact)}>
      {/* scaleX, not width: a transform is composited, so a book updating
          several times a second never re-lays-out the row it sits in. The
          transition is short enough to read as motion rather than lag. */}
      <i className="rb-depth" style={{ transform: `scaleX(${Math.min(1, level.cumulative / maxDepth)})` }} />
      <span title={exact}>{price}</span>
      <span title={`${level.quantity} ${base}`}>{referenceQuantity(level.quantity)}</span>
      <span title={`${level.cumulative} ${base}`}>{referenceQuantity(level.cumulative)}</span>
    </button>;
  });

  return <div className="reference-book" style={{'--book-row-height': `${REFERENCE_ROW_HEIGHT}px`, '--book-center-height': `${REFERENCE_CENTER_HEIGHT}px`} as React.CSSProperties}>
    <div className="rb-tabs" role="tablist" aria-label={t('trade.orderBook')}>
      <button type="button" role="tab" aria-selected={tab === 'book'} onClick={() => setTab('book')}>{t('trade.orderBook')}</button>
      <button type="button" role="tab" aria-selected={tab === 'trades'} onClick={() => setTab('trades')}>{t('trade.trades')}</button>
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
      {feed && <div className="rb-feed" role="status" data-state={status}>{feed}</div>}
      <div className={`rb-body rb-${mode}`} data-stale={status === 'stale' || undefined} ref={body}>
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
        {trades.length ? trades.map(trade => <div className={`rb-row ${trade.side === 'BUY' ? 'bid' : 'ask'}`} key={trade.id}>
          <span title={trade.price}>{referencePrice(Number(trade.price))}</span><span title={trade.quantity}>{referenceQuantity(Number(trade.quantity))}</span>
          <span>{new Date(trade.time).toLocaleTimeString('en-GB', { hour12: false })}</span>
        </div>) : <div className="rb-empty">—</div>}
      </div>
    </>}
  </div>;
}
