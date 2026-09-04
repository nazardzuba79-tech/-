import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole, Percent, Coins, CreditCard, ShieldCheck } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useLanguage } from '../../lib/i18n';
import { VOLTEX_CARD_ARTWORK } from '../home/HomeCryptoCard';
import { useAuthCopy } from './copy';
import './auth.css';

export function AuthSecurityNote() {
  const { t } = useLanguage();
  return <p className="vx-auth-security"><LockKeyhole size={18} strokeWidth={1.6} /><span>{t('register.securityNote')}</span></p>;
}

export function AuthLayout({ mode, children }: { mode: 'register' | 'login'; children: ReactNode }) {
  const { t } = useLanguage();
  const copy = useAuthCopy();
  const icons = [Percent, Coins, CreditCard];
  const brand = <Link className="vx-auth-brand" to="/" aria-label={t('register.backHomeAria')}><Logo /></Link>;
  return (
    <main className="vx-auth">
      <aside className="vx-auth-hero" aria-labelledby="auth-hero-title">
        <div className="vx-auth-horizon" aria-hidden="true" />
        {brand}
        <div className="vx-auth-pitch">
          <h2 id="auth-hero-title">{copy.hero.map((line, i) => <span key={line} className={i ? 'vx-auth-gold' : undefined}>{line}</span>)}</h2>
          <p className="vx-auth-intro">{copy.intro}</p>
          <ul className="vx-auth-benefits">
            {copy.benefits.map(([title, description], i) => {
              const Icon = icons[i];
              return <li key={title}><span className="vx-auth-benefit-icon"><Icon size={25} strokeWidth={1.5} /></span><div><h3>{title}</h3><p>{description}</p></div></li>;
            })}
          </ul>
        </div>
        <div className="vx-auth-hero-footer">
          <p className="vx-auth-privacy"><ShieldCheck size={27} strokeWidth={1.5} /><span>{t('auth.privacyNote')}</span></p>
          <img className="vx-auth-artwork" src={VOLTEX_CARD_ARTWORK} alt="VOLTEX Crypto Card" width="525" height="439" draggable={false} />
        </div>
      </aside>
      <section className="vx-auth-surface" aria-labelledby="auth-form-title">
        <header className="vx-auth-topbar">
          <div className="vx-auth-mobile-brand">{brand}</div>
          <div className="vx-auth-account-link"><span>{mode === 'register' ? t('register.haveAccount') : copy.noAccount}</span><Link to={`${mode === 'register' ? '/login' : '/register'}${window.location.search}`}>{mode === 'register' ? t('auth.signIn') : t('auth.register')}</Link></div>
          <LanguageSwitcher variant="pill" />
        </header>
        <div className="vx-auth-form-position"><div className="vx-auth-form-content">{children}<AuthSecurityNote /></div></div>
      </section>
    </main>
  );
}
