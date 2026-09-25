import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { getCountryName } from '../../lib/countries';
import { styles } from './adminStyles';
import { Badge } from '../../components/Badge';

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
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: 'right' }}>{value}</span>
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
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentIsPdf, setDocumentIsPdf] = useState(false);
  const [documentMissing, setDocumentMissing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDocumentUrl(null);
    setDocumentMissing(false);
    setReason('');
    setError(null);
    let revoked = '';
    let cancelled = false;
    api
      .getKycDocument(submission.id)
      .then(({ url, contentType }) => {
        if (cancelled) { URL.revokeObjectURL(url); return; }
        revoked = url;
        setDocumentUrl(url);
        setDocumentIsPdf(contentType === 'application/pdf');
      })
      .catch(() => { if (!cancelled) setDocumentMissing(true); });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [submission.id]);

  async function review(approve: boolean, why = reason.trim()) {
    setBusy(true);
    setError(null);
    try {
      await api.reviewKyc(submission.id, approve, approve ? undefined : why || undefined);
      onReviewed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить решение.');
    } finally {
      setBusy(false);
    }
  }

  const pending = submission.status === 'PENDING';

  return (
    <div data-kyc-review={submission.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {email && <Row label="Email" value={email} />}
      <Row label="ФИО" value={submission.fullName} />
      <Row label="Страна" value={`${getCountryName(submission.country, 'ru')} (${submission.country})`} />
      <Row label="Дата рождения" value={new Date(submission.dateOfBirth).toLocaleDateString('ru-RU')} />
      <Row label="Документ" value={DOC_TYPE_LABEL[submission.documentType] ?? submission.documentType} />
      <Row label="Подана" value={new Date(submission.createdAt).toLocaleString('ru-RU')} />
      {submission.reviewedAt && <Row label="Проверена" value={new Date(submission.reviewedAt).toLocaleString('ru-RU')} />}
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
        {documentMissing ? (
          <span style={{ color: 'var(--sell)', fontSize: 12, textAlign: 'center', lineHeight: 1.5 }}>
            Документ на бирже не хранится — его копия приходит на почту администратора в момент подачи заявки.
            Ищите письмо «[KYC] Новая заявка на верификацию» с этим именем.
            {pending && <><br />Если письма нет, запросите документ заново — пользователь увидит причину и сможет загрузить его ещё раз.</>}
          </span>
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
          {error && <div style={styles.errorBox}>{error}</div>}
          {documentMissing && (
            <button
              type="button"
              data-kyc-request-reupload
              disabled={busy}
              onClick={() => review(false, REUPLOAD_REASON)}
              style={{ ...styles.rejectBtn, width: '100%' }}
            >
              Запросить документ заново
            </button>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" disabled={busy} onClick={() => review(true)} style={{ ...styles.approveBtn, flex: 1 }}>
              Одобрить
            </button>
            <button type="button" disabled={busy} onClick={() => review(false)} style={{ ...styles.rejectBtn, flex: 1 }}>
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
    </div>
  );
}
