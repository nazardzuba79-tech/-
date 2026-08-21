import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Nav } from '../components/Nav';
import { COUNTRIES } from '../lib/countries';

interface Submission {
  id: string;
  userEmail: string;
  country: string;
  fullName: string;
  dateOfBirth: string;
  documentType: string;
  documentNumber: string;
  createdAt: string;
}

const DOC_TYPE_LABEL: Record<string, string> = {
  PASSPORT: 'Паспорт',
  ID_CARD: 'ID-картка',
  DRIVERS_LICENSE: "Посвідчення водія",
};

function countryName(code: string) {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/** Admin-only queue for manually reviewing submitted KYC documents. */
export function AdminKycPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentIsPdf, setDocumentIsPdf] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    api.getPendingKyc().then(setSubmissions).catch(() => {});
  }

  useEffect(reload, []);

  useEffect(() => {
    if (!selected) {
      setDocumentUrl(null);
      return;
    }
    let revoked = '';
    api
      .getKycDocument(selected.id)
      .then(({ url, contentType }) => {
        revoked = url;
        setDocumentUrl(url);
        setDocumentIsPdf(contentType === 'application/pdf');
      })
      .catch(() => setDocumentUrl(null));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [selected]);

  async function handleReview(approve: boolean) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.reviewKyc(selected.id, approve, approve ? undefined : reason || undefined);
      setSelected(null);
      setReason('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалось обробити заявку');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.page}>
      <Nav active="/admin/kyc" isAdmin />
      <main style={styles.main}>
        <h1 style={styles.title}>Черга верифікацій ({submissions.length})</h1>

        <div style={styles.grid}>
          <div style={styles.list}>
            {submissions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                style={{
                  ...styles.listItem,
                  ...(selected?.id === s.id ? styles.listItemActive : {}),
                }}
              >
                <span style={{ fontWeight: 600 }}>{s.fullName}</span>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{s.userEmail}</span>
              </button>
            ))}
            {submissions.length === 0 && (
              <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Черга порожня.</p>
            )}
          </div>

          <div style={styles.detail}>
            {selected ? (
              <>
                <Row label="Email" value={selected.userEmail} />
                <Row label="ПІБ" value={selected.fullName} />
                <Row label="Країна" value={countryName(selected.country)} />
                <Row label="Дата народження" value={new Date(selected.dateOfBirth).toLocaleDateString('uk-UA')} />
                <Row label="Документ" value={`${DOC_TYPE_LABEL[selected.documentType] ?? selected.documentType} №${selected.documentNumber}`} />
                <Row label="Надіслано" value={new Date(selected.createdAt).toLocaleString('uk-UA')} />

                <div style={styles.docPreview}>
                  {documentUrl ? (
                    documentIsPdf ? (
                      <a href={documentUrl} target="_blank" rel="noreferrer">Відкрити PDF-документ</a>
                    ) : (
                      <img src={documentUrl} alt="Документ" style={styles.docImage} />
                    )
                  ) : (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Завантаження документа...</span>
                  )}
                </div>

                <label style={styles.label}>
                  Причина відхилення (опційно)
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={styles.input}
                    placeholder="напр. Розмите фото документа"
                  />
                </label>

                {error && <div style={styles.errorBox}>{error}</div>}

                <div style={styles.actions}>
                  <button disabled={busy} onClick={() => handleReview(true)} style={styles.approveBtn}>
                    Підтвердити
                  </button>
                  <button disabled={busy} onClick={() => handleReview(false)} style={styles.rejectBtn}>
                    Відхилити
                  </button>
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--text-tertiary)' }}>Обери заявку зі списку зліва</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.row}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 1000, margin: '0 auto' },
  title: { fontSize: 20, marginBottom: 20 },
  grid: { display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' },
  list: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  listItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  listItemActive: { background: 'var(--panel-alt)' },
  detail: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  row: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' },
  docPreview: {
    marginTop: 8,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 10,
    display: 'flex',
    justifyContent: 'center',
    minHeight: 120,
    alignItems: 'center',
  },
  docImage: { maxWidth: '100%', maxHeight: 320, borderRadius: 4 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '9px 10px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  errorBox: { background: 'var(--sell-dim)', color: 'var(--sell)', padding: '8px 10px', borderRadius: 4, fontSize: 12 },
  actions: { display: 'flex', gap: 10, marginTop: 4 },
  approveBtn: {
    flex: 1,
    background: 'var(--buy)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 4,
    padding: '10px 0',
    fontWeight: 700,
    fontSize: 13,
  },
  rejectBtn: {
    flex: 1,
    background: 'transparent',
    color: 'var(--sell)',
    border: '1px solid var(--sell)',
    borderRadius: 4,
    padding: '10px 0',
    fontWeight: 700,
    fontSize: 13,
  },
};
