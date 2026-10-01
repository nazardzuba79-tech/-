import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getToken } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { defaultTradingPath } from '../../lib/tradingMode';
import { Logo } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { Footer } from '../../components/Footer';
import './knowledge.css';

/**
 * Frame of the Academy and Help pages, for guests and signed-in visitors
 * alike. It deliberately does not reuse the trading `Nav`: that header reads
 * the profile from the API on mount, and these pages must open without a
 * single request to api.voltextech.net.
 */
export function KnowledgeShell({ active, fallback, children }: { active: 'academy' | 'help'; fallback: boolean; children: ReactNode }) {
  const { t } = useLanguage();
  const signedIn = !!getToken();
  return (
    <div className="vx-kb-page">
      <header className="vx-kb-header">
        <div className="vx-kb-header-row">
          <Link to="/" className="vx-kb-logo" aria-label="VOLTEX"><Logo /></Link>
          <nav className="vx-kb-header-nav" aria-label={t('nav.menu')}>
            <Link to="/academy" aria-current={active === 'academy' ? 'page' : undefined}>{t('nav.academy')}</Link>
            <Link to="/help/faq" aria-current={active === 'help' ? 'page' : undefined}>{t('nav.help')}</Link>
          </nav>
          <div className="vx-kb-header-actions">
            <LanguageSwitcher variant="pill" />
            {signedIn ? (
              <>
                <Link to="/wallet" className="vx-kb-header-link">{t('nav.wallet')}</Link>
                <Link to={defaultTradingPath()} className="vx-kb-button">{t('nav.trade')}</Link>
              </>
            ) : (
              <>
                <Link to="/login" className="vx-kb-header-link">{t('auth.login')}</Link>
                <Link to="/register" className="vx-kb-button">{t('auth.register')}</Link>
              </>
            )}
          </div>
        </div>
      </header>
      {fallback && <p className="vx-kb-ru-only" role="note" lang="en">{t('academy.ruOnly')}</p>}
      <main className="vx-kb">{children}</main>
      {/* The site footer expects a padded column around it, as on Markets. */}
      <div className="vx-kb-footer"><Footer /></div>
    </div>
  );
}
