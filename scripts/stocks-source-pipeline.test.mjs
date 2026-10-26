import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourcePipeline, GATES, digest, replayPacket, verifyFinalizedCoverage } from './stocks-source-pipeline.mjs';
import { CLMM, USDC, MAINNET_GENESIS } from './stocks-verify-clmm-proof.mjs';

// Disposable SYNTHETIC executions exercise machinery, never real price proof.
const source = { network: 'solana-mainnet-beta', program: CLMM, mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
  pool: '4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw', quoteMint: USDC, decimals: [8, 6] };
const start = 1792922400;
const proof = (gates = {}) => ({ gates: { ...Object.fromEntries(GATES.map(g => [g, true])), ...gates }, receiptsHash: digest('synthetic-proof'), synthetic: true });
const trade = (i = 0, price = 10, minute = start) => ({ signature: '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[i].repeat(64), slot: 100 + i,
  transactionIndex: 0, logIndex: 4, blockTime: minute + i % 60, baseRaw: '100000000', quoteRaw: String(price * 1000000),
  side: 'buy', ammFeeRaw: ['0', '0'], transferFeeRaw: ['0', '0'],
  finality: 'finalized', executionBound: true, receiptHash: digest(`synthetic-${i}`) });
const interval = (trades = [trade()], from = start, evidence = proof()) => ({ from, to: from + 60, proof: evidence, trades });

test('synthetic executions sort by slot/transaction/log and aggregate exact 1m/5m/1h OHLCV', () => {
  const p = new SourcePipeline(source);
  const executions = [trade(0, 10), trade(1, 12), trade(2, 9), trade(3, 11)];
  p.ingest(interval([executions[2], executions[3], executions[0], executions[1]]));
  for (let i = 1; i < 60; i++) p.ingest(interval([], start + i * 60));
  for (const resolution of ['1m', '5m', '1h']) {
    const page = p.history(resolution, start, start + 3600), candle = page.candles[0];
    assert.deepEqual([candle.open, candle.high, candle.low, candle.close, candle.volume], [10, 12, 9, 11, 4]);
    assert.equal(candle.exact.quoteVolume, '42.000000000000000000');
    assert.equal(candle.tradeCount, 4); assert.equal(page.priceKind, 'raw-token');
    assert.equal(page.equityEquivalent, null); assert.equal(page.provenance.synthetic, true);
    assert(page.gaps.every(g => g.reason === 'NO_TRADES'));
  }
});

test('same-slot open/close follows canonical block order, then invocation log order', () => {
  const p = new SourcePipeline(source), a = trade(0, 7), b = { ...trade(1, 12), slot: a.slot, blockTime: a.blockTime, transactionIndex: 1 };
  const c = { ...b, quoteRaw: '9000000', logIndex: 8 };
  p.ingest(interval([c, b, a])); const candle = p.history('1m', start, start + 60).candles[0];
  assert.equal(candle.open, 7); assert.equal(candle.close, 9); assert.equal(candle.high, 12);
});

for (const gate of GATES) test(`missing ${gate} never emits real-looking OHLCV`, () => {
  const p = new SourcePipeline(source); p.ingest(interval([trade()], start, proof({ [gate]: false })));
  const page = p.history('1m', start, start + 60);
  assert.deepEqual(page.candles, []); assert.deepEqual(page.gaps, [{ time: start, reason: 'UNKNOWN' }]);
  assert.equal(page.provenance.status, 'UNKNOWN'); assert.equal(page.provenance.acceptedTradeCount, 0);
});

test('one missing minute invalidates the whole 5m/1h bucket, with no carry or zero candles', () => {
  const p = new SourcePipeline(source); p.ingest(interval());
  for (let i = 1; i < 60; i++) if (i !== 3) p.ingest(interval([], start + i * 60));
  assert.equal(p.history('1m', start, start + 3600).candles.length, 1);
  assert.deepEqual(p.history('5m', start, start + 300).candles, []);
  assert.deepEqual(p.history('1h', start, start + 3600).gaps, [{ time: start, reason: 'UNKNOWN' }]);
});

test('complete no-trade minute remains whitespace and cannot fabricate a volume/price', () => {
  const p = new SourcePipeline(source); p.ingest(interval([])); const page = p.history('1m', start, start + 60);
  assert.deepEqual(page.candles, []); assert.deepEqual(page.gaps, [{ time: start, reason: 'NO_TRADES' }]);
  assert.equal(page.provenance.acceptedTradeCount, 0); assert.equal(page.provenance.intervalComplete, true);
});

test('exact rational extremes and raw integers above JS safe integer survive deterministic conversion', () => {
  const p = new SourcePipeline(source), a = { ...trade(), baseRaw: '9007199254740993', quoteRaw: '9007199254740993' };
  p.ingest(interval([a])); const candle = p.history('1m', start, start + 60).candles[0];
  assert.equal(candle.exact.open, '100.000000000000000000');
  assert.equal(candle.exact.volume, '90071992.547409930000000000');
});

test('dedup is idempotent, conflicts are rejected before state mutation', () => {
  const p = new SourcePipeline(source), a = trade(); p.ingest(interval([a, a]));
  assert.equal(p.history('1m', start, start + 60).candles[0].tradeCount, 1);
  assert.equal(p.metrics.duplicateTrades, 1); p.ingest(interval([a])); assert.equal(p.metrics.duplicateIntervals, 1);
  const before = p.snapshot();
  assert.throws(() => p.ingest(interval([a, { ...a, quoteRaw: '11000000' }])), /CONFLICTING_DUPLICATE/);
  assert.throws(() => p.ingest(interval([{ ...a, quoteRaw: '11000000' }])), /IMMUTABLE_INTERVAL_CONFLICT/);
  assert.deepEqual(p.snapshot(), before);
});

for (const [name, change, reason] of [
  ['confirmed', { finality: 'confirmed' }, 'TRADE_NOT_FINALIZED'],
  ['unbound', { executionBound: false }, 'TRADE_NOT_FINALIZED'],
  ['unknown block order', { transactionIndex: null }, 'TRADE_ORDER_UNPROVEN'],
  ['negative amount', { baseRaw: '-1' }, 'TRADE_AMOUNTS'],
  ['zero amount', { baseRaw: '0' }, 'TRADE_AMOUNTS'],
  ['oversize amount', { baseRaw: '18446744073709551616' }, 'TRADE_AMOUNTS'],
  ['unsupported transfer fee', { transferFeeRaw: ['1', '0'] }, 'TRANSFER_FEE_UNSUPPORTED'],
  ['out-of-window', { blockTime: start + 60 }, 'TRADE_IDENTITY'],
]) test(`reject ${name}`, () => {
  const p = new SourcePipeline(source); assert.throws(() => p.ingest(interval([{ ...trade(), ...change }])), new RegExp(reason));
  assert.equal(p.minutes.size, 0);
});

test('execution position collisions and inconsistent block timestamps fail closed', () => {
  const p = new SourcePipeline(source), a = trade(), b = { ...trade(1), slot: a.slot, transactionIndex: 0 };
  assert.throws(() => p.ingest(interval([a, b])), /EXECUTION_POSITION_COLLISION/);
  assert.throws(() => p.ingest(interval([a, { ...b, transactionIndex: 1 }])), /BLOCK_TIME_ORDER/);
});

test('cross-minute block order cannot contradict transaction timestamps', () => {
  const p = new SourcePipeline(source); p.ingest(interval());
  assert.throws(() => p.ingest(interval([{ ...trade(1, 10, start + 60), slot: 99 }], start + 60)), /CROSS_INTERVAL_BLOCK_ORDER/);
  assert.equal(p.minutes.size, 1);
});

for (const complete of [true, false]) test(`signature cannot move across retained minutes, complete=${complete}`, () => {
  const p = new SourcePipeline(source), evidence = proof({ completeness: complete }), a = trade();
  p.ingest(interval([a], start, evidence));
  const before = p.snapshot(), moved = { ...a, logIndex: a.logIndex + 1, slot: a.slot + 1, blockTime: start + 61 };
  assert.throws(() => p.ingest(interval([moved], start + 60, evidence)), /SIGNATURE_IDENTITY_CONFLICT/);
  assert.deepEqual(p.snapshot(), before); assert.equal(p.minutes.size, 1);
});

test('restart preserves global signature identity; recomputed checksum cannot bless a contradictory store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stocks615-identity-')), file = join(directory, 'state.json');
  try {
    const p = new SourcePipeline(source), a = trade(); p.ingest(interval([a])); await p.checkpoint(file);
    const recovered = await SourcePipeline.recover(file, source), before = recovered.snapshot();
    const moved = { ...a, logIndex: a.logIndex + 1, slot: a.slot + 1, blockTime: start + 61 };
    assert.throws(() => recovered.ingest(interval([moved], start + 60)), /SIGNATURE_IDENTITY_CONFLICT/);
    assert.deepEqual(recovered.snapshot(), before);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    saved.payload.minutes.push(interval([moved], start + 60)); saved.payload.watermark = start + 120;
    saved.sha256 = digest(saved.payload); await writeFile(file, JSON.stringify(saved));
    await assert.rejects(SourcePipeline.recover(file, source), /SIGNATURE_IDENTITY_CONFLICT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('multiple log indices in the same transaction remain distinct executions after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stocks615-multi-log-')), file = join(directory, 'state.json');
  try {
    const p = new SourcePipeline(source), a = trade(), b = { ...a, logIndex: a.logIndex + 1, quoteRaw: '12000000' };
    p.ingest(interval([b, a])); await p.checkpoint(file);
    const recovered = await SourcePipeline.recover(file, source), page = recovered.history('1m', start, start + 60);
    assert.equal(page.candles.length, 1); assert.equal(page.candles[0].tradeCount, 2);
    assert.equal(page.candles[0].open, 10); assert.equal(page.candles[0].close, 12);
    assert.deepEqual(page, p.history('1m', start, start + 60));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recovery enforces the saved byte budget and rejects extra metric fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stocks615-recovery-budget-')), file = join(directory, 'state.json');
  try {
    const p = new SourcePipeline(source, { maxBytes: 4096 }); p.ingest(interval()); await p.checkpoint(file);
    const original = await readFile(file, 'utf8'), saved = JSON.parse(original);
    saved.padding = 'x'.repeat(4096); await writeFile(file, JSON.stringify(saved));
    await assert.rejects(SourcePipeline.recover(file, source), /RECOVERY_BUDGET/);
    const other = JSON.parse(original); other.payload.metrics.extra = 1; other.sha256 = digest(other.payload);
    await writeFile(file, JSON.stringify(other)); await assert.rejects(SourcePipeline.recover(file, source), /RECOVERY_METRICS/);
    const repeated = JSON.parse(original); repeated.payload.minutes.push(repeated.payload.minutes[0]);
    repeated.sha256 = digest(repeated.payload); await writeFile(file, JSON.stringify(repeated));
    await assert.rejects(SourcePipeline.recover(file, source), /RECOVERY_DUPLICATE_MINUTE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('full checkpoint boundary includes final counters and stays persistable after accepted/rejected ingests', async t => {
  // Fix only the measured CPU counters so the exact byte boundary is stable.
  t.mock.method(process, 'cpuUsage', () => ({ user: 0, system: 0 }));
  const directory = await mkdtemp(join(tmpdir(), 'stocks615-exact-budget-')), file = join(directory, 'state.json');
  try {
    const input = interval(Array.from({ length: 10 }, (_, i) => trade(i))), wide = new SourcePipeline(source, { maxBytes: 8192 });
    wide.ingest(input); await wide.checkpoint(file);
    const bytes = Buffer.byteLength(await readFile(file));
    assert(bytes >= 4096 && bytes < 8192);
    const fit = new SourcePipeline(source, { maxBytes: bytes }); fit.ingest(input);
    await fit.checkpoint(file); assert.equal(Buffer.byteLength(await readFile(file)), bytes);
    assert.deepEqual((await SourcePipeline.recover(file, source)).snapshot(), fit.snapshot());
    const tooSmall = new SourcePipeline(source, { maxBytes: bytes - 1 }), before = tooSmall.snapshot();
    assert.throws(() => tooSmall.ingest(input), /BYTE_STORAGE_BUDGET/);
    assert.deepEqual(tooSmall.snapshot(), before); await tooSmall.checkpoint(file);
    assert.equal((await SourcePipeline.recover(file, source)).minutes.size, 0);
    // Counter width is part of the same budget even for a duplicate interval.
    for (let i = 0; i < 9; i++) fit.ingest(input);
    const nine = fit.snapshot(); assert.throws(() => fit.ingest(input), /BYTE_STORAGE_BUDGET/);
    assert.deepEqual(fit.snapshot(), nine); await fit.checkpoint(file);
    assert.equal(Buffer.byteLength(await readFile(file)), bytes);
    assert.equal((await SourcePipeline.recover(file, source)).metrics.duplicateIntervals, 9);
    t.mock.restoreAll(); // The reader's real CPU must not break exact-cap recovery.
    assert.deepEqual((await SourcePipeline.recover(file, source)).snapshot(), fit.snapshot());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bounded retention survives out-of-order arrival and never resurrects evicted history', () => {
  const p = new SourcePipeline(source, { maxMinutes: 60 });
  p.ingest(interval([], start + 60)); p.ingest(interval([], start));
  for (let i = 2; i < 62; i++) p.ingest(interval([], start + i * 60));
  assert.equal(p.minutes.size, 60); assert.equal(p.metrics.evictedMinutes, 2);
  assert.throws(() => p.ingest(interval([], start)), /OUTSIDE_RETENTION/);
  assert.equal(p.history('1m', start, start + 60).gaps[0].reason, 'OUTSIDE_RETENTION');
});

test('trade and byte budgets reject atomically', () => {
  const p = new SourcePipeline(source, { maxTrades: 1 });
  assert.throws(() => p.ingest(interval([trade(), trade(1)])), /INGEST_BUDGET/);
  assert.equal(p.minutes.size, 0);
  const small = new SourcePipeline(source, { maxBytes: 4096 });
  assert.throws(() => small.ingest(interval(Array.from({ length: 12 }, (_, i) => trade(i)))), /BYTE_STORAGE_BUDGET/);
  assert.equal(small.minutes.size, 0); assert.equal(small.watermark, 0);
});

test('checkpoint/restart is deterministic, tampering, wrong source and concurrent pending save fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stocks615-pipeline-')), file = join(directory, 'state.json');
  try {
    const p = new SourcePipeline(source); p.ingest(interval()); await p.checkpoint(file);
    const q = await SourcePipeline.recover(file, source);
    assert.deepEqual(q.history('1m', start, start + 60), p.history('1m', start, start + 60));
    q.ingest(interval()); assert.equal(q.metrics.duplicateIntervals, 1);
    await assert.rejects(SourcePipeline.recover(file, { ...source, pool: USDC }), /SOURCE_MISMATCH/);
    await writeFile(file + '.pending', 'simulated interrupted writer');
    await assert.rejects(p.checkpoint(file), /EEXIST/);
    assert.equal((await SourcePipeline.recover(file, source)).minutes.size, 1);
    const saved = JSON.parse(await readFile(file, 'utf8')); saved.payload.minutes[0].trades[0].quoteRaw = '999';
    await writeFile(file, JSON.stringify(saved)); await assert.rejects(SourcePipeline.recover(file, source), /CORRUPT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const [ticker, count] of [['SPYx', 13], ['CRCLx', 2]]) test(`${ticker} immutable real receipts -> explicit UNKNOWN at every resolution, zero RPC`, async () => {
  const { pipeline, report } = await replayPacket(`research/solana-xstocks/proof-615-20261025/${ticker}-final`);
  assert.equal(report.candidateTransactions, count); assert.equal(report.candidateTransfers, count * 2);
  assert.equal(report.currentPool.bytes, 1544); assert.equal(report.currentPool.historicalAtInterval, false);
  assert.equal(report.acceptedIntervals, 0); assert.equal(report.acceptedMarkets, 0); assert.equal(report.networkRequests, 0);
  assert.equal(pipeline.metrics.rpcRequests, 0);
  for (const page of Object.values(report.pages)) {
    assert.deepEqual(page.candles, []); assert.equal(page.gaps[0].reason, 'UNKNOWN');
    assert.equal(page.provenance.synthetic, false); assert.equal(page.provenance.intervalComplete, false);
  }
});

for (const [ticker, count] of [['SPYx', 8], ['CRCLx', 3]]) test(`${ticker} fresh Windows RPC executions reconcile but cannot bypass any missing proof gate`, async () => {
  const directory = `research/solana-xstocks/proof-615-20261026/windows-executions-1793034915829/${ticker}`;
  const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
  assert.equal(manifest.programAttestation.is_verified, false);
  const {report} = await replayPacket(directory);
  assert.equal(report.candidateTransactions, count); assert.equal(report.candidateTransfers, count * 2);
  assert.equal(report.gates.executionBinding, true);
  for (const gate of GATES.filter(g => g !== 'executionBinding')) assert.equal(report.gates[gate], false);
  assert.equal(report.acceptedMarkets, 0); assert.equal(report.acceptedIntervals, 0);
  assert.equal(report.networkRequests, 0);
  for (const page of Object.values(report.pages)) {
    assert.deepEqual(page.candles, []); assert.equal(page.gaps[0].reason, 'UNKNOWN');
    assert.equal(page.provenance.synthetic, false); assert.equal(page.provenance.intervalComplete, false);
  }
});

function coverage() {
  const times = [start - 1, start + 1, start + 60];
  const blocks = times.map((blockTime, i) => ({ slot: 100 + i,
    block: { blockTime, blockhash: `block-${i}`, parentSlot: 99 + i, previousBlockhash: `block-${i - 1}`,
      transactions: i === 1 ? [{ transaction: { signatures: [trade().signature], message: { accountKeys: [source.pool] } }, meta: { err: null } }] : [] } }));
  return { pool: source.pool, from: start, to: start + 60, genesis: MAINNET_GENESIS, finalizedSlot: 102,
    producedSlots: [100, 101, 102], blocks,
    signatures: [
      { signature: 'after', slot: 102, blockTime: start + 60, confirmationStatus: 'finalized', err: null },
      { signature: trade().signature, slot: 101, blockTime: start + 1, confirmationStatus: 'finalized', err: null },
      { signature: 'before', slot: 100, blockTime: start - 1, confirmationStatus: 'finalized', err: null },
    ] };
}
test('independent finalized signature/block enumeration supplies canonical positions including failed tx', () => {
  const data = coverage(); assert.equal(verifyFinalizedCoverage(data).positions[0].transactionIndex, 0);
  data.blocks[1].block.transactions[0].meta.err = { InstructionError: [0, 'Custom'] };
  data.signatures[1].err = { InstructionError: [0, 'Custom'] };
  assert.equal(verifyFinalizedCoverage(data).complete, true);
});
for (const [name, corrupt, reason] of [
  ['missing block', d => d.blocks.splice(1, 1), 'BLOCK_STREAM_INCOMPLETE'],
  ['omitted produced slot', d => { d.blocks.splice(1, 1); d.producedSlots.splice(1, 1); }, 'BLOCK_ANCESTRY'],
  ['unfinalized', d => { d.finalizedSlot = 100; }, 'PRODUCED_SLOTS'],
  ['wrong network', d => { d.genesis = 'wrong'; }, 'COVERAGE_NETWORK'],
  ['observed-only blocks', d => { d.blocks = [d.blocks[1]]; d.producedSlots = [101]; }, 'PRODUCED_SLOTS'],
  ['signature omitted', d => d.signatures.splice(1, 1), 'SIGNATURE_ENUMERATION_INCOMPLETE'],
  ['signature added', d => d.signatures.push({ ...d.signatures[1], signature: 'extra' }), 'SIGNATURE_BLOCK_MISMATCH'],
  ['missing loaded keys', d => { d.blocks[1].block.transactions[0].transaction.message.addressTableLookups = [{}]; }, 'LOADED_ADDRESSES_MISSING'],
  ['wrong block hash', d => { d.blocks[2].block.previousBlockhash = 'wrong'; }, 'BLOCK_ANCESTRY'],
  ['missing boundary', d => { d.blocks[0].block.blockTime = start; }, 'BLOCK_WINDOW_NOT_BRACKETED'],
]) test(`completeness rejects ${name}`, () => {
  const data = coverage(); corrupt(data); assert.throws(() => verifyFinalizedCoverage(data), new RegExp(reason));
});
