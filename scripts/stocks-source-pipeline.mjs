/** Offline-only source pipeline. No server, order, DB, or network side effects. */
import { createHash } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assert, CLMM, USDC, MAINNET_GENESIS, poolIdentity, extractSwapCandidates } from './stocks-verify-clmm-proof.mjs';
import { reconcile } from './stocks-reconcile-clmm-receipts.mjs';

export const SCHEMA = 'voltex.solana-ohlcv.v1';
export const GATES = ['programIdentity', 'poolState', 'mintChronology', 'feeChronology', 'completeness', 'executionBinding'];
export const STEPS = { '1m': 60, '5m': 300, '1h': 3600 };
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const key = value => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const rawAmount = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
const order = (a, b) => a.slot - b.slot || a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex;
const tradeKey = t => `${t.signature}:${t.logIndex}`;
const eligible = proof => GATES.every(g => proof.gates[g] === true);
const plain = value => JSON.parse(JSON.stringify(value));

function validateSource(source) {
  assert(source?.network === 'solana-mainnet-beta' && source.program === CLMM && source.quoteMint === USDC
    && key(source.mint) && key(source.pool) && source.mint !== USDC, 'SOURCE_IDENTITY');
  assert(Array.isArray(source.decimals) && source.decimals.length === 2
    && source.decimals.every(d => integer(d) && d <= 18), 'SOURCE_DECIMALS');
}

function validateTrade(t, from, to, accepted) {
  assert(typeof t.signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(t.signature)
    && integer(t.logIndex) && integer(t.slot) && integer(t.blockTime)
    && t.blockTime >= from && t.blockTime < to, 'TRADE_IDENTITY');
  assert(rawAmount(t.baseRaw) && rawAmount(t.quoteRaw) && ['buy', 'sell'].includes(t.side), 'TRADE_AMOUNTS');
  assert(t.finality === 'finalized' && t.executionBound === true && hash(t.receiptHash), 'TRADE_NOT_FINALIZED_OR_BOUND');
  assert(Array.isArray(t.ammFeeRaw) && t.ammFeeRaw.length === 2 && t.ammFeeRaw.every(v => v === '0' || rawAmount(v)), 'AMM_FEE_AMOUNTS');
  assert(Array.isArray(t.transferFeeRaw) && t.transferFeeRaw.length === 2 && t.transferFeeRaw.every(v => v === '0'), 'TRANSFER_FEE_UNSUPPORTED');
  assert(t.transactionIndex === null || integer(t.transactionIndex), 'TRADE_ORDER');
  if (accepted) assert(integer(t.transactionIndex), 'TRADE_ORDER_UNPROVEN');
}

// Price convention: executed vault transfer quote/base, including AMM fee,
// excluding transfer fees (currently unsupported). Raw token units, not scaled
// UI units or an equity quote. Compare exact rationals before chart conversion.
function price(t, decimals) {
  return { numerator: BigInt(t.quoteRaw) * 10n ** BigInt(decimals[0]), denominator: BigInt(t.baseRaw) * 10n ** BigInt(decimals[1]) };
}
const compare = (a, b) => a.numerator * b.denominator < b.numerator * a.denominator ? -1
  : a.numerator * b.denominator > b.numerator * a.denominator ? 1 : 0;
function decimal(n, d) {
  const scaled = n * 10n ** 18n / d;
  return `${scaled / 10n ** 18n}.${String(scaled % 10n ** 18n).padStart(18, '0')}`;
}
function candle(trades, time, decimals, proofs) {
  const sorted = [...trades].sort(order), prices = sorted.map(t => price(t, decimals));
  const low = prices.reduce((a, b) => compare(a, b) <= 0 ? a : b), high = prices.reduce((a, b) => compare(a, b) >= 0 ? a : b);
  const exact = {
    open: decimal(prices[0].numerator, prices[0].denominator), high: decimal(high.numerator, high.denominator),
    low: decimal(low.numerator, low.denominator), close: decimal(prices.at(-1).numerator, prices.at(-1).denominator),
    volume: decimal(sorted.reduce((n, t) => n + BigInt(t.baseRaw), 0n), 10n ** BigInt(decimals[0])),
    quoteVolume: decimal(sorted.reduce((n, t) => n + BigInt(t.quoteRaw), 0n), 10n ** BigInt(decimals[1])),
  };
  const values = Object.fromEntries(['open', 'high', 'low', 'close', 'volume'].map(k => [k, Number(exact[k])]));
  assert(Object.values(values).every(v => Number.isFinite(v) && v > 0), 'CHART_NUMERIC_RANGE');
  return { time, ...values, tradeCount: sorted.length, proofDigest: digest(proofs), exact,
    firstExecution: tradeKey(sorted[0]), lastExecution: tradeKey(sorted.at(-1)) };
}

/** One writer per disposable local store; source evidence is immutable once ingested. */
export class SourcePipeline {
  constructor(source, { maxMinutes = 180, maxTrades = 10000, maxBytes = 8 * 1024 * 1024 } = {}) {
    validateSource(source);
    assert(integer(maxMinutes) && maxMinutes >= 60 && maxMinutes <= 1440
      && integer(maxTrades) && maxTrades > 0 && maxTrades <= 100000
      && integer(maxBytes) && maxBytes >= 4096 && maxBytes <= 32 * 1024 * 1024, 'STORAGE_BUDGET');
    this.source = plain(source); this.limits = { maxMinutes, maxTrades, maxBytes };
    this.minutes = new Map(); this.watermark = 0;
    this.metrics = { ingestedTrades: 0, duplicateTrades: 0, duplicateIntervals: 0, evictedMinutes: 0, rpcRequests: 0, cpuUserMicros: 0, cpuSystemMicros: 0 };
  }

  ingest({ from, to, proof, trades, rpcRequests = 0 }) {
    const cpu = process.cpuUsage();
    assert(integer(from) && integer(to) && from % 60 === 0 && to === from + 60, 'MINUTE_BOUNDS');
    assert(hash(proof?.receiptsHash) && proof?.gates && GATES.every(g => typeof proof.gates[g] === 'boolean')
      && typeof proof.synthetic === 'boolean', 'PROOF_CONTRACT');
    assert(Array.isArray(trades) && trades.length <= this.limits.maxTrades && integer(rpcRequests), 'INGEST_BUDGET');
    const accepted = eligible(proof), dedup = new Map(); let duplicates = 0;
    for (const trade of trades) {
      validateTrade(trade, from, to, accepted);
      const id = tradeKey(trade), previous = dedup.get(id);
      assert(!previous || digest(previous) === digest(trade), 'CONFLICTING_DUPLICATE');
      if (previous) duplicates++; else dedup.set(id, plain(trade));
    }
    const sorted = [...dedup.values()].sort(order);
    if (accepted) {
      const positions = new Map(), signatures = new Map(); let previous;
      for (const t of sorted) {
        const position = `${t.slot}:${t.transactionIndex}`;
        assert(!positions.has(position) || positions.get(position) === t.signature, 'EXECUTION_POSITION_COLLISION');
        positions.set(position, t.signature);
        const identity = `${t.slot}:${t.transactionIndex}:${t.blockTime}`;
        assert(!signatures.has(t.signature) || signatures.get(t.signature) === identity, 'SIGNATURE_ORDER_COLLISION');
        signatures.set(t.signature, identity);
        assert(!previous || (previous.slot === t.slot ? previous.blockTime === t.blockTime : previous.blockTime <= t.blockTime), 'BLOCK_TIME_ORDER');
        previous = t;
      }
    }
    const value = { from, to, proof: plain(proof), trades: sorted }, existing = this.minutes.get(from);
    if (existing) {
      assert(digest(existing) === digest(value), 'IMMUTABLE_INTERVAL_CONFLICT');
      this.metrics.duplicateIntervals++; return;
    }
    const watermark = Math.max(this.watermark, to), floor = watermark - this.limits.maxMinutes * 60;
    assert(from >= floor, 'OUTSIDE_RETENTION');
    const next = new Map([...this.minutes].filter(([minute]) => minute >= floor));
    // Cross-minute duplicates cannot count the same execution twice.
    const seen = new Set([...next.values()].flatMap(m => m.trades.map(tradeKey)));
    assert(sorted.every(t => !seen.has(tradeKey(t))), 'CROSS_INTERVAL_DUPLICATE');
    next.set(from, value);
    const canonical = [...next.values()].filter(m => eligible(m.proof)).flatMap(m => m.trades).sort(order);
    for (let i = 1; i < canonical.length; i++) {
      const a = canonical[i - 1], b = canonical[i];
      assert(a.slot === b.slot ? a.blockTime === b.blockTime : a.blockTime <= b.blockTime, 'CROSS_INTERVAL_BLOCK_ORDER');
      assert(a.slot !== b.slot || a.transactionIndex !== b.transactionIndex || a.signature === b.signature, 'CROSS_INTERVAL_POSITION_COLLISION');
    }
    assert([...next.values()].reduce((n, m) => n + m.trades.length, 0) <= this.limits.maxTrades, 'TRADE_STORAGE_BUDGET');
    const old = this.minutes, oldWatermark = this.watermark;
    this.minutes = next; this.watermark = watermark;
    try { assert(Buffer.byteLength(JSON.stringify(this.snapshot())) <= this.limits.maxBytes, 'BYTE_STORAGE_BUDGET'); }
    catch (error) { this.minutes = old; this.watermark = oldWatermark; throw error; }
    const spent = process.cpuUsage(cpu);
    this.metrics.evictedMinutes += old.size + 1 - next.size;
    this.metrics.ingestedTrades += sorted.length; this.metrics.duplicateTrades += duplicates;
    this.metrics.rpcRequests += rpcRequests; this.metrics.cpuUserMicros += spent.user; this.metrics.cpuSystemMicros += spent.system;
  }

  history(interval, from, to) {
    const step = STEPS[interval];
    assert(step && integer(from) && integer(to) && from % step === 0 && to % step === 0
      && to > from && (to - from) / step <= 1500, 'HISTORY_BOUNDS');
    const candles = [], gaps = [], proofs = [], gateValues = Object.fromEntries(GATES.map(g => [g, true]));
    let acceptedTradeCount = 0, synthetic = false;
    for (let time = from; time < to; time += step) {
      const minutes = Array.from({ length: step / 60 }, (_, i) => this.minutes.get(time + i * 60));
      if (time < this.watermark - this.limits.maxMinutes * 60) { gaps.push({ time, reason: 'OUTSIDE_RETENTION' }); continue; }
      if (minutes.some(m => !m || !eligible(m.proof))) { gaps.push({ time, reason: 'UNKNOWN' }); continue; }
      const trades = minutes.flatMap(m => m.trades), hashes = minutes.map(m => m.proof.receiptsHash);
      synthetic ||= minutes.some(m => m.proof.synthetic);
      proofs.push(...hashes);
      if (!trades.length) { gaps.push({ time, reason: 'NO_TRADES' }); continue; }
      candles.push(candle(trades, time, this.source.decimals, hashes)); acceptedTradeCount += trades.length;
    }
    const anyAccepted = proofs.length > 0;
    return {
      schema: SCHEMA, instrumentId: `SOLANA:${this.source.mint}:${this.source.pool}`, interval,
      priceKind: 'raw-token', quoteCurrency: 'USDC', equityEquivalent: null, range: { from, to }, candles, gaps,
      provenance: { status: anyAccepted ? 'ACCEPTED' : 'UNKNOWN', intervalComplete: anyAccepted,
        finality: 'finalized', source: plain(this.source), acceptedTradeCount, receiptsHash: digest(proofs),
        gates: anyAccepted ? gateValues : Object.fromEntries(GATES.map(g => [g, false])), synthetic,
        priceConvention: 'gross-vault-transfers-zero-transfer-fee', volumeUnit: 'raw-base-token' },
    };
  }

  snapshot() {
    return plain({ version: 1, source: this.source, limits: this.limits, watermark: this.watermark,
      minutes: [...this.minutes.values()].sort((a, b) => a.from - b.from), metrics: this.metrics });
  }

  async checkpoint(file) {
    const payload = this.snapshot(), encoded = JSON.stringify({ payload, sha256: digest(payload) }) + '\n';
    assert(Buffer.byteLength(encoded) <= this.limits.maxBytes, 'CHECKPOINT_BUDGET');
    // Exclusive temp file catches concurrent writers and leaves a failed save
    // visible; an interrupted save never replaces the last valid checkpoint.
    const temp = file + '.pending', handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(encoded); await handle.sync(); }
    catch (error) { await handle.close(); await unlink(temp).catch(() => {}); throw error; }
    await handle.close(); await rename(temp, file);
  }

  static async recover(file, expectedSource) {
    assert((await stat(file)).size <= 32 * 1024 * 1024, 'RECOVERY_BUDGET');
    const { payload, sha256 } = JSON.parse(await readFile(file, 'utf8'));
    assert(payload?.version === 1 && digest(payload) === sha256, 'CHECKPOINT_CORRUPT');
    assert(digest(payload.source) === digest(expectedSource), 'CHECKPOINT_SOURCE_MISMATCH');
    const pipeline = new SourcePipeline(payload.source, payload.limits);
    assert(Array.isArray(payload.minutes) && payload.minutes.length <= payload.limits.maxMinutes, 'RECOVERY_MINUTES');
    for (const minute of payload.minutes) pipeline.ingest(minute);
    assert(pipeline.watermark === payload.watermark, 'RECOVERY_WATERMARK');
    assert(Object.keys(pipeline.metrics).every(k => integer(payload.metrics?.[k])), 'RECOVERY_METRICS');
    pipeline.metrics = payload.metrics;
    return pipeline;
  }
}

/** Compare independent signature enumeration with the COMPLETE produced-block stream.
 * The caller must retain actual finalized RPC receipts, including getBlocks and
 * boundary blocks. Observed-signature-only getBlock samples cannot satisfy this.
 */
export function verifyFinalizedCoverage({ pool, from, to, genesis, finalizedSlot, producedSlots, blocks, signatures }) {
  assert(genesis === MAINNET_GENESIS && key(pool) && integer(finalizedSlot), 'COVERAGE_NETWORK');
  assert(integer(from) && integer(to) && to > from && to - from <= 60, 'COVERAGE_WINDOW');
  assert(Array.isArray(producedSlots) && producedSlots.length >= 2 && producedSlots.length <= 200
    && producedSlots.every((slot, i) => integer(slot) && slot <= finalizedSlot && (!i || slot > producedSlots[i - 1])), 'PRODUCED_SLOTS');
  assert(Array.isArray(blocks) && blocks.length === producedSlots.length, 'BLOCK_STREAM_INCOMPLETE');
  const bySignature = new Map(), positions = [];
  for (let i = 0; i < blocks.length; i++) {
    const { slot, block } = blocks[i];
    assert(slot === producedSlots[i] && integer(block?.blockTime) && typeof block.blockhash === 'string'
      && Array.isArray(block.transactions), 'BLOCK_STREAM_LAYOUT');
    if (i) assert(block.parentSlot === blocks[i - 1].slot && block.previousBlockhash === blocks[i - 1].block.blockhash
      && block.blockTime >= blocks[i - 1].block.blockTime, 'BLOCK_ANCESTRY_OR_ORDER');
    if (block.blockTime < from || block.blockTime >= to) continue;
    for (const [transactionIndex, tx] of block.transactions.entries()) {
      const message = tx.transaction?.message, signature = tx.transaction?.signatures?.[0];
      assert(typeof signature === 'string' && Array.isArray(message?.accountKeys)
        && tx.meta && 'err' in tx.meta, 'BLOCK_TRANSACTION_INCOMPLETE');
      assert(message.accountKeys.every(k => typeof k === 'string'), 'BLOCK_KEYS_ENCODING');
      assert(!message.addressTableLookups?.length || (Array.isArray(tx.meta.loadedAddresses?.writable)
        && Array.isArray(tx.meta.loadedAddresses?.readonly)), 'LOADED_ADDRESSES_MISSING');
      const keys = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
      if (!keys.includes(pool)) continue;
      assert(!bySignature.has(signature), 'DUPLICATE_BLOCK_SIGNATURE');
      const value = { signature, slot, blockTime: block.blockTime, transactionIndex, err: tx.meta.err };
      bySignature.set(signature, value); positions.push(value);
    }
  }
  assert(blocks[0].block.blockTime < from && blocks.at(-1).block.blockTime >= to, 'BLOCK_WINDOW_NOT_BRACKETED');
  assert(Array.isArray(signatures), 'SIGNATURE_STREAM_MISSING');
  const seen = new Set();
  for (const row of signatures) {
    assert(row.confirmationStatus === 'finalized' && integer(row.blockTime) && integer(row.slot), 'SIGNATURE_NOT_FINALIZED');
    assert(!seen.has(row.signature), 'DUPLICATE_SIGNATURE'); seen.add(row.signature);
    if (row.blockTime < from || row.blockTime >= to) continue;
    const actual = bySignature.get(row.signature);
    assert(actual && actual.slot === row.slot && actual.blockTime === row.blockTime && digest(actual.err) === digest(row.err), 'SIGNATURE_BLOCK_MISMATCH');
    bySignature.delete(row.signature);
  }
  assert(signatures.some(s => s.blockTime < from) && signatures.some(s => s.blockTime >= to), 'SIGNATURE_WINDOW_NOT_BRACKETED');
  assert(bySignature.size === 0, 'SIGNATURE_ENUMERATION_INCOMPLETE');
  return { complete: true, positions: positions.sort(order), from, to, finalizedSlot };
}

/** Replay the fixed public packet. Never accepts caller-provided PASS flags. */
export async function replayPacket(directory) {
  const cpu = process.cpuUsage(), started = performance.now();
  const manifestText = await readFile(`${directory}/manifest.json`, 'utf8'), manifest = JSON.parse(manifestText);
  const source = { network: manifest.network, program: CLMM, mint: manifest.mint,
    pool: manifest.pool, quoteMint: USDC, decimals: manifest.identity.decimals };
  validateSource(source);
  assert(manifest.identity.mints[0] === source.mint && manifest.identity.mints[1] === USDC, 'QUOTE_ORDER');
  const from = Date.parse(manifest.windowUTC[0]) / 1000, to = Date.parse(manifest.windowUTC[1]) / 1000;
  assert(to === from + 60, 'PACKET_WINDOW');
  const receipts = [], trades = [], signatureRows = []; let currentPool = null, genesis = null;
  for (const receipt of manifest.receipts) {
    assert(/^receipt-\d{3}\.json$/.test(receipt.file), 'RECEIPT_PATH');
    const raw = await readFile(`${directory}/${receipt.file}`, 'utf8');
    assert(digest(raw) === receipt.sha256 && receipt.httpStatus === 200, 'RECEIPT_HASH_OR_STATUS');
    const json = JSON.parse(raw); assert(!json.error, 'RECEIPT_RPC_ERROR'); receipts.push(receipt.sha256);
    if (receipt.method === 'getGenesisHash') genesis = json.result;
    if (receipt.method === 'getSignaturesForAddress' && receipt.params[0] === source.pool) {
      assert(receipt.params[1]?.commitment === 'finalized' && Array.isArray(json.result), 'SIGNATURE_RECEIPT_FINALITY');
      signatureRows.push(...json.result);
    }
    if (receipt.method === 'getAccountInfo' && receipt.params[0] === manifest.pool) {
      const account = json.result.value, bytes = Buffer.from(account.data[0], 'base64');
      const identity = poolIdentity(account, source.mint);
      assert(bytes.length === 1544 && digest(identity) === digest(manifest.identity), 'PINNED_POOL_LAYOUT');
      currentPool = { bytes: bytes.length, contextSlot: json.result.context.slot, config: bytes.subarray(9, 41).toString('hex'),
        tickSpacing: bytes.readUInt16LE(235), status: bytes[389], feeOn: bytes[390],
        seedIndex: bytes.readUInt16LE(391), historicalAtInterval: false };
    }
    if (receipt.method !== 'getTransaction') continue;
    assert(receipt.params[1]?.commitment === 'finalized', 'TRANSACTION_RECEIPT_FINALITY');
    const tx = json.result, result = reconcile(tx, manifest), decoded = extractSwapCandidates(tx, source.pool);
    assert(tx.transaction.signatures[0] === receipt.params[0], 'TRANSACTION_RECEIPT_SCOPE');
    const listed = manifest.transactions.find(t => t.signature === result.signature);
    assert(listed && listed.slot === tx.slot && listed.blockTime === tx.blockTime, 'PACKET_TRANSACTION_SCOPE');
    for (const e of result.events) {
      const event = decoded.find(candidate => candidate.logIndex === e.logIndex);
      assert(event, 'PACKET_EVENT_SCOPE');
      trades.push({ signature: result.signature, slot: tx.slot, blockTime: tx.blockTime, logIndex: e.logIndex,
        transactionIndex: listed.transactionOrderWithinBlock ?? null, baseRaw: e.rawAmounts[0], quoteRaw: e.rawAmounts[1],
        side: event.zeroForOne ? 'sell' : 'buy', ammFeeRaw: [event.tradeFee0, event.tradeFee1],
        transferFeeRaw: [event.transferFee0, event.transferFee1], finality: 'finalized', executionBound: true, receiptHash: receipt.sha256 });
    }
  }
  assert(currentPool && genesis === MAINNET_GENESIS, 'POOL_OR_GENESIS_RECEIPT_MISSING');
  for (const trade of trades) assert(signatureRows.some(row => row.signature === trade.signature
    && row.slot === trade.slot && row.blockTime === trade.blockTime && row.confirmationStatus === 'finalized'
    && row.err === null), 'SIGNATURE_FINALITY_UNPROVEN');
  const pipeline = new SourcePipeline(source), proof = {
    gates: { programIdentity: false, poolState: false, mintChronology: false, feeChronology: false,
      completeness: false, executionBinding: true }, receiptsHash: digest([digest(manifestText), ...receipts]), synthetic: false,
  };
  pipeline.ingest({ from, to, proof, trades });
  const pages = Object.fromEntries(Object.entries(STEPS).map(([interval, step]) => {
    const start = Math.floor(from / step) * step; return [interval, pipeline.history(interval, start, start + step)];
  }));
  const spent = process.cpuUsage(cpu);
  return { pipeline, report: { ticker: manifest.ticker, source, currentPool, candidateTransactions: new Set(trades.map(t => t.signature)).size,
    candidateTransfers: trades.length * 2, acceptedIntervals: 0, acceptedMarkets: 0, networkRequests: 0,
    gates: proof.gates, metrics: { ...pipeline.metrics, replayCpuUserMicros: spent.user, replayCpuSystemMicros: spent.system,
      replayWallMs: Math.round((performance.now() - started) * 1000) / 1000,
      storageBytes: Buffer.byteLength(JSON.stringify(pipeline.snapshot())) }, pages } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, output] = process.argv.slice(2);
  assert(directory && output, 'Usage: node scripts/stocks-source-pipeline.mjs PACKET_DIRECTORY NEW_REPORT_FILE');
  const { report } = await replayPacket(directory), handle = await open(output, 'wx');
  await handle.writeFile(JSON.stringify(report, null, 2) + '\n'); await handle.close();
  console.log(`${report.ticker}: ${report.candidateTransactions} candidates, ${report.acceptedIntervals} accepted intervals, ${report.networkRequests} RPC`);
  process.exitCode = report.acceptedIntervals ? 0 : 2;
}
