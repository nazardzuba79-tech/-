import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCatalog, readCurrentAudit } from './stocks-onchain-release-gate.mjs';

test('real checked-in catalogue remains structurally valid and production NO-GO', () => {
  const result = readCurrentAudit();
  assert.equal(result.structuralStatus, 'PASS');
  assert.equal(result.productionDecision, 'NO_GO');
  assert.deepEqual(result.counts, {
    candidates: 58,
    snapshotActivityCandidates: 36,
    directOnchainCheckedTickers: 7,
    geckoApiIndexedTickers: 19,
    withEitherExtraEvidence: 22,
    unverifiedTickers: 36,
  });
});
const valid = {
  discovered: [
    { ticker:'SPYx',mint:'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
      pool:'4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw',
      verifiedOnChain:false,liquidityUSD:3000,tx24hReported:100 },
  ],
  directOnchain: [
    { ticker:'SPYx',mint:'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
      pool:'4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw' },
  ],
  gecko: {
    provenance: { generatedAtUtc:'2026-10-25T07:21:42.764Z',rightsToRedistribute:false,
      productionReady:false,iframeRuntimeChecked:false },
    markets: [{ticker:'SPYx',mint:'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
      pool:'4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw',geckoIndexed:true}],
  },
};
const copy = () => JSON.parse(JSON.stringify(valid));
test('issuer mismatch fails closed', () => {
  const rows = copy();
  rows.gecko.markets[0].mint = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
  assert.equal(auditCatalog(rows).structuralStatus, 'FAIL');
});
test('unproven onchain claims fail closed', () => {
  const rows = copy(); rows.discovered[0].verifiedOnChain = true;
  assert.ok(auditCatalog(rows).problems.includes('UNPROVEN_ONCHAIN_FLAG:SPYx'));
});
test('accidental production or redistribution flags fail closed', () => {
  const rows = copy(); rows.gecko.provenance.productionReady = true;
  assert.ok(auditCatalog(rows).problems.includes('UNSAFE_RELEASE_METADATA'));
});
test('duplicate ticker fails closed', () => {
  const rows = copy(); rows.discovered.push({...rows.discovered[0]});
  assert.ok(auditCatalog(rows).problems.includes('DUPLICATE_TICKER:SPYx'));
});
test('unrecognized Solana pool address fails closed', () => {
  const rows = copy(); rows.gecko.markets[0].pool = 'spoofed';
  assert.ok(auditCatalog(rows).problems.includes('INVALID_ADDRESS:GECKO_POOL:SPYx'));
});
