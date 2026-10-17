import { ApiError, getToken } from './api';
import type { Key } from './i18n/locales/keys';

/**
 * KYC document upload — straight to the Cloudflare KYC edge
 * (workers/kyc-edge), which emails it to the admin mailbox. The document is
 * never sent to the VOLTEX API (Render) and never stored anywhere of ours.
 *
 * Before upload, a photo is re-encoded in the browser: long edge ≤ 2400 px,
 * JPEG q≈0.85. Re-encoding through a canvas also drops EXIF/GPS metadata.
 * PDFs are sent as they are (recompressing a PDF safely is not a browser job)
 * under the same 4 MB cap the edge enforces.
 */

export const KYC_EDGE_URL = (import.meta.env.VITE_KYC_EDGE_URL as string | undefined) || 'https://kyc.voltextech.net';
export const KYC_MAX_BYTES = 4 * 1024 * 1024;
const MAX_EDGE_PX = 2400;
const FALLBACK_EDGE_PX = 2000;
const JPEG_QUALITY = 0.85;
const FALLBACK_QUALITY = 0.82;
const RECEIPT_KEY = 'voltex_kyc_receipt';
const MATERIAL_RECEIPTS_KEY = 'voltex_kyc_material_receipts';
const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type KycDocumentType = 'PASSPORT' | 'ID_CARD' | 'DRIVERS_LICENSE';

export class KycFileError extends Error {
  constructor(public code: 'kyc_file_type' | 'kyc_file_too_large') {
    super(code);
  }
}

export interface PreparedKycDocument {
  file: File;
  originalBytes: number;
  compressed: boolean;
}

/** Where a server/edge refusal points in the dictionary. Everything else falls back. */
export const KYC_ERROR_KEYS: Record<string, Key> = {
  kyc_auth_required: 'serverError.signInRequired',
  kyc_already_verified: 'serverError.alreadyVerified',
  kyc_already_pending: 'serverError.reviewPending',
  kyc_file_required: 'serverError.documentRequired',
  kyc_file_type: 'settings.kycFileType',
  kyc_file_mismatch: 'settings.kycFileType',
  kyc_file_too_large: 'settings.kycFileTooLarge',
  kyc_email_failed: 'settings.kycDeliveryFailed',
  kyc_rate_limited: 'serverError.tooManyAttempts',
  kyc_bad_request: 'serverError.checkFields',
  kyc_service_unavailable: 'serverError.unavailable',
  kyc_edge_not_configured: 'serverError.unavailable',
  kyc_timeout: 'serverError.unavailable',
  kyc_edge_error: 'serverError.unavailable',
  kyc_upload_moved: 'serverError.unavailable',
  // Additional materials (a new document photo or a selfie the admin asked for).
  kyc_selfie_consent_required: 'kycMaterials.consentRequired',
  kyc_material_request_closed: 'kycMaterials.requestClosed',
  kyc_material_request_not_found: 'kycMaterials.requestClosed',
  kyc_material_not_requested: 'kycMaterials.requestClosed',
  kyc_material_already_received: 'kycMaterials.alreadyReceived',
};

export function formatKycBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Scale so the long edge is at most `maxEdge`; never upscales. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

type Encoder = (file: File, maxEdge: number, quality: number) => Promise<Blob | null>;

/** Canvas re-encode. `imageOrientation: 'from-image'` keeps a phone photo upright once EXIF is gone. */
const canvasEncoder: Encoder = async (file, maxEdge, quality) => {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // White under transparent PNG areas instead of JPEG's black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } finally {
    bitmap.close?.();
  }
};

/**
 * The file that will actually be uploaded. Images are re-encoded (smaller,
 * metadata stripped); if the browser cannot, the original is used when it
 * fits. Throws KycFileError for a wrong type or a file that cannot fit.
 */
export async function prepareKycDocument(file: File, encode: Encoder = canvasEncoder): Promise<PreparedKycDocument> {
  const type = (file.type || '').toLowerCase();
  if (type === 'application/pdf') {
    if (file.size > KYC_MAX_BYTES) throw new KycFileError('kyc_file_too_large');
    return { file, originalBytes: file.size, compressed: false };
  }
  if (type !== 'image/jpeg' && type !== 'image/png') throw new KycFileError('kyc_file_type');

  for (const [edge, quality] of [[MAX_EDGE_PX, JPEG_QUALITY], [FALLBACK_EDGE_PX, FALLBACK_QUALITY]] as const) {
    let blob: Blob | null = null;
    try {
      blob = await encode(file, edge, quality);
    } catch {
      blob = null;
    }
    if (!blob) break; // this browser cannot re-encode; fall through to the original
    // Always prefer the re-encoded copy when it fits: it carries no EXIF/GPS.
    if (blob.size <= KYC_MAX_BYTES) {
      return { file: new File([blob], 'document.jpg', { type: 'image/jpeg' }), originalBytes: file.size, compressed: true };
    }
  }
  if (file.size > KYC_MAX_BYTES) throw new KycFileError('kyc_file_too_large');
  return { file, originalBytes: file.size, compressed: false };
}

/** One random id per submission attempt; the same attempt retried reuses it. */
export function newKycRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface KycEdgeResult {
  status: 'PENDING';
  submissionId: string;
  confirmed: boolean;
  receipt?: string;
}

interface StoredReceipt { submissionId: string; receipt: string; at: number }

/** The sealed receipt is opaque ciphertext (only the edge can open it): no name, DOB or document. */
export function readKycReceipt(storage: Pick<Storage, 'getItem'> | null = safeStorage()): StoredReceipt | null {
  try {
    const raw = storage?.getItem(RECEIPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredReceipt;
    if (typeof parsed?.submissionId !== 'string' || typeof parsed?.receipt !== 'string') return null;
    if (Date.now() - Number(parsed.at) > RECEIPT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearKycReceipt(storage: Pick<Storage, 'removeItem'> | null = safeStorage()): void {
  try { storage?.removeItem(RECEIPT_KEY); } catch { /* storage unavailable */ }
}

function storeKycReceipt(value: StoredReceipt): void {
  try { safeStorage()?.setItem(RECEIPT_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

async function readEdgeResponse(res: Response): Promise<KycEdgeResult> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.code === 'string' ? body.code : '';
    throw new ApiError(code || `Request failed (${res.status})`, res.status, body);
  }
  return body as unknown as KycEdgeResult;
}

/** Upload once. Success means the email provider accepted the document. */
export async function submitKycToEdge(fields: {
  requestId: string;
  country: string;
  fullName: string;
  dateOfBirth: string;
  documentType: KycDocumentType;
  document: File;
}, fetchImpl: typeof fetch = fetch): Promise<KycEdgeResult> {
  const form = new FormData();
  form.append('requestId', fields.requestId);
  form.append('country', fields.country);
  form.append('fullName', fields.fullName);
  form.append('dateOfBirth', fields.dateOfBirth);
  form.append('documentType', fields.documentType);
  form.append('document', fields.document);
  const token = getToken();
  const res = await fetchImpl(`${KYC_EDGE_URL}/v1/submit`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
    cache: 'no-store',
    credentials: 'omit',
  });
  const result = await readEdgeResponse(res);
  if (!result.confirmed && result.receipt) {
    storeKycReceipt({ submissionId: result.submissionId, receipt: result.receipt, at: Date.now() });
  } else {
    clearKycReceipt();
  }
  return result;
}

/**
 * The document is already delivered; only the small metadata call is owed.
 * Resends the sealed receipt — never the file. True when it is recorded.
 */
export async function retryKycReceipt(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const stored = readKycReceipt();
  if (!stored) return false;
  try {
    const res = await fetchImpl(`${KYC_EDGE_URL}/v1/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipt: stored.receipt }),
      cache: 'no-store',
      credentials: 'omit',
    });
    if (res.ok) {
      clearKycReceipt();
      return true;
    }
    if (res.status === 400) clearKycReceipt(); // expired or unreadable: nothing left to retry
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- additional materials

/**
 * A new photo of the document or a selfie, asked for by the admin reviewing
 * the application. Same road as the original document: browser → KYC edge →
 * admin mailbox; Render only learns that it arrived. The edge checks with
 * Render that the request is this user's, still open and asks for this part.
 */
export type KycMaterialPart = 'DOCUMENT' | 'SELFIE';

/** The consent wording shown next to the checkbox; the edge and Render pin the same version. */
export const KYC_SELFIE_CONSENT_VERSION = 'kyc-selfie-v1';

/**
 * Basic, honest quality floor. It says nothing about whether a photo is
 * genuine or good enough — only that it is an image large enough for a person
 * to read. The admin makes every judgement.
 */
export const KYC_MIN_IMAGE: Record<KycMaterialPart, { long: number; short: number }> = {
  DOCUMENT: { long: 1000, short: 600 },
  SELFIE: { long: 640, short: 480 },
};

export class KycImageError extends Error {
  constructor(public code: 'kyc_image_unreadable' | 'kyc_image_too_small', public size?: { width: number; height: number }) {
    super(code);
  }
}

type ImageMeasure = (file: File) => Promise<{ width: number; height: number } | null>;

const bitmapMeasure: ImageMeasure = async (file) => {
  if (typeof createImageBitmap !== 'function') return null; // cannot check here; the admin still looks
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close?.();
  }
};

/**
 * Throws KycImageError when the browser cannot decode the image (corrupt or
 * not really an image) or it is below the floor for that part. PDFs are not
 * measured. Returns the measured size, or null when the browser cannot measure.
 */
export async function checkKycImage(file: File, part: KycMaterialPart, measure: ImageMeasure = bitmapMeasure): Promise<{ width: number; height: number } | null> {
  if ((file.type || '').toLowerCase() === 'application/pdf') return null;
  let size: { width: number; height: number } | null;
  try {
    size = await measure(file);
  } catch {
    throw new KycImageError('kyc_image_unreadable');
  }
  if (!size) return null;
  if (size.width <= 0 || size.height <= 0) throw new KycImageError('kyc_image_unreadable');
  const min = KYC_MIN_IMAGE[part];
  if (Math.max(size.width, size.height) < min.long || Math.min(size.width, size.height) < min.short) {
    throw new KycImageError('kyc_image_too_small', size);
  }
  return size;
}

export interface KycMaterialResult {
  status: 'RECEIVED';
  part: KycMaterialPart;
  deliveryId: string;
  confirmed: boolean;
  complete?: boolean;
  duplicate?: boolean;
  receipt?: string;
}

interface StoredMaterialReceipt { materialRequestId: string; part: KycMaterialPart; deliveryId: string; receipt: string; at: number }

/** Sealed receipts (opaque to the browser) for materials delivered but not yet recorded. */
export function readKycMaterialReceipts(storage: Pick<Storage, 'getItem'> | null = safeStorage()): StoredMaterialReceipt[] {
  try {
    const raw = storage?.getItem(MATERIAL_RECEIPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredMaterialReceipt[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => typeof r?.receipt === 'string' && typeof r?.deliveryId === 'string' && typeof r?.materialRequestId === 'string'
      && (r.part === 'DOCUMENT' || r.part === 'SELFIE') && Date.now() - Number(r.at) <= RECEIPT_TTL_MS);
  } catch {
    return [];
  }
}

function writeKycMaterialReceipts(list: StoredMaterialReceipt[]): void {
  try {
    const storage = safeStorage();
    if (!storage) return;
    if (list.length) storage.setItem(MATERIAL_RECEIPTS_KEY, JSON.stringify(list.slice(-4)));
    else storage.removeItem(MATERIAL_RECEIPTS_KEY);
  } catch { /* storage unavailable */ }
}

/** Upload one part once. Success means the email provider accepted the file. */
export async function submitKycMaterialToEdge(fields: {
  requestId: string;
  materialRequestId: string;
  part: KycMaterialPart;
  file: File;
  /** Required for a selfie: the user ticked the consent box for this upload. */
  selfieConsent?: boolean;
}, fetchImpl: typeof fetch = fetch): Promise<KycMaterialResult> {
  const form = new FormData();
  form.append('requestId', fields.requestId);
  form.append('materialRequestId', fields.materialRequestId);
  form.append('part', fields.part);
  if (fields.part === 'SELFIE' && fields.selfieConsent) {
    form.append('selfieConsent', 'true');
    form.append('consentVersion', KYC_SELFIE_CONSENT_VERSION);
  }
  form.append('file', fields.file);
  const token = getToken();
  const res = await fetchImpl(`${KYC_EDGE_URL}/v1/materials`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
    cache: 'no-store',
    credentials: 'omit',
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.code === 'string' ? body.code : '';
    throw new ApiError(code || `Request failed (${res.status})`, res.status, body);
  }
  const result = body as unknown as KycMaterialResult;
  if (!result.confirmed && typeof result.receipt === 'string' && typeof result.deliveryId === 'string') {
    const rest = readKycMaterialReceipts().filter((r) => r.deliveryId !== result.deliveryId);
    writeKycMaterialReceipts([...rest, { materialRequestId: fields.materialRequestId, part: fields.part, deliveryId: result.deliveryId, receipt: result.receipt, at: Date.now() }]);
  }
  return result;
}

/**
 * Resend the sealed receipts — never a file. Returns how many are still owed.
 * A receipt the edge refuses as unreadable/expired (400) is dropped.
 */
export async function retryKycMaterialReceipts(fetchImpl: typeof fetch = fetch): Promise<number> {
  const pending = readKycMaterialReceipts();
  const left: StoredMaterialReceipt[] = [];
  for (const item of pending) {
    try {
      const res = await fetchImpl(`${KYC_EDGE_URL}/v1/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt: item.receipt }),
        cache: 'no-store',
        credentials: 'omit',
      });
      if (!res.ok && res.status !== 400) left.push(item);
    } catch {
      left.push(item);
    }
  }
  writeKycMaterialReceipts(left);
  return left.length;
}

/** Drop receipts the server no longer needs (the request is closed or the part is recorded). */
export function forgetKycMaterialReceipts(keep: (r: StoredMaterialReceipt) => boolean): void {
  const list = readKycMaterialReceipts();
  const next = list.filter(keep);
  if (next.length !== list.length) writeKycMaterialReceipts(next);
}
