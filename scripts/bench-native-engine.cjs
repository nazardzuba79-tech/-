#!/usr/bin/env node
/**
 * NATIVE ENGINE COMMAND-PATH BENCHMARK — timings by phase, call counts, sizes.
 *
 * Drives the COMPILED NativeDemoService (`dist/`) and times each `command()`
 * from call to authoritative response, split into what it waited on:
 *   engine    = total − market wait − repository wait (replay, risk pass,
 *               projection, payload build — the pure compute of a command)
 *   market    = wall time with at least one market-data call in flight
 *               (instrument / freshQuote / marks / history)
 *   repository= wall time with at least one repository call in flight
 *               (read / prior / holdings / commit …)
 *   serialize = JSON.stringify of the response (what the local server does
 *               before the bytes leave the process; HTTP transport itself is
 *               loopback and is not timed here)
 * plus p50/p95/p99/max of each, per command kind, at 1 / 10 / 20 / 30 open
 * contracts; the calls each command made (quotes, frame reads, history
 * windows, repository calls); the persisted payload and response sizes;
 * OPEN/CLOSE fill outcomes; event-loop delay.
 *
 * Modes (environment):
 *   BENCH_FRAME=1           the fixture market exposes the collector live-frame
 *                           `marks()` (block F5); default: every contract is
 *                           quoted itself.
 *   BENCH_QUOTE_LATENCY_MS  simulated upstream round trip per quote / frame read
 *   BENCH_HISTORY_LATENCY_MS   … per history window
 *   BENCH_DB=1              the REAL PrismaNativeRepository on DATABASE_URL (a
 *                           disposable loopback TEST database only): repository
 *                           wait is then PostgreSQL read/commit time and the
 *                           call counts are real transactions. Runs on the real
 *                           clock advanced one second per command.
 *
 * Usage: npm run build && node scripts/bench-native-engine.cjs [--ops 1000] [--contracts 1,10,20,30] [--label x] [--out file.json]
 */
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
// BENCH_DIST points at another build's `dist/` (a worktree of the base branch) for before/after runs with ONE script.
const dist = path.resolve(process.env.BENCH_DIST || path.resolve(__dirname, '../dist'), 'private-trading');
const { NativeDemoService } = require(path.join(dist, 'native/service'));
const store = require(path.join(dist, 'native/store'));
const { commandHash, revisionPayload } = store;
// Older builds have no stored-shape compaction; they are measured as they wrote.
const compact = typeof store.compact === 'function' ? store.compact : (row) => row;
const { emptyDemoState } = require(path.join(dist, 'native/engine'));

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1]; };
const OPS = Number(arg('--ops', process.env.BENCH_OPS || 1000));
const CONTRACTS = String(arg('--contracts', process.env.BENCH_CONTRACTS || '1,10,20,30')).split(',').map(Number);
const QUOTE_LATENCY = Number(process.env.BENCH_QUOTE_LATENCY_MS || 0);
const HISTORY_LATENCY = Number(process.env.BENCH_HISTORY_LATENCY_MS || 0);
const FRAME = process.env.BENCH_FRAME === '1';
const DB = process.env.BENCH_DB === '1';
const LABEL = arg('--label', process.env.BENCH_LABEL || 'current');
const OUT = arg('--out', process.env.BENCH_OUT || '');

const M = 60_000, H = 3_600_000, STEP = 3000;
const H0 = Date.UTC(2026, 8, 15, 0, 0, 0);
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
    const known = this.keys.get(key); if (known) return structuredClone(known.row);
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
  constructor(clock) { this.clock = clock; this.price = new Map(); if (!FRAME) this.marks = undefined; }
  priceOf(symbol) { if (!this.price.has(symbol)) this.price.set(symbol, 1000 + (symbol.charCodeAt(3) % 7) * 250); return this.price.get(symbol); }
  async instrument(symbol) { return instrument(symbol); }
  async freshQuote(symbol) {
    await delay(QUOTE_LATENCY);
    const t = this.clock.now(), p = this.priceOf(symbol);
    const level = (side, i) => ({ price: (p + side * (0.1 + i * 0.1)).toFixed(1), quantity: (5 + i).toFixed(3) });
    return { provider: 'bybit', symbol, bids: Array.from({ length: 50 }, (_, i) => level(-1, i)), asks: Array.from({ length: 50 }, (_, i) => level(1, i)),
      markPrice: p.toFixed(1), lastPrice: p.toFixed(1), fundingRate: '0.0001', nextFundingTime: t + H, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  /** The collector live frame (block F5): one call for many contracts, no venue call. Present only with BENCH_FRAME=1. */
  async marks(symbols) {
    await delay(QUOTE_LATENCY);
    const t = this.clock.now();
    return new Map(symbols.map((symbol) => [symbol, { symbol, markPrice: this.priceOf(symbol).toFixed(1), lastPrice: this.priceOf(symbol).toFixed(1), markProviderTimestamp: t, receivedAt: t, fetchedAt: t }]));
  }
  async history(r) {
    await delay(HISTORY_LATENCY);
    const step = (r.intervalMinutes ?? 1) * M, candles = [], p = this.priceOf(r.symbol).toFixed(1);
    for (let t = r.startTime; t < r.endTime; t += step) candles.push({ timestamp: t, open: p, high: p, low: p, close: p });
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: step, complete: true, issues: [], fetchedAt: this.clock.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1', instrument: instrument(r.symbol) };
  }
  async resolveCandle() { throw new Error('not used by the benchmark'); }
}
/** Wall time with at least one wrapped call in flight, and a count per method. Overlapping calls (a quote batch) count once. */
function tracker(target, methods) {
  const t = { inflight: 0, since: 0, wall: 0, calls: {} };
  for (const name of methods) {
    if (typeof target[name] !== 'function') continue;
    const original = target[name].bind(target);
    target[name] = async (...a) => {
      t.calls[name] = (t.calls[name] || 0) + 1;
      if (t.inflight++ === 0) t.since = performance.now();
      try { return await original(...a); } finally { if (--t.inflight === 0) t.wall += performance.now() - t.since; }
    };
  }
  t.take = () => { const out = { wall: t.wall, calls: { ...t.calls } }; t.wall = 0; t.calls = {}; return out; };
  return t;
}
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null;
const stats = (samples) => { const s = [...samples].sort((a, b) => a - b); return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s.at(-1) ?? null, mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null }; };
const round = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
const roundStats = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'n' ? v : round(v)]));
const KINDS = ['OPEN', 'CLOSE', 'CLOSE_FULL', 'OPEN_NEW', 'REDUCE_LIMIT', 'CANCEL', 'REFRESH'];

async function database() {
  const { PrismaClient } = require('@prisma/client');
  const hostname = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1'].includes(hostname)) throw new Error('BENCH_DB=1 runs only against a disposable loopback TEST database');
  const db = new PrismaClient(); await db.$connect();
  const tag = randomUUID().replace(/-/g, '');
  const user = await db.user.create({ data: { email: `bench-native-${tag}@example.test`, passwordHash: 'BENCH_FIXTURE_NO_LOGIN', referralCode: `nb${tag}`, role: 'ADMIN' } });
  const session = await db.session.create({ data: { userId: user.id, userAgent: 'BENCH_NATIVE_ENGINE_ONLY' } });
  await db.demoBalance.create({ data: { userId: user.id, asset: 'USDT', available: '10000000' } });
  return { db, actor: { userId: user.id, sessionId: session.id, expiresAt: Date.now() + 6 * H }, repository: new store.PrismaNativeRepository(db, () => ({ enabled: true, ownerId: user.id })) };
}

async function scenario(contracts) {
  const clock = new Clock(DB ? Date.now() : H0 + 5 * H + 30_000);
  const backend = DB ? await database() : null;
  const actor = backend ? backend.actor : { userId: 'bench', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };
  const repo = backend ? backend.repository : new MemoryRepository(clock), market = new FakeMarket(clock);
  const service = new NativeDemoService(repo, market, clock.now);
  const marketT = tracker(market, ['instrument', 'freshQuote', 'marks', 'history']);
  const repoT = tracker(repo, ['read', 'prior', 'holdings', 'available', 'revision', 'commit']);
  let seq = 0; const key = () => `bench-${contracts}-${randomUUID()}-${++seq}`;
  const symbols = Array.from({ length: contracts }, (_, i) => `B${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}USDT`);
  const spare = `BZ9USDT`;
  await service.initialize(actor, `bench-init-${contracts}-${randomUUID()}`);
  const positions = new Map();
  const outcome = { contracts, frame: FRAME, db: DB, opened: 0, refused: null, samples: {}, phases: {}, calls: {}, payload: {}, response: {}, journal: 0, loop: null };
  // Warm-up: one position per contract. A refusal here (CONTRACT_LIMIT) is reported, not hidden.
  for (const symbol of symbols) {
    try {
      const v = await service.command(actor, { kind: 'OPEN', symbol, side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
      positions.set(symbol, v.positions.find((p) => p.symbol === symbol).id); outcome.opened++;
    } catch (e) { outcome.refused = e.code || e.message; break; }
    clock.t += 200;
  }
  if (outcome.refused) { if (backend) await backend.db.$disconnect(); return outcome; }
  marketT.take(); repoT.take();
  const loop = monitorEventLoopDelay({ resolution: 5 }); loop.enable();
  const samples = Object.fromEntries(KINDS.map((k) => [k, { total: [], engine: [], market: [], repository: [], serialize: [] }]));
  const calls = Object.fromEntries(KINDS.map((k) => [k, []])), sizes = { response: [], payload: [] };
  const statuses = { OPEN: { filled: 0, partial: 0, rejected: 0 }, CLOSE: { filled: 0, partial: 0, rejected: 0 } }, failures = {};
  let restingOrder = null, conflictsBefore = service.conflicts ?? 0;
  const run = async (kind, request) => {
    const t0 = performance.now();
    let result, failure = null;
    try { result = await service.command(actor, request); } catch (e) { failure = e.code || e.message; failures[kind] = failures[kind] || {}; failures[kind][failure] = (failures[kind][failure] || 0) + 1; }
    const total = performance.now() - t0;
    const m = marketT.take(), r = repoT.take();
    const s0 = performance.now(); const json = result ? JSON.stringify(result) : ''; const serialize = performance.now() - s0;
    samples[kind].total.push(total); samples[kind].market.push(m.wall); samples[kind].repository.push(r.wall);
    samples[kind].engine.push(Math.max(0, total - m.wall - r.wall)); samples[kind].serialize.push(serialize);
    calls[kind].push({ quote: m.calls.freshQuote || 0, marks: m.calls.marks || 0, history: m.calls.history || 0, instrument: m.calls.instrument || 0,
      repository: Object.values(r.calls).reduce((a, b) => a + b, 0), commit: r.calls.commit || 0 });
    if (json) sizes.response.push(json.length);
    if (!DB) sizes.payload.push(repo.bytes.last);
    return { result, failure };
  };
  for (let i = 0; i < OPS; i++) {
    // Each contract sees OPEN then CLOSE in turn (the pair index picks the contract), so positions hover
    // around one contract instead of one half of the contracts only growing and the other only shrinking.
    const symbol = symbols[Math.floor(i / 2) % symbols.length];
    let kind, request;
    if (!positions.has(symbol)) { kind = 'OPEN_NEW'; request = { kind: 'OPEN', symbol, side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() }; }
    else if (i % 25 === 24) { kind = 'CLOSE_FULL'; request = { kind: 'CLOSE', positionId: positions.get(symbol), idempotencyKey: key() }; }
    else if (i % 15 === 14) { kind = 'REDUCE_LIMIT'; request = { kind: 'OPEN', symbol, side: 'SHORT', type: 'LIMIT', price: String(market.priceOf(symbol) * 3), quantity: '0.5', leverage: '10', reduceOnly: true, positionId: positions.get(symbol), idempotencyKey: key() }; }
    else if (i % 10 === 9) { kind = 'REFRESH'; request = { kind: 'REFRESH', idempotencyKey: key() }; }
    else if (i % 2 === 0) { kind = 'OPEN'; request = { kind: 'OPEN', symbol, side: 'LONG', type: 'MARKET', quantity: '0.5', leverage: '10', idempotencyKey: key() }; }
    else { kind = 'CLOSE'; request = { kind: 'CLOSE', positionId: positions.get(symbol), quantity: '0.5', idempotencyKey: key() }; }
    const { result, failure } = await run(kind, request);
    // The position of this contract may have changed identity (a partial close that emptied it, a re-open):
    // always address the contract's CURRENT open position, never a remembered id.
    if (result) { const open = result.positions.find((p) => p.symbol === symbol && p.status === 'OPEN'); if (open) positions.set(symbol, open.id); else positions.delete(symbol); }
    if (kind === 'OPEN' || kind === 'CLOSE') {
      if (failure) statuses[kind].rejected++;
      else {
        const events = result.events.filter((e) => e.time === clock.t && (e.kind === 'OPEN' || e.kind === 'CLOSE'));
        const filled = events.reduce((q, e) => q + Number(e.quantity), 0);
        if (Math.abs(filled - 0.5) < 1e-9) statuses[kind].filled++; else statuses[kind].partial++;
      }
    }
    if (kind === 'CLOSE_FULL' && !failure) {
      // The contract is re-opened at once (measured as OPEN_NEW), so the account keeps N contracts.
      clock.t += 1000;
      const reopened = await run('OPEN_NEW', { kind: 'OPEN', symbol, side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
      if (!reopened.failure) positions.set(symbol, reopened.result.positions.find((p) => p.symbol === symbol && p.status === 'OPEN').id); else positions.delete(symbol);
    }
    if (kind === 'REDUCE_LIMIT' && !failure) {
      restingOrder = result.orders.find((o) => o.reduceOnly && o.status === 'OPEN' && o.symbol === symbol);
      clock.t += 1000;
      if (restingOrder) await run('CANCEL', { kind: 'CANCEL', orderId: restingOrder.id, idempotencyKey: key() });
    }
    // Three seconds per command: every command finds the service's 2-second quote snapshot expired (the
    // worst case for upstream calls), distinct book snapshots, a minute boundary every 20 commands.
    clock.t += STEP;
  }
  loop.disable();
  for (const kind of KINDS) {
    if (!samples[kind].total.length) continue;
    outcome.samples[kind] = roundStats(stats(samples[kind].total));
    outcome.phases[kind] = Object.fromEntries(['engine', 'market', 'repository', 'serialize'].map((p) => [p, roundStats(stats(samples[kind][p]))]));
    outcome.calls[kind] = Object.fromEntries(['quote', 'marks', 'history', 'instrument', 'repository', 'commit'].map((c) => [c, roundStats(stats(calls[kind].map((x) => x[c])))]));
  }
  outcome.statuses = statuses; outcome.failures = failures;
  outcome.conflictsRetried = (service.conflicts ?? 0) - conflictsBefore;
  const row = DB ? await repo.read(actor) : repo.row;
  outcome.payload = DB ? { bytesLast: JSON.stringify(compact(row)).length + JSON.stringify(compact(revisionPayload(row))).length, note: 'computed from the row read back' }
    : { bytesLast: repo.bytes.last, accountPayload: repo.bytes.payload, revisionPayload: repo.bytes.revision, maxSeen: Math.max(...sizes.payload) };
  outcome.response = roundStats(stats(sizes.response));
  outcome.journal = row.commands.length;
  outcome.commits = DB ? row.revision - 1 : repo.commits;
  outcome.loop = { p50ms: round(loop.percentile(50) / 1e6), p99ms: round(loop.percentile(99) / 1e6), maxms: round(loop.max / 1e6) };
  outcome.openPositions = row.snapshot.positions.filter((p) => p.status === 'OPEN').length;
  if (backend) await backend.db.$disconnect();
  return outcome;
}

(async () => {
  const report = { label: LABEL, at: new Date().toISOString(), node: process.version, ops: OPS, quoteLatencyMs: QUOTE_LATENCY, historyLatencyMs: HISTORY_LATENCY, frame: FRAME, db: DB,
    scope: DB ? 'compute + PostgreSQL (disposable loopback) + call counts on a fixture market; HTTP and the browser are NOT included'
      : 'compute + call counts on an in-memory repository and a fixture market; PostgreSQL, HTTP and the browser are NOT included', scenarios: [] };
  for (const contracts of CONTRACTS) {
    const s = await scenario(contracts); report.scenarios.push(s);
    const ms = (x) => (x ? `${x.p50}/${x.p95}/${x.max}` : '—');
    const line = s.refused
      ? `contracts=${contracts}: refused after ${s.opened} (${s.refused})`
      : `contracts=${contracts}: fills OPEN ${s.statuses.OPEN.filled}/${s.statuses.OPEN.partial}/${s.statuses.OPEN.rejected} CLOSE ${s.statuses.CLOSE.filled}/${s.statuses.CLOSE.partial}/${s.statuses.CLOSE.rejected} | OPEN total p50/p95/max=${ms(s.samples.OPEN)}ms engine=${ms(s.phases.OPEN.engine)} market=${ms(s.phases.OPEN.market)} repo=${ms(s.phases.OPEN.repository)} | CLOSE total=${ms(s.samples.CLOSE)} | REFRESH total=${ms(s.samples.REFRESH)} | quotes/OPEN p50=${s.calls.OPEN.quote.p50} marks/OPEN=${s.calls.OPEN.marks.p50} history/REFRESH max=${s.calls.REFRESH.history.max} repo calls/OPEN=${s.calls.OPEN.repository.p50} | payload=${(s.payload.bytesLast / 1024).toFixed(0)}KB response p95=${(s.response.p95 / 1024).toFixed(0)}KB | journal=${s.journal} | loop p99=${s.loop.p99ms}ms`;
    console.log(line);
  }
  if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n'); console.log('written', OUT); }
})().catch((e) => { console.error(e); process.exit(1); });
