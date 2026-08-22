import { useLanguage } from '../lib/i18n';

interface Level {
  price: string;
  quantity: string;
  orders?: number;
}

export function OrderBookPanel({ bids, asks }: { bids: Level[]; asks: Level[] }) {
  const { t } = useLanguage();
  const maxQty = Math.max(
    ...bids.map((b) => parseFloat(b.quantity)),
    ...asks.map((a) => parseFloat(a.quantity)),
    0.0001
  );

  return (
    <div style={styles.panel}>
      <div style={styles.columnLabels}>
        <span>{t('trade.price')}</span>
        <span style={{ textAlign: 'right' }}>{t('trade.quantity')}</span>
      </div>

      <div style={styles.rows}>
        {asks
          .slice()
          .reverse()
          .map((level) => (
            <Row key={level.price} level={level} side="SELL" maxQty={maxQty} />
          ))}
      </div>

      <div style={styles.spread}>
        {asks[0] && bids[0]
          ? `${t('trade.spread')}: ${(parseFloat(asks[0].price) - parseFloat(bids[0].price)).toFixed(2)}`
          : '—'}
      </div>

      <div style={styles.rows}>
        {bids.map((level) => (
          <Row key={level.price} level={level} side="BUY" maxQty={maxQty} />
        ))}
      </div>
    </div>
  );
}

function Row({ level, side, maxQty }: { level: Level; side: 'BUY' | 'SELL'; maxQty: number }) {
  const pct = Math.min(100, (parseFloat(level.quantity) / maxQty) * 100);
  const color = side === 'BUY' ? 'var(--buy)' : 'var(--sell)';
  const bg = side === 'BUY' ? 'var(--buy-dim)' : 'var(--sell-dim)';

  return (
    <div className="row-hover" style={styles.row}>
      <div style={{ ...styles.depthBar, width: `${pct}%`, background: bg }} />
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
