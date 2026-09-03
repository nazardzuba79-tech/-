import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { api, getToken } from '../../lib/api';
import { Key, useLanguage } from '../../lib/i18n';
import { Logo } from '../../components/Logo';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { WalletBalanceControl } from '../../components/WalletBalanceControl';

/**
 * The homepage header. Product structure matches the app's own shared
 * navigation, and the right side follows real session state rather than
 * assuming every visitor is logged out:
 *
 *  - signed out -> Вход / Начать торговлю
 *  - signed in  -> the real wallet balance control, Пополнить, language,
 *                  profile — the same controls the in-app header carries
 *
 * Аналитика is intentionally absent: it is admin-gated (see useAdminGate),
 * and a public landing page is not the place to advertise a restricted
 * area. Админка likewise never appears here; it is reached from the app.
 */
const LINKS: { to: string; labelKey: Key }[] = [
  { to: '/markets', labelKey: 'nav.markets' },
  { to: '/trade', labelKey: 'nav.trade' },
  { to: '/futures', labelKey: 'nav.futures' },
  { to: '/copy-trading', labelKey: 'nav.copyTrading' },
  { to: '/arbitrage', labelKey: 'nav.arbitrage' },
  { to: '/card', labelKey: 'nav.card' },
  { to: '/otc', labelKey: 'nav.otc' },
];

export function HomeHeader() {
  const { t } = useLanguage();
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [open, setOpen] = useState(false);

  // A stored token can be expired; confirm it against the server rather
  // than showing a balance control that will only 401.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    api
      .getMe()
      .then(() => !cancelled && setAuthed(true))
      .catch(() => !cancelled && setAuthed(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-white/6 bg-[#05070a]">
      <div className="mx-auto flex h-[58px] w-full max-w-[1460px] items-center gap-6 px-6">
        <Link to="/" className="shrink-0" aria-label="VOLTEX">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-[2px] lg:flex" aria-label={t('home.nav.main')}>
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="whitespace-nowrap rounded-[5px] px-[9px] py-[6px] text-[12.5px] font-medium text-home-muted transition-colors duration-150 hover:bg-white/[0.05] hover:text-white"
            >
              {t(l.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {authed ? (
            <>
              <div className="hidden sm:block">
                <WalletBalanceControl />
              </div>
              <Link
                to="/wallet"
                className="whitespace-nowrap rounded-[6px] bg-gold-500 px-4 py-[8px] text-[12.5px] font-semibold text-ink-950 transition-colors duration-150 hover:bg-gold-400"
              >
                {t('wallet.deposit')}
              </Link>
              <div className="hidden sm:block">
                <LanguageSwitcher variant="pill" />
              </div>
              <Link
                to="/settings"
                className="whitespace-nowrap rounded-[6px] border border-white/12 px-3 py-[7px] text-[12.5px] font-medium text-white transition-colors duration-150 hover:border-white/25"
              >
                {t('nav.profile')}
              </Link>
            </>
          ) : (
            <>
              <div className="hidden sm:block">
                <LanguageSwitcher variant="pill" />
              </div>
              <Link
                to="/login"
                className="whitespace-nowrap rounded-[6px] px-3 py-[7px] text-[12.5px] font-medium text-home-muted transition-colors duration-150 hover:text-white"
              >
                {t('auth.login')}
              </Link>
              <Link
                to="/register"
                className="whitespace-nowrap rounded-[6px] bg-gold-500 px-4 py-[8px] text-[12.5px] font-semibold text-ink-950 transition-colors duration-150 hover:bg-gold-400 active:translate-y-[1px]"
              >
                {t('home.cta.startTrading')}
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={t('nav.menu')}
            aria-expanded={open}
            className="ml-1 rounded-[5px] p-1.5 text-home-muted transition-colors hover:text-white lg:hidden"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-white/6 px-6 py-3 lg:hidden" aria-label={t('home.nav.mobile')}>
          <div className="grid grid-cols-2 gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="whitespace-nowrap rounded-[5px] px-3 py-[9px] text-[13px] font-medium text-home-muted hover:bg-white/[0.05] hover:text-white"
              >
                {t(l.labelKey)}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
