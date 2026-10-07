import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRightIcon } from 'lucide-react';
import { Logo, LogoMark } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useLanguage } from '../../lib/i18n';
import { openSupportWidget } from '../../lib/supportWidget';
import './auth-shell.css';
import './auth-form-premium.css';

/** Decorative fiat symbols: ruble, US dollar and Chinese yuan, not a user count. */
function AuthCommunity() {
  const { t } = useLanguage();
  return (
    <div className="vx-auth-extras">
      <div className="vx-auth-community">
        <span className="vx-auth-currencies" aria-hidden="true">
          <span className="vx-auth-currency" data-currency="RUB">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8 21V3h7a4 4 0 0 1 0 8H5M5 16h10" />
            </svg>
          </span>
          <span className="vx-auth-currency" data-currency="USD">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </span>
          <span className="vx-auth-currency" data-currency="CNY">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m4 3 8 10 8-10M12 13v8M5 13h14M5 17h14" />
            </svg>
          </span>
        </span>
        <div className="vx-auth-community-copy">
          <strong>{t('authShell.communityTitle')}</strong>
          <span>{t('authShell.communitySubtitle')}</span>
        </div>
      </div>
      <div className="vx-auth-card-caption">
        <span className="vx-auth-card-number">01</span>
        <span className="vx-auth-card-label">{t('authShell.cardCaption')}</span>
        <span className="vx-auth-card-line" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Presentation only: the route forms retain their existing auth handlers. */
export function AuthShell({ children }: { children: ReactNode }) {
  const { t, lang } = useLanguage();
  const useSelectedBanner = lang === 'ru';
  return (
    <div className={`vx-auth${useSelectedBanner ? ' vx-auth--banner' : ''}`}>
      {useSelectedBanner ? (
        <section className="vx-auth-brand vx-auth-brand-banner">
          {/* The owner-selected raster already includes the logo and slogan.
              Do not duplicate them with HTML or make the banner interactive. */}
          <img className="vx-auth-banner" src="/auth/selected-cabin-banner.webp"
            alt="VOLTEX. Копируйте сделки лучших трейдеров мира. Девушка в кресле самолёта с телефоном и картой."
            width="919" height="941" {...{ fetchpriority: 'high' }} />
          <AuthCommunity />
        </section>
      ) : (
      <section className="vx-auth-brand vx-auth-brand-localized">
        <picture>
          <source media="(max-width: 760px)" srcSet="/auth/business-class-mobile.webp" />
          <img className="vx-auth-photo" src="/auth/business-class-1440.webp"
            srcSet="/auth/business-class-960.webp 960w, /auth/business-class-1440.webp 1440w"
            sizes="50vw" alt="" width="1440" height="2160" {...{ fetchpriority: 'high' }} />
        </picture>
        <div className="vx-auth-brand-inner">
          <header className="vx-auth-brand-head">
            <Link to="/" aria-label={t('register.backHomeAria')}><Logo /></Link>
          </header>
          <div className="vx-auth-hero">
            <h2>{t('authShell.hero.line1')}{' '}{t('authShell.hero.line2')}{' '}{t('authShell.hero.line3')}</h2>
            <p className="vx-auth-lead">{t('authShell.lead')}</p>
          </div>
          <footer className="vx-auth-copyright">© {new Date().getFullYear()} VOLTEX</footer>
        </div>
        <AuthCommunity />
      </section>
      )}
      <section className="vx-auth-work">
        <header className="vx-auth-head">
          {useSelectedBanner && (
            <Link className="vx-auth-compact-logo" to="/" aria-label={t('register.backHomeAria')}><Logo /></Link>
          )}
          <span className="vx-auth-context">{t('authShell.context')}</span>
          <LanguageSwitcher variant="pill" />
        </header>
        {children}
        <AuthCommunity />
        <footer className="vx-auth-foot">
          <Link to="/legal/privacy">{t('footer.privacy')}</Link>
          <Link to="/legal/terms">{t('footer.terms')}</Link>
        </footer>
      </section>
    </div>
  );
}

export function AuthFormIcon() {
  return <div className="vx-auth-form-icon" aria-hidden="true"><LogoMark size={28} /></div>;
}

export function AuthTabs({ active }: { active: 'login' | 'register' }) {
  const { t } = useLanguage();
  return (
    <nav className="vx-auth-tabs" aria-label={t('authShell.context')}>
      <Link to={`/login${window.location.search}`} aria-current={active === 'login' ? 'page' : undefined}>{t('auth.login')}</Link>
      <Link to={`/register${window.location.search}`} aria-current={active === 'register' ? 'page' : undefined}>{t('auth.register')}</Link>
    </nav>
  );
}

export function AuthSupport() {
  const { t } = useLanguage();
  return (
    <div className="vx-auth-support">
      <span>{t('authShell.supportHint')}</span>
      <button type="button" onClick={openSupportWidget}>{t('authShell.supportLink')}<ArrowUpRightIcon size={13} /></button>
    </div>
  );
}
