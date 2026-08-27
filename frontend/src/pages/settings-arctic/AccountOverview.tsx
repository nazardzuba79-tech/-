import { BadgeCheck, CalendarDays, Copy, Fingerprint, Mail, ShieldCheck, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '../../lib/i18n';
import { Panel, PanelHeader } from './Panel';
import { StatusBadge } from './StatusBadge';

type Row = { icon: LucideIcon; label: string; value: string; mono?: boolean; copy?: string };

// Ported from the archive's components/voltex/account-overview.tsx. The
// archive's row list is a fake "VX-4827193" account id; this uses the
// user's real database id instead (truncated for display, full id
// copied).
export function AccountOverview({
  email,
  accountId,
  roleLabel,
  verifiedLabel,
  verified,
  memberSince,
}: {
  email: string;
  accountId: string;
  roleLabel: string;
  verifiedLabel: string;
  verified: boolean;
  memberSince: string;
}) {
  const { t } = useLanguage();
  const ROWS: Row[] = [
    { icon: Mail, label: t('settings.email'), value: email, copy: email },
    { icon: Fingerprint, label: t('settings.accountId'), value: `${accountId.slice(0, 8)}…`, mono: true, copy: accountId },
    { icon: ShieldCheck, label: t('settings.role'), value: roleLabel },
    { icon: BadgeCheck, label: t('settings.verification'), value: verifiedLabel },
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
          <div key={row.label} className="flex items-center gap-4 px-5 py-4 sm:px-6">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <row.icon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{row.label}</p>
              <p className={`mt-0.5 truncate text-[14px] text-foreground ${row.mono ? 'tabular-nums' : ''}`}>{row.value}</p>
            </div>
            {row.label === t('settings.verification') && <StatusBadge tone={verified ? 'success' : 'neutral'}>{verifiedLabel}</StatusBadge>}
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
