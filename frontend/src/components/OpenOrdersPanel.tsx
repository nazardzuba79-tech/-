import { useEffect, useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { SpotOrdersView } from './SpotOrdersView';
import { cancelSpotOrders, spotOrderCancelIds, createSpotReadController, type SpotReadController, type SpotOrderRow } from './spotOrderPresentation';
import './SpotOrders.css';

export interface OpenOrdersHandle {
  cancelAll: () => Promise<void>;
}

/**
 * The reference's Open Orders table: Time, Pair, Type, Side, Price, Amount,
 * Filled, Total, Trigger, Action — rendered as its `.orders-table`.
 *
 * Behaviour is unchanged (4s poll, per-row cancel through the same
 * endpoint); it now also reports its row count so the tab can show the
 * reference's badge, and exposes cancelAll for the reference's "Cancel All"
 * action, which loops the same per-order endpoint rather than needing a new
 * one.
 */
export const OpenOrdersPanel = forwardRef<OpenOrdersHandle, { pair: string; refreshKey: number; onCount?: (n: number) => void }>(
  function OpenOrdersPanel({ pair, refreshKey, onCount }, ref) {
    const { t, lang } = useLanguage();
    const toast = useToast();
    const [orders, setOrders] = useState<SpotOrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const [cancelling, setCancelling] = useState(false);
    const cancelInFlight = useRef(false);
    const reader = useRef<SpotReadController | null>(null);
    if (!reader.current) reader.current = createSpotReadController(() => api.getMyOrders('PENDING_TRIGGER,OPEN,PARTIALLY_FILLED'), {
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

    useEffect(() => {
      onCount?.(pairOrders.length);
    }, [pairOrders.length, onCount]);

    async function handleCancel(orderId: string) {
      if (cancelInFlight.current) return;
      cancelInFlight.current = true;
      setCancelling(true);
      setCancellingId(orderId);
      try {
        await api.cancelOrder(orderId);
        await load(true);
        toast.success(t('trade.orderCancelled'));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t('trade.cancelOrderError'));
      } finally {
        cancelInFlight.current = false;
        setCancelling(false);
        setCancellingId(null);
      }
    }

    useImperativeHandle(
      ref,
      () => ({
        async cancelAll() {
          if (cancelInFlight.current || pairOrders.length === 0) return;
          cancelInFlight.current = true;
          setCancelling(true);
          // Sequential rather than parallel: these all hit the same account
          // and the same book, and a burst of concurrent cancels is exactly
          // the shape a rate limiter rejects.
          try {
            const result = await cancelSpotOrders(spotOrderCancelIds(pairOrders), id => api.cancelOrder(id));
            await load(true);
            if (result.failed) toast.error(t('trade.cancelOrderError'));
            else toast.success(t('trade.orderCancelled'));
          } finally {
            cancelInFlight.current = false;
            setCancelling(false);
          }
        },
      }),
      [pairOrders, load, toast, t]
    );

    return <SpotOrdersView orders={pairOrders} loading={loading} error={failed ? t('trade.loadOrdersError') : null}
      cancelling={cancelling} cancellingId={cancellingId} locale={localeOf(lang)} t={t} onCancel={handleCancel} onRetry={() => { void load(true); }} />;
  }
);
