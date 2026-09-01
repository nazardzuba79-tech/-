import { CheckCircle2, Pencil } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { StatusBadge } from './StatusBadge';
import { AvatarPicker } from './AvatarPicker';

// Ported from the archive's components/voltex/profile-header-card.tsx. The
// avatar is a real upload (see AvatarPicker), falling back to the initials
// circle when no photo is set; the verified checkmark badge is real
// (me.kycStatus === 'APPROVED'), not always-on like the archive's mock.
export function ProfileHeaderCard({
  name,
  email,
  roleLabel,
  verified,
  statusText,
  memberSince,
  avatarUrl,
  onAvatarChange,
  onEdit,
}: {
  name: string;
  email: string;
  roleLabel: string;
  verified: boolean;
  statusText: string;
  memberSince: string;
  avatarUrl: string | null;
  onAvatarChange: (avatarUrl: string | null) => void;
  onEdit: () => void;
}) {
  const { t } = useLanguage();
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-premium">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" />

      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:p-7">
        <AvatarPicker name={name} avatarUrl={avatarUrl} verified={verified} onChange={onAvatarChange} />

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
