import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Globe, LogOut, Menu, X } from 'lucide-react';
import { api, clearToken, getToken } from '../../lib/api';
import { useLanguage, LANGUAGES } from '../../lib/i18n';
import { Logo } from '../../components/Logo';
import { DepositModal } from '../../components/DepositModal';

// Structural 1:1 port of the archive's components/voltex/top-nav.tsx (sticky
// h-16 header, flat text nav links, right-side language/avatar/logout
// cluster, xl-breakpoint burger drawer) — replacing the shared dark Nav on
// this page only, per the same settings-arctic-scoped approach as the rest
// of this port. Two real deviations from the archive, both load-bearing
// product features it never had to model rather than leftover old styling:
// the Deposit CTA (this exchange's highest-value action) and the Admin link
// (role-gated, rendered only for real admins). No notification bell — there
// is no notifications feature behind one here, and a bell that opens
// nothing would be a fake control. Logo/exchange name are the site's own
// Logo component, untouched, which is why it recolors correctly here for
// free (see Logo.tsx: every color already reads var(--text-primary) etc.).
const NAV_LINKS = [
  { to: '/markets', key: 'nav.markets' },
  { to: '/trade', key: 'nav.trade' },
  { to: '/futures', key: 'nav.futures' },
  { to: '/wallet', key: 'nav.wallet' },
  { to: '/copy-trading', key: 'nav.copyTrading' },
  { to: '/arbitrage', key: 'nav.arbitrage' },
] as const;

function navLinkClass(active: boolean) {
  return `rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
  }`;
}

export function ArcticTopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, setLang } = useLanguage();
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.getMe>> | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [tradeMenuOpen, setTradeMenuOpen] = useState(false);
  const tradeMenuCloseTimer = useRef<number | null>(null);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!getToken()) return;
    api.getMe().then(setMe).catch(() => {});
  }, []);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    if (!langOpen) return;
    function handler(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [langOpen]);

  useEffect(
    () => () => {
      if (tradeMenuCloseTimer.current) window.clearTimeout(tradeMenuCloseTimer.current);
    },
    []
  );

  function handleLogout() {
    clearToken();
    navigate('/');
  }

  const isAdmin = me?.isAdmin ?? false;
  const displayName = me ? me.displayName || me.email.split('@')[0] : '';
  const roleLabel = me ? (me.isAdmin ? t('settings.roleAdmin') : t('settings.roleUser')) : '';
  const currentLangLabel = LANGUAGES.find((l) => l.code === lang)?.label ?? lang.toUpperCase();

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link to="/trade" className="flex shrink-0 items-center">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 xl:flex">
            <button
              onClick={() => setShowDeposit(true)}
              className="mr-1 inline-flex items-center gap-1.5 rounded-lg bg-[#5edbf4] px-3.5 py-2 text-[12px] font-bold text-[#071217] transition-transform duration-150 hover:brightness-105 active:scale-[0.98]"
            >
              {t('wallet.deposit')}
              <ArrowUpRight className="size-[15px]" />
            </button>

            {NAV_LINKS.map((l) =>
              l.to === '/trade' ? (
                <div
                  key={l.to}
                  className="relative"
                  onMouseEnter={() => {
                    if (tradeMenuCloseTimer.current) window.clearTimeout(tradeMenuCloseTimer.current);
                    setTradeMenuOpen(true);
                  }}
                  onMouseLeave={() => {
                    tradeMenuCloseTimer.current = window.setTimeout(() => setTradeMenuOpen(false), 250);
                  }}
                >
                  <Link to={l.to} className={`inline-flex items-center gap-1 ${navLinkClass(location.pathname === l.to)}`}>
                    {t(l.key)}
                    <ChevronDown className="size-3 opacity-60" />
                  </Link>
                  {tradeMenuOpen && (
                    <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-xl border border-border bg-card p-1.5 shadow-premium-lg">
                      <Link to="/trade" className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 hover:bg-secondary">
                        <span className="text-[13px] font-semibold text-foreground">{t('trade.spotTab')}</span>
                        <span className="text-[11px] text-muted-foreground">{t('nav.tradeSpotDesc')}</span>
                      </Link>
                      <Link to="/trade?market=cfd" className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 hover:bg-secondary">
                        <span className="text-[13px] font-semibold text-foreground">{t('trade.cfdTab')}</span>
                        <span className="text-[11px] text-muted-foreground">{t('nav.tradeCfdDesc')}</span>
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                <Link key={l.to} to={l.to} className={navLinkClass(location.pathname === l.to)}>
                  {t(l.key)}
                </Link>
              )
            )}

            <Link to="/card" className={navLinkClass(location.pathname === '/card')}>
              {t('nav.card')}
            </Link>
            <Link to="/otc" className={navLinkClass(location.pathname === '/otc')}>
              {t('nav.otc')}
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                className={`ml-1 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors duration-150 ${
                  location.pathname === '/admin'
                    ? 'border-[#818cf8] bg-[#4f46e5]/[0.16] text-[#4338ca]'
                    : 'border-[#818cf8]/50 bg-[#4f46e5]/[0.08] text-[#4f46e5] hover:bg-[#4f46e5]/[0.14]'
                }`}
              >
                {t('nav.admin')}
              </Link>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <div ref={langRef} className="relative hidden sm:block">
              <button
                onClick={() => setLangOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                aria-label="Select language"
              >
                <Globe className="size-4" />
                {currentLangLabel}
                <ChevronDown className="size-3.5 opacity-60" />
              </button>
              {langOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 min-w-[110px] overflow-hidden rounded-lg border border-border bg-card shadow-premium-lg">
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => {
                        setLang(l.code);
                        setLangOpen(false);
                      }}
                      className={`block w-full px-4 py-2.5 text-left text-[13px] font-medium transition-colors hover:bg-secondary ${
                        l.code === lang ? 'text-brand' : 'text-foreground'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mx-1 hidden h-6 w-px bg-border sm:block" />

            <div className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 sm:pr-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-[13px] font-bold text-primary-foreground ring-1 ring-border">
                {displayName ? displayName.charAt(0).toUpperCase() : ''}
              </span>
              <span className="hidden leading-tight sm:block">
                <p className="text-[13px] font-medium text-foreground">{displayName}</p>
                <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="hidden size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground sm:flex"
              aria-label={t('nav.logout')}
            >
              <LogOut className="size-[18px]" />
            </button>

            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="flex size-9 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-secondary xl:hidden"
              aria-label={t('nav.menu')}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav className="border-t border-border bg-card px-4 py-3 xl:hidden">
            <button
              onClick={() => {
                setShowDeposit(true);
                setMobileOpen(false);
              }}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#5edbf4] px-3 py-2.5 text-[13px] font-bold text-[#071217]"
            >
              {t('wallet.deposit')}
              <ArrowUpRight className="size-[15px]" />
            </button>
            <div className="grid grid-cols-2 gap-1">
              {NAV_LINKS.map((l) => (
                <Link key={l.to} to={l.to} className="rounded-lg px-3 py-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  {t(l.key)}
                </Link>
              ))}
              <Link to="/card" className="rounded-lg px-3 py-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                {t('nav.card')}
              </Link>
              <Link to="/otc" className="rounded-lg px-3 py-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                {t('nav.otc')}
              </Link>
              {isAdmin && (
                <Link to="/admin" className="rounded-lg px-3 py-2.5 text-[14px] font-semibold text-[#4f46e5] transition-colors hover:bg-secondary">
                  {t('nav.admin')}
                </Link>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className={`rounded-lg px-3 py-2 text-[13px] font-medium ${l.code === lang ? 'text-brand' : 'text-muted-foreground'}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleLogout}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <LogOut className="size-4" /> {t('nav.logout')}
            </button>
          </nav>
        )}
      </header>
      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    </>
  );
}
