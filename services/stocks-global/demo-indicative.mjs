// #613 demo/indicative prices (owner decision 30.10: a public mock-up, delayed data acceptable as on TradingView's free
// tier). OFF unless STOCKS_DEMO_INDICATIVE_ENABLED=true; the release default is unchanged.
//
// Tokenized stocks on Solana: one getMultipleAccounts call reads every listed pool and the price is decoded from the
// pool's own state (Raydium CLMM / Orca Whirlpool / Meteora DAMM v2 sqrt price, Meteora DLMM active bin). The three
// FluxBeam-only tokens of the recorded list are left out: their thin pools give prices far from the asset. No aggregator, no CEX, nothing invented: a pool that cannot be read or decoded has no price. The price is
// the pool's current token price in USDC, labelled indicative and delayed by up to 15 minutes; it never feeds an order
// (server.mjs refuses every financial command on an indicative instrument) and it is not the six-gate own-source
// history (readWork.ts admitStockHistory stays the only admitted SOLANA:<mint>:<pool> history).
// Candles are built from these snapshots (1-minute buckets for 2 days, 1-hour buckets for a year) and kept in a small
// JSON file so a restart does not lose the chart.
import fs from 'node:fs';
import path from 'node:path';
import { SimError, check } from './engine.mjs';
import { CATALOG, DEMO_CATALOG } from './catalog.mjs';
import { parseCandles } from './market.mjs';

export const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const DEX_PROGRAMS = Object.freeze({
  raydium: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  orca: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  meteora: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  damm: 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
});
const INTERVAL_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1D': 86400000 };
const MINUTES_KEPT = 2 * 24 * 60, HOURS_KEPT = 365 * 24, PAGE = 300;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}
const key = (d, o) => base58(d.subarray(o, o + 32));
const u128 = (d, o) => d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n);
const sqrtRatio = x => (Number(x) / 2 ** 64) ** 2;

// The pool's two mints and the raw price of mint A in units of mint B (before decimals). Every layout is identified by its owner program and checked by its mint fields; an account that
// does not match is refused (null), never guessed.
export function decodePool(owner, data) {
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
  if (owner === DEX_PROGRAMS.raydium && d.length >= 273) // PoolState (pool.pinned.rs): mints 73/105, decimals 233/234, sqrt_price_x64 253
    return { mintA: key(d, 73), mintB: key(d, 105), decimalsA: d[233], decimalsB: d[234], ratio: sqrtRatio(u128(d, 253)) };
  if (owner === DEX_PROGRAMS.orca && d.length >= 213) // Whirlpool: sqrt_price 65, token_mint_a 101, token_mint_b 181
    return { mintA: key(d, 101), mintB: key(d, 181), ratio: sqrtRatio(u128(d, 65)) };
  if (owner === DEX_PROGRAMS.meteora && d.length >= 152) { // LbPair: active_id i32 76, bin_step u16 80, token_x 88, token_y 120
    const binStep = d.readUInt16LE(80);
    if (!binStep) return null;
    return { mintA: key(d, 88), mintB: key(d, 120), ratio: (1 + binStep / 10000) ** d.readInt32LE(76) };
  }
  if (owner === DEX_PROGRAMS.damm && d.length >= 472) // DAMM v2 Pool: token_a 168, token_b 200, sqrt_price 456
    return { mintA: key(d, 168), mintB: key(d, 200), ratio: sqrtRatio(u128(d, 456)) };
  return null;
}
// Mint decimals (SPL Token and Token-2022: byte 44).
export const mintDecimals = data => { const d = Buffer.from(data, 'base64'); return d.length >= 45 ? d[44] : null; };

// USDC per token for one listed row, or null. The other side must be USDC; decimals come from the pool (Raydium) or
// from the mint accounts.
export function tokenPrice(row, pool, decimals) {
  if (!pool) return null;
  const tokenIsA = pool.mintA === row.mint && pool.mintB === USDC_MINT, tokenIsB = pool.mintB === row.mint && pool.mintA === USDC_MINT;
  if (!tokenIsA && !tokenIsB) return null;
  const decA = pool.decimalsA ?? decimals.get(pool.mintA), decB = pool.decimalsB ?? decimals.get(pool.mintB);
  if (!Number.isInteger(decA) || !Number.isInteger(decB)) return null;
  const bPerA = pool.ratio * 10 ** (decA - decB), price = tokenIsA ? bPerA : 1 / bPerA;
  return Number.isFinite(price) && price > 0 ? price : null;
}

const fixed = x => { const s = x >= 1 ? x.toFixed(4) : x.toPrecision(6); return Number(s).toFixed(8); };

// One bucket list per instrument: [startMs, open, high, low, close]; appends or updates the last bucket.
function addPoint(list, step, at, price, keep) {
  const start = Math.floor(at / step) * step, last = list[list.length - 1];
  if (last && last[0] === start) { last[2] = Math.max(last[2], price); last[3] = Math.min(last[3], price); last[4] = price; }
  else if (!last || last[0] < start) { list.push([start, price, price, price, price]); if (list.length > keep) list.splice(0, list.length - keep); }
}
function aggregate(list, step) {
  const out = [];
  for (const [t, o, h, l, c] of list) {
    const start = Math.floor(t / step) * step, last = out[out.length - 1];
    if (last && last[0] === start) { last[2] = Math.max(last[2], h); last[3] = Math.min(last[3], l); last[4] = c; }
    else out.push([start, o, h, l, c]);
  }
  return out;
}

export class IndicativeSolanaPrices {
  constructor({ fetchImpl = (...a) => fetch(...a), now = Date.now, rpc = SOLANA_RPC, intervalMs = 15000, dataPath = null, rows = DEMO_CATALOG, timers = globalThis } = {}) {
    Object.assign(this, { fetchImpl, now, rpc, intervalMs, dataPath, rows, timers });
    this.byId = new Map(rows.map(r => [r.id, r]));
    this.decimals = new Map();
    this.latest = new Map(); this.minutes = new Map(); this.hours = new Map();
    this.metrics = { snapshots: 0, failures: 0, priced: 0, unpriced: 0, rpcRequests: 0, lastError: null };
    this.load();
  }
  async call(method, params) {
    this.metrics.rpcRequests++;
    const controller = new AbortController(), timer = this.timers.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.fetchImpl(this.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: controller.signal, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      check(response.ok, response.status === 429 ? 'RATE_LIMIT' : 'SOURCE_UNAVAILABLE');
      const body = await response.json();
      check(body && !body.error && body.result, 'INVALID_DATA');
      return body.result;
    } finally { this.timers.clearTimeout(timer); }
  }
  // getMultipleAccounts takes at most 100 addresses per call.
  async accounts(addresses) {
    const out = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const r = await this.call('getMultipleAccounts', [addresses.slice(i, i + 100), { encoding: 'base64', commitment: 'confirmed' }]);
      check(Array.isArray(r.value) && r.value.length === Math.min(100, addresses.length - i), 'INVALID_DATA');
      out.push(...r.value.map(v => v ? { owner: v.owner, data: v.data?.[0] } : null));
      if (Number.isSafeInteger(r.context?.slot)) this.slot = r.context.slot;
    }
    return out;
  }
  async snapshot() {
    try {
      if (!this.decimals.size) {
        const mints = [...new Set([USDC_MINT, ...this.rows.map(r => r.mint)])], info = await this.accounts(mints);
        mints.forEach((m, i) => { const d = info[i] && mintDecimals(info[i].data); if (Number.isInteger(d)) this.decimals.set(m, d); });
      }
      const read = await this.accounts(this.rows.map(r => r.pool)), at = this.now();
      let priced = 0;
      this.rows.forEach((row, i) => {
        const a = read[i], pool = a && a.owner === DEX_PROGRAMS[row.dex] ? decodePool(a.owner, a.data) : null;
        const price = tokenPrice(row, pool, this.decimals);
        if (price === null) return;
        priced++;
        this.latest.set(row.id, { price, at, slot: this.slot ?? null });
        if (!this.minutes.has(row.id)) { this.minutes.set(row.id, []); this.hours.set(row.id, []); }
        addPoint(this.minutes.get(row.id), 60000, at, price, MINUTES_KEPT);
        addPoint(this.hours.get(row.id), 3600000, at, price, HOURS_KEPT);
      });
      Object.assign(this.metrics, { snapshots: this.metrics.snapshots + 1, priced, unpriced: this.rows.length - priced, lastError: null });
    } catch (error) { this.metrics.failures++; this.metrics.lastError = error.code || 'SOURCE_UNAVAILABLE'; }
  }
  start() {
    if (this.timer) return;
    const tick = async () => { await this.snapshot(); if (this.metrics.snapshots % 20 === 1) this.save(); };
    void tick(); this.timer = this.timers.setInterval(() => { void tick(); }, this.intervalMs); this.timer.unref?.();
  }
  close() { if (this.timer) this.timers.clearInterval(this.timer); this.timer = null; this.save(); }
  save() {
    if (!this.dataPath) return;
    try {
      const tmp = this.dataPath + '.tmp';
      fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, minutes: Object.fromEntries(this.minutes), hours: Object.fromEntries(this.hours) }));
      fs.renameSync(tmp, this.dataPath);
    } catch { this.metrics.lastError = 'STORE_WRITE_FAILED'; }
  }
  load() {
    if (!this.dataPath || !fs.existsSync(this.dataPath)) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
      const valid = list => Array.isArray(list) && list.every(c => Array.isArray(c) && c.length === 5 && c.every(Number.isFinite));
      for (const [id, list] of Object.entries(j.minutes ?? {})) if (this.byId.has(id) && valid(list)) this.minutes.set(id, list.slice(-MINUTES_KEPT));
      for (const [id, list] of Object.entries(j.hours ?? {})) if (this.byId.has(id) && valid(list)) this.hours.set(id, list.slice(-HOURS_KEPT));
    } catch { this.metrics.lastError = 'STORE_READ_FAILED'; }
  }
  quote(id) {
    const row = this.byId.get(id), last = this.latest.get(id);
    check(row, 'INVALID_PAIR'); check(last, 'QUOTE_UNAVAILABLE');
    const price = fixed(last.price), dayAgo = (this.hours.get(id) ?? []).find(c => c[0] >= last.at - 86400000 - 3600000);
    return {
      instrumentId: id, provider: row.provider, nativeCurrency: row.currency, bid: price, ask: price, last: price,
      timestamp: last.at, receivedAt: last.at, eventId: 'solana-slot-' + (last.slot ?? last.at), verified: true, indicative: true,
      capacity: '1.00000000', multiplier: 1, delaySeconds: row.delaySeconds, marketOpen: true, volume: null,
      change24h: dayAgo ? 100 * (last.price - dayAgo[1]) / dayAgo[1] : null,
      prices: { [row.currency]: { buy: price, sell: price } }, fx: {},
    };
  }
  history(id, interval = '15m', before = null) {
    const row = this.byId.get(id), step = INTERVAL_MS[interval];
    check(row, 'INVALID_PAIR'); check(step && row.timeframes.includes(interval), 'INVALID_REQUEST');
    const source = step < 3600000 ? this.minutes.get(id) ?? [] : this.hours.get(id) ?? [];
    let candles = aggregate(source, step);
    if (before) candles = candles.filter(c => c[0] < Number(before));
    candles = candles.slice(-PAGE).map(([t, o, h, l, c]) => ({ time: t / 1000, open: o, high: h, low: l, close: c, volume: 0 }));
    return Object.freeze({ instrumentId: id, interval, currency: row.currency, provider: row.provider, delaySeconds: row.delaySeconds, indicative: true, candles: Object.freeze(candles), receivedAt: this.now() });
  }
}

// MOEX equities from the exchange's own ISS service, 15-minute delayed (free without a subscription), in roubles: no
// CEX and no FX leg. Quote: the board's last trade; candles: ISS 1-minute, 1-hour and 1-day bars, newest first
// (iss.reverse: ISS pages 500 rows from the start of the range otherwise).
const ISS = 'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities';
const issTable = (j, name) => { const t = j?.[name]; check(Array.isArray(t?.columns) && Array.isArray(t?.data), 'INVALID_DATA'); return t.data.map(row => Object.fromEntries(t.columns.map((k, i) => [k, row[i]]))); };
export class IndicativeMoex {
  constructor({ fetchImpl = (...a) => fetch(...a), now = Date.now, timers = globalThis } = {}) {
    Object.assign(this, { fetchImpl, now, timers });
    this.rows = CATALOG.filter(r => r.provider === 'moex');
    this.byId = new Map(this.rows.map(r => [r.id, r]));
    this.cache = new Map(); this.flights = new Map();
    this.metrics = { requests: 0, failures: 0 };
  }
  async get(url, ttl) {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < ttl) return hit.value;
    if (this.flights.has(url)) return this.flights.get(url);
    const flight = (async () => {
      this.metrics.requests++;
      const controller = new AbortController(), timer = this.timers.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await this.fetchImpl(url, { redirect: 'error', signal: controller.signal });
        check(response.ok, 'SOURCE_UNAVAILABLE');
        const value = await response.json();
        this.cache.set(url, { at: this.now(), value });
        if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
        return value;
      } catch (error) { this.metrics.failures++; throw error instanceof SimError ? error : new SimError('SOURCE_UNAVAILABLE'); }
      finally { this.timers.clearTimeout(timer); this.flights.delete(url); }
    })();
    this.flights.set(url, flight);
    return flight;
  }
  // Status and the list's display price of all 20 rows in one ISS request (cached a minute).
  async catalogue() {
    try {
      const j = await this.get(`${ISS}.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,STATUS&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,UPDATETIME,SYSTIME`, 60000);
      const status = new Map(issTable(j, 'securities').map(r => [r.SECID, r.STATUS])), market = new Map(issTable(j, 'marketdata').map(r => [r.SECID, r]));
      return this.rows.map(r => {
        const m = market.get(r.sourceSymbol), timestamp = m && typeof m.SYSTIME === 'string' && typeof m.UPDATETIME === 'string' ? Date.parse(m.SYSTIME.slice(0, 10) + 'T' + m.UPDATETIME + '+03:00') : NaN;
        const display = m && Number(m.LAST) > 0 && Number.isSafeInteger(timestamp) ? { price: Number(m.LAST).toFixed(8), change24h: m.LASTTOPREVPRICE == null ? null : Number(m.LASTTOPREVPRICE), timestamp } : null;
        return { ...r, indicative: true, exists: status.has(r.sourceSymbol), online: status.get(r.sourceSymbol) === 'A', display };
      });
    } catch { return this.rows.map(r => ({ ...r, indicative: true, exists: null, online: false, display: null, sourceError: 'SOURCE_UNAVAILABLE' })); }
  }
  async quote(id) {
    const row = this.byId.get(id); check(row, 'INVALID_PAIR');
    const j = await this.get(`${ISS}/${row.sourceSymbol}.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST,UPDATETIME,SYSTIME,TRADINGSTATUS,LASTTOPREVPRICE,VOLTODAY,SEQNUM`, 10000);
    const t = issTable(j, 'marketdata').find(r => r.SECID === row.sourceSymbol);
    check(t && Number(t.LAST) > 0 && typeof t.SYSTIME === 'string' && typeof t.UPDATETIME === 'string', 'QUOTE_UNAVAILABLE');
    const price = Number(t.LAST).toFixed(8), timestamp = Date.parse(t.SYSTIME.slice(0, 10) + 'T' + t.UPDATETIME + '+03:00');
    check(Number.isSafeInteger(timestamp), 'INVALID_DATA');
    return {
      instrumentId: id, provider: 'moex', nativeCurrency: 'RUB', bid: price, ask: price, last: price, timestamp, receivedAt: this.now(),
      eventId: 'moex-' + (t.SEQNUM ?? t.SYSTIME), verified: true, indicative: true, capacity: '1.00000000', multiplier: 1, delaySeconds: row.delaySeconds,
      marketOpen: t.TRADINGSTATUS === 'T', change24h: t.LASTTOPREVPRICE == null ? null : Number(t.LASTTOPREVPRICE), volume: t.VOLTODAY == null ? null : String(t.VOLTODAY),
      prices: { RUB: { buy: price, sell: price } }, fx: {},
    };
  }
  async history(id, interval = '1h', before = null) {
    const row = this.byId.get(id); check(row, 'INVALID_PAIR');
    const period = { '1m': 1, '1h': 60, '1D': 24 }[interval]; check(period, 'INVALID_REQUEST');
    const end = before ? Number(before) : this.now(), days = interval === '1D' ? 360 : interval === '1h' ? 14 : 2;
    const from = new Date(end - days * 86400000).toISOString().slice(0, 10), till = new Date(end).toISOString().slice(0, 10);
    const j = await this.get(`${ISS}/${row.sourceSymbol}/candles.json?iss.meta=off&iss.reverse=true&interval=${period}&from=${from}&till=${till}`, interval === '1D' ? 600000 : 60000);
    const candles = parseCandles(issTable(j, 'candles'), 'moex', this.now()).filter(c => c.time * 1000 < end).slice(-PAGE);
    return Object.freeze({ instrumentId: id, interval, currency: row.currency, provider: 'moex', delaySeconds: row.delaySeconds, indicative: true, candles: Object.freeze(candles), receivedAt: this.now() });
  }
}

// The release hub with the indicative rows added: Solana rows answered from the snapshots, every other row from the
// unchanged hub (MOEX included; server.mjs decides what a viewer may see and refuses every order on these rows).
export function withIndicativePrices(base, prices, moex = new IndicativeMoex()) {
  const reader = id => prices.byId.has(id) ? prices : moex.byId.has(id) ? moex : null;
  const hub = Object.create(base);
  Object.assign(hub, {
    indicative: true,
    metrics: base.metrics,
    // Only rows that can be shown: the indicative rows, MOEX, and any other row the release hub has online (none
    // while STOCKS_MARKET_DATA_ENABLED is false), so the list carries no dead CEX rows.
    catalogue: async () => [
      ...(await base.catalogue()).filter(r => r.online === true && !reader(r.id)),
      ...await moex.catalogue(),
      ...prices.rows.map(r => {
        if (!prices.latest.has(r.id)) return { ...r, online: false, exists: null, display: null, sourceError: 'QUOTE_UNAVAILABLE' };
        const q = prices.quote(r.id);
        return { ...r, online: true, exists: true, display: { price: q.last, change24h: q.change24h, timestamp: q.timestamp } };
      }),
    ],
    quote: async (id, options) => reader(id) ? reader(id).quote(id) : base.quote(id, options),
    history: async (id, interval, before, options) => reader(id) ? reader(id).history(id, interval, before) : base.history(id, interval, before, options),
    quoteValid: (q, id = q?.instrumentId) => reader(id) ? !!q : (base.quoteValid ? base.quoteValid(q, id) : true),
    withUsdcPrices: async q => reader(q?.instrumentId) ? q : (base.withUsdcPrices ? base.withUsdcPrices(q) : q),
    close: async () => { prices.close(); await base.close?.(); },
  });
  return hub;
}

export function indicativeFromEnv(env = process.env) {
  const flag = env.STOCKS_DEMO_INDICATIVE_ENABLED ?? 'false';
  if (!['true', 'false'].includes(flag)) throw new SimError('STOCKS_RELEASE_FEED_CONFIG_INVALID');
  return flag === 'true' ? { dataPath: env.STOCKS_DEMO_INDICATIVE_DATA || null } : null;
}
