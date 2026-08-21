import { useEffect, useState, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { Nav } from '../components/Nav';
import { COUNTRIES } from '../lib/countries';

type Tab = 'profile' | 'security' | 'verification';

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
      <Nav active="/settings" isAdmin={isAdmin} />
      <main style={styles.main}>
        <h1 style={styles.title}>Налаштування</h1>

        <div style={styles.layout}>
          <div style={styles.tabs}>
            <TabButton label="Профіль" active={tab === 'profile'} onClick={() => setTab('profile')} />
            <TabButton label="Безпека" active={tab === 'security'} onClick={() => setTab('security')} />
            <TabButton label="Верифікація" active={tab === 'verification'} onClick={() => setTab('verification')} />
          </div>

          <div style={styles.content}>
            {tab === 'profile' && <ProfileTab />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'verification' && <VerificationTab />}
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
};
