import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../lib/i18n';

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
// scroll past a wall of asks first. `bids`/`asks` arrive best-price-first
// (see withDepth's caller below), so the first N of each is exactly that
// near-spread window.
const VISIBLE_LEVELS_PER_SIDE = 15;

export function OrderBookPanel({ bids, asks }: { bids: Level[]; asks: Level[] }) {
  const { t } = useLanguage();
  const asksDepth = withDepth(asks).slice(0, VISIBLE_LEVELS_PER_SIDE);
  const bidsDepth = withDepth(bids).slice(0, VISIBLE_LEVELS_PER_SIDE);
  const maxDepth = Math.max(
    asksDepth.length ? asksDepth[asksDepth.length - 1].cumulative : 0,
    bidsDepth.length ? bidsDepth[bidsDepth.length - 1].cumulative : 0,
    0.0001
  );

  const bestAsk = asks[0] ? parseFloat(asks[0].price) : null;
  const bestBid = bids[0] ? parseFloat(bids[0].price) : null;
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
  const spreadPct = spread !== null && bestBid ? (spread / bestBid) * 100 : null;
  const midPrice = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;

  // Buy/sell pressure within the visible window — real, derived from the
  // same depth already on screen, same idea as the reference's B/S bar.
  const visibleBuyVolume = bidsDepth.length ? bidsDepth[bidsDepth.length - 1].cumulative : 0;
  const visibleSellVolume = asksDepth.length ? asksDepth[asksDepth.length - 1].cumulative : 0;
  const totalVisibleVolume = visibleBuyVolume + visibleSellVolume;
  const buyPct = totalVisibleVolume > 0 ? (visibleBuyVolume / totalVisibleVolume) * 100 : 50;

  return (
    <div style={styles.panel}>
      <div style={styles.columnLabels}>
        <span>{t('trade.price')}</span>
        <span style={{ textAlign: 'right' }}>{t('trade.quantity')}</span>
      </div>

      <div style={{ ...styles.rows, ...styles.asksRows }}>
        {asksDepth
          .slice()
          .reverse()
          .map((level) => (
            <Row key={level.price} level={level} side="SELL" maxDepth={maxDepth} />
          ))}
      </div>

      <div style={styles.midBand}>
        {midPrice !== null && (
          <span className="mono" style={styles.midPrice}>
            {midPrice.toFixed(2)}
          </span>
        )}
        <span style={styles.spread}>
          {spread !== null && spreadPct !== null
            ? `${t('trade.spread')}: ${spread.toFixed(2)} (${spreadPct.toFixed(3)}%)`
            : '—'}
        </span>
      </div>

      <div style={styles.rows}>
        {bidsDepth.map((level) => (
          <Row key={level.price} level={level} side="BUY" maxDepth={maxDepth} />
        ))}
      </div>

      <div style={styles.ratioBar}>
        <div style={{ ...styles.ratioFill, width: `${buyPct}%`, background: 'var(--buy)' }} />
        <div style={{ ...styles.ratioFill, width: `${100 - buyPct}%`, background: 'var(--sell)' }} />
        <span style={styles.ratioLabelLeft}>B {buyPct.toFixed(0)}%</span>
        <span style={styles.ratioLabelRight}>{(100 - buyPct).toFixed(0)}% S</span>
      </div>
    </div>
  );
}

const FLASH_DURATION_MS = 450;

/** True for a brief moment right after this row's quantity changes — same
 * per-row-hook pattern as usePriceFlash, needed here since it must isolate
 * state per price level, not just per side. Fires on ANY change (up or
 * down), unlike the ticker price flash which is directional — a depth
 * level updating at all is the signal a real order-book DOM highlights,
 * regardless of which way its size moved. */
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
}: {
  level: Level & { cumulative: number };
  side: 'BUY' | 'SELL';
  maxDepth: number;
}) {
  const pct = Math.min(100, (level.cumulative / maxDepth) * 100);
  const color = side === 'BUY' ? 'var(--buy)' : 'var(--sell)';
  const gradientColor = side === 'BUY' ? 'rgba(0,214,143,0.28)' : 'rgba(255,77,106,0.28)';
  const flashing = useRowFlash(parseFloat(level.quantity));
  const flashClass = flashing ? (side === 'BUY' ? 'book-row-flash-up' : 'book-row-flash-down') : '';

  return (
    <div className={`row-hover ${flashClass}`} style={styles.row}>
      <div
        style={{
          ...styles.depthBar,
          width: `${pct}%`,
          background: `linear-gradient(to left, ${gradientColor}, transparent)`,
        }}
      />
      <span className="mono" style={{ color, position: 'relative' }}>
        {parseFloat(level.price).toFixed(2)}
      </span>
      <span className="mono" style={{ textAlign: 'right', position: 'relative', color: 'var(--text-primary)' }}>
        {parseFloat(level.quantity).toFixed(5)}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--panel)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flex: 1,
    overflow: 'hidden',
  },
  columnLabels: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
  },
  // Each half gets an equal share of whatever vertical room is actually
  // available and clips the far end first (never the end nearest the
  // spread) — so both the ask half and the bid half stay visible together
  // without scrolling, on any panel height, instead of one side pushing
  // the other off-screen.
  rows: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  asksRows: {
    justifyContent: 'flex-end',
  },
  row: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    padding: '3px 14px',
    fontSize: 12,
    flexShrink: 0,
  },
  depthBar: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
  },
  midBand: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '8px 14px',
    borderTop: '1px solid var(--border)',
    borderBottom: '1px solid var(--border)',
  },
  midPrice: {
    fontSize: 15,
    fontWeight: 800,
    color: 'var(--text-primary)',
  },
  spread: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  ratioBar: {
    position: 'relative',
    flexShrink: 0,
    display: 'flex',
    height: 22,
    overflow: 'hidden',
  },
  ratioFill: {
    height: '100%',
    opacity: 0.5,
  },
  ratioLabelLeft: {
    position: 'absolute',
    left: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--buy)',
  },
  ratioLabelRight: {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--sell)',
  },
};
