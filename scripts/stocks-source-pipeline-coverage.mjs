/** Offline receipt verification only. No network, market writer, or price admission. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { b58, CLMM, MAINNET_GENESIS, PILOTS, USDC, assert } from './stocks-verify-clmm-proof.mjs';
import { verifyFinalizedCoverage } from './stocks-source-pipeline.mjs';

export const LEGACY_COVERAGE_SCHEMA = 'voltex.solana-coverage-packet.v1';
export const COVERAGE_SCHEMA = 'voltex.solana-coverage-packet.v2';
export const RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
export const COVERAGE_LIMITS = Object.freeze({
  maxRpcAttempts: 225, maxProducedBlocks: 200, maxResponseBytes: 2500000,
  maxTotalResponseBytes: 268435456, minimumSpacingMs: 3000,
  maxSlotSpan: 10000, maxManifestBytes: 262144, maxSignaturePages: 3, maxCaptureMs: 900000,
  maxBoundaryProbes: 32,
});
const BLOCK_OPTIONS = Object.freeze({ commitment: 'finalized', encoding: 'json',
  transactionDetails: 'full', maxSupportedTransactionVersion: 1, rewards: false });
export const HEADER_OPTIONS = Object.freeze({ ...BLOCK_OPTIONS, transactionDetails: 'none' });
export const ALPENGLOW_GENESIS_SLOT = 459652999;
export const ALPENGLOW_GENESIS_BLOCK_ID = '4q1ScaDS6x3diDLCSTrEt6GWVyJ5oHKVCPmMb1LBH9iL';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashString = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, name) => Object.hasOwn(value, name);
const rpcError = value => value === null || typeof value === 'string' || plain(value);

// Validate decoded lengths, not just a plausible-looking base58 string.
function base58(value, size) {
  if (typeof value !== 'string' || !value.length || value.length > size * 2) return false;
  let n = 0n;
  for (const c of value) {
    const digit = ALPHABET.indexOf(c); if (digit < 0) return false;
    n = n * 58n + BigInt(digit);
  }
  const zeros = value.match(/^1*/)[0].length;
  return zeros + (n ? Math.ceil(n.toString(2).length / 8) : 0) === size;
}

function utc(value, reason) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), reason);
  const milliseconds = Date.parse(value);
  assert(integer(milliseconds) && new Date(milliseconds).toISOString().replace('.000Z', 'Z')
    === value.replace('.000Z', 'Z'), reason);
  return milliseconds;
}

async function readBounded(path, cap, reason) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= cap, reason);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await handle.stat(); assert(current.isFile() && current.size <= cap, reason);
    const chunks = []; let count = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, cap + 1 - count));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      count += bytesRead; assert(count <= cap, reason); chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

function requireParams(receipt, expected) {
  assert(isDeepStrictEqual(receipt.params, expected), 'COVERAGE_RPC_PARAMS');
}

/** Activation receipt and known mainnet identity only; no BLS/validator-set proof. */
export function validateCoverageConsensus(result) {
  const bytes = (value, size) => Array.isArray(value) && (size === undefined ? value.length > 0 : value.length === size)
    && value.every(byte => integer(byte) && byte <= 255);
  assert(plain(result) && plain(result.block) && plain(result.signature)
    && result.block.slot === ALPENGLOW_GENESIS_SLOT && bytes(result.block.blockId, 32)
    && b58(Buffer.from(result.block.blockId)) === ALPENGLOW_GENESIS_BLOCK_ID
    && bytes(result.signature.signature, 192) && bytes(result.signature.bitmap)
    && result.signature.bitmap.some(byte => byte !== 0), 'COVERAGE_CONSENSUS_RECEIPT');
  return { genesisSlot: ALPENGLOW_GENESIS_SLOT, genesisBlockId: ALPENGLOW_GENESIS_BLOCK_ID,
    cryptographicVerification: false };
}

/** Only the saved finalized block header is a boundary observation, never a time estimate. */
export function validateCoverageHeader(block, slot, { headerOnly = false } = {}) {
  assert(integer(slot) && plain(block) && integer(block.blockTime) && integer(block.parentSlot)
    && block.parentSlot < slot && base58(block.blockhash, 32) && base58(block.previousBlockhash, 32)
    && (!own(block, 'blockHeight') || block.blockHeight === null || integer(block.blockHeight)),
    'COVERAGE_BLOCK_HEADER');
  if (headerOnly) assert(!own(block, 'transactions') && !own(block, 'signatures'), 'COVERAGE_HEADER_ONLY_RESPONSE');
  return { blockTime: block.blockTime, parentSlot: block.parentSlot,
    blockhash: block.blockhash, previousBlockhash: block.previousBlockhash,
    ...(own(block, 'blockHeight') ? { blockHeight: block.blockHeight } : {}) };
}

export function assertProbeHeaderMatchesFull(probe, full, slot) {
  assert(isDeepStrictEqual(validateCoverageHeader(probe, slot), validateCoverageHeader(full, slot)),
    'COVERAGE_PROBE_FULL_MISMATCH');
}

function validateTransaction(tx, signatures) {
  const transaction = tx?.transaction, message = transaction?.message, version = tx?.version;
  assert(plain(tx) && plain(transaction) && plain(message) && ['legacy', 0, 1].includes(version),
    'COVERAGE_TRANSACTION_VERSION_OR_LAYOUT');
  assert(Array.isArray(transaction.signatures) && transaction.signatures.length > 0
    && transaction.signatures.every(s => base58(s, 64))
    && !signatures.has(transaction.signatures[0]), 'COVERAGE_TRANSACTION_SIGNATURE');
  signatures.add(transaction.signatures[0]);
  assert(Array.isArray(message.accountKeys) && message.accountKeys.length > 0
    && message.accountKeys.every(k => base58(k, 32)) && Array.isArray(message.instructions)
    && plain(tx.meta) && own(tx.meta, 'err') && rpcError(tx.meta.err), 'COVERAGE_FULL_TRANSACTION_REQUIRED');
  const lookups = message.addressTableLookups ?? [];
  assert(Array.isArray(lookups), 'COVERAGE_LOOKUP_LAYOUT');
  if (version === 1) assert(plain(message.transactionConfig) && !own(message, 'addressTableLookups'),
    'COVERAGE_V1_LAYOUT');
  if (version === 'legacy') assert(lookups.length === 0, 'COVERAGE_LEGACY_LOOKUPS');
  for (const lookup of lookups) {
    assert(plain(lookup) && base58(lookup.accountKey, 32)
      && ['writableIndexes', 'readonlyIndexes'].every(name => Array.isArray(lookup[name])
        && lookup[name].every(i => integer(i) && i <= 255)), 'COVERAGE_LOOKUP_LAYOUT');
  }
  const loaded = tx.meta.loadedAddresses;
  assert(!lookups.length || plain(loaded), 'LOADED_ADDRESSES_MISSING');
  if (loaded !== undefined) {
    assert(plain(loaded) && ['writable', 'readonly'].every(name => Array.isArray(loaded[name])
      && loaded[name].every(k => base58(k, 32))), 'COVERAGE_LOADED_ADDRESSES');
    assert(loaded.writable.length === lookups.reduce((n, x) => n + x.writableIndexes.length, 0)
      && loaded.readonly.length === lookups.reduce((n, x) => n + x.readonlyIndexes.length, 0),
      'COVERAGE_LOADED_ADDRESS_COUNT');
  }
  return [...message.accountKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
}

/**
 * expectedManifestSha256 is a separately supplied, reviewed archive pin. It is
 * never read from the packet's own claims. The pin binds bytes, not consensus,
 * program/source correspondence, execution binding, or historical account state.
 */
export async function verifyCoveragePacket(directory, { expectedManifestSha256 } = {}) {
  assert(hashString(expectedManifestSha256), 'COVERAGE_MANIFEST_PIN_REQUIRED');
  const root = resolve(directory), rawManifest = await readBounded(join(root, 'manifest.json'),
    COVERAGE_LIMITS.maxManifestBytes, 'COVERAGE_MANIFEST_BUDGET');
  assert(hash(rawManifest) === expectedManifestSha256, 'COVERAGE_MANIFEST_PIN_MISMATCH');
  const manifest = JSON.parse(rawManifest.toString('utf8'));
  assert(plain(manifest) && own(PILOTS, manifest.ticker), 'COVERAGE_SOURCE_SCOPE');
  const pilot = PILOTS[manifest.ticker];
  assert([COVERAGE_SCHEMA, LEGACY_COVERAGE_SCHEMA].includes(manifest.schema) && manifest.network === 'solana-mainnet-beta'
    && manifest.program === CLMM && manifest.quoteMint === USDC
    && manifest.pool === pilot.pool && manifest.mint === pilot.mint, 'COVERAGE_SOURCE_SCOPE');
  const narrowed = manifest.schema === COVERAGE_SCHEMA;
  assert(manifest.status === 'CAPTURED_UNVERIFIED', 'COVERAGE_CAPTURE_INCOMPLETE');
  assert(Array.isArray(manifest.windowUTC) && manifest.windowUTC.length === 2, 'COVERAGE_WINDOW');
  const from = utc(manifest.windowUTC[0], 'COVERAGE_WINDOW') / 1000;
  const to = utc(manifest.windowUTC[1], 'COVERAGE_WINDOW') / 1000;
  assert(integer(from) && from % 60 === 0 && to === from + 60, 'COVERAGE_WINDOW');
  const range = manifest.slotRange;
  assert(plain(range) && integer(range.from) && integer(range.to) && range.to > range.from
    && range.to - range.from <= COVERAGE_LIMITS.maxSlotSpan, 'COVERAGE_SLOT_RANGE');
  const discoveryRange = narrowed ? manifest.discoverySlotRange : range;
  assert(plain(discoveryRange) && integer(discoveryRange.from) && integer(discoveryRange.to)
    && discoveryRange.to > discoveryRange.from && discoveryRange.to - discoveryRange.from <= COVERAGE_LIMITS.maxSlotSpan
    && range.from >= discoveryRange.from && range.to <= discoveryRange.to, 'COVERAGE_DISCOVERY_SLOT_RANGE');
  assert(Array.isArray(manifest.receipts) && manifest.receipts.length > 0
    && manifest.receipts.length <= COVERAGE_LIMITS.maxRpcAttempts, 'COVERAGE_RPC_BUDGET');
  assert(manifest.receipts.reduce((n, row) => n + (integer(row?.bytes) ? row.bytes
    : COVERAGE_LIMITS.maxTotalResponseBytes + 1), 0) <= COVERAGE_LIMITS.maxTotalResponseBytes, 'COVERAGE_TOTAL_BUDGET');
  const records = [], files = new Set(), requestIds = new Set(); let totalBytes = 0, firstAt, previousAt;
  for (const [index, receipt] of manifest.receipts.entries()) {
    assert(plain(receipt) && /^receipt-\d{3}\.json$/.test(receipt.file) && !files.has(receipt.file), 'COVERAGE_RECEIPT_PATH');
    files.add(receipt.file);
    assert(receipt.url === RPC_ENDPOINT && receipt.httpStatus === 200 && hashString(receipt.sha256)
      && integer(receipt.bytes) && receipt.bytes <= COVERAGE_LIMITS.maxResponseBytes
      && integer(receipt.requestId) && receipt.requestId > 0 && !requestIds.has(receipt.requestId)
      && Array.isArray(receipt.params), 'COVERAGE_RECEIPT_METADATA');
    requestIds.add(receipt.requestId);
    assert(receipt.requestId === index + 1 && receipt.file === `receipt-${String(index + 1).padStart(3, '0')}.json`,
      'COVERAGE_RECEIPT_ORDER');
    const at = utc(receipt.at, 'COVERAGE_RECEIPT_TIME');
    assert(previousAt === undefined || at - previousAt >= COVERAGE_LIMITS.minimumSpacingMs, 'COVERAGE_REQUEST_SPACING');
    firstAt ??= at;
    assert(at - firstAt <= COVERAGE_LIMITS.maxCaptureMs, 'COVERAGE_CAPTURE_TIME_BUDGET');
    previousAt = at;
    const raw = await readBounded(join(root, receipt.file), COVERAGE_LIMITS.maxResponseBytes, 'COVERAGE_RESPONSE_BUDGET');
    totalBytes += raw.length;
    assert(totalBytes <= COVERAGE_LIMITS.maxTotalResponseBytes, 'COVERAGE_TOTAL_BUDGET');
    assert(raw.length === receipt.bytes && hash(raw) === receipt.sha256, 'COVERAGE_RECEIPT_HASH_OR_BYTES');
    const response = JSON.parse(raw.toString('utf8'));
    assert(plain(response) && response.jsonrpc === '2.0' && response.id === receipt.requestId
      && own(response, 'result') && !own(response, 'error'), 'COVERAGE_RPC_RESPONSE');
    records.push({ receipt, result: response.result });
  }
  // Bookkeeping never establishes coverage, but a recorded failure, extra
  // attempt or contradictory count must not disappear from this one-shot trail.
  if (own(manifest, 'metrics')) assert(plain(manifest.metrics)
    && manifest.metrics.rpcAttempts === records.length && manifest.metrics.rpcCompletions === records.length
    && manifest.metrics.automaticRetries === 0 && manifest.metrics.responseBytes === totalBytes,
    'COVERAGE_CAPTURE_METRICS');
  if (own(manifest, 'lastAttempt')) {
    const last = records.at(-1).receipt;
    assert(isDeepStrictEqual(manifest.lastAttempt,
      { method: last.method, params: last.params, requestId: last.requestId, at: last.at }), 'COVERAGE_LAST_ATTEMPT');
  }
  if (own(manifest, 'startedAt') || own(manifest, 'finishedAt')) {
    const startedAt = utc(manifest.startedAt, 'COVERAGE_CAPTURE_TIME');
    const finishedAt = utc(manifest.finishedAt, 'COVERAGE_CAPTURE_TIME');
    assert(startedAt <= firstAt && finishedAt >= previousAt && finishedAt - startedAt <= COVERAGE_LIMITS.maxCaptureMs
      && startedAt >= (to + 60) * 1000, 'COVERAGE_CAPTURE_TIME');
  }

  // The one-shot capture order is part of the protocol. Extra RPCs, probes,
  // alternate endpoints and unbound responses cannot be silently ignored.
  let next = 0;
  function take(method) {
    const row = records[next++]; assert(row?.receipt.method === method, 'COVERAGE_RPC_SEQUENCE'); return row;
  }
  const genesis = take('getGenesisHash'); requireParams(genesis.receipt, []);
  assert(genesis.result === MAINNET_GENESIS, 'COVERAGE_GENESIS');
  let consensus = null;
  if (narrowed) {
    const certificate = take('getAgGenesisCert'); requireParams(certificate.receipt, []);
    consensus = validateCoverageConsensus(certificate.result);
    assert(discoveryRange.from > ALPENGLOW_GENESIS_SLOT, 'COVERAGE_CONSENSUS_SLOT_RANGE');
  }
  const initialSlot = take('getSlot'); requireParams(initialSlot.receipt, [{ commitment: 'finalized' }]);
  assert(integer(initialSlot.result) && (!narrowed || initialSlot.result >= ALPENGLOW_GENESIS_SLOT), 'COVERAGE_FINALIZED_SLOT');
  const signatureRows = [], seenSignatures = new Set(); let previousPage, pageCount = 0;
  while (records[next]?.receipt.method === 'getSignaturesForAddress') {
    assert(++pageCount <= COVERAGE_LIMITS.maxSignaturePages, 'COVERAGE_SIGNATURE_PAGE_BUDGET');
    const page = take('getSignaturesForAddress');
    requireParams(page.receipt, [pilot.pool, { commitment: 'finalized', limit: 100,
      ...(previousPage ? { before: previousPage.at(-1).signature } : {}) }]);
    assert(Array.isArray(page.result) && page.result.length > 0 && page.result.length <= 100, 'COVERAGE_SIGNATURE_PAGE');
    if (previousPage) assert(previousPage.length === 100 && previousPage.at(-1).blockTime >= from,
      'COVERAGE_SIGNATURE_PAGINATION');
    for (const row of page.result) {
      const previous = signatureRows.at(-1);
      assert(plain(row) && base58(row.signature, 64) && !seenSignatures.has(row.signature)
        && integer(row.slot) && integer(row.blockTime) && row.confirmationStatus === 'finalized'
        && own(row, 'err') && rpcError(row.err), 'COVERAGE_SIGNATURE_ROW');
      assert(!previous || (row.slot <= previous.slot && row.blockTime <= previous.blockTime
        && (row.slot !== previous.slot || row.blockTime === previous.blockTime)), 'COVERAGE_SIGNATURE_ORDER');
      seenSignatures.add(row.signature); signatureRows.push(row);
    }
    previousPage = page.result;
  }
  assert(signatureRows.length && signatureRows[0].blockTime >= to && signatureRows.at(-1).blockTime < from,
    'COVERAGE_SIGNATURE_BOUNDARIES');
  const before = signatureRows.filter(row => row.blockTime < from);
  const after = signatureRows.filter(row => row.blockTime >= to);
  assert(discoveryRange.from === Math.max(...before.map(row => row.slot))
    && discoveryRange.to === Math.min(...after.map(row => row.slot)), 'COVERAGE_DERIVED_SLOT_RANGE');
  const produced = take('getBlocks'); requireParams(produced.receipt, [discoveryRange.from, discoveryRange.to, { commitment: 'finalized' }]);
  assert(Array.isArray(produced.result) && produced.result.length >= 2
    && produced.result.length <= (narrowed ? COVERAGE_LIMITS.maxSlotSpan + 1 : COVERAGE_LIMITS.maxProducedBlocks)
    && produced.result[0] === discoveryRange.from && produced.result.at(-1) === discoveryRange.to
    && produced.result.every((slot, i) => integer(slot) && slot >= discoveryRange.from && slot <= discoveryRange.to
      && (!i || slot > produced.result[i - 1])), 'COVERAGE_PRODUCED_SLOTS');
  let selectedSlots = produced.result, fullSlots = produced.result, boundaryProbeCount = 0;
  const slotIndices = new Map(produced.result.map((slot, i) => [slot, i]));
  const probeHeaders = new Map(), observedHeaders = new Map();
  function observeHeader(index, header) {
    if (index) assert(header.parentSlot === produced.result[index - 1], 'COVERAGE_HEADER_PARENT_SLOT');
    for (const [otherIndex, other] of observedHeaders) {
      assert(index < otherIndex ? header.blockTime <= other.blockTime : index === otherIndex || header.blockTime >= other.blockTime,
        'COVERAGE_HEADER_TIME_ORDER');
      if (otherIndex === index - 1) assert(header.previousBlockhash === other.blockhash, 'COVERAGE_HEADER_ANCESTRY');
      if (otherIndex === index + 1) assert(other.previousBlockhash === header.blockhash, 'COVERAGE_HEADER_ANCESTRY');
    }
    observedHeaders.set(index, header);
  }
  if (narrowed) {
    function probe(index) {
      if (probeHeaders.has(index)) return probeHeaders.get(index);
      assert(++boundaryProbeCount <= COVERAGE_LIMITS.maxBoundaryProbes, 'COVERAGE_BOUNDARY_PROBE_BUDGET');
      const slot = produced.result[index], record = take('getBlock');
      requireParams(record.receipt, [slot, { ...HEADER_OPTIONS }]);
      const header = validateCoverageHeader(record.result, slot, { headerOnly: true });
      observeHeader(index, header); probeHeaders.set(index, header); return header;
    }
    const first = probe(0), last = probe(produced.result.length - 1);
    assert(first.blockTime < from && last.blockTime >= to, 'COVERAGE_HEADER_BOUNDARIES');
    function lowerBound(threshold) {
      let low = 0, high = produced.result.length - 1;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (probe(middle).blockTime >= threshold) high = middle;
        else low = middle;
      }
      return high;
    }
    const firstInWindow = lowerBound(from), firstAfterWindow = lowerBound(to);
    selectedSlots = produced.result.slice(firstInWindow - 1, firstAfterWindow + 1);
    assert(range.from === selectedSlots[0] && range.to === selectedSlots.at(-1), 'COVERAGE_NARROWED_SLOT_RANGE');
    fullSlots = [...new Set([produced.result[0], ...selectedSlots, produced.result.at(-1)])].sort((a, b) => a - b);
    assert(fullSlots.length <= COVERAGE_LIMITS.maxProducedBlocks, 'COVERAGE_FULL_BLOCK_BUDGET');
    assert(next + fullSlots.length + 1 <= COVERAGE_LIMITS.maxRpcAttempts, 'COVERAGE_RPC_BUDGET');
  }
  const blocks = [], blockSignatures = new Map(), allSignatures = new Set();
  for (const slot of fullSlots) {
    const record = take('getBlock'); requireParams(record.receipt, [slot, { ...BLOCK_OPTIONS }]);
    const block = record.result;
    assert(plain(block) && integer(block.blockTime) && integer(block.parentSlot) && block.parentSlot < slot
      && base58(block.blockhash, 32) && base58(block.previousBlockhash, 32)
      && Array.isArray(block.transactions), 'COVERAGE_FULL_BLOCK_REQUIRED');
    if (narrowed) {
      const index = slotIndices.get(slot), header = validateCoverageHeader(block, slot);
      if (probeHeaders.has(index)) assertProbeHeaderMatchesFull(probeHeaders.get(index), block, slot);
      observeHeader(index, header);
    }
    for (const [transactionIndex, tx] of block.transactions.entries()) {
      const keys = validateTransaction(tx, allSignatures);
      if (keys.includes(pilot.pool)) blockSignatures.set(tx.transaction.signatures[0],
        { slot, blockTime: block.blockTime, transactionIndex, err: tx.meta.err });
    }
    if (slot >= range.from && slot <= range.to) blocks.push({ slot, block });
  }
  const finalSlot = take('getSlot'); requireParams(finalSlot.receipt, [{ commitment: 'finalized' }]);
  assert(next === records.length, 'COVERAGE_EXTRA_RECEIPTS');
  assert(integer(finalSlot.result) && finalSlot.result >= initialSlot.result && finalSlot.result >= discoveryRange.to
    && signatureRows.every(row => row.slot <= finalSlot.result), 'COVERAGE_FINALIZED_SLOT');
  // Include boundary pool transactions in the cross-check; fabricated boundary
  // rows cannot bracket a window without their full block transaction evidence.
  for (const row of signatureRows.filter(row => row.slot >= discoveryRange.from && row.slot <= discoveryRange.to)) {
    const actual = blockSignatures.get(row.signature);
    assert(actual && actual.slot === row.slot && actual.blockTime === row.blockTime
      && isDeepStrictEqual(actual.err, row.err), 'COVERAGE_BOUNDARY_SIGNATURE_MISMATCH');
    blockSignatures.delete(row.signature);
  }
  assert([...blockSignatures.values()].every(row => row.blockTime < from || row.blockTime >= to),
    'COVERAGE_SIGNATURE_ENUMERATION_INCOMPLETE');
  const coverage = verifyFinalizedCoverage({ pool: pilot.pool, from, to, genesis: genesis.result,
    finalizedSlot: finalSlot.result, producedSlots: selectedSlots, blocks, signatures: signatureRows });
  return {
    schema: 'voltex.solana-coverage-result.v1', status: 'RECEIPT_COVERAGE_VERIFIED_NOT_SOURCE_ACCEPTED',
    receiptCoverageVerified: true, acceptedIntervals: 0, acceptedMarkets: 0, candles: [], networkRequests: 0,
    source: { network: 'solana-mainnet-beta', program: CLMM, ticker: manifest.ticker,
      mint: pilot.mint, pool: pilot.pool, quoteMint: USDC },
    manifestSha256: expectedManifestSha256, receiptsHash: hash(JSON.stringify(manifest.receipts.map(r => r.sha256))),
    gates: { programIdentity: false, poolState: false, mintChronology: false, feeChronology: false,
      completeness: true, executionBinding: false },
    coverage: { ...coverage, producedBlockCount: blocks.length, signatureRows: signatureRows.length,
      ...(narrowed ? { discoveryProducedBlockCount: produced.result.length, fullBlockCount: fullSlots.length,
        boundaryProbeCount, discoverySlotRange: discoveryRange, slotRange: range, consensus } : {}),
      successfulPoolTransactions: coverage.positions.filter(p => p.err === null).length,
      failedPoolTransactions: coverage.positions.filter(p => p.err !== null).length },
    metrics: { receiptCount: records.length, retainedResponseBytes: totalBytes,
      captureRequestSpanMs: previousAt - firstAt, networkRequests: 0 },
    trustBoundary: 'The caller-supplied manifest pin binds saved RPC bytes and complete receipt coverage. Matching the pin is not independent review, consensus, deployed program/source, execution, or historical state attestation.',
  };
}
