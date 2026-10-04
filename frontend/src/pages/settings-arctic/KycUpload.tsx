import { useId, useRef, useState, type DragEvent } from 'react';
import { CircleCheck, FileText, FileUp, LoaderCircle, X } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { formatKycBytes, type PreparedKycDocument } from '../../lib/kycEdge';

/**
 * The KYC document picker. The browser's own «Выбор файла / Не выбран ни
 * один файл» control is replaced by an upload zone; the real
 * `<input type="file">` stays in the form (visually hidden, still reachable
 * through its button and still the target of a QA `setInputFiles`) and hands
 * every file to the caller's existing `handleFile`, so type/size checks and
 * preparation are exactly the ones in `lib/kycEdge.ts`.
 *
 * Dropping a file on the zone is the same call with the dropped file; the
 * button stays the way in for keyboards and phones.
 */
export function KycUpload({
  label,
  document,
  fileName,
  preparing,
  error,
  disabled,
  onFile,
}: {
  label: string;
  document: PreparedKycDocument | null;
  /** The name the user picked, shown only here; it never leaves the browser. */
  fileName: string | null;
  preparing: boolean;
  error: string | null;
  disabled: boolean;
  onFile: (file: File | null) => void;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();
  const busy = disabled || preparing;
  const choose = () => {
    if (!busy) inputRef.current?.click();
  };

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (busy || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragging(true);
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    setDragging(false);
    if (busy) return;
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  const secondaryButton =
    'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-solid border-border bg-card px-4 text-[13.5px] font-medium text-foreground transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--accent-dim)] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    // grid-cols-1 + min-w-0: a long file name must not widen the form past a 320 px screen.
    <div className="grid min-w-0 grid-cols-1 gap-2">
      <span id={labelId} className="text-[13px] font-medium text-[var(--text-secondary)]">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          // Cleared so picking the same file again after «Удалить» still reports it.
          event.target.value = '';
          if (file) onFile(file);
        }}
      />

      {document && !preparing ? (
        // On a phone «Заменить» takes its own row, so the file name keeps the width.
        <div data-kyc-file className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-solid border-border bg-card p-3 sm:flex-nowrap sm:p-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-[oklch(0.5_0.13_155)]">
            <FileText className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-foreground" title={fileName ?? undefined}>
              {fileName ?? document.file.name}
            </p>
            <p data-kyc-file-size className="mt-0.5 flex items-center gap-1 text-[12px] text-[oklch(0.5_0.13_155)]">
              <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('settings.kycFileReady', { size: formatKycBytes(document.file.size) })}</span>
            </p>
          </div>
          <button type="button" onClick={choose} disabled={busy} className={`${secondaryButton} order-last w-full sm:order-none sm:w-auto`}>
            {t('settings.kycReplaceFile')}
          </button>
          <button
            type="button"
            onClick={() => onFile(null)}
            disabled={busy}
            aria-label={t('settings.kycRemoveFile')}
            title={t('settings.kycRemoveFile')}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--accent-dim)] disabled:opacity-50"
          >
            <X className="size-[18px]" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div
          data-kyc-upload
          data-dragging={dragging || undefined}
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex min-w-0 flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-5 text-center transition-colors duration-150 sm:flex-row sm:px-5 sm:text-left ${
            dragging
              ? 'border-brand bg-brand-soft'
              : error
                ? 'border-danger bg-danger-soft'
                : 'border-[oklch(0.86_0.006_258)] bg-secondary'
          }`}
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-solid border-border bg-card text-brand">
            {preparing ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <FileUp className="size-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-foreground">{t('settings.kycUploadTitle')}</p>
            {preparing ? (
              <p data-kyc-file-size className="mt-0.5 text-[12.5px] text-muted-foreground">{t('settings.kycPreparingFile')}</p>
            ) : (
              <p id={hintId} className="mt-0.5 text-[12.5px] text-muted-foreground">{t('settings.kycUploadHint')}</p>
            )}
          </div>
          <button
            type="button"
            onClick={choose}
            disabled={busy}
            aria-describedby={error ? errorId : hintId}
            className={`${secondaryButton} w-full sm:w-auto`}
          >
            {t('settings.kycChooseFile')}
          </button>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
