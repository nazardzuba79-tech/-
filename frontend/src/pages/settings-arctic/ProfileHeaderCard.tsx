import { CheckCircle2, Pencil } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { StatusBadge } from './StatusBadge';

// Ported from the archive's components/voltex/profile-header-card.tsx.
// No avatar photo exists for real users, so the initials circle from the
// old design stays instead of the archive's <img>; the verified checkmark
// badge is real (me.kycStatus === 'APPROVED'), not always-on like the
// archive's mock.
export function ProfileHeaderCard({
  name,
  email,
  roleLabel,
  verified,
  statusText,
  memberSince,
  onEdit,
}: {
  name: string;
  email: string;
  roleLabel: string;
  verified: boolean;
  statusText: string;
  memberSince: string;
  onEdit: () => void;
}) {
  const { t } = useLanguage();
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-premium">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" />

      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:p-7">
        <div className="relative shrink-0">
          <div className="grid size-20 place-items-center rounded-full bg-brand text-[26px] font-bold text-primary-foreground ring-1 ring-border sm:size-24">
            {name.charAt(0).toUpperCase()}
          </div>
          {verified && (
            <span className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full bg-card ring-1 ring-border">
              <CheckCircle2 className="size-5 fill-success text-card" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-foreground sm:text-[26px]">{name}</h1>
            <StatusBadge tone={verified ? 'success' : 'warning'} icon={<CheckCircle2 className="size-3.5" />}>
              {statusText}
            </StatusBadge>
          </div>
          <p className="mt-1 text-[13.5px] font-medium text-muted-foreground">{roleLabel}</p>

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px]">
            <span className="text-muted-foreground">
              <span className="text-foreground/80">{email}</span>
            </span>
            <span className="hidden h-3 w-px bg-border sm:block" />
            <span className="text-muted-foreground">
              {t('settings.memberSince')} <span className="tabular-nums text-foreground/80">{memberSince}</span>
            </span>
          </div>
        </div>

        <button
          onClick={onEdit}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] font-medium text-foreground shadow-premium transition-all duration-150 hover:border-foreground/20 hover:bg-secondary active:scale-[0.98] sm:self-center"
        >
          <Pencil className="size-4" />
          {t('settings.editProfileTitle')}
        </button>
      </div>
    </section>
  );
}
