#!/usr/bin/env node
// Bybit historical funding → one fixed VOLTEX demo funding rate.
//
// Reads ONLY Bybit's official public v5 market API (no key, no account):
//   GET /v5/market/instruments-info   which contracts are USDT linear perpetuals, when they launched
//   GET /v5/market/tickers            24h turnover, used to pick the liquid contracts
//   GET /v5/market/funding/history    the funding rates that were actually settled
//
// Method (also written into the output so the number can be audited):
//   1. Window: the last N complete UTC days before --end (default: today 00:00 UTC).
//      A settlement belongs to the window when start <= fundingRateTimestamp < end.
//   2. Contracts: USDT-settled LinearPerpetual, status Trading, launched before the
//      window opened (so the whole window exists), ranked by 24h turnover; the top
//      --top are taken and BTCUSDT, ETHUSDT and SOLUSDT are always included.
//   3. Each settled record's interval is the gap to the previous settlement of the
//      same contract (one extra day before the window is read so the first record
//      has a predecessor). Its 8h equivalent is rate × 480 / intervalMinutes.
//   4. Per contract: sum(rate) × 480 / sum(intervalMinutes) — the duration-weighted
//      mean of the 8h equivalents. When every interval is 8h this is exactly the
//      plain arithmetic mean of the settled rates. Signs are kept.
//   5. Overall: the arithmetic mean of the per-contract means, every contract with
//      the same weight.
//   6. The fixed rate is the overall mean rounded half away from zero to 8 decimal
//      places (Bybit publishes funding rates with at most 8).
//
// Every decimal is handled as an exact scaled BigInt; no floating point touches a rate.
// Usage: node scripts/research/bybit-funding-average.mjs [--end 2026-10-16] [--days 30] [--top 10] [--out dir]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith('--') ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const DAY = 86_400_000;
const today = Math.floor(Date.now() / DAY) * DAY;
const end = args.end ? Date.parse(`${args.end}T00:00:00Z`) : today;
const days = Number(args.days ?? 30);
const top = Number(args.top ?? 10);
const outDir = args.out ?? 'out';
const bases = (args.base ? [args.base] : ['https://api.bybit.com', 'https://api.bytick.com']);
const ALWAYS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
if (!Number.isSafeInteger(end) || end % DAY !== 0 || end > today) throw new Error('--end must be a past or current UTC date');
if (!Number.isInteger(days) || days < 1 || days > 200) throw new Error('--days out of range');
const start = end - days * DAY;

const SCALE = 10n ** 24n;
function toScaled(text) {
  if (typeof text !== 'string' || !/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`not a decimal: ${text}`);
  const neg = text.startsWith('-'), [i, f = ''] = text.replace('-', '').split('.');
  if (f.length > 24) throw new Error(`too many decimals: ${text}`);
  const v = BigInt(i) * SCALE + BigInt((f + '0'.repeat(24)).slice(0, 24));
  return neg ? -v : v;
}
function divRound(num, den) { // half away from zero
  if (den <= 0n) throw new Error('bad denominator');
  const neg = num < 0n, a = neg ? -num : num, q = a / den, r = a % den, rounded = r * 2n >= den ? q + 1n : q;
  return neg ? -rounded : rounded;
}
function scaledText(v, dp = 24) {
  const neg = v < 0n, a = neg ? -v : v, s = a.toString().padStart(25, '0');
  const txt = `${s.slice(0, -24)}.${s.slice(-24)}`.replace(/^0+(?=\d)/, '');
  const [i, f] = txt.split('.');
  return `${neg ? '-' : ''}${i}.${f.slice(0, dp)}`;
}
function roundTo(v, dp) { const unit = 10n ** BigInt(24 - dp); return divRound(v, unit) * unit; }

async function get(path, params) {
  const errors = [];
  for (const base of bases) {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      const body = await response.text();
      if (!response.ok) { errors.push(`${url.host} ${response.status} ${body.slice(0, 120)}`); continue; }
      const json = JSON.parse(body);
      if (json.retCode !== 0) { errors.push(`${url.host} retCode ${json.retCode} ${json.retMsg}`); continue; }
      return { host: url.host, json };
    } catch (error) { errors.push(`${url.host} ${error.message}`); }
  }
  throw new Error(`Bybit unreachable for ${path}: ${errors.join(' | ')}`);
}

const fetchedAt = new Date().toISOString();
const hosts = new Set();
const instruments = [];
for (let cursor = ''; ;) {
  const { host, json } = await get('/v5/market/instruments-info', { category: 'linear', limit: 1000, ...(cursor ? { cursor } : {}) });
  hosts.add(host); instruments.push(...json.result.list);
  cursor = json.result.nextPageCursor; if (!cursor) break;
}
const eligible = new Map(instruments
  .filter(i => i.contractType === 'LinearPerpetual' && i.quoteCoin === 'USDT' && i.settleCoin === 'USDT' && i.status === 'Trading' && Number(i.launchTime) < start)
  .map(i => [i.symbol, i]));
const { host: tickerHost, json: tickers } = await get('/v5/market/tickers', { category: 'linear' });
hosts.add(tickerHost);
const ranked = tickers.result.list.filter(t => eligible.has(t.symbol)).sort((a, b) => Number(b.turnover24h) - Number(a.turnover24h));
const chosen = ranked.slice(0, top).map(t => t.symbol);
for (const s of ALWAYS) if (!chosen.includes(s)) { if (!eligible.has(s)) throw new Error(`${s} not eligible`); chosen.push(s); }

const assets = [];
for (const symbol of chosen) {
  const records = new Map();
  for (let cursorEnd = end - 1; ;) {
    const { host, json } = await get('/v5/market/funding/history', { category: 'linear', symbol, startTime: start - DAY, endTime: cursorEnd, limit: 200 });
    hosts.add(host);
    const page = json.result.list;
    for (const r of page) {
      if (r.symbol !== symbol) throw new Error(`symbol mismatch ${r.symbol}`);
      records.set(Number(r.fundingRateTimestamp), r.fundingRate);
    }
    if (page.length < 200) break;
    cursorEnd = Math.min(...page.map(r => Number(r.fundingRateTimestamp))) - 1;
  }
  const all = [...records.entries()].sort((a, b) => a[0] - b[0]);
  const settled = [];
  for (let i = 0; i < all.length; i++) {
    const [time, rate] = all[i];
    if (time < start || time >= end) continue;
    if (i === 0) throw new Error(`${symbol}: no settlement before the window to size the first interval`);
    const intervalMinutes = (time - all[i - 1][0]) / 60_000;
    settled.push({ time, iso: new Date(time).toISOString(), rate, intervalMinutes });
  }
  const minutes = settled.reduce((v, r) => v + r.intervalMinutes, 0);
  const sum = settled.reduce((v, r) => v + toScaled(r.rate), 0n);
  const mean8h = divRound(sum * 480n, BigInt(minutes));
  const intervals = [...new Set(settled.map(r => r.intervalMinutes))].sort((a, b) => a - b);
  const odd = settled.filter(r => !Number.isInteger(r.intervalMinutes) || r.intervalMinutes <= 0 || 480 % r.intervalMinutes !== 0);
  assets.push({
    symbol, launchTime: new Date(Number(eligible.get(symbol).launchTime)).toISOString(),
    currentFundingIntervalMinutes: Number(eligible.get(symbol).fundingInterval),
    turnover24h: tickers.result.list.find(t => t.symbol === symbol)?.turnover24h ?? null,
    records: settled.length, intervalsMinutes: intervals, irregularIntervals: odd.length,
    windowMinutesCovered: minutes, windowMinutes: days * 1440,
    complete: minutes === days * 1440 && odd.length === 0,
    plainMeanOfSettledRates: scaledText(divRound(sum, BigInt(settled.length)), 12),
    mean8hEquivalent: scaledText(mean8h, 12), mean8hScaled: mean8h.toString(),
    min: settled.reduce((m, r) => (toScaled(r.rate) < toScaled(m) ? r.rate : m), settled[0].rate),
    max: settled.reduce((m, r) => (toScaled(r.rate) > toScaled(m) ? r.rate : m), settled[0].rate),
    settled,
  });
}
const incomplete = assets.filter(a => !a.complete).map(a => a.symbol);
const overall = divRound(assets.reduce((v, a) => v + BigInt(a.mean8hScaled), 0n), BigInt(assets.length));
const fixed = roundTo(overall, 8);
const summary = {
  source: 'Bybit official public API v5 (/v5/market/instruments-info, /v5/market/tickers, /v5/market/funding/history)',
  hosts: [...hosts], fetchedAt,
  window: { start: new Date(start).toISOString(), endExclusive: new Date(end).toISOString(), days, rule: 'start <= fundingRateTimestamp < end' },
  selection: `USDT LinearPerpetual, status Trading, launched before window start; top ${top} by 24h turnover at fetch time, plus ${ALWAYS.join(', ')}`,
  normalisation: 'per record: rate × 480 / interval minutes (interval = gap to previous settlement); per contract: sum(rate) × 480 / sum(interval minutes); all-8h contracts reduce to the plain arithmetic mean',
  aggregation: 'equal-weight arithmetic mean of per-contract 8h means',
  rounding: 'half away from zero to 8 decimal places',
  assets: assets.map(({ settled, mean8hScaled, ...rest }) => rest),
  totalRecords: assets.reduce((v, a) => v + a.records, 0),
  incomplete,
  overallMean8h: scaledText(overall, 12),
  fixedRate8h: scaledText(fixed, 8),
  usable: incomplete.length === 0,
};
mkdirSync(outDir, { recursive: true });
const stamp = new Date(end).toISOString().slice(0, 10);
writeFileSync(join(outDir, `bybit-funding-${stamp}.json`), JSON.stringify({ summary, assets: assets.map(({ mean8hScaled, ...a }) => a) }, null, 2));
const md = [
  `# Bybit funding, ${days} complete UTC days to ${stamp}`, '',
  `Source: ${summary.source}; hosts ${summary.hosts.join(', ')}; fetched ${fetchedAt}.`,
  `Window: ${summary.window.start} ≤ t < ${summary.window.endExclusive}.`, '',
  '| Contract | Records | Intervals (min) | Complete | Mean of settled rates | 8h-equivalent mean | Min | Max |',
  '|---|---:|---|---|---:|---:|---:|---:|',
  ...assets.map(a => `| ${a.symbol} | ${a.records} | ${a.intervalsMinutes.join('/')} | ${a.complete ? 'yes' : 'NO'} | ${a.plainMeanOfSettledRates} | ${a.mean8hEquivalent} | ${a.min} | ${a.max} |`),
  '', `Total records: ${summary.totalRecords}. Equal-weight mean (8h): ${summary.overallMean8h}. Fixed rate (8 dp): **${summary.fixedRate8h}**.`,
  incomplete.length ? `\nINCOMPLETE history for: ${incomplete.join(', ')} — do not use this run.` : '',
].join('\n');
writeFileSync(join(outDir, `bybit-funding-${stamp}.md`), md + '\n');
console.log(md);
if (incomplete.length) process.exitCode = 2;
