import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRightIcon } from 'lucide-react';
import { Logo, LogoMark } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useLanguage } from '../../lib/i18n';
import { openSupportWidget } from '../../lib/supportWidget';
import './auth-shell.css';

/** Presentation only: the route forms retain their existing auth handlers. */
export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="vx-auth">
      <section className="vx-auth-brand">
        <img className="vx-auth-photo" src="/auth/aircraft-v6.webp" alt="" width="1122" height="1402" />
        <div className="vx-auth-brand-inner">
          <header className="vx-auth-brand-head">
            <Link to="/" aria-label={t('register.backHomeAria')}><Logo /></Link>
          </header>
          <div className="vx-auth-hero">
            <h1>
              <span>{t('authShell.hero.line1')}</span>
              <span>{t('authShell.hero.line2')}</span>
              <span className="vx-auth-hero-gold">{t('authShell.hero.line3')}</span>
            </h1>
            <p className="vx-auth-lead">{t('authShell.lead')}</p>
          </div>
          <div className="vx-auth-community">
            {/* Decorative illustrations; the owner confirmed the aggregate count. */}
            <div className="vx-auth-avatars" aria-hidden="true">
              <span className="vx-auth-avatar" /><span className="vx-auth-avatar" /><span className="vx-auth-avatar" />
              <span className="vx-auth-avatar-count">{t('authShell.communityBadge')}</span>
            </div>
            <div className="vx-auth-community-copy">
              <strong>{t('authShell.communityCount')}</strong>
              <p>{t('authShell.communityText')}</p>
            </div>
          </div>
          <div className="vx-auth-card-caption"><span>01</span><p>{t('authShell.cardCaption')}</p></div>
          <footer className="vx-auth-copyright">© {new Date().getFullYear()} VOLTEX</footer>
        </div>
      </section>
      <section className="vx-auth-work">
        <header className="vx-auth-head">
          <span className="vx-auth-context">{t('authShell.context')}</span>
          <LanguageSwitcher variant="pill" />
        </header>
        {children}
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
