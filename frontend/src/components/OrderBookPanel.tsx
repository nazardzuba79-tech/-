import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage, localeOf } from '../lib/i18n';

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
const GROUP_STEPS = [0.1, 0.5, 1, 5, 10];

function defaultGroupStep(price: number | null): number {
  if (price === null) return GROUP_STEPS[0];
  if (price >= 10000) return 10;
  if (price >= 1000) return 1;
  if (price >= 10) return 0.5;
  return 0.1;
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
const VISIBLE_LEVELS_PER_SIDE = 15;

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
}: {
  bids: Level[];
  asks: Level[];
  pair?: string;
  onPickPrice?: (price: string) => void;
}) {
  const { t, lang } = useLanguage();
  // The reference's three display modes: both sides, bids only, asks only.
  const [mode, setMode] = useState<'both' | 'bids' | 'asks'>('both');

  const bestAsk = asks[0] ? parseFloat(asks[0].price) : null;
  const bestBid = bids[0] ? parseFloat(bids[0].price) : null;
  const midPrice = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;

  const [groupStep, setGroupStep] = useState(() => defaultGroupStep(midPrice));
  // Re-pick a sensible default step once real data first arrives (the very
  // first render has no price yet to size the default from) and again
  // whenever the instrument itself changes — a "10" step that was fine for
  // BTC would collapse most of a lower-priced coin's book into a single
  // row. Never while the same pair's own price just ticks, or the grouping
  // would keep resetting under the trader mid-use.
  const lastPairRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (midPrice !== null && pair !== lastPairRef.current) {
      lastPairRef.current = pair;
      setGroupStep(defaultGroupStep(midPrice));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, midPrice]);

  const decimals = decimalsForStep(groupStep);

  const asksDepth = useMemo(
    () => withDepth(aggregate(asks, groupStep, 1)).slice(0, VISIBLE_LEVELS_PER_SIDE),
    [asks, groupStep]
  );
  const bidsDepth = useMemo(
    () => withDepth(aggregate(bids, groupStep, -1)).slice(0, VISIBLE_LEVELS_PER_SIDE),
    [bids, groupStep]
  );

  const maxDepth = Math.max(
    asksDepth.length ? asksDepth[asksDepth.length - 1].cumulative : 0,
    bidsDepth.length ? bidsDepth[bidsDepth.length - 1].cumulative : 0,
    0.0001
  );

  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
  const spreadPct = spread !== null && midPrice ? (spread / midPrice) * 100 : null;
  const quoteAsset = pair?.split('/')[1];
  const showUsd = quoteAsset ? USD_QUOTES.has(quoteAsset) : false;

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
            {GROUP_STEPS.map((step) => (
              <option key={step} value={step}>
                {step}
              </option>
            ))}
          </select>
          <div className="orderbook-modes">
            <button className={`ob-mode-btn ${mode === 'both' ? 'active' : ''}`} onClick={() => setMode('both')} title={t('trade.orderBook')}>▦</button>
            <button className={`ob-mode-btn ${mode === 'bids' ? 'active' : ''}`} onClick={() => setMode('bids')} title={t('trade.buy')}>▪</button>
            <button className={`ob-mode-btn ${mode === 'asks' ? 'active' : ''}`} onClick={() => setMode('asks')} title={t('trade.sell')}>▭</button>
          </div>
        </div>
      </div>

      <div className="orderbook-col-headers">
        <span className="ob-col">{t('trade.price')}</span>
        <span className="ob-col">{t('trade.quantity')}</span>
        <span className="ob-col">{t('trade.sum')}</span>
      </div>

      {mode !== 'bids' && (
        <div className="orderbook-asks">
          {asksDepth.map((level) => (
            <Row key={level.price.toFixed(decimals)} level={level} decimals={decimals} side="SELL" maxDepth={maxDepth} onPick={onPickPrice} />
          ))}
        </div>
      )}

      <div className="orderbook-spread">
        <div className="ob-spread-price">
          {midPrice !== null ? midPrice.toLocaleString(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          {showUsd && midPrice !== null && (
            <span className="usd">≈ ${midPrice.toLocaleString(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          )}
        </div>
        {spread !== null && spreadPct !== null && (
          <div className="ob-spread-detail">
            {t('trade.spread')} {spread.toLocaleString(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({spreadPct.toFixed(3)}%)
          </div>
        )}
      </div>

      {mode !== 'asks' && (
        <div className="orderbook-bids">
          {bidsDepth.map((level) => (
            <Row key={level.price.toFixed(decimals)} level={level} decimals={decimals} side="BUY" maxDepth={maxDepth} onPick={onPickPrice} />
          ))}
        </div>
      )}
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
  decimals,
  side,
  maxDepth,
  onPick,
}: {
  level: AggregatedLevel;
  decimals: number;
  side: 'BUY' | 'SELL';
  maxDepth: number;
  onPick?: (price: string) => void;
}) {
  const pct = Math.min(100, (level.cumulative / maxDepth) * 100);
  const flashing = useRowFlash(level.quantity);
  const flashClass = flashing ? (side === 'BUY' ? 'book-row-flash-up' : 'book-row-flash-down') : '';

  return (
    <div className={`ob-row ${flashClass}`} onClick={() => onPick?.(level.price.toFixed(2))}>
      <div className={`ob-depth-bar ${side === 'BUY' ? 'bid' : 'ask'}`} style={{ width: `${pct}%` }} />
      <span className={`cell ${side === 'BUY' ? 'bid-price' : 'ask-price'}`}>{level.price.toFixed(decimals)}</span>
      <span className="cell">{level.quantity.toFixed(5)}</span>
      <span className="cell">{(level.price * level.quantity).toFixed(2)}</span>
    </div>
  );
});
