import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useFuturesExecution } from '../lib/futuresExecution';
import { futuresOrderErrorMessage } from '../lib/futuresOrderErrors';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';
import type { FuturesContractRules } from '../lib/futuresMath';
import type { FuturesPosition } from '../lib/futuresAccountStore';
import './FuturesLimitCloseDialog.css';

/**
 * «Закрытие по лимиту» — what «Лимитный» in the positions row opens.
 *
 * The reference's dialog, field for field: the entry price and the market
 * price of THIS position, a close price (seeded with the market price), a
 * close quantity (seeded with the whole position) with a 0–100% slider,
 * the sentence that says what will be closed and what it is expected to
 * make once the closing fee is taken, Post-Only, OK and Cancel.
 *
 * It closes ONE named position: the order it places is reduce-only, on
 * the side opposite to the position, carries the position's id, and is
 * sized here — never by the order form, whose Long/Short pair has nothing
 * to do with it. A trader closing part of a long never sees a control that
 * could open a short instead.
 *
 * Post-Only is honoured where the order is placed: a limit that would
 * cross the market (a long's close at or below it, a short's at or above)
 * is refused here with the reason, and nothing is sent — the engine would
 * fill it at once as a taker, which is exactly what Post-Only forbids.
 */
export function FuturesLimitCloseDialog({ position: p, marketPrice, rules, onClose, onPlaced }: {
  position: FuturesPosition;
  /** The last traded price of the position's contract, when the terminal
   *  has one; the position's mark price stands in otherwise. */
  marketPrice: number | null;
  /** The contract's quantity rules and fee rate, when they are known for
   *  THIS symbol. `null` means the dialog derives its steps from the
   *  figures it was given and lets the engine validate the rest. */
  rules: FuturesContractRules | null;
  onClose: () => void;
  onPlaced: () => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const execution = useFuturesExecution();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);

  const quoteAsset = p.symbol.split('/')[1] ?? 'USDT';
  const baseAsset = p.symbol.split('/')[0] ?? '';
  const entry = Number(p.entryPrice);
  const market = marketPrice !== null && Number.isFinite(marketPrice) && marketPrice > 0
    ? marketPrice
    : p.markPrice !== null && Number.isFinite(Number(p.markPrice)) ? Number(p.markPrice) : null;
  const size = Number(p.size);

  // Precision follows the figures the position already carries: the price
  // to the finest of entry and market, the quantity to the contract's step
  // when it is known, else to the size's own decimals.
  const decimalsOf = (value: string | number | null) => value === null ? 0 : (String(value).split('.')[1] ?? '').length;
  const priceDecimals = Math.min(8, Math.max(decimalsOf(p.entryPrice), decimalsOf(p.markPrice), decimalsOf(market)));
  const qtyDecimals = Math.min(8, rules ? decimalsOf(rules.qtyStep) : decimalsOf(p.size));
  const tick = Number((10 ** -priceDecimals).toFixed(priceDecimals));
  const step = rules ? Number(rules.qtyStep) : Number((10 ** -qtyDecimals).toFixed(qtyDecimals));
  const fixed = (value: number, decimals: number) => value.toFixed(decimals);
  const grouped = (value: number, decimals: number) => value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const [price, setPrice] = useState(market === null ? '' : fixed(market, priceDecimals));
  const [quantity, setQuantity] = useState(fixed(size, qtyDecimals));
  const [percent, setPercent] = useState(100);
  const [postOnly, setPostOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const priceNumber = Number(price);
  const qtyNumber = Number(quantity);
  const priceValid = price.trim() !== '' && Number.isFinite(priceNumber) && priceNumber > 0;
  const qtyPositive = quantity.trim() !== '' && Number.isFinite(qtyNumber) && qtyNumber > 0;
  const qtyTooLarge = qtyPositive && qtyNumber > size + 1e-12;
  const qtyOffStep = qtyPositive && step > 0 && Math.abs(qtyNumber / step - Math.round(qtyNumber / step)) > 1e-6;
  const qtyValid = qtyPositive && !qtyTooLarge && !qtyOffStep;

  /** Quantity from a share of the position, rounded DOWN to the step so a
   *  50% close of an odd size never asks for more than exists. */
  function applyPercent(pct: number) {
    setPercent(pct);
    const raw = size * (pct / 100);
    const stepped = step > 0 ? Math.floor(raw / step + 1e-9) * step : raw;
    setQuantity(fixed(pct === 100 ? size : stepped, qtyDecimals));
    setError(null);
  }
  function typeQuantity(next: string) {
    setQuantity(next);
    setError(null);
    const value = Number(next);
    if (Number.isFinite(value) && size > 0) setPercent(Math.max(0, Math.min(100, Math.round((value / size) * 100))));
  }
  function nudge(field: 'price' | 'quantity', direction: 1 | -1) {
    setError(null);
    if (field === 'price') {
      const base = priceValid ? priceNumber : (market ?? 0);
      setPrice(fixed(Math.max(tick, base + direction * tick), priceDecimals));
    } else {
      const base = qtyPositive ? qtyNumber : 0;
      const next = Math.min(size, Math.max(step, base + direction * step));
      typeQuantity(fixed(next, qtyDecimals));
    }
  }

  // The expected result: the gross move from entry on the closed quantity,
  // minus the closing fee at the engine's taker rate when it publishes one.
  const takerFeeRate = rules?.takerFeeRate ? Number(rules.takerFeeRate) : 0;
  const expected = useMemo(() => {
    if (!priceValid || !qtyValid || !Number.isFinite(entry)) return null;
    const direction = p.side === 'LONG' ? 1 : -1;
    const gross = (priceNumber - entry) * qtyNumber * direction;
    const fee = qtyNumber * priceNumber * takerFeeRate;
    return gross - fee;
  }, [priceValid, qtyValid, entry, priceNumber, qtyNumber, p.side, takerFeeRate]);

  const closingSide: 'BUY' | 'SELL' = p.side === 'LONG' ? 'SELL' : 'BUY';
  const canSubmit = priceValid && qtyValid && execution.ready && !submitting;

  async function submit() {
    if (!canSubmit) return;
    if (postOnly && market !== null) {
      // A long closes by selling: at or below the market it trades at once.
      // A short closes by buying: at or above the market it trades at once.
      if (p.side === 'LONG' && priceNumber <= market) { setError(t('futures.limitClosePostOnlyAbove')); return; }
      if (p.side === 'SHORT' && priceNumber >= market) { setError(t('futures.limitClosePostOnlyBelow')); return; }
    }
    setSubmitting(true);
    setError(null);
    try {
      await execution.placeOrder({
        symbol: p.symbol,
        side: closingSide,
        type: 'LIMIT',
        price,
        quantity,
        leverage: Number(p.leverage),
        marginType: p.marginType,
        reduceOnly: true,
        // The explicit target is the simulation engine's contract; the real
        // futures API resolves a reduce-only order by symbol and side and
        // is sent exactly what the order form sends it.
        ...(execution.engine === 'NATIVE' ? { positionId: p.id } : {}),
      });
      toast.success(t('futures.limitClosePlaced'));
      onPlaced();
    } catch (err) {
      setError(futuresOrderErrorMessage(err, t, t('futures.placeOrderError')));
    } finally {
      setSubmitting(false);
    }
  }

  const qtyMessage = qtyTooLarge ? t('futures.limitCloseQtyTooLarge') : qtyOffStep ? t('futures.limitCloseQtyStep', { step: fixed(step, qtyDecimals) }) : null;
  const summary = expected === null ? null
    : t(expected >= 0 ? 'futures.limitCloseSummaryProfit' : 'futures.limitCloseSummaryLoss', {
      qty: grouped(qtyNumber, qtyDecimals), price: grouped(priceNumber, priceDecimals),
      pnl: grouped(Math.abs(expected), 4), asset: quoteAsset,
    });

  return (
    <dialog ref={ref} className="futures-limit-close archive-tool-dialog" aria-label={t('futures.limitCloseTitle')}
      data-limit-close-dialog={p.id} data-limit-close-side={p.side}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <header>
        <strong>{t('futures.limitCloseTitle')}</strong>
        <button type="button" aria-label={t('futures.close')} onClick={onClose}><X size={19} /></button>
      </header>
      <form className="flc-body" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <dl className="flc-facts">
          <div><dt>{t('futures.colEntry')}</dt><dd data-limit-close-entry={p.entryPrice}>{Number.isFinite(entry) ? grouped(entry, priceDecimals) : '—'}</dd></div>
          <div><dt>{t('futures.limitCloseMarketPrice')}</dt><dd data-limit-close-market={market ?? ''}>{market === null ? '—' : grouped(market, priceDecimals)}</dd></div>
        </dl>

        <label className="flc-field">
          <span className="flc-label">{t('futures.limitClosePrice')} {quoteAsset}</span>
          <span className="flc-input">
            <input inputMode="decimal" value={price} data-limit-close-price="true" autoFocus
              onChange={(e) => { setPrice(e.target.value); setError(null); }} />
            <button type="button" className="flc-step" aria-label="−" onClick={() => nudge('price', -1)}>−</button>
            <button type="button" className="flc-step" aria-label="+" onClick={() => nudge('price', 1)}>+</button>
          </span>
        </label>

        <label className="flc-field">
          <span className="flc-label">{t('futures.limitCloseQty')} {baseAsset}</span>
          <span className="flc-input">
            <input inputMode="decimal" value={quantity} data-limit-close-qty="true"
              onChange={(e) => typeQuantity(e.target.value)} />
            <button type="button" className="flc-step" aria-label="−" onClick={() => nudge('quantity', -1)}>−</button>
            <button type="button" className="flc-step" aria-label="+" onClick={() => nudge('quantity', 1)}>+</button>
          </span>
          {qtyMessage && <span className="flc-fieldError" role="alert">{qtyMessage}</span>}
        </label>

        <div className="flc-slider">
          <input type="range" min={0} max={100} step={1} value={percent} list="flc-marks" aria-label="%"
            data-limit-close-percent="true"
            style={{ ['--flc-fill' as string]: `${percent}%` }}
            onChange={(e) => applyPercent(Number(e.target.value))} />
          <datalist id="flc-marks"><option value="0" /><option value="25" /><option value="50" /><option value="75" /><option value="100" /></datalist>
          <div className="flc-sliderStops" aria-hidden="true">
            {[0, 25, 50, 75, 100].map((stop) => (
              <button type="button" key={stop} className={`flc-stop${percent >= stop ? ' flc-stop--on' : ''}`}
                data-limit-close-stop={stop} onClick={() => applyPercent(stop)} tabIndex={-1} aria-label={`${stop}%`} />
            ))}
          </div>
          <div className="flc-sliderScale"><span>0</span><span>100%</span></div>
        </div>

        <p className={`flc-summary${expected !== null && expected < 0 ? ' flc-summary--loss' : ''}`} data-limit-close-summary={expected === null ? '' : expected.toFixed(8)}>
          {summary ?? '—'}
        </p>

        <label className="flc-postOnly">
          <input type="checkbox" checked={postOnly} data-limit-close-post-only="true" onChange={(e) => { setPostOnly(e.target.checked); setError(null); }} />
          <span>{t('futures.limitClosePostOnly')}</span>
        </label>

        {error && <div className="flc-error" role="alert">{error}</div>}

        <div className="flc-actions">
          <button type="submit" className="flc-ok" disabled={!canSubmit} data-limit-close-submit="true">
            {submitting ? t('auth.wait') : t('futures.limitCloseOk')}
          </button>
          <button type="button" className="flc-cancel" onClick={onClose} data-limit-close-cancel="true">{t('futures.cancel')}</button>
        </div>
      </form>
    </dialog>
  );
}
