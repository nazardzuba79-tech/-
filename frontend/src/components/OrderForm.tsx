import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';

// The exchange charges no trading fee anywhere in this codebase (see the
// "0% fee" claim already on the registration page) — shown here as an
// honest 0.00, not a fabricated rate.
const FEE_RATE = 0;

type OrderFamily = 'LIMIT' | 'MARKET' | 'STOP' | 'TAKE_PROFIT' | 'OCO';
type Execution = 'LIMIT' | 'MARKET';

export interface PickedPrice {
  value: string;
  /** Bumped on every pick so clicking the same level twice still applies. */
  seq: number;
}

export function OrderForm({
  pair,
  onPlaced,
  pickedPrice,
}: {
  pair: string;
  onPlaced: () => void;
  pickedPrice?: PickedPrice | null;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const [baseAsset, quoteAsset] = pair.split('/');
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  // Clicking a level in the order book fills the price here — the reason
  // the reference gives every `.ob-row` a pointer cursor. A picked price is
  // a limit price, so the form switches to LIMIT rather than silently
  // setting a field the active order type would ignore.
  useEffect(() => {
    if (!pickedPrice) return;
    setPrice(pickedPrice.value);
    setFamily('LIMIT');
    setExecution('LIMIT');
  }, [pickedPrice]);

  useEffect(() => {
    api
      .getBalances()
      .then((balances) => {
        const base = balances.find((b) => b.asset === baseAsset);
        const quote = balances.find((b) => b.asset === quoteAsset);
        setAvailable({ base: base ? parseFloat(base.available) : 0, quote: quote ? parseFloat(quote.available) : 0 });
      })
      .catch(() => {});
  }, [baseAsset, quoteAsset, side]);

  // A live reference price is needed for more than just MARKET orders now:
  // the % slider/total estimate for conditional orders, and the inline
  // "must be above/below current price" hint that mirrors the server's
  // own trigger-direction validation.
  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTicker(pair)
        .then((res) => !cancelled && setMarketPrice(parseFloat(res.ticker.lastPrice)))
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pair]);

  const effectivePrice =
    family === 'LIMIT' || (isConditional && execution === 'LIMIT') ? parseFloat(price) || 0 : marketPrice ?? 0;
  const total = effectivePrice && quantity ? (effectivePrice * parseFloat(quantity)).toFixed(2) : '0.00';
  const feeAmount = (parseFloat(total) * FEE_RATE).toFixed(2);

  // % slider / drag both spend a share of whichever balance funds this
  // side of the trade — quote balance (e.g. USDT) for a buy, base balance
  // (e.g. BTC) for a sell — driven by real balances, not a fake number.
  function applyPercent(pct: number) {
    setPercent(pct);
    if (side === 'BUY') {
      if (!effectivePrice || effectivePrice <= 0) return;
      setQuantity(((available.quote * (pct / 100)) / effectivePrice).toFixed(8));
    } else {
      setQuantity((available.base * (pct / 100)).toFixed(8));
    }
  }

  // Same direction rule the backend enforces (OrderService.validateTriggerDirection):
  // a SELL stop/BUY take-profit must sit below the current price, the reverse above.
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
    setError(null);
    setSubmitting(true);
    try {
      if (family === 'OCO') {
        await api.placeOcoOrder({
          pair,
          side,
          quantity,
          takeProfitPrice: ocoTakeProfitPrice,
          stopTriggerPrice: ocoStopTriggerPrice,
          stopLimitPrice: ocoStopLimitPrice,
        });
      } else {
        await api.placeOrder({
          pair,
          side,
          type,
          price: type === 'LIMIT' || type === 'STOP_LIMIT' || type === 'TAKE_PROFIT_LIMIT' ? price : undefined,
          triggerPrice: isConditional ? triggerPrice : undefined,
          quantity,
        });
      }
      resetFields();
      onPlaced();
      toast.success(t('trade.orderPlaced'));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('trade.placeOrderError');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
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

  // The reference's Total field is editable and back-computes Amount from
  // it. Our Total was previously read-only; making it writable here is the
  // designed control, driven by the same price/quantity state the rest of
  // the form already uses — no new order concept.
  function applyTotal(value: string) {
    const totalValue = parseFloat(value) || 0;
    if (!effectivePrice || effectivePrice <= 0) return;
    setQuantity((totalValue / effectivePrice).toFixed(8));
    setPercent(0);
  }

  // The reference's slider is five discrete steps, filled up to the one
  // clicked. Same percentages the previous drag slider offered.
  const SLIDER_STEPS = [0, 25, 50, 75, 100];

  return (
    <>
      <div className="order-form-tabs">
        <button
          type="button"
          className={`order-form-tab buy ${side === 'BUY' ? 'active' : ''}`}
          onClick={() => setSide('BUY')}
        >
          {t('trade.buy')} {baseAsset}
        </button>
        <button
          type="button"
          className={`order-form-tab sell ${side === 'SELL' ? 'active' : ''}`}
          onClick={() => setSide('SELL')}
        >
          {t('trade.sell')} {baseAsset}
        </button>
      </div>

      <div className="order-type-tabs">
        {FAMILY_TABS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`order-type-tab ${family === f.id ? 'active' : ''}`}
            onClick={() => setFamily(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="order-form-content">
        {/* Stop and take-profit orders can execute as either a limit or a
            market order — the reference has no equivalent control because
            it has no conditional orders, so this reuses its order-type tab
            styling rather than introducing a third look. */}
        {isConditional && (
          <div className="order-type-tabs" style={{ padding: 0 }}>
            <button
              type="button"
              className={`order-type-tab ${execution === 'LIMIT' ? 'active' : ''}`}
              onClick={() => setExecution('LIMIT')}
            >
              {t('trade.limitOrder')}
            </button>
            <button
              type="button"
              className={`order-type-tab ${execution === 'MARKET' ? 'active' : ''}`}
              onClick={() => setExecution('MARKET')}
            >
              {t('trade.marketOrder')}
            </button>
          </div>
        )}

        {family === 'OCO' && (
          <>
            <div className="form-group">
              <div className="form-label"><span>{t('trade.takeProfitPrice')}</span></div>
              <div className="input-group">
                <input type="number" step="any" required value={ocoTakeProfitPrice} onChange={(e) => setOcoTakeProfitPrice(e.target.value)} placeholder="0.00" />
                <span className="input-suffix">{quoteAsset}</span>
              </div>
              {triggerHint('TAKE_PROFIT') && <div className="form-label"><span>{triggerHint('TAKE_PROFIT')}</span></div>}
            </div>
            <div className="form-group">
              <div className="form-label"><span>{t('trade.stopTriggerPrice')}</span></div>
              <div className="input-group">
                <input type="number" step="any" required value={ocoStopTriggerPrice} onChange={(e) => setOcoStopTriggerPrice(e.target.value)} placeholder="0.00" />
                <span className="input-suffix">{quoteAsset}</span>
              </div>
              {triggerHint('STOP') && <div className="form-label"><span>{triggerHint('STOP')}</span></div>}
            </div>
            <div className="form-group">
              <div className="form-label"><span>{t('trade.stopLimitPrice')}</span></div>
              <div className="input-group">
                <input type="number" step="any" required value={ocoStopLimitPrice} onChange={(e) => setOcoStopLimitPrice(e.target.value)} placeholder="0.00" />
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
                  <input type="number" step="any" required value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} placeholder="0.00" />
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
                    <button type="button" className="max-btn" onClick={() => setPrice(String(marketPrice))}>
                      {lastPriceLabel}
                    </button>
                  )}
                </div>
                <div className="input-group">
                  <input type="number" step="any" required value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
                  <span className="input-suffix">{quoteAsset}</span>
                </div>
              </div>
            )}

            {(family === 'MARKET' || (isConditional && execution === 'MARKET')) && (
              <div className="form-group">
                <div className="form-label"><span>{t('trade.price')}</span></div>
                <div className="input-group">
                  <input readOnly value={marketPrice !== null ? `≈ ${marketPrice}` : t('trade.loading')} />
                  <span className="input-suffix">{quoteAsset}</span>
                </div>
              </div>
            )}
          </>
        )}

        <div className="form-group">
          <div className="form-label"><span>{t('trade.quantity')}</span></div>
          <div className="input-group">
            <input
              type="number"
              step="any"
              required
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setPercent(0);
              }}
              placeholder="0.00"
            />
            <span className="input-suffix">{baseAsset}</span>
          </div>
        </div>

        <div className="form-group">
          <div className="form-label"><span>{t('trade.total')}</span></div>
          <div className="input-group">
            <input type="number" step="any" value={total === '0.00' ? '' : total} onChange={(e) => applyTotal(e.target.value)} placeholder="0.00" />
            <span className="input-suffix">{quoteAsset}</span>
          </div>
        </div>

        <div className="slider-container">
          <div className="slider-track">
            {SLIDER_STEPS.map((step, idx) => (
              <button
                key={step}
                type="button"
                data-label={`${step}%`}
                className={`slider-step ${percent >= step ? 'active' : ''} ${sideClass}`}
                onClick={() => applyPercent(SLIDER_STEPS[idx])}
              />
            ))}
          </div>
        </div>

        <div className="available-balance">
          <span>{t('trade.available')}</span>
          <span className="amount">
            {(side === 'BUY' ? available.quote : available.base).toFixed(side === 'BUY' ? 2 : 6)}{' '}
            {side === 'BUY' ? quoteAsset : baseAsset}
          </span>
        </div>

        <div className="available-balance">
          <span>{t('trade.fee')}</span>
          <span className="amount">
            {feeAmount} {quoteAsset} (0%)
          </span>
        </div>

        {error && (
          <div className="available-balance" style={{ color: 'var(--color-sell)' }}>
            <span style={{ color: 'inherit' }}>{error}</span>
          </div>
        )}

        <button type="submit" disabled={submitting} className={`submit-btn ${sideClass}`}>
          {submitting ? t('auth.wait') : `${side === 'BUY' ? t('trade.buy') : t('trade.sell')} ${baseAsset}`}
        </button>
      </form>
    </>
  );
}
