import { HeaderDropdown, KNOWLEDGE_LINKS, MARKET_LINKS, OTC_LINKS, TRADING_LINKS } from '../../components/HeaderDropdown';
import { TradingBotIcon } from '../../components/TradingBotIcon';
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
 * Аналитика is intentionally absent. It is no longer admin-gated — any
 * signed-in user can open it — but this list is the approved landing-page
 * header and is not changed here; Analytics is reached from the in-app Nav,
 * which does carry it. Админка likewise never appears here.
 */
/* The product dictionaries are frozen by language-digest tests; keep the
   homepage-only trading-bots navigation caption localized here until a
   separately reviewed i18n-key migration is authorized. */
const HOME_BOTS_LABEL: Record<string, string> = {
  ru: 'Торговые боты',
  en: 'Trading bots',
  es: 'Bots de trading',
  zh: '交易机器人',
  hi: 'ट्रेडिंग बॉट',
  ja: '取引ボット',
  ko: '트레이딩 봇',
};

const LINKS: { to: string; labelKey: Key }[] = [
  { to: '/markets', labelKey: 'nav.markets' },
  { to: '/trade', labelKey: 'nav.trade' },
  { to: '/futures', labelKey: 'nav.futures' },
  { to: '/copy-trading', labelKey: 'nav.copyTrading' },
  { to: '/card', labelKey: 'nav.card' },
  { to: '/otc', labelKey: 'nav.otc' },
  { to: '/academy', labelKey: 'nav.academy' },
];

export function HomeHeader() {
  const { lang, t } = useLanguage();
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
    <header className="sticky top-0 z-40 border-b border-white/6 bg-[#1a1b20]" style={{fontFamily:'Arial, Helvetica, sans-serif',background:'#1a1b20'}}>
      <div className="mx-auto flex h-[58px] min-[1025px]:h-[68px] w-full max-w-[1460px] items-center gap-2 px-4 sm:gap-6 sm:px-6">
        <Link to="/" className="home-brand shrink-0" aria-label="VOLTEX">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-[2px] min-[1440px]:flex" aria-label={t('home.nav.main')}>
          {LINKS.map((l) => (
            l.to === '/markets' || l.to === '/trade' || l.to === '/otc' || l.to === '/academy' ? <HeaderDropdown key={l.to} to={l.to} label={t(l.labelKey)} links={l.to === '/markets' ? MARKET_LINKS : l.to === '/trade' ? TRADING_LINKS : l.to === '/otc' ? OTC_LINKS : KNOWLEDGE_LINKS} className="whitespace-nowrap rounded-[5px] px-[9px] py-[6px] text-[12.5px] font-medium text-home-muted hover:text-white"/> : <Link
              key={l.to}
              to={l.to}
              className="whitespace-nowrap rounded-[5px] px-[9px] py-[6px] text-[12.5px] font-medium text-home-muted transition-colors duration-150 hover:bg-white/[0.05] hover:text-white"
            >
              {t(l.labelKey)}
            </Link>
          ))}
          <Link to="/trading-bots" className="inline-flex items-center gap-[6px] whitespace-nowrap rounded-[5px] px-[9px] py-[6px] text-[12.5px] font-medium text-home-muted transition-colors duration-150 hover:bg-white/[0.05] hover:text-white"><TradingBotIcon/>{HOME_BOTS_LABEL[lang] ?? HOME_BOTS_LABEL.ru}</Link>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
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
                className="whitespace-nowrap rounded-[6px] px-1 py-[7px] text-[12.5px] font-medium text-home-muted transition-colors duration-150 hover:text-white sm:px-3"
              >
                {t('auth.login')}
              </Link>
              <Link
                to="/register"
                className="whitespace-nowrap rounded-[6px] bg-gold-500 px-3 py-[8px] text-[12.5px] font-semibold text-ink-950 transition-colors duration-150 hover:bg-gold-400 active:translate-y-[1px] sm:px-4"
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
            className="ml-1 rounded-[5px] p-1.5 text-home-muted transition-colors hover:text-white min-[1440px]:hidden"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-white/6 px-6 py-3 max-h-[calc(100dvh-58px)] overflow-y-auto min-[1440px]:hidden" aria-label={t('home.nav.mobile')}>
          <div className="grid grid-cols-1 gap-1">
            {LINKS.map((l) => (
              l.to === '/markets' || l.to === '/trade' || l.to === '/otc' || l.to === '/academy' ? <HeaderDropdown mobile key={l.to} to={l.to} label={t(l.labelKey)} links={l.to === '/markets' ? MARKET_LINKS : l.to === '/trade' ? TRADING_LINKS : l.to === '/otc' ? OTC_LINKS : KNOWLEDGE_LINKS} className="rounded-[5px] px-3 py-[9px] text-[13px] font-medium text-home-muted hover:text-white" onNavigate={() => setOpen(false)}/> : <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="whitespace-nowrap rounded-[5px] px-3 py-[9px] text-[13px] font-medium text-home-muted hover:bg-white/[0.05] hover:text-white"
              >
                {t(l.labelKey)}
              </Link>
            ))}
            <Link to="/trading-bots" onClick={() => setOpen(false)} className="inline-flex items-center gap-[6px] whitespace-nowrap rounded-[5px] px-3 py-[9px] text-[13px] font-medium text-home-muted hover:bg-white/[0.05] hover:text-white"><TradingBotIcon/>{HOME_BOTS_LABEL[lang] ?? HOME_BOTS_LABEL.ru}</Link>
          </div>
        </nav>
      )}
    </header>
  );
}
