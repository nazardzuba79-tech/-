import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { customerErrorText } from '../lib/customerError';
import { SpotAssetsView, SpotOrdersView } from './SpotOrdersView';
import { cancelSpotOrders, createSpotReadController, startVisibleReadPolling, type SpotOrderRow, type SpotReadController } from './spotOrderPresentation';
import type { OpenOrdersHandle } from './OpenOrdersPanel';
import type { DemoLedgerMode } from '../lib/demoSpot';
import './SpotOrders.css';

type DemoOrder = Awaited<ReturnType<typeof api.getDemoOpenOrders>>[number];
const row = (o: DemoOrder): SpotOrderRow => ({ ...o, triggerPrice: null, ocoGroupId: null });

/** The same reader/poll pattern as the ordinary Spot panels. A 'silent'
 * account has nothing on the demo ledger, so nothing is requested. */
function useDemoRows<T>(mode: DemoLedgerMode, request: () => Promise<T[]>, refreshKey: number) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(mode === 'trader');
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const reader = useRef<SpotReadController | null>(null);
  if (!reader.current) reader.current = createSpotReadController(() => request(), {
    started: () => setRefreshing(true), accept: next => { setRows(next); setFailed(false); }, reject: () => setFailed(true),
    settled: () => { setLoading(false); setRefreshing(false); },
  });
  const load = useCallback((fresh = false) => reader.current!.read(fresh), []);
  useEffect(() => {
    if (mode !== 'trader') return;
    reader.current!.resume();
    const stop = startVisibleReadPolling(load, 4000);
    return () => { stop(); reader.current!.pause(); };
  }, [mode, load, refreshKey]);
  return { rows, loading, refreshing, failed, load };
}

/** Open orders (or, with `history`, finished ones) on the demo ledger, in the ordinary Spot table. */
export const DemoSpotOrders = forwardRef<OpenOrdersHandle, {
  mode: DemoLedgerMode; pair: string; refreshKey: number; history?: boolean;
  onCount?: (n: number | null) => void; onAccountCount?: (n: number | null) => void;
}>(function DemoSpotOrders({ mode, pair, refreshKey, history = false, onCount, onAccountCount }, ref) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const orders = useDemoRows(mode, () => (history ? api.getDemoOrderHistory() : api.getDemoOpenOrders()).then(list => list.map(row)), refreshKey);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const inFlight = useRef(false);
  const pairOrders = orders.rows.filter(o => o.pair === pair);
  useEffect(() => { if (!history) onCount?.(orders.loading || orders.failed ? null : pairOrders.length); }, [history, pairOrders.length, orders.loading, orders.failed, onCount]);
  useEffect(() => { if (!history) onAccountCount?.(orders.loading || orders.failed ? null : orders.rows.length); }, [history, orders.rows, orders.loading, orders.failed, onAccountCount]);

  async function cancel(ids: string[]) {
    if (inFlight.current || ids.length === 0) return;
    inFlight.current = true; setCancelling(true); setCancellingId(ids.length === 1 ? ids[0] : null);
    try {
      const result = await cancelSpotOrders(ids, id => api.cancelDemoOrder(id));
      await orders.load(true);
      if (result.failed) toast.error(t('trade.cancelOrderError')); else toast.success(t('trade.orderCancelled'));
    } catch (err) {
      toast.error(customerErrorText(err, t, t('trade.cancelOrderError')));
    } finally { inFlight.current = false; setCancelling(false); setCancellingId(null); }
  }
  useImperativeHandle(ref, () => ({ cancelAll: () => cancel(pairOrders.map(o => o.id)) }), [pairOrders]);

  return <SpotOrdersView orders={pairOrders} loading={orders.loading} refreshing={orders.refreshing} error={orders.failed ? t('trade.loadOrdersError') : null}
    history={history} cancelling={cancelling} cancellingId={cancellingId} locale={localeOf(lang)} t={t}
    onCancel={history ? undefined : id => { void cancel([id]); }} onRetry={() => { void orders.load(true); }} />;
});

/** Balances on the demo ledger, in the ordinary Spot assets table. */
export function DemoSpotAssets({ mode, refreshKey }: { mode: DemoLedgerMode; refreshKey: number }) {
  const { t } = useLanguage();
  const balances = useDemoRows(mode, () => api.getDemoBalances(), refreshKey);
  return <SpotAssetsView balances={balances.rows} loading={balances.loading} refreshing={balances.refreshing}
    error={balances.failed ? t('trade.loadAssetsError') : null} t={t} onRetry={() => { void balances.load(true); }} />;
}
