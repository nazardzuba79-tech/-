import { useCallback, useEffect, useState } from 'react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { CryptoIcon } from '../components/CryptoIcon';
import { useLanguage } from '../lib/i18n';
import { api } from '../lib/api';

interface Opportunity {
  pair: string;
  buyExchange: string;
  buyPrice: number;
  sellExchange: string;
  sellPrice: number;
  spreadPercent: number;
  netSpreadPercent: number;
}

const REFRESH_INTERVAL_MS = 15_000;

/**
 * Real, live cross-exchange price comparison — every row here is a genuine
 * quote pulled from Binance/OKX/our own Kraken mirror at request time (see
 * ArbitrageService on the backend), not a demo/mock. Deliberately framed
 * as a monitor rather than a bot: the platform never transfers or trades
 * funds on the user's behalf on another exchange, and real cross-exchange
 * spreads on major pairs are typically small — this page shows whatever
 * the actual number is rather than a marketed "typical return".
 */
export function ArbitragePage() {
  const { t } = useLanguage();
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    api
      .getArbitrageOpportunities()
      .then((res) => {
        setOpportunities(res.opportunities);
        setError(false);
        setLastUpdated(new Date());
      })
      .catch(() => setError(true))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/arbitrage" />
      <main style={styles.main}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>{t('arbitrage.title')}</h1>
            <p style={styles.subtitle}>{t('arbitrage.subtitle')}</p>
          </div>
          <button style={styles.refreshBtn} onClick={load} disabled={refreshing}>
            {t('arbitrage.refresh')}
          </button>
        </div>

        <div style={styles.notice}>{t('arbitrage.monitorNotice')}</div>

        <div className="accent-edge surface-raised" style={styles.tableCard}>
          {opportunities === null && !error && <div style={styles.stateText}>…</div>}
          {error && <div style={styles.stateTextError}>{t('arbitrage.loadError')}</div>}
          {opportunities !== null && !error && opportunities.length === 0 && (
            <div style={styles.stateText}>{t('arbitrage.empty')}</div>
          )}
          {opportunities !== null && !error && opportunities.length > 0 && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('arbitrage.colPair')}</th>
                  <th style={styles.th}>{t('arbitrage.colBuy')}</th>
                  <th style={styles.th}>{t('arbitrage.colSell')}</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>{t('arbitrage.colSpread')}</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>{t('arbitrage.colNetSpread')}</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o) => {
                  const base = o.pair.split('/')[0];
                  const positive = o.netSpreadPercent > 0;
                  return (
                    <tr key={o.pair} style={styles.tr}>
                      <td style={styles.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <CryptoIcon symbol={base} size={22} />
                          <span style={{ fontWeight: 700 }}>{o.pair}</span>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.exchangeCell}>
                          <span style={styles.exchangeName}>{o.buyExchange}</span>
                          <span className="mono" style={styles.priceText}>
                            {o.buyPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                          </span>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.exchangeCell}>
                          <span style={styles.exchangeName}>{o.sellExchange}</span>
                          <span className="mono" style={styles.priceText}>
                            {o.sellPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                          </span>
                        </div>
                      </td>
                      <td className="mono" style={{ ...styles.td, textAlign: 'right' }}>
                        {o.spreadPercent.toFixed(3)}%
                      </td>
                      <td
                        className={`mono ${positive ? 'text-buy' : 'text-sell'}`}
                        style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}
                      >
                        {o.netSpreadPercent >= 0 ? '+' : ''}
                        {o.netSpreadPercent.toFixed(3)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={styles.footerRow}>
          <span style={styles.feeNote}>{t('arbitrage.feeNote')}</span>
          {lastUpdated && (
            <span style={styles.lastUpdated}>
              {t('arbitrage.lastUpdated', { time: lastUpdated.toLocaleTimeString() })}
            </span>
          )}
        </div>

        <Footer />
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 24, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  subtitle: { fontSize: 13, color: 'var(--text-secondary)', margin: '6px 0 0', maxWidth: 560, lineHeight: 1.5 },
  refreshBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 10,
    padding: '8px 16px',
    fontWeight: 700,
    fontSize: 12,
    flexShrink: 0,
  },
  notice: {
    fontSize: 12.5,
    color: 'var(--text-secondary)',
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '12px 16px',
    lineHeight: 1.6,
  },
  tableCard: { borderRadius: 12, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    padding: '12px 16px',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)',
  },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px' },
  exchangeCell: { display: 'flex', flexDirection: 'column', gap: 2 },
  exchangeName: { fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' },
  priceText: { fontSize: 12, color: 'var(--text-secondary)' },
  stateText: { padding: '40px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 },
  stateTextError: { padding: '40px 16px', textAlign: 'center', color: 'var(--sell)', fontSize: 13 },
  footerRow: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  feeNote: { fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5, maxWidth: 620 },
  lastUpdated: { fontSize: 11.5, color: 'var(--text-tertiary)', flexShrink: 0 },
};
