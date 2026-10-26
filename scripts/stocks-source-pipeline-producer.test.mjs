import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replayPacket, forwardCaptureProtocol, GATES, digest } from './stocks-source-pipeline.mjs';

// Negative copies of public historical evidence only. Synthetic positive price
// machinery stays in stocks-source-pipeline.test.mjs and never proves a market.
const archived = ticker => `research/solana-xstocks/proof-615-20261025/${ticker}-final`;
async function withPacket(mutate, verify) {
  const root = await mkdtemp(join(tmpdir(), 'stocks615-producer-')), directory = join(root, 'SPYx');
  try {
    await cp(archived('SPYx'), directory, { recursive: true });
    const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
    await mutate(manifest, directory);
    await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest));
    await verify(directory);
  } finally { await rm(root, { recursive: true, force: true }); }
}

for (const [ticker, directory, count] of [
  ['SPYx', archived('SPYx'), 13], ['CRCLx', archived('CRCLx'), 2],
  ['SPYx', 'research/solana-xstocks/proof-615-20261026/windows-executions-1793034915829/SPYx', 8],
  ['CRCLx', 'research/solana-xstocks/proof-615-20261026/windows-executions-1793034915829/CRCLx', 3],
]) test(`archive producer: ${ticker} ${directory} has named UNKNOWN evidence and zero RPC`, async () => {
  const { report, pipeline } = await replayPacket(directory);
  assert.equal(report.candidateTransactions, count);
  assert.equal(report.acceptedIntervals, 0); assert.equal(report.acceptedMarkets, 0); assert.equal(report.networkRequests, 0);
  assert.deepEqual(Object.keys(report.missingEvidence).sort(), GATES.filter(g => g !== 'executionBinding').sort());
  for (const [gate, reason] of Object.entries(report.missingEvidence)) {
    assert.equal(report.gates[gate], false); assert(reason.length > 40);
  }
  assert.equal(report.gates.executionBinding, true);
  assert.match(report.producerBoundary, /not live consensus/);
  assert([...pipeline.minutes.values()].every(m => m.proof.synthetic === false));
  assert(Object.values(report.pages).every(page => page.candles.length === 0 && page.provenance.status === 'UNKNOWN'));
});

test('forged manifest PASS/gates/attestation/price claims cannot upgrade the existing producer', async () => {
  await withPacket(async m => {
    m.gates = Object.fromEntries(GATES.map(g => [g, true]));
    m.proof = { gates: m.gates, synthetic: false, receiptsHash: 'a'.repeat(64) };
    m.programVersionVerified = m.intervalComplete = m.multiplierChronologyVerified = m.productionReady = true;
    m.programAttestation = { is_verified: true, declaredByManifest: true };
    m.status = 'PASS'; m.ohlcv = [{ time: 1792924740, open: 10, high: 12, low: 9, close: 11, volume: 4 }];
  }, async directory => {
    const { report } = await replayPacket(directory);
    assert.equal(report.acceptedIntervals, 0);
    assert(GATES.filter(g => g !== 'executionBinding').every(g => report.gates[g] === false));
    assert(Object.values(report.pages).every(p => p.candles.length === 0 && p.provenance.intervalComplete === false));
  });
});

for (const [name, change, reason] of [
  ['pool', m => { m.pool = m.mint; }, 'ARCHIVE_SOURCE_SCOPE'],
  ['mint', m => { m.mint = m.identity.mints[1]; }, 'ARCHIVE_SOURCE_SCOPE'],
  ['network', m => { m.network = 'solana-devnet'; }, 'ARCHIVE_SOURCE_SCOPE'],
  ['other pilot ticker', m => { m.ticker = 'CRCLx'; }, 'ARCHIVE_SOURCE_SCOPE'],
  ['unapproved ticker', m => { m.ticker = 'FAKEx'; }, 'UNAPPROVED_PILOT'],
  ['window', m => { m.windowUTC = ['2026-10-25T10:38:00Z', '2026-10-25T10:39:00Z']; }, 'ARCHIVE_WINDOW_SCOPE'],
  ['mixed published windows', m => { m.windowUTC = ['2026-10-26T17:03:00.000Z', '2026-10-26T17:04:00.000Z']; }, 'ARCHIVE_RECEIPT_BINDING'],
  ['pool-decoded mint identity', m => { m.identity.mints[0] = m.identity.mints[1]; }, 'QUOTE_ORDER'],
  ['pool-decoded decimals', m => { m.identity.decimals[0] = 9; }, 'PINNED_POOL_LAYOUT'],
  ['transaction signature', m => { m.transactions[0].signature = '2'.repeat(64); }, 'ARCHIVE_TRANSACTION_SCOPE'],
  ['transaction slot', m => { m.transactions[0].slot++; }, 'ARCHIVE_TRANSACTION_SCOPE'],
  ['transaction time', m => { m.transactions[0].blockTime++; }, 'ARCHIVE_TRANSACTION_SCOPE'],
  ['canonical index', m => { m.transactions[0].transactionOrderWithinBlock = 999; }, 'ARCHIVE_TRANSACTION_SCOPE'],
  ['extra transaction', m => { m.transactions.push(m.transactions[0]); }, 'ARCHIVE_TRANSACTION_SCOPE'],
  ['omitted transaction', m => { m.transactions.pop(); }, 'ARCHIVE_TRANSACTION_SCOPE'],
  ['omitted receipt', m => { m.receipts.pop(); }, 'ARCHIVE_RECEIPT_BINDING'],
  ['duplicate receipt alias', m => { m.receipts[1].file = m.receipts[0].file; }, 'ARCHIVE_RECEIPT_BINDING'],
  ['foreign receipt endpoint', m => { m.receipts[1].url = 'https://example.invalid'; }, 'ARCHIVE_RECEIPT_BINDING'],
  ['unfinalized request', m => { m.receipts.find(r => r.method === 'getTransaction').params[1].commitment = 'confirmed'; }, 'ARCHIVE_RECEIPT_BINDING'],
]) test(`archive producer rejects mismatched ${name}`, async () => {
  await withPacket(async m => change(m), directory => assert.rejects(replayPacket(directory), new RegExp(reason)));
});

test('self-consistent forged signature plus rehashed receipt/manifest is not a trusted archive', async () => {
  await withPacket(async (m, directory) => {
    const receipt = m.receipts.find(r => r.method === 'getTransaction'), original = receipt.params[0];
    const tx = JSON.parse(await readFile(`${directory}/${receipt.file}`, 'utf8'));
    const signature = '3'.repeat(64); tx.result.transaction.signatures[0] = signature;
    const raw = JSON.stringify(tx); await writeFile(`${directory}/${receipt.file}`, raw);
    receipt.sha256 = digest(raw); receipt.params[0] = signature;
    m.transactions.find(t => t.signature === original).signature = signature;
  }, directory => assert.rejects(replayPacket(directory), /ARCHIVE_RECEIPT_BINDING/));
});

test('raw receipt corruption with unchanged manifest is still caught by the existing verifier', async () => {
  await withPacket(async (m, directory) => {
    const receipt = m.receipts.find(r => r.method === 'getTransaction');
    await writeFile(`${directory}/${receipt.file}`, '{"result":null}');
  }, directory => assert.rejects(replayPacket(directory), /RECEIPT_HASH_OR_STATUS/));
});

test('manifest row order and capture bookkeeping do not change source scope or acceptance', async () => {
  await withPacket(async m => {
    m.transactions.reverse(); m.receipts.reverse(); m.rpcRequests = 999; m.startedAt = 'untrusted bookkeeping';
    for (const r of m.receipts) r.reusedFrom = 'untrusted bookkeeping';
  }, async directory => {
    const { report } = await replayPacket(directory);
    assert.equal(report.candidateTransactions, 13); assert.equal(report.networkRequests, 0); assert.equal(report.acceptedIntervals, 0);
  });
});

test('archive factory and forward protocol do not attempt HTTP even when fetch is unavailable', async t => {
  const http = t.mock.method(globalThis, 'fetch', () => { throw Error('UNEXPECTED_NETWORK'); });
  const { report } = await replayPacket(archived('CRCLx'));
  const protocol = await forwardCaptureProtocol('CRCLx', '2026-10-27T10:39:00Z', '2026-10-27T10:40:00Z');
  assert.equal(http.mock.callCount(), 0); assert.equal(report.networkRequests, 0); assert.equal(protocol.networkRequests, 0);
});

// Protocol fixtures are planning metadata, not synthetic executions or source
// receipts. Constructing the protocol performs zero network work/activation.
for (const ticker of ['SPYx', 'CRCLx']) test(`forward protocol: ${ticker} binds the existing pilot, hard bounds and missing proof`, async () => {
  const protocol = await forwardCaptureProtocol(ticker, '2026-10-27T10:39:00Z', '2026-10-27T10:40:00Z');
  const m = JSON.parse(await readFile(`${archived(ticker)}/manifest.json`, 'utf8'));
  assert.equal(protocol.scope.pool, m.pool); assert.equal(protocol.scope.mint, m.mint);
  assert.equal(protocol.status, 'PLAN_ONLY_NOT_EXECUTED'); assert.equal(protocol.acceptedIntervals, 0); assert.equal(protocol.networkRequests, 0);
  assert.equal(protocol.phases.length, 5); assert.equal(Object.keys(protocol.missingEvidence).length, 5);
  assert.deepEqual(protocol.bounds, { maxProducedBlocks: 200, maxRpcAttempts: 225, maxResponseBytes: 2500000,
    maxTotalResponseBytes: 268435456, minimumSpacingMs: 3000, automaticRetries: 0 });
  assert(protocol.stopConditions.some(s => s.includes('403') && s.includes('429')));
  assert.match(protocol.activation, /never enables capture/);
});

for (const [from, to] of [
  ['2026-10-27T10:39:01Z', '2026-10-27T10:40:01Z'],
  ['2026-10-27T10:39:00Z', '2026-10-27T10:41:00Z'],
  ['2026-10-27T10:39:00Z', '2026-10-27T10:38:00Z'],
  ['2026-10-27T10:39:00+00:00', '2026-10-27T10:40:00+00:00'],
  ['not-a-date', '2026-10-27T10:40:00Z'],
]) test(`forward protocol rejects invalid UTC minute ${from} -> ${to}`, async () => {
  await assert.rejects(forwardCaptureProtocol('SPYx', from, to), /FORWARD_WINDOW/);
});
