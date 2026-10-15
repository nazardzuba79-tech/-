import { useEffect, useId, useRef, useState } from 'react';
import { Camera, CircleCheck, FileText, ImageUp, LoaderCircle, ScanFace, X } from 'lucide-react';
import { toast } from 'sonner';
import type { KycMaterialRequestView } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { customerErrorText } from '../../lib/customerError';
import {
  KYC_ERROR_KEYS, KYC_MIN_IMAGE, KycFileError, KycImageError, checkKycImage, forgetKycMaterialReceipts, formatKycBytes,
  newKycRequestId, prepareKycDocument, readKycMaterialReceipts, retryKycMaterialReceipts, submitKycMaterialToEdge,
  type KycMaterialPart, type PreparedKycDocument,
} from '../../lib/kycEdge';

/**
 * The admin asked for more: a new photo of the document, a selfie, or both.
 * The application is not rejected; it waits for these.
 *
 * Each part uploads on its own (straight to the KYC edge, like the original
 * document) and only once: one request id per attempt, a second click while
 * one is in flight does nothing, and a retry of the same attempt can never
 * create a second email or record. The request itself comes from the server
 * on every visit, so it survives a reload, a new sign-in or another device.
 *
 * The checks here are format, size, resolution and "the browser can open it"
 * — never "this is a genuine document" or "this face matches". The admin
 * compares by eye and decides.
 */
export function KycMaterialsPanel({ request, onChanged }: { request: KycMaterialRequestView; onChanged: () => void }) {
  const [owed, setOwed] = useState(() => readKycMaterialReceipts().filter((r) => r.materialRequestId === request.id));
  // The parent's reload is a fresh function each render; the retry loop must not restart on it.
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  // Receipts for another (closed) request, or for a part the server already
  // recorded, are not owed any more.
  useEffect(() => {
    forgetKycMaterialReceipts((r) => r.materialRequestId === request.id
      && !(r.part === 'DOCUMENT' ? request.documentReceived : request.selfieReceived));
    setOwed(readKycMaterialReceipts().filter((r) => r.materialRequestId === request.id));
  }, [request.id, request.documentReceived, request.selfieReceived]);

  // The file already went out; retry only the small record, never the upload.
  const owedCount = owed.length;
  useEffect(() => {
    if (!owedCount) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delays = [0, 5_000, 15_000, 45_000];
    const attempt = (i: number) => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        const left = await retryKycMaterialReceipts();
        if (cancelled) return;
        if (left < owedCount) changedRef.current();
        if (left === 0) { setOwed([]); return; }
        if (i + 1 < delays.length) attempt(i + 1);
      }, delays[i]);
    };
    attempt(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [owedCount]);

  const recording = (part: KycMaterialPart) => owed.some((r) => r.part === part);
  const sent = () => {
    setOwed(readKycMaterialReceipts().filter((r) => r.materialRequestId === request.id));
    onChanged();
  };

  return (
    <div data-kyc-materials={request.kind} className="flex flex-col gap-4">
      {request.documentRequested && (
        <MaterialCard part="DOCUMENT" request={request} received={request.documentReceived} recording={recording('DOCUMENT')} onSent={sent} onStale={onChanged} />
      )}
      {request.selfieRequested && (
        <MaterialCard part="SELFIE" request={request} received={request.selfieReceived} recording={recording('SELFIE')} onSent={sent} onStale={onChanged} />
      )}
    </div>
  );
}

const primaryButton =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[14px] font-semibold text-primary-foreground shadow-premium transition-[background-color,opacity] duration-150 hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--accent-dim)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[220px]';
const secondaryButton =
  'inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-solid border-border bg-card px-4 text-[13.5px] font-medium text-foreground transition-colors duration-150 hover:bg-secondary focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--accent-dim)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto';

const STALE_CODES = new Set(['kyc_material_request_closed', 'kyc_material_request_not_found', 'kyc_material_not_requested', 'kyc_material_already_received']);

function MaterialCard({ part, request, received, recording, onSent, onStale }: {
  part: KycMaterialPart;
  request: KycMaterialRequestView;
  received: boolean;
  recording: boolean;
  onSent: () => void;
  onStale: () => void;
}) {
  const { t } = useLanguage();
  const isSelfie = part === 'SELFIE';
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [prepared, setPrepared] = useState<PreparedKycDocument | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const ids = { title: useId(), hint: useId(), consent: useId(), error: useId() };
  const previewUrl = useObjectUrl(prepared && prepared.file.type.startsWith('image/') ? prepared.file : null);

  const reasonText = request.documentReason === 'OTHER'
    ? request.documentReasonText
    : request.documentReason ? t(`kycMaterials.reason.${request.documentReason}` as 'kycMaterials.reason.BLURRY') : null;

  async function handleFile(file: File | null) {
    setFileError(null);
    setError(null);
    setPrepared(null);
    setFileName(null);
    requestIdRef.current = null; // a new file is a new attempt
    if (!file) return;
    setOpen(true);
    const type = (file.type || '').toLowerCase();
    if (isSelfie && type !== 'image/jpeg' && type !== 'image/png') {
      setFileError(t('kycMaterials.selfieFileType'));
      return;
    }
    setPreparing(true);
    try {
      await checkKycImage(file, part);
      setPrepared(await prepareKycDocument(file));
      setFileName(file.name || null);
    } catch (err) {
      if (err instanceof KycImageError && err.code === 'kyc_image_too_small' && err.size) {
        const min = KYC_MIN_IMAGE[part];
        const landscape = err.size.width >= err.size.height;
        setFileError(t('kycMaterials.imageTooSmall', {
          width: err.size.width, height: err.size.height,
          minWidth: landscape ? min.long : min.short, minHeight: landscape ? min.short : min.long,
        }));
      } else if (err instanceof KycImageError) {
        setFileError(t('kycMaterials.imageUnreadable'));
      } else {
        setFileError(t(err instanceof KycFileError && err.code === 'kyc_file_too_large' ? 'settings.kycFileTooLarge' : isSelfie ? 'kycMaterials.selfieFileType' : 'settings.kycFileType'));
      }
    } finally {
      setPreparing(false);
    }
  }

  function startCamera() {
    setFileError(null);
    setOpen(true);
    // No camera API (old browser, insecure context): the phone's own camera
    // through the file input, opened inside this click.
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      captureRef.current?.click();
      return;
    }
    setCamera(true);
  }

  async function submit() {
    if (submittingRef.current) return;
    setError(null);
    if (!prepared) {
      setFileError(t(isSelfie ? 'kycMaterials.selfieHint' : 'settings.addDocumentPhoto'));
      return;
    }
    if (isSelfie && !consent) {
      setError(t('kycMaterials.consentRequired'));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    requestIdRef.current ??= newKycRequestId();
    try {
      await submitKycMaterialToEdge({ requestId: requestIdRef.current, materialRequestId: request.id, part, file: prepared.file, selfieConsent: isSelfie ? consent : undefined });
      requestIdRef.current = null;
      setPrepared(null);
      setFileName(null);
      setOpen(false);
      toast.success(t('kycMaterials.sent'));
      onSent();
    } catch (err) {
      setError(customerErrorText(err, t, t('kycMaterials.submitError'), { byCode: KYC_ERROR_KEYS }));
      const code = (err as { body?: { code?: unknown } })?.body?.code;
      if (typeof code === 'string' && STALE_CODES.has(code)) onStale();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const done = received || recording;
  const icon = isSelfie ? <ScanFace className="size-5" aria-hidden="true" /> : <FileText className="size-5" aria-hidden="true" />;

  return (
    <section
      data-kyc-material-part={part}
      data-received={done || undefined}
      aria-labelledby={ids.title}
      className={`flex flex-col gap-4 rounded-2xl border border-solid p-4 sm:p-5 ${done
        ? 'border-[oklch(0.72_0.14_155/0.3)] bg-success-soft'
        : 'border-[oklch(0.79_0.13_78/0.35)] bg-warning-soft'}`}
    >
      <div className="flex items-start gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-card ${done ? 'text-[oklch(0.5_0.13_155)]' : 'text-[oklch(0.55_0.12_70)]'}`}>
          {done ? <CircleCheck className="size-5" aria-hidden="true" /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={ids.title} className="text-[15px] font-semibold leading-snug text-foreground">
            {done
              ? t(isSelfie ? 'kycMaterials.selfieReceived' : 'kycMaterials.documentReceived')
              : t(isSelfie ? 'kycMaterials.selfieTitle' : 'kycMaterials.documentTitle')}
          </h3>
          {done ? (
            recording && !received && (
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)]">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                {t('kycMaterials.recording')}
              </p>
            )
          ) : (
            <>
              <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
                {t(isSelfie ? 'kycMaterials.selfieText' : 'kycMaterials.documentText')}
              </p>
              {!isSelfie && reasonText && (
                <p data-kyc-material-reason className="mt-2 break-words text-[13.5px] font-medium text-foreground">
                  {t('kycMaterials.reasonLabel', { reason: reasonText })}
                </p>
              )}
              {isSelfie && request.selfieComment && (
                <p data-kyc-material-comment className="mt-2 break-words text-[13.5px] font-medium text-foreground">
                  {t('kycMaterials.adminComment', { comment: request.selfieComment })}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {!done && (
        <>
          {/* Hidden real inputs: the picker, and (selfie) the phone camera fallback. */}
          <input
            ref={pickRef}
            type="file"
            accept={isSelfie ? 'image/jpeg,image/png' : 'image/jpeg,image/png,application/pdf'}
            className="sr-only"
            tabIndex={-1}
            aria-labelledby={ids.title}
            aria-describedby={ids.hint}
            data-kyc-material-input={part}
            disabled={submitting || preparing}
            onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ''; if (file) void handleFile(file); }}
          />
          {isSelfie && (
            <input
              ref={captureRef}
              type="file"
              accept="image/jpeg,image/png"
              capture="user"
              className="sr-only"
              tabIndex={-1}
              aria-labelledby={ids.title}
              disabled={submitting || preparing}
              onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ''; if (file) void handleFile(file); }}
            />
          )}

          {!open && !prepared && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {isSelfie ? (
                <button type="button" data-kyc-material-start={part} onClick={() => setOpen(true)} className={primaryButton}>
                  <ScanFace className="size-4" aria-hidden="true" />
                  {t('kycMaterials.takeSelfie')}
                </button>
              ) : (
                <button type="button" data-kyc-material-start={part} onClick={() => { setOpen(true); pickRef.current?.click(); }} className={primaryButton}>
                  <ImageUp className="size-4" aria-hidden="true" />
                  {t('kycMaterials.uploadDocument')}
                </button>
              )}
            </div>
          )}

          {open && (
            <div className="flex flex-col gap-4 rounded-xl border border-solid border-border bg-card p-4">
              {isSelfie && <p data-kyc-selfie-instructions className="text-[13px] leading-relaxed text-foreground">{t('kycMaterials.selfieInstructions')}</p>}
              <p id={ids.hint} className="text-[12.5px] text-muted-foreground">
                {t(isSelfie ? 'kycMaterials.selfieHint' : 'kycMaterials.documentHint')}
              </p>

              {camera ? (
                <SelfieCamera
                  onCapture={(file) => { setCamera(false); void handleFile(file); }}
                  onCancel={() => setCamera(false)}
                  onUnavailable={() => { setCamera(false); setFileError(t('kycMaterials.cameraUnavailable')); }}
                />
              ) : prepared && !preparing ? (
                <Preview
                  url={previewUrl}
                  name={fileName ?? prepared.file.name}
                  size={formatKycBytes(prepared.file.size)}
                  disabled={submitting}
                  onRemove={() => void handleFile(null)}
                />
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" data-kyc-material-pick={part} onClick={() => pickRef.current?.click()} disabled={preparing || submitting} className={secondaryButton}>
                    {preparing ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ImageUp className="size-4" aria-hidden="true" />}
                    {preparing ? t('settings.kycPreparingFile') : t(isSelfie ? 'kycMaterials.choosePhoto' : 'kycMaterials.uploadDocument')}
                  </button>
                  {isSelfie && (
                    <button type="button" data-kyc-material-camera onClick={startCamera} disabled={preparing || submitting} className={secondaryButton}>
                      <Camera className="size-4" aria-hidden="true" />
                      {t('kycMaterials.useCamera')}
                    </button>
                  )}
                </div>
              )}

              {prepared && !preparing && !camera && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={() => pickRef.current?.click()} disabled={submitting} className={secondaryButton}>
                    <ImageUp className="size-4" aria-hidden="true" />
                    {t('kycMaterials.retake')}
                  </button>
                  {isSelfie && (
                    <button type="button" onClick={startCamera} disabled={submitting} className={secondaryButton}>
                      <Camera className="size-4" aria-hidden="true" />
                      {t('kycMaterials.useCamera')}
                    </button>
                  )}
                </div>
              )}

              {fileError && <p id={ids.error} role="alert" className="text-[12.5px] text-danger">{fileError}</p>}

              {isSelfie && (
                <label htmlFor={ids.consent} className="flex cursor-pointer items-start gap-3 rounded-xl bg-secondary p-3 text-[12.5px] leading-relaxed text-foreground">
                  <input
                    id={ids.consent}
                    type="checkbox"
                    data-kyc-selfie-consent
                    checked={consent}
                    disabled={submitting}
                    onChange={(event) => { setConsent(event.target.checked); setError(null); }}
                    className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--accent)]"
                  />
                  <span>{t('kycMaterials.consent')}</span>
                </label>
              )}

              <p className="text-[12px] leading-relaxed text-muted-foreground">{t('kycMaterials.checksNote')}</p>

              {error && <div role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  data-kyc-material-submit={part}
                  onClick={() => void submit()}
                  disabled={submitting || preparing || camera || !prepared || (isSelfie && !consent)}
                  aria-busy={submitting || undefined}
                  className={primaryButton}
                >
                  {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                  {submitting ? t('settings.sending') : t('kycMaterials.submit')}
                </button>
                <button
                  type="button"
                  onClick={() => { setOpen(false); setCamera(false); void handleFile(null); }}
                  disabled={submitting}
                  className={secondaryButton}
                >
                  {t('kycMaterials.cancel')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Preview({ url, name, size, disabled, onRemove }: { url: string | null; name: string; size: string; disabled: boolean; onRemove: () => void }) {
  const { t } = useLanguage();
  return (
    <div data-kyc-material-preview className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
      {url ? (
        <img src={url} alt={t('kycMaterials.previewAlt')} className="max-h-56 w-full rounded-xl border border-solid border-border bg-secondary object-contain sm:w-56" />
      ) : (
        <span className="flex size-14 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><FileText className="size-6" aria-hidden="true" /></span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-foreground" title={name}>{name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-[oklch(0.5_0.13_155)]">
            <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{t('settings.kycFileReady', { size })}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('kycMaterials.removePhoto')}
          title={t('kycMaterials.removePhoto')}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_4px_var(--accent-dim)] disabled:opacity-50"
        >
          <X className="size-[18px]" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * The front camera, in the page. The preview is mirrored like a mirror; the
 * captured picture is not, so it compares with the document as it is. Every
 * track stops on capture, cancel or unmount. Nothing leaves the browser until
 * the user presses «Отправить на проверку».
 */
function SelfieCamera({ onCapture, onCancel, onUnavailable }: { onCapture: (file: File) => void; onCancel: () => void; onUnavailable: () => void }) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onUnavailable });
  callbacks.current.onUnavailable = onUnavailable;

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play().catch(() => {});
      })
      .catch(() => { if (!cancelled) callbacks.current.onUnavailable(); });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) { onUnavailable(); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) { onUnavailable(); return; }
      onCapture(new File([blob], 'selfie.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  }

  return (
    <div data-kyc-selfie-camera className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl bg-[oklch(0.2_0.01_258)]">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label={t('kycMaterials.cameraLabel')}
          onLoadedData={() => setReady(true)}
          className="block aspect-[4/3] max-h-[60vh] w-full object-cover [transform:scaleX(-1)]"
        />
        {!ready && (
          <span className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-white">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            {t('kycMaterials.cameraStarting')}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" data-kyc-selfie-capture onClick={capture} disabled={!ready} className={primaryButton}>
          <Camera className="size-4" aria-hidden="true" />
          {t('kycMaterials.capture')}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>{t('kycMaterials.cancel')}</button>
      </div>
    </div>
  );
}

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') { setUrl(null); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
