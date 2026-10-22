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

  // The server remains authoritative for eligibility. These values only
  // explain the server result to the customer; they never unlock the CTA.
  const eligibility = ready?.data.eligibility;
  const progressCopy = {
    ru: { title: 'Ваш прогресс', verification: 'Верификация', deposit: 'Депозит', volume: 'Торговый оборот', done: 'Выполнено', pending: 'Не выполнено', unknown: 'Данные неполные' },
    en: { title: 'Your progress', verification: 'Verification', deposit: 'Deposit', volume: 'Trading volume', done: 'Completed', pending: 'Not met', unknown: 'Data incomplete' },
    zh: { title: '您的进度', verification: '身份验证', deposit: '入金', volume: '交易量', done: '已完成', pending: '未达成', unknown: '数据不完整' },
    es: { title: 'Tu progreso', verification: 'Verificación', deposit: 'Depósito', volume: 'Volumen de trading', done: 'Completado', pending: 'Pendiente', unknown: 'Datos incompletos' },
    hi: { title: 'आपकी प्रगति', verification: 'सत्यापन', deposit: 'जमा', volume: 'ट्रेडिंग वॉल्यूम', done: 'पूरा', pending: 'अभी पूरा नहीं', unknown: 'डेटा अधूरा' },
    ja: { title: '達成状況', verification: '本人確認', deposit: '入金', volume: '取引高', done: '達成済み', pending: '未達成', unknown: 'データ不完全' },
    ko: { title: '진행 상황', verification: '본인 인증', deposit: '입금', volume: '거래량', done: '완료', pending: '미충족', unknown: '데이터 불완전' },
  }[lang];
  const usd = (value: number) => new Intl.NumberFormat(localeOf(lang), {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(value);
  const percentage = (value: number, threshold: number, complete: boolean) => {
    if (!complete || !Number.isFinite(value) || value < 0) return null;
    return Math.max(0, Math.min(100, (value / threshold) * 100));
  };
  const conditionRow = (
    label: string,
    done: boolean,
    current?: number,
    threshold?: number,
    complete = true,
  ) => {
    const pct = done ? 100 : current !== undefined && threshold !== undefined
      ? percentage(current, threshold, complete) : undefined;
    const status = done ? progressCopy.done : complete ? progressCopy.pending : progressCopy.unknown;
    return <div style={styles.conditionRow}>
      <div style={styles.conditionHead}>
        <span style={styles.conditionLabel}>{label}</span>
        <span style={{ ...styles.conditionStatus, ...(done ? styles.conditionDone : {}) }}>{status}</span>
      </div>
      {current !== undefined && threshold !== undefined && (
        <>
          <div style={styles.conditionValue}>
            {complete ? usd(Math.max(0, current)) : done ? `≥ ${usd(Math.max(0, current))}` : '—'} / {usd(threshold)}
          </div>
          <div
            style={styles.progressTrack}
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(pct === null || pct === undefined ? {} : { 'aria-valuenow': Math.round(pct) })}
            aria-valuetext={status}
          >
            <span style={{ ...styles.progressFill, width: `${pct ?? 0}%`, opacity: pct === null ? 0.3 : 1 }} />
          </div>
        </>
      )}
    </div>;
  };
  const progress = eligibility && action !== 'submitted' ? (
    <div style={styles.progressCard} aria-label={progressCopy.title}>
      <strong style={styles.progressTitle}>{progressCopy.title}</strong>
      {conditionRow(progressCopy.verification, eligibility.verificationApproved)}
      {conditionRow(progressCopy.deposit, eligibility.depositEligible, eligibility.qualifyingDepositUsd, 5000, eligibility.depositValuationComplete)}
      {conditionRow(progressCopy.volume, eligibility.tradingVolumeEligible, eligibility.qualifyingTradingVolumeUsd, 50000, eligibility.tradingVolumeValuationComplete)}
    </div>
  ) : null;
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
      {progress}
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
  progressCard: { width: '100%', display: 'flex', flexDirection: 'column', gap: 12, padding: 14, border: '1px solid #2f3240', borderRadius: 12, background: '#171920', boxSizing: 'border-box' },
  progressTitle: { fontSize: 14, lineHeight: 1.4, color: '#f5f5f7' },
  conditionRow: { display: 'flex', flexDirection: 'column', gap: 6 },
  conditionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  conditionLabel: { color: '#d8dae3', fontSize: 13, lineHeight: 1.4 },
  conditionStatus: { color: '#9ea2b1', fontSize: 12, lineHeight: 1.4, textAlign: 'right' },
  conditionDone: { color: '#68dfb0' },
  conditionValue: { color: '#c0c2ce', fontSize: 12, lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' },
  progressTrack: { width: '100%', height: 6, overflow: 'hidden', borderRadius: 999, background: '#292c36' },
  progressFill: { display: 'block', height: '100%', borderRadius: 999, background: '#e6c878', transition: 'width 160ms ease' },
  button: { display: 'inline-flex', justifyContent: 'center', maxWidth: '100%', border: '1px solid #fff', borderRadius: 999, background: '#fff', color: '#0a0a0b', padding: '12px 22px', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, lineHeight: 1.4, cursor: 'pointer', textDecoration: 'none' },
  link: { color: '#e6c878', fontSize: 14, lineHeight: 1.5, textDecoration: 'underline', textUnderlineOffset: 3 },
};
