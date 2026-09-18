#!/usr/bin/env node
/**
 * NATIVE ENGINE COMMAND-PATH BENCHMARK — compute and call counts only.
 *
 * Drives the COMPILED NativeDemoService (`dist/`) through an in-memory
 * repository and a fixture market, exactly as the unit fixtures do, and
 * times each `command()` from call to authoritative response. It reports
 * p50/p95/p99 per command kind at 1 / 6 / 30 open contracts, the upstream
 * calls each command made (quotes, history windows), the size of the
 * persisted payload and of the response, and event-loop delay.
 *
 * What it does NOT measure: PostgreSQL/Neon commit time, HTTP, the browser.
 * Those are added on top of these figures in production, never subtracted.
 * `BENCH_QUOTE_LATENCY_MS` (default 0) adds a simulated upstream round trip
 * per quote so the fan-out cost of quoting many contracts shows up.
 *
 * Usage: npm run build && node scripts/bench-native-engine.cjs [--ops 1000] [--contracts 1,6,30]
 */
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const path = require('node:path');
const fs = require('node:fs');
const dist = path.resolve(__dirname, '../dist/private-trading');
const { NativeDemoService } = require(path.join(dist, 'native/service'));
const store = require(path.join(dist, 'native/store'));
const { commandHash, revisionPayload } = store;
// Older builds have no stored-shape compaction; they are measured as they wrote.
const compact = typeof store.compact === 'function' ? store.compact : (row) => row;
const { emptyDemoState } = require(path.join(dist, 'native/engine'));

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1]; };
const OPS = Number(arg('--ops', process.env.BENCH_OPS || 1000));
const CONTRACTS = String(arg('--contracts', process.env.BENCH_CONTRACTS || '1,6,30')).split(',').map(Number);
const QUOTE_LATENCY = Number(process.env.BENCH_QUOTE_LATENCY_MS || 0);
const HISTORY_LATENCY = Number(process.env.BENCH_HISTORY_LATENCY_MS || 0);
const LABEL = arg('--label', process.env.BENCH_LABEL || 'current');
const OUT = arg('--out', process.env.BENCH_OUT || '');

const M = 60_000, H = 3_600_000;
const H0 = Date.UTC(2026, 8, 15, 0, 0, 0);
const actor = { userId: 'bench', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };
const delay = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

class Clock { constructor(t) { this.t = t; } now = () => this.t; }
class MemoryRepository {
  constructor(clock) { this.clock = clock; this.row = null; this.revisions = new Map(); this.keys = new Map(); this.commits = 0; this.bytes = { payload: 0, revision: 0, last: 0 }; this.wallet = []; }
  async read() { return this.row ? structuredClone(this.row) : null; }
  async available() { return this.row ? null : '10000000'; }
  async holdings() { return this.wallet; }
  async revision(_a, r) { const v = this.revisions.get(r); return v ? structuredClone(v) : null; }
  async prior(_a, key, hash) { const v = this.keys.get(key); if (!v) return null; if (v.hash !== hash) throw new Error('idempotency_conflict'); return structuredClone(v.row); }
  async initialize(_a, key) {
    if (this.row) return structuredClone(this.row); const t = this.clock.now();
    this.row = { revision: 1, deposit: '10000000', commands: [], snapshot: emptyDemoState('10000000', t), createdAt: t, source: 'DEMO_BALANCE' };
    this.revisions.set(1, revisionPayload(this.row)); this.keys.set(key, { hash: commandHash({ kind: 'INITIALIZE' }), row: revisionPayload(this.row) }); return structuredClone(this.row);
  }
  async commit(_a, expected, next, key, hash) {
    const prior = await this.prior(_a, key, hash); if (prior) return prior;
    if (this.row?.revision !== expected) throw new Error('account_changed');
    const row = structuredClone({ ...next, revision: expected + 1 }); this.row = row; this.commits++;
    // What PostgreSQL would be asked to write: the full account payload AND the immutable revision,
    // in the STORED shape (`compact`, as PrismaNativeRepository writes it).
    const payload = JSON.stringify(compact(row)), revision = JSON.stringify(compact(revisionPayload(row)));
    this.bytes.payload = payload.length; this.bytes.revision = revision.length; this.bytes.last = payload.length + revision.length;
    this.revisions.set(row.revision, revisionPayload(row)); this.keys.set(key, { hash, row: revisionPayload(row) }); return structuredClone(row);
  }
}
const instrument = (symbol) => ({
  provider: 'bybit', symbol, baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', settleAsset: 'USDT', contractType: 'LinearPerpetual', status: 'Trading',
  launchTime: Date.UTC(2020, 0, 1), fetchedAt: H0, fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5' },
  leverage: { min: '1', max: '100', step: '1' },
  // A realistic tier ladder, so tier selection and the persisted instrument are not trivially small.
  // Continuous at every cap (deduction_i+1 = deduction_i + cap_i x rate step), as the profile validator requires.
  riskTiers: Array.from({ length: 20 }, (_, i) => ({ riskLimitValue: String(2_000_000 * (i + 1)), maintenanceMarginRate: (0.005 + 0.005 * i).toFixed(4), initialMarginRate: (0.01 + 0.01 * i).toFixed(4), maintenanceDeduction: String(10_000 * i * (i + 1) / 2), maxLeverage: String(Math.max(1, 100 - 5 * i)) })),
  parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'BENCH_FIXTURE',
});
class FakeMarket {
  constructor(clock) { this.clock = clock; this.calls = { quote: 0, history: 0, instrument: 0 }; this.price = new Map(); }
  priceOf(symbol) { if (!this.price.has(symbol)) this.price.set(symbol, 1000 + (symbol.charCodeAt(3) % 7) * 250); return this.price.get(symbol); }
  async instrument(symbol) { this.calls.instrument++; return instrument(symbol); }
  async freshQuote(symbol) {
    this.calls.quote++; await delay(QUOTE_LATENCY);
    const t = this.clock.now(), p = this.priceOf(symbol);
    const level = (side, i) => ({ price: (p + side * (0.1 + i * 0.1)).toFixed(1), quantity: (5 + i).toFixed(3) });
    return { provider: 'bybit', symbol, bids: Array.from({ length: 50 }, (_, i) => level(-1, i)), asks: Array.from({ length: 50 }, (_, i) => level(1, i)),
      markPrice: p.toFixed(1), lastPrice: p.toFixed(1), fundingRate: '0.0001', nextFundingTime: t + H, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  async history(r) {
    this.calls.history++; await delay(HISTORY_LATENCY);
    const step = (r.intervalMinutes ?? 1) * M, candles = [], p = this.priceOf(r.symbol).toFixed(1);
    for (let t = r.startTime; t < r.endTime; t += step) candles.push({ timestamp: t, open: p, high: p, low: p, close: p });
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: step, complete: true, issues: [], fetchedAt: this.clock.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1', instrument: instrument(r.symbol) };
  }
  async resolveCandle() { throw new Error('not used by the benchmark'); }
}
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null;
const stats = (samples) => { const s = [...samples].sort((a, b) => a - b); return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s.at(-1) ?? null, mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null }; };
const round = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
const roundStats = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'n' ? v : round(v)]));

async function scenario(contracts) {
  const clock = new Clock(H0 + 5 * H + 30_000), repo = new MemoryRepository(clock), market = new FakeMarket(clock);
  const service = new NativeDemoService(repo, market, clock.now);
  let seq = 0; const key = () => `bench-${contracts}-${++seq}`;
  const symbols = Array.from({ length: contracts }, (_, i) => `B${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}USDT`);
  await service.initialize(actor, `bench-init-${contracts}`);
  const positions = new Map();
  const outcome = { contracts, opened: 0, refused: null, samples: {}, calls: {}, payload: {}, response: {}, journal: 0, loop: null };
  // Warm-up: one position per contract. A refusal here (CONTRACT_LIMIT) is reported, not hidden.
  for (const symbol of symbols) {
    try {
      const v = await service.command(actor, { kind: 'OPEN', symbol, side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
      positions.set(symbol, v.positions.find((p) => p.symbol === symbol).id); outcome.opened++;
    } catch (e) { outcome.refused = e.code || e.message; break; }
    clock.t += 200;
  }
  if (outcome.refused) return outcome;
  const loop = monitorEventLoopDelay({ resolution: 5 }); loop.enable();
  const samples = { OPEN: [], CLOSE: [], REFRESH: [] }, calls = { OPEN: [], CLOSE: [], REFRESH: [] }, sizes = { response: [], payload: [] };
  const statuses = { OPEN: { filled: 0, partial: 0, rejected: 0 }, CLOSE: { filled: 0, partial: 0, rejected: 0 } };
  for (let i = 0; i < OPS; i++) {
    const symbol = symbols[i % symbols.length];
    const kind = i % 10 === 9 ? 'REFRESH' : i % 2 === 0 ? 'OPEN' : 'CLOSE';
    const request = kind === 'REFRESH' ? { kind, idempotencyKey: key() }
      : kind === 'OPEN' ? { kind, symbol, side: 'LONG', type: 'MARKET', quantity: '0.5', leverage: '10', idempotencyKey: key() }
        : { kind, positionId: positions.get(symbol), quantity: '0.5', idempotencyKey: key() };
    const before = { ...market.calls };
    const t0 = performance.now();
    let result, failure = null;
    try { result = await service.command(actor, request); } catch (e) { failure = e.code || e.message; }
    const elapsed = performance.now() - t0;
    samples[kind].push(elapsed);
    calls[kind].push({ quote: market.calls.quote - before.quote, history: market.calls.history - before.history });
    if (result) sizes.response.push(JSON.stringify(result).length);
    sizes.payload.push(repo.bytes.last);
    if (kind !== 'REFRESH') {
      if (failure) statuses[kind].rejected++;
      else {
        const p = result.positions.find((x) => x.id === positions.get(symbol));
        const events = result.events.filter((e) => e.time === clock.t && (e.kind === 'OPEN' || e.kind === 'CLOSE'));
        const filled = events.reduce((q, e) => q + Number(e.quantity), 0);
        if (Math.abs(filled - 0.5) < 1e-9) statuses[kind].filled++; else statuses[kind].partial++;
        if (!p) positions.delete(symbol);
      }
    }
    // One second per command: fresh quotes, distinct book snapshots, a minute boundary every 60 commands.
    clock.t += 1000;
  }
  loop.disable();
  for (const kind of Object.keys(samples)) {
    outcome.samples[kind] = roundStats(stats(samples[kind]));
    outcome.calls[kind] = { quote: roundStats(stats(calls[kind].map((c) => c.quote))), history: roundStats(stats(calls[kind].map((c) => c.history))) };
  }
  outcome.statuses = statuses;
  outcome.payload = { bytesLast: repo.bytes.last, accountPayload: repo.bytes.payload, revisionPayload: repo.bytes.revision, maxSeen: Math.max(...sizes.payload) };
  outcome.response = roundStats(stats(sizes.response));
  outcome.journal = repo.row.commands.length;
  outcome.commits = repo.commits;
  outcome.loop = { p50ms: round(loop.percentile(50) / 1e6), p99ms: round(loop.percentile(99) / 1e6), maxms: round(loop.max / 1e6) };
  outcome.openPositions = repo.row.snapshot.positions.filter((p) => p.status === 'OPEN').length;
  return outcome;
}

(async () => {
  const report = { label: LABEL, at: new Date().toISOString(), node: process.version, ops: OPS, quoteLatencyMs: QUOTE_LATENCY, historyLatencyMs: HISTORY_LATENCY,
    scope: 'compute + call counts on an in-memory repository and a fixture market; PostgreSQL, HTTP and the browser are NOT included', scenarios: [] };
  for (const contracts of CONTRACTS) {
    const s = await scenario(contracts); report.scenarios.push(s);
    const line = s.refused
      ? `contracts=${contracts}: refused after ${s.opened} (${s.refused})`
      : `contracts=${contracts}: OPEN p50=${s.samples.OPEN.p50}ms p95=${s.samples.OPEN.p95}ms p99=${s.samples.OPEN.p99}ms | CLOSE p50=${s.samples.CLOSE.p50}ms p95=${s.samples.CLOSE.p95}ms p99=${s.samples.CLOSE.p99}ms | REFRESH p95=${s.samples.REFRESH.p95}ms | quotes/OPEN p50=${s.calls.OPEN.quote.p50} | history/OPEN max=${s.calls.OPEN.history.max} | payload=${(s.payload.bytesLast / 1024).toFixed(0)}KB | response p95=${(s.response.p95 / 1024).toFixed(0)}KB | journal=${s.journal} | loop p99=${s.loop.p99ms}ms`;
    console.log(line);
  }
  if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n'); console.log('written', OUT); }
})().catch((e) => { console.error(e); process.exit(1); });
