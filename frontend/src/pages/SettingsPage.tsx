import { useEffect, useState, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { SearchInput } from '../components/SearchInput';
import { Badge } from '../components/Badge';
import { getCountries, getCountryName } from '../lib/countries';
import { Footer } from '../components/Footer';
import { Skeleton, SkeletonRow } from '../components/Skeleton';

type Tab = 'profile' | 'security' | 'verification' | 'api' | 'clients' | 'deposits' | 'withdrawals';
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
      <main
        style={{
          ...styles.main,
          maxWidth: tab === 'clients' || tab === 'api' || tab === 'deposits' || tab === 'withdrawals' ? 1080 : 760,
        }}
      >
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
            {isAdmin && (
              <TabButton label={t('settings.tab.deposits')} active={tab === 'deposits'} onClick={() => setTab('deposits')} />
            )}
            {isAdmin && (
              <TabButton
                label={t('settings.tab.withdrawals')}
                active={tab === 'withdrawals'}
                onClick={() => setTab('withdrawals')}
              />
            )}
          </div>

          <div style={styles.content}>
            {tab === 'profile' && <ProfileTab />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'verification' && <VerificationTab />}
            {tab === 'api' && <ApiKeysTab />}
            {tab === 'clients' && isAdmin && <ClientsTab />}
            {tab === 'deposits' && isAdmin && <DepositsTab />}
            {tab === 'withdrawals' && isAdmin && <WithdrawalsTab />}
          </div>
        </div>

        <Footer />
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

  if (!me) {
    return (
      <div className="accent-edge surface-raised" style={styles.card}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={styles.row}>
            <Skeleton width={110} height={12} />
            <Skeleton width={140} height={12} />
          </div>
        ))}
      </div>
    );
  }

  const kyc = KYC_STATUS_LABEL[me.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED;

  return (
    <div className="accent-edge surface-raised" style={styles.card}>
      <Row label={t('settings.email')} value={me.email} />
      <Row label={t('settings.memberSince')} value={new Date(me.createdAt).toLocaleDateString(localeOf(lang))} />
      <Row label={t('settings.role')} value={me.isAdmin ? t('settings.roleAdmin') : t('settings.roleUser')} />
      <Row label={t('settings.verification')} value={<Badge text={kyc.text} color={kyc.color} bg={kyc.bg} />} />
      <Row
        label={t('settings.twoFactor')}
        value={
          me.twoFactorEnabled ? (
            <Badge text={t('settings.enabled')} color="var(--buy)" bg="var(--buy-dim)" />
          ) : (
            <Badge text={t('settings.disabled')} color="var(--text-tertiary)" bg="var(--neutral-dim)" />
          )
        }
      />
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="surface-raised" style={styles.card}>
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

        <TwoFactorSection />
      </div>

      <ReservesSection />
      <SecurityLogSection />
    </div>
  );
}

function coverageColor(ratio: number | null): { color: string; bg: string } {
  if (ratio === null) return { color: 'var(--text-tertiary)', bg: 'var(--neutral-dim)' };
  if (ratio >= 1) return { color: 'var(--buy)', bg: 'var(--buy-dim)' };
  if (ratio >= 0.9) return { color: 'var(--accent)', bg: 'var(--accent-dim)' };
  return { color: 'var(--sell)', bg: 'var(--sell-dim)' };
}

function ReservesSection() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.getReserves>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getReserves()
      .then(setRows)
      .catch(() => setError(t('settings.reservesLoadError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="surface-raised" style={styles.card}>
      <h3 style={styles.cardTitle}>{t('settings.reserves')}</h3>
      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0 }}>
        {t('settings.reservesDisclaimer')}
      </p>

      {error && <div style={styles.errorBox}>{error}</div>}
      {!error && !rows && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SkeletonRow columns={[1, 1, 2, 2, 1]} />
          <SkeletonRow columns={[1, 1, 2, 2, 1]} />
        </div>
      )}
      {rows && rows.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.reservesEmpty')}</p>}

      {rows && rows.length > 0 && (
        <table style={styles.keyTable}>
          <thead>
            <tr>
              <th style={styles.th}>{t('settings.reserves.chain')}</th>
              <th style={styles.th}>{t('settings.reserves.asset')}</th>
              <th style={styles.th}>{t('settings.reserves.liabilities')}</th>
              <th style={styles.th}>{t('settings.reserves.onChain')}</th>
              <th style={styles.th}>{t('settings.reserves.coverage')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = coverageColor(r.coverageRatio);
              return (
                <tr key={`${r.chain}-${r.asset}`}>
                  <td style={styles.td}>{r.chain}</td>
                  <td style={styles.td}>{r.asset}</td>
                  <td style={styles.td} className="mono">
                    {parseFloat(r.internalLiabilities).toFixed(8)}
                  </td>
                  <td style={styles.td} className="mono">
                    {r.onChainBalance !== null ? parseFloat(r.onChainBalance).toFixed(8) : t('settings.reserves.unavailable')}
                  </td>
                  <td style={styles.td}>
                    <Badge
                      text={r.coverageRatio !== null ? `${(r.coverageRatio * 100).toFixed(1)}%` : t('settings.reserves.unavailable')}
                      color={c.color}
                      bg={c.bg}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Parses the browser's own User-Agent string down to a short, readable
// "Browser · OS" label — good enough for a security log to be scannable
// without pulling in a full UA-parsing dependency for this one field.
function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  let browser = 'Unknown';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let os = 'Unknown OS';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} · ${os}`;
}

function SecurityLogSection() {
  const { t, lang } = useLanguage();
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof api.getSecurityLog>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const EVENT_LABEL: Record<string, string> = {
    USER_LOGGED_IN: t('settings.securityLog.USER_LOGGED_IN'),
    USER_REGISTERED: t('settings.securityLog.USER_REGISTERED'),
    PASSWORD_CHANGED: t('settings.securityLog.PASSWORD_CHANGED'),
    TWO_FACTOR_ENABLED: t('settings.securityLog.TWO_FACTOR_ENABLED'),
    TWO_FACTOR_DISABLED: t('settings.securityLog.TWO_FACTOR_DISABLED'),
    TWO_FACTOR_BACKUP_CODE_USED: t('settings.securityLog.TWO_FACTOR_BACKUP_CODE_USED'),
  };

  useEffect(() => {
    api
      .getSecurityLog()
      .then(setEntries)
      .catch(() => setError(t('settings.securityLogLoadError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="surface-raised" style={styles.card}>
      <h3 style={styles.cardTitle}>{t('settings.securityLog')}</h3>

      {error && <div style={styles.errorBox}>{error}</div>}
      {!error && !entries && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SkeletonRow columns={[1, 1, 1, 1]} />
          <SkeletonRow columns={[1, 1, 1, 1]} />
          <SkeletonRow columns={[1, 1, 1, 1]} />
        </div>
      )}
      {entries && entries.length === 0 && (
        <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.securityLogEmpty')}</p>
      )}

      {entries && entries.length > 0 && (
        <table style={styles.keyTable}>
          <thead>
            <tr>
              <th style={styles.th}>{t('settings.securityLog.event')}</th>
              <th style={styles.th}>{t('settings.securityLog.time')}</th>
              <th style={styles.th}>{t('settings.securityLog.ip')}</th>
              <th style={styles.th}>{t('settings.securityLog.device')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={styles.td}>{EVENT_LABEL[e.action] ?? e.action}</td>
                <td style={styles.td}>{new Date(e.createdAt).toLocaleString(localeOf(lang))}</td>
                <td style={styles.td} className="mono">
                  {e.metadata?.ip || t('settings.securityLog.unknown')}
                </td>
                <td style={styles.td}>{summarizeUserAgent(e.metadata?.userAgent) ?? t('settings.securityLog.unknown')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

type SetupState = { secret: string; otpauthUrl: string; qrCodeDataUrl: string };

function TwoFactorSection() {
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    api.getMe().then((me) => setEnabled(me.twoFactorEnabled)).catch(() => {});
  }

  useEffect(reload, []);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.setup2FA();
      setSetup(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.twoFaGenericError'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.verify2FA(code);
      setBackupCodes(res.backupCodes);
      setSetup(null);
      setCode('');
      setEnabled(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.twoFaGenericError'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.disable2FA(disableCode);
      setEnabled(false);
      setDisabling(false);
      setDisableCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.twoFaGenericError'));
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;

  // Just finished enabling — show the one-time backup codes and nothing else
  // until the user acknowledges saving them (they're never shown again).
  if (backupCodes) {
    return (
      <div style={styles.twoFaBlock}>
        <h3 style={styles.cardTitle}>{t('settings.backupCodesTitle')}</h3>
        <p style={styles.twoFaLead}>{t('settings.backupCodesHint')}</p>
        <div style={styles.backupCodesGrid} className="mono">
          {backupCodes.map((c) => (
            <span key={c} style={styles.backupCode}>
              {c}
            </span>
          ))}
        </div>
        <button style={styles.submitBtn} onClick={() => setBackupCodes(null)}>
          {t('settings.backupCodesSaved')}
        </button>
      </div>
    );
  }

  return (
    <div style={styles.twoFaBlock}>
      <div style={styles.twoFaHeader}>
        <h3 style={styles.cardTitle}>{t('settings.twoFactor')}</h3>
        {enabled ? (
          <Badge text={t('settings.enabled')} color="var(--buy)" bg="var(--buy-dim)" />
        ) : (
          <Badge text={t('settings.disabled')} color="var(--text-tertiary)" bg="var(--neutral-dim)" />
        )}
      </div>
      <p style={styles.twoFaLead}>{t('settings.twoFaLead')}</p>

      {!enabled && !setup && (
        <button style={styles.submitBtn} onClick={startSetup} disabled={busy}>
          {busy ? t('auth.wait') : t('settings.enable2fa')}
        </button>
      )}

      {!enabled && setup && (
        <form onSubmit={confirmSetup} style={styles.form}>
          <div style={styles.qrRow}>
            <img src={setup.qrCodeDataUrl} alt="QR" style={styles.qrImage} />
            <div style={styles.qrInfo}>
              <p style={styles.twoFaHint}>{t('settings.scanQr')}</p>
              <div style={styles.twoFaSecretBox} className="mono">
                {setup.secret}
              </div>
              <p style={styles.twoFaHint}>{t('settings.orEnterManually')}</p>
            </div>
          </div>
          <label style={styles.label}>
            {t('auth.twoFaCode')}
            <input
              type="text"
              required
              autoFocus
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ ...styles.input, fontFamily: 'var(--font-mono)', letterSpacing: '0.2em' }}
              placeholder="123456"
            />
          </label>
          {error && <div style={styles.errorBox}>{error}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={busy} style={{ ...styles.submitBtn, flex: 1 }}>
              {busy ? t('auth.wait') : t('auth.confirm')}
            </button>
            <button type="button" style={{ ...styles.cancelBtn, flex: 1 }} onClick={() => setSetup(null)}>
              {t('settings.cancel')}
            </button>
          </div>
        </form>
      )}

      {enabled && !disabling && (
        <button style={styles.dangerBtn} onClick={() => setDisabling(true)}>
          {t('settings.disable2fa')}
        </button>
      )}

      {enabled && disabling && (
        <form onSubmit={confirmDisable} style={styles.form}>
          <label style={styles.label}>
            {t('auth.twoFaCode')}
            <input
              type="text"
              required
              autoFocus
              autoComplete="one-time-code"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              style={{ ...styles.input, fontFamily: 'var(--font-mono)', letterSpacing: '0.2em' }}
              placeholder="123456"
            />
          </label>
          {error && <div style={styles.errorBox}>{error}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={busy} style={{ ...styles.dangerBtn, flex: 1 }}>
              {busy ? t('auth.wait') : t('settings.disable2fa')}
            </button>
            <button type="button" style={{ ...styles.cancelBtn, flex: 1 }} onClick={() => setDisabling(false)}>
              {t('settings.cancel')}
            </button>
          </div>
        </form>
      )}
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

  if (!status) {
    return (
      <div className="surface-raised" style={styles.card}>
        <Skeleton width={160} height={24} radius={12} />
        <Skeleton width="100%" height={40} />
        <Skeleton width="100%" height={40} />
        <Skeleton width="60%" height={40} />
      </div>
    );
  }

  const badge = KYC_STATUS_LABEL[status.kycStatus] ?? KYC_STATUS_LABEL.NOT_STARTED;
  const canSubmit = status.kycStatus === 'NOT_STARTED' || status.kycStatus === 'REJECTED';
  const DOC_TYPE_LABEL = docTypeLabel(t);

  return (
    <div className="surface-raised" style={styles.card}>
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
      <div className="surface-raised" style={styles.card}>
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

      <div className="surface-raised" style={styles.card}>
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

      <div className="surface-raised" style={styles.card}>
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

/**
 * Manual deposit crediting — replaces asking the client to find and paste a
 * tx hash. "Нові надходження" is a live read of the treasury address's
 * actual on-chain activity (see adminDeposits.ts / listIncoming on each
 * verifier); picking a client + clicking "Зарахувати" re-verifies that
 * specific transfer on-chain and credits it — the feed itself never
 * directly moves money, it's just what makes finding the tx hash the
 * admin's job instead of the client's.
 */
function DepositsTab() {
  const { t, lang } = useLanguage();
  const [incoming, setIncoming] = useState<Awaited<ReturnType<typeof api.getAdminIncomingDeposits>>>([]);
  const [incomingLoaded, setIncomingLoaded] = useState(false);
  const [incomingError, setIncomingError] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.getAdminDeposits>>>([]);
  const [clients, setClients] = useState<Awaited<ReturnType<typeof api.getAllClients>>>([]);
  const [pickedUser, setPickedUser] = useState<Record<string, string>>({});
  const [creditingKey, setCreditingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reloadIncoming() {
    api
      .getAdminIncomingDeposits()
      .then((res) => {
        setIncoming(res);
        setIncomingError(false);
      })
      .catch(() => setIncomingError(true))
      .finally(() => setIncomingLoaded(true));
  }

  useEffect(() => {
    reloadIncoming();
    api.getAdminDeposits().then(setHistory).catch(() => {});
    api.getAllClients().then(setClients).catch(() => {});
  }, []);

  async function handleCredit(t2: { chain: string; txHash: string; asset: string }) {
    const key = `${t2.chain}:${t2.txHash}`;
    const userId = pickedUser[key];
    if (!userId) return;
    setError(null);
    setCreditingKey(key);
    try {
      await api.creditDepositManually({ userId, chain: t2.chain, txHash: t2.txHash, asset: t2.asset });
      reloadIncoming();
      api.getAdminDeposits().then(setHistory).catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.deposits.creditError'));
    } finally {
      setCreditingKey(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h3 style={styles.sectionTitle}>{t('settings.deposits.incomingTitle')}</h3>
        {error && <div style={styles.errorBox}>{error}</div>}
        <div className="surface-raised" style={styles.depositsTable}>
          <div style={styles.depositsHeader}>
            <span>{t('settings.deposits.chain')}</span>
            <span>{t('settings.deposits.asset')}</span>
            <span style={{ textAlign: 'right' }}>{t('settings.deposits.amount')}</span>
            <span style={{ textAlign: 'right' }}>{t('settings.deposits.confirmations')}</span>
            <span>{t('settings.deposits.txHash')}</span>
            <span>{t('settings.deposits.creditTo')}</span>
            <span />
          </div>
          {incoming.map((tr) => {
            const key = `${tr.chain}:${tr.txHash}`;
            return (
              <div key={key} style={styles.depositsRow}>
                <span>{tr.chain}</span>
                <span className="mono">{tr.asset}</span>
                <span className="mono" style={{ textAlign: 'right' }}>{tr.amount}</span>
                <span className="mono" style={{ textAlign: 'right' }}>{tr.confirmations}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={tr.txHash}>
                  {tr.txHash.slice(0, 10)}…
                </span>
                <select
                  value={pickedUser[key] ?? ''}
                  onChange={(e) => setPickedUser((prev) => ({ ...prev, [key]: e.target.value }))}
                  style={styles.input}
                >
                  <option value="">{t('settings.deposits.pickClient')}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.email}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!pickedUser[key] || creditingKey === key}
                  onClick={() => handleCredit(tr)}
                  style={styles.approveBtn}
                >
                  {creditingKey === key ? t('settings.deposits.crediting') : t('settings.deposits.credit')}
                </button>
              </div>
            );
          })}
          {incomingLoaded && !incomingError && incoming.length === 0 && (
            <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.deposits.noIncoming')}</p>
          )}
          {incomingError && <p style={{ padding: 14, color: 'var(--sell)', fontSize: 12 }}>{t('settings.deposits.incomingLoadError')}</p>}
          {!incomingLoaded && <Skeleton height={80} />}
        </div>
      </div>

      <div>
        <h3 style={styles.sectionTitle}>{t('settings.deposits.historyTitle')}</h3>
        <div className="surface-raised" style={{ ...styles.depositsTable, gridTemplateColumns: undefined }}>
          <div style={{ ...styles.depositsHeader, gridTemplateColumns: '1.2fr 1.6fr 0.8fr 0.8fr 1fr 1fr 1.4fr' }}>
            <span>{t('settings.deposits.date')}</span>
            <span>{t('settings.deposits.client')}</span>
            <span>{t('settings.deposits.asset')}</span>
            <span>{t('settings.deposits.chain')}</span>
            <span style={{ textAlign: 'right' }}>{t('settings.deposits.amount')}</span>
            <span>{t('settings.deposits.status')}</span>
            <span>{t('settings.deposits.txHash')}</span>
          </div>
          {history.map((d) => (
            <div key={d.id} style={{ ...styles.depositsRow, gridTemplateColumns: '1.2fr 1.6fr 0.8fr 0.8fr 1fr 1fr 1.4fr' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(d.createdAt).toLocaleString(localeOf(lang))}</span>
              <span style={{ fontSize: 12 }}>{d.userEmail}</span>
              <span className="mono">{d.asset}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.chain}</span>
              <span className="mono" style={{ textAlign: 'right' }}>{d.amount}</span>
              <span style={{ fontSize: 12 }}>{d.status}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={d.txHash}>
                {d.txHash.slice(0, 10)}…
              </span>
            </div>
          ))}
          {history.length === 0 && <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.deposits.noHistory')}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Manual withdrawal fulfillment — the reverse of DepositsTab. A client's
 * request already locked their balance (see WithdrawalService); the admin
 * sends the crypto by hand from the treasury wallet outside this app
 * entirely, then comes back here to mark the request completed (releases
 * the lock) or rejected (returns the funds to the client's available
 * balance).
 */
function WithdrawalsTab() {
  const { t, lang } = useLanguage();
  const [withdrawals, setWithdrawals] = useState<Awaited<ReturnType<typeof api.getAdminWithdrawals>>>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api
      .getAdminWithdrawals()
      .then(setWithdrawals)
      .finally(() => setLoaded(true));
  }

  useEffect(reload, []);

  const pending = withdrawals.filter((w) => w.status === 'PENDING');

  async function handleComplete(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await api.completeWithdrawal(id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.withdrawals.actionError'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    const reason = window.prompt(t('settings.withdrawals.rejectPrompt')) ?? undefined;
    setError(null);
    setBusyId(id);
    try {
      await api.rejectWithdrawal(id, reason || undefined);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.withdrawals.actionError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h3 style={styles.sectionTitle}>{t('settings.withdrawals.pendingTitle')}</h3>
        {error && <div style={styles.errorBox}>{error}</div>}
        <div className="surface-raised" style={styles.depositsTable}>
          <div style={{ ...styles.depositsHeader, gridTemplateColumns: '1.6fr 0.8fr 0.8fr 1.6fr 1fr 1.2fr' }}>
            <span>{t('settings.deposits.client')}</span>
            <span>{t('settings.deposits.asset')}</span>
            <span>{t('settings.withdrawals.network')}</span>
            <span>{t('settings.withdrawals.address')}</span>
            <span style={{ textAlign: 'right' }}>{t('settings.deposits.amount')}</span>
            <span />
          </div>
          {pending.map((w) => (
            <div key={w.id} style={{ ...styles.depositsRow, gridTemplateColumns: '1.6fr 0.8fr 0.8fr 1.6fr 1fr 1.2fr' }}>
              <span style={{ fontSize: 12 }}>{w.userEmail}</span>
              <span className="mono">{w.asset}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{w.network}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={w.toAddress}>
                {w.toAddress}
              </span>
              <span className="mono" style={{ textAlign: 'right' }}>{w.amount}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={busyId === w.id} onClick={() => handleComplete(w.id)} style={styles.approveBtn}>
                  {t('settings.withdrawals.complete')}
                </button>
                <button disabled={busyId === w.id} onClick={() => handleReject(w.id)} style={styles.rejectBtn}>
                  {t('settings.withdrawals.reject')}
                </button>
              </div>
            </div>
          ))}
          {loaded && pending.length === 0 && (
            <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.withdrawals.noPending')}</p>
          )}
          {!loaded && <Skeleton height={80} />}
        </div>
      </div>

      <div>
        <h3 style={styles.sectionTitle}>{t('settings.withdrawals.historyTitle')}</h3>
        <div className="surface-raised" style={{ ...styles.depositsTable, gridTemplateColumns: undefined }}>
          <div style={{ ...styles.depositsHeader, gridTemplateColumns: '1.2fr 1.6fr 0.8fr 1.6fr 1fr 1fr' }}>
            <span>{t('settings.deposits.date')}</span>
            <span>{t('settings.deposits.client')}</span>
            <span>{t('settings.deposits.asset')}</span>
            <span>{t('settings.withdrawals.address')}</span>
            <span style={{ textAlign: 'right' }}>{t('settings.deposits.amount')}</span>
            <span>{t('settings.deposits.status')}</span>
          </div>
          {withdrawals.map((w) => (
            <div key={w.id} style={{ ...styles.depositsRow, gridTemplateColumns: '1.2fr 1.6fr 0.8fr 1.6fr 1fr 1fr' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{new Date(w.createdAt).toLocaleString(localeOf(lang))}</span>
              <span style={{ fontSize: 12 }}>{w.userEmail}</span>
              <span className="mono">{w.asset}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={w.toAddress}>
                {w.toAddress}
              </span>
              <span className="mono" style={{ textAlign: 'right' }}>{w.amount}</span>
              <span style={{ fontSize: 12 }} title={w.rejectionReason ?? undefined}>
                {w.status}
              </span>
            </div>
          ))}
          {withdrawals.length === 0 && (
            <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.withdrawals.noHistory')}</p>
          )}
        </div>
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
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, margin: '0 0 10px' },
  depositsTable: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
    overflowX: 'auto',
  },
  depositsHeader: {
    display: 'grid',
    gridTemplateColumns: '0.8fr 0.7fr 1fr 1fr 1.2fr 1.6fr 1fr',
    minWidth: 900,
    padding: '10px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
    gap: 8,
  },
  depositsRow: {
    display: 'grid',
    gridTemplateColumns: '0.8fr 0.7fr 1fr 1fr 1.2fr 1.6fr 1fr',
    minWidth: 900,
    padding: '10px 14px',
    fontSize: 13,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
    gap: 8,
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
    padding: 16,
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
  cardTitle: { fontSize: 14, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.01em' },
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
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 24,
    padding: '11px 0',
    fontWeight: 800,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
  },
  cancelBtn: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 24,
    padding: '11px 0',
    fontWeight: 700,
    fontSize: 14,
  },
  dangerBtn: {
    background: 'transparent',
    color: 'var(--sell)',
    border: '1px solid var(--sell)',
    borderRadius: 24,
    padding: '11px 22px',
    fontWeight: 800,
    fontSize: 13,
  },
  twoFaBlock: {
    borderTop: '1px solid var(--border)',
    marginTop: 20,
    paddingTop: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  twoFaHeader: { display: 'flex', alignItems: 'center', gap: 10 },
  twoFaLead: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 },
  twoFaHint: { fontSize: 12, color: 'var(--text-tertiary)', margin: 0 },
  qrRow: { display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' },
  qrImage: {
    width: 160,
    height: 160,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: '#fff',
    padding: 8,
    flexShrink: 0,
  },
  qrInfo: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 },
  twoFaSecretBox: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    wordBreak: 'break-all',
  },
  backupCodesGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 16,
  },
  backupCode: { fontSize: 14, letterSpacing: '0.05em', textAlign: 'center', padding: '4px 0' },
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
    padding: 8,
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
    color: 'var(--on-accent)',
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
