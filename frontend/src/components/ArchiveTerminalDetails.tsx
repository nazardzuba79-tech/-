import { Bell } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
export function ArchiveAccountActivity({ positions, orders }: { positions: number | null; orders: number | null }) {
  const { t } = useLanguage();
  return <details className="archive-account-activity">
    <summary aria-label={t('futures.positions')} title={t('futures.positions')}><Bell size={17} /></summary>
    <div className="archive-activity-popover">
      <strong>{t('futures.positions')} <b>{positions ?? '—'}</b></strong>
      <span>{t('trade.tabOpenOrders')} <b>{orders ?? '—'}</b></span>
    </div>
  </details>;
}
