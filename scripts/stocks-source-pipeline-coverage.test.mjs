import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { b58, CLMM, MAINNET_GENESIS, PILOTS, USDC } from './stocks-verify-clmm-proof.mjs';
import { COVERAGE_SCHEMA, COVERAGE_LIMITS, RPC_ENDPOINT, verifyCoveragePacket } from './stocks-source-pipeline-coverage.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const key = value => b58(createHash('sha256').update(value).digest());
const signature = value => b58(Buffer.concat([createHash('sha256').update(value).digest(),
  createHash('sha256').update(value + '-second').digest()]));
const START = Date.parse('2026-10-30T04:00:00Z') / 1000;
const OPTIONS = { commitment: 'finalized', encoding: 'json', transactionDetails: 'full',
  maxSupportedTransactionVersion: 1, rewards: false };
const FAILURE = { InstructionError: [0, { Custom: 6001 }] };

function transaction(name, pool = PILOTS.SPYx.pool, err = null) {
  return { version: 'legacy', transaction: { signatures: [signature(name)], message: {
    accountKeys: [pool, key('program')], header: { numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 }, instructions: [],
  } }, meta: { err } };
}

function fixture() {
  const pool = PILOTS.SPYx.pool;
  const blocks = [
    { blockTime: START - 1, transactions: [transaction('before')] },
    { blockTime: START + 1, transactions: [transaction('unrelated', key('other')),
      transaction('success'), transaction('failure', pool, FAILURE)] },
    { blockTime: START + 60, transactions: [transaction('after')] },
  ].map((block, i) => ({ ...block, blockhash: key(`block-${i}`), previousBlockhash: key(`block-${i - 1}`), parentSlot: 99 + i }));
  const rows = [
    { signature: signature('after'), slot: 102, blockTime: START + 60, err: null },
    { signature: signature('failure'), slot: 101, blockTime: START + 1, err: FAILURE },
    { signature: signature('success'), slot: 101, blockTime: START + 1, err: null },
    { signature: signature('before'), slot: 100, blockTime: START - 1, err: null },
  ].map(row => ({ ...row, confirmationStatus: 'finalized' }));
  const records = [
    { method: 'getGenesisHash', params: [], result: MAINNET_GENESIS },
    { method: 'getSlot', params: [{ commitment: 'finalized' }], result: 102 },
    { method: 'getSignaturesForAddress', params: [pool, { commitment: 'finalized', limit: 100 }], result: rows },
    { method: 'getBlocks', params: [100, 102, { commitment: 'finalized' }], result: [100, 101, 102] },
    ...blocks.map((block, i) => ({ method: 'getBlock', params: [100 + i, { ...OPTIONS }], result: block })),
    { method: 'getSlot', params: [{ commitment: 'finalized' }], result: 104 },
  ];
  return { manifest: { schema: COVERAGE_SCHEMA, network: 'solana-mainnet-beta', ticker: 'SPYx', program: CLMM,
    mint: PILOTS.SPYx.mint, pool, quoteMint: USDC, windowUTC: ['2026-10-30T04:00:00Z', '2026-10-30T04:01:00Z'],
    slotRange: { from: 100, to: 102 }, status: 'CAPTURED_UNVERIFIED' }, records };
}

async function packet(t, change = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'voltex-coverage-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = fixture(); change(data);
  data.manifest.receipts = [];
  for (const [i, record] of data.records.entries()) {
    const requestId = i + 1;
    const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, result: record.result, ...record.response }) + '\n';
    const file = `receipt-${String(requestId).padStart(3, '0')}.json`;
    await writeFile(join(directory, file), body);
    data.manifest.receipts.push({ file, url: RPC_ENDPOINT, method: record.method, params: record.params,
      requestId, httpStatus: 200, sha256: sha(body), bytes: Buffer.byteLength(body),
      at: new Date((START + 120) * 1000 + i * 3000).toISOString(), ...record.metadata });
  }
  if (data.after) data.after(data.manifest);
  const raw = JSON.stringify(data.manifest, null, 2) + '\n';
  await writeFile(join(directory, 'manifest.json'), raw);
  return { directory, expectedManifestSha256: sha(raw), manifest: data.manifest };
}
const verify = p => verifyCoveragePacket(p.directory, { expectedManifestSha256: p.expectedManifestSha256 });
const signaturePage = d => d.records.find(r => r.method === 'getSignaturesForAddress');
const middleBlock = d => d.records.find(r => r.method === 'getBlock' && r.params[0] === 101);

test('complete pinned receipt packet gives canonical positions and no source/price acceptance', async t => {
  const p = await packet(t), output = await verify(p);
  assert.equal(output.receiptCoverageVerified, true);
  assert.equal(output.coverage.producedBlockCount, 3);
  assert.deepEqual(output.coverage.positions.map(p => [p.signature, p.transactionIndex]),
    [[signature('success'), 1], [signature('failure'), 2]]);
  assert.equal(output.coverage.successfulPoolTransactions, 1);
  assert.equal(output.coverage.failedPoolTransactions, 1);
  assert.equal(output.gates.completeness, true);
  assert.deepEqual(Object.entries(output.gates).filter(([name]) => name !== 'completeness').map(([,value]) => value),
    [false, false, false, false, false]);
  assert.equal(output.acceptedIntervals, 0); assert.equal(output.acceptedMarkets, 0);
  assert.deepEqual(output.candles, []); assert.equal(output.networkRequests, 0);
  assert.equal(output.metrics.receiptCount, 8);
});

test('gate booleans and arbitrary attestation PASS claims cannot promote source admission', async t => {
  const p = await packet(t, d => Object.assign(d.manifest, { attestation: 'PASS', acceptedIntervals: 999,
    gates: { programIdentity: true, completeness: true }, candles: [{ close: 999 }], productionReady: true }));
  const output = await verify(p);
  assert.equal(output.gates.programIdentity, false); assert.equal(output.acceptedIntervals, 0);
  assert.equal(output.gates.executionBinding, false); assert.deepEqual(output.candles, []);
});

test('a separately supplied manifest hash is mandatory and is never read from the manifest', async t => {
  const p = await packet(t, d => { d.manifest.expectedManifestSha256 = '0'.repeat(64); });
  await assert.rejects(verifyCoveragePacket(p.directory), /COVERAGE_MANIFEST_PIN_REQUIRED/);
  await assert.rejects(verifyCoveragePacket(p.directory, { expectedManifestSha256: '0'.repeat(64) }), /COVERAGE_MANIFEST_PIN_MISMATCH/);
});

test('changed manifest fails the original independent pin', async t => {
  const p = await packet(t);
  await writeFile(join(p.directory, 'manifest.json'), JSON.stringify({ ...p.manifest, status: 'PASS' }));
  await assert.rejects(verify(p), /COVERAGE_MANIFEST_PIN_MISMATCH/);
});

test('changed receipt fails even if its JSON remains valid', async t => {
  const p = await packet(t), path = join(p.directory, p.manifest.receipts[0].file);
  await writeFile(path, (await readFile(path, 'utf8')).replace(MAINNET_GENESIS, key('different-genesis')));
  await assert.rejects(verify(p), /COVERAGE_RECEIPT_HASH_OR_BYTES/);
});

for (const [name, change, reason] of [
  ['unapproved pilot', d => { d.manifest.ticker = 'MSFTx'; }, 'COVERAGE_SOURCE_SCOPE'],
  ['inherited property pilot', d => { d.manifest.ticker = '__proto__'; }, 'COVERAGE_SOURCE_SCOPE'],
  ['other mint', d => { d.manifest.mint = PILOTS.CRCLx.mint; }, 'COVERAGE_SOURCE_SCOPE'],
  ['other pool', d => { d.manifest.pool = PILOTS.CRCLx.pool; }, 'COVERAGE_SOURCE_SCOPE'],
  ['blocked capture status', d => { d.manifest.status = 'BLOCKED'; }, 'COVERAGE_CAPTURE_INCOMPLETE'],
  ['self-declared PASS status', d => { d.manifest.status = 'PASS'; }, 'COVERAGE_CAPTURE_INCOMPLETE'],
  ['unaligned minute', d => { d.manifest.windowUTC = ['2026-10-30T04:00:01Z', '2026-10-30T04:01:01Z']; }, 'COVERAGE_WINDOW'],
  ['slot span', d => { d.manifest.slotRange.to = 10101; }, 'COVERAGE_SLOT_RANGE'],
  ['foreign endpoint', d => { d.records[0].metadata = { url: 'https://example.com' }; }, 'COVERAGE_RECEIPT_METADATA'],
  ['denied response', d => { d.records[0].metadata = { httpStatus: 429 }; }, 'COVERAGE_RECEIPT_METADATA'],
  ['wrong JSON-RPC id', d => { d.records[0].response = { id: 500 }; }, 'COVERAGE_RPC_RESPONSE'],
  ['JSON-RPC error', d => { d.records[0].response = { error: { code: -32015, message: 'unsupported version' } }; }, 'COVERAGE_RPC_RESPONSE'],
  ['wrong genesis', d => { d.records[0].result = key('devnet'); }, 'COVERAGE_GENESIS'],
  ['unallowlisted RPC', d => { d.records[0].method = 'sendTransaction'; }, 'COVERAGE_RPC_SEQUENCE'],
  ['too little real request spacing', d => { d.records[1].metadata = { at: new Date((START + 120) * 1000 + 2999).toISOString() }; }, 'COVERAGE_REQUEST_SPACING'],
  ['capture request span above fifteen minutes', d => { d.records.at(-1).metadata = { at: new Date((START + 120) * 1000 + 900001).toISOString() }; }, 'COVERAGE_CAPTURE_TIME_BUDGET'],
  ['path traversal', d => { d.records[0].metadata = { file: '../manifest.json' }; }, 'COVERAGE_RECEIPT_PATH'],
  ['duplicate receipt path', d => { d.records[1].metadata = { file: 'receipt-001.json' }; }, 'COVERAGE_RECEIPT_PATH'],
  ['duplicate request id', d => { d.records[1].metadata = { requestId: 1 }; }, 'COVERAGE_RECEIPT_METADATA'],
  ['hidden request id gap', d => { d.records[1].metadata = { requestId: 999 }; }, 'COVERAGE_RECEIPT_ORDER'],
  ['oversized response declaration', d => { d.records[0].metadata = { bytes: 2500001 }; }, 'COVERAGE_RECEIPT_METADATA'],
  ['signatures-only block request', d => { middleBlock(d).params[1].transactionDetails = 'signatures'; }, 'COVERAGE_RPC_PARAMS'],
  ['jsonParsed block request', d => { middleBlock(d).params[1].encoding = 'jsonParsed'; }, 'COVERAGE_RPC_PARAMS'],
  ['v0-only request', d => { middleBlock(d).params[1].maxSupportedTransactionVersion = 0; }, 'COVERAGE_RPC_PARAMS'],
  ['confirmed block request', d => { middleBlock(d).params[1].commitment = 'confirmed'; }, 'COVERAGE_RPC_PARAMS'],
  ['null block', d => { middleBlock(d).result = null; }, 'COVERAGE_FULL_BLOCK_REQUIRED'],
  ['signatures-only block response', d => { middleBlock(d).result.transactions = undefined; }, 'COVERAGE_FULL_BLOCK_REQUIRED'],
  ['broken ancestry', d => { middleBlock(d).result.previousBlockhash = key('wrong-block'); }, 'BLOCK_ANCESTRY_OR_ORDER'],
  ['duplicate produced slot', d => { d.records.find(r => r.method === 'getBlocks').result = [100, 101, 101, 102]; }, 'COVERAGE_PRODUCED_SLOTS'],
  ['missing full block', d => { d.records.splice(d.records.indexOf(middleBlock(d)), 1); }, 'COVERAGE_RPC_PARAMS'],
  ['unfinalized signature', d => { signaturePage(d).result[1].confirmationStatus = 'confirmed'; }, 'COVERAGE_SIGNATURE_ROW'],
  ['duplicate signature', d => { signaturePage(d).result.splice(2, 0, signaturePage(d).result[1]); }, 'COVERAGE_SIGNATURE_ROW'],
  ['pool signature omitted', d => { signaturePage(d).result.splice(1, 1); }, 'COVERAGE_SIGNATURE_ENUMERATION_INCOMPLETE'],
  ['failed signature rewritten as success', d => { signaturePage(d).result[1].err = null; }, 'COVERAGE_BOUNDARY_SIGNATURE_MISMATCH'],
  ['fabricated before-boundary signature', d => { signaturePage(d).result.at(-1).signature = signature('invented-before'); }, 'COVERAGE_BOUNDARY_SIGNATURE_MISMATCH'],
  ['no previous boundary', d => { signaturePage(d).result.pop(); }, 'COVERAGE_SIGNATURE_BOUNDARIES'],
  ['derived slot range changed', d => { d.manifest.slotRange.from = 99; }, 'COVERAGE_DERIVED_SLOT_RANGE'],
  ['too low final watermark', d => { d.records.at(-1).result = 101; }, 'COVERAGE_FINALIZED_SLOT'],
  ['extra successful RPC ignored', d => { d.records.push({ method: 'getSlot', params: [{ commitment: 'finalized' }], result: 105 }); }, 'COVERAGE_EXTRA_RECEIPTS'],
  ['parsed account keys', d => { middleBlock(d).result.transactions[1].transaction.message.accountKeys = [{ pubkey: PILOTS.SPYx.pool }]; }, 'COVERAGE_FULL_TRANSACTION_REQUIRED'],
  ['unsupported transaction version', d => { middleBlock(d).result.transactions[1].version = 2; }, 'COVERAGE_TRANSACTION_VERSION_OR_LAYOUT'],
  ['absent explicit transaction version', d => { delete middleBlock(d).result.transactions[1].version; }, 'COVERAGE_TRANSACTION_VERSION_OR_LAYOUT'],
  ['malformed error result', d => { middleBlock(d).result.transactions[1].meta.err = 3; }, 'COVERAGE_FULL_TRANSACTION_REQUIRED'],
  ['duplicate block transaction identity', d => { middleBlock(d).result.transactions.push(middleBlock(d).result.transactions[1]); }, 'COVERAGE_TRANSACTION_SIGNATURE'],
]) test(`receipt coverage rejects ${name}`, async t => {
  await assert.rejects(verify(await packet(t, change)), new RegExp(reason));
});

test('missing produced slot cannot hide an in-window pool transaction', async t => {
  const p = await packet(t, d => {
    d.records.find(r => r.method === 'getBlocks').result = [100, 102];
    d.records.splice(d.records.indexOf(middleBlock(d)), 1);
  });
  await assert.rejects(verify(p), /COVERAGE_BOUNDARY_SIGNATURE_MISMATCH|BLOCK_ANCESTRY_OR_ORDER/);
});

test('newer finalized signature rows need not fit the initial watermark', async t => {
  const p = await packet(t, d => { d.records[1].result = 99; });
  assert.equal((await verify(p)).receiptCoverageVerified, true);
});

test('unobserved older transactions in the boundary block do not require pagination outside the window', async t => {
  const p = await packet(t, d => { d.records.find(r => r.method === 'getBlock').result.transactions.push(transaction('older-boundary')); });
  assert.equal((await verify(p)).coverage.positions.length, 2);
});

function v0(d) {
  const tx = middleBlock(d).result.transactions[1]; tx.version = 0;
  tx.transaction.message.accountKeys = [key('lookup-user')];
  tx.transaction.message.addressTableLookups = [{ accountKey: key('table'), writableIndexes: [0], readonlyIndexes: [] }];
  tx.meta.loadedAddresses = { writable: [PILOTS.SPYx.pool], readonly: [] };
}
test('v0 lookup-table pool address participates in complete canonical coverage', async t => {
  assert.equal((await verify(await packet(t, v0))).coverage.positions.length, 2);
});
test('v0 missing loaded addresses does not hide a pool reference', async t => {
  const p = await packet(t, d => { v0(d); delete middleBlock(d).result.transactions[1].meta.loadedAddresses; });
  await assert.rejects(verify(p), /LOADED_ADDRESSES_MISSING/);
});
test('v0 truncated loaded addresses cannot satisfy the lookup counts', async t => {
  const p = await packet(t, d => { v0(d); middleBlock(d).result.transactions[1].meta.loadedAddresses.writable = []; });
  await assert.rejects(verify(p), /COVERAGE_LOADED_ADDRESS_COUNT/);
});
for (const loaded of [undefined, { writable: [], readonly: [] }]) test(`v1 inline accounts with ${loaded ? 'empty' : 'absent'} loaded addresses are supported`, async t => {
  const p = await packet(t, d => {
    const tx = middleBlock(d).result.transactions[1]; tx.version = 1;
    tx.transaction.message.transactionConfig = {}; tx.meta.loadedAddresses = loaded;
  });
  assert.equal((await verify(p)).coverage.positions.length, 2);
});
test('v1 cannot introduce a hidden lookup-table pool account', async t => {
  const p = await packet(t, d => { v0(d); const tx = middleBlock(d).result.transactions[1]; tx.version = 1; tx.transaction.message.transactionConfig = {}; });
  await assert.rejects(verify(p), /COVERAGE_V1_LAYOUT/);
});

function paginate(d, pages = 2) {
  const original = signaturePage(d), tail = original.result;
  const preceding = Array.from({ length: (pages - 1) * 100 }, (_, i) => ({
    signature: signature(`newer-${i}`), slot: 1000 - i, blockTime: START + 900 - i,
    confirmationStatus: 'finalized', err: null,
  }));
  const replacements = [];
  for (let i = 0; i < pages - 1; i++) {
    replacements.push({ method: original.method, params: [PILOTS.SPYx.pool, { commitment: 'finalized', limit: 100,
      ...(i ? { before: preceding[i * 100 - 1].signature } : {}) }], result: preceding.slice(i * 100, (i + 1) * 100) });
  }
  replacements.push({ method: original.method, params: [PILOTS.SPYx.pool, { commitment: 'finalized', limit: 100,
    before: preceding.at(-1).signature }], result: tail });
  d.records.splice(d.records.indexOf(original), 1, ...replacements);
  d.records.at(-1).result = 1001;
}
test('independent paginated signatures retain cursor continuity and permit out-of-window prefix rows', async t => {
  const p = await packet(t, d => paginate(d, 3));
  assert.equal((await verify(p)).coverage.signatureRows, 204);
});
test('wrong pagination cursor is rejected even when rows and hashes are self-consistent', async t => {
  const p = await packet(t, d => { paginate(d); d.records.filter(r => r.method === 'getSignaturesForAddress')[1].params[1].before = signature('other-cursor'); });
  await assert.rejects(verify(p), /COVERAGE_RPC_PARAMS/);
});
test('an incomplete page cannot be followed by an undisclosed history jump', async t => {
  const p = await packet(t, d => {
    paginate(d); const pages = d.records.filter(r => r.method === 'getSignaturesForAddress'); pages[0].result.shift();
  });
  await assert.rejects(verify(p), /COVERAGE_SIGNATURE_PAGINATION/);
});
test('fourth signature page exceeds the existing bounded capture policy', async t => {
  await assert.rejects(verify(await packet(t, d => paginate(d, 4))), /COVERAGE_SIGNATURE_PAGE_BUDGET/);
});

test('RPC cap is checked before reading unbounded packet entries', async t => {
  const p = await packet(t, d => { d.after = m => { m.receipts = Array.from({ length: 226 }, () => m.receipts[0]); }; });
  await assert.rejects(verify(p), /COVERAGE_RPC_BUDGET/);
});
test('total declared byte cap is checked before loading oversized receipt data', async t => {
  const p = await packet(t, d => { d.after = m => { m.receipts = Array.from({ length: 109 }, () => ({ ...m.receipts[0], bytes: COVERAGE_LIMITS.maxResponseBytes })); }; });
  await assert.rejects(verify(p), /COVERAGE_TOTAL_BUDGET/);
});

test('offline adapter never reaches fetch and does not alter the packet', async t => {
  const p = await packet(t), original = globalThis.fetch;
  const before = await readFile(join(p.directory, 'manifest.json'));
  globalThis.fetch = () => { throw Error('NO_NETWORK_ALLOWED'); };
  try { assert.equal((await verify(p)).networkRequests, 0); }
  finally { globalThis.fetch = original; }
  assert.deepEqual(await readFile(join(p.directory, 'manifest.json')), before);
});

function withBookkeeping(d) {
  d.after = m => {
    m.startedAt = m.receipts[0].at; m.finishedAt = m.receipts.at(-1).at;
    const { method, params, requestId, at } = m.receipts.at(-1);
    m.lastAttempt = { method, params, requestId, at };
    m.metrics = { rpcAttempts: m.receipts.length, rpcCompletions: m.receipts.length,
      responseBytes: m.receipts.reduce((n, row) => n + row.bytes, 0), automaticRetries: 0 };
  };
}
test('one-shot capture bookkeeping agrees with the derived receipt trail', async t => {
  assert.equal((await verify(await packet(t, withBookkeeping))).receiptCoverageVerified, true);
});
for (const [name, mutate, reason] of [
  ['recorded extra attempt', m => { m.metrics.rpcAttempts++; }, 'COVERAGE_CAPTURE_METRICS'],
  ['missing completion', m => { m.metrics.rpcCompletions--; }, 'COVERAGE_CAPTURE_METRICS'],
  ['declared retry', m => { m.metrics.automaticRetries++; }, 'COVERAGE_CAPTURE_METRICS'],
  ['contradictory byte count', m => { m.metrics.responseBytes++; }, 'COVERAGE_CAPTURE_METRICS'],
  ['failed trailing operation', m => { m.lastAttempt = { ...m.lastAttempt, method: 'getBlock', requestId: 9 }; }, 'COVERAGE_LAST_ATTEMPT'],
  ['capture finish before last response', m => { m.finishedAt = m.startedAt; }, 'COVERAGE_CAPTURE_TIME'],
  ['window not closed before capture start', m => { m.startedAt = '2026-10-30T04:00:00Z'; }, 'COVERAGE_CAPTURE_TIME'],
]) test(`capture bookkeeping rejects ${name}`, async t => {
  const p = await packet(t, d => { withBookkeeping(d); const populate = d.after; d.after = m => { populate(m); mutate(m); }; });
  await assert.rejects(verify(p), new RegExp(reason));
});
