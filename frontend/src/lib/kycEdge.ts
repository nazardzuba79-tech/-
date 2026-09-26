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
    if (Date.now() - Number(parsed.at) > 7 * 24 * 60 * 60 * 1000) return null;
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
