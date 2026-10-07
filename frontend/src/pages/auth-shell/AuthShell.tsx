import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRightIcon } from 'lucide-react';
import { EU, CH, JP, US, CN, RU } from 'country-flag-icons/react/3x2';
import { Logo, LogoMark } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useLanguage } from '../../lib/i18n';
import { openSupportWidget } from '../../lib/supportWidget';
import './auth-shell.css';
import './auth-form-premium.css';

/** Decorative currency examples, not the complete list or a user count. */
function AuthCommunity() {
  const { t } = useLanguage();
  const [fiatCaption, cryptoCaption] = t('authShell.communitySubtitle').split(' · ');
  const [cardAction, voltexFee] = t('authShell.communityTitle').split(' — ');
  return (
    <div className="vx-auth-extras">
      <div className="vx-auth-community">
        <div className="vx-auth-currency-sample">
          <span className="vx-auth-currencies" aria-hidden="true">
            <span className="vx-auth-currency" data-currency="EUR">
              <EU aria-hidden="true" focusable="false" />
            </span>
            <span className="vx-auth-currency" data-currency="CHF">
              <CH aria-hidden="true" focusable="false" />
            </span>
            <span className="vx-auth-currency" data-currency="JPY">
              <JP aria-hidden="true" focusable="false" />
            </span>
            <span className="vx-auth-currency" data-currency="USD">
              <US aria-hidden="true" focusable="false" />
            </span>
            <span className="vx-auth-currency" data-currency="CNY">
              <CN aria-hidden="true" focusable="false" />
            </span>
            <span className="vx-auth-currency" data-currency="RUB">
              <RU aria-hidden="true" focusable="false" />
            </span>
          </span>
          <span className="vx-auth-currency-more">{t('authShell.moreCurrencies')}</span>
        </div>
        <div className="vx-auth-community-copy">
          <strong>{cardAction}{' '}<span className="vx-auth-card-fee">— {voltexFee}</span></strong>
          <span><span className="vx-auth-currency-amount">{fiatCaption} ·</span>{' '}<span className="vx-auth-currency-amount">{cryptoCaption}</span></span>
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
