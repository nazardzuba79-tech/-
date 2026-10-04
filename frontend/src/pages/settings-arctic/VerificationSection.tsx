import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BadgeCheck, CalendarDays, Check, ChevronDown, CircleAlert, Clock3, LoaderCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { CountrySelect } from '../../components/CountrySelect';
import { getCountryName } from '../../lib/countries';
import { KycUpload } from './KycUpload';
import { Panel, PanelHeader } from './Panel';
import { StatusBadge } from './StatusBadge';
import { customerErrorText } from '../../lib/customerError';
import {
  KYC_ERROR_KEYS, KycFileError, clearKycReceipt, newKycRequestId, prepareKycDocument, readKycReceipt,
  retryKycReceipt, submitKycToEdge, type PreparedKycDocument,
} from '../../lib/kycEdge';
import { kycStepStates, type KycStepState as StepState } from '../../lib/kycSteps';

// One control system for every KYC field — text, date, select and the
// country picker share height, radius, border, fill and focus ring, so the
// browser's own date/select chrome no longer sits beside a different-looking
// text box. 48 px: inside the 46–50 px desktop band and above the 44 px
// touch minimum on phones. `border-solid` is spelled out: Settings runs
// Tailwind without preflight, so `border` alone leaves inputs and buttons on
// the browser's inset/outset border (the dark edge in the owner's screenshot).
// For the same reason (no base layer, so no --tw-* defaults) nothing here
// leans on Tailwind's transform or ring utilities: icons are centred with
// flex, focus is a plain box-shadow.
const fieldClass =
  'h-12 w-full min-w-0 rounded-xl border border-solid border-border bg-card px-3.5 text-[14px] text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground hover:border-[oklch(0.86_0.006_258)] focus:border-brand focus:shadow-[0_0_0_4px_var(--accent-dim)] disabled:cursor-not-allowed disabled:bg-secondary disabled:opacity-70';
const labelClass = 'text-[13px] font-medium text-[var(--text-secondary)]';

/** The three stages from `lib/kycSteps.ts`, drawn as segments with a numbered dot each. */
function KycSteps({ steps }: { steps: { label: string; caption: string; state: StepState }[] }) {
  const bar: Record<StepState, string> = { done: 'bg-success', current: 'bg-brand', failed: 'bg-danger', todo: 'bg-border' };
  const dot: Record<StepState, string> = {
    done: 'bg-success-soft text-[oklch(0.5_0.13_155)] border-[oklch(0.72_0.14_155/0.3)]',
    current: 'bg-brand text-primary-foreground border-transparent',
    failed: 'bg-danger-soft text-danger border-[oklch(0.577_0.245_27.325/0.25)]',
    todo: 'bg-card text-muted-foreground border-[oklch(0.86_0.006_258)]',
  };
  const caption: Record<StepState, string> = {
    done: 'text-[oklch(0.5_0.13_155)]',
    current: 'text-brand',
    failed: 'text-danger',
    todo: 'text-muted-foreground',
  };
  return (
    <ol data-kyc-steps className="grid grid-cols-3 gap-2 sm:gap-4">
      {steps.map((step, index) => (
        <li key={step.label} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined} className="min-w-0">
          <span aria-hidden="true" className={`block h-1 rounded-full ${bar[step.state]}`} />
          <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-2.5">
            <span className={`flex size-7 shrink-0 items-center justify-center rounded-full border border-solid text-[12px] font-semibold tabular-nums ${dot[step.state]}`}>
              {step.state === 'done' ? <Check className="size-3.5" strokeWidth={2.6} aria-hidden="true" /> : step.state === 'failed' ? <X className="size-3.5" strokeWidth={2.6} aria-hidden="true" /> : index + 1}
            </span>
            <div className="min-w-0">
              <p className="break-words text-[13px] font-medium leading-snug text-foreground">{step.label}</p>
              <p className={`mt-0.5 break-words text-[12px] leading-snug ${caption[step.state]}`}>{step.caption}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Ported from the archive's components/voltex/verification-section.tsx —
// the archive's version is a static "100%, all verified" mock; this one
// shows the stages and state from the user's actual latest KYC submission,
// and still includes the real submission form when one is needed (the
// archive has no equivalent, since its mock account is always already
// verified).
export function VerificationSection() {
  const { t, lang } = useLanguage();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.getMyKyc>> | null>(null);
  const [country, setCountry] = useState('RU');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [documentType, setDocumentType] = useState<'PASSPORT' | 'ID_CARD' | 'DRIVERS_LICENSE'>('PASSPORT');
  const [document, setDocument] = useState<PreparedKycDocument | null>(null);
  // The name the user picked, for the selected-file card only. A prepared
  // photo is renamed document.jpg, and neither name is ever sent.
  const [fileName, setFileName] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A file problem is shown on the upload zone; anything else above the button.
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Delivered to the admin mailbox, metadata call still owed (see kycEdge.ts).
  const [awaitingRecord, setAwaitingRecord] = useState(() => !!readKycReceipt());
  // One id per attempt: a retry of the same attempt can never email twice.
  const requestIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const ids = { country: useId(), countryLabel: useId(), fullName: useId(), dateOfBirth: useId(), documentType: useId() };

  function reload() {
    api.getMyKyc().then((next) => {
      setStatus(next);
      const receipt = readKycReceipt();
      if (receipt && (next.latestSubmission?.id === receipt.submissionId || next.kycStatus === 'APPROVED')) {
        clearKycReceipt();
        setAwaitingRecord(false);
      }
    }).catch(() => {});
  }
  useEffect(reload, []);

  // The document already went out; retry only the tiny record, a few times,
  // while this page is open. Never re-uploads.
  useEffect(() => {
    if (!awaitingRecord) return;
    let cancelled = false;
    const delays = [0, 5_000, 15_000, 45_000];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (i: number) => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (await retryKycReceipt()) { if (!cancelled) { setAwaitingRecord(false); reload(); } return; }
        if (!readKycReceipt()) { if (!cancelled) setAwaitingRecord(false); return; }
        if (i + 1 < delays.length) attempt(i + 1);
      }, delays[i]);
    };
    attempt(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [awaitingRecord]);

  function resetAttempt() {
    requestIdRef.current = null;
  }
  // Changed answers are a new attempt (and a new submission id).
  useEffect(resetAttempt, [country, fullName, dateOfBirth, documentType]);

  async function handleFile(file: File | null) {
    setError(null);
    setFileError(null);
    setDocument(null);
    setFileName(file?.name ?? null);
    resetAttempt();
    if (!file) return;
    setPreparing(true);
    try {
      setDocument(await prepareKycDocument(file));
    } catch (err) {
      setFileName(null);
      setFileError(t(err instanceof KycFileError && err.code === 'kyc_file_too_large' ? 'settings.kycFileTooLarge' : 'settings.kycFileType'));
    } finally {
      setPreparing(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (submittingRef.current) return;
    if (!document) {
      setFileError(t('settings.addDocumentPhoto'));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    requestIdRef.current ??= newKycRequestId();
    try {
      const result = await submitKycToEdge({ requestId: requestIdRef.current, country, fullName, dateOfBirth, documentType, document: document.file });
      resetAttempt();
      setFullName('');
      setDateOfBirth('');
      setDocument(null);
      setFileName(null);
      if (!result.confirmed) setAwaitingRecord(true);
      toast.success(t('settings.sendForReview'));
      reload();
    } catch (err) {
      setError(customerErrorText(err, t, t('settings.submitKycError'), { byCode: KYC_ERROR_KEYS }));
    } finally {
      submittingRef.current = false;
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
  // A delivered document whose record is still being written reads as
  // «На проверке» — the user must not be asked to upload it again.
  const kycStatus = awaitingRecord && status.kycStatus !== 'APPROVED' ? 'PENDING' : status.kycStatus;
  const badge = STATUS_LABEL[kycStatus] ?? STATUS_LABEL.NOT_STARTED;
  const approved = kycStatus === 'APPROVED';
  const pending = kycStatus === 'PENDING';
  const rejected = kycStatus === 'REJECTED';
  const canSubmit = kycStatus === 'NOT_STARTED' || rejected;
  const sub = status.latestSubmission;
  const DOC_LABEL: Record<string, string> = {
    PASSPORT: t('settings.doc.PASSPORT'),
    ID_CARD: t('settings.doc.ID_CARD'),
    DRIVERS_LICENSE: t('settings.doc.DRIVERS_LICENSE'),
  };

  const stage = kycStepStates(kycStatus, {
    personalFilled: !!country && fullName.trim() !== '' && dateOfBirth !== '',
    documentAdded: !!document,
  });
  const steps: { label: string; caption: string; state: StepState }[] = [
    { label: t('settings.verifyStepPersonal'), caption: t(stage.personal === 'done' ? 'settings.kycStepFilled' : 'settings.kycStepNotFilled'), state: stage.personal },
    { label: t('settings.kycStepDocumentShort'), caption: t(stage.document === 'done' ? 'settings.kycStepAdded' : 'settings.kycStepNotAdded'), state: stage.document },
    { label: t('settings.kycStepReview'), caption: kycStatus === 'NOT_STARTED' ? t('settings.kycStepNotSent') : badge.text, state: stage.review },
  ];

  const summary = sub && [
    { label: t('settings.fullNameLabel'), value: sub.fullName },
    { label: t('settings.documentType'), value: DOC_LABEL[sub.documentType] ?? sub.documentType },
    { label: t('settings.country'), value: sub.country ? getCountryName(sub.country, lang) : t('settings.notSpecified') },
  ];

  return (
    <Panel>
      <PanelHeader
        title={t('settings.tab.verification')}
        subtitle={canSubmit ? t('settings.verifyStartPrompt') : undefined}
        action={
          <StatusBadge tone={badge.tone} icon={approved ? <BadgeCheck className="size-3.5" /> : undefined}>
            {badge.text}
          </StatusBadge>
        }
      />
      <div data-kyc-state={kycStatus} className="flex flex-col gap-6 p-5 sm:p-6">
        <KycSteps steps={steps} />

        {approved && (
          <StateNote tone="success" icon={<BadgeCheck className="size-5" aria-hidden="true" />} title={badge.text}>
            {t('settings.alreadyVerified')}
          </StateNote>
        )}
        {pending && (
          <StateNote tone="warning" icon={<Clock3 className="size-5" aria-hidden="true" />} title={badge.text}>
            {t('settings.pendingReview')} {t('settings.kycPendingNoReupload')}
          </StateNote>
        )}
        {rejected && (
          <StateNote tone="danger" icon={<CircleAlert className="size-5" aria-hidden="true" />} title={badge.text}>
            {status.latestSubmission?.status === 'REJECTED' && status.latestSubmission.rejectionReason && (
              <span data-kyc-rejection className="block font-medium text-foreground">
                {t('settings.rejectionReason', { reason: status.latestSubmission.rejectionReason })}
              </span>
            )}
            <span className="block">{t('settings.kycRejectedHint')}</span>
          </StateNote>
        )}

        {summary && (
          // Hairlines from a 1px grid gap over the border colour: one-sided
          // borders need a border-style, which without preflight would give
          // the other sides the browser's 3px default.
          <section aria-label={t('settings.kycSubmittedData')} className="grid gap-px overflow-hidden rounded-xl border border-solid border-border bg-border">
            <h3 className="bg-secondary px-4 py-2.5 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.kycSubmittedData')}</h3>
            <dl className="m-0 grid grid-cols-1 gap-px sm:grid-cols-3">
              {summary.map((row) => (
                <div key={row.label} className="min-w-0 bg-card px-4 py-3">
                  <dt className="text-[12px] text-muted-foreground">{row.label}</dt>
                  <dd className="m-0 mt-0.5 truncate text-[13.5px] font-medium text-foreground" title={row.value}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {canSubmit && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <div className="grid min-w-0 gap-2">
                <span id={ids.countryLabel} className={labelClass}>{t('settings.country')}</span>
                <CountrySelect
                  id={ids.country}
                  labelledBy={ids.countryLabel}
                  value={country}
                  onChange={setCountry}
                  placeholder={t('settings.notSpecified')}
                  triggerClassName={`${fieldClass} text-left`}
                />
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor={ids.fullName} className={labelClass}>{t('settings.fullName')}</label>
                <input
                  id={ids.fullName}
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor={ids.dateOfBirth} className={labelClass}>{t('settings.dateOfBirth')}</label>
                {/* The native date input stays (keyboard entry, the phone's own
                    picker); only its chrome is restyled. Chromium's picker
                    button is stretched, invisible, over the calendar icon. */}
                <div className="relative min-w-0">
                  <input
                    id={ids.dateOfBirth}
                    type="date"
                    required
                    autoComplete="bday"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className={`${fieldClass} relative block pr-11 [color-scheme:light] [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-11 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-date-and-time-value]:text-left ${dateOfBirth ? '' : 'text-muted-foreground'}`}
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-muted-foreground supports-[-moz-appearance:none]:hidden">
                    <CalendarDays className="size-[18px]" />
                  </span>
                </div>
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor={ids.documentType} className={labelClass}>{t('settings.documentType')}</label>
                <div className="relative min-w-0">
                  <select
                    id={ids.documentType}
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value as typeof documentType)}
                    // index.css draws its own !important chevron on every
                    // <select>; this one matches the country picker instead.
                    className={`${fieldClass} block cursor-pointer appearance-none truncate !bg-none !pr-10`}
                  >
                    <option value="PASSPORT">{DOC_LABEL.PASSPORT}</option>
                    <option value="ID_CARD">{DOC_LABEL.ID_CARD}</option>
                    <option value="DRIVERS_LICENSE">{DOC_LABEL.DRIVERS_LICENSE}</option>
                  </select>
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-muted-foreground">
                    <ChevronDown className="size-4" />
                  </span>
                </div>
              </div>
            </div>

            <KycUpload
              label={t('settings.verifyStepDocument')}
              document={document}
              fileName={fileName}
              preparing={preparing}
              error={fileError}
              disabled={submitting}
              onFile={handleFile}
            />

            {error && <div role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}

            <button
              type="submit"
              disabled={submitting || preparing}
              aria-busy={submitting || undefined}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[14px] font-semibold text-primary-foreground shadow-premium transition-[background-color,opacity] duration-150 hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--accent-dim)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[240px] sm:self-start"
            >
              {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {submitting ? t('settings.sending') : t('settings.sendForReview')}
            </button>
          </form>
        )}
      </div>
    </Panel>
  );
}

function StateNote({ tone, icon, title, children }: { tone: 'success' | 'warning' | 'danger'; icon: ReactNode; title: string; children: ReactNode }) {
  const tones = {
    success: 'border-[oklch(0.72_0.14_155/0.3)] bg-success-soft text-[oklch(0.5_0.13_155)]',
    warning: 'border-[oklch(0.79_0.13_78/0.35)] bg-warning-soft text-[oklch(0.55_0.12_70)]',
    danger: 'border-[oklch(0.577_0.245_27.325/0.25)] bg-danger-soft text-danger',
  };
  return (
    <div role="status" className={`flex items-start gap-3 rounded-xl border border-solid px-4 py-3.5 ${tones[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">{children}</p>
      </div>
    </div>
  );
}
