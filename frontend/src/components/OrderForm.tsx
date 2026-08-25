import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';

const PERCENT_STOPS = [0, 25, 50, 75, 100];
// The exchange charges no trading fee anywhere in this codebase (see the
// "0% fee" claim already on the registration page) — shown here as an
// honest 0.00, not a fabricated rate.
const FEE_RATE = 0;

type OrderFamily = 'LIMIT' | 'MARKET' | 'STOP' | 'TAKE_PROFIT' | 'OCO';
type Execution = 'LIMIT' | 'MARKET';

export function OrderForm({ pair, onPlaced }: { pair: string; onPlaced: () => void }) {
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

  return (
    <div style={styles.panel}>
      <div style={styles.sideTabs}>
        <button
          type="button"
          onClick={() => setSide('BUY')}
          style={{ ...styles.sideTab, ...(side === 'BUY' ? styles.sideTabBuy : {}) }}
        >
          {t('trade.buy')}
        </button>
        <button
          type="button"
          onClick={() => setSide('SELL')}
          style={{ ...styles.sideTab, ...(side === 'SELL' ? styles.sideTabSell : {}) }}
        >
          {t('trade.sell')}
        </button>
      </div>

      <div style={styles.typeTabs}>
        {FAMILY_TABS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFamily(f.id)}
            style={{ ...styles.typeTab, ...(family === f.id ? styles.typeTabActive : {}) }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        {isConditional && (
          <div style={styles.executionToggle}>
            <button
              type="button"
              onClick={() => setExecution('LIMIT')}
              style={{ ...styles.execBtn, ...(execution === 'LIMIT' ? styles.execBtnActive : {}) }}
            >
              {t('trade.limitOrder')}
            </button>
            <button
              type="button"
              onClick={() => setExecution('MARKET')}
              style={{ ...styles.execBtn, ...(execution === 'MARKET' ? styles.execBtnActive : {}) }}
            >
              {t('trade.marketOrder')}
            </button>
          </div>
        )}

        {family === 'OCO' ? (
          <>
            <label style={styles.label}>
              {t('trade.takeProfitPrice')}
              <input
                className="mono"
                type="number"
                step="any"
                required
                value={ocoTakeProfitPrice}
                onChange={(e) => setOcoTakeProfitPrice(e.target.value)}
                style={styles.input}
                placeholder="0.00"
              />
              {triggerHint('TAKE_PROFIT') && <span style={styles.hint}>{triggerHint('TAKE_PROFIT')}</span>}
            </label>
            <label style={styles.label}>
              {t('trade.stopTriggerPrice')}
              <input
                className="mono"
                type="number"
                step="any"
                required
                value={ocoStopTriggerPrice}
                onChange={(e) => setOcoStopTriggerPrice(e.target.value)}
                style={styles.input}
                placeholder="0.00"
              />
              {triggerHint('STOP') && <span style={styles.hint}>{triggerHint('STOP')}</span>}
            </label>
            <label style={styles.label}>
              {t('trade.stopLimitPrice')}
              <input
                className="mono"
                type="number"
                step="any"
                required
                value={ocoStopLimitPrice}
                onChange={(e) => setOcoStopLimitPrice(e.target.value)}
                style={styles.input}
                placeholder="0.00"
              />
            </label>
          </>
        ) : (
          <>
            {isConditional && (
              <label style={styles.label}>
                {t('trade.triggerPrice')}
                <input
                  className="mono"
                  type="number"
                  step="any"
                  required
                  value={triggerPrice}
                  onChange={(e) => setTriggerPrice(e.target.value)}
                  style={styles.input}
                  placeholder="0.00"
                />
                {triggerHint(family === 'STOP' ? 'STOP' : 'TAKE_PROFIT') && (
                  <span style={styles.hint}>{triggerHint(family === 'STOP' ? 'STOP' : 'TAKE_PROFIT')}</span>
                )}
              </label>
            )}
            {family === 'LIMIT' || (isConditional && execution === 'LIMIT') ? (
              <label style={styles.label}>
                {isConditional ? t('trade.limitExecutionPrice') : t('trade.price')}
                <input
                  className="mono"
                  type="number"
                  step="any"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  style={styles.input}
                  placeholder="0.00"
                />
              </label>
            ) : (
              <label style={styles.label}>
                {t('trade.price')}
                <div style={{ ...styles.input, color: 'var(--text-tertiary)' }} className="mono">
                  {marketPrice !== null ? `≈ ${marketPrice}` : t('trade.loading')} {quoteAsset}
                </div>
              </label>
            )}
          </>
        )}

        <label style={styles.label}>
          <span style={styles.qtyLabelRow}>
            {t('trade.quantity')}
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
              {t('trade.available')}: {(side === 'BUY' ? available.quote : available.base).toFixed(side === 'BUY' ? 2 : 6)}{' '}
              {side === 'BUY' ? quoteAsset : baseAsset}
            </span>
          </span>
          <div style={styles.qtyInputRow}>
            <input
              className="mono"
              type="number"
              step="any"
              required
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setPercent(0);
              }}
              style={{ ...styles.input, flex: 1 }}
              placeholder="0.00000"
            />
            <span style={styles.qtyAsset}>{baseAsset}</span>
          </div>
        </label>

        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(e) => applyPercent(Number(e.target.value))}
          style={styles.slider}
        />

        <div style={styles.percentRow}>
          {PERCENT_STOPS.map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => applyPercent(pct)}
              style={{ ...styles.percentBtn, ...(percent === pct ? styles.percentBtnActive : {}) }}
            >
              {pct}%
            </button>
          ))}
        </div>

        <div style={styles.totalsBox}>
          <div style={styles.total}>
            <span style={{ color: 'var(--text-secondary)' }}>{t('trade.total')}</span>
            <span className="mono">
              {total} {quoteAsset}
            </span>
          </div>
          <div style={styles.total}>
            <span style={{ color: 'var(--text-secondary)' }}>{t('trade.fee')}</span>
            <span className="mono">
              {feeAmount} {quoteAsset} (0%)
            </span>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            ...styles.submit,
            background: side === 'BUY' ? 'var(--buy)' : 'var(--sell)',
            boxShadow: side === 'BUY' ? '0 4px 16px rgba(0,214,143,0.3)' : '0 4px 16px rgba(255,77,106,0.3)',
          }}
        >
          {submitting
            ? t('auth.wait')
            : `${side === 'BUY' ? t('trade.buy') : t('trade.sell')} ${baseAsset}`}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  sideTabs: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    background: 'var(--panel-alt)',
    borderRadius: 10,
    padding: 4,
    margin: 10,
    gap: 4,
  },
  sideTab: {
    padding: '10px 0',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    color: 'var(--text-secondary)',
    fontWeight: 700,
    fontSize: 13,
  },
  sideTabBuy: {
    color: 'var(--on-accent)',
    background: 'var(--buy)',
  },
  sideTabSell: {
    color: 'var(--on-accent)',
    background: 'var(--sell)',
  },
  typeTabs: {
    display: 'flex',
    gap: 12,
    padding: '0 14px 10px',
    borderBottom: '1px solid var(--border)',
    overflowX: 'auto',
  },
  typeTab: {
    background: 'transparent',
    border: 'none',
    padding: '2px 0',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap',
  },
  typeTabActive: {
    color: 'var(--accent)',
  },
  form: {
    padding: '14px 14px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  executionToggle: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
    background: 'var(--panel-alt)',
    borderRadius: 8,
    padding: 3,
  },
  execBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    padding: '7px 0',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 700,
  },
  execBtnActive: {
    background: 'var(--panel)',
    color: 'var(--text-primary)',
    boxShadow: 'var(--shadow-sm)',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  hint: {
    fontSize: 10,
    color: 'var(--text-tertiary)',
    fontWeight: 400,
  },
  qtyLabelRow: { display: 'flex', justifyContent: 'space-between', fontSize: 11 },
  qtyInputRow: { display: 'flex', alignItems: 'center', gap: 8 },
  qtyAsset: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-secondary)',
    padding: '0 4px',
  },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  slider: { width: '100%', cursor: 'pointer', margin: '2px 0' },
  percentRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 8,
  },
  percentBtn: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 0',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 600,
  },
  percentBtnActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: 'var(--on-accent)',
  },
  totalsBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  total: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    padding: '4px 0',
  },
  error: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '6px 10px',
    borderRadius: 6,
    fontSize: 11,
  },
  submit: {
    border: 'none',
    borderRadius: 10,
    padding: '14px 0',
    color: 'var(--on-accent)',
    fontWeight: 800,
    fontSize: 14,
    letterSpacing: '0.01em',
  },
};
