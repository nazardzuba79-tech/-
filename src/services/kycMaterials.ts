import { createHmac } from 'crypto';
import type { KycMaterialRequest, PrismaClient } from '@prisma/client';

/**
 * KYC additional materials — the vocabulary and the state machine.
 *
 * An admin reviewing a PENDING submission can ask the user for a new photo of
 * the document, an ordinary selfie for a manual face comparison, or both,
 * without rejecting the submission. The files take the same road as the
 * submission's document: browser → Cloudflare KYC edge → admin mailbox. This
 * server never receives, stores or serves them; it keeps the request, what
 * arrived (type, size, Message-ID), the selfie consent and every decision.
 *
 * `User.kycStatus` stays PENDING for the whole cycle, so every feature gated on
 * it behaves exactly as before. The finer review stage is derived here from the
 * submission and its newest unclosed request — one function, used by the user
 * endpoint and the admin views alike.
 *
 * No automatic biometric comparison exists anywhere: the admin compares the
 * pictures by eye. Nothing here produces a similarity score or a decision.
 */

export const MATERIAL_KINDS = ['DOCUMENT', 'SELFIE', 'DOCUMENT_AND_SELFIE'] as const;
export type MaterialKind = typeof MATERIAL_KINDS[number];
export const MATERIAL_PARTS = ['DOCUMENT', 'SELFIE'] as const;
export type MaterialPart = typeof MATERIAL_PARTS[number];
export const DOCUMENT_REASONS = ['BLURRY', 'UNREADABLE', 'CROPPED', 'LOW_LIGHT', 'OTHER'] as const;
export type DocumentReason = typeof DOCUMENT_REASONS[number];

/** The consent wording the user accepted is versioned; a change of wording is a new version. */
export const SELFIE_CONSENT_VERSION = 'kyc-selfie-v1';

export const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
/** A selfie is a photograph: no PDF. */
export const SELFIE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export const MAX_MATERIAL_BYTES = 4 * 1024 * 1024;

export type KycReviewStage =
  | 'NOT_STARTED'
  | 'UNDER_REVIEW'
  | 'DOCUMENT_REQUIRED'
  | 'SELFIE_REQUIRED'
  | 'DOCUMENT_AND_SELFIE_REQUIRED'
  | 'MATERIALS_RECEIVED'
  | 'RE_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export const needsDocument = (kind: string) => kind === 'DOCUMENT' || kind === 'DOCUMENT_AND_SELFIE';
export const needsSelfie = (kind: string) => kind === 'SELFIE' || kind === 'DOCUMENT_AND_SELFIE';

type StageRequest = Pick<KycMaterialRequest, 'kind' | 'status' | 'documentReceivedAt' | 'selfieReceivedAt' | 'acknowledgedAt' | 'closedAt'>;

/** True when every part the request asked for has arrived. */
export function requestComplete(r: Pick<KycMaterialRequest, 'kind' | 'documentReceivedAt' | 'selfieReceivedAt'>): boolean {
  return (!needsDocument(r.kind) || !!r.documentReceivedAt) && (!needsSelfie(r.kind) || !!r.selfieReceivedAt);
}

/**
 * The review stage of a submission. `request` is the submission's newest
 * request that is not closed (OPEN or RECEIVED), or null.
 */
export function kycReviewStage(submission: { status: string } | null, request: StageRequest | null): KycReviewStage {
  if (!submission) return 'NOT_STARTED';
  if (submission.status === 'APPROVED') return 'APPROVED';
  if (submission.status === 'REJECTED') return 'REJECTED';
  if (!request || request.closedAt) return 'UNDER_REVIEW';
  const missingDocument = needsDocument(request.kind) && !request.documentReceivedAt;
  const missingSelfie = needsSelfie(request.kind) && !request.selfieReceivedAt;
  if (missingDocument && missingSelfie) return 'DOCUMENT_AND_SELFIE_REQUIRED';
  if (missingDocument) return 'DOCUMENT_REQUIRED';
  if (missingSelfie) return 'SELFIE_REQUIRED';
  return request.acknowledgedAt ? 'RE_REVIEW' : 'MATERIALS_RECEIVED';
}

/** The newest request that is still open or received (not closed). */
export function activeRequest<T extends Pick<KycMaterialRequest, 'closedAt' | 'createdAt'>>(rows: readonly T[]): T | null {
  return [...rows].filter(r => !r.closedAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

/**
 * One delivery id per (user, request, part, browser attempt). Stable across a
 * retry of the same attempt, different for a new attempt — so a double click or
 * a retried upload can never create a second record or a second email.
 */
export function kycMaterialDeliveryId(userId: string, materialRequestId: string, part: MaterialPart, requestId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is required');
  const hex = createHmac('sha256', secret)
    .update(`voltex-kyc-material:v1:${userId}:${materialRequestId.toLowerCase()}:${part}:${requestId.toLowerCase()}`)
    .digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** What the user sees about the active request: the ask and the reason, nothing internal. */
export function userMaterialView(r: KycMaterialRequest) {
  return {
    id: r.id,
    kind: r.kind,
    documentReason: needsDocument(r.kind) ? r.documentReason : null,
    documentReasonText: needsDocument(r.kind) && r.documentReason === 'OTHER' ? r.documentReasonText : null,
    selfieComment: needsSelfie(r.kind) ? r.selfieComment : null,
    documentRequested: needsDocument(r.kind),
    selfieRequested: needsSelfie(r.kind),
    documentReceived: !!r.documentReceivedAt,
    selfieReceived: !!r.selfieReceivedAt,
    createdAt: r.createdAt,
  };
}

/** The admin's full view of one request, for the history and the decision screen. */
export function adminMaterialView(r: KycMaterialRequest) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    documentReason: r.documentReason,
    documentReasonText: r.documentReasonText,
    selfieComment: r.selfieComment,
    requestedBy: r.requestedBy,
    createdAt: r.createdAt,
    document: needsDocument(r.kind) ? {
      receivedAt: r.documentReceivedAt, messageId: r.documentMessageId, mimeType: r.documentMimeType, sizeBytes: r.documentSizeBytes,
    } : null,
    selfie: needsSelfie(r.kind) ? {
      receivedAt: r.selfieReceivedAt, messageId: r.selfieMessageId, mimeType: r.selfieMimeType, sizeBytes: r.selfieSizeBytes,
      consentAt: r.selfieConsentAt, consentVersion: r.selfieConsentVersion,
    } : null,
    acknowledgedAt: r.acknowledgedAt,
    closedAt: r.closedAt,
    closedOutcome: r.closedOutcome,
  };
}

/** Newest first, up to `perSubmission` each, for a page of submissions — one query. */
export async function materialRequestsBySubmission(prisma: PrismaClient, submissionIds: readonly string[], perSubmission = 20): Promise<Map<string, KycMaterialRequest[]>> {
  const out = new Map<string, KycMaterialRequest[]>();
  if (!submissionIds.length) return out;
  const rows = await prisma.kycMaterialRequest.findMany({
    where: { submissionId: { in: [...submissionIds] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(2000, submissionIds.length * perSubmission),
  });
  for (const row of rows) {
    const list = out.get(row.submissionId) ?? [];
    if (list.length < perSubmission) list.push(row);
    out.set(row.submissionId, list);
  }
  return out;
}

/** The admin view of a submission's review stage and its request history. */
export function submissionMaterials(submission: { status: string }, requests: readonly KycMaterialRequest[]) {
  const active = activeRequest(requests);
  return {
    reviewStage: kycReviewStage(submission, active),
    activeMaterialRequestId: active?.id ?? null,
    materialRequests: requests.map(adminMaterialView),
  };
}
