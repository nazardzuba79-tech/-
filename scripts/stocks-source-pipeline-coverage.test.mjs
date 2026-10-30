import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { b58, CLMM, MAINNET_GENESIS, PILOTS, USDC } from './stocks-verify-clmm-proof.mjs';
import { COVERAGE_SCHEMA, LEGACY_COVERAGE_SCHEMA, COVERAGE_LIMITS, HEADER_OPTIONS,
  ALPENGLOW_GENESIS_SLOT, RPC_ENDPOINT, verifyCoveragePacket } from './stocks-source-pipeline-coverage.mjs';

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
  return { manifest: { schema: LEGACY_COVERAGE_SCHEMA, network: 'solana-mainnet-beta', ticker: 'SPYx', program: CLMM,
    mint: PILOTS.SPYx.mint, pool, quoteMint: USDC, windowUTC: ['2026-10-30T04:00:00Z', '2026-10-30T04:01:00Z'],
    slotRange: { from: 100, to: 102 }, status: 'CAPTURED_UNVERIFIED' }, records };
}

async function packet(t, change = () => {}, makeFixture = fixture) {
  const directory = await mkdtemp(join(tmpdir(), 'voltex-coverage-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = makeFixture(); change(data);
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

const V2_BASE = ALPENGLOW_GENESIS_SLOT + 101;
const v2slot = index => V2_BASE + index * 2; // The intervening slots are skipped.
const CERT_BLOCK_ID = [56, 223, 112, 94, 154, 159, 56, 136, 152, 223, 195, 91, 135, 52, 137, 63,
  40, 11, 228, 89, 180, 134, 36, 69, 106, 222, 207, 124, 111, 146, 211, 125];
function consensusCertificate() {
  return { block: { slot: ALPENGLOW_GENESIS_SLOT, blockId: [...CERT_BLOCK_ID] },
    signature: { signature: Array(192).fill(1), bitmap: [1] } };
}
function narrowedFixture({ times = [START - 20, START - 3, START - 1, START, START,
  START + 59, START + 60, START + 80, START + 100],
  probeIndices = [0, 8, 4, 2, 3, 6, 5], selected = [2, 6] } = {}) {
  const pool = PILOTS.SPYx.pool, [low, high] = selected;
  const poolTransactions = new Map([[0, [transaction('outer-before')]],
    [low + 1, [transaction('exact-start')]], [high - 1, [transaction('in-window-failure', pool, FAILURE)]],
    [times.length - 1, [transaction('outer-after')]]]);
  const blocks = times.map((blockTime, i) => ({ blockTime, blockhash: key(`narrowed-${i}`),
    previousBlockhash: key(`narrowed-${i - 1}`), parentSlot: v2slot(i - 1), blockHeight: 10000 + i,
    transactions: poolTransactions.get(i) ?? [] }));
  const rows = blocks.flatMap((block, i) => block.transactions.map(tx => ({
    signature: tx.transaction.signatures[0], slot: v2slot(i), blockTime: block.blockTime,
    err: tx.meta.err, confirmationStatus: 'finalized',
  }))).reverse();
  const header = index => {
    const { transactions: _transactions, ...value } = blocks[index]; return value;
  };
  const fullIndices = [...new Set([0, ...Array.from({ length: high - low + 1 }, (_, i) => low + i), times.length - 1])];
  const records = [
    { method: 'getGenesisHash', params: [], result: MAINNET_GENESIS },
    { method: 'getAgGenesisCert', params: [], result: consensusCertificate() },
    { method: 'getSlot', params: [{ commitment: 'finalized' }], result: v2slot(times.length + 10) },
    { method: 'getSignaturesForAddress', params: [pool, { commitment: 'finalized', limit: 100 }], result: rows },
    { method: 'getBlocks', params: [v2slot(0), v2slot(times.length - 1), { commitment: 'finalized' }],
      result: times.map((_, i) => v2slot(i)) },
    ...probeIndices.map(i => ({ method: 'getBlock', params: [v2slot(i), { ...HEADER_OPTIONS }], result: header(i) })),
    ...fullIndices.map(i => ({ method: 'getBlock', params: [v2slot(i), { ...OPTIONS }], result: blocks[i] })),
    { method: 'getSlot', params: [{ commitment: 'finalized' }], result: v2slot(times.length + 11) },
  ];
  return { manifest: { ...fixture().manifest, schema: COVERAGE_SCHEMA,
    discoverySlotRange: { from: v2slot(0), to: v2slot(times.length - 1) },
    slotRange: { from: v2slot(low), to: v2slot(high) } }, records, fixtureBlocks: blocks };
}
const v2packet = (t, change = () => {}, makeFixture = narrowedFixture) => packet(t, change, makeFixture);
const v2probe = (d, i) => d.records.find(r => r.method === 'getBlock'
  && r.params[0] === v2slot(i) && r.params[1].transactionDetails === 'none');
const v2full = (d, i) => d.records.find(r => r.method === 'getBlock'
  && r.params[0] === v2slot(i) && r.params[1].transactionDetails === 'full');

test('v2 narrows with finalized headers, skipped slots and equal timestamps, preserving full outer anchors', async t => {
  const output = await verify(await v2packet(t));
  assert.equal(output.receiptCoverageVerified, true);
  assert.equal(output.coverage.discoveryProducedBlockCount, 9);
  assert.equal(output.coverage.producedBlockCount, 5);
  assert.equal(output.coverage.fullBlockCount, 7);
  assert.equal(output.coverage.boundaryProbeCount, 7);
  assert.deepEqual(output.coverage.positions.map(p => [p.slot, p.err]), [[v2slot(3), null], [v2slot(5), FAILURE]]);
  assert.equal(output.coverage.consensus.cryptographicVerification, false);
  assert.equal(output.acceptedMarkets, 0); assert.deepEqual(output.candles, []);
});

test('436 discovery blocks can prove a smaller complete minute within unchanged caps', async t => {
  const makeFixture = () => narrowedFixture({
    times: Array.from({ length: 436 }, (_, i) => i < 160 ? START - 1 - Math.floor((159 - i) / 4)
      : i < 280 ? START + Math.floor((i - 160) / 2) : START + 60 + Math.floor((i - 280) / 4)),
    probeIndices: [0, 435, 217, 108, 162, 135, 148, 155, 158, 160, 159, 326, 271, 298, 284, 277, 280, 278, 279],
    selected: [159, 280],
  });
  const output = await verify(await v2packet(t, () => {}, makeFixture));
  assert.equal(output.coverage.discoveryProducedBlockCount, 436);
  assert.equal(output.coverage.producedBlockCount, 122);
  assert.equal(output.coverage.fullBlockCount, 124);
  assert.equal(output.metrics.receiptCount, 149);
  assert.equal(COVERAGE_LIMITS.maxProducedBlocks, 200); assert.equal(COVERAGE_LIMITS.maxRpcAttempts, 225);
});

for (const [name, mutate, reason] of [
  ['inactive consensus', d => { d.records[1].result = null; }, 'COVERAGE_CONSENSUS_RECEIPT'],
  ['unsupported consensus method', d => { d.records[1].response = { error: { code: -32601 } }; }, 'COVERAGE_RPC_RESPONSE'],
  ['wrong consensus slot', d => { d.records[1].result.block.slot--; }, 'COVERAGE_CONSENSUS_RECEIPT'],
  ['wrong consensus block identity', d => { d.records[1].result.block.blockId[0]++; }, 'COVERAGE_CONSENSUS_RECEIPT'],
  ['truncated consensus signature', d => { d.records[1].result.signature.signature.pop(); }, 'COVERAGE_CONSENSUS_RECEIPT'],
  ['nonbyte consensus signature', d => { d.records[1].result.signature.signature[0] = 256; }, 'COVERAGE_CONSENSUS_RECEIPT'],
  ['empty consensus bitmap', d => { d.records[1].result.signature.bitmap = []; }, 'COVERAGE_CONSENSUS_RECEIPT'],
  ['zero consensus bitmap', d => { d.records[1].result.signature.bitmap = [0]; }, 'COVERAGE_CONSENSUS_RECEIPT'],
  ['preactivation discovery boundary', d => { d.manifest.discoverySlotRange.from = ALPENGLOW_GENESIS_SLOT; }, 'COVERAGE_CONSENSUS_SLOT_RANGE'],
  ['preactivation initial watermark', d => { d.records[2].result = ALPENGLOW_GENESIS_SLOT - 1; }, 'COVERAGE_FINALIZED_SLOT'],
  ['missing discovery range', d => { delete d.manifest.discoverySlotRange; }, 'COVERAGE_DISCOVERY_SLOT_RANGE'],
  ['oversized discovery span', d => { d.manifest.discoverySlotRange.to = v2slot(0) + 10001; }, 'COVERAGE_DISCOVERY_SLOT_RANGE'],
  ['forged narrowed range', d => { d.manifest.slotRange.from += 2; }, 'COVERAGE_NARROWED_SLOT_RANGE'],
  ['null probe timestamp', d => { v2probe(d, 4).result.blockTime = null; }, 'COVERAGE_BLOCK_HEADER'],
  ['observed probe timestamp reversal', d => { v2probe(d, 5).result.blockTime = START - 1; }, 'COVERAGE_HEADER_TIME_ORDER'],
  ['probe parent omitted from discovery list', d => { v2probe(d, 4).result.parentSlot = v2slot(2); }, 'COVERAGE_HEADER_PARENT_SLOT'],
  ['probe hash ancestry mismatch', d => { v2probe(d, 3).result.blockhash = key('wrong-child'); }, 'COVERAGE_HEADER_ANCESTRY'],
  ['getBlockTime substituted for finalized header', d => { v2probe(d, 0).method = 'getBlockTime'; }, 'COVERAGE_RPC_SEQUENCE'],
  ['confirmed header', d => { v2probe(d, 0).params[1].commitment = 'confirmed'; }, 'COVERAGE_RPC_PARAMS'],
  ['header request without v1 support', d => { v2probe(d, 0).params[1].maxSupportedTransactionVersion = 0; }, 'COVERAGE_RPC_PARAMS'],
  ['header carrying transaction payload', d => { v2probe(d, 0).result.transactions = []; }, 'COVERAGE_HEADER_ONLY_RESPONSE'],
  ['duplicate probe instead of cache reuse', d => { d.records.splice(6, 0, structuredClone(v2probe(d, 0))); }, 'COVERAGE_RPC_PARAMS'],
  ['missing probe receipt', d => { d.records.splice(d.records.indexOf(v2probe(d, 4)), 1); }, 'COVERAGE_RPC_PARAMS'],
  ['full/probe timestamp change', d => { v2full(d, 3).result.blockTime++; }, 'COVERAGE_PROBE_FULL_MISMATCH'],
  ['full/probe hash change', d => { v2full(d, 3).result.blockhash = key('different-full'); }, 'COVERAGE_PROBE_FULL_MISMATCH'],
  ['full/probe parent change', d => { v2full(d, 3).result.parentSlot--; }, 'COVERAGE_PROBE_FULL_MISMATCH'],
  ['full/probe height omission', d => { delete v2full(d, 3).result.blockHeight; }, 'COVERAGE_PROBE_FULL_MISMATCH'],
  ['missing full outer anchor', d => { d.records.splice(d.records.indexOf(v2full(d, 0)), 1); }, 'COVERAGE_RPC_PARAMS'],
  ['fabricated outer before signature', d => { signaturePage(d).result.at(-1).signature = signature('fake-before'); }, 'COVERAGE_BOUNDARY_SIGNATURE_MISMATCH'],
  ['fabricated outer after signature', d => { signaturePage(d).result[0].signature = signature('fake-after'); }, 'COVERAGE_BOUNDARY_SIGNATURE_MISMATCH'],
  ['hidden failed in-window signature', d => { signaturePage(d).result.splice(1, 1); }, 'COVERAGE_SIGNATURE_ENUMERATION_INCOMPLETE'],
  ['final watermark covering only narrowed range', d => { d.records[2].result = v2slot(6); d.records.at(-1).result = v2slot(6); }, 'COVERAGE_FINALIZED_SLOT'],
]) test(`v2 boundary protocol rejects ${name}`, async t => {
  await assert.rejects(verify(await v2packet(t, mutate)), new RegExp(reason));
});

test('omitting a produced block and its pool signature cannot repair the saved canonical parent chain', async t => {
  const p = await v2packet(t, d => {
    const listing = d.records.find(r => r.method === 'getBlocks');
    listing.result = [0, 1, 2, 3, 5, 6, 7, 8].map(v2slot);
    // Supply exactly the new search order, so the rejection is ancestry, not a stale transcript.
    const probes = [0, 8, 3, 1, 2, 6, 5].map(i => {
      const { transactions: _transactions, ...header } = d.fixtureBlocks[i];
      return { method: 'getBlock', params: [v2slot(i), { ...HEADER_OPTIONS }], result: header };
    });
    const full = [0, 2, 3, 5, 6, 8].map(i => ({ method: 'getBlock', params: [v2slot(i), { ...OPTIONS }], result: d.fixtureBlocks[i] }));
    d.records.splice(d.records.indexOf(listing) + 1, d.records.length - d.records.indexOf(listing) - 2, ...probes, ...full);
  });
  await assert.rejects(verify(p), /COVERAGE_HEADER_PARENT_SLOT/);
});

test('a true minute over the full-block cap fails after discovery without requiring any full receipts', async t => {
  const makeFixture = () => narrowedFixture({
    times: Array.from({ length: 205 }, (_, i) => i === 0 ? START - 1
      : i < 202 ? START + Math.floor((i - 1) * 60 / 201) : START + 60 + i - 202),
    probeIndices: [0, 204, 102, 51, 25, 12, 6, 3, 1, 153, 178, 191, 197, 200, 202, 201],
    selected: [0, 202],
  });
  const p = await v2packet(t, d => {
    d.records = d.records.filter(r => r.method !== 'getBlock' || r.params[1].transactionDetails !== 'full');
  }, makeFixture);
  await assert.rejects(verify(p), /COVERAGE_FULL_BLOCK_BUDGET/);
});
