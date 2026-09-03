import { Link } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { Key, useLanguage } from '../../lib/i18n';

/**
 * Compact four-column footer. Product links point at routes that actually
 * exist in this app — no Earn, no P2P, and CFD only as the Trade page's
 * own market tab rather than a route of its own. No social icon row, no
 * app-store badges.
 */
const COLUMNS: { titleKey: Key; links: { labelKey: Key; to: string }[] }[] = [
  {
    titleKey: 'home.footer.products',
    links: [
      { labelKey: 'trade.spotTab', to: '/trade' },
      { labelKey: 'nav.futures', to: '/futures' },
      { labelKey: 'nav.copyTrading', to: '/copy-trading' },
      { labelKey: 'nav.arbitrage', to: '/arbitrage' },
      { labelKey: 'nav.card', to: '/card' },
      { labelKey: 'nav.otc', to: '/otc' },
    ],
  },
  {
    titleKey: 'home.footer.company',
    links: [
      { labelKey: 'nav.markets', to: '/markets' },
      { labelKey: 'nav.wallet', to: '/wallet' },
      { labelKey: 'nav.settings', to: '/settings' },
    ],
  },
  {
    titleKey: 'home.footer.support',
    links: [
      { labelKey: 'home.footer.helpCenter', to: '/settings' },
      { labelKey: 'home.footer.contact', to: '/settings' },
    ],
  },
  {
    titleKey: 'home.footer.legal',
    links: [
      { labelKey: 'home.footer.terms', to: '/legal/terms' },
      { labelKey: 'home.footer.privacy', to: '/legal/privacy' },
      { labelKey: 'home.footer.risk', to: '/legal/risk' },
    ],
  },
];

export function HomeFooter() {
  const { t } = useLanguage();
  return (
    <footer className="mt-4 border-t border-white/6 bg-[#05070a]">
      <div className="mx-auto w-full max-w-[1460px] px-6 py-9">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <div className="col-span-2 md:col-span-1">
            <Logo />
            <p className="mt-3 max-w-[260px] text-[12px] leading-relaxed text-home-muted">
              {t('home.footer.tagline')}
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.titleKey}>
              <div className="mb-3 text-[12px] font-semibold text-white">{t(col.titleKey)}</div>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.labelKey}>
                    <Link
                      to={l.to}
                      className="text-[12px] text-home-muted transition-colors duration-150 hover:text-white"
                    >
                      {t(l.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-white/6 pt-5 text-[11.5px] text-faint">
          {/* Current year, read at render — never a hardcoded one. */}
          <span>© {new Date().getFullYear()} VOLTEX. {t('home.footer.rights')}</span>
          <span className="ml-auto max-w-[620px] leading-relaxed">
            {t('home.footer.riskNote')}
          </span>
        </div>
      </div>
    </footer>
  );
}
