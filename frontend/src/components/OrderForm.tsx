import { browserSetInterval, browserClearInterval } from '../lib/browserActivity';
import { useState, useEffect, useRef, FormEvent } from 'react';
import { api, ApiError, getToken, onSessionChange } from '../lib/api';
import { onSpendableBalancesChanged } from '../lib/balanceInvalidation';
import { readVtaIntent, prepareVtaIntent, clearVtaIntent, withVtaSaleLock } from '../lib/vtaSaleIntent';
import { useVtaSpotAccount } from '../lib/useVtaSpotAccount';
import { useMarketTicker } from '../lib/useMarketData';
import { useLanguage } from '../lib/i18n';
import { formatPrice, formatAmount, formatCompact } from '../lib/formatNumber';
import { formatSpotBookNumber } from '../lib/spotOrderBook';
import { useToast } from '../lib/toast';
import { parseChangePercent } from '../lib/priceChange';
import { positiveOrderNumber, orderFundingPrice, balancePercentageQuantity } from '../lib/spotOrderEntry';
import { spotOrderFeedback, type SpotOrderFeedback } from '../lib/spotOrderFeedback';
import { customerErrorText } from '../lib/customerError';
import { isManagedTradablePair, isTestMarketPair } from '../lib/testMarkets';

type OrderFamily = 'LIMIT' | 'MARKET' | 'STOP' | 'TAKE_PROFIT' | 'OCO';
type Execution = 'LIMIT' | 'MARKET';
export interface PickedPrice {
  value: string;
  pair?: string;
  /** Bumped on every pick so clicking the same level twice still applies. */
  seq: number;
}

export function OrderForm({
  pair,
  onPlaced,
  pickedPrice,
  refreshKey = 0,
}: {
  pair: string;
  onPlaced: () => void;
  pickedPrice?: PickedPrice | null;
  refreshKey?: number;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const [baseAsset, quoteAsset] = pair.split('/');
  const privateNrx = pair.toUpperCase() === 'NRX/USDT';
  // Both built-in private simulations use DemoBalance, never ordinary funds.
  const privateVta = pair.toUpperCase() === 'VTA/USDT' || privateNrx;
  const vta = useVtaSpotAccount(privateVta, pair);
  const intentAccountId = vta.snapshot?.account.id ? (privateNrx ? `${vta.snapshot.account.id}:NRX` : vta.snapshot.account.id) : undefined;
  const vtaPending = useRef<{ requestId: string; quantity: string } | null>(null);
  const [vtaUnconfirmed, setVtaUnconfirmed] = useState(false);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [family, setFamily] = useState<OrderFamily>('LIMIT');
  const [execution, setExecution] = useState<Execution>('LIMIT');
  const [price, setPrice] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [ocoTakeProfitPrice, setOcoTakeProfitPrice] = useState('');
  const [ocoStopTriggerPrice, setOcoStopTriggerPrice] = useState('');
  const [ocoStopLimitPrice, setOcoStopLimitPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [percent, setPercent] = useState(0);
  const [available, setAvailable] = useState<{ base: number; quote: number }>({ base: 0, quote: 0 });
  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [marketStats, setMarketStats] = useState<{
    changePercent24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    quoteVolume24h: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [balanceReady, setBalanceReady] = useState(false);
  const [balanceError, setBalanceError] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceVersion, setBalanceVersion] = useState(0);
  useEffect(() => onSpendableBalancesChanged(() => {
    if (privateVta) return;
    setBalanceReady(false);
    setBalanceVersion(version => version + 1);
  }), [privateVta]);
  // Managed listings keep their existing path; NRX now takes the private
  // simulation branch below, with no fallback to api.placeOrder.
  const notTradingYet = isTestMarketPair(pair) && pair.toUpperCase() !== 'NRX/USDT' && !isManagedTradablePair(pair) && !(privateVta && vta.snapshot && marketPrice) && !vtaUnconfirmed;
  const vtaLocked = privateVta && (submitting || vtaUnconfirmed);
  useEffect(() => onSessionChange(() => {
    if (!privateVta) return;
    vtaPending.current = null; setVtaUnconfirmed(false); setQuantity(''); setError(null);
  }), [privateVta]);
  useEffect(() => {
    const accountId = intentAccountId;
    if (!privateVta || !accountId) return;
    const token = getToken(); let disposed = false;
    const current = () => !disposed && getToken() === token;
    const recover = async () => {
      try {
        const pending = readVtaIntent(accountId);
        if (!current()) return;
        vtaPending.current = pending; setVtaUnconfirmed(!!pending);
        if (!pending) return;
        setSide('SELL'); setFamily('MARKET'); setQuantity(pending.quantity); setError(t('trade.orderStatusUnconfirmed'));
        // Recovery is a GET only. Missing/failed lookup keeps the same intent.
        const result = privateNrx ? await vta.getSale(pending.requestId) : await api.getVtaSale(pending.requestId);
        if (!current() || vtaPending.current?.requestId !== pending.requestId) return;
        if (result.receipt) {
          clearVtaIntent(accountId, pending.requestId);
          vtaPending.current = null; setVtaUnconfirmed(false); setQuantity(''); setError(null);
          void vta.refresh();
        }
      } catch { if (current()) setError(t('trade.orderStatusUnconfirmed')); }
    };
    void recover();
    const changed = (event: StorageEvent) => {
      if (event.key === 'exchange_token') { disposed = true; vtaPending.current = null; setVtaUnconfirmed(false); setQuantity(''); return; }
      if (event.key === 'voltex:vta-sale:v1:' + accountId) { void recover(); void vta.refresh(); }
    };
    window.addEventListener('storage', changed);
    return () => { disposed = true; window.removeEventListener('storage', changed); };
  }, [privateVta, privateNrx, intentAccountId]);
  useEffect(() => {
    if (!privateVta) return;
    setAvailable({
      base: Number(vta.snapshot?.balances.find(b => b.asset === baseAsset)?.available ?? 0),
      quote: Number(vta.snapshot?.balances.find(b => b.asset === 'USDT')?.available ?? 0),
    });
    setBalanceReady(!!vta.snapshot); setBalanceError(vta.failed); setBalanceLoading(vta.loading);
  }, [privateVta, baseAsset, vta.snapshot, vta.failed, vta.loading]);

  const isConditional = family === 'STOP' || family === 'TAKE_PROFIT';
  const type: 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_LIMIT' | 'TAKE_PROFIT_MARKET' =
    family === 'LIMIT'
      ? 'LIMIT'
      : family === 'MARKET'
      ? 'MARKET'
      : family === 'STOP'
      ? execution === 'LIMIT'
        ? 'STOP_LIMIT'
        : 'STOP_MARKET'
      : execution === 'LIMIT'
      ? 'TAKE_PROFIT_LIMIT'
      : 'TAKE_PROFIT_MARKET';

  useEffect(() => {
    if (!pickedPrice || (pickedPrice.pair && pickedPrice.pair !== pair)) return;
    setPrice(pickedPrice.value);
    setFamily('LIMIT');
    setExecution('LIMIT');
  }, [pickedPrice, pair, privateVta]);

  useEffect(() => {
    let cancelled = false;
    if (privateVta) return;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      setBalanceLoading(true);
      await api
      .getBalances()
      .then((balances) => {
        if (cancelled) return;
        const base = balances.find((b) => b.asset === baseAsset);
        const quote = balances.find((b) => b.asset === quoteAsset);
        setAvailable({ base: base ? parseFloat(base.available) : 0, quote: quote ? parseFloat(quote.available) : 0 });
        setBalanceReady(true);
        setBalanceError(false);
      })
      .catch(() => { if (!cancelled) setBalanceError(true); })
      .finally(() => { pending = false; if (!cancelled) setBalanceLoading(false); });
    }
    void load();
    const timer = browserSetInterval(load, 4000);
    return () => { cancelled = true; browserClearInterval(timer); };
  }, [baseAsset, quoteAsset, side, refreshKey, balanceVersion, privateVta]);

  const { ticker: referenceTicker } = useMarketTicker(pair, 5000);
  useEffect(() => {
    if (!referenceTicker) { if (privateVta) { setMarketPrice(null); setMarketStats(null); } return; }
    setMarketPrice(positiveOrderNumber(referenceTicker.lastPrice));
    setMarketStats({
      changePercent24h: parseChangePercent(referenceTicker.changePercent24h, pair),
      high24h: parseFloat(referenceTicker.high24h),
      low24h: parseFloat(referenceTicker.low24h),
      volume24h: parseFloat(referenceTicker.volume24h),
      quoteVolume24h: parseFloat(referenceTicker.quoteVolume24h),
    });
    return;
  }, [pair, referenceTicker, privateVta]);

  const effectivePrice =
    family === 'OCO' ? Math.max(Number(ocoTakeProfitPrice) || 0, Number(ocoStopLimitPrice) || 0) :
    family === 'LIMIT' || (isConditional && execution === 'LIMIT') ? positiveOrderNumber(price) ?? 0 : marketPrice ?? 0;
  const total = effectivePrice && quantity ? (effectivePrice * parseFloat(quantity)).toFixed(2) : '0.00';

  function applyPercent(pct: number) {
    if (!balanceReady || balanceError || vtaLocked) return;
    setPercent(pct);
    if (side === 'BUY') {
      const funding = orderFundingPrice(family, execution, price, triggerPrice, ocoTakeProfitPrice, ocoStopLimitPrice, marketPrice);
      setQuantity(balancePercentageQuantity(available.quote, pct, funding));
    } else {
      if (privateVta && pct === 100) {
        setQuantity(vta.snapshot?.balances.find(b => b.asset === baseAsset)?.available ?? '0');
      } else {
        setQuantity(balancePercentageQuantity(available.base, pct));
      }
    }
  }

  function triggerHint(kind: 'STOP' | 'TAKE_PROFIT'): string | null {
    if (!marketPrice) return null;
    const mustBeBelow = (kind === 'STOP' && side === 'SELL') || (kind === 'TAKE_PROFIT' && side === 'BUY');
    return mustBeBelow
      ? t('trade.triggerMustBeBelow', { price: marketPrice })
      : t('trade.triggerMustBeAbove', { price: marketPrice });
  }

  function resetFields() {
    setPrice('');
    setTriggerPrice('');
    setOcoTakeProfitPrice('');
    setOcoStopTriggerPrice('');
    setOcoStopLimitPrice('');
    setQuantity('');
    setPercent(0);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    if (privateVta && (side === 'BUY' || family !== 'MARKET')) {
      const message = t(side === 'BUY' ? 'trade.assetPurchaseUnavailable' : 'trade.assetOrderTypeUnavailable');
      setError(message); toast.error(message); return;
    }
    if (privateNrx && !vta.snapshot) {
      const message = t('trade.loadAssetsError'); setError(message); toast.error(message); return;
    }
    if (notTradingYet) {
      const message = t('trade.assetNotTradingYet');
      setError(message);
      toast.error(message);
      return;
    }
    const requiredValues = [quantity, ...(family === 'OCO' ? [ocoTakeProfitPrice, ocoStopTriggerPrice, ocoStopLimitPrice] : [
      ...(family === 'LIMIT' || (isConditional && execution === 'LIMIT') ? [price] : []),
      ...(isConditional ? [triggerPrice] : []),
    ])];
    if (requiredValues.some(value => positiveOrderNumber(value) === null)) {
      setError(t('trade.positiveInputRequired'));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const session = getToken();
    try {
      let feedback: SpotOrderFeedback = { kind: 'placed' };
      if (privateVta) {
        if (side !== 'SELL' || family !== 'MARKET' || (!vta.snapshot && !vtaPending.current)) return;
        const accountId = intentAccountId;
        if (!accountId) return;
        await withVtaSaleLock(accountId, async () => {
          if (getToken() !== session) return;
          const existed = readVtaIntent(accountId) !== null;
          const pending = prepareVtaIntent(accountId, quantity);
          vtaPending.current = pending; setVtaUnconfirmed(true); setQuantity(pending.quantity);
          try {
            if (privateNrx) await vta.sell(pending.requestId, pending.quantity);
            else await api.sellVtaDemo(pending.requestId, pending.quantity);
            if (getToken() !== session) return;
            clearVtaIntent(accountId, pending.requestId);
            vtaPending.current = null; setVtaUnconfirmed(false);
          } catch (error) {
            // Only a definitive first-attempt refusal may discard the intent.
            const rejected = privateNrx ? vta.definitiveRejection(error)
              : error instanceof ApiError && error.body.vtaOutcome === 'REJECTED';
            if (getToken() === session && !existed && rejected) {
              clearVtaIntent(accountId, pending.requestId); vtaPending.current = null;
            }
            throw error;
          }
        });
        if (getToken() !== session) return;
        await vta.refresh();
        if (getToken() !== session) return;
      } else if (family === 'OCO') {
        await api.placeOcoOrder({
          pair,
          side,
          quantity,
          takeProfitPrice: ocoTakeProfitPrice,
          stopTriggerPrice: ocoStopTriggerPrice,
          stopLimitPrice: ocoStopLimitPrice,
        });
      } else {
        const result = await api.placeOrder({
          pair,
          side,
          type,
          price: type === 'LIMIT' || type === 'STOP_LIMIT' || type === 'TAKE_PROFIT_LIMIT' ? price : undefined,
          triggerPrice: isConditional ? triggerPrice : undefined,
          quantity,
        });
        feedback = spotOrderFeedback(result);
      }
      onPlaced();
      setBalanceVersion(version => version + 1);
      if (feedback.kind === 'cancelledEmpty') {
        const message = t('trade.orderCancelledNoFill');
        setError(message);
        toast.error(message);
      } else if (feedback.kind === 'cancelledPartial') {
        resetFields();
        toast.info(t('trade.orderPartiallyFilledCancelled', { filled: feedback.filled, remaining: feedback.remaining, asset: baseAsset }));
      } else if (feedback.kind === 'unknown') {
        toast.info(t('trade.orderStatusUnconfirmed'));
      } else {
        resetFields();
        toast.success(t('trade.orderPlaced'));
      }
    } catch (err) {
      if (privateVta) {
        if (getToken() !== session) return;
        setVtaUnconfirmed(vtaPending.current !== null);
      }
      const message = customerErrorText(err, t, t('trade.placeOrderError'));
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  const FAMILY_TABS: { id: OrderFamily; label: string }[] = [
    { id: 'LIMIT', label: t('trade.limitOrder') },
    { id: 'MARKET', label: t('trade.marketOrder') },
    { id: 'STOP', label: t('trade.stopOrder') },
    { id: 'TAKE_PROFIT', label: t('trade.takeProfitOrder') },
    { id: 'OCO', label: t('trade.ocoOrder') },
  ];
  const lastPriceLabel = t('trade.lastPriceBtn');
  const sideClass = side === 'BUY' ? 'buy' : 'sell';
  function applyTotal(value: string) {
    const totalValue = parseFloat(value) || 0;
    if (!effectivePrice || effectivePrice <= 0) return;
    setQuantity(balancePercentageQuantity(totalValue, 100, effectivePrice));
    setPercent(0);
  }
  const SLIDER_STEPS = [0, 25, 50, 75, 100];

  return (
    <>
      {privateNrx && <div className="terminal-account-state" data-account-scope="SIMULATION_SPOT">
        <span>NRX · DEMO</span>
        <span>{vta.snapshot?.balances.find(b => b.asset === 'USDT')?.available ?? '—'} USDT · DEMO</span>
      </div>}
      <div className="order-form-tabs">
        <button type="button" className={`order-form-tab buy ${side === 'BUY' ? 'active' : ''}`} aria-pressed={side === 'BUY'}
          onClick={() => { setSide('BUY'); setPercent(0); setError(null); }}>
          {t('trade.buy')}
        </button>
        <button type="button" className={`order-form-tab sell ${side === 'SELL' ? 'active' : ''}`} aria-pressed={side === 'SELL'}
          onClick={() => { setSide('SELL'); setPercent(0); setError(null); }}>
          {t('trade.sell')}
        </button>
      </div>
      <div className="order-type-tabs">
        {FAMILY_TABS.map((f) => (
          <button key={f.id} type="button" className={`order-type-tab ${family === f.id ? 'active' : ''}`} aria-pressed={family === f.id}
            onClick={() => { setFamily(f.id); setPercent(0); setError(null); }}>{f.label}</button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="order-form-content" noValidate={notTradingYet || privateVta}>
        {isConditional && (
          <div className="order-type-tabs" style={{ padding: 0 }}>
            <button type="button" className={`order-type-tab ${execution === 'LIMIT' ? 'active' : ''}`} aria-pressed={execution === 'LIMIT'} onClick={() => setExecution('LIMIT')}>{t('trade.limitOrder')}</button>
            <button type="button" className={`order-type-tab ${execution === 'MARKET' ? 'active' : ''}`} aria-pressed={execution === 'MARKET'} onClick={() => setExecution('MARKET')}>{t('trade.marketOrder')}</button>
          </div>
        )}
        {family === 'OCO' && (
          <>
            <div className="form-group">
              <div className="form-label"><span>{t('trade.takeProfitPrice')}</span></div>
              <div className="input-group">
                <input aria-label={t('trade.takeProfitPrice')} type="number" step="any" required value={ocoTakeProfitPrice} onChange={(e) => setOcoTakeProfitPrice(e.target.value)} placeholder="0.00" />
                <span className="input-suffix">{quoteAsset}</span>
              </div>
              {triggerHint('TAKE_PROFIT') && <div className="form-label"><span>{triggerHint('TAKE_PROFIT')}</span></div>}
            </div>
            <div className="form-group">
              <div className="form-label"><span>{t('trade.triggerPrice')}</span></div>
              <div className="input-group">
                <input aria-label={t('trade.triggerPrice')} type="number" step="any" required value={ocoStopTriggerPrice} onChange={(e) => setOcoStopTriggerPrice(e.target.value)} placeholder="0.00" />
                <span className="input-suffix">{quoteAsset}</span>
              </div>
              {triggerHint('STOP') && <div className="form-label"><span>{triggerHint('STOP')}</span></div>}
            </div>
            <div className="form-group">
              <div className="form-label"><span>{t('trade.stopLimitPrice')}</span></div>
              <div className="input-group">
                <input aria-label={t('trade.stopLimitPrice')} type="number" step="any" required value={ocoStopLimitPrice} onChange={(e) => setOcoStopLimitPrice(e.target.value)} placeholder="0.00" />
                <span className="input-suffix">{quoteAsset}</span>
              </div>
            </div>
          </>
        )}
        {family !== 'OCO' && (
          <>
            {isConditional && (
              <div className="form-group">
                <div className="form-label"><span>{t('trade.triggerPrice')}</span></div>
                <div className="input-group">
                  <input aria-label={t('trade.triggerPrice')} type="number" step="any" required value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} placeholder="0.00" />
                  <span className="input-suffix">{quoteAsset}</span>
                </div>
                {triggerHint(family === 'STOP' ? 'STOP' : 'TAKE_PROFIT') && (
                  <div className="form-label"><span>{triggerHint(family === 'STOP' ? 'STOP' : 'TAKE_PROFIT')}</span></div>
                )}
              </div>
            )}
            {(family === 'LIMIT' || (isConditional && execution === 'LIMIT')) && (
              <div className="form-group">
                <div className="form-label">
                  <span>{t('trade.price')}</span>
                  {marketPrice !== null && (
                    <button type="button" className="max-btn" onClick={() => setPrice(String(marketPrice))}>{lastPriceLabel}</button>
                  )}
                </div>
                <div className="input-group">
                  <input aria-label={t('trade.price')} type="number" step="any" required value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
                  <span className="input-suffix">{quoteAsset}</span>
                </div>
              </div>
            )}
            {(family === 'MARKET' || (isConditional && execution === 'MARKET')) && (
              <div className="form-group">
                <div className="form-label"><span>{t('trade.price')}</span></div>
                <div className="input-group">
                  <input aria-label={t('trade.price')} readOnly value={marketPrice !== null ? `≈ ${marketPrice}` : notTradingYet ? '—' : t('trade.loading')} />
                  <span className="input-suffix">{quoteAsset}</span>
                </div>
              </div>
            )}
          </>
        )}
        <div className="form-group">
          <div className="form-label"><span>{t('trade.quantity')}</span></div>
          <div className="input-group">
            <input aria-label={t('trade.quantity')} type="number" step="any" required disabled={vtaLocked} value={quantity}
              onChange={(e) => { setQuantity(e.target.value); setPercent(0); }} placeholder="0.00" />
            <span className="input-suffix">{baseAsset}</span>
          </div>
        </div>
        <div className="form-group">
          <div className="form-label"><span>{t('trade.total')}</span></div>
          <div className="input-group">
            <input aria-label={t('trade.total')} type="number" step="any" disabled={vtaLocked} value={total === '0.00' ? '' : total} onChange={(e) => applyTotal(e.target.value)} placeholder="0.00" />
            <span className="input-suffix">{quoteAsset}</span>
          </div>
        </div>
        <div className="slider-container">
          <input className="terminal-size-range" type="range" min="0" max="100" step="25" aria-label={t('trade.quantity')} value={percent} disabled={!balanceReady || balanceError || vtaLocked} onChange={event => applyPercent(Number(event.target.value))} />
          <div className="slider-track">
            {SLIDER_STEPS.map((step, idx) => (
              <button key={step} type="button" data-label={`${step}%`} aria-label={`${step}%`} aria-pressed={percent === step}
                disabled={!balanceReady || balanceError || vtaLocked} className={`slider-step ${percent >= step ? 'active' : ''} ${sideClass}`}
                onClick={() => applyPercent(SLIDER_STEPS[idx])} />
            ))}
          </div>
          <div className="slider-labels">{SLIDER_STEPS.map((step) => (<span key={step}>{step}%</span>))}</div>
        </div>
        <div className="order-summary" data-initial-loading={balanceLoading && !balanceReady && !balanceError || undefined} aria-busy={balanceLoading && !balanceReady && !balanceError}>
          <div className="available-balance">
            <span>{privateNrx ? `DEMO · ${t('trade.available')}` : t('trade.available')}</span>
            <span className="amount">
              {balanceReady && !balanceError ? (side === 'BUY' ? available.quote : available.base).toFixed(side === 'BUY' ? 2 : privateVta ? 8 : 6) : '—'}{' '}
              {side === 'BUY' ? quoteAsset : baseAsset}
            </span>
          </div>
        </div>
        {balanceError && <div className="terminal-account-state" role="alert" aria-busy={balanceLoading}>
          <span>{t('trade.loadAssetsError')}</span>
          <button type="button" className="terminal-account-retry" disabled={balanceLoading} onClick={() => privateVta ? void vta.refresh() : setBalanceVersion(version => version + 1)}>{t('trade.retry')}</button>
        </div>}
        {error && (
          <div role="alert" className="available-balance" style={{ color: 'var(--color-sell)' }}><span style={{ color: 'inherit' }}>{error}</span></div>
        )}
        <button type="submit" disabled={submitting} className={`submit-btn ${sideClass}`}>
          {submitting ? t('auth.wait') : side === 'BUY' ? t('trade.buy') : t('trade.sell')}
        </button>
        {privateNrx && vta.snapshot && <details data-account-scope="SIMULATION_SPOT">
          <summary>{t('trade.tabOrderHistory')} · DEMO</summary>
          {vta.snapshot.sales.map(sale => <div key={sale.id} className="info-row">
            <span>{sale.quantity} NRX × {sale.price}</span><span>{sale.proceeds} USDT</span>
          </div>)}
        </details>}
        <div className="info-section">
          <div className="info-heading">{t('trade.marketInfo')}</div>
          <div className="info-row"><span className="info-label">{t('trade.lastPrice')}</span><span className="info-value">{marketPrice !== null ? formatSpotBookNumber(marketPrice) : '—'}</span></div>
          <div className="info-row">
            <span className="info-label">{t('markets.change24h')}</span>
            <span className={`info-value ${marketStats ? (marketStats.changePercent24h >= 0 ? 'up' : 'down') : ''}`}>
              {marketStats ? `${marketStats.changePercent24h >= 0 ? '+' : ''}${marketStats.changePercent24h.toFixed(2)}%` : '—'}
            </span>
          </div>
          <div className="info-row"><span className="info-label">{t('trade.high24h')}</span><span className="info-value">{marketStats ? formatSpotBookNumber(marketStats.high24h) : '—'}</span></div>
          <div className="info-row"><span className="info-label">{t('trade.low24h')}</span><span className="info-value">{marketStats ? formatSpotBookNumber(marketStats.low24h) : '—'}</span></div>
          <div className="info-row"><span className="info-label">{`${t('trade.volume24h')} (${baseAsset})`}</span><span className="info-value">{marketStats ? formatAmount(marketStats.volume24h) : '—'}</span></div>
          <div className="info-row"><span className="info-label">{`${t('trade.volume24h')} (${quoteAsset})`}</span><span className="info-value">{marketStats ? formatCompact(marketStats.quoteVolume24h) : '—'}</span></div>
        </div>
        <div className="info-section">
          <div className="info-heading">{t('trade.accountInfo')}</div>
          <div className="info-row"><span className="info-label">{`${t('trade.available')} ${baseAsset}`}</span><span className="info-value">{balanceReady && !balanceError ? formatPrice(available.base) : '—'}</span></div>
          <div className="info-row"><span className="info-label">{`${t('trade.available')} ${quoteAsset}`}</span><span className="info-value">{balanceReady && !balanceError ? formatAmount(available.quote) : '—'}</span></div>
        </div>
      </form>
    </>
  );
}
