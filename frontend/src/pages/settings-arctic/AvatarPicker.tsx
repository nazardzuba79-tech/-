import { useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { resizeImageToDataUrl } from '../../lib/resizeImage';

// Anything bigger than this is rejected before it is even decoded — a
// several-hundred-megabyte file would otherwise be read into memory just to
// be scaled down and thrown away. The picked file is downscaled to 256x256
// before upload regardless (see resizeImageToDataUrl), so this bound is
// about what the browser is willing to open, not what gets sent.
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

/**
 * The round profile photo, and the control for changing it: click the
 * avatar (or the camera badge) to pick a file, hover to remove the current
 * one. Falls back to the initial-letter circle the profile has always used
 * when no photo is set.
 */
export function AvatarPicker({
  name,
  avatarUrl,
  verified,
  onChange,
}: {
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  onChange: (avatarUrl: string | null) => void;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    if (!file.type.startsWith('image/')) return setError(t('settings.avatarNotImage'));
    if (file.size > MAX_INPUT_BYTES) return setError(t('settings.avatarTooLarge'));

    setBusy(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      const saved = await api.updateAvatar(dataUrl);
      onChange(saved.avatarUrl);
    } catch {
      setError(t('settings.avatarFailed'));
    } finally {
      setBusy(false);
      // Clear the input so picking the very same file again still fires a
      // change event (a re-try after a failed upload, most obviously).
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAvatar();
      onChange(null);
    } catch {
      setError(t('settings.avatarFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0">
      <div className="group relative size-20 sm:size-24">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title={t('settings.avatarChange')}
          aria-label={t('settings.avatarChange')}
          className="size-full overflow-hidden rounded-full ring-1 ring-border transition-opacity hover:opacity-90 disabled:cursor-wait"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center bg-brand text-[26px] font-bold text-primary-foreground">
              {name.charAt(0).toUpperCase()}
            </span>
          )}

          {/* Only appears on hover/focus, so the photo itself stays clean. */}
          <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {busy ? <Loader2 className="size-6 animate-spin text-white" /> : <Camera className="size-6 text-white" />}
          </span>
        </button>

        {avatarUrl && !busy && (
          <button
            type="button"
            onClick={handleRemove}
            title={t('settings.avatarRemove')}
            aria-label={t('settings.avatarRemove')}
            className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        )}

        {/* KYC checkmark — real (me.kycStatus === 'APPROVED'), and kept out
            of the way of the remove button in the opposite corner. */}
        {verified && (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full bg-card ring-1 ring-border">
            <CheckCircle2 className="size-5 fill-success text-card" />
          </span>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      <p className="mt-2 max-w-[9rem] text-[11px] leading-tight text-muted-foreground">
        {error ? <span className="text-danger">{error}</span> : t('settings.avatarHint')}
      </p>
    </div>
  );
}
