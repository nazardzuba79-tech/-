import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CoinsIcon, CreditCardIcon, PercentIcon, WalletCardsIcon } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { HomeCryptoCard } from '../home/HomeCryptoCard';
import { useLanguage, type Key } from '../../lib/i18n';
import './auth-shell.css';

/**
 * The shared VOLTEX authentication screen: a dark presentation column on
 * the left, a light auth workspace on the right, used by both /register
 * and /login so the two are one design rather than two.
 *
 * Everything on the left is presentation only — no status claim, no live
 * feed, no control. The one product artefact it shows is the approved
 * physical card render, reused through HomeCryptoCard rather than redrawn:
 * the card art on this screen is the same file the homepage and the Crypto
 * Card page serve.
 *
 * The right column is a slot. Each page supplies its own form; nothing
 * about submission, validation or error handling lives here.
 */

const BENEFITS: { key: string; Icon: typeof PercentIcon; title: Key; text: Key }[] = [
  { key: 'trading', Icon: PercentIcon, title: 'authShell.benefit.trading.title', text: 'authShell.benefit.trading.text' },
  { key: 'clients', Icon: CoinsIcon, title: 'authShell.benefit.clients.title', text: 'authShell.benefit.clients.text' },
  { key: 'card', Icon: CreditCardIcon, title: 'authShell.benefit.card.title', text: 'authShell.benefit.card.text' },
];

export type AuthShellProps = {
  /** "Уже есть аккаунт?" / "Нет аккаунта?" — the prompt beside the header link. */
  switchPrompt: string;
  /** The header link's label and destination (the other auth page). */
  switchLabel: string;
  switchTo: string;
  children: ReactNode;
};

export function AuthShell({ switchPrompt, switchLabel, switchTo, children }: AuthShellProps) {
  const { t } = useLanguage();

  return (
    <div className="vx-auth">
      <section className="vx-auth-brand">
        <div className="vx-auth-brand-inner">
          <header className="vx-auth-brand-head">
            <Link to="/" aria-label={t('register.backHomeAria')}>
              <Logo />
            </Link>
          </header>

          <div className="vx-auth-hero">
            {/* One sentence over three lines: the subject in warm white,
                the qualifier it earns in gold. */}
            <h1>
              <span>{t('authShell.hero.line1')}</span>
              <span className="vx-auth-hero-gold">{t('authShell.hero.line2')}</span>
              <span className="vx-auth-hero-gold">{t('authShell.hero.line3')}</span>
            </h1>
            <p className="vx-auth-lead">{t('authShell.lead')}</p>
          </div>

          <div className="vx-auth-benefits">
            {BENEFITS.map(({ key, Icon, title, text }) => (
              <div className="vx-auth-benefit" key={key}>
                <span className="vx-auth-benefit-icon">
                  <Icon size={17} strokeWidth={1.6} />
                </span>
                <div>
                  <h2>{t(title)}</h2>
                  <p>{t(text)}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="vx-auth-card">
            {/* The approved card artwork, reused as-is — same component and
                same render the homepage uses. Nothing here recolours,
                masks or redraws it, and no card number is invented: the
                art carries its own face. */}
            <div className="vx-auth-card-art">
              <HomeCryptoCard width={228} />
            </div>
            <div className="vx-auth-card-copy">
              <span className="vx-auth-card-kicker">
                <WalletCardsIcon size={13} strokeWidth={1.8} />
                {t('authShell.card.kicker')}
              </span>
              <h2>{t('authShell.card.title')}</h2>
              <p>{t('authShell.card.text')}</p>
              <p className="vx-auth-card-note">{t('authShell.card.note')}</p>
            </div>
          </div>

          <footer className="vx-auth-privacy">{t('auth.privacyNote')}</footer>
        </div>
      </section>

      <section className="vx-auth-work">
        <header className="vx-auth-head">
          <Link to="/" className="vx-auth-head-logo" aria-label={t('register.backHomeAria')}>
            <Logo />
          </Link>
          <div className="vx-auth-switch">
            <span>{switchPrompt}</span>
            <Link to={switchTo}>{switchLabel}</Link>
          </div>
          <LanguageSwitcher variant="pill" />
        </header>

        {children}

        <div className="vx-auth-foot">
          <span>© {new Date().getFullYear()} VOLTEX</span>
          <Link to="/legal/terms">{t('footer.terms')}</Link>
          <Link to="/legal/privacy">{t('footer.privacy')}</Link>
        </div>
      </section>
    </div>
  );
}
