import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, Globe, LogOut, Menu, X } from 'lucide-react';
import { api, clearToken, getToken } from '../../lib/api';
import { useLanguage, LANGUAGES } from '../../lib/i18n';
import { Logo } from '../../components/Logo';

// Literal port of the archive's components/voltex/top-nav.tsx — same
// markup/Tailwind classes, same flat nav-item row (no dropdown on any
// item, no CTA button, no role-gated extras), same right-side cluster
// (language, notification bell, avatar+name+role, logout), same
// xl-breakpoint burger drawer. Renders instead of the shared dark Nav on
// this page only; every other page keeps that Nav unchanged, so nothing
// that lived only there (Deposit CTA, Admin link) is actually lost — it's
// just not duplicated on this one header, matching the archive as-is.
//
// Three unavoidable technical substitutions, not design choices:
//   - next/link -> react-router's Link, real routes instead of href="#".
//   - the archive's <img src="/avatar-ksenia.png"> -> an initials circle,
//     since no real user has a photo (same fallback ProfileHeaderCard
//     already uses elsewhere on this page).
//   - the archive's language button and notification bell are static
//     markup with no handler in the archive itself (it's a design mock).
//     The bell stays exactly as inert here, matching it 1:1. The language
//     button is wired to the site's real i18n instead of staying dead,
//     since language switching already works from every other page's
//     header and leaving the exact same button dead only here would be a
//     regression, not fidelity.
// No "AI Bots" item — the archive has one, but this app has no live page
// behind that label (only a "coming soon" teaser used elsewhere), so
// there's no real destination to link it to.
const NAV_ITEMS = [
  { to: '/markets', key: 'nav.markets' },
  { to: '/trade', key: 'nav.trade' },
  { to: '/futures', key: 'nav.futures' },
  { to: '/wallet', key: 'nav.wallet' },
  { to: '/copy-trading', key: 'nav.copyTrading' },
  { to: '/arbitrage', key: 'nav.arbitrage' },
  { to: '/card', key: 'nav.card' },
  { to: '/otc', key: 'nav.otc' },
] as const;

export function ArcticTopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, setLang } = useLanguage();
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.getMe>> | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
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

  function handleLogout() {
    clearToken();
    navigate('/');
  }

  const displayName = me ? me.displayName || me.email.split('@')[0] : '';
  const roleLabel = me ? (me.isAdmin ? t('settings.roleAdmin') : t('settings.roleUser')) : '';
  const currentLangLabel = LANGUAGES.find((l) => l.code === lang)?.label ?? lang.toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link to="/trade" className="flex shrink-0 items-center">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 xl:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                location.pathname === item.to ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(item.key)}
            </Link>
          ))}
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

          <button
            className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            aria-label="Notifications"
          >
            <Bell className="size-[18px]" />
            <span className="absolute right-2 top-2 size-1.5 rounded-full bg-brand ring-2 ring-card" />
          </button>

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
          <div className="grid grid-cols-2 gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-lg px-3 py-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {t(item.key)}
              </Link>
            ))}
          </div>
          <button
            onClick={handleLogout}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="size-4" /> {t('nav.logout')}
          </button>
        </nav>
      )}
    </header>
  );
}
