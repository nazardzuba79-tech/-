import { useEffect } from 'react';
import { useVtaSpotAccount } from '../lib/useVtaSpotAccount';
import { useLanguage, localeOf } from '../lib/i18n';
import { SpotAssetsView, SpotOrdersView } from './SpotOrdersView';
import type { SpotOrderRow } from './spotOrderPresentation';

/** Same Spot tables, with the private account as the data source. */
export function VtaSpotPanels({ history = false, refreshKey }: { history?: boolean; refreshKey: number }) {
  const { t, lang } = useLanguage();
  const account = useVtaSpotAccount(true);
  useEffect(() => { if (refreshKey > 0) void account.refresh(); }, [refreshKey, account.refresh]);
  const retry = () => { void account.refresh(); };
  if (!history) return <SpotAssetsView balances={account.snapshot?.balances ?? []}
    loading={account.loading} refreshing={false} error={account.failed ? t('trade.loadAssetsError') : null} t={t} onRetry={retry} />;
  const orders: SpotOrderRow[] = (account.snapshot?.sales ?? []).map(sale => ({
    id: sale.id, pair: 'VTA/USDT', side: 'SELL', type: 'MARKET', price: sale.price,
    originalQuantity: sale.quantity, remainingQuantity: '0', status: 'FILLED',
    triggerPrice: null, ocoGroupId: null, createdAt: sale.createdAt,
  }));
  return <SpotOrdersView orders={orders} loading={account.loading} refreshing={false}
    error={account.failed ? t('trade.loadOrdersError') : null} history locale={localeOf(lang)} t={t} onRetry={retry} />;
}
