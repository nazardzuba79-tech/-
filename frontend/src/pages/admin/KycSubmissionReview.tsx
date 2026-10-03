import { useEffect, useRef, useState } from 'react';
import { api, ApiError, getToken, onSessionChange } from '../../lib/api';
import { getAdminKycDocumentAbortable } from '../../lib/adminReadApi';
import { getCountryName } from '../../lib/countries';
import { styles } from './adminStyles';
import { Badge } from '../../components/Badge';
import { AdminModal } from './AdminPrimitives';

export const DOC_TYPE_LABEL: Record<string, string> = {
  PASSPORT: 'Паспорт',
  ID_CARD: 'ID-карта',
  DRIVERS_LICENSE: 'Водительское удостоверение',
};

/** What the user reads under their rejected verification when the file was lost on the server. */
export const REUPLOAD_REASON = 'Документ не дошёл до проверки по технической причине. Пожалуйста, загрузите его повторно.';

export interface KycSubmissionView {
  id: string;
  fullName: string;
  country: string;
  dateOfBirth: string;
  documentType: string;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  /** EMAIL: the KYC edge mailed the document to the admin (nothing on this server).
   *  LEGACY_FILE: uploaded to the server before the edge; preview still works. */
  documentDelivery?: 'EMAIL' | 'LEGACY_FILE' | 'NONE';
  emailMessageId?: string | null;
  documentMimeType?: string | null;
  documentSizeBytes?: number | null;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: 'right', minWidth: 0, maxWidth: '65%', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

/**
 * ОДНА ЗАЯВКА НА ВЕРИФИКАЦИЮ — всё, что ввёл пользователь, сам документ и
 * решение. Одна и та же карточка в очереди «Верификация · KYC» и в карточке
 * пользователя, чтобы заявку можно было проверить там, где её увидели.
 */
export function KycSubmissionReview({ submission, email, onReviewed }: {
  submission: KycSubmissionView;
  email?: string;
  onReviewed: () => void;
}) {
  const [session, setSession] = useState(getToken);
  const [documentState, setDocumentState] = useState<{ id: string; session: string | null; url: string | null; pdf: boolean; missing: boolean; error: string | null } | null>(null);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const currentId = useRef(submission.id);
  currentId.current = submission.id;
  const [decision, setDecision] = useState<{ approve: boolean; reason: string; id: string; session: string | null } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const emailed = submission.documentDelivery === 'EMAIL';
  const activeDocument = documentState?.id === submission.id && documentState.session === session && session === getToken() ? documentState : null;
  const documentUrl = activeDocument?.url;
  const documentIsPdf = activeDocument?.pdf;
  const documentMissing = activeDocument?.missing;

  useEffect(() => onSessionChange(() => { setSession(getToken()); setDecision(null); setError(null); }), []);
  useEffect(() => { setDecision(null); setUncertain(false); setReason(''); setError(null); }, [submission.id, submission.status]);

  useEffect(() => {
    setDocumentState(null);
    // New submissions: the document is in the admin mailbox, not on this server — no request at all.
    if (emailed) return;
    if (!session || session !== getToken()) return;
    let revoked = '';
    let cancelled = false;
    const controller = new AbortController();
    const owns = () => !cancelled && currentId.current === submission.id && getToken() === session;
    const timer = setTimeout(() => {
      if (!owns()) return;
      cancelled = true;
      controller.abort();
      setDocumentState({ id: submission.id, session, url: null, pdf: false, missing: false, error: 'Истекло время ожидания загрузки документа.' });
    }, 15_000);
    getAdminKycDocumentAbortable(submission.id, controller.signal)
      .then(blob => {
        if (!owns()) return;
        revoked = URL.createObjectURL(blob);
        setDocumentState({ id: submission.id, session, url: revoked, pdf: blob.type === 'application/pdf', missing: false, error: null });
      })
      .catch(err => {
        if (!owns()) return;
        const missing = err?.status === 404;
        setDocumentState({ id: submission.id, session, url: null, pdf: false, missing,
          error: missing ? null : err?.status === 401 ? 'Сессия завершена. Войдите снова.' : err?.status === 403 ? 'Нет доступа к документу.' : 'Не удалось загрузить документ. Повторите запрос.' });
      }).finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [submission.id, emailed, documentRevision, session]);

  function requestDecision(approve: boolean, why = reason.trim()) {
    if (busyRef.current || uncertain) return;
    setDecision({ approve, reason: why, id: submission.id, session: getToken() });
    setError(null);
  }

  async function review() {
    if (!decision || busyRef.current || uncertain || !decision.session || decision.session !== getToken() || decision.id !== submission.id) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.reviewKyc(decision.id, decision.approve, decision.approve ? undefined : decision.reason || undefined);
      if (decision.id !== currentId.current || decision.session !== getToken()) return;
      setDecision(null);
      onReviewed();
    } catch (err) {
      if (decision.id !== currentId.current || decision.session !== getToken()) return;
      const unknown = !(err instanceof ApiError) || err.status >= 500;
      setUncertain(unknown);
      setError(unknown ? 'Результат решения неизвестен. Проверьте исходную заявку; повторная отправка заблокирована.' : err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function closeDecision() { if (!busyRef.current) setDecision(null); }

  const pending = submission.status === 'PENDING';

  return (
    <div data-kyc-review={submission.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {email && <Row label="Email" value={email} />}
      <Row label="ФИО" value={submission.fullName} />
      <Row label="Страна" value={`${getCountryName(submission.country, 'ru')} (${submission.country})`} />
      <Row label="Дата рождения" value={new Date(submission.dateOfBirth).toLocaleDateString('ru-RU')} />
      <Row label="Документ" value={DOC_TYPE_LABEL[submission.documentType] ?? submission.documentType} />
      <Row label="Подана (Europe/Kyiv)" value={new Date(submission.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' })} />
      {submission.reviewedAt && <Row label="Проверена (Europe/Kyiv)" value={new Date(submission.reviewedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' })} />}
      {submission.status === 'REJECTED' && submission.rejectionReason && (
        <Row label="Причина отказа" value={submission.rejectionReason} />
      )}

      <div
        data-kyc-document
        style={{
          background: 'var(--panel-alt)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 8,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 160,
        }}
      >
        {emailed ? (
          <div data-kyc-document-emailed style={{ fontSize: 12.5, lineHeight: 1.6, textAlign: 'center', color: 'var(--text-primary)' }}>
            <b>Документ отправлен на email администратора</b>
            <div style={{ color: 'var(--text-secondary)' }}>Это состояние отправки заявки; получение письма в почтовом ящике здесь не подтверждается.</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              Письмо «[KYC] Новая заявка — {submission.fullName}{email ? ` — ${email}` : ''}»
              {submission.documentMimeType && <> · {submission.documentMimeType === 'application/pdf' ? 'PDF' : submission.documentMimeType === 'image/png' ? 'PNG' : 'JPEG'}</>}
              {submission.documentSizeBytes ? <> · {formatSize(submission.documentSizeBytes)}</> : null}
            </div>
            {submission.emailMessageId && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11, wordBreak: 'break-all' }}>Message-ID: {submission.emailMessageId}</div>
            )}
          </div>
        ) : documentMissing ? (
          <span style={{ color: 'var(--sell)', fontSize: 12, textAlign: 'center', lineHeight: 1.5 }}>
            Документ не найден в защищённом хранилище (404).
            {pending && <><br />Проверьте заявку перед запросом повторной загрузки. Пользователь увидит причину и сможет загрузить документ ещё раз.</>}
          </span>
        ) : activeDocument?.error ? (
          <div>
            <p role="alert" style={styles.errorBox}>{activeDocument.error}</p>
            <button type="button" style={styles.neutralBtn} onClick={() => setDocumentRevision(value => value + 1)}>Повторить загрузку документа</button>
          </div>
        ) : documentUrl ? (
          documentIsPdf ? (
            <a href={documentUrl} target="_blank" rel="noreferrer">Открыть PDF</a>
          ) : (
            <a href={documentUrl} target="_blank" rel="noreferrer" title="Открыть в полном размере">
              <img src={documentUrl} alt="Документ" style={{ maxWidth: '100%', maxHeight: 520, borderRadius: 4, display: 'block' }} />
            </a>
          )
        ) : (
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Загрузка документа…</span>
        )}
      </div>

      {pending ? (
        <>
          <label style={styles.label}>
            Причина отказа (необязательно)
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={styles.input}
              placeholder="Например: нечитаемый документ"
              maxLength={500}
            />
          </label>
          {error && !decision && <div role="alert" style={styles.errorBox}>{error}</div>}
          {uncertain && !decision && <button type="button" style={styles.neutralBtn} onClick={onReviewed}>Проверить заявку</button>}
          {documentMissing && (
            <button
              type="button"
              data-kyc-request-reupload
              disabled={busy || uncertain}
              onClick={() => requestDecision(false, REUPLOAD_REASON)}
              style={{ ...styles.rejectBtn, width: '100%' }}
            >
              Запросить документ заново
            </button>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" disabled={busy || uncertain} onClick={() => requestDecision(true)} style={{ ...styles.approveBtn, flex: 1 }}>
              Проверено
            </button>
            <button type="button" disabled={busy || uncertain} onClick={() => requestDecision(false)} style={{ ...styles.rejectBtn, flex: 1 }}>
              Отклонить
            </button>
          </div>
        </>
      ) : (
        <Badge
          text={submission.status === 'APPROVED' ? 'Одобрено' : 'Отклонено'}
          color={submission.status === 'APPROVED' ? 'var(--buy)' : 'var(--sell)'}
          bg={submission.status === 'APPROVED' ? 'var(--buy-dim)' : 'var(--sell-dim)'}
        />
      )}
      {decision && decision.id === submission.id && decision.session === getToken() && <AdminModal title={decision.approve ? 'Подтвердить проверку личности' : 'Отклонить заявку на проверку'} busy={busy} onClose={closeDecision}>
        <div className="admin-modal-body">
          <Row label="Пользователь" value={email ?? '—'} />
          <Row label="ФИО" value={submission.fullName} />
          <Row label="ID заявки" value={submission.id} />
          <Row label="Документ" value={DOC_TYPE_LABEL[submission.documentType] ?? submission.documentType} />
          <Row label="Подана (Europe/Kyiv)" value={new Date(submission.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' })} />
          <p style={styles.hint}>{decision.approve ? 'Личность будет отмечена как проверенная. Убедитесь, что проверили документ именно этого пользователя.' : 'Заявка будет отклонена. Пользователь увидит причину отказа.'}</p>
          {!decision.approve && <Row label="Причина" value={decision.reason || 'Не указана'} />}
          {error && <div role="alert" style={styles.errorBox}>{error}</div>}
          {uncertain && <button type="button" style={styles.neutralBtn} onClick={() => { setDecision(null); onReviewed(); }}>Проверить заявку</button>}
        </div>
        <footer>
          <button type="button" style={styles.neutralBtn} disabled={busy} onClick={closeDecision}>Отмена</button>
          {!uncertain && <button type="button" style={decision.approve ? styles.approveBtn : styles.rejectBtn} disabled={busy} onClick={() => void review()}>{busy ? 'Сохраняем…' : 'Подтвердить решение'}</button>}
        </footer>
      </AdminModal>}
    </div>
  );
}
