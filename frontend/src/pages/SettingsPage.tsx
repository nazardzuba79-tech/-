import { useEffect, useState, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { Nav } from '../components/Nav';
import { COUNTRIES } from '../lib/countries';

type Tab = 'profile' | 'security' | 'verification' | 'clients';

const DOC_TYPE_LABEL: Record<string, string> = {
  PASSPORT: 'Паспорт',
  ID_CARD: 'ID-картка',
  DRIVERS_LICENSE: 'Посвідчення водія',
};

const KYC_STATUS_LABEL: Record<string, { text: string; color: string }> = {
  NOT_STARTED: { text: 'Не розпочато', color: 'var(--text-secondary)' },
  PENDING: { text: 'На розгляді', color: 'var(--accent)' },
  APPROVED: { text: 'Верифіковано', color: 'var(--buy)' },
  REJECTED: { text: 'Відхилено', color: 'var(--sell)' },
};

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('profile');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    api.getMe().then((me) => setIsAdmin(me.isAdmin)).catch(() => {});
  }, []);

  return (
    <div style={styles.page}>
      <Nav active="/settings" />
      <main style={{ ...styles.main, maxWidth: tab === 'clients' ? 1080 : 760 }}>
        <h1 style={styles.title}>Налаштування</h1>

        <div style={styles.layout}>
          <div style={styles.tabs}>
            <TabButton label="Профіль" active={tab === 'profile'} onClick={() => setTab('profile')} />
            <TabButton label="Безпека" active={tab === 'security'} onClick={() => setTab('security')} />
            <TabButton label="Верифікація" active={tab === 'verification'} onClick={() => setTab('verification')} />
            {isAdmin && (
              <TabButton label="Клієнти" active={tab === 'clients'} onClick={() => setTab('clients')} />
            )}
          </div>

          <div style={styles.content}>
            {tab === 'profile' && <ProfileTab />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'verification' && <VerificationTab />}
            {tab === 'clients' && isAdmin && <ClientsTab />}
          </div>
        </div>
      </main>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...styles.tabBtn, ...(active ? styles.tabBtnActive : {}) }}>
      {label}
    </button>
  );
}

function ProfileTab() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.getMe>> | null>(null);

  useEffect(() => {
    api.getMe().then(setMe).catch(() => {});
  }, []);

  if (!me) return <p style={{ color: 'var(--text-tertiary)' }}>Завантаження...</p>;

  const kyc = KYC_STATUS_LABEL[me.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED;

  return (
    <div style={styles.card}>
      <Row label="Email" value={me.email} />
      <Row label="Учасник з" value={new Date(me.createdAt).toLocaleDateString('uk-UA')} />
      <Row label="Роль" value={me.isAdmin ? 'Адміністратор' : 'Користувач'} />
      <Row label="Верифікація" value={<span style={{ color: kyc.color, fontWeight: 600 }}>{kyc.text}</span>} />
      <Row label="Двофакторна автентифікація" value={<span style={{ color: 'var(--text-tertiary)' }}>Незабаром</span>} />
    </div>
  );
}

function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалось змінити пароль');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Зміна пароля</h3>
      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Поточний пароль
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={styles.input}
            autoComplete="current-password"
          />
        </label>
        <label style={styles.label}>
          Новий пароль
          <input
            type="password"
            required
            minLength={10}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={styles.input}
            autoComplete="new-password"
          />
          <span style={styles.hint}>Мінімум 10 символів</span>
        </label>

        {error && <div style={styles.errorBox}>{error}</div>}
        {success && <div style={styles.successBox}>Пароль змінено</div>}

        <button type="submit" disabled={submitting} style={styles.submitBtn}>
          {submitting ? 'Зачекай...' : 'Зберегти'}
        </button>
      </form>
    </div>
  );
}

function VerificationTab() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.getMyKyc>> | null>(null);
  const [country, setCountry] = useState('UA');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [documentType, setDocumentType] = useState<'PASSPORT' | 'ID_CARD' | 'DRIVERS_LICENSE'>('PASSPORT');
  const [documentNumber, setDocumentNumber] = useState('');
  const [document, setDocument] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reload() {
    api.getMyKyc().then(setStatus).catch(() => {});
  }

  useEffect(reload, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!document) {
      setError('Додай фото документа');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitKyc({ country, fullName, dateOfBirth, documentType, documentNumber, document });
      setFullName('');
      setDateOfBirth('');
      setDocumentNumber('');
      setDocument(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалось надіслати заявку');
    } finally {
      setSubmitting(false);
    }
  }

  if (!status) return <p style={{ color: 'var(--text-tertiary)' }}>Завантаження...</p>;

  const badge = KYC_STATUS_LABEL[status.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED;
  const canSubmit = status.kycStatus === 'NOT_STARTED' || status.kycStatus === 'REJECTED';

  return (
    <div style={styles.card}>
      <div style={styles.kycStatusRow}>
        <span style={{ color: 'var(--text-secondary)' }}>Статус верифікації</span>
        <span style={{ color: badge.color, fontWeight: 700 }}>{badge.text}</span>
      </div>

      {status.latestSubmission?.status === 'REJECTED' && status.latestSubmission.rejectionReason && (
        <div style={styles.errorBox}>Причина відхилення: {status.latestSubmission.rejectionReason}</div>
      )}

      {!canSubmit ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {status.kycStatus === 'APPROVED'
            ? 'Твій акаунт вже верифіковано.'
            : 'Заявка на розгляді — очікуй на рішення адміністратора.'}
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Країна
            <select value={country} onChange={(e) => setCountry(e.target.value)} style={styles.input}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Повне ім'я (як у документі)
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Дата народження
            <input
              type="date"
              required
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Тип документа
            <select value={documentType} onChange={(e) => setDocumentType(e.target.value as typeof documentType)} style={styles.input}>
              <option value="PASSPORT">Паспорт</option>
              <option value="ID_CARD">ID-картка</option>
              <option value="DRIVERS_LICENSE">Посвідчення водія</option>
            </select>
          </label>
          <label style={styles.label}>
            Номер документа
            <input
              type="text"
              required
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Фото документа (JPEG, PNG або PDF)
            <input
              type="file"
              required
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
              style={styles.fileInput}
            />
          </label>

          {error && <div style={styles.errorBox}>{error}</div>}

          <button type="submit" disabled={submitting} style={styles.submitBtn}>
            {submitting ? 'Надсилаємо...' : 'Надіслати на перевірку'}
          </button>
        </form>
      )}
    </div>
  );
}

function countryName(code: string) {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/** Admin-only: every registered client and their KYC data — approve/reject pending submissions. */
function ClientsTab() {
  const [clients, setClients] = useState<Awaited<ReturnType<typeof api.getAllClients>>>([]);
  const [search, setSearch] = useState('');
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

  const selected = clients.find((c) => c.id === selectedId) ?? null;

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
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалось обробити заявку');
    } finally {
      setBusy(false);
    }
  }

  const filtered = clients.filter((c) => c.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={styles.clientsGrid}>
      <div style={styles.clientsList}>
        <input
          placeholder="Пошук за email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...styles.input, margin: 10, width: 'calc(100% - 20px)' }}
        />
        {filtered.map((c) => {
          const badge = KYC_STATUS_LABEL[c.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              style={{ ...styles.clientRow, ...(c.id === selectedId ? styles.clientRowActive : {}) }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>{c.email}</span>
              <span style={{ color: badge.color, fontSize: 11 }}>{badge.text}</span>
            </button>
          );
        })}
        {filtered.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>Нікого не знайдено.</p>}
      </div>

      <div style={styles.card}>
        {!selected ? (
          <p style={{ color: 'var(--text-tertiary)' }}>Обери клієнта зі списку зліва</p>
        ) : (
          <>
            <Row label="Email" value={selected.email} />
            <Row label="Роль" value={selected.isAdmin ? 'Адміністратор' : 'Користувач'} />
            <Row label="Учасник з" value={new Date(selected.createdAt).toLocaleDateString('uk-UA')} />
            <Row
              label="Верифікація"
              value={
                <span style={{ color: (KYC_STATUS_LABEL[selected.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED).color, fontWeight: 600 }}>
                  {(KYC_STATUS_LABEL[selected.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED).text}
                </span>
              }
            />

            {selected.latestKyc ? (
              <>
                <Row label="ПІБ" value={selected.latestKyc.fullName} />
                <Row label="Країна" value={countryName(selected.latestKyc.country)} />
                <Row label="Дата народження" value={new Date(selected.latestKyc.dateOfBirth).toLocaleDateString('uk-UA')} />
                <Row
                  label="Документ"
                  value={`${DOC_TYPE_LABEL[selected.latestKyc.documentType] ?? selected.latestKyc.documentType} №${selected.latestKyc.documentNumber}`}
                />
                <Row label="Надіслано" value={new Date(selected.latestKyc.createdAt).toLocaleString('uk-UA')} />
                {selected.latestKyc.status === 'REJECTED' && selected.latestKyc.rejectionReason && (
                  <Row label="Причина відхилення" value={selected.latestKyc.rejectionReason} />
                )}

                <div style={styles.docPreview}>
                  {documentUrl ? (
                    documentIsPdf ? (
                      <a href={documentUrl} target="_blank" rel="noreferrer">
                        Відкрити PDF-документ
                      </a>
                    ) : (
                      <img src={documentUrl} alt="Документ" style={styles.docImage} />
                    )
                  ) : (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Завантаження документа...</span>
                  )}
                </div>

                {selected.latestKyc.status === 'PENDING' && (
                  <>
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
                )}
              </>
            ) : (
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>Цей клієнт ще не подавав заявку на верифікацію.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 760, margin: '0 auto' },
  title: { fontSize: 20, marginBottom: 20 },
  layout: { display: 'grid', gridTemplateColumns: '180px 1fr', gap: 24, alignItems: 'start' },
  tabs: { display: 'flex', flexDirection: 'column', gap: 4 },
  tabBtn: {
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    padding: '9px 12px',
    fontSize: 13,
    color: 'var(--text-secondary)',
  },
  tabBtnActive: {
    background: 'var(--panel)',
    color: 'var(--text-primary)',
    fontWeight: 600,
  },
  content: { minWidth: 0 },
  card: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  cardTitle: { fontSize: 14, margin: 0 },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid var(--border)',
  },
  kycStatusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--text-secondary)' },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '9px 10px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  fileInput: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '9px 10px',
    color: 'var(--text-primary)',
    fontSize: 12,
  },
  hint: { fontSize: 11, color: 'var(--text-tertiary)' },
  errorBox: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 10px',
    borderRadius: 4,
    fontSize: 12,
  },
  successBox: {
    background: 'var(--buy-dim)',
    color: 'var(--buy)',
    padding: '8px 10px',
    borderRadius: 4,
    fontSize: 12,
  },
  submitBtn: {
    background: 'var(--accent)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 4,
    padding: '11px 0',
    fontWeight: 700,
    fontSize: 14,
  },
  clientsGrid: { display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' },
  clientsList: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
    maxHeight: 600,
    overflowY: 'auto',
  },
  clientRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderTop: '1px solid var(--border)',
    padding: '10px 14px',
    color: 'var(--text-primary)',
  },
  clientRowActive: { background: 'var(--panel-alt)' },
  docPreview: {
    marginTop: 4,
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
