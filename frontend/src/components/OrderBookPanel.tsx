import { formatBookAmount, formatBookTotal, formatCompactBookValue } from '../lib/terminalPresentation';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { useMarketTicker } from '../lib/useMarketData';
import { formatPrice } from '../lib/formatNumber';
import { PanelRightClose } from 'lucide-react';
import { aggregateSpotBook, defaultSpotGroupStep, formatSpotBookNumber, formatSpotSpreadPercent,
  spotBookMetrics, spotGroupSteps, spotLevelPrice } from '../lib/spotOrderBook';

interface Level {
  price: string;
  quantity: string;
  orders?: number;
}

interface AggregatedLevel {
  price: number;
  quantity: number;
  cumulative: number;
}

// The reference's price-step "group by" control, same idea as every real
// exchange's DOM: pick a coarser grid and every raw resting order lands in
// one of these fixed buckets instead of its own row.
const GROUP_STEPS = [0.1, 1, 10, 50];

function defaultGroupStep(price: number | null): number {
  if (price === null) return GROUP_STEPS[0];
  if (price >= 10000) return 10;
  if (price >= 1000) return 1;
  if (price >= 10) return 0.5;
  return 0.1;
}

function precisionDefaultGroupStep(price: number | null, finest: boolean): number {
  if (!finest) return defaultSpotGroupStep(price);
  const steps = spotGroupSteps(price);
  return steps[0] ?? defaultSpotGroupStep(price);
}

// All five GROUP_STEPS values need at most one decimal place; this just
// keeps a step like 5 or 10 from printing a pointless ".0".
function decimalsForStep(step: number): number {
  return step >= 1 ? 0 : 1;
}

// Rounds every raw level onto the selected price grid (bids and asks both
// round down, the same convention real exchange "grouped" views use) and
// sums the quantity of every raw level that lands in the same bucket. This
// is what turns a noisy stream of individual resting orders into a small,
// stable set of aggregated liquidity rows.
function aggregate(levels: Level[], step: number, sortDir: 1 | -1): { price: number; quantity: number }[] {
  const buckets = new Map<number, number>();
  for (const l of levels) {
    const price = parseFloat(l.price);
    const quantity = parseFloat(l.quantity);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    const bucket = Math.floor(price / step) * step;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + quantity);
  }
  return Array.from(buckets.entries())
    .map(([price, quantity]) => ({ price, quantity }))
    .sort((a, b) => (a.price - b.price) * sortDir);
}

// True order-book "depth" — cumulative quantity from the best price
// outward, same convention every real exchange DOM uses: a level right
// next to the spread shows just its own size, a level far from it shows
// everything resting ahead of it too, so the bars visibly grow with
// distance from the mid price rather than jumping around independently.
// Runs on the already-aggregated levels, so the bars reflect grouped
// liquidity, not a raw per-order count.
function withDepth(levels: { price: number; quantity: number }[]): AggregatedLevel[] {
  let running = 0;
  return levels.map((l) => {
    running += l.quantity;
    return { ...l, cumulative: running };
  });
}

// Real order-book DOMs don't scroll through the whole book by default —
// they show a fixed window of levels closest to the spread, so the
// buy/sell split is always visible together without the trader having to
// scroll past a wall of asks first.
//
// The window is sized from the panel's own height by the ResizeObserver
// below; this is only the ceiling. It was 15, which on a tall column left a
// dead band above the asks that the reference book does not have — the
// ladder there fills its panel exactly. 30 matches the Futures book's cap.
const VISIBLE_LEVELS_PER_SIDE = 30;

// The "≈ $" line only means anything when the pair is actually quoted in
// something dollar-equivalent — showing it on a BTC- or ETH-quoted pair
// would silently mislabel that price as USD.
const USD_QUOTES = new Set(['USDT', 'USDC', 'USD']);

/**
 * The reference's `.orderbook-area`, whole: header with the display-mode
 * buttons and a price-step grouping control, the three column headers
 * (Price / Amount / Sum), the ask stack laid out bottom-up, the spread
 * band, and the bid stack — with the reference's own depth bars behind
 * each row.
 */
export function OrderBookPanel({
  bids,
  asks,
  pair,
  onPickPrice,
  onCollapse,
  spotPrecision = false,
  initialFinestGrouping = false,
}: {
  bids: Level[];
  asks: Level[];
  pair?: string;
  onPickPrice?: (price: string) => void;
  onCollapse?: () => void;
  /** Precision-aware grouping and exact selectable price strings. */
  spotPrecision?: boolean;
  /** Start a precision-aware book at the finest available step for dense Futures depth. */
  initialFinestGrouping?: boolean;
}) {
  const { t } = useLanguage();
  const asksViewport = useRef<HTMLDivElement>(null);
  // Which side(s) to draw — the reference's three display modes, which the
  // Futures book already had and this one did not.
  const [mode, setMode] = useState<'both' | 'bids' | 'asks'>('both');
  /* The LAST TRADED price for the centre band, from the shared market snapshot
     the rest of the page already subscribes to — no extra request. The band
     used to print the mid; the reference prints the last, with a direction
     arrow, and keeps the mid's job (a sanity number) in the spread tooltip. */
  const { ticker } = useMarketTicker(pair ?? '');
  const lastTraded = ticker && Number.isFinite(Number(ticker.lastPrice)) && Number(ticker.lastPrice) > 0 ? Number(ticker.lastPrice) : null;
  const previousLast = useRef<{ pair?: string; price: number | null }>({ pair, price: null });
  const [direction, setDirection] = useState<'up' | 'down' | ''>('');
  useEffect(() => {
    const old = previousLast.current;
    if (old.pair !== pair || lastTraded === null) setDirection('');
    else if (old.price !== null && old.price !== lastTraded) setDirection(lastTraded > old.price ? 'up' : 'down');
    previousLast.current = { pair, price: lastTraded };
  }, [pair, lastTraded]);
  const [visibleLevels, setVisibleLevels] = useState(VISIBLE_LEVELS_PER_SIDE);
  useEffect(() => {
    const element = asksViewport.current;
    if (!spotPrecision || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const row = element.querySelector('.ob-row');
      const rowHeight = row?.getBoundingClientRect().height ?? 26;
      if (element.clientHeight > 0 && rowHeight > 0) {
        setVisibleLevels(Math.max(1, Math.min(VISIBLE_LEVELS_PER_SIDE, Math.floor(element.clientHeight / rowHeight))));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [spotPrecision]);

  const bestAsk = asks[0] ? parseFloat(asks[0].price) : null;
  const bestBid = bids[0] ? parseFloat(bids[0].price) : null;
  const spotMetrics = useMemo(() => spotBookMetrics(bids, asks), [bids, asks]);
  const midPrice = spotPrecision ? spotMetrics.mid : bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;

  const initialPrecisionStep = (price: number | null) => precisionDefaultGroupStep(price, initialFinestGrouping);
  const [storedGroupStep, setGroupStep] = useState(() => spotPrecision ? initialPrecisionStep(midPrice) : defaultGroupStep(midPrice));
  const [storedGroupSteps, setGroupSteps] = useState(() => spotPrecision ? spotGroupSteps(midPrice) : GROUP_STEPS);
  // Re-pick a sensible default step once real data first arrives and again
  // whenever the instrument itself changes. Futures opts into the finest
  // available initial step so a live 200-level book is not collapsed into
  // only a few rows before the trader chooses a coarser grouping manually.
  const lastPairRef = useRef<string | undefined>(undefined);
  const initializeSpotGroup = spotPrecision && midPrice !== null && pair !== lastPairRef.current;
  const groupStep = initializeSpotGroup ? initialPrecisionStep(midPrice) : storedGroupStep;
  const groupSteps = initializeSpotGroup ? spotGroupSteps(midPrice) : storedGroupSteps;
  useEffect(() => {
    if (midPrice !== null && pair !== lastPairRef.current) {
      lastPairRef.current = pair;
      setGroupStep(spotPrecision ? initialPrecisionStep(midPrice) : defaultGroupStep(midPrice));
      setGroupSteps(spotPrecision ? spotGroupSteps(midPrice) : GROUP_STEPS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, midPrice, spotPrecision, initialFinestGrouping]);

  const decimals = decimalsForStep(groupStep);

  const asksDepth = useMemo(
    () => (spotPrecision ? aggregateSpotBook(asks, groupStep, 'SELL') : withDepth(aggregate(asks, groupStep, 1))).slice(0, visibleLevels),
    [asks, groupStep, spotPrecision, visibleLevels]
  );
  const bidsDepth = useMemo(
    () => (spotPrecision ? aggregateSpotBook(bids, groupStep, 'BUY') : withDepth(aggregate(bids, groupStep, -1))).slice(0, visibleLevels),
    [bids, groupStep, spotPrecision, visibleLevels]
  );

  const maxDepth = Math.max(
    asksDepth.length ? asksDepth[asksDepth.length - 1].cumulative : 0,
    bidsDepth.length ? bidsDepth[bidsDepth.length - 1].cumulative : 0,
    0.0001
  );

  const spread = spotPrecision ? spotMetrics.spread : bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
  const spreadPct = spotPrecision ? spotMetrics.spreadPercent : spread !== null && midPrice ? (spread / midPrice) * 100 : null;
  const priceLabel = spotPrecision ? formatSpotBookNumber : formatPrice;
  const quoteAsset = pair?.split('/')[1];
  const showUsd = quoteAsset ? USD_QUOTES.has(quoteAsset) : false;

  return (
    <>
      <div className="orderbook-header">
        <span className="orderbook-title">{t('trade.orderBook')}</span>
        <div className="orderbook-header-actions">
          {/* The reference's three display modes. Same glyphs as the Futures
              book so the two panels read as one component. */}
          <div className="ob-modes" role="group" aria-label={t('trade.orderBook')}>
            {(['both', 'bids', 'asks'] as const).map(value => <button type="button" key={value}
              aria-label={value === 'both' ? `${t('trade.buy')} / ${t('trade.sell')}` : t(value === 'bids' ? 'trade.buy' : 'trade.sell')}
              aria-pressed={mode === value} onClick={() => setMode(value)}>
              <svg viewBox="0 0 24 20" aria-hidden="true">{[0, 1, 2, 3].map(i => <g key={i}>
                <path d={`M2 ${3 + i * 4}h7`} stroke={value === 'asks' || (value === 'both' && i < 2) ? '#f6465d' : '#0ecb81'} strokeWidth="3" />
                <path d={`M12 ${3 + i * 4}h10`} stroke="currentColor" strokeWidth="2" /></g>)}</svg>
            </button>)}
          </div>
          <select
            className="ob-group-select"
            value={groupStep}
            onChange={(e) => { const value = Number(e.target.value); if (groupSteps.includes(value)) setGroupStep(value); }}
            title={t('trade.groupBy')}
            aria-label={t('trade.groupBy')}
          >
            {groupSteps.map((step) => (
              <option key={step} value={step}>
                {spotPrecision ? spotLevelPrice(step, step) : step}
              </option>
            ))}
          </select>
          {onCollapse && (
            <button className="orderbook-collapse" type="button" onClick={onCollapse} title="Свернуть стакан" aria-label="Свернуть стакан">
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

      {/* Rows are keyed by DEPTH SLOT, not by price. A ladder's prices move
          with the market; keyed by price, every shift made React tear a row
          down and build a new one — measured at 14 per second on the Futures
          book on a replayed feed, and this panel keyed the same way. Row N is
          the Nth level out from the touch; the level is its contents. */}
      <div className={`orderbook-asks${mode === 'bids' ? ' ob-hidden' : ''}`} ref={asksViewport}>
        {asksDepth.map((level, index) => (
          <Row key={`sell-${index}`} level={level} decimals={decimals} spotStep={spotPrecision ? groupStep : undefined} side="SELL" maxDepth={maxDepth} onPick={onPickPrice} />
        ))}
      </div>

      {/* The reference centre: last traded, a fixed-width direction slot, then
          the dollar equivalent. One line, and the arrow can never shift the
          digits because it has its own slot. The spread is still exact and
          still reachable — on the band's tooltip — instead of a second line of
          small print under the price. When no trade has been seen the mid is
          shown and labelled, rather than a blank. */}
      <div className="orderbook-spread" title={spread !== null && spreadPct !== null
        ? `${t('trade.spread')} ${priceLabel(spread)} (${spotPrecision ? formatSpotSpreadPercent(spreadPct) : `${spreadPct.toFixed(3)}%`})`
        : undefined}>
        <div className="ob-spread-price">
          <span className={`ob-last ${direction}`}>{lastTraded !== null ? priceLabel(lastTraded) : midPrice !== null ? priceLabel(midPrice) : '—'}</span>
          <span className="ob-arrow" aria-hidden="true">{direction === 'up' ? '↑' : direction === 'down' ? '↓' : ''}</span>
          {lastTraded === null && midPrice !== null && <small className="ob-mid-label">Mid</small>}
          {showUsd && (lastTraded ?? midPrice) !== null && <span className="usd">≈ ${priceLabel((lastTraded ?? midPrice)!)}</span>}
        </div>
      </div>

      <div className={`orderbook-bids${mode === 'asks' ? ' ob-hidden' : ''}`}>
        {bidsDepth.map((level, index) => (
          <Row key={`buy-${index}`} level={level} decimals={decimals} spotStep={spotPrecision ? groupStep : undefined} side="BUY" maxDepth={maxDepth} onPick={onPickPrice} />
        ))}
      </div>
    </>
  );
}

/* No per-row flash. The reference book does not pulse a row when its size
   changes, and ours pulsed EVERY changed row on EVERY publish at 32% alpha —
   on a busy contract that is a permanent strobe, not a signal. The size still
   changes in place; the eye is not dragged to it. */

const Row = memo(function Row({
  level,
  decimals,
  side,
  maxDepth,
  onPick,
  spotStep,
}: {
  level: AggregatedLevel;
  decimals: number;
  side: 'BUY' | 'SELL';
  maxDepth: number;
  onPick?: (price: string) => void;
  spotStep?: number;
}) {
  const share = Math.min(1, level.cumulative / maxDepth);
  const priceText = spotStep === undefined ? level.price.toFixed(decimals) : spotLevelPrice(level.price, spotStep);
  const quantityText = spotStep === undefined ? formatBookAmount(level.quantity) : formatCompactBookValue(level.quantity);
  const totalText = spotStep === undefined ? formatBookTotal(level.price * level.quantity) : formatCompactBookValue(level.price * level.quantity, 'total');
  const pick = () => onPick?.(spotStep === undefined ? level.price.toFixed(2) : priceText);

  return (
    <div className={`ob-row${spotStep !== undefined ? ' ob-row--spot' : ''}`} onClick={pick}
      role={spotStep !== undefined && onPick ? 'button' : undefined} tabIndex={spotStep !== undefined && onPick ? 0 : undefined}
      aria-label={spotStep !== undefined && onPick ? `${side === 'BUY' ? 'Bid' : 'Ask'} ${priceText}` : undefined}
      onKeyDown={event => { if (spotStep !== undefined && onPick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); pick(); } }}>
      {/* scaleX, not width: a transform is composited, so a bar change never
          re-lays-out the row it sits in. Anchored at the right edge by CSS. */}
      <div className={`ob-depth-bar ${side === 'BUY' ? 'bid' : 'ask'}`} style={{ transform: `scaleX(${share})` }} />
      <span className={`cell ${side === 'BUY' ? 'bid-price' : 'ask-price'}`} title={spotStep !== undefined ? priceText : undefined}>{priceText}</span>
      <span className="cell" title={String(level.quantity)}>{quantityText}</span>
      <span className="cell" title={String(level.price * level.quantity)}>{totalText}</span>
    </div>
  );
});
