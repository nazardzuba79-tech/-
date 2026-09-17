import { CrownIcon } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';

/**
 * The account's tier mark, beside the headline total.
 *
 * Rendered ONLY for the owner's Cross margin account: that is the one account
 * VOLTEX has actually granted a tier to. An ordinary ledger has no tier and
 * gets nothing here — not a lower badge, not a placeholder — because a tier
 * label is a claim about the account, and the page does not invent one.
 *
 * Gold on gold: the approved design's own accent, with a crown rather than a
 * number, since "Super VIP" is a name and not a level in a ladder.
 */
export function TierBadge({ mode }: { mode: 'CROSS' | 'SPOT' | undefined }) {
  const { t } = useLanguage();
  if (mode !== 'CROSS') return null;
  return (
    <span className="wallet-tier-badge" title={t('wallet.superVipTitle')} data-tier="super-vip">
      <CrownIcon className="wallet-tier-badge-icon h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      <span className="wallet-tier-badge-label">{t('wallet.superVip')}</span>
      <i className="wallet-tier-badge-shine" aria-hidden="true" />
    </span>
  );
}
