import { useLanguage } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';
import type { CfdTickerRow } from './CfdInstrumentList';

/**
 * Stands in for PriceChart in CFD mode — Twelve Data's free quote endpoint
 * gives a current price and 24h change, not a candle history, so this
 * deliberately doesn't draw a fake-looking chart from data it doesn't
 * have. Same honesty rule as OtcPage: real numbers only, no invented
 * detail to make the panel look more complete than it is.
 */
export function CfdPricePanel({ ticker, loading }: { ticker: CfdTickerRow | undefined; loading: boolean }) {
  const { t } = useLanguage();

  if (!ticker) {
    return (
      <div style={styles.wrap}>
        <p style={styles.hint}>{loading ? t('trade.loading') : t('trade.cfdUnavailable')}</p>
      </div>
    );
  }

  const change = parseChangePercent(ticker.changePercent24h, ticker.symbol);
  const positive = change >= 0;

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span className="mono" style={styles.symbol}>
          {ticker.symbol}
        </span>
        <span style={styles.name}>{ticker.name}</span>
      </div>
      <div style={styles.priceRow}>
        <span className="mono" style={styles.price}>
          {ticker.price}
        </span>
        <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.change}>
          {positive ? '+' : ''}
          {change.toFixed(2)}%
        </span>
      </div>
      <p style={styles.disclaimer}>{t('trade.cfdPriceDisclaimer')}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 32,
    textAlign: 'center',
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  symbol: { fontSize: 15, fontWeight: 800, letterSpacing: '0.04em' },
  name: { fontSize: 12, color: 'var(--text-tertiary)' },
  priceRow: { display: 'flex', alignItems: 'baseline', gap: 12 },
  price: { fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em' },
  change: { fontSize: 16, fontWeight: 700 },
  disclaimer: { fontSize: 11, color: 'var(--text-tertiary)', maxWidth: 320, lineHeight: 1.6, margin: 0 },
  hint: { color: 'var(--text-secondary)', fontSize: 13 },
};
