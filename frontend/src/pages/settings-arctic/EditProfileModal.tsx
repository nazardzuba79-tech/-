import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { CountrySelect } from '../../components/CountrySelect';

// Port of the archive's components/voltex/edit-profile-modal.tsx — a
// dialog opened by ProfileHeaderCard's "Edit profile" button, not an
// always-visible inline panel (the previous PersonalInfoForm was wrong
// about this). Fields differ from the archive's Name+Email pair because
// email isn't part of what PATCH /me/profile actually supports here —
// Name/Phone/Country are this app's real editable profile fields, same
// three the old inline form used. "Change photo" stays exactly as
// decorative as it is in the archive itself (a toast, no real upload
// there either) — no backend endpoint exists for it here.
export function EditProfileModal({
  open,
  onClose,
  me,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  me: { displayName: string | null; phone: string | null; country: string | null };
  onSaved: (patch: { displayName: string | null; phone: string | null; country: string | null }) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(me.displayName ?? '');
  const [phone, setPhone] = useState(me.phone ?? '');
  const [country, setCountry] = useState(me.country ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await api.updateProfile({ displayName: name, phone, country });
      onSaved(result);
      toast.success(t('settings.profileSaved'));
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('settings.profileSaveError');
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-0 shadow-premium-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-5">
          <div>
            <h3 className="text-[17px] tracking-[-0.01em] text-foreground">{t('settings.editProfileTitle')}</h3>
            <p className="text-[13px] text-muted-foreground">{t('settings.editProfileDesc')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          <div className="flex items-center gap-4">
            <span className="grid size-16 shrink-0 place-items-center rounded-full bg-brand text-[22px] font-bold text-primary-foreground ring-1 ring-border">
              {(name || me.displayName || '').charAt(0).toUpperCase()}
            </span>
            <button
              type="button"
              onClick={() => toast(t('settings.changePhoto'), { description: t('settings.changePhotoHint') })}
              className="rounded-lg border border-border bg-card px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              {t('settings.changePhoto')}
            </button>
          </div>

          <div className="grid gap-2">
            <label htmlFor="epm-name" className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('settings.name')}
            </label>
            <input
              id="epm-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="h-11 rounded-xl border border-border bg-card px-3.5 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="epm-phone" className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('settings.phone')}
            </label>
            <input
              id="epm-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={32}
              className="h-11 rounded-xl border border-border bg-card px-3.5 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div className="grid gap-2">
            <span className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.country')}</span>
            <CountrySelect value={country} onChange={setCountry} placeholder={t('settings.notSpecified')} />
          </div>

          {error && <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            {t('settings.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? t('auth.wait') : t('settings.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
