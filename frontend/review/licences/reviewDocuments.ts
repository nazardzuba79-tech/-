import type { RegulatoryDocument } from '../../src/lib/regulatoryDocuments';

// Transcription of the owner's image, NOT findings of regulatory verification.
// No fabricated register references, inferred permissions or active statuses.
const candidates = [
  ['mas', 'Singapore', 'MAS', 'VOLTEX PTE. LTD.', 'Licence for Digital Payment Token Services', 'PS2024/0187', '2024-01-12', '2027-01-11', ['Digital Payment Token (DPT) Services', 'Custodial Wallet Services', 'Facilitation of DPT Trading Platforms']],
  ['fca', 'United Kingdom', 'FCA', 'VOLTEX LTD', 'Certificate of Registration as a Cryptoasset Business', '970321', '2024-03-14', null, ['Cryptoasset exchange provider', 'Custodian wallet provider']],
  ['vara', 'United Arab Emirates · Dubai', 'VARA', 'VOLTEX FZE', 'Virtual Asset Service Provider Licence', 'VARA-2024-001234', '2024-02-22', '2027-02-21', ['Virtual Asset Exchange Services', 'Broker-Dealer Services', 'Custody and Wallet Services', 'Virtual Asset Management Services']],
  ['sfc', 'Hong Kong', 'SFC', 'VOLTEX (HONG KONG) LIMITED', 'Licence for Type 1 and Type 7 Regulated Activities', 'BMT765', '2024-04-08', '2027-04-07', ['Type 1 — Dealing in Securities', 'Type 7 — Providing Automated Trading Services']],
  ['cysec', 'Cyprus', 'CySEC', 'VOLTEX (CYPRUS) LTD', 'Authorisation for the Provision of Crypto-Asset Services', '387/2024', '2024-03-05', '2027-03-04', ['Operation of a Crypto-Asset Trading Platform', 'Custody and Administration of Crypto-Assets', 'Execution of Orders on Behalf of Clients']],
  ['finma', 'Switzerland', 'FINMA', 'VOLTEX AG', 'Authorisation as a Financial Intermediary in the Fintech Sector', 'FINMA-FINTECH-2024-4587', '2024-03-18', '2027-03-17', ['Operation of a Digital Asset Trading Facility', 'Custody of Crypto Assets', 'Participation in Financial Market Infrastructures', 'Provision of Financial Services in the Fintech Sector']],
  ['cmvm', 'Portugal', 'CMVM', 'VOLTEX, LDA.', 'Autorização para a Prestação de Serviços de Ativos Virtuais', 'AV/2024/0031', '2024-04-10', '2027-04-09', ['Plataforma de Negociação de Ativos Virtuais', 'Serviços de Guarda e Administração de Ativos Virtuais', 'Execução de Ordens por Conta de Clientes']],
] as const;

export const reviewDocuments: readonly RegulatoryDocument[] = candidates.map(([id, jurisdiction, regulator, legalEntity, documentType, documentNumber, issueDate, expiryDate, permittedActivities]) => ({
  id, jurisdiction, regulator, legalEntity, documentType, documentNumber, issueDate, expiryDate, permittedActivities,
  regulatoryStatus: 'unverified', restrictions: '', officialRegistryUrl: null,
  // Local file supplied by the owner. Never placed in public/ or dist/.
  documentUrl: '/review/licences/portfolio.png', documentFormat: 'image',
  verifiedAt: null, reviewDueAt: null, verificationEvidence: [],
  publicationApproved: true, // Owner permission is separate from verification.
  translations: {}, // Legal designations retain the source document's language.
}));
