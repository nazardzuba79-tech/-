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

export function OrderBookPanel({ bids, asks }: { bids: Level[]; asks: Level[] }) {
  const { t } = useLanguage();
  const asksDepth = withDepth(asks);
  const bidsDepth = withDepth(bids);
  const maxDepth = Math.max(
    asksDepth.length ? asksDepth[asksDepth.length - 1].cumulative : 0,
    bidsDepth.length ? bidsDepth[bidsDepth.length - 1].cumulative : 0,
    0.0001
  );

  const bestAsk = asks[0] ? parseFloat(asks[0].price) : null;
  const bestBid = bids[0] ? parseFloat(bids[0].price) : null;
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
  const spreadPct = spread !== null && bestBid ? (spread / bestBid) * 100 : null;

  return (
    <div style={styles.panel}>
      <div style={styles.columnLabels}>
        <span>{t('trade.price')}</span>
        <span style={{ textAlign: 'right' }}>{t('trade.quantity')}</span>
      </div>

      <div style={styles.rows}>
        {asksDepth
          .slice()
          .reverse()
          .map((level) => (
            <Row key={level.price} level={level} side="SELL" maxDepth={maxDepth} />
          ))}
      </div>

      <div style={styles.spread}>
        {spread !== null && spreadPct !== null
          ? `${t('trade.spread')}: ${spread.toFixed(2)} (${spreadPct.toFixed(3)}%)`
          : '—'}
      </div>

      <div style={styles.rows}>
        {bidsDepth.map((level) => (
          <Row key={level.price} level={level} side="BUY" maxDepth={maxDepth} />
        ))}
      </div>
    </div>
  );
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

  return (
    <div className="row-hover" style={styles.row}>
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
    overflow: 'auto',
  },
  columnLabels: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    padding: '3px 14px',
    fontSize: 12,
  },
  depthBar: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
  },
  spread: {
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    borderTop: '1px solid var(--border)',
    borderBottom: '1px solid var(--border)',
  },
};
