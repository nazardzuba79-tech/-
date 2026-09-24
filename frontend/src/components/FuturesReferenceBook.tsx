import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import type { FuturesTrade, FuturesDepthStatus } from '../lib/futuresDepth';

import { aggregateSpotBook, formatSpotBookNumber, spotBookMetrics, spotGroupSteps, spotLevelPrice,
  type SpotBookLevel, type SpotDepthLevel } from '../lib/spotOrderBook';
import { referencePrice, referenceQuantity, referenceRowCount, visibleDepthRatio, REFERENCE_ROW_HEIGHT, REFERENCE_CENTER_HEIGHT,
  ARCHIVE_ROW_HEIGHT, ARCHIVE_CENTER_HEIGHT, ARCHIVE_BOOK_HOLD_MS } from '../lib/referenceBook';
import { useHeldFrame } from '../lib/useHeldFrame';

/** One empty tape for every render that has none, so "no trades" is never a new value. */
const NO_TRADES: FuturesTrade[] = [];

/** Exact-contract Futures presentation; price picking never submits an order. */
export function FuturesReferenceBook({ bids: liveBids, asks: liveAsks, pair, onPickPrice, lastPrice: liveLastPrice = null, markPrice: liveMarkPrice,
  trades: liveTrades = NO_TRADES, status: liveStatus = 'live', archive = false }: {
  bids: SpotBookLevel[]; asks: SpotBookLevel[]; pair: string; lastPrice?:number|null; trades?:FuturesTrade[];
  /** The contract's mark price, drawn beside the last price as the reference
   *  does. `null` is "not known yet" and draws the slot empty; leaving the
   *  prop out means the design has no mark slot and draws the spread. */
  markPrice?: number | null;
  /** What the feed says these levels currently are. See futuresDepth. */
  status?: FuturesDepthStatus;
  /** The archive terminal's book: the reference's 28px pitch and 48px
   *  centre band (the CSS reads the same numbers back through the panel's
   *  variables), and the figures held to one repaint a second. Every other
   *  design keeps the 20px pitch and paints every publish. */
  archive?: boolean;
  onPickPrice: (price: string) => void;
}) {
  const rowHeight = archive ? ARCHIVE_ROW_HEIGHT : REFERENCE_ROW_HEIGHT;
  const centerHeight = archive ? ARCHIVE_CENTER_HEIGHT : REFERENCE_CENTER_HEIGHT;
  const holdMs = archive ? ARCHIVE_BOOK_HOLD_MS : 0;
  const { t } = useLanguage();
  const [base, quote] = pair.split('/');
  const [tab, setTab] = useState<'book' | 'trades'>('book');
  const [mode, setMode] = useState<'both' | 'bids' | 'asks'>('both');
  const [selection, setSelection] = useState<{ pair: string; step: number } | null>(null);
  const [height, setHeight] = useState(472);
  const body = useRef<HTMLDivElement>(null);
  /**
   * WHAT THE PANEL SHOWS IS THE FEED, HELD.
   *
   * Everything the feed publishes — levels, last, mark, tape, status — is
   * one frame, and the frame is what is held, so a row's figures and its
   * bar never come from two different publishes. Grouping, the view mode
   * and a price click are the trader's own actions and are not held: they
   * take effect on the frame on screen, immediately.
   */
  const frame = useHeldFrame(useMemo(() => ({ bids: liveBids, asks: liveAsks, lastPrice: liveLastPrice, markPrice: liveMarkPrice, trades: liveTrades, status: liveStatus }),
    [liveBids, liveAsks, liveLastPrice, liveMarkPrice, liveTrades, liveStatus]), holdMs, pair);
  const { bids, asks, lastPrice, markPrice, trades, status } = frame;
  const metrics = useMemo(() => spotBookMetrics(bids, asks), [bids, asks]);
  // Freeze the available grid after the first valid snapshot, without carrying it across pairs.
  const grid = useRef<{ pair: string; steps: number[] } | null>(null);
  if (grid.current?.pair !== pair) grid.current = null;
  if (!grid.current && metrics.mid !== null) grid.current = { pair, steps: spotGroupSteps(metrics.mid) };
  const steps = grid.current?.steps ?? spotGroupSteps(null);
  const step = selection?.pair === pair && steps.includes(selection.step) ? selection.step : steps[0];
  const count = referenceRowCount(height, mode === 'both', rowHeight, centerHeight);
  const buy = useMemo(() => aggregateSpotBook(bids, step, 'BUY').slice(0, count), [bids, step, count]);
  const sell = useMemo(() => aggregateSpotBook(asks, step, 'SELL').slice(0, count), [asks, step, count]);
  /**
   * EACH SIDE IS SCALED AGAINST ITS OWN DEEPEST LEVEL, NOT A SHARED ONE.
   *
   * A single max across both sides made the thinner side unreadable: with
   * bids cumulating to 6.009 against asks' 1.936, every ask bar was capped
   * at 32% of its track and the ask ladder read as one flat band with no
   * shape to it. Per-side scaling is what the reference terminal does — its
   * asks run 0.038 down to 0.002 and the shortest bar is 5% of the track,
   * which is 0.002/0.038, not 0.002 against the bid side's 0.079.
   *
   * The cross-side imbalance is not lost by this: it is what the B/S ratio
   * strip under the ladder reports, from the same visible window.
   */
  const maxBuyDepth = Math.max(buy[buy.length - 1]?.cumulative ?? 0, Number.MIN_VALUE);
  const maxSellDepth = Math.max(sell[sell.length - 1]?.cumulative ?? 0, Number.MIN_VALUE);
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
  const waiting = !bids.length && !asks.length;
  /**
   * NOTHING IS ANNOUNCED UNTIL THERE IS SOMETHING TO ANNOUNCE.
   *
   * A book that has not arrived yet is not a fault, and saying so in a
   * coloured band is the loudest thing on the panel at the one moment the
   * panel knows least. The first seconds now draw a quiet placeholder
   * ladder instead — the real geometry, no figures, no colour — so the
   * layout is already correct when the levels land and nothing jumps.
   *
   * What is still said, and deliberately: a book that HAD data and has
   * stopped updating, and a book that is gone. Those are facts a trader
   * needs. They are drawn quietly now, not as alarms, but they are drawn.
   */
  /**
   * `reconnecting` DELIBERATELY SAYS NOTHING.
   *
   * It is the state the transport uses while a handshake it expected — a tab
   * coming back from the background — is in flight, and the levels on screen
   * are the last good ones. Warning about that is a false alarm on the most
   * ordinary thing a person does, and a warning people learn to ignore is
   * worse than none. If the handshake does not finish inside
   * RECONNECT_GRACE_MS the transport promotes it to `stale` on its own and
   * this line speaks then. Note what is NOT done here: the levels are not
   * hidden, not cleared and not dimmed — only the sentence is withheld.
   */
  const feed = status === 'stale' && !waiting ? t('trade.bookStale')
    : status === 'unavailable' ? t('trade.bookUnavailable')
    : null;

  useEffect(() => {
    if (!body.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(body.current);
    return () => observer.disconnect();
  }, [tab]);

  /**
   * THE ROW'S IDENTITY IS ITS DEPTH POSITION, NOT ITS PRICE.
   *
   * Keying by price looked right and was the flicker. A ladder's prices move
   * with the market, so every time the book shifted a level React saw a new
   * key, unmounted that row and mounted a fresh one. Measured on a fixed
   * replayed feed: 215 rows torn down and rebuilt in 15 seconds, 14.3 per
   * second. A remounted row starts its depth-bar transition over from the
   * beginning, which is exactly the twitch the ladder showed.
   *
   * Row N is "the Nth level out from the touch" — a stable slot whose price,
   * size and cumulative are its contents. Keying by that slot lets React
   * write the three numbers and the bar width into DOM that is already
   * there. Nothing is smoothed or held back: the same level data renders in
   * the same frame, only without replacing the element it renders into.
   */
  /** The ladder's own shape, with nothing in it. Never a zero, never a
   *  price: an em dash is "not known yet", which is what this is. */
  const placeholders = (side: 'bid' | 'ask') => Array.from({ length: count }, (_, index) =>
    <div className={`rb-row ${side} is-placeholder`} key={`${side}-skeleton-${index}`} aria-hidden="true">
      <span>—</span><span>—</span><span>—</span>
    </div>);

  const rows = (levels: SpotDepthLevel[], side: 'bid' | 'ask') => levels.map((level, index) => {
    const exact = spotLevelPrice(level.price, step);
    const price = referencePrice(level.price, step);
    return <button type="button" className={`rb-row ${side}`} key={`${side}-${index}`}
      aria-label={`${side === 'bid' ? 'Bid' : 'Ask'} ${exact}`} onClick={() => onPickPrice(exact)}>
      {/* scaleX, not width: a transform is composited, so a book updating
          several times a second never re-lays-out the row it sits in. The
          transition is short enough to read as motion rather than lag. */}
      <i className="rb-depth" style={{ transform: `scaleX(${Math.min(1, level.cumulative / (side === 'bid' ? maxBuyDepth : maxSellDepth))})` }} />
      <span title={exact}>{price}</span>
      <span title={`${level.quantity} ${base}`}>{referenceQuantity(level.quantity)}</span>
      <span title={`${level.cumulative} ${base}`}>{referenceQuantity(level.cumulative)}</span>
    </button>;
  });

  const mark = markPrice !== undefined && markPrice !== null && Number.isFinite(markPrice) && markPrice > 0 ? markPrice : null;

  return <div data-sampled-book={status === 'sampled' || undefined} className="reference-book" style={{'--book-row-height': `${rowHeight}px`, '--book-center-height': `${centerHeight}px`} as React.CSSProperties}>
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
              {/* The panel's own sell/buy, not a third pair of them: these two
                  glyphs used to carry #ef454a/#20b985 while every price in
                  the ladder beside them is drawn #f6465d/#2ebd85, so one
                  small control strip put four reds and greens on a panel
                  that has two. */}
              <path d={`M2 ${3 + i * 4}h7`} stroke={value === 'asks' || (value === 'both' && i < 2) ? '#f6465d' : '#2ebd85'} strokeWidth="3" />
              <path d={`M12 ${3 + i * 4}h10`} stroke="currentColor" strokeWidth="2" /></g>)}</svg>
          </button>)}
        </div>
        <select aria-label={t('trade.groupBy')} value={step} onChange={event => {
          const next = Number(event.target.value); if (steps.includes(next)) setSelection({ pair, step: next });
        }}>{steps.map(value => <option key={value} value={value}>{spotLevelPrice(value, value)}</option>)}</select>
      </div>
      {/* Short forms here, long ones everywhere else. Three headings and
          three units share a ~215px panel, and "Количество(BTC)" simply
          does not fit beside "Сумма(BTC)" — it overlapped its neighbour. */}
      <div className="rb-columns"><span>{t('trade.price')}<small>({quote})</small></span><span>{t('trade.bookQty')}<small>({base})</small></span><span title="Cumulative base quantity">{t('trade.bookTotal')}<small>({base})</small></span></div>
      {feed && <div className="rb-feed" role="status" data-state={status}>{feed}</div>}
      <div className={`rb-body rb-${mode}`} data-stale={status === 'stale' && !waiting || undefined}
        data-waiting={waiting || undefined} ref={body}>
        {mode !== 'bids' && <div className="rb-stack rb-asks">{waiting ? placeholders('ask') : rows(sell, 'ask')}</div>}
        <div className="rb-center">
          {/* The arrow is its own fixed-width slot, never part of the number.
              Prefixing it into the string changed the string's width every
              time the direction flipped, so the price itself slid sideways
              on a tick that had not changed a single digit. The slot is
              always present and always the same width; only its glyph
              changes. It leads the number, where the reference draws it. */}
          <strong className={last === null ? '' : direction} title={last === null ? 'Mid · (best bid + best ask) / 2' : t('trade.lastPrice')}>
            <span className="rb-arrow" aria-hidden="true">{direction === 'up' ? '↑' : direction === 'down' ? '↓' : ''}</span>
            <span className="rb-last">{last !== null ? referencePrice(last) : metrics.mid !== null ? referencePrice(metrics.mid) : '—'}</span>
          </strong>
          {last === null && metrics.mid !== null && <small className="rb-mid-label" title="(best bid + best ask) / 2">Mid</small>}
          {/* The reference's second figure is the mark price under a flag;
              designs without one keep the spread. */}
          {markPrice !== undefined
            ? <span className="rb-mark" title={t('futures.markPrice')}>
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1v10.5h1.2V7.6h5.8L7.9 4.9l1.6-2.7H3.7V1z" fill="currentColor" /></svg>
                <span>{mark !== null ? referencePrice(mark) : '—'}</span>
              </span>
            : <span title={t('trade.spread')}>{t('trade.spread')} {metrics.spread !== null ? formatSpotBookNumber(metrics.spread) : '—'}</span>}
        </div>
        {mode !== 'asks' && <div className="rb-stack rb-bids">{waiting ? placeholders('bid') : rows(buy, 'bid')}</div>}
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
