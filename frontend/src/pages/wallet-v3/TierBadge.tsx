import { CrownIcon } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';

/**
 * The account's tier mark, beside the headline total.
 *
 * Rendered ONLY when the authenticated server response explicitly grants the
 * owner's tier. Account mode, role, email and browser storage are not enough:
 * a tier label is a claim about the account, and the page does not invent one.
 *
 * Gold on gold: the approved design's own accent, with a crown rather than a
 * number, since "Supreme VIP" is a name and not a level in a ladder.
 */
export function TierBadge({ tier }: { tier: 'SUPREME_VIP' | null | undefined }) {
  const { t } = useLanguage();
  if (tier !== 'SUPREME_VIP') return null;
  return (
    <span className="wallet-tier-badge" title={t('wallet.superVipTitle')} data-tier="super-vip">
      <CrownIcon className="wallet-tier-badge-icon h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      <span className="wallet-tier-badge-label">{t('wallet.superVip')}</span>
      <i className="wallet-tier-badge-shine" aria-hidden="true" />
    </span>
  );
}
