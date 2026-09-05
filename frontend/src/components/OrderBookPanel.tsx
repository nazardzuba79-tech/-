import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { PanelRightClose } from 'lucide-react';
import { aggregateTerminalBook, defaultTerminalGroupStep, formatTerminalLevelPrice, formatTerminalQuote,
  formatTerminalSpreadPercent, hasTerminalUsdApproximation, terminalGroupSteps,
  TerminalAggregatedLevel as AggregatedLevel, TerminalBookLevel as Level } from '../lib/terminalExecution';
import { terminalBookMetrics } from '../lib/terminalMarket';

// Real order-book DOMs don't scroll through the whole book by default —
// they show a fixed window of levels closest to the spread, so the
// buy/sell split is always visible together without the trader having to
// scroll past a wall of asks first.
const VISIBLE_LEVELS_PER_SIDE = 15;

/**
 * The reference's `.orderbook-area`, whole: header with the display-mode
 * buttons and a price-step grouping control, the three column headers
 * (Price / Amount / Sum), the ask stack laid out bottom-up, the spread
 * band, and the bid stack — with the reference's own depth bars behind
 * each row.
 *
 * The feed itself (real Kraken depth, delivered as `bids`/`asks` props) is
 * unchanged; what changed is what happens to it before it reaches the DOM:
 * levels are grouped onto the selected price grid first, and the parent
 * feed (krakenSocket.ts) now only forwards a fresh snapshot a few times a
 * second instead of on every single delta — see that file's
 * EMIT_INTERVAL_MS. Together those mean the rows below are keyed on a
 * bucket price that changes far less often than a raw tick, so React keeps
 * reusing the same row elements and only updates their text.
 */
export function OrderBookPanel({
  bids,
  asks,
  pair,
  onPickPrice,
  onCollapse,
  onHoverPrice,
}: {
  bids: Level[];
  asks: Level[];
  pair?: string;
  onPickPrice?: (price: string) => void;
  onCollapse?: () => void;
  onHoverPrice?: (price: number | null) => void;
}) {
  const { t } = useLanguage();

  const { mid: midPrice, spread, spreadPercent: spreadPct } = useMemo(() => terminalBookMetrics(bids, asks), [bids, asks]);

  const [groupSteps, setGroupSteps] = useState(() => terminalGroupSteps(midPrice));
  const [groupStep, setGroupStep] = useState(() => defaultTerminalGroupStep(midPrice));
  // Re-pick a sensible default step once real data first arrives (the very
  // first render has no price yet to size the default from) and again
  // whenever the instrument itself changes — a "10" step that was fine for
  // BTC would collapse most of a lower-priced coin's book into a single
  // row. Never while the same pair's own price just ticks, or the grouping
  // would keep resetting under the trader mid-use.
  const lastPairRef = useRef<string | undefined | null>(null);
  useEffect(() => {
    if (midPrice !== null && pair !== lastPairRef.current) {
      lastPairRef.current = pair;
      setGroupSteps(terminalGroupSteps(midPrice));
      setGroupStep(defaultTerminalGroupStep(midPrice));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, midPrice]);

  useEffect(() => { onHoverPrice?.(null); }, [pair, groupStep, onHoverPrice]);
  const hoverCallback = useRef(onHoverPrice);
  hoverCallback.current = onHoverPrice;
  useEffect(() => () => hoverCallback.current?.(null), []);

  const asksDepth = useMemo(
    () => aggregateTerminalBook(asks, groupStep, 'SELL').slice(0, VISIBLE_LEVELS_PER_SIDE),
    [asks, groupStep]
  );
  const bidsDepth = useMemo(
    () => aggregateTerminalBook(bids, groupStep, 'BUY').slice(0, VISIBLE_LEVELS_PER_SIDE),
    [bids, groupStep]
  );

  const maxDepth = Math.max(
    asksDepth.length ? asksDepth[asksDepth.length - 1].cumulative : 0,
    bidsDepth.length ? bidsDepth[bidsDepth.length - 1].cumulative : 0,
    0.0001
  );

  const showUsd = hasTerminalUsdApproximation(pair);

  return (
    <>
      <div className="orderbook-header">
        <span className="orderbook-title">{t('trade.orderBook')}</span>
        <div className="orderbook-header-actions">
          <select
            className="ob-group-select"
            value={groupStep}
            onChange={(e) => setGroupStep(parseFloat(e.target.value))}
            title={t('trade.groupBy')}
            aria-label={t('trade.groupBy')}
          >
            {groupSteps.map((step) => (
              <option key={step} value={step}>
                {formatTerminalLevelPrice(step, step)}
              </option>
            ))}
          </select>
          {onCollapse && (
            <button className="orderbook-collapse" type="button" onClick={() => { onHoverPrice?.(null); onCollapse(); }} title="Свернуть стакан" aria-label="Свернуть стакан">
              <PanelRightClose size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="orderbook-col-headers">
        <span className="ob-col">{t('trade.price')}</span>
        <span className="ob-col">{t('trade.quantity')}</span>
        <span className="ob-col">{t('trade.sum')}</span>
      </div>

      <div className="orderbook-asks" onMouseLeave={() => onHoverPrice?.(null)}>
        {asksDepth.map((level) => (
          <Row key={formatTerminalLevelPrice(level.price, groupStep)} level={level} step={groupStep} side="SELL" maxDepth={maxDepth} onPick={onPickPrice} onHover={onHoverPrice} />
        ))}
      </div>

      <div className="orderbook-spread">
        <div className="ob-spread-price">
          {midPrice !== null ? formatTerminalQuote(midPrice) : '—'}
          {showUsd && midPrice !== null && <span className="usd">≈ ${formatTerminalQuote(midPrice)}</span>}
        </div>
        {spread !== null && spreadPct !== null && (
          <div className="ob-spread-detail">
            {t('trade.spread')} {formatTerminalQuote(spread)} ({formatTerminalSpreadPercent(spreadPct)})
          </div>
        )}
      </div>

      <div className="orderbook-bids" onMouseLeave={() => onHoverPrice?.(null)}>
        {bidsDepth.map((level) => (
          <Row key={formatTerminalLevelPrice(level.price, groupStep)} level={level} step={groupStep} side="BUY" maxDepth={maxDepth} onPick={onPickPrice} onHover={onHoverPrice} />
        ))}
      </div>
    </>
  );
}

const FLASH_DURATION_MS = 450;

/** True for a brief moment right after this row's quantity changes — same
 * per-row-hook pattern as usePriceFlash, needed here since it must isolate
 * state per price level, not just per side. */
function useRowFlash(quantity: number): boolean {
  const prevRef = useRef<number | null>(null);
  const [flashing, setFlashing] = useState(false);
  const timerRef = useRef<number>();

  useEffect(() => {
    if (prevRef.current !== null && prevRef.current !== quantity) {
      setFlashing(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setFlashing(false), FLASH_DURATION_MS);
    }
    prevRef.current = quantity;
  }, [quantity]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return flashing;
}

// Memoized so an unrelated row's parent re-render (a sibling bucket's
// quantity changing) never re-invokes this one — with a stable key keyed
// on the bucket price, React already reuses the same row element across
// updates; this just skips redoing the row's own work when its own props
// haven't changed either.
const Row = memo(function Row({
  level,
  step,
  side,
  maxDepth,
  onPick,
  onHover,
}: {
  level: AggregatedLevel;
  step: number;
  side: 'BUY' | 'SELL';
  maxDepth: number;
  onPick?: (price: string) => void;
  onHover?: (price: number | null) => void;
}) {
  const pct = Math.min(100, (level.cumulative / maxDepth) * 100);
  const flashing = useRowFlash(level.quantity);
  const flashClass = flashing ? (side === 'BUY' ? 'book-row-flash-up' : 'book-row-flash-down') : '';
  const priceText = formatTerminalLevelPrice(level.price, step);

  return (
    <div className={`ob-row ${flashClass}`} role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined}
      aria-label={`${side === 'BUY' ? 'Bid' : 'Ask'} ${priceText}`}
      onClick={() => onPick?.(priceText)}
      onKeyDown={event => {
        if (onPick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onPick(priceText);
        }
      }}
      onMouseEnter={() => onHover?.(level.price)} onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(level.price)} onBlur={() => onHover?.(null)}>
      <div className={`ob-depth-bar ${side === 'BUY' ? 'bid' : 'ask'}`} style={{ width: `${pct}%` }} />
      <span className={`cell ${side === 'BUY' ? 'bid-price' : 'ask-price'}`}>{priceText}</span>
      <span className="cell">{level.quantity.toFixed(5)}</span>
      <span className="cell">{(level.price * level.quantity).toFixed(2)}</span>
    </div>
  );
});
