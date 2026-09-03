import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { useLanguage, Key } from '../lib/i18n';
import { useAdminGate } from '../lib/useAdminGate';

/**
 * A single analytics module: one heading, one body, rendered in the order
 * this file lists them.
 *
 * This is the extension point. The metrics this page is meant to carry —
 * open interest, funding rates, liquidations, long/short ratio, the
 * liquidation and funding heatmaps, ETF flows, exchange inflow/outflow,
 * whale activity, BTC and ETH dominance — are each one entry in SECTIONS
 * with a component that fetches its own data. Nothing about the page shell
 * has to change to add one.
 *
 * Deliberately keyed on i18n, not on a literal string, so a section cannot
 * be added with hardcoded copy.
 */
interface AnalyticsSection {
  id: string;
  titleKey: Key;
  render: () => ReactNode;
}

/**
 * Empty on purpose. None of the metrics above has a data source behind it
 * yet, and this exchange records several of them nowhere at all (open
 * interest, long/short ratio and liquidation totals are not in the
 * backend — see the note in FuturesTickerBar). A placeholder card or a
 * drawn-from-nothing chart here would be indistinguishable from a real one
 * to anyone looking at the page, so there are none: the page states that
 * the section is in development and shows nothing else.
 */
const SECTIONS: AnalyticsSection[] = [];

/**
 * Market and derivatives analytics. Admin-only for now — the same gate the
 * admin panel uses (useAdminGate), and the same unauthorized behaviour:
 * an ordinary user visiting /analytics directly is redirected to "/" just
 * as they are on /admin. The nav entry is hidden for them too, but that is
 * only cosmetic; this guard is what actually closes the route.
 */
export function AnalyticsPage() {
  const { t } = useLanguage();
  const { status } = useAdminGate();

  if (status === 'loading') return <div style={styles.loadingScreen} />;
  if (status === 'denied') return <Navigate to="/" replace />;

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/analytics" />
      <main style={styles.main}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>{t('analytics.title')}</h1>
            <p style={styles.subtitle}>{t('analytics.subtitle')}</p>
          </div>
          <span style={styles.statusPill}>{t('analytics.inDevelopment')}</span>
        </div>

        {SECTIONS.map((section) => (
          <section key={section.id} className="accent-edge surface-raised" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>{t(section.titleKey)}</h2>
            {section.render()}
          </section>
        ))}
      </main>
      <Footer />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  loadingScreen: { minHeight: '100vh', background: 'var(--bg)' },
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 24, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  subtitle: { fontSize: 13, color: 'var(--text-secondary)', margin: '6px 0 0', maxWidth: 560, lineHeight: 1.5 },
  statusPill: {
    flexShrink: 0,
    alignSelf: 'center',
    border: '1px solid var(--border)',
    background: 'var(--panel-alt)',
    color: 'var(--text-secondary)',
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.01em',
  },
  sectionCard: { borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 },
  sectionTitle: { fontSize: 15, margin: 0, fontWeight: 700 },
};
