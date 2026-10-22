import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getToken } from '../../lib/api';
import { useLanguage, type Key } from '../../lib/i18n';
import { Nav } from '../../components/Nav';
import { Logo } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { TradingBotIcon } from '../../components/TradingBotIcon';
import { Footer } from '../../components/Footer';
import { KnowledgeMobileSupport } from './KnowledgeMobileSupport';
import './knowledge.css';

/** The guest header lists the same product sections as the homepage header. */
const GUEST_LINKS: { to: string; labelKey: Key }[] = [
  { to: '/markets', labelKey: 'nav.markets' },
  { to: '/trade', labelKey: 'nav.trade' },
  { to: '/futures', labelKey: 'nav.futures' },
  { to: '/copy-trading', labelKey: 'nav.copyTrading' },
  { to: '/card', labelKey: 'nav.card' },
  { to: '/otc', labelKey: 'nav.otc' },
];

/**
 * Frame of the Academy and Help pages. «Академия» is one more tab of the
 * site's own header, not a separate area (owner, 2026-10-01): a signed-in
 * visitor gets the ordinary `Nav` with the Academy tab lit, a guest gets
 * the same header styles with the public sections.
 *
 * These pages promise no request to api.voltextech.net, so `Nav` runs
 * without its profile read and without the price ticker.
 */
export function KnowledgeShell({ active, fallback, children }: { active: 'academy' | 'help'; fallback: boolean; children: ReactNode }) {
  const { t } = useLanguage();
  const signedIn = !!getToken();
  return (
    <div className="vx-kb-page">
      {signedIn ? (
        <Nav active={active === 'academy' ? '/academy' : '/help'} hideTicker readProfile={false} />
      ) : (
        <header className="global-header top-nav-bar vx-kb-guest-header">
          <div className="header-left">
            <Link to="/" className="header-brand" aria-label="VOLTEX"><Logo /></Link>
            <span className="brand-separator top-nav-divider" aria-hidden="true" />
            <nav className="main-nav nav-desktop-links" aria-label={t('nav.menu')}>
              {GUEST_LINKS.map((l) => <Link key={l.to} to={l.to} className="nav-item top-nav-link">{t(l.labelKey)}</Link>)}
              <Link to="/trading-bots" className="nav-item top-nav-link"><TradingBotIcon />Торговые боты</Link>
              <Link to="/academy" className={`nav-item top-nav-link${active === 'academy' ? ' nav-active is-active' : ''}`} aria-current={active === 'academy' ? 'page' : undefined}>{t('nav.academy')}</Link>
            </nav>
          </div>
          <div className="header-actions vx-kb-guest-actions">
            <LanguageSwitcher variant="pill" />
            <Link to="/login" className="vx-kb-guest-login">{t('auth.login')}</Link>
            <Link to="/register" className="deposit-button top-nav-fund-btn"><span>{t('home.cta.startTrading')}</span></Link>
          </div>
        </header>
      )}
      {!signedIn && (
        // Below 1440 px the product row folds away. Academy is the one
        // public knowledge entry; system status remains a separate service page.
        <nav className="vx-kb-guest-tabs" aria-label={t('nav.menu')}>
          <Link to="/academy" aria-current={active === 'academy' ? 'page' : undefined}>{t('nav.academy')}</Link>
          {active === 'help' && <Link to="/help/status" aria-current="page">{t('help.tab.status')}</Link>}
        </nav>
      )}
      {fallback && <p className="vx-kb-ru-only" role="note" lang="en">{t('academy.ruOnly')}</p>}
      <main className="vx-kb"><KnowledgeMobileSupport />{children}</main>
      {/* The site footer expects a padded column around it, as on Markets. */}
      <div className="vx-kb-footer"><Footer /></div>
    </div>
  );
}
