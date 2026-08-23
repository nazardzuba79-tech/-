import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import { Badge } from '../../components/Badge';

type Client = Awaited<ReturnType<typeof api.getAllClients>>[number];

const DOC_TYPE_LABEL: Record<string, string> = {
  PASSPORT: 'Паспорт',
  ID_CARD: 'ID-карта',
  DRIVERS_LICENSE: 'Водительское удостоверение',
};

/** Верификация (KYC) — очередь заявок на проверку: кто подал, когда,
 * документы прямо в админке, одобрить/отклонить с причиной. */
export function AdminKycPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentIsPdf, setDocumentIsPdf] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    api.getAllClients().then(setClients).catch(() => {});
  }

  useEffect(reload, []);

  const queue = clients.filter((c) => c.latestKyc && (showAll || c.latestKyc.status === 'PENDING'));
  const selected = queue.find((c) => c.id === selectedId) ?? queue[0] ?? null;

  useEffect(() => {
    if (!selected?.latestKyc) {
      setDocumentUrl(null);
      return;
    }
    let revoked = '';
    api
      .getKycDocument(selected.latestKyc.id)
      .then(({ url, contentType }) => {
        revoked = url;
        setDocumentUrl(url);
        setDocumentIsPdf(contentType === 'application/pdf');
      })
      .catch(() => setDocumentUrl(null));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [selected?.latestKyc?.id]);

  async function handleReview(approve: boolean) {
    if (!selected?.latestKyc) return;
    setBusy(true);
    setError(null);
    try {
      await api.reviewKyc(selected.latestKyc.id, approve, approve ? undefined : reason || undefined);
      setReason('');
      setSelectedId(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось выполнить проверку.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={styles.title}>Верификация (KYC)</h1>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16, color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Показать все заявки, не только ожидающие проверки
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ ...styles.table, maxHeight: 640, overflowY: 'auto' }}>
          {queue.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="row-hover"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                width: '100%',
                textAlign: 'left',
                background: (selected?.id === c.id) ? 'var(--panel-alt)' : 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border)',
                padding: '10px 14px',
                color: 'var(--text-primary)',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>{c.email}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {c.latestKyc && new Date(c.latestKyc.createdAt).toLocaleString('ru-RU')} · {c.latestKyc?.status}
              </span>
            </button>
          ))}
          {queue.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Заявок нет.</p>}
        </div>

        <div style={styles.card}>
          {!selected?.latestKyc ? (
            <p style={{ color: 'var(--text-tertiary)' }}>Выберите заявку слева.</p>
          ) : (
            <>
              <div style={styles.row}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Email</span>
                <span style={{ fontSize: 13 }}>{selected.email}</span>
              </div>
              <div style={styles.row}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>ФИО</span>
                <span style={{ fontSize: 13 }}>{selected.latestKyc.fullName}</span>
              </div>
              <div style={styles.row}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Страна</span>
                <span style={{ fontSize: 13 }}>{selected.latestKyc.country}</span>
              </div>
              <div style={styles.row}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Дата рождения</span>
                <span style={{ fontSize: 13 }}>{new Date(selected.latestKyc.dateOfBirth).toLocaleDateString('ru-RU')}</span>
              </div>
              <div style={styles.row}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Документ</span>
                <span style={{ fontSize: 13 }}>
                  {DOC_TYPE_LABEL[selected.latestKyc.documentType] ?? selected.latestKyc.documentType}
                </span>
              </div>
              <div style={styles.row}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Подана</span>
                <span style={{ fontSize: 13 }}>{new Date(selected.latestKyc.createdAt).toLocaleString('ru-RU')}</span>
              </div>
              {selected.latestKyc.status === 'REJECTED' && selected.latestKyc.rejectionReason && (
                <div style={styles.row}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Причина отказа</span>
                  <span style={{ fontSize: 13 }}>{selected.latestKyc.rejectionReason}</span>
                </div>
              )}

              <div
                style={{
                  marginTop: 4,
                  background: 'var(--panel-alt)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 8,
                  display: 'flex',
                  justifyContent: 'center',
                  minHeight: 160,
                  alignItems: 'center',
                }}
              >
                {documentUrl ? (
                  documentIsPdf ? (
                    <a href={documentUrl} target="_blank" rel="noreferrer">Открыть PDF</a>
                  ) : (
                    <img src={documentUrl} alt="Документ" style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 4 }} />
                  )
                ) : (
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Загрузка документа…</span>
                )}
              </div>

              {selected.latestKyc.status === 'PENDING' && (
                <>
                  <label style={styles.label}>
                    Причина отказа (необязательно)
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      style={styles.input}
                      placeholder="Например: нечитаемый документ"
                    />
                  </label>

                  {error && <div style={styles.errorBox}>{error}</div>}

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button disabled={busy} onClick={() => handleReview(true)} style={{ ...styles.approveBtn, flex: 1 }}>
                      Одобрить
                    </button>
                    <button disabled={busy} onClick={() => handleReview(false)} style={{ ...styles.rejectBtn, flex: 1 }}>
                      Отклонить
                    </button>
                  </div>
                </>
              )}

              {selected.latestKyc.status !== 'PENDING' && (
                <Badge
                  text={selected.latestKyc.status === 'APPROVED' ? 'Одобрено' : 'Отклонено'}
                  color={selected.latestKyc.status === 'APPROVED' ? 'var(--buy)' : 'var(--sell)'}
                  bg={selected.latestKyc.status === 'APPROVED' ? 'var(--buy-dim)' : 'var(--sell-dim)'}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
