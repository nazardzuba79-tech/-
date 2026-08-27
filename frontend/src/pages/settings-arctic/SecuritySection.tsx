import { useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound, ShieldAlert, ShieldCheck, Smartphone, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { Panel, PanelHeader } from './Panel';
import { StatusBadge } from './StatusBadge';

const inputClass =
  'h-11 rounded-xl border border-border bg-card px-3.5 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand focus:ring-2 focus:ring-brand/20';

type SetupState = { secret: string; otpauthUrl: string; qrCodeDataUrl: string };

// Ported from the archive's components/voltex/security-section.tsx +
// enable-2fa-modal.tsx, but real end to end: the archive's modal accepts
// any 6-digit code and always "succeeds" — this one calls the actual
// setup2FA/verify2FA/disable2FA endpoints and shows the actual QR code.
// The archive's "Email verification" and "Active sessions" rows are
// dropped: this app has no email-verification step and no session
// tracking, so those rows would be fabricated status claims on a security
// page — exactly what shouldn't be faked here.
export function SecuritySection({
  twoFactorEnabled,
  lastPasswordChange,
  onChanged,
}: {
  twoFactorEnabled: boolean;
  lastPasswordChange: string | null;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [twoFaOpen, setTwoFaOpen] = useState(false);

  return (
    <>
      <Panel>
        <PanelHeader title={t('settings.tab.security')} subtitle={t('settings.securitySectionSubtitle')} />
        <div className="divide-y divide-border">
          <div className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6 ${!twoFactorEnabled ? 'bg-warning-soft/40' : ''}`}>
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                !twoFactorEnabled ? 'bg-warning-soft text-[oklch(0.55_0.12_70)]' : 'bg-secondary text-muted-foreground'
              }`}
            >
              {!twoFactorEnabled ? <ShieldAlert className="size-5" /> : <ShieldCheck className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <p className="text-[14.5px] font-medium text-foreground">{t('settings.twoFactor')}</p>
                <StatusBadge
                  tone={twoFactorEnabled ? 'success' : 'warning'}
                  icon={twoFactorEnabled ? <CheckCircle2 className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
                >
                  {twoFactorEnabled ? t('settings.enabled') : t('settings.disabled')}
                </StatusBadge>
              </div>
              <p className="mt-1 truncate text-[13px] text-muted-foreground">{t('settings.twoFaLead')}</p>
            </div>
            <button
              onClick={() => setTwoFaOpen(true)}
              className={`shrink-0 rounded-lg px-4 py-2 text-[13px] font-medium transition-all duration-150 active:scale-[0.98] ${
                !twoFactorEnabled
                  ? 'bg-foreground text-primary-foreground hover:opacity-90'
                  : 'border border-border bg-card text-foreground hover:border-foreground/20 hover:bg-secondary'
              }`}
            >
              {twoFactorEnabled ? t('settings.manage') : t('settings.enable2fa')}
            </button>
          </div>

          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <p className="text-[14.5px] font-medium text-foreground">{t('settings.changePassword')}</p>
                <StatusBadge tone="neutral">{t('settings.secure')}</StatusBadge>
              </div>
              <p className="mt-1 truncate text-[13px] text-muted-foreground">
                {lastPasswordChange ? t('settings.lastChanged', { date: lastPasswordChange }) : t('settings.neverChanged')}
              </p>
            </div>
            <button
              onClick={() => setPasswordOpen((v) => !v)}
              className="shrink-0 rounded-lg border border-border bg-card px-4 py-2 text-[13px] font-medium text-foreground transition-all duration-150 hover:border-foreground/20 hover:bg-secondary active:scale-[0.98]"
            >
              {t('settings.change')}
            </button>
          </div>

          {passwordOpen && <PasswordForm onDone={() => { setPasswordOpen(false); onChanged(); }} />}
        </div>
      </Panel>

      {twoFaOpen && (
        <TwoFactorModal
          enabled={twoFactorEnabled}
          onClose={() => setTwoFaOpen(false)}
          onChanged={() => {
            setTwoFaOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      toast.success(t('settings.passwordChanged'));
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('settings.changePasswordError');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 bg-secondary/40 px-5 py-4 sm:px-6">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.currentPassword')}</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="grid gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.newPassword')}</label>
          <input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{t('auth.minChars')}</p>
      {error && <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-primary-foreground transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
        >
          {submitting ? t('auth.wait') : t('settings.save')}
        </button>
      </div>
    </form>
  );
}

function TwoFactorModal({ enabled, onClose, onChanged }: { enabled: boolean; onClose: () => void; onChanged: () => void }) {
  const { t } = useLanguage();
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api.setup2FA());
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
      toast.success(t('settings.enabled'));
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
      await api.disable2FA(code);
      toast.success(t('settings.disabled'));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.twoFaGenericError'));
    } finally {
      setBusy(false);
    }
  }

  const STEPS = [t('settings.twoFaStep1'), t('settings.twoFaStep2'), t('settings.twoFaStep3')];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-0 shadow-premium-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <h3 className="text-[17px] tracking-[-0.01em] text-foreground">{enabled ? t('settings.disable2fa') : t('settings.enable2fa')}</h3>
              <p className="text-[13px] text-muted-foreground">{t('settings.twoFaLead')}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          {backupCodes ? (
            <>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{t('settings.backupCodesHint')}</p>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-secondary p-4 font-mono">
                {backupCodes.map((c) => (
                  <span key={c} className="py-1 text-center text-[14px] tracking-wide">
                    {c}
                  </span>
                ))}
              </div>
            </>
          ) : enabled ? (
            <form id="twofa-form" onSubmit={confirmDisable} className="grid gap-2">
              <label htmlFor="disable-otp" className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('auth.twoFaCode')}
              </label>
              <input
                id="disable-otp"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="h-12 rounded-xl border border-border bg-card px-4 text-center text-[18px] font-semibold tracking-[0.5em] tabular-nums text-foreground outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              {error && <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
            </form>
          ) : !setup ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <p className="text-[13px] text-muted-foreground">{t('settings.twoFaLead')}</p>
              {error && <div className="w-full rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
              <button
                onClick={startSetup}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
              >
                {busy ? t('auth.wait') : t('settings.enable2fa')}
              </button>
            </div>
          ) : (
            <>
              <ol className="flex flex-col gap-3">
                {STEPS.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">{i + 1}</span>
                    <span className="text-[13px] leading-relaxed text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="flex items-center justify-center rounded-xl border border-border bg-secondary/50 py-6">
                <img src={setup.qrCodeDataUrl} alt="QR" className="size-40 rounded-xl border border-border bg-white p-2" />
              </div>
              <div className="rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-center font-mono text-[13px] text-foreground">{setup.secret}</div>

              <form id="twofa-form" onSubmit={confirmSetup} className="grid gap-2">
                <label htmlFor="setup-otp" className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('auth.twoFaCode')}
                </label>
                <input
                  id="setup-otp"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="h-12 rounded-xl border border-border bg-card px-4 text-center text-[18px] font-semibold tracking-[0.5em] tabular-nums text-foreground outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                {error && <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
              </form>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          {backupCodes ? (
            <button
              onClick={onChanged}
              className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98]"
            >
              <CheckCircle2 className="size-4" />
              {t('settings.backupCodesSaved')}
            </button>
          ) : (
            <>
              <button onClick={onClose} className="rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary">
                {t('settings.cancel')}
              </button>
              {(enabled || setup) && (
                <button
                  type="submit"
                  form="twofa-form"
                  disabled={busy || code.length !== 6}
                  className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Smartphone className="size-4" />
                  {busy ? t('auth.wait') : t('auth.confirm')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
