import { useEffect, useRef, useState } from 'react';
import { useLanguage, localeOf } from '../lib/i18n';

interface Level {
  price: string;
  quantity: string;
  orders?: number;
}

// True order-book "depth" — cumulative quantity from the best price
// outward, same convention every real exchange DOM uses: a level right
// next to the spread shows just its own size, a level far from it shows
// everything resting ahead of it too, so the bars visibly grow with
// distance from the mid price rather than jumping around independently.
function withDepth(levels: Level[]): (Level & { cumulative: number })[] {
  let running = 0;
  return levels.map((l) => {
    running += parseFloat(l.quantity);
    return { ...l, cumulative: running };
  });
}

// Real order-book DOMs don't scroll through the whole book by default —
// they show a fixed window of levels closest to the spread, so the
// buy/sell split is always visible together without the trader having to
// scroll past a wall of asks first. `bids`/`asks` arrive best-price-first,
// so the first N of each is exactly that near-spread window.
const VISIBLE_LEVELS_PER_SIDE = 15;

/**
 * The reference's `.orderbook-area`, whole: header with the display-mode
 * buttons, the three column headers (Price / Amount / Sum), the ask stack
 * laid out bottom-up, the spread band, and the bid stack — with the
 * reference's own depth bars behind each row.
 *
 * The data and its maths are unchanged from before: real Kraken depth,
 * cumulative-from-the-spread bars, the same near-spread window.
 */
export function OrderBookPanel({ bids, asks, onPickPrice }: { bids: Level[]; asks: Level[]; onPickPrice?: (price: string) => void }) {
  const { t, lang } = useLanguage();
  // The reference's three display modes: both sides, bids only, asks only.
  const [mode, setMode] = useState<'both' | 'bids' | 'asks'>('both');

  const asksDepth = withDepth(asks).slice(0, VISIBLE_LEVELS_PER_SIDE);
  const bidsDepth = withDepth(bids).slice(0, VISIBLE_LEVELS_PER_SIDE);
  const maxDepth = Math.max(
    asksDepth.length ? asksDepth[asksDepth.length - 1].cumulative : 0,
    bidsDepth.length ? bidsDepth[bidsDepth.length - 1].cumulative : 0,
    0.0001
  );

  const bestAsk = asks[0] ? parseFloat(asks[0].price) : null;
  const bestBid = bids[0] ? parseFloat(bids[0].price) : null;
  const midPrice = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;

  return (
    <>
      <div className="orderbook-header">
        <span className="orderbook-title">{t('trade.orderBook')}</span>
        <div className="orderbook-modes">
          <button className={`ob-mode-btn ${mode === 'both' ? 'active' : ''}`} onClick={() => setMode('both')} title={t('trade.orderBook')}>▦</button>
          <button className={`ob-mode-btn ${mode === 'bids' ? 'active' : ''}`} onClick={() => setMode('bids')} title={t('trade.buy')}>▪</button>
          <button className={`ob-mode-btn ${mode === 'asks' ? 'active' : ''}`} onClick={() => setMode('asks')} title={t('trade.sell')}>▭</button>
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
            <Row key={level.price} level={level} side="SELL" maxDepth={maxDepth} onPick={onPickPrice} />
          ))}
        </div>
      )}

      <div className="orderbook-spread">
        {midPrice !== null ? midPrice.toLocaleString(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        {midPrice !== null && (
          <span className="usd">≈ ${midPrice.toLocaleString(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        )}
      </div>

      {mode !== 'asks' && (
        <div className="orderbook-bids">
          {bidsDepth.map((level) => (
            <Row key={level.price} level={level} side="BUY" maxDepth={maxDepth} onPick={onPickPrice} />
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

function Row({
  level,
  side,
  maxDepth,
  onPick,
}: {
  level: Level & { cumulative: number };
  side: 'BUY' | 'SELL';
  maxDepth: number;
  onPick?: (price: string) => void;
}) {
  const pct = Math.min(100, (level.cumulative / maxDepth) * 100);
  const flashing = useRowFlash(parseFloat(level.quantity));
  const flashClass = flashing ? (side === 'BUY' ? 'book-row-flash-up' : 'book-row-flash-down') : '';
  const price = parseFloat(level.price);
  const quantity = parseFloat(level.quantity);

  return (
    <div className={`ob-row ${flashClass}`} onClick={() => onPick?.(price.toFixed(2))}>
      <div className={`ob-depth-bar ${side === 'BUY' ? 'bid' : 'ask'}`} style={{ width: `${pct}%` }} />
      <span className={`cell ${side === 'BUY' ? 'bid-price' : 'ask-price'}`}>{price.toFixed(2)}</span>
      <span className="cell">{quantity.toFixed(5)}</span>
      <span className="cell">{(price * quantity).toFixed(2)}</span>
    </div>
  );
}
