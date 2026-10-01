import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import './FuturesPositionClosedCard.css';

/**
 * «Позиция закрыта» — the card a market close leaves on screen (owner,
 * 2026-10-01: variant B of three). Bottom right, six seconds, paused while
 * the pointer or keyboard focus is on it, closable by its ×.
 *
 * It only ever states what the engine reported: the fill price and quantity
 * from the close itself, the realized P&L from the position history. A line
 * whose figure is not known is left out (price) or shows «…» until the
 * history answers (P&L) — never a mark price or an estimate in its place.
 */
export interface ClosedPositionNotice {
  /** New for every close, so a second close restarts the timer. */
  id: number;
  kind: 'closed' | 'failed';
  /** «BTCUSDT · Лонг 10x». */
  contract: string;
  /** Already formatted, unit included; null hides the line. */
  quantity: string | null;
  price: string | null;
  /** undefined = waiting for the history; null = not reported, line hidden. */
  pnl?: { text: string; positive: boolean } | null;
  /** The refusal, for `failed`. */
  reason?: string;
}

const SHOWN_MS = 6000;
const FAILED_MS = 8000;

export function FuturesPositionClosedCard({ notice, onDismiss, onShowHistory }: {
  notice: ClosedPositionNotice;
  onDismiss: () => void;
  /** Absent: no history link (the panel has nowhere to send it). */
  onShowHistory?: () => void;
}) {
  const { t } = useLanguage();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(notice.kind === 'failed' ? FAILED_MS : SHOWN_MS);
  const startedAt = useRef(Date.now());

  // A new close starts a fresh countdown.
  useEffect(() => {
    remaining.current = notice.kind === 'failed' ? FAILED_MS : SHOWN_MS;
    startedAt.current = Date.now();
    setPaused(false);
  }, [notice.id, notice.kind]);

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(onDismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, notice.id, onDismiss]);

  const failed = notice.kind === 'failed';
  const title = failed ? t('futures.closePositionError') : t('futures.closedTitle');
  const card = (
    <div
      className={`futures-closed-card${failed ? ' is-failed' : ''}${paused ? ' is-paused' : ''}`}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
      data-closed-card={notice.kind}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false); }}
    >
      <div className="futures-closed-card-head">
        {failed
          ? <AlertCircle size={19} aria-hidden="true" className="futures-closed-card-icon" />
          : <CheckCircle2 size={19} aria-hidden="true" className="futures-closed-card-icon" />}
        <span className="futures-closed-card-title">{title}</span>
        <button type="button" className="futures-closed-card-x" onClick={onDismiss} aria-label={t('futures.closedDismiss')}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="futures-closed-card-contract">{notice.contract}</div>
      {failed ? (
        // The generic refusal is already the title; only a named reason adds a line.
        notice.reason && notice.reason !== title && <p className="futures-closed-card-reason">{notice.reason}</p>
      ) : (
        <dl className="futures-closed-card-rows">
          {notice.quantity !== null && <><dt>{t('trade.quantity')}</dt><dd className="mono" data-closed-quantity>{notice.quantity}</dd></>}
          {notice.price !== null && <><dt>{t('futures.closedPrice')}</dt><dd className="mono" data-closed-price>{notice.price}</dd></>}
          {notice.pnl !== null && <>
            <dt>{t('futures.colRealized')}</dt>
            <dd className={`mono${notice.pnl ? (notice.pnl.positive ? ' text-buy' : ' text-sell') : ''}`} data-closed-pnl aria-busy={notice.pnl === undefined}>
              {notice.pnl === undefined ? '…' : notice.pnl.text}
            </dd>
          </>}
        </dl>
      )}
      {!failed && onShowHistory && (
        <button type="button" className="futures-closed-card-link" onClick={() => { onShowHistory(); onDismiss(); }}>
          {t('futures.positionHistory')} →
        </button>
      )}
      <div className="futures-closed-card-bar" key={notice.id} aria-hidden="true" />
    </div>
  );
  return typeof document === 'undefined' ? card : createPortal(card, document.body);
}
