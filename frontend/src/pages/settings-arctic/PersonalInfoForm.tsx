import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { CountrySelect } from '../../components/CountrySelect';
import { Panel, PanelHeader } from './Panel';

// Real self-service name/phone/country form — the archive has no
// equivalent panel (its "Edit profile" opens a fake modal); this is what
// that button actually opens here, inline, since it's a real, always-
// available action rather than a one-off dialog.
export function PersonalInfoForm({
  me,
  onSaved,
}: {
  me: { displayName: string | null; phone: string | null; country: string | null };
  onSaved: (patch: { displayName: string | null; phone: string | null; country: string | null }) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(me.displayName ?? '');
  const [phone, setPhone] = useState(me.phone ?? '');
  const [country, setCountry] = useState(me.country ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await api.updateProfile({ displayName: name, phone, country });
      onSaved(result);
      toast.success(t('settings.profileSaved'));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('settings.profileSaveError');
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title={t('settings.editProfileTitle')} subtitle={t('settings.editProfileDesc')} />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="grid gap-2">
          <label htmlFor="pi-name" className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('settings.name')}
          </label>
          <input
            id="pi-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="h-11 rounded-xl border border-border bg-card px-3.5 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className="grid gap-2">
          <label htmlFor="pi-phone" className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('settings.phone')}
          </label>
          <input
            id="pi-phone"
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

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-foreground px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? t('auth.wait') : t('settings.save')}
        </button>
      </form>
    </Panel>
  );
}
