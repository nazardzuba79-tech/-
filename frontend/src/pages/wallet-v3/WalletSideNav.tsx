import { BarChart3Icon, LayoutGridIcon, ListOrderedIcon, PiggyBankIcon, WalletIcon } from 'lucide-react';
import { Key, useLanguage } from '../../lib/i18n';

/**
 * THE WALLET'S OWN NAVIGATION.
 *
 * Inside the Wallet workspace, beside its content — it does not replace or
 * duplicate the global VOLTEX top navigation, and it never routes away from
 * `/wallet`. Each item switches the section rendered to its right.
 *
 * An item is only clickable when there is something real behind it. VOLTEX
 * has one account surface and no separate funding account, so `Обзор` and
 * `Финансирование` are rendered DISABLED with a reason rather than wired to
 * an invented page — the same rule the Convert action follows. When those
 * surfaces exist, they become live by flipping one flag here.
 */

export type WalletSection = 'unified' | 'pnl' | 'orders';

interface Item {
  id: WalletSection | 'overview' | 'funding';
  label: Key;
  icon: typeof WalletIcon;
  live: boolean;
}

const ITEMS: Item[] = [
  { id: 'overview', label: 'wallet.navOverview', icon: LayoutGridIcon, live: false },
  { id: 'funding', label: 'wallet.navFunding', icon: PiggyBankIcon, live: false },
  { id: 'unified', label: 'wallet.navUnified', icon: WalletIcon, live: true },
  { id: 'pnl', label: 'wallet.navPnl', icon: BarChart3Icon, live: true },
  { id: 'orders', label: 'wallet.navOrders', icon: ListOrderedIcon, live: true },
];

const ITEM_BASE =
  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-w px-3 py-2 text-[13px] transition-colors duration-150 ease-exp lg:w-full';
const ITEM_ON = 'bg-panel-3 font-semibold text-ink';
const ITEM_IDLE = 'font-medium text-ink-3 hover:bg-panel-2 hover:text-ink';
const ITEM_OFF = 'wallet-nav-off cursor-not-allowed font-medium text-ink-4';

export function WalletSideNav({
  section,
  onSection,
}: {
  section: WalletSection;
  onSection: (next: WalletSection) => void;
}) {
  const { t } = useLanguage();

  return (
    <nav className="wallet-side-nav" aria-label={t('wallet.navSection')}>
      {ITEMS.map((item) => {
        const active = item.live && item.id === section;
        const state = active ? ITEM_ON : item.live ? ITEM_IDLE : ITEM_OFF;
        return (
          <button
            key={item.id}
            type="button"
            disabled={!item.live}
            aria-current={active ? 'page' : undefined}
            title={item.live ? undefined : t('wallet.navUnavailable')}
            onClick={item.live ? () => onSection(item.id as WalletSection) : undefined}
            className={ITEM_BASE + ' ' + state}
          >
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
            {t(item.label)}
          </button>
        );
      })}
    </nav>
  );
}
