import { useEffect, useState, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { Badge } from '../components/Badge';
import { getCountries } from '../lib/countries';
import { Footer } from '../components/Footer';
import { Skeleton, SkeletonRow } from '../components/Skeleton';

type Tab = 'profile' | 'security' | 'verification' | 'api' | 'referral';
type T = ReturnType<typeof useLanguage>['t'];

/* Small inline-SVG icon set for the settings sidebar/quick-actions —
   lucide-react isn't a project dependency (see BottomNav.tsx for the same
   pattern), so these are hand-drawn on the same 24x24 stroke grid. */
function iconProps(size = 17) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}
function UserRoundIcon(props: { size?: number }) {
  return (
    <svg {...iconProps(props.size)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.5-4.5 5-7 7.5-7s6 2.5 7.5 7" />
    </svg>
  );
}
function ShieldIcon(props: { size?: number }) {
  return (
    <svg {...iconProps(props.size)}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function BadgeCheckIcon(props: { size?: number }) {
  return (
    <svg {...iconProps(props.size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12l2.3 2.3 4.7-4.7" />
    </svg>
  );
}
function KeyIcon(props: { size?: number }) {
  return (
    <svg {...iconProps(props.size)}>
      <circle cx="8" cy="16" r="3" />
      <path d="M10.3 13.7 20 4" />
      <path d="M15 9l2 2M18 6l2 2" />
    </svg>
  );
}
function UsersIcon(props: { size?: number }) {
  return (
    <svg {...iconProps(props.size)}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3 20c1-3.7 3.5-5.7 6-5.7s5 2 6 5.7" />
      <circle cx="17.5" cy="9.5" r="2.3" />
      <path d="M16.3 14.6c2 .3 3.6 2.1 4.2 5.4" />
    </svg>
  );
}
function HelpCircleIcon(props: { size?: number }) {
  return (
    <svg {...iconProps(props.size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.2a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.2 1-1.2 2.1" />
      <circle cx="12" cy="17.3" r="0.2" fill="currentColor" />
    </svg>
  );
}
function ChevronRightIcon(props: { size?: number }) {
  return (
    <svg {...iconProps(props.size)}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
function ArrowUpRightIcon(props: { size?: number }) {
  return (
    <svg {...iconProps(props.size)}>
      <path d="M7 17L17 7M8 7h9v9" />
    </svg>
  );
}

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
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('profile');

  const TABS: { key: Tab; icon: (p: { size?: number }) => JSX.Element }[] = [
    { key: 'profile', icon: UserRoundIcon },
    { key: 'security', icon: ShieldIcon },
    { key: 'verification', icon: BadgeCheckIcon },
    { key: 'api', icon: KeyIcon },
    { key: 'referral', icon: UsersIcon },
  ];
  const TAB_LABEL: Record<Tab, string> = {
    profile: t('settings.tab.profile'),
    security: t('settings.tab.security'),
    verification: t('settings.tab.verification'),
    api: t('settings.tab.api'),
    referral: t('settings.tab.referral'),
  };

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/settings" />
      <main style={{ ...styles.main, maxWidth: tab === 'api' ? 1080 : 940 }}>
        <div className="settings-layout" style={styles.layout}>
          <aside className="settings-sidebar" style={styles.sidebar}>
            <p style={styles.eyebrow}>{t('settings.accountCenter')}</p>
            <h1 style={styles.title}>{t('settings.title')}</h1>
            <nav style={styles.settingsNav}>
              {TABS.map(({ key, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`settings-nav-link${tab === key ? ' active' : ''}`}
                  style={{ ...styles.navLink, color: tab === key ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                >
                  <Icon />
                  <span>{TAB_LABEL[key]}</span>
                  {tab === key && <span className="settings-nav-pip" />}
                </button>
              ))}
            </nav>
            <div style={styles.sidebarHelp}>
              <HelpCircleIcon />
              <div>
                <strong style={styles.sidebarHelpTitle}>{t('settings.needHelp')}</strong>
                <span style={styles.sidebarHelpDesc}>{t('settings.needHelpDesc')}</span>
              </div>
            </div>
          </aside>

          <div style={styles.content}>
            {tab === 'profile' && <ProfileTab onNavigate={setTab} />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'verification' && <VerificationTab />}
            {tab === 'api' && <ApiKeysTab />}
            {tab === 'referral' && <ReferralTab />}
          </div>
        </div>

        <Footer />
      </main>
    </div>
  );
}

function kycProgressPct(status: string): number {
  if (status === 'APPROVED') return 100;
  if (status === 'PENDING') return 60;
  if (status === 'REJECTED') return 20;
  return 8;
}

function ProfileTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.getMe>> | null>(null);
  const [lastActivity, setLastActivity] = useState<string | null>(null);

  useEffect(() => {
    api.getMe().then(setMe).catch(() => {});
    api
      .getSecurityLog()
      .then((entries) => {
        if (entries[0]) setLastActivity(entries[0].createdAt);
      })
      .catch(() => {});
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
  const displayName = me.displayName || me.email.split('@')[0];
  const progressPct = kycProgressPct(me.kycStatus);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="accent-edge surface-raised" style={styles.profileCard}>
        <div style={styles.profileMain}>
          <div className="settings-avatar" style={styles.avatarLarge}>
            {displayName.charAt(0).toUpperCase()}
            <span className="settings-avatar-shine" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.profileNameRow}>
              <h2 style={styles.profileName}>{displayName}</h2>
              {kyc.text === KYC_STATUS_LABEL.APPROVED.text && (
                <span style={{ color: 'var(--buy)', display: 'inline-flex' }}>
                  <BadgeCheckIcon size={16} />
                </span>
              )}
              {me.isAdmin && <span style={styles.rolePill}>{t('settings.roleAdmin')}</span>}
            </div>
            <p style={styles.profileEmail}>{me.email}</p>
            <div style={styles.profileStatusRow}>
              <Badge text={kyc.text} color={kyc.color} bg={kyc.bg} />
              <span style={styles.statusDivider} />
              <span style={styles.profileMeta}>{t('settings.activeAccount')}</span>
            </div>
          </div>
        </div>
        <div style={styles.memberSince}>
          <span style={styles.memberSinceLabel}>{t('settings.memberSince')}</span>
          <strong style={styles.memberSinceValue}>{new Date(me.createdAt).toLocaleDateString(localeOf(lang))}</strong>
        </div>
      </div>

      <div className="settings-detail-grid" style={styles.detailGrid}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <div className="surface-raised" style={styles.card}>
            <div style={styles.sectionHeading}>
              <p style={styles.eyebrowSmall}>{t('settings.personalDetails')}</p>
              <h3 style={styles.cardTitle}>{t('settings.accountInfoTitle')}</h3>
            </div>
            <div style={styles.infoList}>
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
          </div>

          <div className="surface-raised" style={styles.verificationCard}>
            <span style={styles.verificationIcon}>
              <BadgeCheckIcon />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.verificationTitleRow}>
                <div>
                  <p style={styles.eyebrowSmall}>{t('settings.accountStatusEyebrow')}</p>
                  <h3 style={styles.cardTitle}>{t('settings.tab.verification')}</h3>
                </div>
                <span style={styles.verifiedLabel}>{kyc.text}</span>
              </div>
              <p style={styles.verificationDesc}>
                {me.kycStatus === 'APPROVED' ? t('settings.alreadyVerified') : t('settings.pendingReview')}
              </p>
              <div>
                <div style={styles.progressLabelRow}>
                  <span>{t('settings.accessLevel')}</span>
                  <strong style={{ color: 'var(--buy)' }}>{progressPct}%</strong>
                </div>
                <div className="settings-progress-track">
                  <div className="settings-progress-value" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="surface-raised" style={styles.securityCard}>
          <div style={styles.sectionHeading}>
            <div>
              <p style={styles.eyebrowSmall}>{t('settings.protectionLayer')}</p>
              <h3 style={styles.cardTitle}>{t('settings.accountSecurityTitle')}</h3>
            </div>
            <span style={styles.securityIcon}>
              <ShieldIcon />
            </span>
          </div>
          <div style={styles.securityList}>
            <div style={styles.securityRow}>
              <span>{t('settings.twoFactor')}</span>
              {me.twoFactorEnabled ? (
                <Badge text={t('settings.enabled')} color="var(--buy)" bg="var(--buy-dim)" />
              ) : (
                <Badge text={t('settings.disabled')} color="var(--accent)" bg="var(--accent-dim)" />
              )}
            </div>
            {lastActivity && (
              <div style={styles.securityRow}>
                <span>{t('settings.lastActivity')}</span>
                <strong style={styles.securityRowValue}>{new Date(lastActivity).toLocaleString(localeOf(lang))}</strong>
              </div>
            )}
          </div>
          <button style={styles.submitBtn} onClick={() => onNavigate('security')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <ShieldIcon size={15} /> {me.twoFactorEnabled ? t('settings.tab.security') : t('settings.enable2fa')}{' '}
              <ArrowUpRightIcon size={14} />
            </span>
          </button>
        </div>
      </div>

      <div>
        <div style={styles.sectionHeading}>
          <div>
            <p style={styles.eyebrowSmall}>{t('settings.shortcuts')}</p>
            <h3 style={styles.cardTitle}>{t('settings.quickActionsTitle')}</h3>
          </div>
        </div>
        <div className="settings-quick-grid" style={styles.quickGrid}>
          <QuickActionCard icon={ShieldIcon} title={t('settings.tab.security')} desc={t('settings.quickAction.security.desc')} onClick={() => onNavigate('security')} />
          <QuickActionCard
            icon={BadgeCheckIcon}
            title={t('settings.tab.verification')}
            desc={t('settings.quickAction.verification.desc')}
            onClick={() => onNavigate('verification')}
          />
          <QuickActionCard icon={KeyIcon} title={t('settings.tab.api')} desc={t('settings.quickAction.api.desc')} onClick={() => onNavigate('api')} />
          <QuickActionCard
            icon={UsersIcon}
            title={t('settings.tab.referral')}
            desc={t('settings.quickAction.referral.desc')}
            onClick={() => onNavigate('referral')}
          />
        </div>
      </div>
    </div>
  );
}

function QuickActionCard({
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  icon: (p: { size?: number }) => JSX.Element;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button className="settings-quick-card surface-raised" style={styles.quickCard} onClick={onClick}>
      <span style={styles.quickIcon}>
        <Icon />
      </span>
      <span style={styles.quickCopy}>
        <strong style={{ fontSize: 12 }}>{title}</strong>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10, lineHeight: 1.4 }}>{desc}</span>
      </span>
      <span className="settings-quick-arrow" style={styles.quickArrow}>
        <ChevronRightIcon size={16} />
      </span>
    </button>
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
  const [country, setCountry] = useState('RU');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [documentType, setDocumentType] = useState<'PASSPORT' | 'ID_CARD' | 'DRIVERS_LICENSE'>('PASSPORT');
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
      await api.submitKyc({ country, fullName, dateOfBirth, documentType, document });
      setFullName('');
      setDateOfBirth('');
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

function ReferralTab() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getReferralMe>> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getReferralMe().then(setData).catch(() => {});
  }, []);

  // Built from wherever the page is actually being served — a Render
  // subdomain until a custom domain is pointed at it, whatever real domain
  // after that. Never hardcoded, since a hardcoded name here could easily
  // end up not being the domain the app is actually running on.
  const link = data ? `${window.location.origin}/r/${data.referralCode}` : '';

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!data) return <Skeleton height={200} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="surface-raised" style={styles.card}>
        <h3 style={styles.cardTitle}>{t('settings.referral')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
          {t('settings.referralDesc', { percent: data.rewardPercent })}
        </p>

        <div style={styles.secretBox}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ flex: 1, fontSize: 13, wordBreak: 'break-all' }}>
              {link}
            </span>
            <button type="button" onClick={handleCopy} style={styles.copyBtn}>
              {copied ? t('deposit.copied') : t('deposit.copy')}
            </button>
          </div>
        </div>

        <Row label={t('settings.referralCount')} value={data.referredCount} />

        <h4 style={{ fontSize: 13, margin: '20px 0 8px' }}>{t('settings.referralEarned')}</h4>
        {data.rewardsByAsset.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('settings.referralNoRewardsYet')}</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.rewardsByAsset.map((r) => (
              <span key={r.asset} className="mono" style={styles.referralAssetChip}>
                {parseFloat(r.amount).toLocaleString(localeOf(lang), { maximumFractionDigits: 8 })} {r.asset}
              </span>
            ))}
          </div>
        )}
      </div>

      {data.recentRewards.length > 0 && (
        <div className="surface-raised" style={styles.card}>
          <h3 style={styles.cardTitle}>{t('settings.referralRecentRewards')}</h3>
          <table style={styles.keyTable}>
            <thead>
              <tr>
                <th style={styles.th}>{t('settings.referralRewardDate')}</th>
                <th style={styles.th}>{t('settings.referralRewardAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {data.recentRewards.map((r) => (
                <tr key={r.id}>
                  <td style={styles.td}>{new Date(r.createdAt).toLocaleString(localeOf(lang))}</td>
                  <td style={styles.td} className="mono">
                    {parseFloat(r.amount).toLocaleString(localeOf(lang), { maximumFractionDigits: 8 })} {r.asset}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  secretBox: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--sell)',
    borderRadius: 6,
    padding: 16,
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
    padding: 16,
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    overflowX: 'auto',
    lineHeight: 1.6,
  },
  title: { fontSize: 24, margin: '0 0 28px', fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.02em' },
  layout: { display: 'grid', gridTemplateColumns: '220px 1fr', gap: 32, alignItems: 'start' },
  sidebar: { position: 'sticky', top: 88 },
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.16em',
    color: 'var(--text-tertiary)',
    margin: '0 0 8px',
    textTransform: 'uppercase',
  },
  eyebrowSmall: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    letterSpacing: '0.14em',
    color: 'var(--text-tertiary)',
    margin: '0 0 6px',
    textTransform: 'uppercase',
  },
  settingsNav: { display: 'grid', gap: 5 },
  navLink: {
    minHeight: 42,
    padding: '0 13px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'transparent',
    borderRadius: 9,
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'left',
  },
  sidebarHelp: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    marginTop: 48,
    paddingTop: 16,
    borderTop: '1px solid var(--border)',
    color: 'var(--text-tertiary)',
  },
  sidebarHelpTitle: { display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 },
  sidebarHelpDesc: { display: 'block', fontSize: 10 },
  content: { minWidth: 0 },
  profileCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 20,
    padding: '26px 28px',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
  },
  profileMain: { display: 'flex', alignItems: 'center', gap: 18 },
  avatarLarge: {
    position: 'relative',
    width: 68,
    height: 68,
    flex: 'none',
    display: 'grid',
    placeItems: 'center',
    borderRadius: '50%',
    fontSize: 28,
    fontWeight: 800,
    color: 'var(--on-accent)',
  },
  profileNameRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  profileName: { fontSize: 20, margin: 0, letterSpacing: '-0.02em' },
  profileEmail: { margin: '3px 0 0', color: 'var(--text-tertiary)', fontSize: 12 },
  profileStatusRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 },
  statusDivider: { width: 1, height: 12, background: 'var(--border)' },
  profileMeta: { color: 'var(--text-tertiary)', fontSize: 11 },
  rolePill: {
    border: '1px solid var(--accent-dim)',
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    borderRadius: 5,
    fontSize: 10,
    padding: '3px 7px',
    fontFamily: 'var(--font-mono)',
  },
  memberSince: {
    minWidth: 130,
    paddingLeft: 24,
    borderLeft: '1px solid var(--border)',
    display: 'grid',
    gap: 6,
  },
  memberSinceLabel: { color: 'var(--text-tertiary)', fontSize: 10 },
  memberSinceValue: { fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 400 },
  detailGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(260px, 0.9fr)', gap: 16 },
  sectionHeading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 },
  infoList: { borderTop: '1px solid var(--border)' },
  verificationCard: {
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
    padding: 22,
    borderRadius: 12,
    border: '1px solid var(--buy-dim)',
    background: 'linear-gradient(135deg, rgba(0,214,143,0.06), var(--panel))',
  },
  verificationIcon: {
    flex: 'none',
    display: 'grid',
    placeItems: 'center',
    width: 36,
    height: 36,
    borderRadius: 9,
    color: 'var(--buy)',
    background: 'var(--buy-dim)',
  },
  verificationTitleRow: { display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  verifiedLabel: { fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', color: 'var(--buy)', whiteSpace: 'nowrap' },
  verificationDesc: { color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.6, margin: '0 0 14px', maxWidth: 460 },
  progressLabelRow: { display: 'flex', justifyContent: 'space-between', color: 'var(--text-tertiary)', fontSize: 10, marginBottom: 6 },
  securityCard: {
    display: 'flex',
    flexDirection: 'column',
    padding: 22,
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: 'var(--panel)',
  },
  securityIcon: {
    display: 'grid',
    placeItems: 'center',
    width: 34,
    height: 34,
    borderRadius: 9,
    color: 'var(--accent)',
    background: 'var(--accent-dim)',
  },
  securityList: { borderTop: '1px solid var(--border)' },
  securityRow: {
    minHeight: 46,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    fontSize: 11,
  },
  securityRowValue: { fontFamily: 'var(--font-mono)', fontWeight: 400, fontSize: 11, color: 'var(--text-primary)' },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 },
  quickCard: {
    minHeight: 130,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    textAlign: 'left',
    padding: 16,
    borderRadius: 11,
    border: '1px solid var(--border)',
    background: 'var(--panel)',
    color: 'var(--text-primary)',
    position: 'relative',
  },
  quickIcon: {
    width: 30,
    height: 30,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 8,
    marginBottom: 12,
    color: 'var(--accent)',
    background: 'var(--accent-dim)',
  },
  quickCopy: { display: 'grid', gap: 4, paddingRight: 14, fontSize: 11 },
  quickArrow: { position: 'absolute', right: 14, bottom: 16, color: 'var(--text-tertiary)' },
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
  referralAssetChip: {
    background: 'var(--buy-dim)',
    color: 'var(--buy)',
    border: '1px solid var(--buy)',
    borderRadius: 999,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 700,
  },
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
};
