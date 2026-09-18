import { BarChart3Icon, CreditCardIcon, LayoutGridIcon, ListOrderedIcon, MoonIcon, PiggyBankIcon, SunIcon, WalletIcon, ArrowRightIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Key, useLanguage } from '../../lib/i18n';
import { WalletTheme } from './useWalletTheme';

/**
 * THE WALLET'S OWN NAVIGATION.
 *
 * Inside the Wallet workspace, beside its content — it does not replace or
 * duplicate the global VOLTEX top navigation. Every section item is a button
 * that switches the section rendered to its right and never routes away
 * from `/wallet`.
 *
 * Every item has a real section behind it now: `Обзор` is the account
 * overview (balances, allocation, performance, recent activity) and
 * `Финансирование` is the spot ledger — the account deposits land on and
 * withdrawals leave from. The one deliberate exception to "never routes
 * away" is the VoLtex Card tile at the bottom of the list: it is a link to
 * the Crypto Card page, styled as the approved design's card tile, and it is
 * the only anchor in this file.
 */

export type WalletSection = 'overview' | 'funding' | 'unified' | 'pnl' | 'orders';

interface Item {
  id: WalletSection;
  label: Key;
  icon: typeof WalletIcon;
}

const ACCOUNT_ITEMS: Item[] = [
  { id: 'overview', label: 'wallet.navOverview', icon: LayoutGridIcon },
  { id: 'funding', label: 'wallet.navFunding', icon: PiggyBankIcon },
  { id: 'unified', label: 'wallet.navUnified', icon: WalletIcon },
];
const ANALYSIS_ITEMS: Item[] = [{ id: 'pnl', label: 'wallet.navPnl', icon: BarChart3Icon }];
const ORDER_ITEMS: Item[] = [{ id: 'orders', label: 'wallet.navOrders', icon: ListOrderedIcon }];

const ITEM_BASE =
  'wallet-nav-item flex shrink-0 items-center gap-3 whitespace-nowrap rounded-w px-3 py-2.5 text-[13px] transition-colors duration-150 ease-exp lg:w-full';
const ITEM_ON = 'bg-gold-wash font-semibold text-ink';
const ITEM_IDLE = 'font-medium text-ink-3 hover:bg-panel-3 hover:text-ink';

function Items({ items, section, onSection }: { items: Item[]; section: WalletSection; onSection: (next: WalletSection) => void }) {
  const { t } = useLanguage();
  return (
    <>
      {items.map((item) => {
        const active = item.id === section;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSection(item.id)}
            className={ITEM_BASE + ' ' + (active ? ITEM_ON : ITEM_IDLE)}
          >
            <item.icon className={`h-[17px] w-[17px] shrink-0 ${active ? 'text-gold-deep' : ''}`} strokeWidth={1.7} aria-hidden="true" />
            {t(item.label)}
          </button>
        );
      })}
    </>
  );
}

export function WalletSideNav({
  section,
  onSection,
  theme,
  onToggleTheme,
}: {
  section: WalletSection;
  onSection: (next: WalletSection) => void;
  theme: WalletTheme;
  onToggleTheme: () => void;
}) {
  const { t } = useLanguage();

  return (
    <nav className="wallet-side-nav" aria-label={t('wallet.navSection')}>
      {/* The approved design's brand block: the wordmark with its gold L,
          and the product line under it. Decorative for the sidebar only —
          the global header keeps the app's own logo. */}
      {/* The workspace's own title. The page no longer prints a separate
          `Кошелёк` heading above the shell: the wordmark and its product
          line say where the reader is, at every width. */}
      <div className="wallet-brand">
        <p className="wallet-brand-name">
          VO<b>L</b>TEX
        </p>
        <p className="wallet-brand-sub">{t('wallet.brandTagline')}</p>
      </div>

      <div className="wallet-nav-group">
        <Items items={ACCOUNT_ITEMS} section={section} onSection={onSection} />
      </div>
      <div className="wallet-nav-group wallet-nav-group-rule">
        <span className="wallet-nav-label hidden lg:block">{t('wallet.navAnalysis')}</span>
        <Items items={ANALYSIS_ITEMS} section={section} onSection={onSection} />
      </div>
      <div className="wallet-nav-group wallet-nav-group-rule">
        <Items items={ORDER_ITEMS} section={section} onSection={onSection} />
        <Link to="/card" className="wallet-card-link" title={t('wallet.cardLinkTitle')}>
          <span className="wallet-card-link-body">
            <CreditCardIcon className="h-[17px] w-[17px] shrink-0 text-gold" strokeWidth={1.8} aria-hidden="true" />
            <span className="wallet-card-link-label">
              Vo<b>L</b>tex Card
            </span>
            <ArrowRightIcon className="wallet-card-link-arrow h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          </span>
          <i className="wallet-card-link-glow" aria-hidden="true" />
        </Link>
      </div>

      <div className="wallet-side-foot">
        <button
          type="button"
          onClick={onToggleTheme}
          className="wallet-theme-btn"
          aria-pressed={theme === 'dark'}
          title={t('wallet.themeToggle')}
        >
          {theme === 'dark' ? (
            <SunIcon className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
          ) : (
            <MoonIcon className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
          )}
          <span>{t(theme === 'dark' ? 'wallet.themeLight' : 'wallet.themeDark')}</span>
        </button>
      </div>
    </nav>
  );
}
