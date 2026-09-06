import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';

import { SpotOrdersView } from './SpotOrdersView';
import { createSpotReadController, type SpotReadController, type SpotOrderRow } from './spotOrderPresentation';
import './SpotOrders.css';

/**
 * Order history in the reference's `.orders-table` — same table shape the
 * Open Orders tab uses, since the reference gives every bottom-panel tab
 * one table style.
 *
 * Data and polling are unchanged from before.
 */
export function OrderHistoryPanel({ pair, refreshKey }: { pair: string; refreshKey: number }) {
  const { t, lang } = useLanguage();
  const [orders, setOrders] = useState<SpotOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reader = useRef<SpotReadController | null>(null);
  if (!reader.current) reader.current = createSpotReadController(() => api.getMyOrders('FILLED,CANCELLED'), {
    accept: rows => { setOrders(rows); setFailed(false); }, reject: () => setFailed(true), settled: () => setLoading(false),
  });
  const load = useCallback((fresh = false) => reader.current!.read(fresh), []);

  useEffect(() => {
    reader.current!.resume();
    void load(true);
    const interval = setInterval(load, 4000);
    return () => { clearInterval(interval); reader.current!.pause(); };
  }, [load, refreshKey]);

  const pairOrders = orders.filter((o) => o.pair === pair);

  return <SpotOrdersView orders={pairOrders} loading={loading} error={failed ? t('trade.loadOrdersError') : null}
    history locale={localeOf(lang)} t={t} onRetry={() => { void load(true); }} />;
}
