import { isPublishableDocument, publishedDocuments, REGULATORY_DOCUMENTS, VERIFICATION_CHECKS, type RegulatoryDocument } from '../regulatoryDocuments';
import { reviewDocuments } from '../../../review/licences/reviewDocuments';

const today = new Date('2026-10-14T23:59:59Z');
const fixture = (): RegulatoryDocument => ({
  id: 'test-only', jurisdiction: 'Test jurisdiction', regulator: 'Test regulator', legalEntity: 'Test entity',
  documentType: 'Test authorisation', documentNumber: 'TEST-1', issueDate: '2024-01-01', expiryDate: '2027-01-01',
  regulatoryStatus: 'active', permittedActivities: ['Test activity'], restrictions: 'Test restriction',
  officialRegistryUrl: null, documentUrl: '/regulatory-documents/test-only.pdf', documentFormat: 'pdf',
  verifiedAt: '2026-10-14', reviewDueAt: '2026-10-20', publicationApproved: true, translations: {},
  verificationEvidence: VERIFICATION_CHECKS.map(check => ({ check, reference: `Test evidence for ${check}`, verified: true })),
});

describe('regulatory publication gate', () => {
  test('permits a verified, approved, current record, including its final valid day', () => {
    expect(isPublishableDocument(fixture(), today)).toBe(true);
    expect(isPublishableDocument({ ...fixture(), expiryDate: '2026-10-14', reviewDueAt: '2026-10-14' }, today)).toBe(true);
  });
  test.each(['unverified', 'expired', 'suspended', 'revoked'] as const)('excludes %s documents even with publication permission', regulatoryStatus => {
    expect(isPublishableDocument({ ...fixture(), regulatoryStatus }, today)).toBe(false);
  });
  test.each(VERIFICATION_CHECKS)('requires positive documented %s verification', check => {
    const record = fixture();
    record.verificationEvidence = record.verificationEvidence.filter(evidence => evidence.check !== check);
    expect(isPublishableDocument(record, today)).toBe(false);
    record.verificationEvidence = [...record.verificationEvidence, { check, verified: false, reference: 'Unconfirmed claim' }];
    expect(isPublishableDocument(record, today)).toBe(false);
  });
  test.each([
    { publicationApproved: false }, { verifiedAt: null }, { verifiedAt: '2026-10-15' }, { verifiedAt: '2023-12-31' },
    { reviewDueAt: null }, { reviewDueAt: '2026-10-13' }, { issueDate: '2026-02-30' }, { issueDate: '2026-10-15' },
    { expiryDate: '2026-10-13' }, { expiryDate: 'invalid' }, { documentUrl: null }, { legalEntity: '' },
    { permittedActivities: [] }, { documentUrl: 'https://unapproved.example/file.pdf' },
    { documentUrl: '/regulatory-documents/../test.pdf' }, { documentUrl: '/regulatory-documents/test.svg' },
    { documentUrl: 'javascript:alert(1)' }, { documentUrl: '/regulatory-documents/test.png', documentFormat: 'pdf' },
  ] as Partial<RegulatoryDocument>[])('rejects incomplete or unsafe record: %j', change => {
    expect(isPublishableDocument({ ...fixture(), ...change }, today)).toBe(false);
  });
  test('a missing expiry is not treated as expired when current-status verification exists', () => {
    expect(isPublishableDocument({ ...fixture(), expiryDate: null }, today)).toBe(true);
  });
  test('owner approval does not publish the seven unverified supplied candidates', () => {
    expect(reviewDocuments.every(record => record.publicationApproved)).toBe(true);
    expect(publishedDocuments(reviewDocuments, today)).toEqual([]);
    expect(publishedDocuments(REGULATORY_DOCUMENTS, today)).toEqual([]);
  });
  test('mixed catalog returns only eligible documents and never mutates the source', () => {
    const good = fixture();
    const records = [good, { ...fixture(), id: 'revoked', regulatoryStatus: 'revoked' as const }];
    expect(publishedDocuments(records, today)).toEqual([good]);
    expect(records).toHaveLength(2);
  });
});
