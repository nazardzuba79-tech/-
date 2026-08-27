import { useEffect, useState, type FormEvent } from 'react';
import { BadgeCheck, CheckCircle2, FileText, MapPin, UserRound, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { CountrySelect } from '../../components/CountrySelect';
import { Panel, PanelHeader } from './Panel';
import { StatusBadge } from './StatusBadge';

const inputClass =
  'h-11 rounded-xl border border-border bg-card px-3.5 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand focus:ring-2 focus:ring-brand/20';

function kycProgressPct(status: string): number {
  if (status === 'APPROVED') return 100;
  if (status === 'PENDING') return 60;
  if (status === 'REJECTED') return 20;
  return 8;
}

// Ported from the archive's components/voltex/verification-section.tsx —
// the archive's version is a static "100%, all verified" mock; this one
// computes the progress bar and per-step state from the user's actual
// latest KYC submission, and still includes the real submission form when
// one is needed (the archive has no equivalent, since its mock account is
// always already verified).
export function VerificationSection() {
  const { t } = useLanguage();
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
      toast.success(t('settings.sendForReview'));
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.submitKycError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!status) {
    return (
      <Panel>
        <div className="h-40 animate-pulse rounded-2xl bg-secondary" />
      </Panel>
    );
  }

  const STATUS_LABEL: Record<string, { text: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
    NOT_STARTED: { text: t('settings.kyc.NOT_STARTED'), tone: 'neutral' },
    PENDING: { text: t('settings.kyc.PENDING'), tone: 'warning' },
    APPROVED: { text: t('settings.kyc.APPROVED'), tone: 'success' },
    REJECTED: { text: t('settings.kyc.REJECTED'), tone: 'danger' },
  };
  const badge = STATUS_LABEL[status.kycStatus] ?? STATUS_LABEL.NOT_STARTED;
  const approved = status.kycStatus === 'APPROVED';
  const canSubmit = status.kycStatus === 'NOT_STARTED' || status.kycStatus === 'REJECTED';
  const progressPct = kycProgressPct(status.kycStatus);
  const sub = status.latestSubmission;
  const DOC_LABEL: Record<string, string> = {
    PASSPORT: t('settings.doc.PASSPORT'),
    ID_CARD: t('settings.doc.ID_CARD'),
    DRIVERS_LICENSE: t('settings.doc.DRIVERS_LICENSE'),
  };
  const subtitle = approved ? t('settings.alreadyVerified') : status.kycStatus === 'PENDING' ? t('settings.pendingReview') : t('settings.verifyStartPrompt');

  const STEPS: { icon: LucideIcon; label: string; value: string | null }[] = [
    { icon: UserRound, label: t('settings.verifyStepPersonal'), value: sub?.fullName ?? null },
    { icon: FileText, label: t('settings.verifyStepDocument'), value: sub ? DOC_LABEL[sub.documentType] ?? sub.documentType : null },
    { icon: MapPin, label: t('settings.country'), value: sub?.country ?? null },
  ];

  return (
    <Panel>
      <PanelHeader
        title={t('settings.tab.verification')}
        subtitle={subtitle}
        action={
          <StatusBadge tone={badge.tone} icon={approved ? <BadgeCheck className="size-3.5" /> : undefined}>
            {badge.text}
          </StatusBadge>
        }
      />
      <div className="p-5 sm:p-6">
        <div className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-foreground">{t('settings.verificationLevel')}</span>
            <span className="text-[13px] font-semibold tabular-nums text-[oklch(0.5_0.13_155)]">{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-success transition-all duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.label} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3.5">
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${approved ? 'bg-success-soft text-[oklch(0.5_0.13_155)]' : 'bg-secondary text-muted-foreground'}`}>
                <step.icon className="size-[18px]" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-foreground">{step.label}</p>
                {step.value ? (
                  <p className={`mt-0.5 flex items-center gap-1 truncate text-[12px] ${approved ? 'text-[oklch(0.5_0.13_155)]' : 'text-muted-foreground'}`}>
                    {approved && <CheckCircle2 className="size-3.5 shrink-0" />}
                    {step.value}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{t('settings.notSpecified')}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {status.latestSubmission?.status === 'REJECTED' && status.latestSubmission.rejectionReason && (
          <div className="mt-5 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
            {t('settings.rejectionReason', { reason: status.latestSubmission.rejectionReason })}
          </div>
        )}

        {canSubmit && (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4 border-t border-border pt-6">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <span className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.country')}</span>
                <CountrySelect value={country} onChange={setCountry} placeholder={t('settings.notSpecified')} />
              </div>
              <div className="grid gap-1.5">
                <label className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.fullName')}</label>
                <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.dateOfBirth')}</label>
                <input type="date" required value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} />
              </div>
              <div className="grid gap-1.5">
                <label className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.documentType')}</label>
                <select value={documentType} onChange={(e) => setDocumentType(e.target.value as typeof documentType)} className={inputClass}>
                  <option value="PASSPORT">{DOC_LABEL.PASSPORT}</option>
                  <option value="ID_CARD">{DOC_LABEL.ID_CARD}</option>
                  <option value="DRIVERS_LICENSE">{DOC_LABEL.DRIVERS_LICENSE}</option>
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.documentPhoto')}</label>
              <input
                type="file"
                required
                accept="image/jpeg,image/png,application/pdf"
                onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
                className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-[12.5px] text-foreground"
              />
            </div>

            {error && <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-foreground px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? t('settings.sending') : t('settings.sendForReview')}
            </button>
          </form>
        )}
      </div>
    </Panel>
  );
}
