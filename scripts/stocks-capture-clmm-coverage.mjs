/** Manual, bounded public-evidence capture. No runtime feed, account writes or prices. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { assert, boundedResponseText, CLMM, MAINNET_GENESIS, PILOTS, USDC } from './stocks-verify-clmm-proof.mjs';
import { COVERAGE_SCHEMA, COVERAGE_LIMITS, HEADER_OPTIONS, RPC_ENDPOINT, verifyCoveragePacket,
  validateCoverageConsensus, validateCoverageHeader, assertProbeHeaderMatchesFull } from './stocks-source-pipeline-coverage.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const signature = value => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);
const methods = new Set(['getGenesisHash', 'getAgGenesisCert', 'getSlot', 'getSignaturesForAddress', 'getBlocks', 'getBlock']);
const proxyVariables = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy'];
const nativeProxyEnabled = () => process.allowedNodeEnvironmentFlags.has('--use-env-proxy')
  && process.execArgv.includes('--use-env-proxy')
  && !process.execArgv.some(arg => /--no[-_]use[-_]env[-_]proxy|--use[-_]env[-_]proxy=/.test(arg))
  && !/--no[-_]use[-_]env[-_]proxy/.test(process.env.NODE_OPTIONS ?? '')
  && Boolean(process.env.https_proxy || process.env.HTTPS_PROXY)
  && !process.env.ALL_PROXY && !process.env.all_proxy;
const safeReason = error => /^[A-Z][A-Z0-9_-]{0,95}$/.test(error?.message ?? '') ? error.message : 'NETWORK_OR_IO_FAILURE';

/**
 * Reuses the existing pilot identities, response limiter and coverage verifier.
 * Injected transport/clock/sleep are for trusted isolated tests or a separately
 * authorized proxy-aware transport. They are not CLI provider/endpoint options.
 */
export async function captureFinalizedCoverage({ ticker, from, to, out,
  maxRpcAttempts = COVERAGE_LIMITS.maxRpcAttempts,
  maxProducedBlocks = COVERAGE_LIMITS.maxProducedBlocks,
  minimumSpacingMs = COVERAGE_LIMITS.minimumSpacingMs,
  maxSignaturePages = 3,
}, { fetchImpl, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onProgress } = {}) {
  assert(Object.hasOwn(PILOTS, ticker), 'UNAPPROVED_PILOT');
  const start = Date.parse(from) / 1000, end = Date.parse(to) / 1000;
  const canonicalUtc = value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
  assert(canonicalUtc(from) && canonicalUtc(to)
    && integer(start) && start % 60 === 0 && end === start + 60 && end <= now() / 1000 - 60, 'CLOSED_MINUTE_REQUIRED');
  assert(typeof out === 'string' && out.length > 0, 'OUTPUT_DIRECTORY_REQUIRED');
  assert(integer(maxRpcAttempts) && maxRpcAttempts > 0 && maxRpcAttempts <= COVERAGE_LIMITS.maxRpcAttempts
    && integer(maxProducedBlocks) && maxProducedBlocks >= 2 && maxProducedBlocks <= COVERAGE_LIMITS.maxProducedBlocks
    && integer(minimumSpacingMs) && minimumSpacingMs >= COVERAGE_LIMITS.minimumSpacingMs && minimumSpacingMs <= 60000
    && integer(maxSignaturePages) && maxSignaturePages > 0 && maxSignaturePages <= 3, 'CAPTURE_LIMITS');
  // Existing directories are refused, including symlinks and old partial packets.
  await mkdir(out);
  const pilot = PILOTS[ticker], cpu = process.cpuUsage(), started = performance.now(), startedAt = now();
  const manifest = {
    schema: COVERAGE_SCHEMA, network: 'solana-mainnet-beta', ticker, program: CLMM,
    mint: pilot.mint, pool: pilot.pool, quoteMint: USDC, windowUTC: [from, to], discoverySlotRange: null, slotRange: null,
    status: 'CAPTURING', startedAt: new Date(now()).toISOString(), receipts: [], blockers: [],
    acceptedIntervals: 0, acceptedMarkets: 0, productionReady: false, ohlcv: null,
    limits: { ...COVERAGE_LIMITS, maxRpcAttempts, maxProducedBlocks, minimumSpacingMs, maxSignaturePages },
    metrics: { rpcAttempts: 0, rpcCompletions: 0, responseBytes: 0, automaticRetries: 0, paidResources: false, monetarySpend: 0 },
  };
  let lastRequestAt = null;
  const persist = () => writeFile(out + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  await persist();
  async function rpc(method, params) {
    assert(methods.has(method), 'UNSAFE_RPC_METHOD');
    assert(manifest.metrics.rpcAttempts < maxRpcAttempts, 'RPC_BUDGET_EXHAUSTED');
    const remaining = COVERAGE_LIMITS.maxTotalResponseBytes - manifest.metrics.responseBytes;
    assert(remaining > 0, 'CAPTURE_BYTE_BUDGET');
    assert(now() - startedAt < COVERAGE_LIMITS.maxCaptureMs, 'CAPTURE_TIME_BUDGET');
    if (lastRequestAt !== null) {
      const waitMs = Math.max(0, lastRequestAt + minimumSpacingMs - now());
      if (waitMs) await sleep(waitMs);
      assert(now() >= lastRequestAt + minimumSpacingMs, 'CAPTURE_CLOCK_DID_NOT_ADVANCE');
    }
    const requestAt = now(); lastRequestAt = requestAt;
    assert(requestAt - startedAt < COVERAGE_LIMITS.maxCaptureMs, 'CAPTURE_TIME_BUDGET');
    const requestId = ++manifest.metrics.rpcAttempts, at = new Date(requestAt).toISOString();
    // Preserve the attempted operation even if transport fails before a response.
    manifest.lastAttempt = { method, params, requestId, at };
    await persist();
    const response = await (fetchImpl ?? fetch)(RPC_ENDPOINT, {
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      signal: AbortSignal.timeout(Math.min(15000, Math.max(1, COVERAGE_LIMITS.maxCaptureMs - (requestAt - startedAt)))),
    });
    const read = await boundedResponseText(response, Math.min(COVERAGE_LIMITS.maxResponseBytes, remaining));
    manifest.metrics.responseBytes += read.bytes;
    const file = 'receipt-' + String(requestId).padStart(3, '0') + '.json';
    await writeFile(out + '/' + file, read.text, { flag: 'wx' });
    manifest.receipts.push({ file, url: RPC_ENDPOINT, method, params, requestId, at,
      httpStatus: response.status, bytes: read.bytes, sha256: sha256(read.text) });
    await persist();
    assert(response.ok, 'HTTP_' + response.status);
    let json;
    try { json = JSON.parse(read.text); } catch { throw Error('RPC_INVALID_JSON'); }
    assert(json?.jsonrpc === '2.0' && json.id === requestId, 'RPC_RESPONSE_IDENTITY');
    assert(!Object.hasOwn(json, 'error'), 'RPC_' + (Number.isSafeInteger(json.error?.code) ? json.error.code : 'ERROR'));
    assert(Object.hasOwn(json, 'result'), 'RPC_RESULT_MISSING');
    manifest.metrics.rpcCompletions++;
    if (onProgress) onProgress({ method, rpcAttempts: requestId, responseBytes: manifest.metrics.responseBytes });
    return json.result;
  }
  try {
    // Never silently ignore a configured proxy. Node releases with explicit
    // native environment-proxy support can use it; older releases fail closed.
    assert(fetchImpl || !proxyVariables.some(name => process.env[name]) || nativeProxyEnabled(), 'CONFIGURED_PROXY_TRANSPORT_REQUIRED');
    assert(await rpc('getGenesisHash', []) === MAINNET_GENESIS, 'WRONG_NETWORK');
    const consensus = validateCoverageConsensus(await rpc('getAgGenesisCert', []));
    const firstFinalized = await rpc('getSlot', [{ commitment: 'finalized' }]);
    assert(integer(firstFinalized) && firstFinalized > consensus.genesisSlot, 'FINALIZED_SLOT_INVALID');
    const rows = [], seen = new Set(); let before;
    for (let page = 0; page < maxSignaturePages; page++) {
      const batch = await rpc('getSignaturesForAddress', [pilot.pool, { commitment: 'finalized', limit: 100, ...(before ? { before } : {}) }]);
      assert(Array.isArray(batch) && batch.length > 0 && batch.length <= 100, 'SIGNATURE_PAGE_INCOMPLETE');
      for (const row of batch) {
        assert(signature(row.signature) && integer(row.slot) && integer(row.blockTime)
          && row.confirmationStatus === 'finalized' && Object.hasOwn(row, 'err'), 'SIGNATURE_ROW_INVALID');
        assert(!seen.has(row.signature), 'DUPLICATE_SIGNATURE');
        const previous = rows.at(-1);
        assert(!previous || (row.slot <= previous.slot && row.blockTime <= previous.blockTime
          && (row.slot !== previous.slot || row.blockTime === previous.blockTime)), 'SIGNATURE_ORDER');
        seen.add(row.signature); rows.push(row);
      }
      if (rows.at(-1).blockTime < start) break;
      assert(batch.length === 100, 'SIGNATURE_HISTORY_INCOMPLETE');
      before = rows.at(-1).signature;
    }
    const earlier = rows.filter(row => row.blockTime < start), later = rows.filter(row => row.blockTime >= end);
    assert(earlier.length && later.length, 'SIGNATURE_WINDOW_NOT_BRACKETED');
    const low = Math.max(...earlier.map(row => row.slot)), high = Math.min(...later.map(row => row.slot));
    assert(low > consensus.genesisSlot && high > low
      && high - low <= COVERAGE_LIMITS.maxSlotSpan, 'SLOT_RANGE_BUDGET');
    manifest.discoverySlotRange = { from: low, to: high };
    const produced = await rpc('getBlocks', [low, high, { commitment: 'finalized' }]);
    assert(Array.isArray(produced) && produced.length >= 2 && produced.length <= COVERAGE_LIMITS.maxSlotSpan + 1
      && produced[0] === low && produced.at(-1) === high
      && produced.every((slot, index) => integer(slot) && slot >= low && slot <= high && (!index || slot > produced[index - 1])), 'PRODUCED_SLOTS_INCOMPLETE');
    manifest.metrics.producedBlocksDiscovered = produced.length;
    // Pool transactions may be sparse. Locate the minute by finalized block
    // metadata before spending the full-block budget on its wider signature bracket.
    const probes = new Map();
    async function probe(index) {
      if (probes.has(index)) return probes.get(index);
      assert(probes.size < COVERAGE_LIMITS.maxBoundaryProbes, 'BOUNDARY_PROBE_BUDGET');
      const slot = produced[index];
      const header = await rpc('getBlock', [slot, { ...HEADER_OPTIONS }]);
      validateCoverageHeader(header, slot, { headerOnly: true });
      assert(index === 0 || header.parentSlot === produced[index - 1], 'HEADER_PARENT_SLOT');
      for (const [previousIndex, previous] of probes) {
        assert(index < previousIndex ? header.blockTime <= previous.blockTime
          : header.blockTime >= previous.blockTime, 'HEADER_TIME_ORDER');
        if (index === previousIndex + 1) assert(header.previousBlockhash === previous.blockhash, 'HEADER_PARENT_HASH');
        if (previousIndex === index + 1) assert(previous.previousBlockhash === header.blockhash, 'HEADER_PARENT_HASH');
      }
      const signatureRows = rows.filter(row => row.slot === slot);
      assert(signatureRows.every(row => row.blockTime === header.blockTime), 'HEADER_SIGNATURE_TIME_MISMATCH');
      probes.set(index, header); manifest.metrics.boundaryProbeCount = probes.size;
      return header;
    }
    assert((await probe(0)).blockTime < start && (await probe(produced.length - 1)).blockTime >= end,
      'HEADER_WINDOW_NOT_BRACKETED');
    async function lowerBound(target) {
      let left = 0, right = produced.length - 1;
      while (right - left > 1) {
        const middle = Math.floor((left + right) / 2);
        if ((await probe(middle)).blockTime < target) left = middle;
        else right = middle;
      }
      return right;
    }
    const first = await lowerBound(start), after = await lowerBound(end);
    manifest.slotRange = { from: produced[first - 1], to: produced[after] };
    const selected = produced.slice(first - 1, after + 1);
    // Retain the original signature-boundary transactions as separate anchors.
    // Every full response, including either extra anchor, counts toward the cap.
    const fullSlots = [...new Set([low, ...selected, high])].sort((a, b) => a - b);
    manifest.metrics.selectedProducedBlocks = selected.length;
    manifest.metrics.requiredFullBlocks = fullSlots.length;
    assert(fullSlots.length <= maxProducedBlocks, 'EXACT_MINUTE_FULL_BLOCK_BUDGET');
    assert(manifest.metrics.rpcAttempts + fullSlots.length + 1 <= maxRpcAttempts, 'RPC_BUDGET_EXHAUSTED');
    for (const slot of fullSlots) {
      const block = await rpc('getBlock', [slot, { commitment: 'finalized', encoding: 'json',
        transactionDetails: 'full', maxSupportedTransactionVersion: 1, rewards: false }]);
      assert(block && integer(block.blockTime) && Array.isArray(block.transactions), 'FULL_BLOCK_UNAVAILABLE');
      const header = probes.get(produced.indexOf(slot));
      if (header) assertProbeHeaderMatchesFull(header, block, slot);
    }
    const finalSlot = await rpc('getSlot', [{ commitment: 'finalized' }]);
    assert(integer(finalSlot) && finalSlot >= firstFinalized && finalSlot >= high
      && rows.every(row => row.slot <= finalSlot), 'FINALIZED_WATERMARK_INCOMPLETE');
    manifest.status = 'CAPTURED_UNVERIFIED';
  } catch (error) {
    manifest.status = 'BLOCKED'; manifest.blockers = [safeReason(error)];
  }
  const spent = process.cpuUsage(cpu);
  Object.assign(manifest.metrics, { cpuUserMicros: spent.user, cpuSystemMicros: spent.system,
    elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss });
  manifest.finishedAt = new Date(now()).toISOString();
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(out + '/manifest.json', manifestText);
  const manifestSha256 = sha256(manifestText);
  let verification = null;
  if (manifest.status === 'CAPTURED_UNVERIFIED') {
    try { verification = await verifyCoveragePacket(out, { expectedManifestSha256: manifestSha256 }); }
    catch (error) { verification = { receiptCoverageVerified: false, acceptedIntervals: 0, acceptedMarkets: 0,
      candles: [], blockers: [safeReason(error)] }; }
    await writeFile(out + '/coverage-report.json', JSON.stringify({ manifestSha256, ...verification }, null, 2) + '\n', { flag: 'wx' });
  }
  return { manifest, manifestSha256, verification };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [confirmation, ticker, from, to, out] = process.argv.slice(2);
  assert(confirmation === '--capture-read-only' && ticker && from && to && out,
    'Usage: node scripts/stocks-capture-clmm-coverage.mjs --capture-read-only SPYx ISO_FROM ISO_TO NEW_OUTPUT_DIRECTORY');
  const result = await captureFinalizedCoverage({ ticker, from, to, out }, { onProgress: value => {
    if (value.method !== 'getBlock' || value.rpcAttempts % 20 === 0) console.log(JSON.stringify(value));
  } });
  console.log(JSON.stringify({ status: result.manifest.status, manifestSha256: result.manifestSha256,
    rpcAttempts: result.manifest.metrics.rpcAttempts, responseBytes: result.manifest.metrics.responseBytes,
    blockers: result.manifest.blockers, receiptCoverageVerified: result.verification?.receiptCoverageVerified ?? false,
    verificationBlockers: result.verification?.blockers ?? [], acceptedIntervals: 0, acceptedMarkets: 0 }));
  process.exitCode = result.verification?.receiptCoverageVerified ? 0 : 2;
}
