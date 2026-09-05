import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { localeOf } from '../../lib/i18n';
import { useCardCopy } from './useCardCopy';
import {
  cardApplicationAction, createCardApplicationController,
  type CardApplicationState, type CardProduct,
} from './cardApplicationState';

export function CardApplication({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const { c, lang } = useCardCopy();
  const [state, setState] = useState<CardApplicationState>({ status: reviewOnly ? 'review' : 'loading' });
  const [product, setProduct] = useState<CardProduct>('TITANIUM');
  const controller = useRef<ReturnType<typeof createCardApplicationController> | null>(null);

  useEffect(() => {
    const next = createCardApplicationController(api, reviewOnly, setState);
    controller.current = next;
    setState({ status: reviewOnly ? 'review' : 'loading' });
    void next.load();
    return () => { next.dispose(); if (controller.current === next) controller.current = null; };
  }, [reviewOnly]);

  const ready = state.status === 'ready' ? state : null;
  const action = ready ? cardApplicationAction(ready.data) : null;
  const application = ready?.data.application;
  const submittedDate = application ? new Date(application.submittedAt) : null;
  const dateText = submittedDate && Number.isFinite(submittedDate.getTime())
    ? submittedDate.toLocaleString(localeOf(lang)) : null;
  const chooseProduct = <label style={styles.label}>
    {c.appProduct}
    <select
      value={product}
      disabled={ready?.submitting}
      onChange={event => setProduct(event.target.value as CardProduct)}
      style={styles.select}
    >
      <option value="TITANIUM">VOLTEX Titanium</option>
      <option value="BLACK_SIGNATURE">VOLTEX Black Signature</option>
    </select>
  </label>;

  return <div style={styles.panel} aria-label={c.applicationTitle} data-card-application-state={reviewOnly ? 'review' : action ?? state.status}>
    {reviewOnly ? <>
      {chooseProduct}
      <button type="button" style={{ ...styles.button, opacity: 0.55 }} disabled>{c.appSubmit}</button>
      <p role="note" style={styles.secondary}>{c.appReview}</p>
    </> : state.status === 'loading' ? (
      <p role="status" style={styles.secondary}>{c.appLoading}</p>
    ) : state.status === 'error' ? <>
      <p role="alert" style={styles.error}>{c.appLoadError}</p>
      <button type="button" style={styles.button} onClick={() => void controller.current?.load()}>{c.appRetry}</button>
    </> : ready ? <>
      {ready.error !== undefined && <p role="alert" style={styles.error}>{c.appSubmitError}</p>}
      {action === 'submitted' && application ? <div role="status" style={styles.stack}>
        <strong style={styles.success}>{c.appSubmitted}</strong>
        <span>{application.product === 'TITANIUM' ? 'VOLTEX Titanium' : 'VOLTEX Black Signature'}</span>
        {dateText && <span style={styles.secondary}>{c.appSubmittedAt}: {dateText}</span>}
        <span style={styles.secondary}>{c.appRequestId}: {application.id}</span>
      </div> : action === 'verify' ? <>
        <p style={styles.secondary}>{c.appVerificationRequired}</p>
        <Link to="/settings?tab=verification" style={styles.button}>{c.appVerify}</Link>
      </> : action === 'fund' ? <>
        <p style={styles.secondary}>{c.appFinancialRequired}</p>
        <div style={styles.actions}>
          <Link to="/wallet?action=deposit" style={styles.button}>{c.appDeposit}</Link>
          <Link to="/trade" style={styles.link}>{c.appTrade}</Link>
        </div>
      </> : action === 'unavailable' ? <>
        <p role="status" style={styles.secondary}>{c.appUnavailable}</p>
        <button type="button" style={styles.button} onClick={() => void controller.current?.load()}>{c.appRefresh}</button>
      </> : action === 'apply' ? <>
        <p style={styles.success}>{c.appEligible}</p>
        {chooseProduct}
        <button
          type="button" style={{ ...styles.button, opacity: ready.submitting ? 0.6 : 1 }}
          disabled={ready.submitting} aria-busy={ready.submitting}
          onClick={() => void controller.current?.submit(product)}
        >{ready.submitting ? c.appSubmitting : c.appSubmit}</button>
      </> : null}
    </> : null}
  </div>;
}

const styles: Record<string, CSSProperties> = {
  panel: { width: '100%', maxWidth: 600, padding: 24, border: '1px solid #2b2d38', borderRadius: 16, background: '#111218', color: '#f5f5f7', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 16, boxSizing: 'border-box', overflowWrap: 'anywhere' },
  label: { width: '100%', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, lineHeight: 1.5 },
  select: { width: '100%', minWidth: 0, border: '1px solid #484b58', borderRadius: 8, padding: '12px 14px', font: 'inherit', background: '#1a1c24', color: '#f5f5f7', boxSizing: 'border-box' },
  secondary: { margin: 0, color: '#c0c2ce', fontSize: 14, lineHeight: 1.6 },
  stack: { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '100%' },
  success: { margin: 0, color: '#68dfb0', fontSize: 15, lineHeight: 1.5 },
  error: { margin: 0, color: '#ff929b', fontSize: 14, lineHeight: 1.6 },
  actions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20 },
  button: { display: 'inline-flex', justifyContent: 'center', maxWidth: '100%', border: '1px solid #fff', borderRadius: 999, background: '#fff', color: '#0a0a0b', padding: '12px 22px', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, lineHeight: 1.4, cursor: 'pointer', textDecoration: 'none' },
  link: { color: '#e6c878', fontSize: 14, lineHeight: 1.5, textDecoration: 'underline', textUnderlineOffset: 3 },
};
