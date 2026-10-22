import type { Lang } from './i18n';

export const VERIFICATION_CHECKS = ['entity', 'operatorRelationship', 'documentNumber', 'currentStatus', 'activities', 'publicationRights'] as const;
export type VerificationCheck = typeof VERIFICATION_CHECKS[number];
export type RegulatoryStatus = 'unverified' | 'active' | 'expired' | 'suspended' | 'revoked';
export interface RegulatoryTranslation {
  jurisdiction: string;
  documentType: string;
  permittedActivities: readonly string[];
  restrictions: string;
}
export interface RegulatoryDocument {
  id: string;
  jurisdiction: string;
  regulator: string;
  legalEntity: string;
  documentType: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string | null;
  regulatoryStatus: RegulatoryStatus;
  permittedActivities: readonly string[];
  restrictions: string;
  officialRegistryUrl: string | null;
  documentUrl: string | null;
  documentFormat: 'image' | 'pdf';
  verifiedAt: string | null;
  // The reviewer supplies the next review date; the UI invents no legal expiry.
  reviewDueAt: string | null;
  verificationEvidence: readonly { check: VerificationCheck; reference: string; verified: boolean }[];
  publicationApproved: boolean;
  translations: Partial<Record<Lang, RegulatoryTranslation>>;
}

function utcDay(value: string | null): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const result = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(result) && new Date(result).toISOString().slice(0, 10) === value ? result : NaN;
}

function isDocumentAsset(url: string | null, format: RegulatoryDocument['documentFormat']): boolean {
  if (!url || !/^\/regulatory-documents\/[a-zA-Z0-9_-]+\.(pdf|png|jpe?g|webp)$/.test(url)) return false;
  return format === 'pdf' ? url.endsWith('.pdf') : !url.endsWith('.pdf');
}

/** Fail closed: publication permission alone never establishes verification. */
export function isPublishableDocument(document: RegulatoryDocument, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const today = utcDay(now.toISOString().slice(0, 10));
  const issued = utcDay(document.issueDate);
  const verified = utcDay(document.verifiedAt);
  const due = utcDay(document.reviewDueAt);
  const expiry = document.expiryDate === null ? Infinity : utcDay(document.expiryDate);
  return document.publicationApproved === true && document.regulatoryStatus === 'active'
    && [document.id, document.jurisdiction, document.regulator, document.legalEntity, document.documentType, document.documentNumber].every(value => value.trim().length > 0)
    && document.permittedActivities.length > 0 && document.permittedActivities.every(value => value.trim().length > 0)
    && Number.isFinite(issued) && issued <= today
    && Number.isFinite(verified) && verified >= issued && verified <= today
    && Number.isFinite(due) && due >= today && expiry >= today
    && isDocumentAsset(document.documentUrl, document.documentFormat)
    && VERIFICATION_CHECKS.every(check => document.verificationEvidence.some(evidence => evidence.check === check && evidence.verified === true && evidence.reference.trim().length > 0));
}

export function publishedDocuments(catalogue: readonly RegulatoryDocument[], now = new Date()): RegulatoryDocument[] {
  return catalogue.filter(document => isPublishableDocument(document, now));
}

// Approved originals and their evidence are added together after verification.
// The supplied collage and its unverified transcription live only in the local
// review entry; neither is imported by the production application.
export const REGULATORY_DOCUMENTS: readonly RegulatoryDocument[] = [];
