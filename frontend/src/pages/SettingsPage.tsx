import { useEffect, useState, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { SearchInput } from '../components/SearchInput';
import { Badge } from '../components/Badge';
import { getCountries, getCountryName } from '../lib/countries';

type Tab = 'profile' | 'security' | 'verification' | 'api' | 'clients';
type T = ReturnType<typeof useLanguage>['t'];

function kycStatusLabel(t: T): Record<string, { text: string; color: string; bg: string }> {
  return {
    NOT_STARTED: { text: t('settings.kyc.NOT_STARTED'), color: 'var(--text-secondary)', bg: 'var(--neutral-dim)' },
    PENDING: { text: t('settings.kyc.PENDING'), color: 'var(--accent)', bg: 'var(--accent-dim)' },
    APPROVED: { text: t('settings.kyc.APPROVED'), color: 'var(--buy)', bg: 'var(--buy-dim)' },
    REJECTED: { text: t('settings.kyc.REJECTED'), color: 'var(--sell)', bg: 'var(--sell-dim)' },
  };
}

function docTypeLabel(t: T): Record<string, string> {
  return {
    PASSPORT: t('settings.doc.PASSPORT'),
    ID_CARD: t('settings.doc.ID_CARD'),
    DRIVERS_LICENSE: t('settings.doc.DRIVERS_LICENSE'),
  };
}

export function SettingsPage() {
  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<Tab>('profile');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    api.getMe().then((me) => setIsAdmin(me.isAdmin)).catch(() => {});
  }, []);

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/settings" />
      <main style={{ ...styles.main, maxWidth: tab === 'clients' || tab === 'api' ? 1080 : 760 }}>
        <h1 style={styles.title}>{t('settings.title')}</h1>

        <div style={styles.layout}>
          <div style={styles.tabs}>
            <TabButton label={t('settings.tab.profile')} active={tab === 'profile'} onClick={() => setTab('profile')} />
            <TabButton label={t('settings.tab.security')} active={tab === 'security'} onClick={() => setTab('security')} />
            <TabButton label={t('settings.tab.verification')} active={tab === 'verification'} onClick={() => setTab('verification')} />
            <TabButton label={t('settings.tab.api')} active={tab === 'api'} onClick={() => setTab('api')} />
            {isAdmin && (
              <TabButton label={t('settings.tab.clients')} active={tab === 'clients'} onClick={() => setTab('clients')} />
            )}
          </div>

          <div style={styles.content}>
            {tab === 'profile' && <ProfileTab />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'verification' && <VerificationTab />}
            {tab === 'api' && <ApiKeysTab />}
            {tab === 'clients' && isAdmin && <ClientsTab />}
          </div>
        </div>
      </main>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="row-hover" style={{ ...styles.tabBtn, ...(active ? styles.tabBtnActive : {}) }}>
      {label}
    </button>
  );
}

function ProfileTab() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.getMe>> | null>(null);

  useEffect(() => {
    api.getMe().then(setMe).catch(() => {});
  }, []);

  const { t, lang } = useLanguage();
  const KYC_STATUS_LABEL = kycStatusLabel(t);

  if (!me) return <p style={{ color: 'var(--text-tertiary)' }}>{t('trade.loading')}</p>;

  const kyc = KYC_STATUS_LABEL[me.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED;

  return (
    <div className="accent-edge" style={styles.card}>
      <Row label={t('settings.email')} value={me.email} />
      <Row label={t('settings.memberSince')} value={new Date(me.createdAt).toLocaleDateString(localeOf(lang))} />
      <Row label={t('settings.role')} value={me.isAdmin ? t('settings.roleAdmin') : t('settings.roleUser')} />
      <Row label={t('settings.verification')} value={<Badge text={kyc.text} color={kyc.color} bg={kyc.bg} />} />
      <Row label={t('settings.twoFactor')} value={<span style={{ color: 'var(--text-tertiary)' }}>{t('settings.comingSoon')}</span>} />
    </div>
  );
}

function SecurityTab() {
  const { t } = useLanguage();
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
      setError(err instanceof ApiError ? err.message : t('settings.changePasswordError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>{t('settings.changePassword')}</h3>
      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          {t('settings.currentPassword')}
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
          {t('settings.newPassword')}
          <input
            type="password"
            required
            minLength={10}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={styles.input}
            autoComplete="new-password"
          />
          <span style={styles.hint}>{t('auth.minChars')}</span>
        </label>

        {error && <div style={styles.errorBox}>{error}</div>}
        {success && <div style={styles.successBox}>{t('settings.passwordChanged')}</div>}

        <button type="submit" disabled={submitting} style={styles.submitBtn}>
          {submitting ? t('auth.wait') : t('settings.save')}
        </button>
      </form>
    </div>
  );
}

function VerificationTab() {
  const { t, lang } = useLanguage();
  const KYC_STATUS_LABEL = kycStatusLabel(t);
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
      setError(t('settings.addDocumentPhoto'));
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
      setError(err instanceof ApiError ? err.message : t('settings.submitKycError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!status) return <p style={{ color: 'var(--text-tertiary)' }}>{t('trade.loading')}</p>;

  const badge = KYC_STATUS_LABEL[status.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED;
  const canSubmit = status.kycStatus === 'NOT_STARTED' || status.kycStatus === 'REJECTED';
  const DOC_TYPE_LABEL = docTypeLabel(t);

  return (
    <div style={styles.card}>
      <div style={styles.kycStatusRow}>
        <span style={{ color: 'var(--text-secondary)' }}>{t('settings.verificationStatus')}</span>
        <Badge text={badge.text} color={badge.color} bg={badge.bg} />
      </div>

      {status.latestSubmission?.status === 'REJECTED' && status.latestSubmission.rejectionReason && (
        <div style={styles.errorBox}>{t('settings.rejectionReason', { reason: status.latestSubmission.rejectionReason })}</div>
      )}

      {!canSubmit ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {status.kycStatus === 'APPROVED' ? t('settings.alreadyVerified') : t('settings.pendingReview')}
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            {t('settings.country')}
            <select value={country} onChange={(e) => setCountry(e.target.value)} style={styles.input}>
              {getCountries(lang).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            {t('settings.fullName')}
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            {t('settings.dateOfBirth')}
            <input
              type="date"
              required
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            {t('settings.documentType')}
            <select value={documentType} onChange={(e) => setDocumentType(e.target.value as typeof documentType)} style={styles.input}>
              <option value="PASSPORT">{DOC_TYPE_LABEL.PASSPORT}</option>
              <option value="ID_CARD">{DOC_TYPE_LABEL.ID_CARD}</option>
              <option value="DRIVERS_LICENSE">{DOC_TYPE_LABEL.DRIVERS_LICENSE}</option>
            </select>
          </label>
          <label style={styles.label}>
            {t('settings.documentNumber')}
            <input
              type="text"
              required
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            {t('settings.documentPhoto')}
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
            {submitting ? t('settings.sending') : t('settings.sendForReview')}
          </button>
        </form>
      )}
    </div>
  );
}

/** Admin-only: every registered client and their KYC data — approve/reject pending submissions. */
/** API keys for connecting a trading bot/script to this account — HMAC-signed requests, see the code example below. */
function ApiKeysTab() {
  const { t } = useLanguage();
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof api.getApiKeys>>>([]);
  const [label, setLabel] = useState('');
  const [canTrade, setCanTrade] = useState(false);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<Awaited<ReturnType<typeof api.createApiKey>> | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.getApiKeys().then(setKeys).catch(() => {});
  }

  useEffect(reload, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await api.createApiKey(label, canTrade);
      setJustCreated(created);
      setLabel('');
      setCanTrade(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.createKeyError'));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm(t('settings.revokeConfirm'))) return;
    await api.revokeApiKey(id).catch(() => {});
    reload();
  }

  async function handleCopySecret() {
    if (!justCreated) return;
    await navigator.clipboard.writeText(justCreated.apiSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>{t('settings.apiKeys')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
          {t('settings.apiKeysDesc')}
        </p>

        {justCreated && (
          <div style={styles.secretBox}>
            <div style={{ fontSize: 12, color: 'var(--sell)', fontWeight: 700, marginBottom: 8 }}>
              {t('settings.secretShownOnce')}
            </div>
            <Row label={t('settings.apiKey')} value={<span className="mono">{justCreated.apiKey}</span>} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span className="mono" style={{ flex: 1, fontSize: 12, wordBreak: 'break-all' }}>
                {justCreated.apiSecret}
              </span>
              <button type="button" onClick={handleCopySecret} style={styles.copyBtn}>
                {copied ? t('deposit.copied') : t('deposit.copy')}
              </button>
            </div>
          </div>
        )}

        <table style={styles.keyTable}>
          <thead>
            <tr>
              <th style={styles.th}>{t('settings.keyName')}</th>
              <th style={styles.th}>{t('settings.keyValue')}</th>
              <th style={styles.th}>{t('settings.keyRights')}</th>
              <th style={styles.th}>{t('settings.keyLastUsed')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td style={styles.td}>{k.label}</td>
                <td style={styles.td} className="mono">
                  {k.apiKey}
                </td>
                <td style={styles.td}>
                  {k.canTrade ? (
                    <Badge text={t('settings.readWrite')} color="var(--buy)" bg="var(--buy-dim)" />
                  ) : (
                    <Badge text={t('settings.readOnly')} color="var(--text-secondary)" bg="var(--neutral-dim)" />
                  )}
                </td>
                <td style={styles.td}>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : t('settings.neverUsed')}</td>
                <td style={styles.td}>
                  <button onClick={() => handleRevoke(k.id)} style={styles.revokeBtn}>
                    {t('settings.revoke')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {keys.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.noKeysYet')}</p>}

        <form onSubmit={handleCreate} style={{ ...styles.form, marginTop: 20 }}>
          <label style={styles.label}>
            {t('settings.keyNameLabel')}
            <input
              type="text"
              required
              placeholder={t('settings.keyNamePlaceholder')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={canTrade} onChange={(e) => setCanTrade(e.target.checked)} />
            {t('settings.allowTrading')}
          </label>

          {error && <div style={styles.errorBox}>{error}</div>}

          <button type="submit" disabled={creating} style={{ ...styles.submitBtn, alignSelf: 'flex-start', padding: '10px 20px' }}>
            {creating ? t('settings.creating') : t('settings.createKey')}
          </button>
        </form>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>{t('settings.howToConnectBot')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {t('settings.hmacExplainer1')}{' '}
          <code style={styles.code}>X-API-KEY</code>, <code style={styles.code}>X-API-TIMESTAMP</code> {t('settings.hmacExplainer2')}{' '}
          <code style={styles.code}>X-API-SIGNATURE</code> {t('settings.hmacExplainer3')}{' '}
          <code style={styles.code}>timestamp + method + path + JSON body</code> {t('settings.hmacExplainer4')} <code style={styles.code}>{'{}'}</code>{' '}
          {t('settings.hmacExplainer5')}
        </p>
        <pre style={styles.codeBlock}>
{`import hmac, hashlib, time, json, requests

api_key = "ak_..."
api_secret = "..."
timestamp = str(int(time.time() * 1000))
method = "POST"
path = "/api/v1/orders"
body = {"pair": "BTC/USDT", "side": "BUY", "price": "60000", "quantity": "0.01"}

message = timestamp + method + path + json.dumps(body)
signature = hmac.new(api_secret.encode(), message.encode(), hashlib.sha256).hexdigest()

requests.post(
    "https://yourdomain.com" + path,
    json=body,
    headers={
        "X-API-KEY": api_key,
        "X-API-TIMESTAMP": timestamp,
        "X-API-SIGNATURE": signature,
    },
)`}
        </pre>
      </div>
    </div>
  );
}

function ClientsTab() {
  const { t, lang } = useLanguage();
  const KYC_STATUS_LABEL = kycStatusLabel(t);
  const DOC_TYPE_LABEL = docTypeLabel(t);
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
      setError(err instanceof ApiError ? err.message : t('settings.reviewKycError'));
    } finally {
      setBusy(false);
    }
  }

  const filtered = clients.filter((c) => c.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={styles.clientsGrid}>
      <div style={styles.clientsList}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('settings.searchByEmail')}
          style={{ margin: 10, width: 'calc(100% - 20px)' }}
        />
        {filtered.map((c) => {
          const badge = KYC_STATUS_LABEL[c.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="row-hover"
              style={{ ...styles.clientRow, ...(c.id === selectedId ? styles.clientRowActive : {}) }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>{c.email}</span>
              <Badge text={badge.text} color={badge.color} bg={badge.bg} />
            </button>
          );
        })}
        {filtered.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.noOneFound')}</p>}
      </div>

      <div style={styles.card}>
        {!selected ? (
          <p style={{ color: 'var(--text-tertiary)' }}>{t('settings.selectClient')}</p>
        ) : (
          <>
            <Row label={t('settings.email')} value={selected.email} />
            <Row label={t('settings.role')} value={selected.isAdmin ? t('settings.roleAdmin') : t('settings.roleUser')} />
            <Row label={t('settings.memberSince')} value={new Date(selected.createdAt).toLocaleDateString(localeOf(lang))} />
            <Row
              label={t('settings.verification')}
              value={(() => {
                const b = KYC_STATUS_LABEL[selected.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED;
                return <Badge text={b.text} color={b.color} bg={b.bg} />;
              })()}
            />

            {selected.latestKyc ? (
              <>
                <Row label={t('settings.fullNameLabel')} value={selected.latestKyc.fullName} />
                <Row label={t('settings.country')} value={getCountryName(selected.latestKyc.country, lang)} />
                <Row label={t('settings.dateOfBirth')} value={new Date(selected.latestKyc.dateOfBirth).toLocaleDateString(localeOf(lang))} />
                <Row
                  label={t('settings.document')}
                  value={`${DOC_TYPE_LABEL[selected.latestKyc.documentType] ?? selected.latestKyc.documentType} №${selected.latestKyc.documentNumber}`}
                />
                <Row label={t('settings.sent')} value={new Date(selected.latestKyc.createdAt).toLocaleString(localeOf(lang))} />
                {selected.latestKyc.status === 'REJECTED' && selected.latestKyc.rejectionReason && (
                  <Row label={t('settings.rejectionReasonLabel')} value={selected.latestKyc.rejectionReason} />
                )}

                <div style={styles.docPreview}>
                  {documentUrl ? (
                    documentIsPdf ? (
                      <a href={documentUrl} target="_blank" rel="noreferrer">
                        {t('settings.openPdf')}
                      </a>
                    ) : (
                      <img src={documentUrl} alt={t('settings.document')} style={styles.docImage} />
                    )
                  ) : (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.loadingDocument')}</span>
                  )}
                </div>

                {selected.latestKyc.status === 'PENDING' && (
                  <>
                    <label style={styles.label}>
                      {t('settings.rejectionReasonOptional')}
                      <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        style={styles.input}
                        placeholder={t('settings.rejectionPlaceholder')}
                      />
                    </label>

                    {error && <div style={styles.errorBox}>{error}</div>}

                    <div style={styles.actions}>
                      <button disabled={busy} onClick={() => handleReview(true)} style={styles.approveBtn}>
                        {t('settings.approve')}
                      </button>
                      <button disabled={busy} onClick={() => handleReview(false)} style={styles.rejectBtn}>
                        {t('settings.reject')}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{t('settings.noKycYet')}</p>
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
  secretBox: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--sell)',
    borderRadius: 6,
    padding: 14,
    marginBottom: 20,
  },
  keyTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'left',
    color: 'var(--text-tertiary)',
    fontWeight: 500,
    padding: '6px 8px',
    borderBottom: '1px solid var(--border)',
  },
  td: { padding: '8px', borderBottom: '1px solid var(--border)' },
  revokeBtn: {
    background: 'transparent',
    border: '1px solid var(--sell)',
    color: 'var(--sell)',
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 11,
  },
  code: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    padding: '1px 5px',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
  },
  codeBlock: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 14,
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    overflowX: 'auto',
    lineHeight: 1.6,
  },
  title: { fontSize: 22, marginBottom: 20, fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  layout: { display: 'grid', gridTemplateColumns: '180px 1fr', gap: 24, alignItems: 'start' },
  tabs: { display: 'flex', flexDirection: 'column', gap: 4 },
  tabBtn: {
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
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
    borderRadius: 8,
    padding: '9px 10px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  fileInput: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '9px 10px',
    color: 'var(--text-primary)',
    fontSize: 12,
  },
  hint: { fontSize: 11, color: 'var(--text-tertiary)' },
  errorBox: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
  },
  successBox: {
    background: 'var(--buy-dim)',
    color: 'var(--buy)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
  },
  submitBtn: {
    background: 'var(--accent)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 24,
    padding: '11px 0',
    fontWeight: 800,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
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
    borderRadius: 20,
    padding: '10px 0',
    fontWeight: 700,
    fontSize: 13,
  },
  rejectBtn: {
    flex: 1,
    background: 'transparent',
    color: 'var(--sell)',
    border: '1px solid var(--sell)',
    borderRadius: 20,
    padding: '10px 0',
    fontWeight: 700,
    fontSize: 13,
  },
};
