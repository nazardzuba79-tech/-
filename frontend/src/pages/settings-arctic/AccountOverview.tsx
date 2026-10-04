import { ArrowRight, BadgeCheck, CalendarDays, Copy, Fingerprint, Mail, ShieldCheck, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '../../lib/i18n';
import { Panel, PanelHeader } from './Panel';
import { StatusBadge } from './StatusBadge';
import type { KycStatus } from '../../lib/kycSteps';

type Row = { icon: LucideIcon; label: string; value: string; mono?: boolean; copy?: string; verification?: boolean };

// Ported from the archive's components/voltex/account-overview.tsx. The
// archive's row list is a fake "VX-4827193" account id; this uses the
// user's real database id instead (truncated for display, full id
// copied).
export function AccountOverview({
  email,
  accountId,
  roleLabel,
  verifiedLabel,
  kycStatus,
  memberSince,
  onVerify,
}: {
  email: string;
  accountId: string;
  roleLabel: string;
  verifiedLabel: string;
  /** The status enum itself — the action is never chosen from translated text. */
  kycStatus: KycStatus;
  memberSince: string;
  /** Opens the Verification tab through the Settings tab state. */
  onVerify: () => void;
}) {
  const { t } = useLanguage();
  const ROWS: Row[] = [
    { icon: Mail, label: t('settings.email'), value: email, copy: email },
    { icon: Fingerprint, label: t('settings.accountId'), value: `${accountId.slice(0, 8)}…`, mono: true, copy: accountId },
    { icon: ShieldCheck, label: t('settings.role'), value: roleLabel },
    { icon: BadgeCheck, label: t('settings.verification'), value: verifiedLabel, verification: true },
    { icon: CalendarDays, label: t('settings.memberSince'), value: memberSince, mono: true },
  ];

  function handleCopy(row: Row) {
    if (!row.copy) return;
    navigator.clipboard?.writeText(row.copy);
    toast.success(t('deposit.copied'));
  }

  return (
    <Panel>
      <PanelHeader title={t('settings.accountInfoTitle')} />
      <div className="divide-y divide-border">
        {ROWS.map((row) => (
          <div
            key={row.label}
            data-profile-verification={row.verification ? kycStatus : undefined}
            className={`flex items-center gap-4 px-5 py-4 sm:px-6 ${row.verification ? 'flex-wrap gap-y-3' : ''}`}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <row.icon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{row.label}</p>
              <p
                className={`mt-0.5 truncate text-[14px] ${row.verification && kycStatus === 'REJECTED' ? 'text-danger' : 'text-foreground'} ${row.mono ? 'tabular-nums' : ''}`}
              >
                {row.value}
              </p>
            </div>
            {row.verification && <VerificationAction status={kycStatus} label={verifiedLabel} onVerify={onVerify} />}
            {row.copy && (
              <button
                onClick={() => handleCopy(row)}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                aria-label={`Copy ${row.label}`}
              >
                <Copy className="size-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * What the Verification row offers, by status: a way in when there is
 * something to do (not started, rejected), a quiet way to the status while
 * it is under review — never a prompt to upload again — and just the
 * verified mark once approved.
 */
function VerificationAction({ status, label, onVerify }: { status: KycStatus; label: string; onVerify: () => void }) {
  const { t } = useLanguage();
  if (status === 'APPROVED') {
    return <StatusBadge tone="success" icon={<BadgeCheck className="size-3.5" />}>{label}</StatusBadge>;
  }
  if (status === 'PENDING') {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge tone="warning">{label}</StatusBadge>
        <button
          type="button"
          data-profile-verification-action
          onClick={onVerify}
          className="rounded-lg px-2 py-1.5 text-[13px] font-medium text-brand max-sm:min-h-11 transition-colors duration-150 hover:bg-brand-soft focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--accent-dim)]"
        >
          {t('settings.kycOpenStatus')}
        </button>
      </div>
    );
  }
  return (
    // On a phone it takes its own full-width line under the status.
    <button
      type="button"
      data-profile-verification-action
      onClick={onVerify}
      className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13.5px] font-semibold text-primary-foreground shadow-premium transition-colors duration-150 hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--accent-dim)] max-sm:h-11 sm:w-auto"
    >
      {t(status === 'REJECTED' ? 'settings.kycResubmitCta' : 'settings.kycStartCta')}
      <ArrowRight className="size-4" aria-hidden="true" />
    </button>
  );
}
