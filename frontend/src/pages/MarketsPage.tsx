import { Link, useSearchParams } from 'react-router-dom';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { MarketsBoltPage } from './markets-bolt/components';
import { MarketsAnalyticsSection } from './markets-bolt/MarketsAnalyticsSection';
import './markets-bolt/MarketsAnalyticsEmbed.css';

/**
 * Markets is now the single home for market discovery and market analytics.
 * The default view keeps the existing approved Markets page untouched. The
 * Analytics view is mounted only when explicitly opened, so its 30s snapshot
 * subscription does not add background work to an ordinary Markets visit.
 */
export function MarketsPage() {
  const [params] = useSearchParams();
  const analytics = params.get('view') === 'analytics';

  if (!analytics) {
    return <>
      <MarketsBoltPage />
      <Link className="markets-analytics-launch" to="/markets?view=analytics">Аналитика</Link>
    </>;
  }

  return (
    <div className="markets-bolt-root">
      <Nav active="/markets" tickerHrefFor={(pair) => `/trade?pair=${encodeURIComponent(pair)}`} />
      <main className="markets-page markets-analytics-page">
        <div className="page-intro">
          <div>
            <p className="eyebrow">Рынки</p>
            <h1>Рыночная аналитика</h1>
            <p className="intro-copy">Рабочие аналитические модули VOLTEX без недоступных заглушек.</p>
          </div>
          <nav className="markets-view-tabs" aria-label="Разделы рынков">
            <Link to="/markets">Рынки</Link>
            <Link className="is-active" to="/markets?view=analytics" aria-current="page">Аналитика</Link>
          </nav>
        </div>
        <MarketsAnalyticsSection />
        <Footer />
      </main>
    </div>
  );
}
